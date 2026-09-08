/**
 * Continuous automation read off the static IR (#1464 Stage 1).
 *
 * ⚠ EVERY case here goes through the REAL parser rather than a hand-built node.
 * The shapes this module reads (`Param.value` → `Range`/`Slow`/`Fast` → `Signal`)
 * were only just introduced by #1478/#1482, and a hand-written fixture would pin
 * this module against my belief about them instead of against what the parser
 * emits. Observed before these were written: `.gain(sine.add(saw))` does NOT
 * produce an `Add` node, it produces `Code{via:{method:'add', inner:Signal}}` —
 * which is exactly the case the abstention rule exists for, and a fixture would
 * have got it wrong.
 */
import { describe, it, expect } from 'vitest'
import { parseStrudel } from '../parseStrudel'
import { signalAutomations, signalCarryingParamKeys } from '../signalAutomation'

const read = (src: string) => signalAutomations(parseStrudel(src) as never)

describe('signalAutomations — the three legs #1464 names', () => {
  it('reads shape, rate and range off one nested node', () => {
    expect(read('$: s("bd*4").cutoff(saw.slow(4).range(200, 2000))')).toEqual([
      { trackId: 'd1', paramKey: 'cutoff', kind: 'saw', periodCycles: 4, lo: 200, hi: 2000, ranged: true, offset: expect.any(Number) },
    ])
  })

  it('reads a bare signal with no transform at all — rate 1, natural range', () => {
    const [a] = read('$: s("bd*4").gain(sine)')
    expect(a).toMatchObject({ paramKey: 'gain', kind: 'sine', periodCycles: 1, lo: 0, hi: 1, ranged: false })
  })

  it('.fast(n) SHORTENS the period; .slow(n) lengthens it', () => {
    expect(read('$: s("bd*4").gain(sine.fast(2).range(0, 1))')[0].periodCycles).toBe(0.5)
    expect(read('$: s("bd*4").gain(sine.slow(8).range(0, 1))')[0].periodCycles).toBe(8)
  })

  it('composes several rate transforms multiplicatively', () => {
    expect(read('$: s("bd*4").gain(sine.slow(4).fast(2).range(0, 1))')[0].periodCycles).toBe(2)
  })
})

describe('signalAutomations — natural range comes from the signal, not a guess', () => {
  // Grounded in @strudel/core@1.2.6/signal.mjs: the `2`-suffixed kinds are
  // literally `x.toBipolar()`; the unsuffixed ones are unipolar.
  it('a unipolar signal spans 0..1', () => {
    expect(read('$: s("bd*4").pan(perlin)')[0]).toMatchObject({ lo: 0, hi: 1, ranged: false })
  })

  it('a bipolar `2`-suffixed signal spans -1..1', () => {
    expect(read('$: s("bd*4").pan(sine2)')[0]).toMatchObject({ kind: 'sine2', lo: -1, hi: 1, ranged: false })
  })

  it('an explicit .range() always wins over the natural one, and says so', () => {
    expect(read('$: s("bd*4").pan(sine2.range(0, 1))')[0]).toMatchObject({ lo: 0, hi: 1, ranged: true })
  })

  it('the LAST-applied .range() wins — descent order is application order reversed', () => {
    // `.range(0,1)` then `.range(2,3)`: the outer pair is what the signal emits.
    expect(read('$: s("bd*4").pan(sine.range(0, 1).range(2, 3))')[0]).toMatchObject({ lo: 2, hi: 3 })
  })
})

