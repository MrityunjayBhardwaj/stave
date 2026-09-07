/**
 * structuralWalk — the "keep" half of the collect.ts split (#945).
 *
 * `collect.ts` conflates two jobs: deriving lane STRUCTURE from source spans, and computing
 * BEHAVIOUR (onsets) by re-implementing Strudel's RNG / euclid / weighting. The split moves
 * behaviour to Strudel's own `queryArc` and keeps structure here — because the lane anchors
 * (`dollarPos` / `leafIndex` / `armIndex`) are sourced from source-span structure, which haps
 * do not carry, so haps must JOIN to a structural walk rather than replace it. See
 * `COLLECT-SPLIT-AUDIT.md` for the consumer map and `collect.ts:486/651/745` for where the
 * anchors are set today.
 *
 * This walk owns two properties the hap stream cannot give:
 *   1. the anchors above (lane / voice-row / clip identity from source position); and
 *   2. per-node resilience — a syntactically-valid but semantically-invalid sub-node (an
 *      unresolved binding, a mid-edit) degrades only its own lane, where `evaluate` throws and
 *      blanks everything. The timeline's lane skeleton must survive mid-edit code.
 *
 * Phase 1 (#973) IMPLEMENTS the seam by mirroring collect's ANCHOR threading (Track → dollarPos
 * outer-wins + leafIndex reset; voice-Stack → sequential leafIndex; Arrange/Cycle → per-cycle
 * arm selection) and its `withWrapperLoc` loc-layering, while DROPPING the behaviour (timing,
 * window-clip, RNG, euclid). It emits one structural item per leaf reached, then aggregates to
 * per-lane skeletons with the SAME first-wins rules `timelineMarks.ts` applies to collect's
 * events — so `aggregateLaneItems` is shared with the gate's oracle and the two cannot drift.
 *
 * A structural walk reaches leaves collect's onset/window logic would drop, so structuralWalk
 * may report ADDITIONAL lanes (the resilience it adds). For every lane collect DOES produce,
 * the anchors match byte-for-byte — proven over the corpus by `structuralWalk.test.ts`.
 */
import type { PatternIR } from './PatternIR'
import type { SourceLocation } from './IREvent'

/**
 * One lane of the timeline, described purely by SOURCE STRUCTURE — no onsets, no timing.
 * Marks (which notes play, and when) are joined on later from `queryArc` haps by source-span
 * containment (Phase 2, #974). Every offset is a char position into the evaluated source.
 *
 * Mirrors the per-lane maps `timelineMarks.ts` builds today from the event stream
 * (`labelOffsetByLane` / `sourceByLane` / `arrangeByLane` / `armByCycleByLane` /
 * `armLabelByLane`) — but produced directly from the IR, not reduced from onsets.
 */
export interface LaneSkeleton {
  /** Lane identity — the same key `laneKeyOf` derives, so hap attribution and the structural
   *  walk agree on which lane is which. */
  laneKey: string
  /** `$:`/`bass:` statement offset — the label anchor (`dollarPos`; `collect.ts:486`). Absent
   *  for a hand-built or single-expression IR with no statement. */
  dollarPos?: number
  /** Innermost content anchor — the leaf/mini offset used for expand→bind (the first-event
   *  `loc[0].start` `sourceByLane` keeps today). */
  sourceOffset?: number
  /** Outermost combinator offset — the `arrange`/`cat` call start used for clip gestures
   *  (`arrangeByLane`; excludes the `$:` wrapper loc per #456). */
  arrangeOffset?: number
  /** Voice-row index within a `stack(...)` (`leafIndex`; `collect.ts:651`). Absent for a
   *  single-voice lane. */
  leafIndex?: number
  /** Active arrange arm (clip) per integer cycle (`armByCycleByLane`). Absent for a lane with
   *  no arrangement combinator. Length == the window's `spanCycles`, and index 0 is the
   *  window's `originCycle` — WINDOW-RELATIVE, the same deliberate asymmetry
   *  `LaneActivity.onsetsByCycle` carries (an array cannot be indexed from 256 without wasting
   *  the prefix). Every cycle the consumer then PUBLISHES is song-absolute, so the one place
   *  that adds the origin back is the clip run-length encoder in `timelineMarks`. */
  armByCycle?: Array<number | undefined>
  /** Arm index → its display label (first arm event's sample/note; `armLabelByLane`). */
  armLabels?: Map<number, string>
  /** Arm index → the `[n, pat]` tuple's source range (#1391). The consumer slices
   *  the user's code at it to resolve the section's NAME. */
  armRanges?: Map<number, readonly [number, number]>
}

