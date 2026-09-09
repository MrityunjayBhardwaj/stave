import { describe, expect, it } from 'vitest'

import {
  WAVEFORM_COLUMN_BUDGET,
  drawTimeline,
  type DrawTheme,
  type DrawTransform,
  type WaveformSource,
} from '../drawTimeline'
import { computeLaneLayout } from '../laneLayout'
import { MIN_WAVEFORM_H } from '../waveformLane'
import type { SceneNote, TimelineScene } from '../timelineScene'

/**
 * The waveform tier wired into the renderer (#1506).
 *
 * Assertions here are exact because the recording context reports what was
 * REQUESTED — this is the renderer's arithmetic, with no rasteriser and no
 * device in between. What a real canvas actually puts on screen is a separate
 * question and belongs to a browser arm.
 *
 * The claim each arm defends is that the feature is ADDITIVE: without a source,
 * or with one that has nothing decoded, the scene must draw byte-for-byte what
 * it drew before.
 */

interface Rect { x: number; y: number; w: number; h: number; style: string; alpha: number }

function mockCtx() {
  const rects: Rect[] = []
  const ctx = {
    fillStyle: '' as string,
    globalAlpha: 1,
    font: '' as string,
    textBaseline: '' as string,
    clearRect() {},
    save() {},
    restore() {},
    fillRect(x: number, y: number, w: number, h: number) {
      rects.push({ x, y, w, h, style: ctx.fillStyle, alpha: ctx.globalAlpha })
    },
    fillText() {},
    measureText(text: string) {
      return { width: text.length * 6 } as TextMetrics
    },
  }
  return { ctx: ctx as unknown as CanvasRenderingContext2D, rects }
}

const theme: DrawTheme = {
  background: '#000', rowAlt: '#111', section: '#222', sectionAlt: '#333',
  gridline: '#444', clipFill: '#555', clipCaption: '#fff', clipBorder: '#666',
  automationLine: '#777',
}

const LANE_COLOR = '#0af'

function sceneWith(notes: SceneNote[]): TimelineScene {
  return {
    displayCycles: 4,
    windowOriginCycles: 0,
    period: 4,
    peakDensity: 2,
    notesCapped: false,
    sections: [{ startCycle: 0, endCycle: 4, laneKeys: ['drums'] }],
    lanes: [
      {
        laneKey: 'drums',
        displayName: 'drums',
        color: LANE_COLOR,
        density: [1, 0, 0, 0],
        notes,
        pitchMin: null,
        pitchMax: null,
        voices: [{ key: 'take_1', label: 'take_1', melodic: false, pitchMin: null, pitchMax: null }],
        clips: [],
        sourceOffset: null,
        arrangeOffset: null,
        labelOffset: null,
        automations: [],
      },
    ],
  }
}

/** One percussive take at cycle 0, a quarter-cycle long. */
const oneTake: SceneNote[] = [{ cycle: 0, end: 0.25, pitch: null, gain: 1, voice: 'take_1' }]

/** A tall row, so the height gate is open and the width gate is what is tested. */
const tall = computeLaneLayout(sceneWith(oneTake).lanes, new Set(), 60, 88)
/** 1000px per cycle → a quarter-cycle mark is 250px wide. */
const transform: DrawTransform = { scrollLeft: 0, contentWidth: 4000, viewportWidth: 400 }

/** An envelope that is full-scale everywhere, so every column is unmistakable. */
function fullScalePeaks(duration: number, columns = 16) {
  const data = new Float32Array(columns * 2)
  for (let i = 0; i < columns; i++) {
    data[i * 2] = -1
    data[i * 2 + 1] = 1
  }
  return { data, columns, duration }
}

/** Columns are the renderer's waveform signature: 1px wide, in the lane colour. */
function waveformColumns(rects: Rect[]): Rect[] {
  return rects.filter((r) => r.w === 1 && r.style === LANE_COLOR)
}

