/**
 * drawTimeline — pure canvas renderer for the Song timeline scene (#419, #422).
 *
 * Draws a `TimelineScene` against the shared content-space transform (PV116):
 * section bands, cycle gridlines, then per lane either the coarse onset DENSITY
 * (when a cycle is narrow — marks would smear sub-pixel) or readable MINI-NOTE
 * MARKS (when zoomed in). It draws in CSS pixels into the VISIBLE window only
 * (the host translates by `scrollLeft`), so the work is O(visible), not
 * O(whole song). DPR is the host's job: it scales the context before calling,
 * so this function never touches `devicePixelRatio` — which also keeps it pure
 * and testable against a recording mock context.
 *
 * Per-lane VERTICAL geometry comes from a `LaneLayout` (expand + bind, #422):
 * each lane has its own `top`/`height`, and an expanded ("accordion") lane
 * renders RICHER read-only detail — forced mini-note marks with full pitch
 * spread over the taller band, plus faint per-beat gridlines for rhythm
 * readability (design §4.5). Collapsed lanes are unchanged. The same layout
 * drives the host height, the DOM labels, and the hit-test, so nothing drifts.
 *
 * No React, no DOM, no canvas creation — just draw calls. The host
 * (`SongTimelineCanvas`) owns the surface, sizing, and dirty-flagged scheduling.
 */

import type { TimelineScene, SceneLane, SceneNote, SceneClip } from './timelineScene'
import { NO_VOICE } from './timelineScene'
import type { LaneLayout, LaneBox } from './laneLayout'
import { BEATS_PER_BAR } from '../../lib/meter'
import { songCycleToXUnclamped, type SongWindow } from './songAxis'
import type { SignalAutomation } from '@stave/editor'
import { automationColorOnLane } from './colors'
import {
  AUTOMATION_PAD_Y,
  AUTOMATION_LABEL_FONT,
  AUTOMATION_MIN_BAND_H,
  CAPTION_PAD_X,
  captionRows,
} from './automationCaption'
import { waveformColumn, waveformFit } from './waveformLane'

/** The HORIZONTAL view transform + viewport, all in CSS pixels. Vertical
 *  geometry (per-lane top/height, total height) lives in the `LaneLayout`. */
export interface DrawTransform {
  /** Horizontal scroll offset (content px hidden to the left). */
  readonly scrollLeft: number
  /** Full content width = `viewportWidth * zoom`. */
  readonly contentWidth: number
  /** Visible canvas width (CSS px). */
  readonly viewportWidth: number
}

/** Resolved literal colors (canvas can't read CSS custom properties). */
export interface DrawTheme {
  readonly background: string
  readonly rowAlt: string
  readonly section: string
  readonly sectionAlt: string
  readonly gridline: string
  /** Fill behind a read-only clip segment (#386) — a subtle translucent band so
   *  the lane's note marks stay legible on top. */
  readonly clipFill: string
  /** Border at clip boundaries (left/right edges) — makes segments read as
   *  discrete clips (design §4.2). */
  readonly clipBorder: string
  /** Section-name caption drawn inside a clip (#1391). Muted on purpose: the
   *  name identifies the section, it does not compete with the note marks the
   *  clip exists to show. */
  readonly clipCaption: string
  /** Stroke for a continuous automation curve (#1464 Stage 1). Drawn OVER the
   *  lane's marks, so it is a line rather than a fill — the marks say what plays,
   *  the curve says how a parameter moves while it does, and the two must stay
   *  separately readable. */
  readonly automationLine: string
}

/** Below this per-cycle width, individual note marks would smear sub-pixel, so
 *  the lane falls back to coarse density blocks (design §4.2 readability). */
export const COARSEN_PX = 28

/** A silenced lane (muted, or dimmed by a solo elsewhere — #731) is washed toward
 *  the canvas background by painting a background-coloured scrim at this opacity
 *  over its band, AFTER its content. The lane's marks then read at ~`1 - this`
 *  effective visibility, matching the Mixer's dimmed strip (`opacity: 0.45`) so
 *  the two views show the same "inactive" tracks (PV155). A scrim (not a real
 *  per-mark alpha) keeps the fade a single self-contained draw — the mark/density
 *  helpers stay untouched. */
export const SILENCED_LANE_SCRIM = 0.55

/**
 * A clip narrower than this draws no section caption (#1391).
 *
 * Below it there is no width for even a truncated name plus its padding, and a
 * caption clipped to one glyph is worse than none — it reads as a different
 * section's name rather than as "too narrow to say". Silence is the honest
 * degradation.
 */
export const CLIP_CAPTION_MIN_W = 34
/** Inset from the clip's left edge to the caption's first glyph. */
const CLIP_CAPTION_PAD_X = 4
/** Canvas cannot read CSS custom properties, so the mono stack is literal here.
 *  Kept in sync with the app's `--font-mono` by eye; a drift shows as a font
 *  change in the timeline only, never as a wrong name. */
const CLIP_CAPTION_FONT = '10px ui-monospace, SFMono-Regular, Menlo, monospace'

/** Minimum mark width (px) so a zero/near-zero-duration trigger still shows and
 *  stays clickable — mirrors the live view's `MIN_BLOCK_PX` (timeAxis.ts). */
export const MIN_MARK_W = 2

/**
 * Where a mark's audio shape comes from (#1506), or absent for a timeline that
 * draws marks alone — every existing caller.
 *
 * `peaksFor` is a pure LOOKUP: it reads an already-decoded, already-reduced
 * envelope and returns null for anything not yet loaded, so a draw never waits
 * on audio and never provokes a fetch. Injected rather than imported because the
 * decoded audio lives behind `@stave/editor` (the app has no superdough of its
 * own) and because it keeps this module testable with plain arrays.
 */
export interface WaveformSource {
  /** Cycles per second; null before the runtime reports a tempo. */
  readonly cps: number | null
  /** Envelope for a voice at a pitch, or null when it is not decoded yet. */
  readonly peaksFor: (
    voice: string,
    pitch: number | null,
  ) => { readonly data: Float32Array; readonly columns: number; readonly duration: number } | null
}

