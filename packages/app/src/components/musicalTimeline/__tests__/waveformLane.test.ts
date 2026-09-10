import { describe, expect, it } from 'vitest'

import {
  MIN_WAVEFORM_H,
  MIN_WAVEFORM_W,
  regionPlayback,
  waveformColumn,
  waveformFit,
  type SampleRegion,
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

/**
 * The window a mark with NO region controls reads — all of the file, forwards.
 * Named so the region arms below read as the departure they are.
 */
const whole = (visibleFraction: number) => ({
  visibleFraction,
  from: 0,
  to: 1,
  reversed: false,
})

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

    const first = waveformColumn(data, 8, 0, 2, whole(1))
    const second = waveformColumn(data, 8, 1, 2, whole(1))
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
    expect(waveformColumn(data, 64, 0, 1, whole(1)).max).toBe(1)
  })

  it('reads only the visible head of a sample longer than its mark', () => {
    // The last quarter is the loud part; showing the first half must not reveal it.
    const data = new Float32Array(64 * 2)
    for (let i = 0; i < 64; i++) {
      data[i * 2] = -0.1
      data[i * 2 + 1] = 0.1
    }
    for (let i = 48; i < 64; i++) data[i * 2 + 1] = 1
    expect(waveformColumn(data, 64, 0, 1, whole(0.5)).max).toBeCloseTo(0.1, 6)
    expect(waveformColumn(data, 64, 0, 1, whole(1)).max).toBe(1) // control: it IS in there
  })

  it('never returns a non-finite column, even asked for more columns than it has', () => {
    const data = ramp(4)
    for (let i = 0; i < 32; i++) {
      const col = waveformColumn(data, 4, i, 32, whole(1))
      expect(Number.isFinite(col.min)).toBe(true)
      expect(Number.isFinite(col.max)).toBe(true)
    }
  })

  it('is silent rather than broken for degenerate inputs', () => {
    expect(waveformColumn(new Float32Array(0), 0, 0, 4, whole(1))).toEqual({ min: 0, max: 0 })
    expect(waveformColumn(ramp(4), 4, 0, 0, whole(1))).toEqual({ min: 0, max: 0 })
  })
})

// ---------------------------------------------------------------------------
// #1512 — the mark draws the slice that PLAYS, not the file it came from.
//
// Each shape below is one row of the table measured on the real runtime before
// any of this was written: what `.chop(4)`, `.slice()`, `.speed()`, `.fit()` and
// `.loopAt()` actually put on a hap. The arms assert what the DRAWING must do
// with those numbers, and the arithmetic they check against is superdough's own
// (`sampler.mjs:36`, `:49-51`, `:67`, `:81-82`).
// ---------------------------------------------------------------------------

/** A region literal, with superdough's defaults for whatever is not stated. */
const region = (r: Partial<SampleRegion>): SampleRegion => ({
  begin: 0,
  end: 1,
  speed: 1,
  unit: null,
  ...r,
})

describe('regionPlayback', () => {
  it('is the whole file at rate 1 when nothing is set', () => {
    expect(regionPlayback(region({}), 4)).toEqual({
      seconds: 4,
      from: 0,
      to: 1,
      reversed: false,
    })
  })

  it('gives a chop’s arm exactly its own share of the file', () => {
    // `.chop(4)` — the third hap, measured: { begin: 0.5, end: 0.75 }.
    const played = regionPlayback(region({ begin: 0.5, end: 0.75 }), 4)
    expect(played!.seconds).toBeCloseTo(1, 10) // a quarter of four seconds
    expect(played!.from).toBe(0.5)
    expect(played!.to).toBe(0.75)
  })

  it('shortens the slice when speed raises the playback rate', () => {
    // `.speed(2)` halves the time a slice occupies (`sampler.mjs:81-82`).
    expect(regionPlayback(region({ speed: 2 }), 4)!.seconds).toBeCloseTo(2, 10)
    expect(regionPlayback(region({ speed: 0.5 }), 4)!.seconds).toBeCloseTo(8, 10)
  })

  it('reads a negative speed as direction, never as rate', () => {
    // `sampler.mjs:36` takes |speed|; `:62-64` reverses the buffer instead.
    const back = regionPlayback(region({ speed: -2 }), 4)!
    const fwd = regionPlayback(region({ speed: 2 }), 4)!
    expect(back.seconds).toBeCloseTo(fwd.seconds, 10)
    expect(back.reversed).toBe(true)
    expect(fwd.reversed).toBe(false)
  })

  it('scales the rate by the file’s own duration for unit "c"', () => {
    // `.fit()` — measured as { speed: 1, unit: 'c' }. `sampler.mjs:49-51`
    // multiplies the rate by the buffer duration, so a whole file at speed 1
    // lasts exactly one second's worth of rate-1 playback, whatever its length.
    for (const duration of [0.5, 2, 7.5]) {
      expect(regionPlayback(region({ speed: 1, unit: 'c' }), duration)!.seconds).toBeCloseTo(1, 10)
    }
    // `.loopAt(2)` — measured as { speed: 0.25, unit: 'c' } at 0.5 cps, i.e.
    // the file stretched to four times that unit.
    expect(regionPlayback(region({ speed: 0.25, unit: 'c' }), 3)!.seconds).toBeCloseTo(4, 10)
  })

  it('ignores a unit superdough does not implement', () => {
    // `controls.mjs:2398` documents "r" and "s"; `sampler.mjs` acts on "c" alone.
    for (const unit of ['r', 's', 'nonsense']) {
      expect(regionPlayback(region({ speed: 2, unit }), 4)!.seconds).toBeCloseTo(2, 10)
    }
  })

  it('clamps a region that reaches outside the file', () => {
    const played = regionPlayback(region({ begin: -0.5, end: 2 }), 4)!
    expect(played.from).toBe(0)
    expect(played.to).toBe(1)
  })

  it('declines rather than inventing a reading for a backwards or empty region', () => {
    expect(regionPlayback(region({ begin: 0.8, end: 0.2 }), 4)).toBeNull()
    expect(regionPlayback(region({ begin: 0.5, end: 0.5 }), 4)).toBeNull()
    expect(regionPlayback(region({ speed: 0 }), 4)).toBeNull()
  })
})

