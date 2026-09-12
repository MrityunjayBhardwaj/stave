/**
 * drawLiveOverlay — the per-note LIVE overlay for the canvas Song timeline
 * (#500 / U3, timeline unification #497).
 *
 * The base `SongTimelineCanvas` draws the static scene (density + mini-note
 * marks) and is dirty-flagged. The LIVE layer rides on a SECOND canvas above it
 * and lights the marks that are sounding RIGHT NOW — Live's killer feature
 * folded onto the canvas. "Lit" is a draw-STATE change over the EXISTING
 * geometry: it reuses `laneMarkBands` + `markRect` from drawTimeline, so a lit
 * mark lands exactly over its base mark (one geometry source, no drift — PV120).
 * Visible-window clipped → O(visible), like the base draw.
 *
 * PURE — no React, no canvas creation. The host (`SongTimelineLiveOverlay`) owns
 * the surface, the hap subscription, and the per-frame redraw.
 */

import { NO_VOICE, type TimelineScene, type SceneNote } from './timelineScene'
import type { LaneLayout } from './laneLayout'
import {
  laneMarkBands,
  markRect,
  laneRenderMode,
  type ViewTransform,
  type WaveformSource,
} from './drawTimeline'
import { waveformFit } from './waveformLane'
import { songCycleToXUnclamped, type SongWindow } from './songAxis'

export interface LiveOverlayTheme {
  /** Bright core of a lit mark. */
  readonly lit: string
  /** Wider, fainter glow behind the core so even a thin bar reads as "firing". */
  readonly litGlow: string
}

/**
 * Signature that addresses a mark by VOICE + PITCH — the dimensions a runtime
 * hap carries (`s`, `midiNote`) and a `SceneNote` mirrors (`voice`, `pitch`).
 * A hap does NOT carry `trackId`, so the lane dimension of the design's match
 * key `(laneKey↔trackId, voice↔s, pitch↔note)` is recovered by the playhead-
 * TEMPORAL gate (which mark is under the playhead), not this key (design §4). A
 * drum hit → `bd|`; a bare synth note → `|60`; a sampled melodic note →
 * `piano|48`. Null voice and null pitch both collapse to the empty segment, so
 * a hap and its mark agree on both sides.
 */
export function markSig(voice: string | null | undefined, pitch: number | null | undefined): string {
  return `${voice ?? ''}|${pitch ?? ''}`
}

/** Small cycle window so an instantaneous (zero-duration) mark still lights for a
 *  visible moment under the playhead — the time-domain twin of `markRect`'s
 *  `MIN_MARK_W` width flooring. */
export const MIN_LIT_CYCLES = 1 / 16

/** Max playhead→mark gap (cycles) at which an active sig may still light its
 *  NEAREST occurrence. Bounds staleness so an active sig can't light a mark far
 *  from the playhead, while staying loose enough to absorb the audio↔rAF clock
 *  offset that strict `[cycle,end)` containment cannot (#507). The lit DURATION
 *  is still bounded by the hap-driven sig-active window, not this cap — so a
 *  short note lights only while it sounds, just reliably. */
export const MAX_LIT_DISTANCE_CYCLES = 0.5

const EMPTY_LIT: ReadonlySet<SceneNote> = new Set()

/** Distance (cycles) from the playhead to a mark: 0 inside its `[cycle, end)`
 *  (end floored to `MIN_LIT_CYCLES`), else the gap to the nearer edge. */
function cycleDistance(note: SceneNote, playheadCycle: number): number {
  const end = Math.max(note.end, note.cycle + MIN_LIT_CYCLES)
  if (playheadCycle >= note.cycle && playheadCycle < end) return 0
  return playheadCycle < note.cycle ? note.cycle - playheadCycle : playheadCycle - end
}

/**
 * Which marks light at `playheadCycle`. TWO gates (design §4, revised #507):
 *  1. CONFIRMED — the mark's voice+pitch signature is in the firing set the hap
 *     stream maintains. Handles `?`/degrade/conditional patterns: a scene mark
 *     that did NOT actually sound this pass has no active hap → stays dark. The
 *     sig-active window (hap arrival → audible duration) bounds HOW LONG a mark
 *     lights, i.e. lights ≈ while the note sounds.
 *  2. NEAREST — for each active sig, light the single occurrence NEAREST the
 *     playhead (within `MAX_LIT_DISTANCE_CYCLES`). Picks WHICH occurrence of a
 *     voice+pitch is sounding now. This replaces strict `[cycle,end)` containment
 *     (the original temporal gate), which the audio↔rAF clock offset made too
 *     brittle for SHORT, SPARSE notes: their narrow window rarely coincided with
 *     the (lookahead-offset) sig-active instant, so they barely lit while dense
 *     lanes — always having some mark under the playhead — masked it (#507).
 *     "Nearest" is robust to that offset and self-disambiguating: same-sig
 *     occurrences are spaced, so the nearest one IS the one sounding.
 *
 * PURE. Returns the set of notes (subset of `notes`) to light.
 */
