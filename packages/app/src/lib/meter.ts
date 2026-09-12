/**
 * meter — the one place Stave writes down how a cycle is divided for display
 * (#1565).
 *
 * ⚠ THIS IS A VIEW OVER CYCLES, NOT SOMETHING THE ENGINE ENFORCES. Strudel has
 * no fixed meter: one cycle is one bar, and everything below is the DAW-shaped
 * reading we draw on top of that. Nothing here changes what the engine plays.
 *
 * ── WHY IT IS A MODULE AND NOT A CONSTANT IN THE TIMELINE ────────────────────
 * "Four beats to the bar" used to be written down four times — `BEATS_PER_CYCLE`
 * in `timeAxis`, `BEATS_PER_BAR` in `songAxis`, a bare `4` in the transport
 * readout's bar digit, and `cps * 240` in its BPM digit — with no import between
 * any of them. They agreed only because every one of them was 4, and the first
 * time signature that is not 4/4 is exactly the change that makes them disagree:
 * a readout saying *beat 3* over a ruler drawn in 3/4 is worse than no time
 * signature at all, because it looks authoritative.
 *
 * So the meter lives above both timeline folders, where the menubar can read it
 * without importing the canvas. Every readout of bars, beats or BPM belongs
 * here; there is a test that fails if one is spelled anywhere else.
 */

/** Beats in one bar (= one cycle). 4 is the universal DAW default. */
export const BEATS_PER_BAR = 4

/** Ticks in one beat — the third digit of the transport readout (sixteenths). */
export const TICKS_PER_BEAT = 4

/** A cycle position read as a musician reads it. Every part is 1-indexed. */
export interface BarBeatTick {
  readonly bar: number
  readonly beat: number
  readonly tick: number
}

/**
 * Cycle → bar number, 1-indexed (DAW convention: the piece starts at bar 1,
 * while Strudel's own cycle numbering starts at 0).
 *
 * Total: a non-finite or negative cycle reads as bar 1 rather than throwing or
 * producing `NaN` — these feed `textContent` and tick labels on a render path
 * that legitimately sees `null` from a stopped engine.
 */
export function barNumber(cycle: number): number {
  if (!Number.isFinite(cycle) || cycle < 0) return 1
  return Math.floor(cycle) + 1
}

/**
 * Cycle → `bar.beat.tick`, all 1-indexed — the transport readout's position.
 *
 * Beat is the whole beat the position sits in (`BEATS_PER_BAR` of them per bar);
 * tick subdivides that beat `TICKS_PER_BEAT` ways. Total for the same reason
 * `barNumber` is.
 */
export function barBeatTick(cycle: number): BarBeatTick {
  if (!Number.isFinite(cycle) || cycle < 0) return { bar: 1, beat: 1, tick: 1 }
  const beatPos = (cycle % 1) * BEATS_PER_BAR
  return {
    bar: barNumber(cycle),
    beat: Math.floor(beatPos) + 1,
    tick: Math.floor((beatPos % 1) * TICKS_PER_BEAT) + 1,
  }
}

/**
 * Cycles-per-second → BPM, rounded for display. `null` / non-finite → `null`,
 * so the caller chooses whether to render a fallback or hide the segment.
 *
 * BPM = cps × 60 sec/min × BEATS_PER_BAR beats/bar. The `240` that used to
 * appear in the readout was this product, pre-multiplied.
 */
export function cpsToBpm(cps: number | null | undefined): number | null {
  if (cps == null || !Number.isFinite(cps)) return null
  return Math.round(cps * 60 * BEATS_PER_BAR)
}