describe('waveformFit with a region', () => {
  it('sizes a chopped mark by its own quarter, not by the file', () => {
    // A 4s file in a 2s slot fills its whole mark today. One quarter of it is
    // 1s, which fills half.
    const wholeFile = waveformFit(4, 1, 200, 20, 100)!
    const quarter = waveformFit(4, 1, 200, 20, 100, region({ begin: 0.5, end: 0.75 }))!
    expect(wholeFile.extentPx).toBe(200)
    expect(quarter.extentPx).toBe(100)
    expect(quarter.from).toBe(0.5)
    expect(quarter.to).toBe(0.75)
  })

  it('is IDENTICAL to the no-region reading for a region that spans the file', () => {
    // The compatibility claim, asserted rather than assumed: an explicit
    // whole-file region must not move a single pixel.
    for (const d of [0.5, 1, 3, 8]) {
      const bare = waveformFit(d, 1, 200, 20, 100)
      const explicit = waveformFit(d, 1, 200, 20, 100, region({}))
      expect(explicit).toEqual(bare)
    }
  })

  it('declines when a slice is too short to draw even though the file is not', () => {
    // The file is 4s and draws happily; a thousandth of it is 0.4px of audio.
    expect(waveformFit(4, 1, 4000, 40, 100)).not.toBeNull()
    expect(waveformFit(4, 1, 4000, 40, 100, region({ begin: 0, end: 0.001 }))).toBeNull()
  })

  it('declines for a backwards region, leaving the plain bar to draw', () => {
    expect(waveformFit(4, 1, 200, 20, 100, region({ begin: 0.9, end: 0.1 }))).toBeNull()
  })
})

describe('waveformColumn within a region', () => {
  /** 64 columns, quiet everywhere except a loud block in the LAST quarter. */
  function loudTail(): Float32Array {
    const data = new Float32Array(64 * 2)
    for (let i = 0; i < 64; i++) {
      data[i * 2] = -0.1
      data[i * 2 + 1] = 0.1
    }
    for (let i = 48; i < 64; i++) {
      data[i * 2] = -1
      data[i * 2 + 1] = 1
    }
    return data
  }

  it('reads a quarter of the file when the mark plays a quarter', () => {
    const data = loudTail()
    const quiet = { visibleFraction: 1, from: 0, to: 0.25, reversed: false }
    const loud = { visibleFraction: 1, from: 0.75, to: 1, reversed: false }
    expect(waveformColumn(data, 64, 0, 1, quiet).max).toBeCloseTo(0.1, 6)
    expect(waveformColumn(data, 64, 0, 1, loud).max).toBe(1)
  })

  it('never reads outside its region, however many columns are asked for', () => {
    const data = loudTail()
    const firstHalf = { visibleFraction: 1, from: 0, to: 0.5, reversed: false }
    for (let i = 0; i < 40; i++) {
      // Every drawn column of the first half must miss the loud tail entirely.
      expect(waveformColumn(data, 64, i, 40, firstHalf).max).toBeCloseTo(0.1, 6)
    }
  })

  it('truncates a reversed slice from its TAIL, because that is where it starts', () => {
    const data = loudTail()
    // The whole file, played backwards, with room for only its first quarter of
    // PLAYBACK — which is the file's LAST quarter, the loud one.
    const back = { visibleFraction: 0.25, from: 0, to: 1, reversed: true }
    const fwd = { visibleFraction: 0.25, from: 0, to: 1, reversed: false }
    expect(waveformColumn(data, 64, 0, 1, back).max).toBe(1)
    // The control that makes that mean something: forwards, the same truncation
    // shows the quiet head.
    expect(waveformColumn(data, 64, 0, 1, fwd).max).toBeCloseTo(0.1, 6)
  })

  it('draws a reversed slice back to front, column by column', () => {
    // A ramp read backwards must descend where the forward read ascends.
    const data = ramp(64)
    const back = { visibleFraction: 1, from: 0, to: 1, reversed: true }
    const fwd = { visibleFraction: 1, from: 0, to: 1, reversed: false }
    const firstBack = waveformColumn(data, 64, 0, 4, back).max
    const lastBack = waveformColumn(data, 64, 3, 4, back).max
    const firstFwd = waveformColumn(data, 64, 0, 4, fwd).max
    const lastFwd = waveformColumn(data, 64, 3, 4, fwd).max
    expect(firstBack).toBeGreaterThan(lastBack)
    expect(firstFwd).toBeLessThan(lastFwd)
    expect(firstBack).toBeCloseTo(lastFwd, 6)
  })

  it('is silent rather than broken for a region with no width', () => {
    expect(waveformColumn(ramp(4), 4, 0, 2, { visibleFraction: 1, from: 0.5, to: 0.5, reversed: false }))
      .toEqual({ min: 0, max: 0 })
  })
})
