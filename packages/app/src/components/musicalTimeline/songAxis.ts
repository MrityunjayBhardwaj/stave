/**
 * songAxis — pixel ↔ cycle mapping for the full-song timeline (#385).
 *
 * The live window uses `timeAxis.ts` (a fixed 2-cycle wrap). The full-song
 * view instead spans `[0, displayCycles)` — the detected loop period, or the
 * analyzed horizon when no period was found (design §7.5). These helpers are
 * the seek math: the ruler click handler inverts `songCycleToX` to turn a
 * click-x into a target cycle for `runtime.seekTo` (relaxing DV-10 — the
 * playhead becomes drivable, a deliberate, logged veto revision).
 */

import { barNumber, type DisplayMeter } from '../../lib/meter'

/**
 * The stretch of song the view is currently showing (#1108).
 *
 * ── WHY ORIGIN AND SPAN TRAVEL TOGETHER ─────────────────────────────────────
 * Every helper below needs both, and they are only meaningful as a pair: a span
 * measured from the wrong origin puts every mark at the right WIDTH in the wrong
 * PLACE, which draws a plausible timeline of the wrong part of the song. Passing
 * one object makes them impossible to pass inconsistently, and makes "which
 * window is this?" a single value the view owns rather than two that have to be
 * kept in step at every call site.
 *
 * ⚠ EVERY CYCLE CROSSING THIS BOUNDARY IS SONG-ABSOLUTE — the cycle you hand to
 * `songCycleToX` and the cycle `xToSongCycle` hands back are both absolute song
 * positions, never window offsets. That is deliberate and load-bearing: scene
 * clips carry absolute cycles into the EDIT path (`SceneClip.startCycle` feeds
 * clip write-back), so a view that thought in window offsets would write edits
 * to the wrong bar. The origin is applied HERE, at the pixel boundary, and
 * nowhere else.
 */
export interface SongWindow {
  /** First cycle of the window (inclusive, song-absolute). 0 for an unpaged view. */
  readonly originCycle: number
  /** Width of the window in cycles — the span the viewport maps across. */
  readonly spanCycles: number
}

/** The window an unpaged view uses: the whole span, anchored at cycle 0. */
export function wholeSongWindow(spanCycles: number): SongWindow {
  return { originCycle: 0, spanCycles }
}

/**
 * Map a SONG-ABSOLUTE cycle to an x-pixel within `[0, width]`. The cycle is
 * clamped to the window first, so a mark outside it pins to an edge rather than
 * drawing off-canvas. Degenerate inputs (width ≤ 0, span ≤ 0, non-finite cycle)
 * map to 0.
 */
export function songCycleToX(
  cycle: number | null | undefined,
  win: SongWindow,
  width: number,
): number {
  if (cycle == null || !Number.isFinite(cycle)) return 0
  const { originCycle, spanCycles } = win
  if (width <= 0 || spanCycles <= 0) return 0
  const clamped = Math.max(originCycle, Math.min(originCycle + spanCycles, cycle))
  return songCycleToXUnclamped(clamped, win, width)
}

/**
 * `songCycleToX` WITHOUT the clamp — the raw affine map from a song-absolute
 * cycle to content-space x.
 *
 * ── WHY THE UNCLAMPED FORM IS EXPORTED ──────────────────────────────────────
 * The canvas renderer culls off-screen work by asking whether a shape's x range
 * has left the viewport, and a clamped x can never leave it: everything past the
 * window's edge would pin to that edge and draw as a sliver instead of being
 * skipped. So the renderer needs the unclamped map — but it must not reimplement
 * it, because then TWO places would know where the window starts. (They did, and
 * the renderer's copy never learned: at a window origin of 256 it placed every
 * section and clip ~2560px off-screen, so they silently stopped being drawn.)
 *
 * One origin, two exposures: clamp for seek/placement, raw for culling.
 */
export function songCycleToXUnclamped(
  cycle: number | null | undefined,
  win: SongWindow,
  width: number,
): number {
  if (cycle == null || !Number.isFinite(cycle)) return 0
  const { originCycle, spanCycles } = win
  if (width <= 0 || spanCycles <= 0) return 0
  return ((cycle - originCycle) / spanCycles) * width
}