/**
 * A single structural leaf hit — the raw input to `aggregateLaneItems`. Both structuralWalk
 * (from the IR) and the gate's oracle (from collect's `IREvent[]`) produce these, so the
 * per-lane reduction is byte-identical by construction.
 */
export interface LaneItem {
  laneKey: string
  /** Integer cycle this leaf was reached in (`floor(begin)` for a collect event). */
  cycle: number
  dollarPos?: number
  leafIndex?: number
  armIndex?: number
  loc?: readonly SourceLocation[]
  /** `s ?? String(note)` — the arm-label source (`armLabelByLane`). */
  labelValue?: string
  /** SOURCE RANGE of the arrange arm this leaf plays under — the `[n, pat]`
   *  tuple's `[start, end)` (#1391). Carries the arm's own provenance out of the
   *  walk so a consumer can read the SECTION NAME off the source, the way
   *  `dollarPos` lets it read a track's label. Absent when the arm has no `loc`
   *  (hand-built fixtures) or the leaf plays under no arrangement. */
  armRange?: readonly [number, number]
}

/**
 * The stretch of song a walk covers (#1209).
 *
 * ── WHY ORIGIN AND SPAN TRAVEL AS ONE VALUE ─────────────────────────────────
 * They are both bare cycle counts, so as two positional arguments a swap
 * type-checks and yields a plausible skeleton of the wrong part of the song —
 * the exact failure this parameter was added to prevent, reintroduced through
 * argument order instead of omission. Bundled, it cannot be written.
 *
 * Structurally identical to the view's `SongWindow`, deliberately: the app hands
 * its own window straight in, with no adapter and nothing to keep in step.
 */
export interface WalkWindow {
  /** First cycle of the window (inclusive, song-absolute). */
  readonly originCycle: number
  /** Width of the window in cycles. */
  readonly spanCycles: number
}

/** The window a whole-song walk uses: `[0, nCycles)`. Named rather than written
 *  as an object literal at each caller so "this one really is the whole song"
 *  is a statement instead of two numbers that happen to start at zero. */
export function wholeWalkWindow(nCycles: number): WalkWindow {
  return { originCycle: 0, spanCycles: nCycles }
}

/** Normalise a window to whole, non-negative cycles — one definition, so the leaf walk and
 *  the aggregation can never disagree about which cycles the window contains. */
function normalizeWindow(window: WalkWindow): { origin: number; span: number } {
  const origin = Math.max(0, Math.floor(Number.isFinite(window.originCycle) ? window.originCycle : 0))
  const span = Math.max(0, Math.floor(Number.isFinite(window.spanCycles) ? window.spanCycles : 0))
  return { origin, span }
}

/**
 * Reduce raw leaf items to per-lane skeletons, first-seen lane order, FIRST-WINS on every
 * anchor — the exact reduction `timelineMarks.ts:133-200` runs over collect's events. Shared
 * between structuralWalk and the corpus gate's oracle so neither can drift from the other.
 *
 * `armByCycle` is sized and indexed against `window`: slot `i` is song cycle
 * `originCycle + i`. An item outside the window is dropped rather than clamped.
 */
