/**
 * meter — the one place Stave writes down how a cycle is divided for display
 * (#1565), and the arithmetic every readout of bars, beats and BPM goes through
 * (#1568).
 *
 * ⚠ THIS IS A VIEW OVER CYCLES, NOT SOMETHING THE ENGINE ENFORCES. Strudel has
 * no fixed meter: one cycle is one bar, and everything below is the DAW-shaped
 * reading we draw on top of that. Nothing here changes what the engine plays.
 *
 * ── WHY IT IS A MODULE AND NOT A CONSTANT IN THE TIMELINE ────────────────────
 * "Four beats to the bar" used to be written down four times — `BEATS_PER_CYCLE`
 * in `timeAxis`, `BEATS_PER_BAR` in `songAxis`, a bare `4` in the transport
 * readout's bar digit, and a pre-multiplied factor in its BPM digit — with no
 * import between any of them. They agreed only because every one of them was 4,
 * and the first time signature that is not 4/4 is exactly the change that makes
 * them disagree: a readout saying *beat 3* over a ruler drawn in 3/4 is worse
 * than no time signature at all, because it looks authoritative.
 *
 * So the meter lives above both timeline folders, where the menubar can read it
 * without importing the canvas. Every readout of bars, beats or BPM belongs
 * here; there is a test that fails if one is spelled anywhere else.
 *
 * ── WHY THE FUNCTIONS TAKE A METER INSTEAD OF READING ONE ────────────────────
 * The meter is a setting now, so a helper that closed over a module constant
 * would put the old bug back one level down: a consumer that forgot to thread
 * the current meter would keep drawing 4/4 and look perfectly correct until
 * somebody changed the setting. Passing it is a required argument, so an unwired
 * consumer is a type error rather than a silent disagreement.
 *
 * ── AND WHY BPM MOVES WITH THE METER, WHICH A DAW'S DOES NOT ─────────────────
 * Grounded in the manuals: Logic's tempo display *"always relates to quarter
 * notes, even if [another time signature is in use]"*, and Ableton agrees — in a
 * DAW, BPM is quarter-note BPM and does not move when the meter changes; the
 * BAR LENGTH moves instead.
 *
 * Stave cannot copy that, because here the bar length is not free: one cycle is
 * one bar and `cps` fixes how long that is. A view setting cannot change it. So
 * the UNIT is kept (BPM means quarter notes) and the NUMBER moves:
 *
 *     BPM = quarters per bar × 60 × cps = beatsPerBar × (4 / beatUnit) × 60 × cps
 *
 * Read the right way round it is not strange. The bar is two seconds either way;
 * the meter is the user's declaration of how many quarter notes they are calling
 * that bar. Declare three instead of four and each one is longer — and a longer
 * quarter note is a slower quarter-note BPM. The music does not change; the
 * reading of it does.
 */

/** Default beats per bar. 4 is the universal DAW default. */
export const BEATS_PER_BAR = 4

/** Default beat unit — the note value that gets one beat (4 = a quarter). */
export const BEAT_UNIT = 4

/** Ticks in one beat — the third digit of the transport readout (sixteenths). */
export const TICKS_PER_BEAT = 4

/**
 * A time signature, as a view over cycles.
 *
 * `beatsPerBar` is the numerator and drives everything geometric: the ruler's
 * beat ticks, the lane beat grid, the readout's beat digit. `beatUnit` is the
 * denominator and drives nothing geometric at all — 6/8 and 6/4 draw the same
 * six subdivisions, because the bar is one cycle either way. It is not
 * decoration though: it is what makes the BPM readout mean quarter notes.
 */
export interface DisplayMeter {
  readonly beatsPerBar: number
  readonly beatUnit: number
}

/** 4/4 — what every readout used to hard-code. */
export const DEFAULT_METER: DisplayMeter = {
  beatsPerBar: BEATS_PER_BAR,
  beatUnit: BEAT_UNIT,
}

/** Beat units Stave offers, matching the denominators Ableton accepts. */
export const BEAT_UNITS: readonly number[] = [1, 2, 4, 8, 16]

/** Most beats per bar Stave will draw — past this the grid is a smear and the
 *  readout's single beat digit stops fitting. */
export const MAX_BEATS_PER_BAR = 16

/**
 * Coerce arbitrary input into a meter Stave can draw. Out-of-range or
 * non-integer values fall back to the default rather than throwing: this sits
 * behind a text/number input, and a half-typed `1` on the way to `12` must not
 * take the ruler down with it.
 */
export function normalizeMeter(beatsPerBar: number, beatUnit: number): DisplayMeter {
  const beats =
    Number.isInteger(beatsPerBar) && beatsPerBar >= 1 && beatsPerBar <= MAX_BEATS_PER_BAR
      ? beatsPerBar
      : BEATS_PER_BAR
  const unit = BEAT_UNITS.includes(beatUnit) ? beatUnit : BEAT_UNIT
  return { beatsPerBar: beats, beatUnit: unit }
}

/** `3/4` — the way a musician writes the meter down. */
export function formatMeter(meter: DisplayMeter): string {
  return `${meter.beatsPerBar}/${meter.beatUnit}`
}

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
 * Meter-independent, and that is the whole point of the fixed bar: whatever the
 * time signature, bar N is cycle N-1.
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
 * Beat is the whole beat the position sits in (`meter.beatsPerBar` of them per
 * bar); tick subdivides that beat `TICKS_PER_BEAT` ways. Total for the same
 * reason `barNumber` is.
 */
export function barBeatTick(cycle: number, meter: DisplayMeter): BarBeatTick {
  if (!Number.isFinite(cycle) || cycle < 0) return { bar: 1, beat: 1, tick: 1 }
  const beatPos = (cycle % 1) * meter.beatsPerBar
  return {
    bar: barNumber(cycle),
    beat: Math.floor(beatPos) + 1,
    tick: Math.floor((beatPos % 1) * TICKS_PER_BEAT) + 1,
  }
}

/**
 * How many quarter notes the user is declaring this bar to hold — the bridge
 * between a meter and a tempo anybody else would recognise. 4/4 → 4, 3/4 → 3,
 * 6/8 → 3, 6/4 → 6.
 */
export function quartersPerBar(meter: DisplayMeter): number {
  return meter.beatsPerBar * (4 / meter.beatUnit)
}

/**
 * Cycles-per-second → quarter-note BPM, rounded for display. `null` /
 * non-finite → `null`, so the caller chooses whether to render a fallback or
 * hide the segment.
 *
 * One cycle is one bar, so a bar lasts `1 / cps` seconds and holds
 * `quartersPerBar(meter)` quarter notes. See the module header for why this
 * moves with the meter when a DAW's would not.
 */
export function cpsToBpm(cps: number | null | undefined, meter: DisplayMeter): number | null {
  if (cps == null || !Number.isFinite(cps)) return null
  return Math.round(cps * 60 * quartersPerBar(meter))
}