/**
 * Inverse of `songCycleToX`: turn a click x-pixel into a SONG-ABSOLUTE target
 * cycle inside the window. Clamps x to `[0, width]` so clicks on the ruler's
 * edge padding still resolve. Returns the window origin for degenerate inputs
 * — the nearest position that is actually in view, rather than cycle 0, which
 * for a paged window is somewhere else entirely.
 */
export function xToSongCycle(
  x: number,
  win: SongWindow,
  width: number,
): number {
  const { originCycle, spanCycles } = win
  if (width <= 0 || spanCycles <= 0 || !Number.isFinite(x)) return originCycle
  const clampedX = Math.max(0, Math.min(width, x))
  const cycle = originCycle + (clampedX / width) * spanCycles
  // Keep strictly below the window end so a click on the far edge seeks to the
  // last cycle in view, not one past it (which would wrap to 0 audibly).
  return Math.min(cycle, Math.max(originCycle, originCycle + spanCycles - 1e-6))
}

/**
 * The extend/trim drag's own inverse: cursor x → the SONG-ABSOLUTE end cycle the
 * user is asking for, plus the window span that end requires.
 *
 * ── WHY THIS IS NOT `xToSongCycle` (#1203) ──────────────────────────────────
 * Two independent reasons, either of which alone rules it out:
 *
 *  1. `xToSongCycle` CLAMPS — x into `[0, width]`, and its result to just under
 *     the window end. The extend drag exists precisely to ask for a cycle PAST
 *     the current edge, which a clamped inverse can never express.
 *  2. It maps at the window's scale, which GROWS during the drag as the span
 *     extends. The trim maps at the constant rest px/cycle instead, so the
 *     dragged edge follows the cursor 1:1 with no jump as the span grows.
 *
 * So this is a THIRD exposure of the one origin, not a duplicate of the second
 * — the same shape as the clamped/unclamped split above. The alternative, doing
 * the arithmetic at the call site, is what once put the forward map's origin in
 * three places, two of which never learned about windows.
 *
 * ── WHY IT RETURNS BOTH NUMBERS ─────────────────────────────────────────────
 * `endCycle` is a POSITION — song-absolute, compared against
 * `SceneClip.startCycle` and written back as a clip weight. `spanCycles` is a
 * LENGTH — window-relative, feeding the drag-aware content width. They are one
 * measurement seen from either side of the origin, and deriving them separately
 * is exactly how they drifted: the end gained the origin while the span kept it,
 * so every extend at a non-zero origin inflated the content width by the origin.
 * Returning both from one place makes that particular drift unexpressible.
 */
export function trimExtent(params: {
  /** Cursor position in CONTENT space (viewport x + scrollLeft). */
  contentX: number
  /** The CONSTANT rest px/cycle — deliberately not the drag-aware scale. */
  pxPerCycle: number
  /** First cycle of the displayed window (song-absolute). */
  originCycle: number
  /** Lowest end cycle this drag may produce (song-absolute). */
  floorCycle: number
  /** Room kept past the dragged edge so there is somewhere to drag into. */
  marginCycles: number
  /** The span never shrinks below this (the current loop/display span). */
  minSpanCycles: number
}): { endCycle: number; spanCycles: number } {
  const { contentX, pxPerCycle, originCycle, floorCycle, marginCycles, minSpanCycles } = params
  if (!(pxPerCycle > 0) || !Number.isFinite(contentX)) {
    return { endCycle: floorCycle, spanCycles: minSpanCycles }
  }
  const endCycle = Math.max(floorCycle, originCycle + Math.round(contentX / pxPerCycle))
  return {
    endCycle,
    spanCycles: Math.max(minSpanCycles, endCycle - originCycle + marginCycles),
  }
}