export function aggregateLaneItems(items: readonly LaneItem[], window: WalkWindow): LaneSkeleton[] {
  const { origin: originCycle, span: nCycles } = normalizeWindow(window)
  const order: string[] = []
  const byKey = new Map<string, LaneSkeleton>()
  const armByCycle = new Map<string, Array<number | undefined>>()
  const armLabels = new Map<string, Map<number, string>>()
  const armRanges = new Map<string, Map<number, readonly [number, number]>>()

  for (const it of items) {
    let lane = byKey.get(it.laneKey)
    if (!lane) {
      lane = { laneKey: it.laneKey }
      byKey.set(it.laneKey, lane)
      order.push(it.laneKey)
    }
    // FIRST-WINS anchors (mirrors sourceByLane / labelOffsetByLane / arrangeByLane / leafIndex).
    if (lane.dollarPos === undefined && it.dollarPos !== undefined) lane.dollarPos = it.dollarPos
    if (lane.sourceOffset === undefined && it.loc && it.loc.length > 0) {
      const s = it.loc[0]?.start
      if (typeof s === 'number' && Number.isFinite(s)) lane.sourceOffset = s
    }
    if (lane.arrangeOffset === undefined && it.loc && it.loc.length > 0) {
      let outer: number | undefined
      for (const l of it.loc) {
        const s = l?.start
        if (typeof s !== 'number' || !Number.isFinite(s)) continue
        // Skip the `$:` Track-wrapper loc (#456): it starts before every combinator.
        if (it.dollarPos !== undefined && s === it.dollarPos) continue
        if (outer === undefined || s < outer) outer = s
      }
      if (outer !== undefined) lane.arrangeOffset = outer
    }
    if (lane.leafIndex === undefined && it.leafIndex !== undefined) lane.leafIndex = it.leafIndex
    // Arrange clips: per-cycle arm index + per-arm label. Only lanes carrying an armIndex.
    if (typeof it.armIndex === 'number') {
      let byCycle = armByCycle.get(it.laneKey)
      if (!byCycle) {
        byCycle = new Array<number | undefined>(nCycles)
        armByCycle.set(it.laneKey, byCycle)
      }
      // `it.cycle` is a song-ABSOLUTE output cycle; the array is window-relative.
      const slot = it.cycle - originCycle
      if (slot >= 0 && slot < nCycles) byCycle[slot] = it.armIndex
      let labels = armLabels.get(it.laneKey)
      if (!labels) {
        labels = new Map()
        armLabels.set(it.laneKey, labels)
      }
      if (!labels.has(it.armIndex) && it.labelValue != null) labels.set(it.armIndex, it.labelValue)
      if (it.armRange !== undefined) {
        let ranges = armRanges.get(it.laneKey)
        if (!ranges) {
          ranges = new Map()
          armRanges.set(it.laneKey, ranges)
        }
        if (!ranges.has(it.armIndex)) ranges.set(it.armIndex, it.armRange)
      }
    }
  }

  return order.map((key) => {
    const lane = byKey.get(key) as LaneSkeleton
    const byCycle = armByCycle.get(key)
    if (byCycle) lane.armByCycle = byCycle
    const labels = armLabels.get(key)
    if (labels) lane.armLabels = labels
    const ranges = armRanges.get(key)
    if (ranges) lane.armRanges = ranges
    return lane
  })
}

/** Structural context — the anchor-carrying subset of collect's `CollectContext` (no
 *  time/duration/speed/window).
 *
 *  Two distinct cycle notions, which MUST NOT be conflated (the multitrack-arrange bug #974):
 *  - `cycle` is the SELECTION cycle — it descends into nested Arrange/Cycle arms (localCycle) so
 *    an inner combinator picks its own arm, mirroring Strudel's slowcat-local time.
 *  - `outputCycle` is the OUTER SONG cycle — constant for one top-level walk, and the cycle a
 *    reached leaf is BUCKETED under (collect's `floor(begin)`). `armByCycle` indexes by this, so
 *    an arrange arm spanning cycles 4–7 lands on 4–7, not on its arm-local 0–3.
 */
