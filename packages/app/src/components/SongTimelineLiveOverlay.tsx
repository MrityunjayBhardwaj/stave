/**
 * SongTimelineLiveOverlay — the per-note LIVE layer over the canvas Song
 * timeline (#500 / U3, timeline unification #497).
 *
 * Live's killer feature — always-on per-note real-time feedback — folded onto
 * the canvas. A SECOND canvas rides exactly over `SongTimelineCanvas` (same
 * sticky viewport pin, pulled back over it with a negative margin) and lights
 * the scene marks that are sounding right now. It owns:
 *   1. a `HapStream` subscription → a firing SIGNATURE set (`voice|pitch`), with
 *      the same show/clear timing the live monitor uses (`scheduledAheadMs` →
 *      `audioDuration`), so a mark glows exactly while its note sounds; and
 *   2. a per-frame redraw — keyed on the playhead cycle the parent advances each
 *      animation frame, so the lit set tracks the following playhead. When
 *      stopped (`playheadCycle == null`) it clears and idles (no free rAF; the
 *      parent's gated playhead loop is the only clock).
 *
 * The DRAW is pure (`drawLiveOverlay`): "lit" is a draw-STATE change over the
 * base geometry (`laneMarkBands`/`markRect`), so a lit mark lands exactly over
 * its base mark. The base canvas stays dirty-flagged and static — only this thin
 * overlay repaints per frame, and only the few lit marks (design §4 / R3).
 */
'use client'

import * as React from 'react'
import { useEffect, useRef, useState } from 'react'
import type { HapStream, HapEvent } from '@stave/editor'
import type { TimelineScene } from './musicalTimeline/timelineScene'
import type { LaneLayout } from './musicalTimeline/laneLayout'
import {
  drawLiveOverlay,
  markSig,
  type LiveOverlayTheme,
} from './musicalTimeline/drawLiveOverlay'
import type { WaveformSource } from './musicalTimeline/drawTimeline'

export interface SongTimelineLiveOverlayProps {
  readonly scene: TimelineScene
  readonly layout: LaneLayout
  /** Horizontal scroll offset (content px hidden left) — same as the base canvas. */
  readonly scrollLeft: number
  /** Full content width = `contentWidthFor(viewportWidth, zoom)`. */
  readonly contentWidth: number
  /** Visible width (the grid's clientWidth). */
  readonly viewportWidth: number
  /** Wrapped song-position cycle the parent advances each frame (the same value
   *  that places the DOM playhead), or null when stopped → overlay clears. */
  readonly playheadCycle: number | null
  /** Live hap stream accessor (closure-stable through a ref at StaveApp). */
  readonly getHapStream: () => HapStream | null
  /** The same decoded-audio lookup the base canvas draws waveforms from (#1506).
   *  Used here only to ask WHETHER a mark is showing a shape, so a lit mark can
   *  outline instead of cover it (#1508) — never for the envelope itself.
   *  Optional: without it every mark lights exactly as it did before. */
  readonly waveforms?: WaveformSource
}

/** Cap the backing-store DPR — matches the base canvas + the viz `maxDpr`. */
const MAX_DPR = 2

/** Lit colours (canvas can't read CSS custom properties). A bright near-white
 *  core over a soft accent glow reads clearly as "sounding now" against the
 *  base lane colours, at any lane tint. */
const THEME: LiveOverlayTheme = {
  lit: 'rgba(255,255,255,0.95)',
  litGlow: 'rgba(140,190,255,0.9)',
}

const EMPTY_SIGS: ReadonlySet<string> = new Set()

