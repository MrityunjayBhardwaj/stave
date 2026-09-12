/**
 * The scene and the renderer at a NON-ZERO window origin (#1201).
 *
 * ── WHY THIS FILE EXISTS SEPARATELY ─────────────────────────────────────────
 * Every other arm in this directory builds its scene at origin 0, where the two
 * frames the scene carries — song-absolute cycles, and density indexed from the
 * window origin — are numerically identical. That makes the whole existing suite
 * structurally unable to see an origin bug: it is not that the arms are thin, it
 * is that at origin 0 a correct renderer and one that ignores the origin produce
 * byte-identical output. The same blindness hid the section-bounds defect in
 * #1199, where 36 analysis tests stayed green under a deliberate break.
 *
 * So every arm here uses a window that does NOT start at 0, and each one names
 * the frame it is checking.
 *
 * The reference answer for placement is always the axis (`songCycleToX`), never
 * a number recomputed here — a test that re-derives the mapping would agree with
 * a renderer that got it wrong in the same way.
 */
import { describe, it, expect } from 'vitest'
import { buildTimelineScene, type CollectedMarks, type SceneNote } from '../timelineScene'
import { drawTimeline, type DrawTheme, type DrawTransform } from '../drawTimeline'
import { DEFAULT_METER } from '../../../lib/meter'
import { drawLiveOverlay, markSig } from '../drawLiveOverlay'
import { computeLaneLayout } from '../laneLayout'
import { songCycleToX, type SongWindow } from '../songAxis'
import type { SongAnalysis } from '@stave/editor'

const ORIGIN = 256
const SPAN = 32
const CONTENT_W = 320 // 10 px/cycle — below COARSEN_PX, so lanes draw as density
const VIEW_W = 320
const WIN: SongWindow = { originCycle: ORIGIN, spanCycles: SPAN }

const THEME: DrawTheme = {
  background: '#bg',
  rowAlt: '#rowAlt',
  section: '#sect',
  sectionAlt: '#sectAlt',
  gridline: '#grid',
  clipFill: '#clipFill',
  clipCaption: '#fff', clipBorder: '#clipBorder',
  automationLine: '#automationLine',
}
const TRANSFORM: DrawTransform = {
  scrollLeft: 0,
  contentWidth: CONTENT_W,
  viewportWidth: VIEW_W,
  meter: DEFAULT_METER,
}

type Rect = { op: string; x: number; y: number; w: number; h: number; fill: string; alpha: number }

/** A canvas double that records the rects drawn, with the style in force. */
function recordingCtx(): { ctx: CanvasRenderingContext2D; rects: Rect[] } {
  const rects: Rect[] = []
  const state = { fillStyle: '', globalAlpha: 1 }
  const ctx = new Proxy(
    { measureText: () => ({ width: 8 }) } as Record<string, unknown>,
    {
      get(t, prop: string) {
        if (prop === 'fillStyle') return state.fillStyle
        if (prop === 'globalAlpha') return state.globalAlpha
        if (prop in t) return t[prop]
        return (...args: unknown[]) => {
          if (prop === 'fillRect' || prop === 'strokeRect') {
            const [x, y, w, h] = args as number[]
            rects.push({ op: prop, x, y, w, h, fill: state.fillStyle, alpha: state.globalAlpha })
          }
          return undefined
        }
      },
      set(_t, prop: string, value) {
        if (prop === 'fillStyle') state.fillStyle = String(value)
        else if (prop === 'globalAlpha') state.globalAlpha = Number(value)
        return true
      },
    },
  ) as unknown as CanvasRenderingContext2D
  return { ctx, rects }
}

/** Density indexed FROM the origin: `onsetsByCycle[0]` is song cycle `ORIGIN`. */
function windowDensity(at: Record<number, number>): number[] {
  const d = new Array<number>(SPAN).fill(0)
  for (const [i, v] of Object.entries(at)) d[Number(i)] = v
  return d
}

function analysisAtOrigin(density: number[]): SongAnalysis {
  return {
    periodCycles: null,
    horizonCycles: SPAN,
    lanes: [{ laneKey: 'bass', onsetsByCycle: density }],
    // Sections partition the window in SONG-ABSOLUTE bounds.
    sections: [
      { startCycle: ORIGIN, endCycle: ORIGIN + 16, laneKeys: ['bass'] },
      { startCycle: ORIGIN + 16, endCycle: ORIGIN + SPAN, laneKeys: ['bass'] },
    ],
    displaySpan: { kind: 'capped', cycles: SPAN },
  }
}

