/**
 * The geometry of a stepped automation on a lane (#1463 Stage 2).
 *
 * Fixtures here are hand-built `SteppedAutomation`s, and that is deliberate
 * rather than a shortcut: the reader that produces them is pinned against the real
 * parser AND the real engine in `@stave/editor` (steppedAutomation.test.ts,
 * steppedAutomation.engine.test.ts). This file owns only what happens after — so
 * each fixture spells exactly the fields the reader was shown to produce, and the
 * `startCycle`s are the ones the reader derives from the weights.
 */
import { describe, it, expect } from 'vitest'
import type { SteppedAutomation } from '@stave/editor'
import {
  stepAxis,
  stepHitAt,
  stepSegments,
  stepY,
  unitOnAxis,
  STEP_HIT_TOLERANCE_PX,
  type RangeFor,
  type StepAxis,
  type StepBand,
} from '../steppedLane'

describe('stepHitAt — which step a press lands on (Stage 3\'s claim)', () => {
  const LIN: StepAxis = { lo: 0, hi: 1, scale: 'linear' }
  // A 96px expanded row at y=100, 3px pad → a 90px band.
  const BAND: StepBand = { top: 100, rowHeight: 96, padY: 3, minBandH: 10 }
  const mk = (steps: [number, number?][], method = 'gain') => {
    let at = 0
    const built = steps.map(([value, weight = 1]) => {
      const s = { value, weight, startCycle: at, valueSpan: { start: 0, end: 1 } }
      at += weight
      return s
    })
    return { trackId: 'd1', paramKey: method, method, steps: built, periodCycles: at, offset: 0 }
  }

  it('hits the step playing at the pointer\'s cycle, on its level', () => {
    const entry = { automation: mk([[0.2], [0.8]]), axis: LIN }
    const y08 = stepY(0.8, LIN, BAND)
    const hit = stepHitAt([entry], BAND, true, 1.4, y08 + 2)
    expect(hit?.index).toBe(1)
    expect(hit?.y).toBe(y08)
  })

  it('misses a level that is not playing at that cycle, even when the y matches', () => {
    // At cycle 0 the staircase is at 0.2; pressing at 0.8's height there is empty space.
    const entry = { automation: mk([[0.2], [0.8]]), axis: LIN }
    expect(stepHitAt([entry], BAND, true, 0.5, stepY(0.8, LIN, BAND))).toBeNull()
  })

  it('maps a press inside a weighted step to that step', () => {
    const entry = { automation: mk([[0.2, 2], [0.8]]), axis: LIN }
    // Cycle 1 is still inside step 0's weight of 2.
    expect(stepHitAt([entry], BAND, true, 1.9, stepY(0.2, LIN, BAND))?.index).toBe(0)
  })

  it('stops at the tolerance, both sides of the edge', () => {
    const entry = { automation: mk([[0.5]]), axis: LIN }
    const y = stepY(0.5, LIN, BAND)
    expect(stepHitAt([entry], BAND, true, 0, y + STEP_HIT_TOLERANCE_PX)).not.toBeNull()
    expect(stepHitAt([entry], BAND, true, 0, y + STEP_HIT_TOLERANCE_PX + 0.5)).toBeNull()
  })

  it('picks the NEAREST level when two parameters share the band', () => {
    const gain = { automation: mk([[0.5]]), axis: LIN }
    const room = { automation: mk([[0.52]], 'room'), axis: LIN }
    const yRoom = stepY(0.52, LIN, BAND)
    expect(stepHitAt([gain, room], BAND, true, 0, yRoom)?.entry).toBe(room)
    expect(stepHitAt([room, gain], BAND, true, 0, yRoom)?.entry).toBe(room)
  })

  it('claims nothing on a collapsed lane, or a band too short to draw', () => {
    const entry = { automation: mk([[0.5]]), axis: LIN }
    const y = stepY(0.5, LIN, BAND)
    expect(stepHitAt([entry], BAND, false, 0, y)).toBeNull()
    expect(stepHitAt([entry], { ...BAND, rowHeight: 14 }, true, 0, stepY(0.5, LIN, { ...BAND, rowHeight: 14 }))).toBeNull()
  })
})

const SPAN = { start: 0, end: 1 }

/** `<v0@w0 v1@w1 …>` as the reader returns it. */
function stepped(steps: [value: number, weight?: number][], method = 'gain'): SteppedAutomation {
  let at = 0
  const built = steps.map(([value, weight = 1]) => {
    const s = { value, weight, startCycle: at, valueSpan: SPAN }
    at += weight
    return s
  })
  return { trackId: 'd1', paramKey: method, method, steps: built, periodCycles: at, offset: 0 }
}

const seg = (a: SteppedAutomation, from: number, to: number) =>
  stepSegments(a, from, to).map((s) => [s.index, s.value, s.startCycle, s.endCycle])