/**
 * Wrap a monotonically-increasing song position into the `[0, displayCycles)`
 * display range. The transport clock keeps advancing after a seek; the
 * full-song playhead shows the within-loop position.
 *
 * ── WHY `looping` IS A PARAMETER AND NOT AN ASSUMPTION (#1105) ───────────────
 * The modulo is only meaningful when `displayCycles` IS a loop: cycle 257 of an
 * 8-cycle song really does sound like cycle 1, so drawing it at the left edge is
 * true. When the span is instead the point where period detection gave up (the
 * 256-cycle cap — `SongAnalysis.displaySpan.kind === 'capped'`), there is no loop
 * and the modulo asserts a repeat that does not exist — the playhead would jump
 * to the left
 * edge and retrace material the transport has long since passed. Measured: 27 of
 * the 32 single-lane aperiodic corpus documents have no structural period even
 * with every shaping dimension removed, so this is the common case for them, not
 * a corner.
 *
 * Past the span with `looping: false` the honest answer is that the playhead is
 * NOT IN THIS VIEW — hence `null`, the same value every other "nothing to draw"
 * path already returns, so callers need no new branch. Parking it at the right
 * edge was the alternative and was rejected: it states a position the transport
 * does not have, which is the same class of falsehood in a quieter voice.
 *
 * The flag is REQUIRED rather than defaulting to `true`. A default would let a
 * new caller inherit the wrap silently, which is exactly how the assumption
 * became invisible in the first place; every caller now says which it means.
 *
 * ── AND WHY IT NOW TAKES A WINDOW (#1108) ───────────────────────────────────
 * With paging, "past the span" and "before the span" are both possible, and both
 * mean the same thing: the playhead is not in this view. A position of cycle 100
 * while the window shows `[256, 512)` is a transport the user has paged AHEAD
 * of — pinning it to the left edge would state a position the transport does not
 * have, which is the same falsehood this function was rewritten to remove.
 *
 * The returned position is SONG-ABSOLUTE, like everything else crossing this
 * boundary; `songCycleToX` applies the origin.
 */
export function wrapSongPosition(
  songPosition: number | null | undefined,
  win: SongWindow,
  looping: boolean,
): number | null {
  if (songPosition == null || !Number.isFinite(songPosition)) return null
  const { originCycle, spanCycles } = win
  if (spanCycles <= 0) return null
  if (!looping) {
    // A negative clock reading is a transport that has not started rather than a
    // real song position, so it clamps to 0 first (#1105 chose 0 over wrapping
    // to the tail). Then the only question is whether it lands in THIS window.
    const pos = Math.max(0, songPosition)
    return pos >= originCycle && pos < originCycle + spanCycles ? pos : null
  }
  const wrapped = (songPosition - originCycle) % spanCycles
  return originCycle + (wrapped < 0 ? wrapped + spanCycles : wrapped)
}

// ── Zoom (#412) ────────────────────────────────────────────────────────────
//
// zoom = 1 fits the whole loop to the viewport (the existing fit-to-width
// default). zoom > 1 widens the content (`contentWidth = viewportWidth * zoom`)
// past the viewport, revealing a horizontal scrollbar. All the cycle↔pixel
// helpers above are width-agnostic, so the view simply passes `contentWidth`
// where it used to pass the raw viewport width.

/** Minimum zoom — fit the whole song to the viewport. */
export const MIN_ZOOM = 1
/** Maximum zoom — far enough to inspect individual cycles on a long song. */
export const MAX_ZOOM = 64
/** Multiplier per zoom-button press / wheel notch. */
export const ZOOM_STEP = 1.5

/** Clamp a zoom factor to `[MIN_ZOOM, MAX_ZOOM]`; non-finite → MIN_ZOOM. */
export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return MIN_ZOOM
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom))
}

/** Ceiling for the zoom *restored from the persisted camera* on load (#505).
 *  The camera (#501) can store any zoom up to MAX_ZOOM, but restoring an extreme
 *  zoom drops the user straight onto a center-locked playhead — the song scrolls
 *  beneath a pinned playhead, which can read as frozen on a fresh load until the
 *  scrolling lanes are noticed. Landing at most this far in keeps the playhead
 *  visibly gliding across the viewport on play. Tunable; 4 = 400%. */
export const MAX_RESTORE_ZOOM = 4