interface StructCtx {
  cycle: number
  outputCycle: number
  trackId?: string
  dollarPos?: number
  leafIndex?: number
  armIndex?: number
  /** Source range of the arm `armIndex` refers to (#1391). Travels WITH
   *  `armIndex` and follows the same outermost-wins rule — a nested `arrange`
   *  keeps the outer arm's identity, so it must keep the outer arm's name too,
   *  or the clip would be captioned by a section it is not a section of. */
  armRange?: readonly [number, number]
  params: Record<string, number | string>
}

/** Append a wrapper node's loc[0] to each item's loc array, innermost-first — the structural
 *  mirror of collect's `withWrapperLoc` (collect.ts:106). */
function withWrapperLoc(items: LaneItem[], wrapper?: PatternIR['loc']): LaneItem[] {
  if (!wrapper || wrapper.length === 0) return items
  const range = wrapper[0]
  return items.map((it) => ({ ...it, loc: it.loc ? [...it.loc, range] : [range] }))
}

/**
 * The source range of the section a `NamedPick`'s selector has landed on (#1467) —
 * its object key, which is where the musician wrote the name.
 *
 * The join is the KEY STRING, not the slot number. A selector slot holds the key
 * as its `Play.note` (an `Elongate` wraps it when the slot carries a weight), and
 * `NamedPickEntry.key` is that same normalized string — so the two are matched by
 * name. Slot order and object order are independent, and a returning section
 * appears in several slots pointing at ONE entry, which is exactly the behaviour
 * wanted: both slots caption with the name that entry was written under.
 *
 * `undefined` on anything that isn't a plain named slot — an unresolved selector,
 * a slot whose body isn't a `Play`, a key with no entry, or an entry parsed
 * without a `keyLoc`. The caller then leaves `armRange` unset and the section
 * keeps its positional `§n`, which is the same answer it gives today.
 */
function selectedEntryRange(
  ir: Extract<PatternIR, { tag: 'NamedPick' }>,
  selectedArm: number | undefined,
): readonly [number, number] | undefined {
  if (selectedArm === undefined) return undefined
  const slot = ir.selector.tag === 'Cycle' ? ir.selector.items[selectedArm] : undefined
  if (!slot) return undefined
  const body = slot.tag === 'Elongate' ? slot.body : slot
  if (!body || body.tag !== 'Play' || typeof body.note !== 'string') return undefined
  const keyLoc = ir.entries.find((e) => e.key === body.note)?.keyLoc
  return keyLoc ? ([keyLoc.start, keyLoc.end] as const) : undefined
}

/** Count voice-leaves a subtree contributes to its Track, tolerating a malformed sub-node — a
 *  best-effort 1 keeps the leafIndex counter advancing so a bad arm degrades only itself (PV212)
 *  instead of throwing out of the Stack loop (which runs OUTSIDE `recurse`'s per-node guard). */
function safeCountLeaves(node: PatternIR): number {
  try {
    return countLeavesInIR(node)
  } catch {
    return 1
  }
}

/** Count voice-leaves a subtree contributes to its Track — mirror of collect.ts:246 so the
 *  Stack leafIndex counter advances identically. */
function countLeavesInIR(node: PatternIR): number {
  if (node.tag === 'Stack') {
    if (node.userMethod === undefined || node.userMethod === 'stack') {
      let n = 0
      for (const t of node.tracks) n += countLeavesInIR(t)
      return n
    }
    return 1
  }
  if (node.tag === 'Code' && node.via && !('literal' in node.via) && node.via.inner) {
    return countLeavesInIR(node.via.inner)
  }
  switch (node.tag) {
    case 'Param':
    case 'Fast':
    case 'Slow':
    case 'Elongate':
    case 'Late':
    case 'Degrade':
    case 'Ply':
    case 'Struct':
    case 'Swing':
    case 'Shuffle':
    case 'Scramble':
    case 'Chop':
    // #1352 — `slice` carves the BODY into ranges; the leaves are the body's,
    // exactly as for `chop`. The index pattern chooses the ORDER those leaves
    // play in, which is a projection question rather than a leaf-count one.
    case 'Slice':
    case 'When':
    case 'Every':
    case 'Loop':
    case 'Ramp':
      return countLeavesInIR(node.body)
    default:
      return 1
  }
}