/**
 * Most waveform columns one whole draw may paint.
 *
 * A waveform costs a fill per column, so a lane of wide overlapping marks — a
 * dense polyphonic take at high zoom — could ask for far more fills than the
 * rest of the scene put together. Past this budget marks render as the bars they
 * already were, which is the same degradation the width and height gates use.
 * Bounded work per frame beats a timeline that stutters exactly when it is
 * showing the most detail (#900's third constraint).
 */
export const WAVEFORM_COLUMN_BUDGET = 20000

/**
 * How far the mark's own bar is washed toward the background UNDER a waveform.
 *
 * Without this the feature is invisible at full gain, and that is not a
 * hypothetical: the bar is drawn at `0.4 + 0.6 × gain` and the waveform sits
 * inside the bar's own height in the SAME lane colour, so at `gain: 1` both are
 * opaque and the shape cannot be told from the block it is drawn on. Geometry
 * tests cannot see this — they record that a fill was requested, which is a
 * different question from whether anything can be seen (#1100).
 *
 * So the bar recedes exactly where the waveform replaces it, which is also what
 * a DAW does: the clip body is furniture, the waveform is the content. Outside
 * the waveform's extent the bar keeps its full gain-driven weight, so the mark
 * still reports how loud the hit is.
 */
export const WAVEFORM_BED_SCRIM = 0.62

/** Note-bar height scales with its band — mirrors the live monitor's
 *  `leafBarHeight` (MusicalTimeline): the bar fills most of the band, reserving
 *  ~`BAR_PITCH_RESERVE`px for melodic pitch motion, floored so a tiny band still
 *  shows a mark. This is what makes resizing the timeline row-height setting grow
 *  the Song bars, just like it grows the live monitor's bars (#459). At the
 *  default row height the result is ~3px (unchanged); larger rows → taller bars. */
const BAR_PITCH_RESERVE = 12
const BAR_HEIGHT_MIN = 3
function barHeightForBand(bandHeight: number): number {
  return Math.max(BAR_HEIGHT_MIN, bandHeight - BAR_PITCH_RESERVE)
}

/** Minimum px between per-beat gridlines in an expanded lane — below this they
 *  crowd into a smear, so they're suppressed (rhythm grid only when legible). */
const BEAT_GRID_MIN_PX = 10

/**
 * Which rendering a lane uses at a given zoom. Pure + exported so the readability
 * switchover is unit-tested directly. A lane with no marks always draws density.
 * An EXPANDED lane with marks always draws marks (detail on demand overrides the
 * zoom coarsening — the user asked to see this lane's notes).
 */
export function laneRenderMode(
  pxPerCycle: number,
  hasNotes: boolean,
  expanded = false,
): 'density' | 'marks' {
  if (!hasNotes || !Number.isFinite(pxPerCycle)) return 'density'
  if (expanded) return 'marks'
  return pxPerCycle >= COARSEN_PX ? 'marks' : 'density'
}

/** Draw the whole scene into `ctx` (already DPR-scaled, in CSS px). `silenced`
 *  (by lane DISPLAY NAME — #731) fades those lanes to mirror the Mixer's dimmed
 *  strips (PV155); absent/empty → nothing faded. */
