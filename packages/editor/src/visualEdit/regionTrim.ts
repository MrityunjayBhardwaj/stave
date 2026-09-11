/**
 * regionTrim.ts — the WRITE DECISIONS for a sample's played region (#1527).
 *
 * `begin` and `end` say which slice of a sample file a mark plays. The timeline
 * already DRAWS that slice (#1512, `waveformLane.ts`); this is the other
 * direction — a dragged mark edge becoming `.begin(0.25)` in the document.
 *
 * Pure, like `mixer/writeStrip.ts` and for the same reason: `ChunkInfo` + a
 * target value → one surgical edit, or `null` when the control must hand off.
 * The gesture is then unit-testable without a canvas or Monaco.
 *
 * ── WHY THIS IS ITS OWN MODULE AND NOT AN ADD-EFFECT ENTRY ──────────────────
 * `effectCatalog.ts` excludes `begin`/`end` deliberately, and says why:
 * "sample trim (a sample/region concern)". That division of labour is right —
 * the FX menu is per-track colour, and a region is a property of the audio a
 * mark plays. This module is the surface those two were being reserved for, so
 * the fence stays up rather than being routed around.
 *
 * ── WHAT IT REFUSES, AND HOW OFTEN THAT IS ──────────────────────────────────
 * Measured over the 558-document archive (deduped by sha256 of `code`): of the
 * region controls that a chunk actually exposes, **8 of 16 `.begin` and 6 of 17
 * `.end` are numeric** — the rest are patterned (`"<0 .25 .5 .75>"`), computed
 * (`rand.rangex(0.1,.5)`) or bound (`beginVal`). Roughly half must be refused,
 * so refusing is a first-class outcome here rather than an edge case.
 *
 * The common case is neither: **544 of those 558 documents write no `.begin` at
 * all**, so the path that runs most is the append.
 */
import type { ChunkInfo, ChainCall } from './chunkDetect'
import { formatNumber } from './writeback'

/** One surgical edit: replace `range` with `text` (a zero-width range inserts). */
export interface RegionEdit {
  range: [number, number]
  text: string
}

/** The two ends of a region, in the order superdough reads them. */
export type RegionControl = 'begin' | 'end'

/**
 * superdough's own defaults (`sampler.mjs:67`) — a mark with no region controls
 * plays the whole file. Shared with the read side's `WHOLE_SAMPLE`; kept here as
 * plain numbers rather than imported, because the app package owns that type and
 * this package must not depend on it.
 */
export const REGION_DEFAULT: Readonly<Record<RegionControl, number>> = { begin: 0, end: 1 }

/**
 * The narrowest gap the two edges may be pushed to, as a fraction of the file.
 *
 * WHY A FLOOR AT ALL: `regionPlayback` returns null — draws nothing, plays
 * nothing — the moment `end <= begin`, so a drag that crosses over silently
 * empties the mark. A gesture whose far end is "the take disappears" is not a
 * trim. 0.01 is `knobRanges`' own step for both controls, so the floor and the
 * knob agree on what one unit of this value is.
 */
export const MIN_REGION_SPAN = 0.01

/** The chain call for a control, or null when the document does not write it. */
function callFor(chunk: ChunkInfo, control: RegionControl): ChainCall | null {
  // The LAST spelling wins, which is what the runtime does: each `.begin()` in a
  // chain overwrites the previous one, so the final call is the value that
  // plays and therefore the one an edit must land on.
  let found: ChainCall | null = null
  for (const c of chunk.chain) if (c.name === control && c.args.length >= 1) found = c
  return found
}

/**
 * What the document currently says this control is.
 *
 * `null` means "written, but not as a number" — patterned, computed or bound —
 * which is NOT the same as absent and must not be confused with it: absent is
 * writable (append the call), non-numeric is not (refuse). Returning the
 * default for both would make a `.begin("<0 .5>")` look like a plain 0 and let
 * a drag overwrite a pattern the user wrote on purpose.
 */
export function readRegionControl(
  chunk: ChunkInfo,
  control: RegionControl,
): number | null | 'absent' {
  const call = callFor(chunk, control)
  if (!call) return 'absent'
  return call.args[0]?.numeric ?? null
}

/** The region a chunk plays today, with absent controls resolved to defaults. */
export function readRegion(chunk: ChunkInfo): { begin: number; end: number } | null {
  const b = readRegionControl(chunk, 'begin')
  const e = readRegionControl(chunk, 'end')
  if (b === null || e === null) return null // one end is patterned — no fixed region
  return {
    begin: b === 'absent' ? REGION_DEFAULT.begin : b,
    end: e === 'absent' ? REGION_DEFAULT.end : e,
  }
}

/**
 * The edit that sets one region control to `value`:
 *  - numeric literal → replace just that literal;
 *  - absent          → append `.begin(v)` / `.end(v)` at the end of the expression;
 *  - patterned/computed/bound → null, and the caller must decline VISIBLY.
 *
 * `value` is NOT clamped here. Clamping needs the other end (a `begin` may not
 * pass its `end`), and a function that silently repaired an out-of-range value
 * would make the refusal above indistinguishable from a rewrite to something
 * the caller never asked for. `regionTrimEdit` below is the clamping entry
 * point; this one is the primitive it is built from.
 */
