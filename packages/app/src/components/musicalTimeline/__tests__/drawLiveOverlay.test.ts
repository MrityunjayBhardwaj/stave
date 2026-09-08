import { describe, it, expect } from 'vitest'
import {
  drawLiveOverlay,
  pickLitNotes,
  markSig,
  MIN_LIT_CYCLES,
  MAX_LIT_DISTANCE_CYCLES,
  type LiveOverlayTheme,
} from '../drawLiveOverlay'
import { laneMarkBands, markRect, COARSEN_PX } from '../drawTimeline'
import { computeLaneLayout } from '../laneLayout'
import type { TimelineScene, SceneNote } from '../timelineScene'

/** Recording mock 2D context — captures fillRect (the only primitive the
 *  overlay draws), like drawTimeline.test's harness. */
function mockCtx(): {
  ctx: CanvasRenderingContext2D
  rects: Array<{ x: number; y: number; w: number; h: number }>
  calls: { clears: number }
} {
  const rects: Array<{ x: number; y: number; w: number; h: number }> = []
  const calls = { clears: 0 }
  const ctx = {
    fillStyle: '',
    globalAlpha: 1,
    clearRect() {
      calls.clears++
    },
    fillRect(x: number, y: number, w: number, h: number) {
      rects.push({ x, y, w, h })
    },
  } as unknown as CanvasRenderingContext2D
  return { ctx, rects, calls }
}

const THEME: LiveOverlayTheme = { lit: '#fff', litGlow: '#88f' }

/** One lane, one melodic voice with two pitched notes. */
function sceneFixture(): TimelineScene {
  const notes: SceneNote[] = [
    { cycle: 1, end: 1.5, pitch: 60, gain: 1, voice: 'saw' },
    { cycle: 2, end: 2.5, pitch: 67, gain: 0.5, voice: 'saw' },
  ]
  return {
    lanes: [
      {
        laneKey: 'a',
        displayName: 'a',
        color: '#f00',
        density: [0, 1, 1, 0],
        notes,
        pitchMin: 60,
        pitchMax: 67,
        voices: [{ key: 'saw', label: 'saw', melodic: true, pitchMin: 60, pitchMax: 67 }],
        clips: [{ armIndex: -1, startCycle: 0, endCycle: 4, label: null, nameRange: null, sectionName: '' }],
        sourceOffset: null,
        arrangeOffset: null,
        labelOffset: null,
        automations: [],
      },
    ],
    sections: [],
    displayCycles: 4,
    windowOriginCycles: 0,
    period: null,
    peakDensity: 1,
    notesCapped: false,
  }
}

// Wide transform → pxPerCycle = 4000/4 = 1000 ≫ COARSEN_PX → marks mode.
const WIDE = { scrollLeft: 0, contentWidth: 4000, viewportWidth: 4000 }

describe('markSig', () => {
  it('keys by voice+pitch, with null collapsing to the empty segment', () => {
    expect(markSig('bd', null)).toBe('bd|') // a drum hit
    expect(markSig(null, 60)).toBe('|60') // a bare synth note
    expect(markSig('piano', 48)).toBe('piano|48') // a sampled melodic note
    expect(markSig(undefined, undefined)).toBe('|')
  })
  it('a hap and its scene mark agree on the same sig', () => {
    // hap-side (s, midiNote) === mark-side (voice, pitch)
    expect(markSig('saw', 60)).toBe(markSig('saw', 60))
  })
})

describe('pickLitNotes (#507 nearest-occurrence)', () => {
  const note: SceneNote = { cycle: 1, end: 1.5, pitch: 60, gain: 1, voice: 'saw' }
  const active = new Set(['saw|60'])

  it('lights a note inside its window when the sig is firing', () => {
    expect(pickLitNotes([note], 1.2, active).has(note)).toBe(true)
  })
  it('still lights a SHORT note while its sig fires even when the playhead has drifted just past it (the offset the strict gate missed)', () => {
    // playhead 0.1 cycle past the 0.5-wide note's end — within MAX_LIT_DISTANCE.
    expect(pickLitNotes([note], 1.6, active).has(note)).toBe(true)
    // and just before the onset, too.
    expect(pickLitNotes([note], 0.9, active).has(note)).toBe(true)
  })
  it('dark when the sig is NOT firing (degrade: mark exists but did not sound)', () => {
    expect(pickLitNotes([note], 1.2, new Set()).size).toBe(0)
    expect(pickLitNotes([note], 1.2, new Set(['bd|'])).size).toBe(0)
  })
  it('picks the occurrence of a sig NEAREST the playhead (disambiguates repeats)', () => {
    const near: SceneNote = { cycle: 4, end: 4.06, pitch: 60, gain: 1, voice: 'saw' }
    const far: SceneNote = { cycle: 0, end: 0.06, pitch: 60, gain: 1, voice: 'saw' }
    const lit = pickLitNotes([far, near], 4.0, active)
    expect(lit.has(near)).toBe(true)
    expect(lit.has(far)).toBe(false)
    expect(lit.size).toBe(1)
  })
  it('does not light a stale occurrence beyond MAX_LIT_DISTANCE_CYCLES', () => {
    const far: SceneNote = { cycle: 0, end: 0.06, pitch: 60, gain: 1, voice: 'saw' }
    expect(pickLitNotes([far], far.cycle + MAX_LIT_DISTANCE_CYCLES + 0.2, active).size).toBe(0)
  })
  it('a zero-duration trigger still lights near its onset', () => {
    const hit: SceneNote = { cycle: 2, end: 2, pitch: null, gain: 1, voice: 'bd' }
    const drums = new Set(['bd|'])
    expect(pickLitNotes([hit], 2, drums).has(hit)).toBe(true)
    expect(pickLitNotes([hit], 2 + MIN_LIT_CYCLES / 2, drums).has(hit)).toBe(true)
  })
  it('lights one occurrence per active sig (distinct sigs each light)', () => {
    const a: SceneNote = { cycle: 1, end: 1.5, pitch: 60, gain: 1, voice: 'saw' }
    const b: SceneNote = { cycle: 1.1, end: 1.6, pitch: 67, gain: 1, voice: 'saw' }
    const lit = pickLitNotes([a, b], 1.2, new Set(['saw|60', 'saw|67']))
    expect(lit.size).toBe(2)
  })
  it('a non-finite playhead lights nothing', () => {
    expect(pickLitNotes([note], Number.NaN, active).size).toBe(0)
  })
})