export function drawTimeline(
  ctx: CanvasRenderingContext2D,
  scene: TimelineScene,
  transform: DrawTransform,
  theme: DrawTheme,
  layout: LaneLayout,
  silenced?: ReadonlySet<string>,
  waveforms?: WaveformSource,
): void {
  const { scrollLeft, contentWidth, viewportWidth } = transform
  const height = layout.totalHeight
  ctx.clearRect(0, 0, viewportWidth, height)
  const dc = scene.displayCycles
  if (dc <= 0 || contentWidth <= 0 || viewportWidth <= 0) return

  const pxPerCycle = contentWidth / dc

  // Peaks are looked up per MARK, so a lane at the 2000-mark cap would ask the
  // same question 2000 times a frame for what is usually one answer. This memo
  // lives for exactly one draw: the envelope cache behind it is long-lived, but
  // a sample can finish decoding between two frames, and a memo that outlived
  // the frame would keep drawing "not loaded yet" after it had loaded.
  // Keyed by pitch as well as voice because a multi-sample instrument resolves
  // to a DIFFERENT FILE per note, not merely a different playback rate.
  const peaksMemo = new Map<string, ReturnType<WaveformSource['peaksFor']>>()
  const peaksFor = (voice: string, pitch: number | null) => {
    if (!waveforms) return null
    const key = `${voice}\u0000${pitch ?? ''}`
    const hit = peaksMemo.get(key)
    if (hit !== undefined) return hit
    const got = waveforms.peaksFor(voice, pitch)
    peaksMemo.set(key, got)
    return got
  }
  let waveformColumnsLeft = WAVEFORM_COLUMN_BUDGET
  // Read the tempo ONCE per draw, not once per mark. `cps` is a getter that
  // reaches the live runtime, and it was being read inside the mark loop — a
  // lane at the 2000-mark cap asked the transport for the tempo 2000 times a
  // frame to get the same answer. One frame cannot span two tempi, so there is
  // nothing to gain from asking again inside it.
  const waveformCps = waveforms?.cps ?? null

  // ONE cycle→pixel map, and it is the AXIS's. This renderer used to compute its
  // own — `(cycle / dc) * contentWidth` — which silently assumed the window
  // started at cycle 0. It stayed correct only while that was true; at an origin
  // of 256 it placed every section and clip ~2560px off-screen, so they were
  // culled and simply never drawn. The axis answers in content space (origin
  // applied); the only thing added here is the scroll offset.
  const win: SongWindow = { originCycle: scene.windowOriginCycles, spanCycles: dc }
  const toScreenX = (cycle: number): number =>
    songCycleToXUnclamped(cycle, win, contentWidth) - scrollLeft

  // ── TWO visible ranges, because the scene carries two frames ───────────────
  // The scrolled viewport picks out a stretch of the WINDOW, and that stretch has
  // two names. As density INDICES it addresses `lane.density`, which starts at the
  // window origin. As CYCLES it is song-absolute, which is what note marks, clip
  // bounds and the beat grid are expressed in. At origin 0 the two are equal —
  // which is why one variable served both jobs and nothing complained.
  const firstDensityIndex = Math.max(0, Math.floor(scrollLeft / pxPerCycle))
  const lastDensityIndex = Math.min(dc, Math.ceil((scrollLeft + viewportWidth) / pxPerCycle))
  const firstCycle = scene.windowOriginCycles + firstDensityIndex
  const lastCycle = scene.windowOriginCycles + lastDensityIndex

  ctx.fillStyle = theme.background
  ctx.fillRect(0, 0, viewportWidth, height)

  // Section bands (full height, behind lanes).
  scene.sections.forEach((s, i) => {
    const x0 = toScreenX(s.startCycle)
    const x1 = toScreenX(s.endCycle)
    if (x1 <= 0 || x0 >= viewportWidth) return
    const left = Math.max(0, x0)
    const width = Math.min(viewportWidth, x1) - left
    if (width <= 0) return
    ctx.fillStyle = i % 2 === 0 ? theme.section : theme.sectionAlt
    ctx.fillRect(left, 0, width, height)
  })

  // Cycle gridlines, coarsened so they never crowd below ~6px apart.
  let gridStep = 1
  while (gridStep * pxPerCycle < 6) gridStep *= 2
  ctx.fillStyle = theme.gridline
  for (let c = Math.ceil(firstCycle / gridStep) * gridStep; c <= lastCycle; c += gridStep) {
    const x = toScreenX(c)
    if (x < 0 || x > viewportWidth) continue
    ctx.fillRect(x, 0, 1, height)
  }

  // Lanes — each at its own top/height from the layout.
  scene.lanes.forEach((lane, idx) => {
    const box = layout.boxes[idx]
    if (!box || box.height <= 0) return
    const { top, height: rowHeight, expanded } = box
    if (idx % 2 === 1) {
      ctx.fillStyle = theme.rowAlt
      ctx.fillRect(0, top, viewportWidth, rowHeight)
    }
    // Read-only clip segments (#386) — behind the note marks. A bare track has
    // one implicit clip (no visible seams); an arrangement track shows a rect
    // per arm with bordered edges.
    drawClips(ctx, lane, top, rowHeight, viewportWidth, theme, scene.windowOriginCycles, toScreenX)
    const mode = laneRenderMode(pxPerCycle, lane.notes.length > 0, expanded)
    if (expanded) {
      drawBeatGrid(ctx, top, rowHeight, pxPerCycle, firstCycle, lastCycle, viewportWidth, theme, toScreenX)
    }
    if (mode === 'density') {
      drawDensity(
      ctx,
      lane,
      top,
      rowHeight,
      pxPerCycle,
      scene.peakDensity,
      firstDensityIndex,
      lastDensityIndex,
      scene.windowOriginCycles,
      toScreenX,
    )
    } else {
      // Marks: one band per voice sub-row (expanded multi-voice lane #424 — each
      // voice keeps its own pitch-Y spread / percussive baseline so a drum stack's
      // bd/sd/hh don't overlap) or a single band (collapsed / single-voice).
      // `laneMarkBands` is the SHARED geometry the live overlay (#500) also draws
      // against, so a lit mark sits exactly over its base mark — one source, no
      // drift (PV120). All marks share the lane color; gain drives intensity.
      ctx.fillStyle = lane.color
      for (const band of laneMarkBands(lane, box)) {
        for (const n of band.notes) {
          const r = markRect(n, band, pxPerCycle, viewportWidth, firstCycle, lastCycle, toScreenX)
          if (!r) continue
          const alpha = 0.4 + 0.6 * Math.min(1, Math.max(0, n.gain))
          ctx.globalAlpha = alpha
          ctx.fillRect(r.x, r.y, r.w, r.h)
          // The mark's own audio shape, drawn INSIDE the bar just placed (#1506).
          // Additive by construction: the bar is already down, so a sample with
          // no decoded audio, a row too short, or a mark too narrow simply leaves
          // what was always there.
          waveformColumnsLeft = drawMarkWaveform(
            ctx, n, r, peaksFor, waveformCps, pxPerCycle, waveformColumnsLeft,
            lane.color, theme.background,
          )
          ctx.globalAlpha = alpha
        }
      }
      ctx.globalAlpha = 1
    }
    // Continuous automation (#1464 Stage 1) — over the marks, under the silence
    // wash, so a muted track's curve dims with the rest of its lane.
    drawAutomation(
      ctx, lane.automations, top, rowHeight, viewportWidth, theme,
      firstCycle, lastCycle, toScreenX, expanded,
    )
    // Silenced (muted / soloed-out) lane fade (#731): wash the whole band toward
    // the background so it reads ~55% dimmer — the Mixer's dimmed-strip look —
    // keyed by the SAME display name the Mixer dims by (PV155). Painted last so it
    // dims this lane's marks/density/clips AND the section/gridline showing through
    // its band, confined to [top, top+rowHeight] so siblings are untouched. The
    // live overlay naturally lights nothing here (a silenced track schedules no
    // haps), so the fade is never re-lit from above.
    if (silenced?.has(lane.displayName)) {
      ctx.globalAlpha = SILENCED_LANE_SCRIM
      ctx.fillStyle = theme.background
      ctx.fillRect(0, top, viewportWidth, rowHeight)
      ctx.globalAlpha = 1
    }
  })
}

/** Inset above/below an empty clip's outline, so it sits where that clip's
 *  content WOULD be — the same band `drawDensity` fills (its own `padY`). */
const EMPTY_CLIP_PAD_Y = 4
/** Opacity of the LANE-COLOURED pass of an empty clip's outline — identity.
 *  Sits clearly below content (density blocks run 0.25–1.0) and survives the
 *  `SILENCED_LANE_SCRIM`, which lands a muted lane's outline at ~`this × 0.45`
 *  effective. That fade is what distinguishes muted from sounds-but-empty,
 *  without a second colour. */
const EMPTY_CLIP_OUTLINE_ALPHA = 0.45