describe('drawTimeline — waveform tier', () => {
  it('draws exactly what it always drew when no source is supplied', () => {
    const { ctx, rects } = mockCtx()
    drawTimeline(ctx, sceneWith(oneTake), transform, theme, tall)
    expect(waveformColumns(rects)).toEqual([])
  })

  it('draws exactly what it always drew while the sample is undecoded', () => {
    const { ctx: a, rects: before } = mockCtx()
    drawTimeline(a, sceneWith(oneTake), transform, theme, tall)

    const cold: WaveformSource = { cps: 1, peaksFor: () => null }
    const { ctx: b, rects: after } = mockCtx()
    drawTimeline(b, sceneWith(oneTake), transform, theme, tall, undefined, cold)

    // Byte-for-byte, not merely "no waveform": a cold cache must be invisible.
    expect(after).toEqual(before)
  })

  it('draws one 1px column per pixel of audio once the sample is decoded', () => {
    // 0.1s at 1 cps over 1000px/cycle = 100px of audio inside a 250px mark.
    const warm: WaveformSource = { cps: 1, peaksFor: () => fullScalePeaks(0.1) }
    const { ctx, rects } = mockCtx()
    drawTimeline(ctx, sceneWith(oneTake), transform, theme, tall, undefined, warm)

    const cols = waveformColumns(rects)
    expect(cols).toHaveLength(100)
    // They start at the mark's own left edge and run contiguously from it.
    expect(cols[0].x).toBe(0)
    expect(cols[cols.length - 1].x).toBe(99)
    // Full-scale peaks span the mark's full height, centred on it.
    expect(cols[0].h).toBeCloseTo(rects.find((r) => r.w === 250)!.h, 6)
  })

  it('stops at the mark’s edge for a sample longer than its slot', () => {
    // 10s of audio in a 250px mark: the mark's width is the whole allowance.
    const warm: WaveformSource = { cps: 1, peaksFor: () => fullScalePeaks(10) }
    const { ctx, rects } = mockCtx()
    drawTimeline(ctx, sceneWith(oneTake), transform, theme, tall, undefined, warm)
    expect(waveformColumns(rects)).toHaveLength(250)
  })

  it('never asks about a synth note, which has no sample to draw', () => {
    const asked: string[] = []
    const source: WaveformSource = {
      cps: 1,
      peaksFor: (voice) => {
        asked.push(voice)
        return fullScalePeaks(0.1)
      },
    }
    const synth = sceneWith([{ cycle: 0, end: 0.25, pitch: 60, gain: 1, voice: null }])
    const { ctx } = mockCtx()
    drawTimeline(ctx, synth, transform, theme, tall, undefined, source)
    expect(asked).toEqual([])
  })

  it('declines on a short row, however wide the mark is', () => {
    const shortRow = computeLaneLayout(sceneWith(oneTake).lanes, new Set(), 22, 88)
    const warm: WaveformSource = { cps: 1, peaksFor: () => fullScalePeaks(0.1) }
    const { ctx, rects } = mockCtx()
    drawTimeline(ctx, sceneWith(oneTake), transform, theme, shortRow, undefined, warm)
    // The bar is still there; only the detail is gone.
    expect(waveformColumns(rects)).toEqual([])
    expect(rects.some((r) => r.style === LANE_COLOR)).toBe(true)
    // …and the reason is the row, not the source: it is under the height gate.
    expect(rects.find((r) => r.w === 250)!.h).toBeLessThan(MIN_WAVEFORM_H)
  })

  /**
   * Asserted by the WORK AVOIDED, not by the pixels produced. Two marks of the
   * same voice yield identical columns whether the lookup is memoised or not, so
   * comparing output could not fail; counting lookups can.
   */
  it('looks a voice up once per draw, not once per mark', () => {
    const notes: SceneNote[] = Array.from({ length: 8 }, (_, i) => ({
      cycle: i * 0.4, end: i * 0.4 + 0.25, pitch: null, gain: 1, voice: 'take_1',
    }))
    let lookups = 0
    const counting: WaveformSource = {
      cps: 1,
      peaksFor: () => {
        lookups++
        return fullScalePeaks(0.1)
      },
    }
    const layout = computeLaneLayout(sceneWith(notes).lanes, new Set(), 60, 88)
    const { ctx, rects } = mockCtx()
    drawTimeline(ctx, sceneWith(notes), transform, theme, layout, undefined, counting)

    expect(waveformColumns(rects).length).toBeGreaterThan(100) // several marks drew
    expect(lookups).toBe(1) // 1, not 8
  })

  it('asks again for a different pitch, because that can be a different file', () => {
    const asked: (number | null)[] = []
    const source: WaveformSource = {
      cps: 1,
      peaksFor: (_voice, pitch) => {
        asked.push(pitch)
        return fullScalePeaks(0.1)
      },
    }
    const notes: SceneNote[] = [
      { cycle: 0, end: 0.25, pitch: 48, gain: 1, voice: 'piano' },
      { cycle: 0.4, end: 0.65, pitch: 72, gain: 1, voice: 'piano' },
      { cycle: 0.8, end: 1.05, pitch: 48, gain: 1, voice: 'piano' },
    ]
    const layout = computeLaneLayout(sceneWith(notes).lanes, new Set(), 60, 88)
    const { ctx } = mockCtx()
    drawTimeline(ctx, sceneWith(notes), transform, theme, layout, undefined, source)
    expect(asked).toEqual([48, 72]) // the repeat of 48 was memoised
  })

  it('spends no more than its per-frame column budget', () => {
    // 400 overlapping 250px marks packed inside the 400px viewport, so ~100k
    // columns are ASKED for. Spacing matters: at a coarser spacing the marks
    // scroll off-screen and are culled before the budget is reached, which makes
    // the cap true for a reason that has nothing to do with the cap.
    const notes: SceneNote[] = Array.from({ length: 400 }, (_, i) => ({
      cycle: i * 0.001, end: i * 0.001 + 0.25, pitch: null, gain: 1, voice: 'take_1',
    }))
    const warm: WaveformSource = { cps: 1, peaksFor: () => fullScalePeaks(10) }
    const layout = computeLaneLayout(sceneWith(notes).lanes, new Set(), 60, 88)
    const { ctx, rects } = mockCtx()
    drawTimeline(ctx, sceneWith(notes), transform, theme, layout, undefined, warm)
    // Exactly the budget: spent to the last column and not one past it. An
    // inequality would also hold if the cap were never reached at all.
    expect(waveformColumns(rects)).toHaveLength(WAVEFORM_COLUMN_BUDGET)
  })
})
