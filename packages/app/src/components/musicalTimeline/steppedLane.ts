/**
 * The geometry of a STEPPED automation on a lane (#1463 Stage 2).
 *
 * A stepped parameter holds one value per cycle and repeats with a period
 * (`steppedAutomations`, editor). Drawing it is not a curve sample: it is a
 * staircase of flat segments, one per run of cycles that play the same step. This
 * module turns an automation plus the visible cycle span into those segments, and
 * a value into a height, and nothing else — the canvas calls live in
 * `drawTimeline`, the edit in Stage 3.
 *
 * ⚠ A SEGMENT IS ONE STEP, NOT ONE VALUE. Two adjacent steps that happen to hold
 * the same number (`<0.5 0.5 0.8>`) are two segments, because they are two
 * different places in the text: a later edit to one must not look like it edits
 * the other. Merging by value would draw the same line and hand Stage 3 the wrong
 * index.
 *
 * Pure, and it imports only TYPES from `@stave/editor`. A runtime import from the
 * barrel drags a CommonJS dependency into the app's test loader and the file fails
 * to collect — so the range function is passed IN by the caller that already
 * holds the real one.
 */
import type { SteppedAutomation } from '@stave/editor'

/** The value axis a stepped lane is drawn against. */
export interface StepAxis {
  readonly lo: number
  readonly hi: number
  /** `log` for frequency controls (`cutoff`, `hcutoff`, …), as the mixer knobs are. */
  readonly scale: 'linear' | 'log'
}

/** The shape of `knobRangeFor` — injected, see the header. */
export type RangeFor = (
  method: string,
  value: number,
) => { readonly min: number; readonly max: number; readonly scale: 'linear' | 'log' }

/**
 * The axis for one stepped automation: the mixer knob's range for this control,
 * widened to hold every step the document writes.
 *
 * Asked once with the smallest step and once with the largest, because
 * `knobRangeFor` widens a KNOWN range only to the single value it is handed, and
 * derives an UNKNOWN control's range from that value alone. Asking with one step
 * would clip every other step to the axis edge — a lane that draws `0.2 → 1.4` as
 * `0.2 → 1` is drawing a document nobody wrote.
 */
export function stepAxis(a: SteppedAutomation, rangeFor: RangeFor): StepAxis {
  const values = a.steps.map((s) => s.value)
  const low = rangeFor(a.method, Math.min(...values))
  const high = rangeFor(a.method, Math.max(...values))
  const lo = Math.min(low.min, high.min)
  const hi = Math.max(low.max, high.max)
  // A log axis needs a positive floor; a document that writes 0 or less on a
  // frequency control falls back to linear rather than drawing -Infinity.
  const scale = low.scale === 'log' && lo > 0 ? 'log' : 'linear'
  return { lo, hi, scale }
}

/** Where `value` sits on the axis, 0 (floor) … 1 (ceiling), clamped. */
export function unitOnAxis(value: number, axis: StepAxis): number {
  const { lo, hi, scale } = axis
  if (!(hi > lo) || !Number.isFinite(value)) return 0
  const t =
    scale === 'log' && value > 0
      ? Math.log(value / lo) / Math.log(hi / lo)
      : (value - lo) / (hi - lo)
  return Math.min(1, Math.max(0, t))
}

/** The band a lane's automation is drawn in — the same inset and floor the curves use. */
export interface StepBand {
  readonly top: number
  readonly rowHeight: number
  readonly padY: number
  readonly minBandH: number
}

/** Canvas y of `value` on `axis` inside `band`. ONE formula, two readers — the
 *  staircase draw and the hit-test must agree about where a step sits, or a press
 *  lands one step off and edits the wrong number. */
export function stepY(value: number, axis: StepAxis, band: StepBand): number {
  const bandH = band.rowHeight - band.padY * 2
  return band.top + band.padY + (1 - unitOnAxis(value, axis)) * bandH
}

/** What a press on a stepped staircase hit. */
export interface StepHit {
  readonly entry: { readonly automation: SteppedAutomation; readonly axis: StepAxis }
  /** Index into `entry.automation.steps` — the step an edit writes. */
  readonly index: number
  /** Canvas y of that step's level, for placing an editor over it. */
  readonly y: number
}

