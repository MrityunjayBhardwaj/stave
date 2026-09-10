import { describe, it, expect } from 'vitest'
import { knobRangeFor } from '../knobRanges'
import { EFFECTS } from '../effectCatalog'

describe('knobRangeFor', () => {
  it('uses sensible ranges for known methods (S4)', () => {
    expect(knobRangeFor('gain', 0.6)).toMatchObject({ min: 0, max: 1, scale: 'linear' })
    expect(knobRangeFor('speed', 1)).toMatchObject({ min: -2, max: 2 })
    expect(knobRangeFor('room', 0.5)).toMatchObject({ min: 0, max: 1 })
    expect(knobRangeFor('crush', 4)).toMatchObject({ min: 1, max: 16, step: 1 })
  })

  it('gives stretch a range that reaches BELOW unison (#1530)', () => {
    // `.stretch` is a PITCH SHIFT whose identity value is 0, not 1, and whose
    // downward shifts are negative (`pitchFactor = max(0, (v<0 ? v*0.25 : v)+1)`,
    // superdough worklets.mjs:624-631). The value-derived fallback would hand a
    // `.stretch(0.5)` a 0..1 knob, which presents unison as the dial's MINIMUM
    // and puts every downward shift out of reach.
    const r = knobRangeFor('stretch', 0.5)
    expect(r).toMatchObject({ min: -2, max: 1, step: 0.01, scale: 'linear' })
    expect(r.min, 'a downward shift has to be reachable').toBeLessThan(0)
  })

  it('an authored stretch beyond an octave up widens rather than pins', () => {
    expect(knobRangeFor('stretch', 3).max).toBe(3)
  })

  it('marks filter cutoffs as logarithmic', () => {
    expect(knobRangeFor('lpf', 800)).toMatchObject({ scale: 'log', min: 20, max: 20000 })
    expect(knobRangeFor('cutoff', 1200).scale).toBe('log')
  })

  it('widens the ceiling when the authored value exceeds the default', () => {
    // a hand-written gain of 1.4 must still be representable
    expect(knobRangeFor('gain', 1.4).max).toBe(1.4)
  })

  it('widens the floor when the value is below the default minimum', () => {
    expect(knobRangeFor('speed', -3).min).toBe(-3)
  })

  it('falls back to 0..1 for an unknown method with a 0..1 value', () => {
    expect(knobRangeFor('wibble', 0.3)).toMatchObject({ min: 0, max: 1, step: 0.01 })
  })

  it('falls back to a value-containing range for an unknown out-of-unit method', () => {
    const r = knobRangeFor('wobble', 50)
    expect(r.min).toBeLessThanOrEqual(50)
    expect(r.max).toBeGreaterThanOrEqual(50)
  })

  it('handles a negative unknown value', () => {
    const r = knobRangeFor('wobble', -10)
    expect(r.min).toBeLessThanOrEqual(-10)
  })
})

/**
 * A catalog-wide invariant, added after the `stretch` entry broke it (#1530).
 *
 * The ＋More convention is that adding an effect gives you a dial you can
 * immediately move in either direction. A first draft defaulted `stretch` to an
 * octave, which is `1` — exactly the top of its own range — so the new knob
 * arrived on its rail with half its travel dead. Measured at the time: 22 of the
 * 23 entries landed strictly inside their range and only the new one did not.
 *
 * Named so the failure message says what is wrong rather than which index.
 */
describe('assertDefaultsInsideTheirRange', () => {
  for (const e of EFFECTS) {
    it(`${e.method} adds at a value the knob can move both ways from`, () => {
      const r = knobRangeFor(e.method, e.def)
      expect(e.def, `${e.method} adds on its range FLOOR (${r.min})`).toBeGreaterThan(r.min)
      expect(e.def, `${e.method} adds on its range CEILING (${r.max})`).toBeLessThan(r.max)
    })
  }
})
