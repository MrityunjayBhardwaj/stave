/**
 * timeAxis — eventToRect / cycleToPlayheadX / formatBarBeat.
 *
 * The display meter and the cps→BPM conversion moved to `lib/meter` (#1565);
 * their tests moved with them.
 *
 * Trap 3 (null/NaN safety), Trap 4 (PV28 — Fast events at post-collect
 * coords), Trap NEW-3 (cycle wrap explicit `%`).
 */
import { describe, it, expect } from 'vitest'
import { DEFAULT_METER } from '../../../lib/meter'
import {
  WINDOW_CYCLES,
  MIN_BLOCK_PX,
  eventToRect,
  cycleToPlayheadX,
  formatBarBeat,
} from '../timeAxis'

const W = 800 // grid content width fixture

describe('eventToRect (PV28 / Trap 4)', () => {
  it('linear maps begin/end across the window', () => {
    // begin=0, end=0.25 in a 2-cycle window of 800px → 100px wide at x=0.
    const r = eventToRect({ begin: 0, end: 0.25 }, { gridContentWidth: W })
    expect(r.x).toBe(0)
    expect(r.w).toBeCloseTo(100, 5)
  })

  it('Fast(n, body) post-collect coords map straight (PV28)', () => {
    // s("bd*4") for 1 cycle emits events at 0, 0.25, 0.5, 0.75 with
    // tiny durations. eventToRect reads begin AS-IS — no Fast-aware
    // transform — so the four blocks land at 0, 100, 200, 300 px.
    const beats = [0, 0.25, 0.5, 0.75]
    const rects = beats.map((b) =>
      eventToRect({ begin: b, end: b + 0.05 }, { gridContentWidth: W }),
    )
    expect(rects.map((r) => Math.round(r.x))).toEqual([0, 100, 200, 300])
  })

  it('enforces MIN_BLOCK_PX for zero-duration triggers', () => {
    const r = eventToRect({ begin: 0, end: 0 }, { gridContentWidth: W })
    expect(r.w).toBe(MIN_BLOCK_PX)
  })

  it('clips events that cross the right edge instead of wrapping', () => {
    // begin=1.9, end=2.5 → end clamps to WINDOW_CYCLES (2); width
    // = (2 - 1.9) * 400 = 40px at x = 1.9 * 400 = 760.
    const r = eventToRect({ begin: 1.9, end: 2.5 }, { gridContentWidth: W })
    expect(r.x).toBeCloseTo(760, 5)
    expect(r.w).toBeCloseTo(40, 5) // not the post-window 240
  })

  it('returns MIN_BLOCK_PX placeholder when grid width is 0', () => {
    const r = eventToRect({ begin: 0, end: 1 }, { gridContentWidth: 0 })
    expect(r).toEqual({ x: 0, w: MIN_BLOCK_PX })
  })
})

describe('cycleToPlayheadX (Trap 3 + Trap NEW-3)', () => {
  it('returns 0 for null / undefined', () => {
    expect(cycleToPlayheadX(null, { gridContentWidth: W })).toBe(0)
    expect(cycleToPlayheadX(undefined, { gridContentWidth: W })).toBe(0)
  })

  it('returns 0 for NaN', () => {
    expect(cycleToPlayheadX(Number.NaN, { gridContentWidth: W })).toBe(0)
  })

  it('returns 0 for negative cycle (defensive)', () => {
    expect(cycleToPlayheadX(-1, { gridContentWidth: W })).toBe(0)
  })

  it('returns 0 when grid width is 0', () => {
    expect(cycleToPlayheadX(0.5, { gridContentWidth: 0 })).toBe(0)
  })

  it('linear maps cycle within the window', () => {
    expect(cycleToPlayheadX(0, { gridContentWidth: W })).toBe(0)
    expect(cycleToPlayheadX(0.5, { gridContentWidth: W })).toBeCloseTo(200, 5)
    expect(cycleToPlayheadX(1.0, { gridContentWidth: W })).toBeCloseTo(400, 5)
    expect(cycleToPlayheadX(1.99, { gridContentWidth: W })).toBeCloseTo(796, 0)
  })

  it('wraps cleanly at the cycle boundary (Trap NEW-3)', () => {
    // 1.99 → near right edge. 0.01 (post-wrap) → near left edge.
    const right = cycleToPlayheadX(1.99, { gridContentWidth: W })
    const left = cycleToPlayheadX(0.01, { gridContentWidth: W })
    expect(right).toBeGreaterThan(W - 10)
    expect(left).toBeLessThan(10)
    // 2.0 wraps exactly to 0.
    expect(cycleToPlayheadX(2.0, { gridContentWidth: W })).toBe(0)
    // 2.5 wraps to 0.5 → ~200.
    expect(cycleToPlayheadX(2.5, { gridContentWidth: W })).toBeCloseTo(200, 5)
  })
})

describe('formatBarBeat', () => {
  it('returns empty string for null / undefined / NaN', () => {
    expect(formatBarBeat(null, DEFAULT_METER)).toBe('')
    expect(formatBarBeat(undefined, DEFAULT_METER)).toBe('')
    expect(formatBarBeat(Number.NaN, DEFAULT_METER)).toBe('')
  })

  it('formats cycle 0 as bar 1 / beat 1.00', () => {
    expect(formatBarBeat(0, DEFAULT_METER)).toBe('bar 1 / beat 1.00')
  })

  it('formats half-cycle as bar 1 / beat 3.00 (BEATS_PER_BAR=4)', () => {
    // 0.5 cycles = 2 beats in → 1-indexed beat = 3.00.
    expect(formatBarBeat(0.5, DEFAULT_METER)).toBe('bar 1 / beat 3.00')
  })

  it('formats 1.5 as bar 2 / beat 3.00', () => {
    expect(formatBarBeat(1.5, DEFAULT_METER)).toBe('bar 2 / beat 3.00')
  })

  it('formats 1.99 as bar 2 / beat ~4.96', () => {
    expect(formatBarBeat(1.99, DEFAULT_METER)).toBe('bar 2 / beat 4.96')
  })

  it('treats negative cycle as 0', () => {
    expect(formatBarBeat(-0.25, DEFAULT_METER)).toBe('bar 1 / beat 1.00')
  })
})

describe('exported constants', () => {
  it('WINDOW_CYCLES is 2 (D-05)', () => {
    expect(WINDOW_CYCLES).toBe(2)
  })

  it('MIN_BLOCK_PX is 4', () => {
    expect(MIN_BLOCK_PX).toBe(4)
  })
})
