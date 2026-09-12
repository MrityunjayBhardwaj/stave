/**
 * timeAxis — pure cycle ↔ pixel math + bar/beat formatting for the
 * MusicalTimeline (slice β). The meter those bars and beats are read in,
 * and the cps→BPM conversion that used to live here, belong to
 * `lib/meter` — one owner for every readout in the app (#1565).
 *
 * Every helper is total: null / NaN / non-finite inputs map to a safe
 * default (0 px, empty string) so the React render path never sees `NaN`
 * in `style.left`. Trap 3 (CONTEXT) — `runtime.getCurrentCycle()`
 * legitimately returns `null` when the engine is stopped.
 *
 * PV28 (load-bearing): `event.begin` is ALREADY in post-collect cycle
 * coordinates. `Fast(n, body)` events are emitted by `collect()` at their
 * post-Fast positions (e.g., `s("bd*4")` in 1 cycle → events at 0, 0.25,
 * 0.5, 0.75). `eventToRect` reads `event.begin` AS-IS and applies a
 * straight linear map across the WINDOW_CYCLES span. No Fast-aware
 * transformation here; that would double-apply the rate.
 *
 * Trap NEW-3 (cycle wrap): `cycleToPlayheadX` uses `cycle % WINDOW_CYCLES`
 * — an explicit modulo at the wrap point. The playhead JUMPS from the
 * right edge to the left edge at the cycle boundary; do NOT interpolate
 * the cycle value across the wrap or you get a backwards sweep across
 * the whole grid.
 *
 * Phase 20-01 PR-B (DB-04, DB-06).
 */

import type { IREvent } from '@stave/editor'

import { BEATS_PER_BAR, barNumber } from '../../lib/meter'

/** 2-cycle window (D-05). Slice β fixed; pan/zoom is a follow-up. */
export const WINDOW_CYCLES = 2

/** Minimum visible note-block width in px (D-05). Events shorter than
 *  this still render at 4 px so the user can see + hover them; the
 *  tooltip carries the exact duration. */
export const MIN_BLOCK_PX = 4

export interface TimeAxisOpts {
  /** Pixels available for the WINDOW_CYCLES span. Drawer-resize-driven
   *  via the component's ResizeObserver (DB-04). */
  readonly gridContentWidth: number
}

/**
 * Map an `IREvent` to a `{ x, w }` rectangle in pixels relative to the
 * grid content's left edge.
 *
 * - x clamps to [0, gridContentWidth] when `event.begin` is negative
 *   (defensive — collect() shouldn't produce negative begins) or past
 *   WINDOW_CYCLES (events past the right edge are clipped, not wrapped).
 * - w is at least `MIN_BLOCK_PX` and clipped to fit inside the grid.
 *
 * PV28: `event.begin` / `event.end` are read AS-IS — no Fast-aware
 * transform.
 */
export function eventToRect(
  event: Pick<IREvent, 'begin' | 'end'>,
  opts: TimeAxisOpts,
): { readonly x: number; readonly w: number } {
  const width = Math.max(0, opts.gridContentWidth)
  if (width === 0) return { x: 0, w: MIN_BLOCK_PX }

  const begin = Number.isFinite(event.begin) ? event.begin : 0
  const end = Number.isFinite(event.end) ? event.end : begin

  // Clamp begin to [0, WINDOW_CYCLES]. Defensive — should never trip.
  const clampedBegin = Math.max(0, Math.min(WINDOW_CYCLES, begin))
  const clampedEnd = Math.max(clampedBegin, Math.min(WINDOW_CYCLES, end))

  const pxPerCycle = width / WINDOW_CYCLES
  const x = clampedBegin * pxPerCycle
  const rawW = (clampedEnd - clampedBegin) * pxPerCycle
  // MIN_BLOCK_PX so a zero-duration trigger still appears.
  let w = Math.max(MIN_BLOCK_PX, rawW)
  // Clip to grid right edge so a note that crosses the window doesn't
  // render off-canvas (it just visually truncates).
  if (x + w > width) w = Math.max(MIN_BLOCK_PX, width - x)
  return { x, w }
}

/**
 * Cycle position → playhead x in pixels.
 *
 * - `cycle === null | undefined` → `0` (engine stopped or non-Strudel
 *   runtime; D-08 / Trap 3).
 * - `Number.isFinite(cycle) === false` → `0` (NaN guard).
 * - Negative cycle → `0` (defensive; spec says playhead never < 0).
 * - Wraps at `WINDOW_CYCLES` via explicit `%`. At cycle 1.99 the
 *   playhead is near the right edge; at 0.01 (post-wrap) it's near the
 *   left edge — the visual jump IS the spec (Trap NEW-3).
 */
export function cycleToPlayheadX(
  cycle: number | null | undefined,
  opts: TimeAxisOpts,
): number {
  if (cycle == null || !Number.isFinite(cycle)) return 0
  if (cycle < 0) return 0
  const width = Math.max(0, opts.gridContentWidth)
  if (width === 0) return 0
  // `cycle % WINDOW_CYCLES` is safe for non-negative; explicit re-modulo
  // handles the (cycle === 0) case correctly returning 0 not NaN.
  const wrapped = ((cycle % WINDOW_CYCLES) + WINDOW_CYCLES) % WINDOW_CYCLES
  return (wrapped / WINDOW_CYCLES) * width
}

/**
 * Format a cycle number as a musician-facing "bar N / beat M.MM"
 * string. `null` / non-finite returns `''` (empty) — caller decides
 * whether to render a fallback like `STOPPED_STATUS_COPY`.
 *
 * Bar is 1-indexed (musicians count from 1); beat is 1-indexed within
 * the bar and goes up to (but not including) `BEATS_PER_BAR + 1`. Both
 * readings come from `lib/meter`, which owns the display meter (#1565) —
 * this is a FRACTIONAL beat, which is why it reads the constant rather
 * than calling `barBeatTick`.
 *
 * Examples (BEATS_PER_BAR = 4):
 *   - 0     → 'bar 1 / beat 1.00'
 *   - 0.5   → 'bar 1 / beat 3.00'
 *   - 1.0   → 'bar 2 / beat 1.00'
 *   - 1.5   → 'bar 2 / beat 3.00'
 */
export function formatBarBeat(cycle: number | null | undefined): string {
  if (cycle == null || !Number.isFinite(cycle)) return ''
  const safeCycle = cycle < 0 ? 0 : cycle
  const beat = (safeCycle % 1) * BEATS_PER_BAR + 1
  return `bar ${barNumber(safeCycle)} / beat ${beat.toFixed(2)}`
}