/** Clamp a zoom *restored from persistence* to `[MIN_ZOOM, MAX_RESTORE_ZOOM]`;
 *  non-finite → MIN_ZOOM. Used only on load (#505) — live zoom (buttons/wheel)
 *  still spans the full `clampZoom` range up to MAX_ZOOM. */
export function clampRestoreZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return MIN_ZOOM
  return Math.max(MIN_ZOOM, Math.min(MAX_RESTORE_ZOOM, zoom))
}

/** Content width at a given zoom (`viewportWidth * zoom`, never below the viewport). */
export function contentWidthFor(viewportWidth: number, zoom: number): number {
  if (viewportWidth <= 0) return 0
  return viewportWidth * Math.max(MIN_ZOOM, zoom)
}

/**
 * The new horizontal scroll offset after a zoom change that keeps the song
 * point currently under `cursorX` pinned beneath the cursor (cursor-centered
 * zoom). `cursorX` is viewport-relative (0 = left edge of the scroll area).
 * Result is clamped to the scrollable range `[0, contentWidth - viewportWidth]`.
 */
export function scrollLeftForZoom(params: {
  oldZoom: number
  newZoom: number
  scrollLeft: number
  cursorX: number
  viewportWidth: number
}): number {
  const { oldZoom, newZoom, scrollLeft, cursorX, viewportWidth } = params
  if (viewportWidth <= 0 || oldZoom <= 0 || newZoom <= 0) return 0
  const contentX = scrollLeft + cursorX // content-space x under the cursor pre-zoom
  const next = contentX * (newZoom / oldZoom) - cursorX
  const maxScroll = Math.max(0, viewportWidth * newZoom - viewportWidth)
  return Math.max(0, Math.min(maxScroll, next))
}

// ── Follow / auto-scroll (#415) ──────────────────────────────────────────────
//
// When zoomed in, the playhead can advance past the right edge of the viewport
// while playing. "Follow" mode auto-scrolls to keep it in view. This helper is
// renderer-agnostic — it only computes a target `scrollLeft` from the playhead's
// CONTENT-space x (already produced by `songCycleToX` against `contentWidth`),
// so it carries straight into the canvas view (the timeline never re-derives it).
//
// A centered dead-zone band avoids churn: while the playhead drifts within the
// band the current offset is returned unchanged (so the caller's `prev === next`
// guard short-circuits). Once it exits the band the playhead is recentered,
// clamped to the scrollable range — at the song's ends it simply pins to the
// edge (no oscillation, because the clamped target equals the clamped current).

export interface FollowOptions {
  /** Width of a centered no-scroll band as a fraction of the viewport, enabling
   *  page-follow instead of center-lock. The playhead drifts within this band
   *  without auto-scrolling, then recenters once it leaves. 0 = center-lock
   *  (recenter every step); 1 = only scroll once it leaves the viewport.
   *  Clamped to [0, 1]. Default 0 (center-lock). */
  readonly deadZone?: number
}

// Default 0 = CENTER-LOCK (#505): recenter the playhead every frame so the song
// scrolls smoothly under a fixed playhead, clamped at the ends. A band > 0 is
// opt-in Ableton-style page-follow (hold, then jump at the edge).
const DEFAULT_DEAD_ZONE = 0

/**
 * Target horizontal scroll offset that keeps the playhead within a centered
 * dead-zone band. `playheadX` is the playhead's content-space x (e.g. from
 * `songCycleToX(pos, displayCycles, contentWidth)`). Returns the (clamped)
 * current offset when the playhead is already in-band or there is nothing to
 * scroll (`contentWidth ≤ viewportWidth`), so callers can no-op on no change.
 */