/**
 * Walk the IR for one cycle, emitting a structural item per leaf reached. Anchor threading
 * mirrors collect's `walk` (collect.ts:440); timing / window-clip / RNG are dropped. Every
 * child recursion is wrapped so a throwing sub-node degrades only its branch, never the walk.
 */
function walkCycle(ir: PatternIR, ctx: StructCtx): LaneItem[] {
  const recurse = (node: PatternIR, childCtx: StructCtx): LaneItem[] => {
    try {
      return walkCycle(node, childCtx)
    } catch {
      // Per-node resilience (#945 §4): a bad sub-node blanks only itself.
      return []
    }
  }

  switch (ir.tag) {
    case 'Pure':
    case 'Signal':
    case 'Builder':
    case 'Sleep':
      return []

    case 'Track': {
      const childCtx: StructCtx = {
        ...ctx,
        trackId: ir.trackId,
        dollarPos: ctx.dollarPos !== undefined ? ctx.dollarPos : ir.loc?.[0]?.start,
        leafIndex: undefined,
      }
      return withWrapperLoc(recurse(ir.body, childCtx), ir.loc)
    }

    case 'Code': {
      if (ir.via && !('literal' in ir.via)) {
        return withWrapperLoc(recurse(ir.via.inner, ctx), ir.loc)
      }
      return []
    }

    case 'Param': {
      // Branch (a) — literal: inject the key so a leaf's laneKey/label sees it (last-wins:
      // ir.params first, ctx.params second). Branch (b) — pattern-arg: the sub-IR is a VALUE
      // provider collect never emits, and it patches non-lane fields on existing body events;
      // walk only the body for structure (the rare chained `.s("<a b>")` per-event relabel is
      // a behaviour concern the gate flags if the corpus hits it).
      if (typeof ir.value === 'string' || typeof ir.value === 'number') {
        const childCtx: StructCtx = { ...ctx, params: { [ir.key]: ir.value, ...ctx.params } }
        return withWrapperLoc(recurse(ir.body, childCtx), ir.loc)
      }
      return withWrapperLoc(recurse(ir.body, ctx), ir.loc)
    }

    case 'Play': {
      const merged = { ...ir.params, ...ctx.params }
      const s = (merged.s as string | undefined) ?? undefined
      const laneKey = ctx.trackId ?? s ?? '$default'
      const labelValue = s ?? (ir.note != null ? String(ir.note) : undefined)
      const item: LaneItem = {
        laneKey,
        // Bucket by the OUTER song cycle, not the arm-local selection cycle (#974) — armByCycle
        // must index an arrange arm at the song cycle it plays, mirroring collect's floor(begin).
        cycle: ctx.outputCycle,
        ...(ctx.dollarPos !== undefined ? { dollarPos: ctx.dollarPos } : {}),
        ...(ctx.leafIndex !== undefined ? { leafIndex: ctx.leafIndex } : {}),
        ...(ctx.armIndex !== undefined ? { armIndex: ctx.armIndex } : {}),
        ...(ir.loc && ir.loc.length > 0 ? { loc: ir.loc } : {}),
        ...(labelValue !== undefined ? { labelValue } : {}),
        ...(ctx.armRange !== undefined ? { armRange: ctx.armRange } : {}),
      }
      return [item]
    }

    case 'Seq': {
      if (ir.children.length === 0) return []
      const out: LaneItem[] = []
      for (const child of ir.children) {
        const target = child.tag === 'Elongate' ? child.body : child
        out.push(...recurse(target, ctx))
      }
      return withWrapperLoc(out, ir.loc)
    }

    case 'Stack': {
      const isVoiceDefining = ir.userMethod === undefined || ir.userMethod === 'stack'
      const out: LaneItem[] = []
      if (isVoiceDefining) {
        let leafIdx = ctx.leafIndex ?? 0
        for (const track of ir.tracks) {
          out.push(...recurse(track, { ...ctx, leafIndex: leafIdx }))
          leafIdx += safeCountLeaves(track)
        }
      } else {
        for (const track of ir.tracks) out.push(...recurse(track, ctx))
      }
      return withWrapperLoc(out, ir.loc)
    }

    case 'Choice': {
      // Structural completeness (#974): at runtime a Choice fires `then` OR `else_`, but the
      // LANE skeleton must carry both — so a mid-edit break in one branch still surfaces the
      // other's lane, and no branch's voice is invisible. Both branches usually share the body's
      // leaves (`.sometimes(x=>f(x))` ⇒ then=f(body), else_=body), so first-wins aggregation
      // dedups them to one lane with identical anchors; a genuinely divergent alternation
      // contributes both lanes (allowed resilience). collect fires one branch deterministically
      // (the gate stubs Math.random so it agrees byte-for-byte on the fired one); `then` is
      // walked first here, so first-wins keeps its anchors and the shared lane stays identical.
      const out: LaneItem[] = []
      out.push(...recurse(ir.then, ctx))
      out.push(...recurse(ir.else_, ctx))
      return withWrapperLoc(out, ir.loc)
    }

    case 'Every': {
      const fires = ctx.cycle % ir.n === 0
      if (fires) return withWrapperLoc(recurse(ir.body, ctx), ir.loc)
      if (ir.default_) return withWrapperLoc(recurse(ir.default_, ctx), ir.loc)
      return []
    }

    case 'Cycle': {
      if (ir.items.length === 0) return []
      const weights = ir.items.map((it) => (it.tag === 'Elongate' && it.factor > 0 ? it.factor : 1))
      const period = weights.reduce((s, w) => s + w, 0)
      if (period <= 0) return []
      const pos = ((ctx.cycle % period) + period) % period
      const innerCycle = Math.floor(ctx.cycle / period)
      let acc = 0
      let selected = 0
      for (let k = 0; k < ir.items.length; k++) {
        if (pos < acc + weights[k]) {
          selected = k
          break
        }
        acc += weights[k]
      }
      const item = ir.items[selected]
      const target = item.tag === 'Elongate' ? item.body : item
      return withWrapperLoc(recurse(target, { ...ctx, cycle: innerCycle }), ir.loc)
    }

    case 'Arrange': {
      if (ir.arms.length === 0) return []
      const period = ir.arms.reduce((s, a) => s + (a.weight > 0 ? a.weight : 0), 0)
      if (period <= 0) return []
      const pos = ((ctx.cycle % period) + period) % period
      let acc = 0
      let armIndex = 0
      let localCycle = 0
      for (let i = 0; i < ir.arms.length; i++) {
        const w = ir.arms[i].weight > 0 ? ir.arms[i].weight : 0
        if (pos < acc + w) {
          armIndex = i
          localCycle = pos - acc
          break
        }
        acc += w
      }
      // The arm's OWN source range — `ArrangeArm.loc` is the `[n, pat]` tuple, so
      // these bytes contain the section's name as the musician wrote it (#1391).
      //
      // ⚠ INDEX AND RANGE ARE ONE IDENTITY, SO THEY ARE INHERITED TOGETHER, on a
      // single test. Two independent `??`s would look equivalent and are not: an
      // outer arm with an index but NO `loc` would keep its index while a nested
      // arrange supplied the range, captioning the outer clip with an inner
      // section's name. Observed on a stripped parse — outer arm 0 came back
      // named `[1, a]`. Whichever arrange node names the arm names it wholly.
      const inherited = ctx.armIndex !== undefined
      const armLoc = ir.arms[armIndex].loc?.[0]
      const childCtx: StructCtx = {
        ...ctx,
        cycle: localCycle,
        armIndex: inherited ? ctx.armIndex : armIndex,
        armRange: inherited
          ? ctx.armRange
          : armLoc
            ? ([armLoc.start, armLoc.end] as const)
            : undefined,
      }
      return withWrapperLoc(recurse(ir.arms[armIndex].pattern, childCtx), ir.loc)
    }

    case 'When': {
      // Gate is behaviour; for structure walk the body (superset of gated leaves).
      return withWrapperLoc(recurse(ir.body, ctx), ir.loc)
    }

    case 'Ramp': {
      return withWrapperLoc(recurse(ir.body, { ...ctx, params: { ...ctx.params, [ir.param]: 0 } }), ir.loc)
    }

    // Single-body uniform-modifier wrappers: behaviour (timing/RNG/rearrange) drops, one
    // walk of the body suffices for lanes + loc-layering. Duplication/rearrange nodes
    // (Fast/Ply/Chop/Shuffle/Scramble) share the body's leaf loc[0], so first-wins is stable.
    case 'Fast':
    case 'Slow':
    case 'Loop':
    case 'Elongate':
    case 'Late':
    case 'Degrade':
    case 'Swing':
    case 'Ply':
    case 'Shuffle':
    case 'Scramble':
    case 'Chop':
    case 'Slice':
    case 'Struct':
      return withWrapperLoc(recurse(ir.body, ctx), ir.loc)

    case 'Chunk': {
      // Base body carries the lanes; transform is body-derived. Walk the body for structure.
      return withWrapperLoc(recurse(ir.body, ctx), ir.loc)
    }

    case 'Pick': {
      // Every lookup arm is a potential voice; discover all for the lane skeleton. The
      // selector loc + call-site layer onto each (mirrors collect's Pick loc layering).
      if (ir.lookup.length === 0) return []
      const out: LaneItem[] = []
      const selectorLoc = ir.selector.loc?.[0]
      for (const sub of ir.lookup) {
        for (const it of recurse(sub, ctx)) {
          const childLoc = it.loc ?? []
          const newLoc = [...childLoc, ...(selectorLoc ? [selectorLoc] : [])]
          out.push(newLoc.length > 0 ? { ...it, loc: newLoc } : it)
        }
      }
      return withWrapperLoc(out, ir.loc)
    }

    case 'NamedPick': {
      if (ir.entries.length === 0) return []
      // Per-cycle active arm from the weighted `<…@w>` selector (a Cycle), mirroring collect.
      let selectedArm: number | undefined
      if (ir.selector.tag === 'Cycle' && ir.selector.items.length > 0) {
        const weights = ir.selector.items.map((it) => (it.tag === 'Elongate' && it.factor > 0 ? it.factor : 1))
        const period = weights.reduce((s, w) => s + w, 0)
        if (period > 0) {
          const pos = ((ctx.cycle % period) + period) % period
          let acc = 0
          for (let k = 0; k < weights.length; k++) {
            if (pos < acc + weights[k]) {
              selectedArm = k
              break
            }
            acc += weights[k]
          }
        }
      }
      const inherited = ctx.armIndex !== undefined
      const armIndex = ctx.armIndex ?? selectedArm
      // The section's own source range — the object key it was written as (#1467).
      // `NamedPickEntry.keyLoc` has pointed at that token since #463 and nothing
      // read it, so a `{verse, chorus}` song drew `§1`/`§2` while naming its
      // sections in plain sight. The `Arrange` case above supplies the same thing
      // from the arm's `[n, pat]` tuple; this is that branch's missing half.
      //
      // ⚠ RESOLVED BY KEY, NEVER BY POSITION. `selectedArm` indexes the SELECTOR's
      // slots; `ir.entries` is in OBJECT order, and the two need not agree —
      // `"<chorus@4 verse@8>".pickRestart({verse, chorus})` maps slot 0 to
      // `entries[1]`. Indexing entries with the slot would caption a section with
      // another section's name, which is worse than the ordinal it replaces. The
      // selector slot carries the key as its own `Play.note`, which is the same
      // string `entries` is keyed by (PatternIR: "selector's STRING value keys
      // `entries`"), so that is the join.
      //
      // ⚠ INDEX AND RANGE ARE ONE IDENTITY — the `Arrange` case's rule, and it
      // binds harder here: every entry is recursed for lane discovery while they
      // ALL carry the selected slot's index, so a range taken from the entry being
      // walked would name the clip after whichever entry the loop was on.
      const armRange = inherited ? ctx.armRange : selectedEntryRange(ir, selectedArm)
      const out: LaneItem[] = []
      const selectorLoc = ir.selector.loc?.[0]
      for (const entry of ir.entries) {
        const childCtx: StructCtx = {
          ...ctx,
          ...(armIndex !== undefined ? { armIndex } : {}),
          ...(armRange !== undefined ? { armRange } : {}),
        }
        for (const it of recurse(entry.pattern, childCtx)) {
          const childLoc = it.loc ?? []
          const newLoc = [...childLoc, ...(selectorLoc ? [selectorLoc] : [])]
          out.push(newLoc.length > 0 ? { ...it, loc: newLoc } : it)
        }
      }
      return withWrapperLoc(out, ir.loc)
    }
  }
}

