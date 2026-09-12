import { describe, expect, it } from 'vitest'

import {
  WAVEFORM_COLUMN_BUDGET,
  drawTimeline,
  type DrawTheme,
  type DrawTransform,
  type WaveformSource,
} from '../drawTimeline'
import { DEFAULT_METER } from '../../../lib/meter'
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
const transform: DrawTransform = { scrollLeft: 0, contentWidth: 4000, viewportWidth: 400, meter: DEFAULT_METER }

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

  // ── #1512 — the mark draws the slice it PLAYS ────────────────────────────
  //
  // The renderer's half of the region work: that `note.region` reaches
  // `waveformFit` and `waveformColumn` at all. What the pixels then look like is
  // a device question and belongs to the browser arm — a mock reports that a
  // fill was requested, never that anything appeared.

  it('sizes a chopped mark by the quarter it plays, not by the file', () => {
    // 0.4s file at 1 cps over 1000px/cycle = 400px of audio, clipped to the
    // 250px mark. One quarter of it is 100px, which fits.
    const warm: WaveformSource = { cps: 1, peaksFor: () => fullScalePeaks(0.4) }
    const chopped: SceneNote[] = [
      {
        ...oneTake[0],
        region: { begin: 0.5, end: 0.75, speed: 1, unit: null },
      },
    ]
    const { ctx: a, rects: whole } = mockCtx()
    drawTimeline(a, sceneWith(oneTake), transform, theme, tall, undefined, warm)
    const { ctx: b, rects: quarter } = mockCtx()
    drawTimeline(b, sceneWith(chopped), transform, theme, tall, undefined, warm)

    expect(waveformColumns(whole)).toHaveLength(250) // the file overruns the mark
    expect(waveformColumns(quarter)).toHaveLength(100) // its quarter does not
  })

  it('reads the region’s own columns, so two chops of one file differ', () => {
    // An envelope that is silent in its first half and full-scale in its second.
    // Two marks, same file, same width — the only difference is which half each
    // one plays, and that must be the only difference in what is drawn.
    const columns = 16
    const data = new Float32Array(columns * 2)
    for (let i = columns / 2; i < columns; i++) {
      data[i * 2] = -1
      data[i * 2 + 1] = 1
    }
    const warm: WaveformSource = { cps: 1, peaksFor: () => ({ data, columns, duration: 0.2 }) }
    const half = (begin: number, end: number): SceneNote[] => [
      { ...oneTake[0], region: { begin, end, speed: 1, unit: null } },
    ]

    const { ctx: a, rects: firstHalf } = mockCtx()
    drawTimeline(a, sceneWith(half(0, 0.5)), transform, theme, tall, undefined, warm)
    const { ctx: b, rects: secondHalf } = mockCtx()
    drawTimeline(b, sceneWith(half(0.5, 1)), transform, theme, tall, undefined, warm)

    const quiet = waveformColumns(firstHalf)
    const loud = waveformColumns(secondHalf)
    // Same count — the two slices are the same length.
    expect(quiet).toHaveLength(loud.length)
    // …and opposite content: the silent half draws minimum-height columns, the
    // full-scale half spans the mark.
    expect(Math.max(...quiet.map((r) => r.h))).toBe(1)
    expect(Math.min(...loud.map((r) => r.h))).toBeGreaterThan(1)
  })

  it('is byte-for-byte unchanged for a mark with no region', () => {
    // The compatibility claim at the RENDERER, not only in the arithmetic.
    const warm: WaveformSource = { cps: 1, peaksFor: () => fullScalePeaks(0.1) }
    const { ctx: a, rects: before } = mockCtx()
    drawTimeline(a, sceneWith(oneTake), transform, theme, tall, undefined, warm)
    const explicit: SceneNote[] = [
      { ...oneTake[0], region: { begin: 0, end: 1, speed: 1, unit: null } },
    ]
    const { ctx: b, rects: after } = mockCtx()
    drawTimeline(b, sceneWith(explicit), transform, theme, tall, undefined, warm)
    expect(after).toEqual(before)
  })

  it('declines a region too short to draw, leaving the plain bar', () => {
    const warm: WaveformSource = { cps: 1, peaksFor: () => fullScalePeaks(0.1) }
    const sliver: SceneNote[] = [
      { ...oneTake[0], region: { begin: 0, end: 0.01, speed: 1, unit: null } },
    ]
    const { ctx: a, rects: bare } = mockCtx()
    drawTimeline(a, sceneWith(oneTake), transform, theme, tall)
    const { ctx: b, rects: declined } = mockCtx()
    drawTimeline(b, sceneWith(sliver), transform, theme, tall, undefined, warm)
    // 1px of audio is under MIN_WAVEFORM_W, so nothing is drawn — and "nothing"
    // must mean the bar it drew before a source existed at all.
    expect(waveformColumns(declined)).toEqual([])
    expect(declined).toEqual(bare)
  })

  it('stops at the mark’s edge for a sample longer than its slot', () => {
    // 10s of audio in a 250px mark: the mark's width is the whole allowance.
    const warm: WaveformSource = { cps: 1, peaksFor: () => fullScalePeaks(10) }
    const { ctx, rects } = mockCtx()
    drawTimeline(ctx, sceneWith(oneTake), transform, theme, tall, undefined, warm)
    expect(waveformColumns(rects)).toHaveLength(250)
  })

  /**
   * The arm this feature actually needed, and the one it did not have.
   *
   * The bar is drawn at `0.4 + 0.6 × gain` in the lane colour, and the waveform
   * is drawn INSIDE the bar's own height in that same colour. At `gain: 1` the
   * bar is fully opaque, so before the bed existed the shape was painted
   * invisibly — and every geometry arm above still passed, because a recording
   * context reports that a fill was requested, not that anything can be seen.
   */
  it('clears a bed so the shape is visible against a FULL-GAIN bar', () => {
    const warm: WaveformSource = { cps: 1, peaksFor: () => fullScalePeaks(0.1) }
    const loudest = sceneWith([{ cycle: 0, end: 0.25, pitch: null, gain: 1, voice: 'take_1' }])
    const { ctx, rects } = mockCtx()
    drawTimeline(ctx, loudest, transform, theme, tall, undefined, warm)

    const bar = rects.find((r) => r.w === 250 && r.style === LANE_COLOR)!
    expect(bar.alpha).toBe(1) // the bar really is opaque at this gain

    // A recessed bed exists, exactly as wide as the audio, over the bar's band.
    const bed = rects.find(
      (r) => r.style === theme.background && r.w === 100 && r.y === bar.y && r.h === bar.h,
    )
    expect(bed).toBeDefined()
    expect(bed!.alpha).toBeLessThan(1)
  })

  it('draws a waveform at the DEFAULT row height, with no settings changed', () => {
    // The product-level guarantee behind "a take can be seen": 25 is the default
    // sub-row height, giving a 7px mark. If a change ever pushes the threshold
    // above that, takes stop drawing for everyone who has not gone looking for a
    // size setting — and every other arm here, which uses a tall row, stays green.
    const defaultRow = computeLaneLayout(sceneWith(oneTake).lanes, new Set(), 25, 88)
    const warm: WaveformSource = { cps: 1, peaksFor: () => fullScalePeaks(0.1) }
    const { ctx, rects } = mockCtx()
    drawTimeline(ctx, sceneWith(oneTake), transform, theme, defaultRow, undefined, warm)
    expect(waveformColumns(rects).length).toBeGreaterThan(0)
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

  it('reads the tempo once per draw, not once per mark', () => {
    // `cps` is a getter onto the live runtime. Reading it per mark meant a dense
    // lane asked the transport for the tempo two thousand times a frame to be
    // told the same number. Asserted by the reads it makes, not by the pixels:
    // the drawing is identical either way, so only the count can fail.
    const notes: SceneNote[] = Array.from({ length: 12 }, (_, i) => ({
      cycle: i * 0.02, end: i * 0.02 + 0.25, pitch: null, gain: 1, voice: 'take_1',
    }))
    let cpsReads = 0
    const counting: WaveformSource = {
      get cps() {
        cpsReads++
        return 1
      },
      peaksFor: () => fullScalePeaks(0.1),
    }
    const layout = computeLaneLayout(sceneWith(notes).lanes, new Set(), 60, 88)
    const { ctx, rects } = mockCtx()
    drawTimeline(ctx, sceneWith(notes), transform, theme, layout, undefined, counting)

    expect(waveformColumns(rects).length).toBeGreaterThan(100) // marks really drew
    expect(cpsReads).toBe(1) // 1, not 12
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