/** Does anything render inside this clip's span? Checks BOTH sources a lane can
 *  carry content through — `density` (analysis onsets) and `notes` (eval marks) —
 *  because an IR lane can have onsets with no marks, and the two are populated by
 *  different layers.
 *
 *  DENSITY is tested first deliberately: it is bounded by the clip's cycle count
 *  (a handful of buckets) whereas the note scan is O(notes in the lane), so the
 *  common case — a clip that HAS content — returns on the cheap check, and the
 *  note walk only runs for a span the coarse index already called empty. This
 *  runs per clip per frame.
 *
 *  PRICED rather than assumed. Worst case is a lane at the 2000-mark cap whose
 *  notes all sit in one arm, with a second EMPTY arm forcing the full scan every
 *  frame: p50 0.0253ms per whole-scene draw against 0.0127ms when both arms
 *  short-circuit, i.e. the scan costs ~0.013ms and the entire draw is 0.15% of a
 *  16.7ms frame. No early-out or memo is warranted at that size.
 *
 *  A note belongs to the span if its ONSET falls inside it, or if it started
 *  earlier and SUSTAINS into it — so a note held across a clip boundary leaves
 *  neither side reading as empty. Stated as two cases rather than an interval
 *  overlap because a zero-duration trigger (`end === cycle`, the percussive
 *  case) is real here and a plain `end > start` test would drop it. */
function clipHasContent(lane: SceneLane, clip: SceneClip, windowOriginCycles: number): boolean {
  // Whole-cycle-aligned clip bounds (see `SceneClip.endCycle`), so the bucket
  // range is exact rather than a conservative widening.
  // `clip.*Cycle` is song-absolute, `lane.density` is indexed from the window
  // origin — convert once, here. Before the origin existed these two frames were
  // the same and this read the array directly; at a non-zero origin that made the
  // loop bounds nonsense (`from` past the array end) so it never executed.
  const from = Math.max(0, Math.floor(clip.startCycle) - windowOriginCycles)
  const to = Math.min(lane.density.length, Math.ceil(clip.endCycle) - windowOriginCycles)
  for (let c = from; c < to; c++) {
    if ((lane.density[c] ?? 0) > 0) return true
  }
  for (const n of lane.notes) {
    const onsetInside = n.cycle >= clip.startCycle && n.cycle < clip.endCycle
    const sustainsIn = n.cycle < clip.startCycle && n.end > clip.startCycle
    if (onsetInside || sustainsIn) return true
  }
  return false
}

/** Read-only clip segments for one lane (#386). Each clip is a filled band
 *  (`clipFill`) with bordered left/right edges (`clipBorder`) so an arrangement
 *  reads as discrete movable segments (design §4.2). The single implicit clip of
 *  a bare track spans the whole lane → its edges sit at the song boundaries
 *  (effectively seamless). Pure: positions via the shared `toScreenX` (PV116).
 *  Drawn BEHIND marks so note content stays legible on top.
 *
 *  An EMPTY clip additionally gets a full outline (#1100). Measured cause: the
 *  fill and the two vertical borders are drawn for every clip regardless of
 *  content — density is never consulted here — but at `clipFill`'s 0.035 alpha
 *  the body contributes ~3/255, and a whole-song clip's only strong marks are
 *  its two 1px verticals, which sit at the song's extreme edges flush with the
 *  frame. So the clip was present and unreadable, and a lane with no content to
 *  stand in for it (a muted track — #1099) read as inert rather than silenced.
 *  HORIZONTAL edges are the load-bearing part: they span the clip's width, so a
 *  whole-song clip becomes visible where verticals alone cannot make it.
 *
 *  Scoped to empty clips, so a lane with content is byte-identical to before —
 *  and MUTED is deliberately NOT drawn differently from sounds-but-empty-here.
 *  The lane-level `SILENCED_LANE_SCRIM` already washes a muted lane's whole
 *  band, so the same outline lands dimmer there for free, by the mechanism that
 *  already expresses "silenced" for marks and density. A second encoding at the
 *  clip would say the same thing twice and could disagree with the first. */
/**
 * Draw a clip's section name, truncated to fit (#1391).
 *
 * ⚠ TRUNCATION IS MEASURED, NOT ESTIMATED. Cutting at a character count
 * computed from an assumed glyph width is how a proportional font silently
 * overflows its clip and bleeds into the next section's name — so this measures
 * the real string with `measureText` and drops one character at a time. The cost
 * is a few measurements per visible clip; the alternative is a caption that is
 * wrong exactly when two sections are adjacent, which is always.
 */
function drawClipCaption(
  ctx: CanvasRenderingContext2D,
  clip: SceneClip,
  left: number,
  right: number,
  top: number,
  rowHeight: number,
  theme: DrawTheme,
): void {
  // A bare track is not an arrangement and has no section to name.
  if (clip.sectionName === '') return
  const box = right - left - CLIP_CAPTION_PAD_X * 2
  if (box < CLIP_CAPTION_MIN_W - CLIP_CAPTION_PAD_X * 2) return

  ctx.save()
  ctx.font = CLIP_CAPTION_FONT
  ctx.fillStyle = theme.clipCaption
  ctx.textBaseline = 'middle'

  let text = clip.sectionName
  if (ctx.measureText(text).width > box) {
    // Shrink until the ellipsised form fits. Bail to nothing rather than draw a
    // lone ellipsis, which names no section.
    while (text.length > 0 && ctx.measureText(`${text}…`).width > box) {
      text = text.slice(0, -1)
    }
    text = text.length > 0 ? `${text}…` : ''
  }
  if (text !== '') {
    ctx.fillText(text, left + CLIP_CAPTION_PAD_X, top + rowHeight / 2)
  }
  ctx.restore()
}