export function pickLitNotes(
  notes: readonly SceneNote[],
  playheadCycle: number,
  activeSigs: ReadonlySet<string>,
): ReadonlySet<SceneNote> {
  if (!Number.isFinite(playheadCycle) || activeSigs.size === 0) return EMPTY_LIT
  // Best (min-distance) occurrence per active sig.
  const best = new Map<string, { note: SceneNote; dist: number }>()
  for (const n of notes) {
    const sig = markSig(n.voice, n.pitch)
    if (!activeSigs.has(sig)) continue
    const dist = cycleDistance(n, playheadCycle)
    if (dist > MAX_LIT_DISTANCE_CYCLES) continue
    const cur = best.get(sig)
    if (!cur || dist < cur.dist) best.set(sig, { note: n, dist })
  }
  if (best.size === 0) return EMPTY_LIT
  const out = new Set<SceneNote>()
  for (const b of best.values()) out.add(b.note)
  return out
}

/**
 * Draw the lit marks over the scene. Clears its own surface, then for each lane
 * in marks-render mode lights the marks the two gates accept, using the SAME
 * band geometry as the base draw. Density lanes (zoomed out) draw no marks, so
 * there is nothing to light there — the playhead + density already convey it.
 */
export function drawLiveOverlay(
  ctx: CanvasRenderingContext2D,
  scene: TimelineScene,
  transform: ViewTransform,
  layout: LaneLayout,
  playheadCycle: number | null,
  activeSigs: ReadonlySet<string>,
  theme: LiveOverlayTheme,
  waveforms?: WaveformSource,
): void {
  const { scrollLeft, contentWidth, viewportWidth } = transform
  ctx.clearRect(0, 0, viewportWidth, layout.totalHeight)
  const dc = scene.displayCycles
  if (playheadCycle == null || dc <= 0 || contentWidth <= 0 || viewportWidth <= 0) return
  if (activeSigs.size === 0) return

  const pxPerCycle = contentWidth / dc
  // Same window arithmetic as the base draw, and deliberately the same SOURCE:
  // this overlay must place a lit mark exactly over the base mark it lights, so
  // any divergence between the two transforms shows up as a glow offset from its
  // note. Both go through the axis, so there is one origin, not two agreeing by
  // coincidence. `playheadCycle` and `SceneNote.cycle` are both song-absolute.
  const win: SongWindow = { originCycle: scene.windowOriginCycles, spanCycles: dc }
  const toScreenX = (cycle: number): number =>
    songCycleToXUnclamped(cycle, win, contentWidth) - scrollLeft
  // Song-absolute visible range — `markRect` compares it against note cycles.
  // (No density here: the overlay only draws in marks mode, so unlike the base
  // renderer it needs the absolute range alone.)
  const firstCycle = scene.windowOriginCycles + Math.max(0, Math.floor(scrollLeft / pxPerCycle))
  const lastCycle =
    scene.windowOriginCycles + Math.min(dc, Math.ceil((scrollLeft + viewportWidth) / pxPerCycle))

  scene.lanes.forEach((lane, idx) => {
    const box = layout.boxes[idx]
    if (!box || box.height <= 0) return
    if (laneRenderMode(pxPerCycle, lane.notes.length > 0, box.expanded) !== 'marks') return
    for (const band of laneMarkBands(lane, box)) {
      // Per band (one voice), light the nearest active-sig occurrence (#507).
      const lit = pickLitNotes(band.notes, playheadCycle, activeSigs)
      if (lit.size === 0) continue
      for (const n of band.notes) {
        if (!lit.has(n)) continue
        const r = markRect(n, band, pxPerCycle, viewportWidth, firstCycle, lastCycle, toScreenX)
        if (!r) continue
        drawLitMark(ctx, r, n.gain, theme, markHasWaveform(n, r, waveforms, pxPerCycle))
      }
    }
  })
}

