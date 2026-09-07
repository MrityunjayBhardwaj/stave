/**
 * `.range(lo, hi)` reaches the IR as structure (#1481).
 *
 * The last leg of #1464's stated prerequisite — "modelling signal expressions so
 * the SHAPE, RATE and RANGE are readable at all". #1464's widening delivered the
 * first two (`Signal`, and `Slow` where the rate is spelled as a modelled
 * transform) and left this one, which is why that change moved the parity
 * corpus's `Code` count UP rather than down: 21 whole-call `Code` nodes went away
 * and 22 interior `.range(...)` nodes arrived. The opacity relocated inward.
 *
 * MEASURED with acorn — the oracle `parseStrudel` already imports — over 329
 * distinct documents (`ref/bakery-runs-inputs`, deduped by content sha), BEFORE
 * building: **428 call sites in 102 documents**, against `.slice(`'s 19. The
 * arity is 2 at every one of the 428, so there is no other form to model, and
 * 833 of the 856 arguments are plain numeric literals.
 *
 * ⚠ TWO DECISIONS HERE ARE NOT COSMETIC, and both are pinned below.
 *
 * 1. `rawArgs` IS THE ROUND-TRIP AUTHORITY, not `${lo}, ${hi}`. The node this
 *    replaces was an opaque `Code` that re-emitted the user's own bytes for
 *    free, and the corpus writes `perlin.range(0.3,0.8)` unspaced. Regenerating
 *    a canonical `, ` would REGRESS byte-fidelity in the very act of adding
 *    structure — the one property #1464 says must not regress.
 *
 * 2. `isNumericLiteral`, NOT `parseFloat`. The neighbouring `fast`/`slow` arms
 *    use `parseFloat`, which is a PREFIX parser: it reads `1/8` as `1` and
 *    builds a confidently wrong node (#1480, measured at 14 real sites). Five of
 *    the seven non-literal `.range` arguments in the corpus are exactly that
 *    `1/N` shape, so a `parseFloat` arm here would have shipped the same defect
 *    on arrival. Declining means the opaque wrap, never a computed value: this
 *    file is a matcher and not an interpreter.
 */
import { describe, it, expect } from 'vitest'
import { parseStrudel } from '../parseStrudel'
import { toStrudel } from '../toStrudel'
import type { PatternIR } from '../PatternIR'

const find = (ir: PatternIR | null, tag: string): PatternIR | null => {
  if (!ir || typeof ir !== 'object') return null
  if ((ir as { tag?: string }).tag === tag) return ir
  for (const [k, v] of Object.entries(ir as Record<string, unknown>)) {
    if (k === 'loc' || k === 'keyLoc' || k === 'callSiteRange') continue
    if (Array.isArray(v)) { for (const x of v) { const r = find(x as PatternIR, tag); if (r) return r } }
    else if (v && typeof v === 'object') { const r = find(v as PatternIR, tag); if (r) return r }
  }
  return null
}

describe('#1481 — .range(lo, hi) is structure', () => {
  it('a bare signal range is readable, and its receiver survives', () => {
    const r = find(parseStrudel('$: s("bd*8").gain(sine.range(0.2, 0.8))'), 'Range') as
      { lo: number; hi: number; body: PatternIR } | null
    expect(r).not.toBeNull()
    expect(r!.lo).toBe(0.2)
    expect(r!.hi).toBe(0.8)
    // the SHAPE is still underneath it — range wraps the signal, it does not replace it
    expect(find(r!.body, 'Signal')).not.toBeNull()
  })

  it('the rate survives alongside the range — all three legs readable at once', () => {
    const ir = parseStrudel('$: s("bd*8").lpf(sine.slow(8).range(300, 3000))')
    expect(find(ir, 'Range')).not.toBeNull()   // range
    expect(find(ir, 'Slow')).not.toBeNull()    // rate
    expect(find(ir, 'Signal')).not.toBeNull()  // shape
  })

  it('negative bounds are literals too', () => {
    const r = find(parseStrudel('$: s("bd").pan(sine.range(-1, 1))'), 'Range') as
      { lo: number; hi: number } | null
    expect(r).not.toBeNull()
    expect(r!.lo).toBe(-1)
    expect(r!.hi).toBe(1)
  })

  it('⚠ an arithmetic bound is DECLINED, not truncated to its prefix (#1480)', () => {
    // `parseFloat('1/8')` is 1. If this arm used it, `.range(1/8, 1)` would parse
    // to a Range with lo=1 — eight times the value the user wrote, silently.
    const ir = parseStrudel('$: s("bd").gain(sine.range(1/8, 1))')
    expect(find(ir, 'Range')).toBeNull()
    expect(find(ir, 'Code')).not.toBeNull()
  })

  it('a slider bound is declined rather than guessed', () => {
    expect(find(parseStrudel('$: s("bd").lpf(sine.range(slider(827, 0, 4000, 1), 4000))'), 'Range')).toBeNull()
  })

  it('the arity is not assumed — one or three arguments decline', () => {
    expect(find(parseStrudel('$: s("bd").gain(sine.range(0.5))'), 'Range')).toBeNull()
    expect(find(parseStrudel('$: s("bd").gain(sine.range(0, 1, 2))'), 'Range')).toBeNull()
  })

  describe('round-trip preserves the range bytes exactly, spacing included', () => {
    // ⚠ The assertion is on the `.range(...)` FRAGMENT, not the whole line, and
    // deliberately so: `s("bd*8")` round-trips as `s("bd").fast(8)` — a
    // pre-existing mini-notation normalisation that has nothing to do with this
    // change. Asserting the whole line would couple this pin to that behaviour
    // and go red for the wrong reason.
    //
    // The unspaced form is the case that matters: it is what the corpus actually
    // writes, and it is exactly what a `${lo}, ${hi}` emit would silently
    // rewrite. Refusals are in the same list because the opaque wrap has to keep
    // its bytes too.
    for (const [src, fragment] of [
      ['$: s("bd*8").gain(sine.range(0.2, 0.8))', '.range(0.2, 0.8)'],
      ['$: s("bd*8").gain(perlin.range(0.3,0.8))', '.range(0.3,0.8)'],
      ['$: s("bd*8").lpf(sine.slow(8).range(300,3000))', '.range(300,3000)'],
      ['$: s("bd").pan(sine.range(-1, 1))', '.range(-1, 1)'],
      ['$: s("bd").gain(sine.range( 0.2 , 0.8 ))', '.range( 0.2 , 0.8 )'],
      ['$: s("bd").gain(sine.range(1/8, 1))', '.range(1/8, 1)'],
      ['$: s("bd").gain(sine.range(0.5))', '.range(0.5)'],
      ['$: s("bd").lpf(sine.range(slider(827, 0, 4000, 1), 4000))', '.range(slider(827, 0, 4000, 1), 4000)'],
    ] as const) {
      it(src, () => {
        expect(toStrudel(parseStrudel(src)!)).toContain(fragment)
      })
    }
  })
})