export function SongTimelineLiveOverlay(
  props: SongTimelineLiveOverlayProps,
): React.ReactElement {
  const {
    scene,
    layout,
    scrollLeft,
    contentWidth,
    viewportWidth,
    playheadCycle,
    getHapStream,
    waveforms,
  } = props
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const height = layout.totalHeight

  // ── Firing signature set, fed by the hap stream ───────────────────────────
  // A multiset (sig → count) so overlapping same-voice/pitch haps don't clear
  // one another early; `activeSigsRef` is the derived membership set the draw
  // reads each frame. Kept in refs (not state) so a hap fire never re-renders —
  // the parent's per-frame playhead update is what repaints the overlay.
  const activeCountRef = useRef<Map<string, number>>(new Map())
  const activeSigsRef = useRef<ReadonlySet<string>>(EMPTY_SIGS)
  const timeoutIdsRef = useRef<number[]>([])
  const rebuildSigs = (): void => {
    const s = new Set<string>()
    for (const [sig, c] of activeCountRef.current) if (c > 0) s.add(sig)
    activeSigsRef.current = s
  }

  // Resolve the live HapStream reactively — the accessor returns a new instance
  // after a runtime swap (file switch). The scene identity is the reactive seam
  // (it changes on every re-eval, like the snapshot the live monitor keys on);
  // the accessor itself is a fresh closure each render, so read it through a ref.
  const getHapStreamRef = useRef(getHapStream)
  getHapStreamRef.current = getHapStream
  const [hapStream, setHapStream] = useState<HapStream | null>(() => getHapStream())
  useEffect(() => {
    const next = getHapStreamRef.current()
    setHapStream((prev) => (prev === next ? prev : next))
  }, [scene])

  useEffect(() => {
    if (!hapStream) return
    const handler = (event: HapEvent): void => {
      // Address by VOICE + PITCH (design §4) — the dimensions a hap carries. A
      // hap has no trackId, so WHICH occurrence is sounding is recovered by the
      // nearest-occurrence selection in `pickLitNotes`, not this key (#507).
      const sig = markSig(event.s, event.midiNote)
      // Same timing as the live monitor (MusicalTimeline / useHighlighting):
      // show after the lookahead, clear after the audible duration.
      const showDelay = Math.max(0, event.scheduledAheadMs)
      const clearDelay = showDelay + event.audioDuration * 1000
      const showId = window.setTimeout(() => {
        const m = activeCountRef.current
        m.set(sig, (m.get(sig) ?? 0) + 1)
        rebuildSigs()
      }, showDelay)
      const clearId = window.setTimeout(() => {
        const m = activeCountRef.current
        const c = (m.get(sig) ?? 0) - 1
        if (c <= 0) m.delete(sig)
        else m.set(sig, c)
        rebuildSigs()
      }, clearDelay)
      timeoutIdsRef.current.push(showId, clearId)
    }
    hapStream.on(handler)
    return () => {
      hapStream.off(handler)
      for (const id of timeoutIdsRef.current) clearTimeout(id)
      timeoutIdsRef.current = []
      activeCountRef.current.clear()
      activeSigsRef.current = EMPTY_SIGS
    }
  }, [hapStream])

  // ── Per-frame redraw ──────────────────────────────────────────────────────
  // Keyed on the transform + the playhead cycle the parent advances each frame,
  // so the lit set tracks the playhead. Reads `activeSigsRef` at draw time (the
  // freshest firing set). A rAF coalesces a scroll + playhead change in one frame.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
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
      drawLiveOverlay(
        ctx,
        scene,
        { scrollLeft, contentWidth, viewportWidth: cssW },
        layout,
        playheadCycle,
        activeSigsRef.current,
        THEME,
        waveforms,
      )
    })
    return () => cancelAnimationFrame(raf)
    // `waveforms` needs no epoch dependency the way the base canvas does: this
    // effect already reruns on every `playheadCycle` tick, and the overlay draws
    // nothing unless something is sounding — so a decode that lands mid-playback
    // is picked up on the very next frame.
  }, [scene, layout, scrollLeft, contentWidth, viewportWidth, playheadCycle, height, waveforms])

  return (
    <canvas
      ref={canvasRef}
      data-full-song-overlay
      aria-hidden="true"
      style={{
        // Pin to the viewport exactly like the base canvas (sticky left:0), then
        // pull back over it with a negative top margin so the two overlap (both
        // are the same size). The base canvas draws the static scene; this one
        // the lit marks on top. Pointer-events stay on the grid container.
        position: 'sticky',
        left: 0,
        marginTop: -height,
        display: 'block',
        width: viewportWidth,
        height,
        pointerEvents: 'none',
      }}
    />
  )
}