function marksWith(notes: SceneNote[], clips = true): CollectedMarks {
  return {
    marksByLane: notes.length ? new Map([['bass', notes]]) : new Map(),
    sourceByLane: new Map(),
    arrangeByLane: new Map(),
    labelOffsetByLane: new Map(),
    clipsByLane: clips
      ? new Map([['bass', [{ armIndex: 0, startCycle: ORIGIN, endCycle: ORIGIN + SPAN, label: null, nameRange: null, sectionName: '' }]]])
      : new Map(),
    capped: false,
  }
}

function draw(scene: ReturnType<typeof buildTimelineScene>) {
  const layout = computeLaneLayout(
    scene.lanes.map((l) => ({ laneKey: l.laneKey })),
    new Set(),
    24,
    80,
  )
  const { ctx, rects } = recordingCtx()
  drawTimeline(ctx, scene, TRANSFORM, THEME, layout)
  return rects
}

describe('the scene at a non-zero window origin (#1201)', () => {
  it('carries the origin, so a consumer can tell which cycles its density covers', () => {
    const scene = buildTimelineScene(analysisAtOrigin(windowDensity({ 0: 1 })), WIN, null, null, marksWith([]))
    expect(scene.windowOriginCycles).toBe(ORIGIN)
    // The span is unchanged by paging — a window is as wide as it is, wherever it sits.
    expect(scene.displayCycles).toBe(SPAN)
  })

  it("gives a bare track's implicit clip the window's ABSOLUTE bounds, not [0, span)", () => {
    // No clipsByLane → the builder synthesises the implicit clip.
    const scene = buildTimelineScene(
      analysisAtOrigin(windowDensity({ 0: 1 })), WIN, null, null,
      marksWith([], false),
    )
    expect(scene.lanes[0]!.clips).toEqual([
      { armIndex: -1, startCycle: ORIGIN, endCycle: ORIGIN + SPAN, label: null, nameRange: null, sectionName: '' },
    ])
  })

  it('buckets an eval-backed lane’s density relative to the origin', () => {
    // An eval lane has marks but no analysis lane, so its density is counted from
    // the note cycles here — which are absolute and must land at index 0, not 256.
    const note = (cycle: number): SceneNote => ({ cycle, end: cycle + 0.25, pitch: null, gain: 1 })
    const evalMarks: CollectedMarks = {
      ...marksWith([]),
      marksByLane: new Map([['evalLane', [note(ORIGIN), note(ORIGIN), note(ORIGIN + 5)]]]),
    }
    const scene = buildTimelineScene(null, WIN, null, null, evalMarks)
    const lane = scene.lanes.find((l) => l.laneKey === 'evalLane')!
    expect(lane.density[0]).toBe(2)
    expect(lane.density[5]).toBe(1)
    // And nothing spilled outside the window.
    expect(lane.density.reduce((a, b) => a + b, 0)).toBe(3)
  })
})

describe('the density colour scale’s basis (#1201)', () => {
  // A quiet window: its busiest cell is 2 onsets.
  const quiet = () => analysisAtOrigin(windowDensity({ 0: 2, 8: 1 }))

  it('normalises over this window alone when no basis is carried', () => {
    const scene = buildTimelineScene(quiet(), WIN, null, null, marksWith([]))
    expect(scene.peakDensity).toBe(2)
  })

  it('honours a carried basis so a quieter window does not silently rescale', () => {
    // The same quiet window, told that the song peaks at 8 elsewhere. Its cells
    // must stay dim relative to that, not be stretched to full intensity.
    const scene = buildTimelineScene(quiet(), WIN, null, 8, marksWith([]))
    expect(scene.peakDensity).toBe(8)
  })

  it('still rises to this window when it is busier than the carried basis', () => {
    // The carried value is a FLOOR, not a ceiling — clipping a busy window to a
    // stale peak would push its loudest cells past full intensity.
    const scene = buildTimelineScene(
      analysisAtOrigin(windowDensity({ 0: 20 })), WIN, null,
      8,
      marksWith([]),
    )
    expect(scene.peakDensity).toBe(20)
  })
})

