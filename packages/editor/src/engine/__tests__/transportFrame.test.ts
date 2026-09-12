/**
 * #1570 — the transport frame's arithmetic, and the arm that grounds it.
 *
 * The pure tests below can only prove this module is self-consistent. The one
 * that matters is the AUTHORITY arm at the bottom: it builds the exact wrap the
 * engine applies (`.ribbon(start, cycles).late(offset)`) with the REAL
 * `@strudel/core` pattern library and asserts that `songPositionAt` names the
 * value actually sounding at each scheduler cycle. Without it this file would be
 * a model of Strudel agreeing with itself — and the whole reason this module
 * exists is that the obvious model (`now - offset`) is wrong under a ribbon.
 */
import { describe, it, expect } from 'vitest'
// ⚠ The SUBMODULE, not the package barrel: `@strudel/core`'s index pulls in
// repl.mjs → `@kabelsalat/web`, which this package stubs by alias. The direct
// import needs no stub at all and is the cheapest way to reach the real thing.
import { pure, slowcat } from '@strudel/core/pattern.mjs'
import {
  normalizeLoopRange,
  songPositionAt,
  transportOffsetForSeek,
  isInsideLoop,
  type LoopRange,
} from '../transportFrame'

const LOOP: LoopRange = { startCycle: 3, cycles: 2 }

describe('normalizeLoopRange', () => {
  it('accepts a usable span', () => {
    expect(normalizeLoopRange({ startCycle: 3, cycles: 2 })).toEqual({ startCycle: 3, cycles: 2 })
  })

  // Each of these would produce a wrap that cannot be heard — a zero-length
  // ribbon divides by zero, an inverted one runs backwards, a negative start
  // asks for song time that does not exist. The gate is here so the engine seam
  // never has to ask.
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['zero length (a drag that ended where it started)', { startCycle: 3, cycles: 0 }],
    ['negative length', { startCycle: 3, cycles: -2 }],
    ['negative start', { startCycle: -1, cycles: 2 }],
    ['non-finite start', { startCycle: Number.NaN, cycles: 2 }],
    ['non-finite length', { startCycle: 0, cycles: Number.POSITIVE_INFINITY }],
  ])('rejects %s into null', (_label, range) => {
    expect(normalizeLoopRange(range as never)).toBeNull()
  })
})

describe('songPositionAt', () => {
  it('is the #384 arithmetic unchanged when no loop is armed', () => {
    expect(songPositionAt(10, 0, null)).toBe(10)
    expect(songPositionAt(10, 4, null)).toBe(6)
    expect(songPositionAt(10, -2, null)).toBe(12)
  })

  it('treats a non-finite offset as no seek rather than poisoning the clock', () => {
    expect(songPositionAt(10, Number.NaN, null)).toBe(10)
  })

  // The measured behaviour, stated as arithmetic: the ribbon re-bases to cycle
  // 0, so the song position folds. This is the assertion the playhead depends on.
  it('folds into the loop span, so the playhead reads song-absolute', () => {
    // offset 0: scheduler cycle 0 sounds song cycle 3 (the loop start).
    expect(songPositionAt(0, 0, LOOP)).toBe(3)
    expect(songPositionAt(1, 0, LOOP)).toBe(4)
    expect(songPositionAt(2, 0, LOOP)).toBe(3) // wrapped — one lap later
    expect(songPositionAt(3.5, 0, LOOP)).toBe(4.5)
  })

  it('never reports a cycle outside the span, however far the clock runs', () => {
    for (let t = 0; t < 40; t += 0.25) {
      const p = songPositionAt(t, 7, LOOP)
      expect(p).toBeGreaterThanOrEqual(LOOP.startCycle)
      expect(p).toBeLessThan(LOOP.startCycle + LOOP.cycles)
    }
  })

  // A scheduler clock behind the offset gives a negative raw position; JS `%`
  // keeps the dividend's sign, which would fold to a cycle BELOW the loop start.
  it('folds a negative raw position upward, not below the loop start', () => {
    expect(songPositionAt(0, 5, LOOP)).toBe(4) // (0-5) mod 2 = 1 → 3 + 1
    expect(songPositionAt(0, 5, LOOP)).toBeGreaterThanOrEqual(LOOP.startCycle)
  })
})