/**
 * Is this mark drawing a sample's shape inside itself right now (#1506)?
 *
 * Asked through the SAME `waveformFit` the base draw uses, reading the same
 * source, so the two canvases cannot drift on the question — the alternative,
 * re-deriving "is it a sample" from the note alone, would answer a different
 * question than the one the base canvas acted on.
 *
 * ⚠ One divergence is accepted, and it is benign by construction. The base draw
 * also stops at `WAVEFORM_COLUMN_BUDGET`, which is spent in scene draw order and
 * cannot be known here without recomputing that whole draw. Past the budget a
 * mark renders as the bar it always was and would be OUTLINED rather than
 * filled: a quieter light over a mark that has no shape to protect. The error
 * only ever costs brightness, never coverage.
 */
function markHasWaveform(
  note: SceneNote,
  r: { readonly w: number; readonly h: number },
  waveforms: WaveformSource | undefined,
  pxPerCycle: number,
): boolean {
  if (waveforms == null) return false
  // A null-`s` mark is a synth note: a pitch and no sample, so no file shape.
  const voice = note.voice
  if (voice == null || voice === NO_VOICE) return false
  const peaks = waveforms.peaksFor(voice, note.pitch ?? null)
  if (peaks == null) return false
  return waveformFit(peaks.duration, waveforms.cps, r.w, r.h, pxPerCycle, note.region) != null
}

/**
 * A lit mark: a faint wider glow behind a bright core, so even a ~3px bar pops
 * as "sounding now". Gain scales the core's opacity (design — gain→intensity).
 *
 * When the mark is drawing a waveform, both passes become RINGS instead of fills
 * (#1508). Both of them otherwise cover the shape — the core fills the mark
 * exactly, and the glow, despite the name, is a filled rect spanning the mark's
 * INTERIOR as well as the pad around it, so switching only the core would leave
 * a ~0.16–0.45 alpha wash over the waveform. Outlining keeps the one thing the
 * light says that the playhead cannot — WHICH lane is sounding, when a lane can
 * be silenced and a mark can be a rest — and gives the interior back.
 *
 * Why not light the waveform's own columns instead, which would be truer: this
 * overlay redraws every animation frame, where the base canvas is dirty-flagged.
 * A fill per column per lit mark per frame is the cost `WAVEFORM_COLUMN_BUDGET`
 * exists to bound on a draw that happens far less often.
 */
function drawLitMark(
  ctx: CanvasRenderingContext2D,
  r: { x: number; y: number; w: number; h: number },
  gain: number,
  theme: LiveOverlayTheme,
  outline: boolean,
): void {
  const g = Math.min(1, Math.max(0, Number.isFinite(gain) ? gain : 1))
  const glowPad = 2
  const glowAlpha = 0.18 + 0.32 * g
  const coreAlpha = 0.7 + 0.3 * g
  if (outline) {
    // The glow as a ring lying ENTIRELY outside the mark. A path on the midline
    // of the pad — inset glowPad/2 from its outer edge — stroked at lineWidth
    // glowPad extends glowPad/2 to either side, so the ink spans exactly
    // [r - glowPad, r] and stops at the mark's edge. That is the whole reason
    // for the half-pad inset: a stroke of the padded rect itself would reach
    // glowPad INTO the mark and re-create the wash this is removing.
    ctx.strokeStyle = theme.litGlow
    ctx.globalAlpha = glowAlpha
    ctx.lineWidth = glowPad
    ctx.strokeRect(r.x - glowPad / 2, r.y - glowPad / 2, r.w + glowPad, r.h + glowPad)
    // The core as a 1px ring hugging the mark from OUTSIDE, not a border drawn
    // on it. A waveform column is centred on the mark's middle with half-height
    // r.h/2, so a full-scale peak reaches the mark's very edges — a border ON
    // the mark covers the loudest content it exists to reveal. At the default
    // row height that is the outer 2 of 7 rows, 29% of the amplitude range.
    // Sitting one pixel out keeps the whole interior for the shape at every
    // size. The half-pixel offsets land the stroke ON a pixel row rather than
    // straddling two at half coverage.
    ctx.strokeStyle = theme.lit
    ctx.globalAlpha = coreAlpha
    ctx.lineWidth = 1
    ctx.strokeRect(r.x - 0.5, r.y - 0.5, r.w + 1, r.h + 1)
    ctx.globalAlpha = 1
    return
  }
  ctx.fillStyle = theme.litGlow
  ctx.globalAlpha = glowAlpha
  ctx.fillRect(r.x - glowPad, r.y - glowPad, r.w + 2 * glowPad, r.h + 2 * glowPad)
  ctx.fillStyle = theme.lit
  ctx.globalAlpha = coreAlpha
  ctx.fillRect(r.x, r.y, r.w, r.h)
  ctx.globalAlpha = 1
}