describe('the renderer at a non-zero window origin (#1201)', () => {
  it('draws section bands at their place in the window, not off-screen', () => {
    const rects = draw(
      buildTimelineScene(analysisAtOrigin(windowDensity({ 0: 1 })), WIN, null, null, marksWith([])),
    )
    const bands = rects.filter((r) => r.fill === THEME.section || r.fill === THEME.sectionAlt)
    expect(bands.length).toBe(2)
    // Section [256, 272) starts at the left edge; [272, 288) at the midpoint.
    expect(bands.map((b) => Math.round(b.x))).toEqual([
      Math.round(songCycleToX(ORIGIN, WIN, CONTENT_W)),
      Math.round(songCycleToX(ORIGIN + 16, WIN, CONTENT_W)),
    ])
  })

  it('draws clip segments at their place in the window, not off-screen', () => {
    const rects = draw(
      buildTimelineScene(analysisAtOrigin(windowDensity({ 0: 1 })), WIN, null, null, marksWith([])),
    )
    const fills = rects.filter((r) => r.fill === THEME.clipFill)
    expect(fills.length).toBe(1)
    expect(Math.round(fills[0]!.x)).toBe(Math.round(songCycleToX(ORIGIN, WIN, CONTENT_W)))
    expect(Math.round(fills[0]!.w)).toBe(CONTENT_W)
  })

  it('places density cells where the axis puts their absolute cycle', () => {
    const scene = buildTimelineScene(
      analysisAtOrigin(windowDensity({ 0: 4, 16: 2 })), WIN, null, null,
      marksWith([]),
    )
    const rects = draw(scene)
    // Density CELLS only: the empty-clip outline is painted in the same lane
    // colour but is always 1px in one dimension, and matching it here would make
    // this arm redden for a clip-content bug it is not about.
    const cells = rects.filter((r) => r.fill === scene.lanes[0]!.color && r.w > 1 && r.h > 1)
    expect(cells.length).toBe(2)
    // Index 0 → cycle 256 → x 0. Index 16 → cycle 272 → x 160.
    expect(cells.map((c) => Math.round(c.x))).toEqual([
      Math.round(songCycleToX(ORIGIN, WIN, CONTENT_W)),
      Math.round(songCycleToX(ORIGIN + 16, WIN, CONTENT_W)),
    ])
  })

  it('draws note marks inside the window instead of culling them as out of range', () => {
    // Zoom in past COARSEN_PX so the lane renders marks rather than density, and
    // keep the mark near the window start so it is genuinely on screen.
    const wideW = SPAN * 30
    const scene = buildTimelineScene(
      analysisAtOrigin(windowDensity({ 0: 1 })), WIN, null, null,
      marksWith([{ cycle: ORIGIN + 0.5, end: ORIGIN + 1, pitch: 48, gain: 1 }]),
    )
    const layout = computeLaneLayout([{ laneKey: 'bass' }], new Set(), 24, 80)
    const { ctx, rects } = recordingCtx()
    drawTimeline(
      ctx,
      scene,
      { scrollLeft: 0, contentWidth: wideW, viewportWidth: VIEW_W, meter: DEFAULT_METER },
      THEME,
      layout,
    )
    const marks = rects.filter((r) => r.fill === scene.lanes[0]!.color)
    expect(marks.length).toBe(1)
    expect(Math.round(marks[0]!.x)).toBe(
      Math.round(songCycleToX(ORIGIN + 0.5, { originCycle: ORIGIN, spanCycles: SPAN }, wideW)),
    )
  })

  it('lights a playing mark at the same x the base renderer drew it', () => {
    // The live overlay is a SECOND renderer over the same scene, and it carried
    // its own copy of the origin-blind transform. A glow that disagrees with the
    // base mark is the visible symptom; at a non-zero origin nothing lit at all.
    const wideW = SPAN * 30
    const note: SceneNote = { cycle: ORIGIN + 0.5, end: ORIGIN + 1, pitch: 48, gain: 1 }
    const scene = buildTimelineScene(
      analysisAtOrigin(windowDensity({ 0: 1 })), WIN, null, null,
      marksWith([note]),
    )
    const layout = computeLaneLayout([{ laneKey: 'bass' }], new Set(), 24, 80)
    const tf: DrawTransform = { scrollLeft: 0, contentWidth: wideW, viewportWidth: VIEW_W, meter: DEFAULT_METER }

    const base = recordingCtx()
    drawTimeline(base.ctx, scene, tf, THEME, layout)
    const baseMark = base.rects.find((r) => r.fill === scene.lanes[0]!.color && r.w > 1 && r.h > 1)!

    const over = recordingCtx()
    drawLiveOverlay(over.ctx, scene, tf, layout, ORIGIN + 0.5, new Set([markSig(note.voice, note.pitch)]), {
      lit: '#core',
      litGlow: '#glow',
    })
    const lit = over.rects.filter((r) => r.fill === '#core')
    expect(lit.length).toBeGreaterThan(0)
    // The glow sits over its own note, not somewhere else in the song.
    expect(Math.round(lit[0]!.x)).toBe(Math.round(baseMark.x))
  })

  it('reads a clip’s content from the density it actually covers', () => {
    // A density-only lane (no note marks): the ONLY way to know the clip has
    // content is the density loop, which is the one that silently never ran.
    const withContent = draw(
      buildTimelineScene(analysisAtOrigin(windowDensity({ 3: 5 })), WIN, null, null, marksWith([])),
    ).filter((r) => r.fill === THEME.clipBorder).length
    const empty = draw(
      buildTimelineScene(analysisAtOrigin(windowDensity({})), WIN, null, null, marksWith([])),
    ).filter((r) => r.fill === THEME.clipBorder).length
    // An empty clip gets the extra outline pass; a clip with content does not.
    expect(withContent).toBe(2)
    expect(empty).toBeGreaterThan(withContent)
  })
})

