/**
 * A numeric argument is read WHOLE or not at all (#1480).
 *
 * `parseFloat` is a PREFIX parser — it consumes as much as looks like a number
 * and ignores the rest. `parseFloat('8/7')` is 8, not NaN, so the arm's
 * `if (isNaN(n))` guard passed and `.fast(8/7)` (≈1.14×) was modelled as
 * `fast(8)`. Nothing was red: a node WAS produced, and it carried a plausible
 * number. That is the whole hazard — it is not an opaque fallback misfiring, it
 * is a confident wrong answer.
 *
 * ⚠ THE SCOPE IS NARROWER THAN THE HAZARD, AND THE CORPUS DECIDED IT.
 * Gating every numeric arm the same way was measured FIRST and regressed the
 * corpus: `Play` leaves 27154 -> 27047, because `.off(1/8, x => …)` is idiomatic
 * and declining it opaques the whole call together with its transform subtree. A
 * conservative fallback is not free — it discards whatever the degraded node was
 * still providing, and for a transform-carrying arm that is most of the music.
 *
 * So this closes the hole only where declining costs nothing structural:
 * `fast`, `slow` and `late`, whose argument is a lone scalar and whose opaque
 * wrap keeps the receiver as `via.inner`. Measured on the narrowed change: `Code`
 * +5, `Fast` -5, and every other tag byte-identical — `Play`, `Seq`, `Sleep` and
 * `Stack` all unmoved. The transform-carrying arms and the multi-argument param
 * calls stay on #1480.
 *
 * ⚠ Reachability is not the same as presence, and this is where the issue's own
 * first count went wrong. An acorn census of the SOURCE found 8 `.late(1/N)`
 * sites; the PARSER moves none of them, because they sit inside `.off(...)`
 * arrows that were already opaque. The source says what people wrote; only the
 * parser says what the code reads.
 */
import { describe, it, expect } from 'vitest'
import { parseStrudel } from '../parseStrudel'
import { toStrudel } from '../toStrudel'
import type { PatternIR } from '../PatternIR'

const has = (ir: PatternIR | null, tag: string): boolean => {
  if (!ir || typeof ir !== 'object') return false
  if ((ir as { tag?: string }).tag === tag) return true
  return Object.entries(ir as Record<string, unknown>).some(([k, v]) => {
    if (k === 'loc' || k === 'keyLoc' || k === 'callSiteRange') return false
    if (Array.isArray(v)) return v.some((x) => has(x as PatternIR, tag))
    return !!v && typeof v === 'object' && has(v as PatternIR, tag)
  })
}
/** The scalar a transform node carries — `factor` for Fast/Slow, `offset` for Late. */
const scalarOf = (ir: PatternIR | null, tag: string): number | null => {
  if (!ir || typeof ir !== 'object') return null
  if ((ir as { tag?: string }).tag === tag) {
    const n = ir as unknown as { factor?: number; offset?: number }
    return n.factor ?? n.offset ?? null
  }
  for (const [k, v] of Object.entries(ir as Record<string, unknown>)) {
    if (k === 'loc' || k === 'keyLoc' || k === 'callSiteRange') continue
    if (v && typeof v === 'object') { const r = scalarOf(v as PatternIR, tag); if (r !== null) return r }
  }
  return null
}

describe('#1480 — a prefix is not a number', () => {
  it('⚠ .fast(8/7) is declined, not read as 8', () => {
    // The corpus writes this. Before the fix it modelled a 1.14x speed-up as 8x.
    const ir = parseStrudel('$: s("bd").fast(8/7)')
    expect(has(ir, 'Fast')).toBe(false)
    expect(has(ir, 'Code')).toBe(true)
  })

  it('⚠ .fast(1/16) is declined, not read as 1 — an identity that hides the ask', () => {
    expect(has(parseStrudel('$: s("bd").fast(1/16)'), 'Fast')).toBe(false)
  })

  it('.slow(1/8) and .late(1/16) are declined too', () => {
    expect(has(parseStrudel('$: s("bd").slow(1/8)'), 'Slow')).toBe(false)
    expect(has(parseStrudel('$: s("bd").late(1/16)'), 'Late')).toBe(false)
  })

  it('a declined argument keeps the user\'s bytes', () => {
    expect(toStrudel(parseStrudel('$: s("bd").fast(8/7)')!)).toContain('.fast(8/7)')
    expect(toStrudel(parseStrudel('$: s("bd").late(1/16)')!)).toContain('.late(1/16)')
  })

  it('ordinary literals are untouched, leading-dot included', () => {
    expect(scalarOf(parseStrudel('$: s("bd").fast(2)'), 'Fast')).toBe(2)
    expect(scalarOf(parseStrudel('$: s("bd").fast(.5)'), 'Fast')).toBe(0.5)
    expect(scalarOf(parseStrudel('$: s("bd").slow(1.5)'), 'Slow')).toBe(1.5)
    expect(scalarOf(parseStrudel('$: s("bd").late(0.25)'), 'Late')).toBe(0.25)
    expect(scalarOf(parseStrudel('$: s("bd").fast(-2)'), 'Fast')).toBe(-2)
  })

  it('⚠ the scope boundary: .off(1/8, …) is DELIBERATELY unchanged', () => {
    // Gating this arm the same way cost 107 Play leaves across the corpus,
    // because declining opaques the transform arrow along with the call. The
    // imprecise offset is the lesser loss, and the rest is tracked on #1480.
    // If this pin ever goes red, that trade was changed without measuring it.
    const ir = parseStrudel('$: s("bd").off(1/8, x => x.add(7))')
    expect(has(ir, 'Late')).toBe(true)
  })
})