describe('stepSegments — one segment per step, over absolute cycles', () => {
  it('a two-step alternation is one segment per cycle', () => {
    expect(seg(stepped([[0.2], [0.8]]), 0, 4)).toEqual([
      [0, 0.2, 0, 1],
      [1, 0.8, 1, 2],
      [0, 0.2, 2, 3],
      [1, 0.8, 3, 4],
    ])
  })

  it('a weighted step is ONE segment across its weight', () => {
    expect(seg(stepped([[0.2, 2], [0.8]]), 0, 6)).toEqual([
      [0, 0.2, 0, 2],
      [1, 0.8, 2, 3],
      [0, 0.2, 3, 5],
      [1, 0.8, 5, 6],
    ])
  })

  // The arm that decides what a segment IS. Merging by value would draw the
  // same staircase and give Stage 3 index 0 for a press on step 1.
  it('two adjacent steps holding the same number stay two segments', () => {
    expect(seg(stepped([[0.5], [0.5], [0.8]]), 0, 3)).toEqual([
      [0, 0.5, 0, 1],
      [1, 0.5, 1, 2],
      [2, 0.8, 2, 3],
    ])
  })

  // Two consequences of the one rule (same step index → same segment), kept in
  // one arm so they are read together: across a wrap the steps differ, so the
  // run breaks; a single-step pattern plays index 0 every cycle, so it is one line.
  it('a step met again across the wrap starts a new segment; a single-step pattern is one line', () => {
    expect(seg(stepped([[0.2, 2], [0.8, 2]]), 0, 8).map((s) => [s[0], s[2], s[3]])).toEqual([
      [0, 0, 2],
      [1, 2, 4],
      [0, 4, 6],
      [1, 6, 8],
    ])
    expect(seg(stepped([[0.8]]), 0, 4)).toEqual([[0, 0.8, 0, 4]])
  })

  it('a paged window starts mid-song and clips to its own span', () => {
    // Cycles 5.5 … 8.25 of `<0.2@2 0.8>` (period 3): cycle 5 is step 1, 6–7 step 0, 8 step 1.
    expect(seg(stepped([[0.2, 2], [0.8]]), 5.5, 8.25)).toEqual([
      [1, 0.8, 5.5, 6],
      [0, 0.2, 6, 8],
      [1, 0.8, 8, 8.25],
    ])
  })

  it('draws nothing for an empty or inverted span', () => {
    expect(stepSegments(stepped([[0.2], [0.8]]), 3, 3)).toEqual([])
    expect(stepSegments(stepped([[0.2], [0.8]]), 4, 2)).toEqual([])
  })
})

describe('stepAxis — the knob range, widened to every step', () => {
  // A stand-in with `knobRangeFor`'s contract: a known control widens only to the
  // ONE value it is handed.
  const knownGain: RangeFor = (_m, v) => ({ min: Math.min(0, v), max: Math.max(1, v), scale: 'linear' })

  it('uses the control range when every step fits inside it', () => {
    expect(stepAxis(stepped([[0.2], [0.8]]), knownGain)).toEqual({ lo: 0, hi: 1, scale: 'linear' })
  })

  it('widens to the LARGEST step — asking with one step would clip the rest', () => {
    // Asked only with the first step (0.2) this would be 0..1, and 1.4 would
    // draw pinned to the ceiling as if it were 1.
    expect(stepAxis(stepped([[0.2], [1.4]]), knownGain).hi).toBe(1.4)
    expect(stepAxis(stepped([[1.4], [0.2]]), knownGain).hi).toBe(1.4)
  })

  it('widens to the SMALLEST step too', () => {
    expect(stepAxis(stepped([[-0.5], [0.8]]), knownGain).lo).toBe(-0.5)
  })

  it('keeps a log axis for a frequency control, and drops it when a step is not positive', () => {
    const freq: RangeFor = (_m, v) => ({ min: Math.min(20, v), max: Math.max(20000, v), scale: 'log' })
    expect(stepAxis(stepped([[200], [2000]], 'lpf'), freq)).toEqual({ lo: 20, hi: 20000, scale: 'log' })
    expect(stepAxis(stepped([[0], [2000]], 'lpf'), freq).scale).toBe('linear')
  })

  it('asks with the method the user TYPED — the knob table is keyed on it', () => {
    const asked: string[] = []
    stepAxis(stepped([[200], [2000]], 'lpf'), (m, v) => (asked.push(m), { min: 0, max: v, scale: 'linear' }))
    expect(new Set(asked)).toEqual(new Set(['lpf']))
  })
})

describe('unitOnAxis', () => {
  it('maps linearly between the bounds and clamps outside them', () => {
    const axis = { lo: 0, hi: 1, scale: 'linear' } as const
    expect(unitOnAxis(0.25, axis)).toBe(0.25)
    expect(unitOnAxis(-1, axis)).toBe(0)
    expect(unitOnAxis(2, axis)).toBe(1)
  })

  it('maps a log axis by ratio — 200 sits a third of the way from 20 to 20000', () => {
    const axis = { lo: 20, hi: 20000, scale: 'log' } as const
    expect(unitOnAxis(200, axis)).toBeCloseTo(1 / 3, 10)
    expect(unitOnAxis(2000, axis)).toBeCloseTo(2 / 3, 10)
  })

  it('returns the floor for a degenerate axis or a non-finite value', () => {
    expect(unitOnAxis(0.5, { lo: 1, hi: 1, scale: 'linear' })).toBe(0)
    expect(unitOnAxis(Number.NaN, { lo: 0, hi: 1, scale: 'linear' })).toBe(0)
  })
})
