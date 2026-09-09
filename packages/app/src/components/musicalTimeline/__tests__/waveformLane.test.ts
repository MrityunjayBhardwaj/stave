import { describe, expect, it } from 'vitest'

import {
  MIN_WAVEFORM_H,
  MIN_WAVEFORM_W,
  waveformColumn,
  waveformFit,
} from '../waveformLane'

/**
 * The display rule behind #1506, tested as arithmetic. Nothing here touches a
 * canvas: `waveformFit` decides whether a mark can show a shape and how much of
 * one, which is exactly the part that must not be observed as pixels.
 */

/** A tall, wide mark at a readable zoom — the case where a waveform is allowed. */
const ROOMY = { markW: 200, markH: 20, pxPerCycle: 100 }

describe('waveformFit', () => {
  it('fills the whole mark when the sample is at least as long as its slot', () => {
    // 2s slot (200px @ 100px/cycle, 1 cps → 1 cycle = 1s → 2 cycles), 3s sample.
    const fit = waveformFit(3, 1, ROOMY.markW, ROOMY.markH, ROOMY.pxPerCycle)
    expect(fit).not.toBeNull()
    expect(fit!.extentPx).toBe(200)
    // Only two of the sample's three seconds have anywhere to go.
    expect(fit!.visibleFraction).toBeCloseTo(2 / 3, 10)
  })

  it('fills only the sample’s own share of a slot it does not fill', () => {
    // A 0.5s sample in a 2s slot occupies a quarter of its mark.
    const fit = waveformFit(0.5, 1, ROOMY.markW, ROOMY.markH, ROOMY.pxPerCycle)
    expect(fit!.extentPx).toBe(50)
    expect(fit!.visibleFraction).toBe(1) // the whole file is shown
  })

  it('is the settled discriminator: extent/markW === min(1, sampleDur/slotDur)', () => {
    // Stated as the identity rather than as numbers, so the rule is the thing
    // under test and not one worked example of it.
    const cps = 0.5
    const pxPerCycle = 80
    const markW = 160 // 2 cycles => slot lasts 2/cps = 4s
    const slotSeconds = markW / pxPerCycle / cps
    for (const sampleDuration of [0.5, 1, 2, 3.9, 4, 8]) {
      const fit = waveformFit(sampleDuration, cps, markW, ROOMY.markH, pxPerCycle)
      expect(fit).not.toBeNull()
      expect(fit!.extentPx / markW).toBeCloseTo(Math.min(1, sampleDuration / slotSeconds), 10)
    }
  })

  it('declines when the mark is too NARROW, however tall the row is', () => {
    const tooNarrow = MIN_WAVEFORM_W - 1
    expect(waveformFit(10, 1, tooNarrow, 100, 1)).toBeNull()
  })

  it('declines when the row is too SHORT, however wide the mark is', () => {
    expect(waveformFit(10, 1, 5000, MIN_WAVEFORM_H - 1, 100)).toBeNull()
    // …and admits it at exactly the threshold, so the gate is a floor not a gap.
    expect(waveformFit(10, 1, 5000, MIN_WAVEFORM_H, 100)).not.toBeNull()
  })

  it('declines when a short sample cannot reach the minimum width even in a huge mark', () => {
    // 1ms click at 1 cps / 100px per cycle = 0.1px of audio.
    expect(waveformFit(0.001, 1, 4000, 40, 100)).toBeNull()
  })

  it('declines rather than guesses when tempo is unknown', () => {
    for (const cps of [null, undefined, 0, -1, Number.NaN]) {
      expect(waveformFit(3, cps, ROOMY.markW, ROOMY.markH, ROOMY.pxPerCycle)).toBeNull()
    }
  })

  it('declines for a sample with no measurable length', () => {
    for (const d of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(waveformFit(d, 1, ROOMY.markW, ROOMY.markH, ROOMY.pxPerCycle)).toBeNull()
    }
  })
})

/** Envelope of `n` source columns whose value ramps, so column identity is visible. */
function ramp(n: number): Float32Array {
  const data = new Float32Array(n * 2)
  for (let i = 0; i < n; i++) {
    data[i * 2] = -(i + 1) / n
    data[i * 2 + 1] = (i + 1) / n
  }
  return data
}

describe('waveformColumn', () => {
  it('takes the extremes of every source column it covers, never the average', () => {
    // 8 source columns into 2 drawn columns: each drawn column covers 4.
    //
    // The peak sits in the MIDDLE of each covered range on purpose. Against a
    // monotonic ramp this arm cannot fail — the loudest column is also the last
    // one, so an implementation that simply kept the last value it saw would
    // satisfy it. Putting the extreme where neither the first nor the last
    // column is makes the assertion about the extremes and nothing else.
    const data = new Float32Array(8 * 2)
    for (let i = 0; i < 8; i++) {
      data[i * 2] = -0.1
      data[i * 2 + 1] = 0.1
    }
    data[1 * 2 + 1] = 0.75 // inside the first drawn column (0..3)
    data[1 * 2] = -0.6
    data[5 * 2 + 1] = 0.5 // inside the second drawn column (4..7)

    const first = waveformColumn(data, 8, 0, 2, 1)
    const second = waveformColumn(data, 8, 1, 2, 1)
    expect(first.max).toBeCloseTo(0.75, 6)
    expect(first.min).toBeCloseTo(-0.6, 6)
    expect(second.max).toBeCloseTo(0.5, 6)
  })

  it('keeps a transient at low resolution instead of shrinking it', () => {
    // One loud column among 63 quiet ones must survive being drawn as 1 column.
    const data = new Float32Array(64 * 2)
    for (let i = 0; i < 64; i++) {
      data[i * 2] = -0.01
      data[i * 2 + 1] = 0.01
    }
    data[10 * 2 + 1] = 1
    expect(waveformColumn(data, 64, 0, 1, 1).max).toBe(1)
  })

  it('reads only the visible head of a sample longer than its mark', () => {
    // The last quarter is the loud part; showing the first half must not reveal it.
    const data = new Float32Array(64 * 2)
    for (let i = 0; i < 64; i++) {
      data[i * 2] = -0.1
      data[i * 2 + 1] = 0.1
    }
    for (let i = 48; i < 64; i++) data[i * 2 + 1] = 1
    expect(waveformColumn(data, 64, 0, 1, 0.5).max).toBeCloseTo(0.1, 6)
    expect(waveformColumn(data, 64, 0, 1, 1).max).toBe(1) // control: it IS in there
  })

  it('never returns a non-finite column, even asked for more columns than it has', () => {
    const data = ramp(4)
    for (let i = 0; i < 32; i++) {
      const col = waveformColumn(data, 4, i, 32, 1)
      expect(Number.isFinite(col.min)).toBe(true)
      expect(Number.isFinite(col.max)).toBe(true)
    }
  })

  it('is silent rather than broken for degenerate inputs', () => {
    expect(waveformColumn(new Float32Array(0), 0, 0, 4, 1)).toEqual({ min: 0, max: 0 })
    expect(waveformColumn(ramp(4), 4, 0, 0, 1)).toEqual({ min: 0, max: 0 })
  })
})
