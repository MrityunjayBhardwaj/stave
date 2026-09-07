/**
 * An `arrange` weight written as an expression (#1468 cause A).
 *
 * `parseArrangeArm` read the weight with `Number(text)`, so `[M*8, a]` gave
 * `NaN`, the arm returned null, and the CALLER discarded every arm — the whole
 * arrangement and the music with it. One real document is written that way, its
 * author having declared `var M = 1` precisely so the song's length could be
 * scaled from one place.
 *
 * ⚠ WHAT THIS DOES NOT DO, AND WHY THE REFUSAL ARM IS THE LOAD-BEARING ONE.
 * A weight is a POSITION: arm k starts at the sum of every earlier weight. So a
 * weight that cannot be read makes every LATER section's start unknown too, and
 * "drop the bad arm, keep the rest" — the right answer for the other
 * all-or-nothing bails in this file — would silently shift the whole song. When
 * the weight genuinely isn't a number we can know, discarding the arrangement
 * stays correct. What was wrong was refusing weights that CAN be known.
 *
 * Measured over 329 corpus documents: 125 arrange arms, of which 115 are bare
 * literals, 2 are literal arithmetic, 8 need one numeric binding, and ZERO are
 * unresolvable. There is no real document asking us to guess.
 */
import { describe, it, expect } from 'vitest'
import {
  parseStrudel,
  collectNumericBindings,
  evalWeightExpression,
} from '../parseStrudel'
import type { PatternIR } from '../PatternIR'

/** The first `Arrange` node anywhere in the tree, or null. */
function findArrange(ir: unknown): { arms: { weight: number }[] } | null {
  if (Array.isArray(ir)) {
    for (const x of ir) {
      const f = findArrange(x)
      if (f) return f
    }
    return null
  }
  if (!ir || typeof ir !== 'object') return null
  const n = ir as Record<string, unknown>
  if (n.tag === 'Arrange') return n as unknown as { arms: { weight: number }[] }
  for (const [k, v] of Object.entries(n)) {
    if (k === 'loc' || k === 'keyLoc') continue
    const f = findArrange(v)
    if (f) return f
  }
  return null
}

/** Sound-producing leaves — an Arrange with none is a degraded arrangement. */
function countPlay(ir: unknown): number {
  if (Array.isArray(ir)) return ir.reduce((a: number, x) => a + countPlay(x), 0)
  if (!ir || typeof ir !== 'object') return 0
  const n = ir as Record<string, unknown>
  let total = n.tag === 'Play' ? 1 : 0
  for (const [k, v] of Object.entries(n)) {
    if (k === 'loc' || k === 'keyLoc') continue
    total += countPlay(v)
  }
  return total
}

const weights = (code: string) => findArrange(parseStrudel(code) as PatternIR)?.arms.map((a) => a.weight)

describe('#1468 A — a weight that is not a bare literal', () => {
  it('resolves a numeric top-level binding: var M = 1 makes M*8 eight cycles', () => {
    const code = [
      'var M = 1',
      'let a = s("bd")',
      'let b = s("hh")',
      '$: arrange([M*8, a], [M*4, b])',
    ].join('\n')
    expect(weights(code)).toEqual([8, 4])
    // and the leaves arrive — an Arrange with none is the same blank timeline
    expect(countPlay(parseStrudel(code) as PatternIR)).toBeGreaterThan(0)
  })

  it('constant-folds literal arithmetic with no bindings at all', () => {
    expect(weights('arrange([1*4, note("c3")], [2+2, note("e3")])')).toEqual([4, 4])
  })

  it('leaves a bare literal exactly as it was (the control)', () => {
    expect(weights('arrange([2, note("c3")], [1, note("e3")])')).toEqual([2, 1])
  })

  it('reads the shape the real document is written in', () => {
    const code = [
      'var M = 1;',
      'let a = s("bd")',
      'let b = s("hh")',
      '$: arrange([M*8, a], [M*8, a], [M*4, b], [1*4, b])',
    ].join('\n')
    expect(weights(code)).toEqual([8, 8, 4, 4])
  })

  it('STILL DISCARDS an arrangement whose weight is not a number we can know', () => {
    // A call is not statically a number. Refusing the whole arrangement is
    // correct here: a guessed weight would move every section after it.
    const code = ['let a = s("bd")', 'let b = s("hh")', '$: arrange([slider(4), a], [4, b])'].join('\n')
    expect(weights(code)).toBeUndefined()
  })

  it('a numeric binding is read even when the PATTERN bindings decline', () => {
    // `collectTopLevelBindings` bails on the whole document when one binding
    // stays opaque; the numeric scan is independent of it by construction.
    const code = ['var M = 2', 'let bad = zzzUnknown(1,2,3)'].join('\n')
    expect(collectNumericBindings(code)?.get('M')).toBe(2)
  })
})

describe('#1468 A — collectNumericBindings', () => {
  it('reads let / const / var, and lets a later declaration use an earlier one', () => {
    const n = collectNumericBindings('let a = 2\nconst b = 3\nvar c = a * b + 1')
    expect(n?.get('a')).toBe(2)
    expect(n?.get('b')).toBe(3)
    expect(n?.get('c')).toBe(7)
  })

  it('ignores a non-numeric initialiser rather than guessing at it', () => {
    const n = collectNumericBindings('let a = 2\nlet p = s("bd")\nlet q = "4"')
    expect(n?.has('a')).toBe(true)
    expect(n?.has('p')).toBe(false)
    expect(n?.has('q')).toBe(false)
  })

  it('is undefined for a document with no numeric bindings, and for one that will not parse', () => {
    expect(collectNumericBindings('s("bd")')).toBeUndefined()
    expect(collectNumericBindings('let = = =')).toBeUndefined()
  })
})

describe('#1468 A — evalWeightExpression', () => {
  it('takes the fast path for a literal and the AST path for an expression', () => {
    expect(evalWeightExpression('4')).toBe(4)
    expect(evalWeightExpression('2.5')).toBe(2.5)
    expect(evalWeightExpression('-3')).toBe(-3)
    expect(evalWeightExpression('8 / 2')).toBe(4)
    expect(evalWeightExpression('2 ** 3')).toBe(8)
    expect(evalWeightExpression('M * 8', new Map([['M', 2]]))).toBe(16)
  })

  it('returns null rather than a number it cannot justify', () => {
    for (const src of ['', 'slider(4)', 'x.length', '"4"', 'a + 1', '8 / 0', 'M*8']) {
      expect(evalWeightExpression(src)).toBeNull()
    }
  })
})