export function followScrollLeft(
  playheadX: number,
  viewportWidth: number,
  contentWidth: number,
  currentScrollLeft: number,
  opts: FollowOptions = {},
): number {
  const maxScroll = Math.max(0, contentWidth - viewportWidth)
  const clampedCurrent = Math.max(0, Math.min(maxScroll, Number.isFinite(currentScrollLeft) ? currentScrollLeft : 0))
  // Nothing to scroll (not zoomed) or degenerate input → pin to a valid offset.
  if (viewportWidth <= 0 || maxScroll <= 0 || !Number.isFinite(playheadX)) return clampedCurrent
  const band = Math.max(0, Math.min(1, opts.deadZone ?? DEFAULT_DEAD_ZONE))
  const playheadViewportX = playheadX - clampedCurrent
  const lowEdge = viewportWidth * (0.5 - band / 2)
  const highEdge = viewportWidth * (0.5 + band / 2)
  // In-band → no churn (return the clamped current offset unchanged).
  if (playheadViewportX >= lowEdge && playheadViewportX <= highEdge) return clampedCurrent
  // Out of band → recenter the playhead, clamped to the scrollable range.
  return Math.max(0, Math.min(maxScroll, playheadX - viewportWidth / 2))
}

// ── Ruler ticks (#412) ───────────────────────────────────────────────────────

/** Upper bound on the total number of ruler ticks (majors + beats) at any zoom,
 *  so a long-horizon song can't flood the DOM with ~1k+ tick divs (#415). */
export const MAX_TICKS = 600

export interface RulerTick {
  /** Song cycle position (fractional for beat ticks). */
  readonly cycle: number
  /** Label text, or null for an unlabeled minor (beat) tick. */
  readonly label: string | null
  /** Major ticks sit on cycle/bar boundaries, draw taller, and carry a label. */
  readonly major: boolean
}

/**
 * Tick marks for the song ruler. `pxPerCycle` (= contentWidth / displayCycles)
 * drives density: majors stay ≥ ~40px apart by stepping in powers of two when
 * zoomed out, and beat subdivisions only appear once each beat clears ~14px.
 *
 * CYCLES mode → 0-indexed labels (matches Strudel cycle numbering and the cell
 *   tooltips); no beats. BARS mode → 1-indexed labels (DAW convention: bar 1 is
 *   the first bar) with beat ticks at multiples of 1/`meter.beatsPerBar`.
 */
export function rulerTicks(
  win: SongWindow,
  pxPerCycle: number,
  mode: 'cycles' | 'bars',
  meter: DisplayMeter,
): RulerTick[] {
  const { originCycle, spanCycles } = win
  if (spanCycles <= 0 || !Number.isFinite(pxPerCycle) || pxPerCycle <= 0) return []
  const MIN_MAJOR_PX = 40
  const BEAT_MIN_PX = 14
  let step = 1
  while (step * pxPerCycle < MIN_MAJOR_PX) step *= 2
  // Density cap (#415): a long song at high zoom can otherwise emit ~1k+ divs
  // (e.g. 256 cycles × 4 beats). Thin majors by powers of two until the major
  // count fits the budget, and only show beats if they fit too — so the total
  // tick count never exceeds MAX_TICKS regardless of zoom/horizon.
  while (spanCycles / step > MAX_TICKS) step *= 2
  const majorCount = Math.ceil(spanCycles / step)
  const showBeats =
    mode === 'bars' &&
    step === 1 &&
    pxPerCycle / meter.beatsPerBar >= BEAT_MIN_PX &&
    majorCount * meter.beatsPerBar <= MAX_TICKS
  const ticks: RulerTick[] = []
  // Majors land on ABSOLUTE multiples of `step`, not on offsets from the window
  // start (#1108). Anchoring to the window would relabel the same musical
  // position differently depending on where the user happened to page from, and
  // put "bar 1" in the middle of the piece. Aligning absolutely means a window
  // may open with a partial gap before its first major, which is correct: the
  // ruler describes the song, not the viewport.
  const first = Math.ceil(originCycle / step) * step
  const end = originCycle + spanCycles
  for (let c = first; c < end; c += step) {
    ticks.push({ cycle: c, label: mode === 'bars' ? String(barNumber(c)) : String(c), major: true })
    if (showBeats) {
      for (let b = 1; b < meter.beatsPerBar; b++) {
        ticks.push({ cycle: c + b / meter.beatsPerBar, label: null, major: false })
      }
    }
  }
  return ticks
}