describe('signalAutomations — it abstains rather than drawing something wrong', () => {
  it('declines an expression it cannot plot in closed form', () => {
    // Parses to Code{via:{method:'add'}} — observed, not assumed.
    expect(read('$: s("bd*4").gain(sine.add(saw))')).toEqual([])
  })

  it('declines an UNBOUNDED signal that has no range to draw between', () => {
    // `time` is signal(id) and grows without limit (signal.mjs:155). Drawing it
    // as 0..1 would be a confident lie about what the document does.
    expect(read('$: s("bd*4").cutoff(time)')).toEqual([])
  })

  it('but DRAWS an unbounded signal once the user supplies a range', () => {
    expect(read('$: s("bd*4").cutoff(time.range(200, 800))')[0]).toMatchObject({ kind: 'time', lo: 200, hi: 800, ranged: true })
  })

  it('leaves a plain scalar parameter alone', () => {
    expect(read('$: s("bd*4").gain(0.8)')).toEqual([])
  })

  it('is empty for a document with no automation at all', () => {
    expect(read('$: s("bd sd hh")')).toEqual([])
  })
})

describe('signalAutomations — attribution', () => {
  it('attributes each automation to the track that declares it', () => {
    const out = read('$: s("bd*4").cutoff(saw.range(1, 2))\n$: s("hh*8").pan(sine)')
    expect(out.map((a) => [a.trackId, a.paramKey])).toEqual([
      ['d1', 'cutoff'],
      ['d2', 'pan'],
    ])
  })

  it('finds several automated parameters on one track', () => {
    const out = read('$: s("bd*4").cutoff(saw.range(1, 2)).pan(sine).gain(perlin)')
    expect(out.map((a) => a.paramKey).sort()).toEqual(['cutoff', 'gain', 'pan'])
  })

  it('carries a source offset that lands inside the document', () => {
    const src = '$: s("bd*4").cutoff(saw.range(200, 2000))'
    const [a] = read(src)
    expect(a.offset).not.toBeNull()
    expect(a.offset as number).toBeGreaterThanOrEqual(0)
    expect(a.offset as number).toBeLessThan(src.length)
  })

  it('returns nothing for a null IR rather than throwing', () => {
    expect(signalAutomations(null)).toEqual([])
    expect(signalAutomations(undefined)).toEqual([])
  })
})

describe('signalCarryingParamKeys — the broader question (#1465)', () => {
  const keys = (src: string) => [...signalCarryingParamKeys(parseStrudel(src) as never)].sort()

  it('names the key of a plainly automated control', () => {
    expect(keys('$: s("bd*4").cutoff(saw.slow(4).range(200, 2000))')).toEqual(['cutoff'])
  })

  it('⚠ names a control the DRAWING reader declines — the whole reason it exists', () => {
    // `.add()` has no closed form, so nothing can be plotted. But the control
    // still moves, so the cycle fingerprint must know about it.
    const src = '$: s("bd*4").gain(sine.add(saw))'
    expect(signalAutomations(parseStrudel(src) as never)).toEqual([])
    expect(keys(src)).toEqual(['gain'])
  })

  it('names an UNBOUNDED signal the drawing reader abstains on', () => {
    const src = '$: s("bd*4").cutoff(time)'
    expect(signalAutomations(parseStrudel(src) as never)).toEqual([])
    expect(keys(src)).toEqual(['cutoff'])
  })

  it('names every automated control across every track, deduplicated', () => {
    expect(keys('$: s("bd*4").cutoff(saw).pan(sine)\n$: s("hh*8").cutoff(perlin).gain(0.5)'))
      .toEqual(['cutoff', 'pan'])
  })

  it('says nothing about a constant parameter', () => {
    expect(keys('$: s("bd*4").cutoff(800).gain(0.5)')).toEqual([])
  })

  it('is empty for a document with no automation, and for no document', () => {
    expect(keys('$: s("bd sd")')).toEqual([])
    expect([...signalCarryingParamKeys(null)]).toEqual([])
    expect([...signalCarryingParamKeys(undefined)]).toEqual([])
  })

  it('reaches a signal nested behind an opaque wrapper', () => {
    // `.segment()` opaques the expression, but the signal is still in there and
    // the control still moves. A reader that stopped at the opaque node would
    // under-report exactly the documents this issue is about.
    expect(keys('$: s("bd*4").pan(perlin.range(0,1).segment(8))')).toEqual(['pan'])
  })
})
