/**
 * SongTimelineCanvas — the canvas surface for the Song timeline (#419).
 *
 * Owns a single `<canvas>` and redraws the `TimelineScene` via the pure
 * `drawTimeline`. It sits **sticky** at the left edge inside the grid's scroll
 * container (which provides the native scrollbar via a `contentWidth`-wide
 * spacer), so it stays pinned to the viewport while the content scrolls and
 * redraws the visible slice for the current `scrollLeft` (PV116 — canvas over
 * the shared content-space transform; the DOM playhead + overlay position
 * against the same transform).
 *
 * DIRTY-FLAGGED: it redraws only when the scene / transform / size changes
 * (a rAF coalesces bursts), never on a free-running loop — the timeline is
 * event-driven, not continuously animated (design §4.6). The playhead's
 * continuous motion lives in the DOM overlay, so it never forces a canvas redraw.
 *
 * Main-thread first (design §4.7): the same `drawTimeline` moves into the
 * OffscreenCanvas worker in Phase 4 only if profiling shows jank.
 */
'use client'

import * as React from 'react'
import { useEffect, useRef } from 'react'
import type { TimelineScene } from './musicalTimeline/timelineScene'
import type { LaneLayout } from './musicalTimeline/laneLayout'
import { drawTimeline, type DrawTheme, type WaveformSource } from './musicalTimeline/drawTimeline'
import { useDisplayMeter } from '../state/displayMeter'

export interface SongTimelineCanvasProps {
  readonly scene: TimelineScene
  /** Horizontal scroll offset (content px hidden left) — from FullSongTimeline. */
  readonly scrollLeft: number
  /** Full content width = `contentWidthFor(viewportWidth, zoom)`. */
  readonly contentWidth: number
  /** Visible width (the grid's clientWidth). */
  readonly viewportWidth: number
  /** Per-lane vertical layout (top/height, total) — the single source the draw,
   *  the host height, the DOM labels and the hit-test all share (#422). */
  readonly layout: LaneLayout
  /** Display names of silenced tracks (muted / soloed-out — #731); their lanes
   *  draw faded to mirror the Mixer's dimmed strips (PV155). Absent → none. */
  readonly silencedNames?: ReadonlySet<string>
  /** Decoded-audio lookup for the waveform tier (#1506); absent → marks only. */
  readonly waveforms?: WaveformSource
  /** Bumped when new audio becomes drawable, purely to re-run the draw effect.
   *  The canvas is dirty-flagged on scene/transform/size, and a sample finishing
   *  its decode changes none of those — without this the shape would exist in
   *  memory and never reach the screen. */
  readonly waveformsEpoch?: number
}

/** Literal dark-theme colors (canvas can't read CSS custom properties); these
 *  mirror the DOM `FullSongTimeline` style fallbacks so the views match. */
/** ⚠ EXPORTED for #1464 Stage 2's caption editor, which draws an input over a
 *  caption and must take the SAME colour the canvas gave it — the shared hue is
 *  what ties a bound to its curve on a lane carrying several. Exporting the one
 *  theme rather than copying the literal is what keeps the two in step. */
export const DEFAULT_THEME: DrawTheme = {
  background: '#0f0f1a',
  rowAlt: 'rgba(255,255,255,0.02)',
  section: 'rgba(255,255,255,0.04)',
  sectionAlt: 'rgba(255,255,255,0.07)',
  gridline: 'rgba(255,255,255,0.06)',
  clipFill: 'rgba(255,255,255,0.035)',
  // #1391 — the section name. Dimmer than a note mark on purpose: it identifies
  // the clip without competing with the music drawn inside it.
  clipCaption: 'rgba(255,255,255,0.45)',
  clipBorder: 'rgba(255,255,255,0.18)',
  // #1464 Stage 1 — the automation curve. Brighter than the clip furniture and
  // cooler than the lane colours, so it reads as an overlay ON the lane rather
  // than as another piece of the lane's own content.
  automationLine: 'rgba(140,200,255,0.75)',
}

/** Cap the backing-store DPR — 2D fills are cheap, but matching the viz
 *  `maxDpr` discipline keeps memory bounded on Retina. */
const MAX_DPR = 2

export function SongTimelineCanvas(props: SongTimelineCanvasProps): React.ReactElement {
  const { scene, scrollLeft, contentWidth, viewportWidth, layout, silencedNames, waveforms, waveformsEpoch } = props
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const height = layout.totalHeight
  // The beat grid's subdivision (#1568), from the store the ruler above the
  // canvas reads — one meter, or the grid and the ruler draw different bars.
  const meter = useDisplayMeter()

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    // Coalesce bursts (a scroll + a resize in the same frame) into one draw.
    const raf = requestAnimationFrame(() => {
      const dpr = Math.min(MAX_DPR, typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1)
      const cssW = Math.max(0, viewportWidth)
      const cssH = Math.max(0, height)
      const bw = Math.round(cssW * dpr)
      const bh = Math.round(cssH * dpr)
      if (canvas.width !== bw) canvas.width = bw
      if (canvas.height !== bh) canvas.height = bh
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0) // draw in CSS px
      drawTimeline(ctx, scene, { scrollLeft, contentWidth, viewportWidth: cssW, meter }, DEFAULT_THEME, layout, silencedNames, waveforms)
    })
    return () => cancelAnimationFrame(raf)
    // ⚠ `meter` belongs in these deps, not only in the transform: the canvas
    // redraws on effect re-runs, so a meter change that is not a dependency
    // leaves the beat grid drawn in the old signature until something else
    // happens to move — the exact silent disagreement this setting exists to
    // prevent.
  }, [scene, scrollLeft, contentWidth, viewportWidth, layout, height, silencedNames, waveforms, waveformsEpoch, meter])

  return (
    <canvas
      ref={canvasRef}
      data-full-song-canvas
      // Decorative: canvas is opaque to screen readers, so the accessible
      // surface is the DOM overlay (lane labels, period, ruler) — design §4.3.
      aria-hidden="true"
      style={{
        // Sticky LEFT only (not top): it pins horizontally as the grid scrolls
        // X, but must scroll vertically WITH the lane labels when expanded lanes
        // grow the content past the viewport — a `top` anchor would freeze it
        // against the body's vertical scroll and desync the rows (#422).
        position: 'sticky',
        left: 0,
        display: 'block',
        width: viewportWidth,
        height,
        pointerEvents: 'none', // seek/scroll are handled by the grid container
      }}
    />
  )
}
