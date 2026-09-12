/**
 * #459 — the Song-view note bar scales with the row height, mirroring the live
 * monitor (leafBarHeight). Canvas draws aren't DOM-queryable, so this drives
 * drawTimeline with a mock 2D context that records fillRect(x,y,w,h) and asserts
 * the NOTE mark's height grows with the lane's row height.
 */
import { describe, it, expect } from 'vitest'
import { drawTimeline, type DrawTheme, type DrawTransform } from '../musicalTimeline/drawTimeline'
import { DEFAULT_METER } from '../../lib/meter'
import type { TimelineScene } from '../musicalTimeline/timelineScene'
import type { LaneLayout } from '../musicalTimeline/laneLayout'

interface Rect { x: number; y: number; w: number; h: number }

/** Minimal 2D-context mock — records fillRect, no-ops the rest. */
function mockCtx(): { ctx: CanvasRenderingContext2D; rects: Rect[] } {
  const rects: Rect[] = []
  const ctx = {
    fillStyle: '#000',
    globalAlpha: 1,
    clearRect: () => {},
    setTransform: () => {},
    fillRect: (x: number, y: number, w: number, h: number) => rects.push({ x, y, w, h }),
    beginPath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    stroke: () => {},
    fillText: () => {},
  } as unknown as CanvasRenderingContext2D
  return { ctx, rects }
}

const THEME: DrawTheme = {
  background: '#0f0f1a', rowAlt: 'rgba(255,255,255,0.02)', section: '#111', sectionAlt: '#222',
  gridline: '#333', clipFill: '#444', clipCaption: '#fff', clipBorder: '#555',
  automationLine: '#automationLine',
}
const TRANSFORM: DrawTransform = { scrollLeft: 0, contentWidth: 100, viewportWidth: 100, meter: DEFAULT_METER }

// One percussive note at cycle 0.1 spanning 0.1 cycle → 10px wide at pxPerCycle 100.
function scene(): TimelineScene {
  return {
    lanes: [{
      laneKey: 'd1', displayName: 'd1', color: '#7af', density: [1],
      notes: [{ cycle: 0.1, end: 0.2, pitch: null, gain: 1 }],
      pitchMin: null, pitchMax: null, voices: [],
      clips: [{ armIndex: -1, startCycle: 0, endCycle: 1, label: null, nameRange: null, sectionName: '' }],
      sourceOffset: null, arrangeOffset: null, labelOffset: null, automations: [],
    }],
    sections: [], displayCycles: 1, windowOriginCycles: 0, period: null, peakDensity: 1,
    notesCapped: false,
  }
}

function layout(rowHeight: number): LaneLayout {
  return { boxes: [{ laneKey: 'd1', top: 0, height: rowHeight, expanded: false }], totalHeight: rowHeight }
}

/** The note mark is the only ~10px-wide fill (background/clip span ~100px;
 *  gridlines/borders are 1px). Return its height. */
function noteMarkHeight(rects: Rect[]): number {
  const marks = rects.filter((r) => r.w >= 5 && r.w <= 20)
  expect(marks.length, 'exactly one note mark drawn').toBe(1)
  return marks[0].h
}

describe('#459 Song note bar scales with row height (live-monitor parity)', () => {
  it('a taller row draws a taller note bar', () => {
    const a = mockCtx()
    drawTimeline(a.ctx, scene(), TRANSFORM, THEME, layout(20))
    const short = noteMarkHeight(a.rects)

    const b = mockCtx()
    drawTimeline(b.ctx, scene(), TRANSFORM, THEME, layout(40))
    const tall = noteMarkHeight(b.rects)

    // leafBarHeight-style scaling: max(3, band - 12). At rowHeight 20 → ~3px;
    // at 40 → ~22px. The bar MUST grow, not stay a fixed dab.
    expect(tall).toBeGreaterThan(short)
    expect(short).toBeLessThanOrEqual(6)
    expect(tall).toBeGreaterThanOrEqual(18)
  })
})