/** How near a step's level counts as pressing it. */
export const STEP_HIT_TOLERANCE_PX = 4

/**
 * The step under a point, or null.
 *
 * `cycle` is the song-absolute cycle under the pointer (the caller inverts x with
 * the same map the ruler uses). Only the step PLAYING at that cycle can be hit —
 * the staircase has exactly one level there — and when several parameters share
 * the band the nearest level wins, so overlapping staircases stay reachable.
 *
 * ⚠ EXPANDED LANES ONLY, the rule the bounds caption already follows. A collapsed
 * row is a contour view whose whole height is contested with the clip body, and a
 * press there must keep selecting the clip it always selected.
 */
export function stepHitAt(
  entries: readonly { readonly automation: SteppedAutomation; readonly axis: StepAxis }[],
  band: StepBand,
  expanded: boolean,
  cycle: number,
  y: number,
  tolerancePx: number = STEP_HIT_TOLERANCE_PX,
): StepHit | null {
  if (!expanded || entries.length === 0 || !Number.isFinite(cycle)) return null
  if (band.rowHeight - band.padY * 2 < band.minBandH) return null
  let best: StepHit | null = null
  let bestDist = Infinity
  for (const entry of entries) {
    const a = entry.automation
    if (!(a.periodCycles > 0) || a.steps.length === 0) continue
    const [segment] = stepSegments(a, Math.floor(cycle), Math.floor(cycle) + 1)
    if (!segment) continue
    const levelY = stepY(segment.value, entry.axis, band)
    const dist = Math.abs(levelY - y)
    if (dist <= tolerancePx && dist < bestDist) {
      best = { entry, index: segment.index, y: levelY }
      bestDist = dist
    }
  }
  return best
}

/** One flat run of the staircase — a single step, over song-absolute cycles. */
export interface StepSegment {
  /** Index into `automation.steps` — the step an edit to this segment writes. */
  readonly index: number
  readonly value: number
  readonly startCycle: number
  readonly endCycle: number
}

/**
 * The segments covering `[firstCycle, lastCycle)`, in song-absolute cycles.
 *
 * Walks whole cycles, because a step is chosen per cycle (`<a b>` plays `a` for
 * all of cycle 0), and joins consecutive cycles only when they play the SAME STEP
 * — a weighted step becomes one segment across its weight. The first and last
 * segments are clipped to the requested span, so a paged window draws its own part
 * of the song and nothing outside it.
 *
 * ⚠ THE INDEX IS THE WHOLE RULE. With two or more steps, the cycle just before
 * step k begins always plays a DIFFERENT step, so "same index as the previous
 * cycle" already separates every step, including the same step met again on the
 * next pass. A second clause for "a new pass" was written, broken alone, and
 * turned nothing red — it re-stated this one. A single-step pattern (`<0.8>`) is
 * index 0 every cycle and draws as one line, which is what it sounds like, with
 * no special case.
 */
export function stepSegments(
  a: SteppedAutomation,
  firstCycle: number,
  lastCycle: number,
): StepSegment[] {
  if (!(lastCycle > firstCycle) || !(a.periodCycles > 0) || a.steps.length === 0) return []
  const period = a.periodCycles
  const posOf = (cycle: number): number => ((cycle % period) + period) % period
  const stepAt = (cycle: number): number => {
    const pos = posOf(cycle)
    for (let k = a.steps.length - 1; k >= 0; k--) if (pos >= a.steps[k].startCycle) return k
    return 0
  }
  const out: StepSegment[] = []
  for (let c = Math.floor(firstCycle); c < lastCycle; c++) {
    const index = stepAt(c)
    const start = Math.max(c, firstCycle)
    const end = Math.min(c + 1, lastCycle)
    const prev = out[out.length - 1]
    // Same step, and the previous run ends exactly where this cycle begins.
    const continues = prev !== undefined && prev.index === index && prev.endCycle === start
    if (continues) {
      out[out.length - 1] = { ...prev, endCycle: end }
    } else {
      out.push({ index, value: a.steps[index].value, startCycle: start, endCycle: end })
    }
  }
  return out
}