function drawClips(
  ctx: CanvasRenderingContext2D,
  lane: SceneLane,
  top: number,
  rowHeight: number,
  viewportWidth: number,
  theme: DrawTheme,
  windowOriginCycles: number,
  toScreenX: (cycle: number) => number,
): void {
  for (const clip of lane.clips) {
    const x0 = toScreenX(clip.startCycle)
    const x1 = toScreenX(clip.endCycle)
    if (x1 <= 0 || x0 >= viewportWidth) continue
    const left = Math.max(0, x0)
    const right = Math.min(viewportWidth, x1)
    const width = right - left
    if (width <= 0) continue
    ctx.fillStyle = theme.clipFill
    ctx.fillRect(left, top, width, rowHeight)
    // Vertical borders at the real (unclamped) clip edges only — so a clip
    // clipped off-screen doesn't draw a false edge at the viewport margin.
    ctx.fillStyle = theme.clipBorder
    if (x0 >= 0 && x0 <= viewportWidth) ctx.fillRect(x0, top, 1, rowHeight)
    if (x1 >= 0 && x1 <= viewportWidth) ctx.fillRect(x1 - 1, top, 1, rowHeight)
    // The SECTION NAME (#1391) — `intro`, `verse`, else the positional `§{n}`.
    // Drawn here, ABOVE the empty-clip branch below, so an empty section is
    // named too: "which section is this silence in" is exactly the question an
    // empty clip raises. Anchored to the clip's real left edge when it is on
    // screen, else to the viewport, so a section scrolled half off still says
    // what it is instead of losing its name off the left.
    drawClipCaption(ctx, clip, left, right, top, rowHeight, theme)
    if (clipHasContent(lane, clip, windowOriginCycles)) continue
    // Empty clip: outline it in the lane's own colour. Top/bottom run the
    // CLAMPED width (they follow what's on screen); the verticals stay at the
    // real edges, matching the border rule directly above — an off-screen edge
    // must not draw a false one at the viewport margin.
    const padY = Math.min(EMPTY_CLIP_PAD_Y, Math.floor(rowHeight / 4))
    const oTop = top + padY
    const oH = Math.max(1, rowHeight - 2 * padY)
    const edges = (): void => {
      ctx.fillRect(left, oTop, width, 1)
      ctx.fillRect(left, oTop + oH - 1, width, 1)
      if (x0 >= 0 && x0 <= viewportWidth) ctx.fillRect(x0, oTop, 1, oH)
      if (x1 >= 0 && x1 <= viewportWidth) ctx.fillRect(x1 - 1, oTop, 1, oH)
    }
    // TWO passes. The neutral one first, at full strength, because a single
    // lane-coloured pass makes legibility track the lane HUE's luminance —
    // measured over the same clip in the same muted state, an orange lane's
    // outline stood out 25.6/255 while a crimson one managed 7.0, purely from
    // which palette slot the track drew. `clipBorder` is reused rather than a
    // new token: it is already what a clip SEAM is drawn in, so an empty clip's
    // outline can never read weaker than the boundary between two full ones.
    ctx.fillStyle = theme.clipBorder
    ctx.globalAlpha = 1
    edges()
    // Then the lane's colour over it, for identity.
    ctx.fillStyle = lane.color
    ctx.globalAlpha = EMPTY_CLIP_OUTLINE_ALPHA
    edges()
    ctx.globalAlpha = 1
  }
}

/** Faint per-beat vertical guides inside an expanded lane (rhythm readability).
 *  Cycle boundaries are already drawn by the global gridlines; this adds the
 *  in-between beats (BEATS_PER_BAR subdivisions), suppressed when they'd crowd. */
/** Horizontal sampling step for the curve, in px. One sample per ~2px is below
 *  the resolution of the stroke itself, so a finer step costs time and changes
 *  no pixel. */
const AUTOMATION_STEP_PX = 2
/**
 * Minimum pixels per full OSCILLATION before the curve is drawn cycle-by-cycle.
 *
 * Reuses `COARSEN_PX` — the lane's own already-calibrated answer to the identical
 * question. Below that many pixels per cycle the mark renderer stops drawing
 * individual notes and switches to density blocks, because the marks would smear
 * sub-pixel; an oscillation that gets less room than a cycle needs is in exactly
 * the same position, so it gets the same treatment rather than a second constant
 * tuned by eye against the first.
 *
 * ⚠ FOUND BY LOOKING, and the first guess at it was wrong. Every unit test here
 * draws a 4-cycle window, where this never triggers at all. But a continuously
 * modulated document is precisely the one whose loop period cannot be detected
 * (#1465 — the cycle fingerprint reads the event's value partition, and a moving
 * control makes every cycle differ), so the view falls back to "no repeat ·
 * showing first 256 cycles". At 256 cycles across ~900px, `sine.slow(2)` is 128
 * oscillations at ~7px each. The FIRST real document this feature meets is the
 * one it renders worst, and no fixture would have shown it — the screenshot did.
 */
const AUTOMATION_MIN_PERIOD_PX = COARSEN_PX

/** The dash a fabricated curve is stroked with (#1486). Long enough to read as
 *  deliberate at a 1.5px stroke rather than as a rendering artefact, short
 *  enough that the curve's SHAPE — the real part — still reads. */
const AUTOMATION_INDICATIVE_DASH: readonly number[] = [4, 3]

/**
 * The signal's value at a given cycle, normalised to 0..1 of its own range.
 *
 * Shape only — this deliberately does NOT reproduce Strudel's sampling, because
 * it is not trying to: the lane shows the CONTOUR of the automation (what moves,
 * how fast, between which bounds), and a lane that claimed sample accuracy would
 * be making a promise the engine, not the editor, owns. The engine remains the
 * authority on what is heard; bouncing already proved it renders these correctly
 * even while they were opaque here.
 *
 * `rand`/`perlin` are drawn as a stable pseudo-random contour rather than as the
 * engine's actual seeded stream, for the same reason — the seed is a runtime
 * value the static IR does not carry, so a "real" curve here would be fiction
 * with a plausible shape. A deterministic stand-in at the right RATE tells the
 * truth that is available: this parameter jumps around, this often.
 */
/**
 * The kinds this module can draw FAITHFULLY — a closed form the document alone
 * determines, so the curve on screen is the curve the engine will produce.
 *
 * ⚠ THIS TABLE IS THE SINGLE SOURCE OF TRUTH for both questions asked of a
 * kind: what shape to plot (`signalUnit`) and whether that shape is real
 * (`isIndicativeKind`). They were a switch and a list at first, which is two
 * places to add a kind and one place to forget — and forgetting the second is
 * silent, because a fabricated curve drawn as faithful looks exactly like a
 * faithful one. Membership answers both, so it cannot drift.
 */