describe('transportOffsetForSeek', () => {
  it('is the #384 arithmetic unchanged when no loop is armed', () => {
    expect(transportOffsetForSeek(10, 4, null)).toBe(6)
  })

  // The round trip is the invariant that binds the two halves: whatever offset
  // the seek picks, reading the position back must name the cycle asked for.
  it('round-trips through songPositionAt for every target inside the loop', () => {
    for (const now of [0, 1.5, 17, 103.25]) {
      for (const target of [3, 3.5, 4, 4.75]) {
        const offset = transportOffsetForSeek(now, target, LOOP)
        expect(songPositionAt(now, offset, LOOP)).toBeCloseTo(target, 10)
      }
    }
  })

  it('round-trips with no loop too (the control for the arm above)', () => {
    for (const target of [0, 2.5, 31]) {
      const offset = transportOffsetForSeek(12, target, null)
      expect(songPositionAt(12, offset, null)).toBeCloseTo(target, 10)
    }
  })

  // The declared edge. A ribboned pattern cannot sound bar 12, so the seek
  // resolves to the loop start rather than folding to some cycle inside the span
  // that the user never named.
  it('resolves a target outside the loop to the loop START, not a fold', () => {
    const offset = transportOffsetForSeek(10, 12, LOOP)
    expect(songPositionAt(10, offset, LOOP)).toBe(LOOP.startCycle)
    // The fold would have landed on 4 (12 - 3 = 9, 9 mod 2 = 1): a cycle the
    // user did not ask for and could not predict. This is the arm that tells
    // "clamped" apart from "folded".
    expect(songPositionAt(10, offset, LOOP)).not.toBe(4)
  })

  it('survives a non-finite target instead of returning NaN', () => {
    expect(Number.isFinite(transportOffsetForSeek(10, Number.NaN, LOOP))).toBe(true)
  })
})

describe('isInsideLoop', () => {
  it('is half-open: the start is in, the end is out', () => {
    expect(isInsideLoop(3, LOOP)).toBe(true)
    expect(isInsideLoop(4.99, LOOP)).toBe(true)
    expect(isInsideLoop(5, LOOP)).toBe(false)
    expect(isInsideLoop(2.99, LOOP)).toBe(false)
  })

  it('is false with no loop armed', () => {
    expect(isInsideLoop(3, null)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// AUTHORITY — against the real @strudel/core, not a model of it
// ---------------------------------------------------------------------------
describe('songPositionAt names the cycle the REAL ribboned pattern sounds', () => {
  // A pattern whose value IS its own song cycle, for the first 8 cycles. Query
  // it at scheduler cycle t under a wrap and the value that comes back says,
  // unambiguously, which song cycle the ears are hearing.
  const base = slowcat(...[0, 1, 2, 3, 4, 5, 6, 7].map((n) => pure(n)))

  /** The value sounding at scheduler cycle `t`, or null if that isn't a single hap. */
  const heardAt = (pat: { queryArc: (a: number, b: number) => unknown[] }, t: number): number | null => {
    const haps = (pat.queryArc(t, t + 1) as Array<{ whole?: { begin: { valueOf(): number } }; value: number }>)
      .filter((h) => h.whole && Math.abs(h.whole.begin.valueOf() - t) < 1e-9)
    return haps.length === 1 ? haps[0].value : null
  }

  // The exact wrap the engine applies at its `.p` seam, in the same order.
  const wrap = (loop: LoopRange, offset: number) =>
    (base as never as { ribbon: (o: number, c: number) => { late: (n: number) => never } })
      .ribbon(loop.startCycle, loop.cycles)
      .late(offset) as never as { queryArc: (a: number, b: number) => unknown[] }

  it.each([
    [{ startCycle: 3, cycles: 2 }, 0],
    [{ startCycle: 3, cycles: 2 }, 1],
    [{ startCycle: 3, cycles: 2 }, 5],
    [{ startCycle: 1, cycles: 4 }, 3],
    [{ startCycle: 0, cycles: 3 }, 2],
    [{ startCycle: 5, cycles: 1 }, 0],
  ] as Array<[LoopRange, number]>)(
    'loop(%o) late(%i): the predicted song cycle is the one that sounds',
    (loop, offset) => {
      const pat = wrap(loop, offset)
      for (let t = 0; t < 8; t++) {
        expect(heardAt(pat, t)).toBe(songPositionAt(t, offset, loop))
      }
    },
  )

  // CONTROL. `now - offset` — the arithmetic this module replaces — must
  // DISAGREE with the audio under a ribbon, at every single cycle. If this ever
  // passes, either the ribbon stopped re-basing or the wrap stopped being
  // applied, and the arm above would be certifying nothing.
  it('the loop-blind prediction disagrees with the audio at every cycle', () => {
    const loop: LoopRange = { startCycle: 3, cycles: 2 }
    const pat = wrap(loop, 0)
    let agreements = 0
    for (let t = 0; t < 8; t++) {
      if (heardAt(pat, t) === songPositionAt(t, 0, null)) agreements++
    }
    expect(agreements).toBe(0)
  })

  // And the other control: with NO ribbon, the loop-blind arithmetic is right —
  // so the disagreement above is the ribbon's doing, not a broken harness.
  it('with no loop armed, the loop-blind prediction is the correct one', () => {
    const pat = (base as never as { late: (n: number) => { queryArc: (a: number, b: number) => unknown[] } }).late(2)
    for (let t = 2; t < 8; t++) {
      expect(heardAt(pat, t)).toBe(songPositionAt(t, 2, null))
    }
  })
})