export function regionControlEdit(
  chunk: ChunkInfo,
  control: RegionControl,
  value: number,
): RegionEdit | null {
  if (!Number.isFinite(value)) return null
  const call = callFor(chunk, control)
  if (!call) {
    return { range: [chunk.exprRange[1], chunk.exprRange[1]], text: `.${control}(${formatNumber(value)})` }
  }
  const arg = call.args[0]
  if (arg.numeric === null) return null // patterned / computed / bound — hands off
  return { range: arg.range, text: formatNumber(value) }
}

/**
 * Head functions whose expression is MORE THAN ONE SOUND SOURCE.
 *
 * ⚠ MEASURED, NOT DEFENSIVE. A lane's source anchor resolves to the outer
 * combinator for a nested arm — `$: stack(s("drums"), s("take_1"))` gives one
 * chunk headed `stack` whichever anchor is used. Appending `.begin(0.3)` there
 * is valid code that does the wrong thing: the user grabbed the take's mark and
 * the drums get trimmed too, silently, with the document looking reasonable.
 *
 * The agreement check cannot catch this one. When neither the mark nor the
 * combinator has a region, both read the default and they agree — the append is
 * only wrong about WHOSE region it sets. So the head is checked directly.
 *
 * Refusing costs a real case: `$: arrange([4, vox])`, one take, where appending
 * would have been right. That is the trade taken deliberately — a refusal is
 * visible and can be relaxed later; a silent edit to the wrong voices is neither.
 */
export const MULTI_VOICE_HEADS: ReadonlySet<string> = new Set([
  'stack',
  'overlay',
  'superimpose',
  'layer',
  'cat',
  'slowcat',
  'fastcat',
  'seq',
  'timeCat',
  'timecat',
  'randcat',
  'wrandcat',
  'arrange',
  'polymeter',
  'pm',
])

/** Why a trim produced no edit — carried so the caller can say so out loud. */
export type RegionTrimRefusal =
  /** the control (or its partner) is patterned, computed or bound */
  | 'not-a-number'
  /** the expression combines several voices — the edit would reach all of them */
  | 'not-one-voice'
  /** the drag asked for a value the document already says */
  | 'no-change'

export interface RegionTrimResult {
  /** The edit to apply, or null when `refusal` says why there is none. */
  readonly edit: RegionEdit | null
  readonly refusal: RegionTrimRefusal | null
  /** What the control will read after the edit — already clamped. */
  readonly value: number
}

/**
 * Move ONE edge of the region to `value`, clamped so the result is still a
 * region someone can hear.
 *
 * Clamping is against the OTHER edge as the document currently writes it, not
 * against 0/1 alone: dragging `begin` past `end` would make
 * `regionPlayback` return null and the mark would vanish mid-gesture. So a
 * `begin` may reach at most `end - MIN_REGION_SPAN`, and an `end` at least
 * `begin + MIN_REGION_SPAN`.
 *
 * ⚠ THE PARTNER IS READ EVEN WHEN IT IS NOT BEING EDITED, and a patterned
 * partner refuses the whole trim. Not defensiveness — with `.end("<0.3 0.8>")`
 * there is no single number to clamp against, and clamping against the default
 * 1 instead would let `begin` be dragged past the end this mark actually plays
 * on the cycle the user is looking at.
 */
export function regionTrimEdit(
  chunk: ChunkInfo,
  control: RegionControl,
  value: number,
): RegionTrimResult {
  if (chunk.headFn !== null && MULTI_VOICE_HEADS.has(chunk.headFn)) {
    return { edit: null, refusal: 'not-one-voice', value }
  }
  const current = readRegion(chunk)
  if (!current || !Number.isFinite(value)) {
    return { edit: null, refusal: 'not-a-number', value }
  }
  const clamped =
    control === 'begin'
      ? Math.min(Math.max(0, value), current.end - MIN_REGION_SPAN)
      : Math.max(Math.min(1, value), current.begin + MIN_REGION_SPAN)
  // A clamp that had nowhere to go (the two edges are already touching) is not
  // a trim — report it as no-change rather than writing the value back.
  if (!Number.isFinite(clamped)) return { edit: null, refusal: 'not-a-number', value }
  const before = current[control]
  // Compare the FORMATTED forms: `formatNumber` is what lands in the document,
  // so two values it renders identically are the same edit and applying one
  // would push an undo step that changes no bytes.
  if (formatNumber(clamped) === formatNumber(before)) {
    return { edit: null, refusal: 'no-change', value: clamped }
  }
  const edit = regionControlEdit(chunk, control, clamped)
  if (!edit) return { edit: null, refusal: 'not-a-number', value: clamped }
  return { edit, refusal: null, value: clamped }
}