describe('drawLiveOverlay', () => {
  it('clears its surface every call', () => {
    const { ctx, calls } = mockCtx()
    drawLiveOverlay(ctx, sceneFixture(), WIDE, layoutFor(sceneFixture()), 1.2, new Set(['saw|60']), THEME)
    expect(calls.clears).toBe(1)
  })

  it('lights the mark under the playhead whose voice+pitch is firing', () => {
    const scene = sceneFixture()
    const { ctx, rects } = mockCtx()
    // Playhead at 1.2 → inside note0 [1,1.5); active set has its sig.
    drawLiveOverlay(ctx, scene, WIDE, layoutFor(scene), 1.2, new Set(['saw|60']), THEME)
    // glow + core for the one lit mark (2 fillRects); note1 [2,2.5) is not lit.
    expect(rects.length).toBe(2)
  })

  it('does not light a mark whose sig is absent (degrade)', () => {
    const scene = sceneFixture()
    const { ctx, rects } = mockCtx()
    // 'flute|99' is in no lane → nothing lights (degrade: mark exists, did not sound).
    drawLiveOverlay(ctx, scene, WIDE, layoutFor(scene), 1.2, new Set(['flute|99']), THEME)
    expect(rects.length).toBe(0)
  })

  it("does not light a firing sig whose nearest occurrence is beyond the distance cap", () => {
    const scene = sceneFixture()
    const { ctx, rects } = mockCtx()
    // note1 (saw|67) sits at [2,2.5); playhead 1.2 is 0.8 cycles away (> cap).
    drawLiveOverlay(ctx, scene, WIDE, layoutFor(scene), 1.2, new Set(['saw|67']), THEME)
    expect(rects.length).toBe(0)
  })

  it('draws nothing when stopped (playheadCycle null) or no sigs firing', () => {
    const scene = sceneFixture()
    const a = mockCtx()
    drawLiveOverlay(a.ctx, scene, WIDE, layoutFor(scene), null, new Set(['saw|60']), THEME)
    expect(a.rects.length).toBe(0)
    expect(a.calls.clears).toBe(1) // still cleared
    const b = mockCtx()
    drawLiveOverlay(b.ctx, scene, WIDE, layoutFor(scene), 1.2, new Set(), THEME)
    expect(b.rects.length).toBe(0)
  })

  it('lights nothing in density mode (zoomed out — no marks drawn to light)', () => {
    const scene = sceneFixture()
    const { ctx, rects } = mockCtx()
    // Narrow: pxPerCycle = (COARSEN_PX-1)*4 / 4 < COARSEN_PX → density.
    const narrow = { scrollLeft: 0, contentWidth: (COARSEN_PX - 1) * 4, viewportWidth: 4000 }
    drawLiveOverlay(ctx, scene, narrow, layoutFor(scene), 1.2, new Set(['saw|60']), THEME)
    expect(rects.length).toBe(0)
  })

  it('a lit mark sits exactly over its BASE mark (shared geometry, no drift)', () => {
    const scene = sceneFixture()
    const layout = layoutFor(scene)
    const { ctx, rects } = mockCtx()
    drawLiveOverlay(ctx, scene, WIDE, layout, 1.2, new Set(['saw|60']), THEME)
    // The base geometry for note0 in lane 0.
    const band = laneMarkBands(scene.lanes[0], layout.boxes[0])[0]
    const baseRect = markRect(scene.lanes[0].notes[0], band, 1000, 4000, 0, 4, (c) => c * 1000)
    expect(baseRect).not.toBeNull()
    // The bright CORE (second of glow+core) shares the base rect's x/y/w/h.
    const core = rects[1]
    expect(core.x).toBeCloseTo(baseRect!.x, 5)
    expect(core.y).toBeCloseTo(baseRect!.y, 5)
    expect(core.w).toBeCloseTo(baseRect!.w, 5)
    expect(core.h).toBeCloseTo(baseRect!.h, 5)
  })
})

function layoutFor(scene: TimelineScene) {
  return computeLaneLayout(scene.lanes, new Set(), 40, 96)
}
