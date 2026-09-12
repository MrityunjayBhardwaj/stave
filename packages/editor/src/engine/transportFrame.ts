/**
 * #1570 — THE TRANSPORT FRAME: the one place the scheduler clock and the song
 * position are converted into each other.
 *
 * Two things shift time between "what the scheduler is playing" and "where the
 * user is in the song", and they must be decided together:
 *
 *  1. the SEEK offset (#384) — the pattern is wrapped `.late(transportOffset)`
 *     at the engine's `.p` seam, so the scheduler plays song-cycle
 *     `now - transportOffset` at wall-clock `now`;
 *  2. the LOOP range (#1570) — the pattern is wrapped `.ribbon(start, cycles)`
 *     at the SAME seam, so the span repeats without a re-eval per lap.
 *
 * ⚠ `ribbon` RE-BASES THE SLICE TO CYCLE 0. Measured against `@strudel/core`
 * 1.2.6 (and asserted in this module's own tests against the real pattern
 * library, not a model of it): `ribbon(1, 2)` over `a b c d` plays `b` at cycle
 * **0.00**, not 1.00. So under a loop the scheduler's clock counts LOOP-relative
 * cycles while every readout in the app — the playhead, the marks, follow-scroll,
 * the seek inversion — is song-absolute. Left unpaired, the playhead sits at the
 * start of the song while the ears hear the middle of it, and only the ears are
 * right.
 *
 * That is why this is a module and not two expressions: the wrap the engine
 * applies and the number the runtime reports are the SAME decision seen from two
 * sides, and the invariant that binds them ("the song cycle this function names
 * is the song cycle the ribboned pattern is sounding") can only be enforced
 * where both are written down. The engine applies the wraps; the runtime reads
 * the position back through here; neither one re-derives the arithmetic.
 */

/** A user-set loop span, in SONG cycles. `cycles` is a length, never an end. */
export interface LoopRange {
  readonly startCycle: number
  readonly cycles: number
}

/** Positive modulo — JS `%` keeps the sign of the dividend, which folds wrong. */
function fold(x: number, m: number): number {
  const r = x % m
  return r < 0 ? r + m : r
}

/**
 * Accept a loop range, or reject it into `null`. A range is usable only when
 * both ends are finite and the span has a positive length: a zero-length or
 * inverted range would make `ribbon` divide by zero / run backwards, and a
 * negative start would ask for song time that does not exist.
 *
 * Callers pass user input straight in — the ruler gesture can hand over a drag
 * that ended where it started, and this is the gate that turns that into "no
 * loop" rather than a wrap nobody can hear.
 */
export function normalizeLoopRange(
  range: { startCycle: number; cycles: number } | null | undefined,
): LoopRange | null {
  if (!range) return null
  const { startCycle, cycles } = range
  if (!Number.isFinite(startCycle) || !Number.isFinite(cycles)) return null
  if (cycles <= 0) return null
  if (startCycle < 0) return null
  return { startCycle, cycles }
}

/**
 * The SONG cycle sounding at scheduler clock `now`.
 *
 * Without a loop this is the #384 arithmetic unchanged: `now - transportOffset`.
 * With one it is the fold the ribbon performs, made explicit:
 * `start + ((now - transportOffset) mod cycles)`. The result is always inside
 * `[start, start + cycles)` — which is the whole point, because that is the only
 * span the ribboned pattern can sound.
 */
export function songPositionAt(
  now: number,
  transportOffset: number,
  loop: LoopRange | null,
): number {
  const offset = Number.isFinite(transportOffset) ? transportOffset : 0
  const raw = now - offset
  if (!loop) return raw
  return loop.startCycle + fold(raw, loop.cycles)
}

/**
 * The transport offset that puts song cycle `target` under the playhead at
 * scheduler clock `now` — the inverse of `songPositionAt`, and the number
 * `seekTo` hands the engine.
 *
 * Without a loop: `now - target` (#384, unchanged).
 * With one: `now - ((target - start) mod cycles)`, so the ribbon's cycle-0
 * re-base is cancelled and the sought cycle is the one that sounds.
 *
 * ⚠ DECLARED EDGE — a target OUTSIDE an armed loop is not expressible. The
 * ribboned pattern can only sound cycles inside the span, so a seek to bar 12
 * under a loop over bars 3–5 resolves to the LOOP START rather than folding to
 * some arbitrary cycle inside it. Folding would be worse than useless: it would
 * report a song position the user never asked for and could not predict. A
 * caller that wants bar 12 must clear the loop first — that is a policy decision
 * for the gesture, not arithmetic.
 */
export function transportOffsetForSeek(
  now: number,
  targetSongCycle: number,
  loop: LoopRange | null,
): number {
  if (!Number.isFinite(targetSongCycle)) return Number.isFinite(now) ? now : 0
  if (!loop) return now - targetSongCycle
  const inside = isInsideLoop(targetSongCycle, loop)
  const target = inside ? targetSongCycle : loop.startCycle
  return now - fold(target - loop.startCycle, loop.cycles)
}

/** Is this song cycle inside the loop span? Half-open: `[start, start+cycles)`. */
export function isInsideLoop(songCycle: number, loop: LoopRange | null): boolean {
  if (!loop) return false
  return songCycle >= loop.startCycle && songCycle < loop.startCycle + loop.cycles
}