const FAITHFUL_UNIT: Readonly<Record<string, (t: number) => number>> = {
  sine: (t) => (Math.sin(2 * Math.PI * t) + 1) / 2,
  sine2: (t) => (Math.sin(2 * Math.PI * t) + 1) / 2,
  cosine: (t) => (Math.cos(2 * Math.PI * t) + 1) / 2,
  cosine2: (t) => (Math.cos(2 * Math.PI * t) + 1) / 2,
  saw: (t) => t,
  saw2: (t) => t,
  isaw: (t) => 1 - t,
  isaw2: (t) => 1 - t,
  tri: (t) => (t < 0.5 ? t * 2 : 2 - t * 2),
  tri2: (t) => (t < 0.5 ? t * 2 : 2 - t * 2),
  itri: (t) => (t < 0.5 ? 1 - t * 2 : t * 2 - 1),
  itri2: (t) => (t < 0.5 ? 1 - t * 2 : t * 2 - 1),
  square: (t) => (t < 0.5 ? 0 : 1),
  square2: (t) => (t < 0.5 ? 0 : 1),
  // `time` is the cycle position — deterministic, so the drawn ramp IS the
  // signal. It is not fabricated; it is simply unbounded, which is why it
  // abstains without an explicit `.range()` long before it reaches here.
  time: (t) => t,
}

/**
 * Is this kind's drawn curve INDICATIVE rather than a literal trace? (#1486)
 *
 * True for `rand`, `perlin`, `berlin`, `brand` and the mouse signals — 120 of
 * the 313 curves the timeline draws, so the second and third most common shapes
 * after `sine`. Their real stream depends on `controls.randSeed` (or on a live
 * pointer), a runtime value the static IR does not carry, so no curve drawn
 * from the document alone can be the real one.
 */
function isIndicativeKind(kind: string): boolean {
  return !(kind in FAITHFUL_UNIT)
}

function signalUnit(kind: string, phase: number): number {
  const t = phase - Math.floor(phase) // wrap to [0,1)
  const faithful = FAITHFUL_UNIT[kind]
  if (faithful) return faithful(t)

  // rand / perlin / berlin / brand / mouse* — a stable hash-based contour.
  // perlin-family reads as smooth, rand-family as stepped, which is the one
  // distinction a viewer needs to tell them apart at a glance.
  const step = kind.startsWith('perlin') || kind.startsWith('berlin')
  const h = (n: number): number => {
    const x = Math.sin(n * 127.1) * 43758.5453
    return x - Math.floor(x)
  }
  const i = Math.floor(t * 8)
  if (!step) return h(i)
  const f = t * 8 - i
  const sm = f * f * (3 - 2 * f) // smoothstep between adjacent samples
  return h(i) * (1 - sm) + h(i + 1) * sm
}

/**
 * Draw one lane's continuous automation curves (#1464 Stage 1 — READ ONLY).
 *
 * Several automated parameters on one track stack as separate curves in the same
 * band, each spanning the band's full height in its OWN range. They are not
 * plotted on a shared axis on purpose: `cutoff` runs to thousands and `pan` to
 * one, so a shared axis would flatten every parameter but the largest into a line
 * along the floor. Each curve answers "how does THIS control move", which is the
 * question the lane exists to answer at this stage.
 */
function drawAutomation(
  ctx: CanvasRenderingContext2D,
  automations: readonly SignalAutomation[],
  top: number,
  rowHeight: number,
  viewportWidth: number,
  theme: DrawTheme,
  firstCycle: number,
  lastCycle: number,
  toScreenX: (cycle: number) => number,
  expanded: boolean,
): void {
  if (automations.length === 0) return
  const bandH = rowHeight - AUTOMATION_PAD_Y * 2
  if (bandH < AUTOMATION_MIN_BAND_H) return

  const x0 = Math.max(0, toScreenX(firstCycle))
  const x1 = Math.min(viewportWidth, toScreenX(lastCycle))
  if (x1 - x0 < 1) return
  // Screen x → cycle, inverted from the SAME map the rest of the lane uses, so
  // the curve cannot drift from the marks underneath it.
  const spanPx = toScreenX(lastCycle) - toScreenX(firstCycle)
  if (!(spanPx > 0)) return
  const cyclesPerPx = (lastCycle - firstCycle) / spanPx

  const pxPerCycle = toScreenX(1) - toScreenX(0)

  ctx.save()
  ctx.lineWidth = 1.5
  ctx.lineJoin = 'round'

  const drawable = automations.filter(
    (a) => a.periodCycles > 0 && Number.isFinite(a.periodCycles),
  )
  // Too fast to draw cycle-by-cycle at this zoom (see the band comment below).
  const tooFast = drawable.filter((a) => a.periodCycles * pxPerCycle < AUTOMATION_MIN_PERIOD_PX)
  const curves = drawable.filter((a) => a.periodCycles * pxPerCycle >= AUTOMATION_MIN_PERIOD_PX)

  /**
   * The curve's colour, and the same colour its caption gets (#1485).
   *
   * With ONE automation there is nothing to disambiguate, so the lane keeps the
   * theme's own automation colour and looks exactly as it did. The per-parameter
   * hue appears only when it carries information — which is also why it is keyed
   * on the parameter and not on position: a lane gaining a second curve must not
   * recolour the first, or the hue would mean "how many are here" rather than
   * "which parameter is this".
   */
  const colorOf = (a: SignalAutomation): string =>
    automationColorOnLane(a.paramKey, automations.length, theme.automationLine)

  // ── The unresolvable ones, as horizontal SLICES of the band ───────────────
  // State the modulation as a translucent band instead of smearing 128 strokes
  // into a solid block. The band is the honest reading — "this control sweeps
  // its whole range, faster than this view can resolve" — and it degrades back
  // into the real curve the moment the user zooms in far enough to see one.
  //
  // ⚠ ONE SLICE EACH, NOT ONE BAND EACH. Every such parameter used to fill the
  // SAME rectangle at alpha 0.18, so the alpha compounded and N unresolvable
  // parameters rendered darker than one — the lane's darkness read as an
  // intensity it had no business claiming. Slicing removes the overlap (so the
  // shade is the same whatever N is) and keeps each parameter identifiable,
  // which redrawing one shared band would have thrown away.
  if (tooFast.length > 0) {
    const sliceH = bandH / tooFast.length
    ctx.save()
    ctx.globalAlpha = 0.18
    tooFast.forEach((a, i) => {
      ctx.fillStyle = colorOf(a)
      ctx.fillRect(x0, top + AUTOMATION_PAD_Y + i * sliceH, x1 - x0, sliceH)
    })
    ctx.restore()
  }

  for (const a of curves) {
    ctx.strokeStyle = colorOf(a)
    // ── DASHED means "indicative, not a literal trace" (#1486) ──────────────
    // Everything else on this lane is faithful: the marks are the real events,
    // the clips the real arms, a `sine` curve the real sine. A `perlin` curve
    // is not — its stream depends on a runtime seed the static IR cannot carry
    // — and drawn identically it invites someone to line a wiggle up against a
    // note and explain why THAT hit sounds different, reading a shape this code
    // invented. The file's own discipline is that silence beats a confident
    // wrong reading; this is the cheapest way to say "extent and rate are real,
    // the path is not".
    ctx.setLineDash(isIndicativeKind(a.kind) ? AUTOMATION_INDICATIVE_DASH : [])
    ctx.beginPath()
    let first = true
    for (let x = x0; x <= x1; x += AUTOMATION_STEP_PX) {
      const cycle = firstCycle + (x - toScreenX(firstCycle)) * cyclesPerPx
      const unit = signalUnit(a.kind, cycle / a.periodCycles)
      // Top of the band is the HIGH value — screen y grows downward.
      const y = top + AUTOMATION_PAD_Y + (1 - Math.min(1, Math.max(0, unit))) * bandH
      if (first) { ctx.moveTo(x, y); first = false } else { ctx.lineTo(x, y) }
    }
    ctx.stroke()
  }
  // The enclosing `restore()` would clear this too — it is reset here so the
  // dash's scope is the loop that sets it, and a later stroke added between
  // here and the restore cannot silently inherit it.
  ctx.setLineDash([])

  // ── The BOUNDS, stated rather than drawn ──────────────────────────────────
  // Every curve is plotted over the full band height in its OWN range, because
  // the parameters share no axis: `cutoff` runs to thousands and `pan` to one, so
  // a shared axis would flatten everything but the largest into a line along the
  // floor. That normalisation is what makes several curves comparable in SHAPE —
  // and it also means the range leg #1464 asks to be visible would otherwise have
  // no effect on a single pixel, since `.range(0.4,0.6)` and `.range(0,1)` draw
  // an identical wave. A DAW resolves exactly this by labelling the lane's axis
  // instead of rescaling the curve, and that is what these captions are.
  //
  // Only on an EXPANDED lane: collapsed rows are a contour view, and a label per
  // parameter would cost more legibility than it returns at that height.
  //
  // ⚠ THE LINES AND THEIR POSITIONS COME FROM `captionRows`, NOT FROM A LOOP
  // HERE. #1464 Stage 2 makes these numbers clickable, and a hit-test needs to
  // know where each one sits; a second copy of that arithmetic would drift from
  // this one silently, and the symptom is a click landing on the wrong bound.
  // Same discipline as `laneMarkBands` and the live overlay (PV120): one
  // geometry, two readers. The text — including the `~` that marks a bound this
  // code supplied rather than one the user wrote — is decided there too.
  ctx.font = AUTOMATION_LABEL_FONT
  ctx.textBaseline = 'top'
  for (const row of captionRows(automations, top, rowHeight, expanded)) {
    // THE TIE (#1485): a caption is drawn in its own curve's colour, which is
    // the only thing linking the two — the curves share a band and each is
    // normalised to its own range, so neither position nor height can say
    // which line a name belongs to.
    ctx.fillStyle = colorOf(row.automation)
    ctx.fillText(row.text, CAPTION_PAD_X, row.y)
  }
  ctx.restore()
}