/**
 * Walk the IR over `[0, nCycles)` and return the RAW per-leaf items — one per
 * Play leaf reached, pre-aggregation. Anchors only, never onsets; per-node
 * resilient (a bad sub-node degrades its own branch, never the whole walk).
 *
 * The pre-aggregation items carry each leaf's OWN `loc` (aggregation collapses a
 * lane to first-wins anchors and loses per-leaf spans), so this is the shared
 * substrate for consumers that need node-level identity — `structuralWalk`
 * aggregates it into lane skeletons; `nodeIdentity.buildNodeLocIndex` indexes it
 * by leaf loc → irNodeId. Sharing one traversal means the two cannot drift.
 */
export function walkLeafItems(ir: PatternIR, nCycles: number): LaneItem[] {
  return walkLeafItemsInWindow(ir, wholeWalkWindow(nCycles))
}

/**
 * Walk the IR over `[originCycle, originCycle + spanCycles)` — the same leaf walk, started
 * where the view is actually looking (#1209).
 *
 * ⚠ NOT a prefix walk that discards its left end. Every selector in the walk is a pure
 * function of the cycle (`Arrange` picks its arm by `cycle % period`), so cycle 256 can be
 * walked without walking 0-255 first. That is what keeps a deep page's cost flat with depth,
 * the same property the banded event accessor buys on the onset side.
 */
export function walkLeafItemsInWindow(ir: PatternIR, window: WalkWindow): LaneItem[] {
  const { origin, span } = normalizeWindow(window)
  const items: LaneItem[] = []
  for (let c = origin; c < origin + span; c++) {
    try {
      items.push(...walkCycle(ir, { cycle: c, outputCycle: c, params: {} }))
    } catch {
      // A whole-cycle failure degrades that cycle only.
    }
  }
  return items
}

/**
 * Walk the IR for lane STRUCTURE over `window`. Anchors only — never computes onsets.
 * Per-node resilient: a bad sub-node degrades its own lane, never the whole walk.
 *
 * The window is REQUIRED rather than defaulted (#1209): every previous caller passed a bare
 * span and got `[0, span)`, which is correct only while nothing pages. A default would let the
 * next caller inherit that assumption silently — and at origin 0 an origin-blind walk and a
 * correct one return the same thing, so no test would ever tell them apart. Callers that
 * genuinely mean the whole song say so with `wholeWalkWindow`.
 */
export function structuralWalk(ir: PatternIR, window: WalkWindow): LaneSkeleton[] {
  return aggregateLaneItems(walkLeafItemsInWindow(ir, window), window)
}