/**
 * THE POINT OF THE SEAM (#1201). Everything above proves the scene handles a
 * non-zero origin; these two prove it no longer needs a whole SONG to do it.
 *
 * A real `analyzeWindow` result is passed straight in, with no adapter and no
 * synthesised period or display span. If that ever requires a conversion step
 * again, these stop compiling — which is the outcome worth protecting, because
 * the conversion that would be reached for is precisely the one that puts a
 * `periodCycles: null` on a window and lets a paged view re-decide the period.
 */
describe('the scene accepts a windowed analysis directly (#1201)', () => {
  /** Shaped exactly as `analyzeWindow` returns: no period, no display span. */
  const windowAnalysis = {
    originCycle: ORIGIN,
    spanCycles: SPAN,
    lanes: [{ laneKey: 'bass', onsetsByCycle: windowDensity({ 0: 3, 8: 1 }) }],
    sections: [{ startCycle: ORIGIN, endCycle: ORIGIN + SPAN, laneKeys: ['bass'] }],
    complete: true,
  }

  it('draws from a WindowAnalysis with no adapter and no invented period', () => {
    // It is its OWN window descriptor — origin and span under the names the axis
    // already uses, so nothing has to be restated at the call site.
    const scene = buildTimelineScene(windowAnalysis, windowAnalysis, null, null, marksWith([]))
    expect(scene.windowOriginCycles).toBe(ORIGIN)
    expect(scene.displayCycles).toBe(SPAN)
    expect(scene.lanes.map((l) => l.laneKey)).toEqual(['bass'])
    expect(scene.peakDensity).toBe(3)
    // A window cannot claim a period, and the scene does not invent one for it.
    expect(scene.period).toBeNull()
  })

  it('places its density at the SONG-ABSOLUTE cycle, not the array index', () => {
    const scene = buildTimelineScene(windowAnalysis, windowAnalysis, null, null, marksWith([]))
    const rects = draw(scene)
    // `onsetsByCycle[8]` is song cycle ORIGIN + 8 — the axis says where that is,
    // and re-deriving it here would agree with a renderer wrong the same way.
    const expected = songCycleToX(ORIGIN + 8, WIN, CONTENT_W)
    expect(rects.some((r) => Math.abs(r.x - expected) < 1.5)).toBe(true)
    // ...and NOT at the index read as an absolute cycle, which is off-window.
    const wrong = songCycleToX(8, WIN, CONTENT_W)
    expect(Math.abs(expected - wrong)).toBeGreaterThan(10)
  })
})