function drawBeatGrid(
  ctx: CanvasRenderingContext2D,
  top: number,
  rowHeight: number,
  pxPerCycle: number,
  firstCycle: number,
  lastCycle: number,
  viewportWidth: number,
  theme: DrawTheme,
  toScreenX: (c: number) => number,
): void {
  if (pxPerCycle / BEATS_PER_BAR < BEAT_GRID_MIN_PX) return
  ctx.fillStyle = theme.gridline
  ctx.globalAlpha = 0.5
  for (let c = Math.floor(firstCycle); c < lastCycle; c++) {
    for (let b = 1; b < BEATS_PER_BAR; b++) {
      const x = toScreenX(c + b / BEATS_PER_BAR)
      if (x < 0 || x > viewportWidth) continue
      ctx.fillRect(x, top, 1, rowHeight)
    }
  }
  ctx.globalAlpha = 1
}

function drawDensity(
  ctx: CanvasRenderingContext2D,
  lane: SceneLane,
  top: number,
  rowHeight: number,
  pxPerCycle: number,
  peak: number,
  /** Visible range as DENSITY INDICES (`lane.density` starts at the origin). */
  firstDensityIndex: number,
  lastDensityIndex: number,
  /** Added back to turn an index into the song-absolute cycle `toScreenX` wants. */
  windowOriginCycles: number,
  toScreenX: (c: number) => number,
): void {
  const padY = 4
  const gap = pxPerCycle > 3 ? 1 : 0
  const cellW = Math.max(1, pxPerCycle - gap)
  const cellH = Math.max(1, rowHeight - 2 * padY)
  const denom = peak > 0 ? peak : 1
  ctx.fillStyle = lane.color
  for (let i = firstDensityIndex; i < lastDensityIndex; i++) {
    const count = lane.density[i] ?? 0
    if (count <= 0) continue
    ctx.globalAlpha = 0.25 + 0.75 * Math.min(1, count / denom)
    // Index in, absolute cycle out — the conversion happens here and only here.
    ctx.fillRect(toScreenX(windowOriginCycles + i), top + padY, cellW, cellH)
  }
  ctx.globalAlpha = 1
}

/** Per-voice (expanded) padding above/below a sub-row's mark band. */
const VOICE_BAND_PAD_Y = 2
/** Collapsed / single-band padding above/below the lane's mark band. */
const SINGLE_BAND_PAD_Y = 3

/** One horizontal band a lane's marks render into: a `[bandTop, bandTop+bandH]`
 *  strip plus the marks that belong to it, the pitch range that maps note→Y, and
 *  the bar height. A collapsed lane has ONE band (all its notes); an expanded
 *  multi-voice lane has one band PER voice sub-row (#424). The single source the
 *  base renderer and the live overlay (#500) both place marks against. */
export interface MarkBand {
  readonly notes: readonly SceneNote[]
  readonly bandTop: number
  readonly bandH: number
  readonly markH: number
  readonly pMin: number | null
  readonly pMax: number | null
}

/**
 * The mark bands a lane draws into, given its layout box. An expanded lane split
 * into voice sub-rows yields one band per voice — each melodic voice keeps its
 * own pitch-Y spread, each percussive voice a flat baseline, so a drum stack's
 * bd/sd/hh sit on separate lines (#424); sub-row geometry comes straight from the
 * shared `LaneLayout` (PV120). Otherwise a single band: the bar scales with the
 * row height so the row-height setting grows it like the live monitor (#459); an
 * expanded single band keeps a thin mark so its pitch spread reads as a contour.
 * PURE — the geometry the base `drawTimeline` and the live overlay both consume,
 * so a lit mark lands exactly over its base mark (no drift).
 */
export function laneMarkBands(lane: SceneLane, box: LaneBox): MarkBand[] {
  if (box.subRows) {
    const voiceByKey = new Map(lane.voices.map((v) => [v.key, v]))
    return box.subRows.map((sr) => {
      const voice = voiceByKey.get(sr.voiceKey)
      const markH = barHeightForBand(sr.height - 2 * VOICE_BAND_PAD_Y)
      return {
        notes: lane.notes.filter((n) => (n.voice ?? NO_VOICE) === sr.voiceKey),
        bandTop: sr.top + VOICE_BAND_PAD_Y,
        bandH: Math.max(1, sr.height - 2 * VOICE_BAND_PAD_Y - markH),
        markH,
        pMin: voice?.pitchMin ?? null,
        pMax: voice?.pitchMax ?? null,
      }
    })
  }
  const markH = box.expanded ? 4 : barHeightForBand(box.height - 2 * SINGLE_BAND_PAD_Y)
  return [
    {
      notes: lane.notes,
      bandTop: box.top + SINGLE_BAND_PAD_Y,
      bandH: Math.max(1, box.height - 2 * SINGLE_BAND_PAD_Y - markH),
      markH,
      pMin: lane.pitchMin,
      pMax: lane.pitchMax,
    },
  ]
}

/**
 * The rect for one mark within a band, or null if it's outside the visible cycle
 * window / off-screen. Melodic marks (pitch within a real `[pMin, pMax]` range)
 * map pitch→Y (high pitch near the top, DAW convention); percussive marks (no
 * pitch, or a single-pitch voice where `pMax === pMin`) sit on the band's centre
 * baseline. Width is DURATION-proportional (mirrors the live view's
 * `eventToRect`), floored at `MIN_MARK_W` so a zero-duration trigger still shows.
 * PURE — shared by the base draw and the live overlay so both agree pixel-for-
 * pixel on where a mark sits.
 */
export function markRect(
  note: SceneNote,
  band: MarkBand,
  pxPerCycle: number,
  viewportWidth: number,
  firstCycle: number,
  lastCycle: number,
  toScreenX: (c: number) => number,
): { x: number; y: number; w: number; h: number } | null {
  if (note.cycle < firstCycle || note.cycle >= lastCycle) return null
  const x = toScreenX(note.cycle)
  const w = Math.max(MIN_MARK_W, (note.end - note.cycle) * pxPerCycle)
  if (x < -w || x > viewportWidth) return null
  const { bandTop, bandH, markH, pMin, pMax } = band
  const hasPitch = pMin != null && pMax != null && pMax > pMin
  let y: number
  if (note.pitch != null && hasPitch) {
    const t = (note.pitch - pMin) / (pMax - pMin)
    y = bandTop + (1 - t) * bandH // high pitch near the band top (DAW convention)
  } else {
    y = bandTop + bandH / 2
  }
  return { x, y, w, h: markH }
}

/**
 * Paint one mark's audio shape inside the bar already drawn for it (#1506), and
 * return what is left of the frame's column budget.
 *
 * Every reason to draw nothing is a normal state, not a failure: a synth note
 * has no sample, a sample may not have finished decoding, the tempo may not be
 * known yet, and most marks at most zooms have no room. In all of those the bar
 * that was drawn a moment ago is the whole rendering, which is why this is safe
 * to call unconditionally.
 *
 * Columns are one pixel wide and at least one pixel tall — a column whose peaks
 * round to nothing still marks that the sound is present there, and a waveform
 * with holes in it reads as silence that is not in the file.
 */
function drawMarkWaveform(
  ctx: CanvasRenderingContext2D,
  note: SceneNote,
  r: { x: number; y: number; w: number; h: number },
  peaksFor: (voice: string, pitch: number | null) => {
    readonly data: Float32Array
    readonly columns: number
    readonly duration: number
  } | null,
  cps: number | null,
  pxPerCycle: number,
  budget: number,
  inkStyle: string,
  bedStyle: string,
): number {
  if (budget <= 0) return budget
  const voice = note.voice
  // A null-`s` mark is a synth note: it carries a pitch and no sample, so there
  // is no file whose shape could be drawn.
  if (voice == null || voice === NO_VOICE) return budget
  const peaks = peaksFor(voice, note.pitch ?? null)
  if (peaks == null) return budget
  const fit = waveformFit(peaks.duration, cps, r.w, r.h, pxPerCycle, note.region)
  if (fit == null) return budget

  const columns = Math.min(Math.floor(fit.extentPx), budget)
  if (columns <= 0) return budget
  const centreY = r.y + r.h / 2
  const halfH = r.h / 2

  // Clear a bed first. The bar underneath is the same colour and, at full gain,
  // the same opacity — painting the shape straight onto it draws it invisibly.
  ctx.globalAlpha = WAVEFORM_BED_SCRIM
  ctx.fillStyle = bedStyle
  ctx.fillRect(r.x, r.y, columns, r.h)

  // Then the shape, at full opacity against that recessed bed. This assignment
  // is also what hands the lane colour back to the band loop for the next mark —
  // painting the bed above changed it, and without this every following bar
  // would be drawn in the background colour and simply disappear.
  ctx.globalAlpha = 1
  ctx.fillStyle = inkStyle
  for (let i = 0; i < columns; i++) {
    const col = waveformColumn(peaks.data, peaks.columns, i, columns, fit)
    const top = centreY - Math.max(-1, Math.min(1, col.max)) * halfH
    const bottom = centreY - Math.max(-1, Math.min(1, col.min)) * halfH
    ctx.fillRect(r.x + i, top, 1, Math.max(1, bottom - top))
  }
  return budget - columns
}
