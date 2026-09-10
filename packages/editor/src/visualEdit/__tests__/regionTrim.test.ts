/**
 * regionTrim — the write decisions for a sample's played region (#1527).
 *
 * Every argument shape asserted here was taken from the 558-document archive
 * rather than invented, because the shape that breaks a rewrite is by
 * construction the one nobody writes by hand in a fixture. The four that
 * actually occur: a numeric literal, a quoted mini pattern, a computed
 * expression, and a bound identifier.
 */
import { describe, it, expect } from 'vitest'
import { detectChunk, type ChunkInfo } from '../chunkDetect'
import {
  MIN_REGION_SPAN,
  readRegion,
  readRegionControl,
  regionControlEdit,
  regionTrimEdit,
  regionValueAtDrag,
} from '../regionTrim'

function chunkOf(code: string): ChunkInfo {
  const c = detectChunk(code, code.length - 1)
  expect(c, `no chunk detected for ${JSON.stringify(code)}`).not.toBeNull()
  return c!
}

/**
 * The chunk a LANE ANCHOR resolves to — position 0, the statement's own start.
 *
 * ⚠ NOT THE SAME AS `chunkOf`, and the difference is the whole reason the
 * multi-voice guard exists. `detectChunk` descends to the innermost chain under
 * the position it is given, so a cursor at the END of `stack(s("a"), s("b"))`
 * lands INSIDE the last arm and reports `headFn: 's'` — a single voice. The lane
 * anchor points at the statement, where the same document reports `stack`. An
 * arm written with the end-of-line helper would have passed the guard by never
 * reaching it.
 */
function chunkAtAnchor(code: string): ChunkInfo {
  const c = detectChunk(code, 0)
  expect(c, `no chunk detected at the anchor for ${JSON.stringify(code)}`).not.toBeNull()
  return c!
}

/** Apply an edit the way the writeback would, so assertions read as documents. */
function applied(code: string, edit: { range: [number, number]; text: string }): string {
  return code.slice(0, edit.range[0]) + edit.text + code.slice(edit.range[1])
}

describe('readRegionControl — absent, numeric and refused are three answers', () => {
  it('reports `absent` when the document does not write the control', () => {
    expect(readRegionControl(chunkOf('$: s("take_1")'), 'begin')).toBe('absent')
    expect(readRegionControl(chunkOf('$: s("take_1")'), 'end')).toBe('absent')
  })

  it('reports the number when it is a literal, including a leading-dot one', () => {
    expect(readRegionControl(chunkOf('$: s("take_1").begin(0.25)'), 'begin')).toBe(0.25)
    // `.045` and `.5` are how the corpus actually writes these.
    expect(readRegionControl(chunkOf('$: s("take_1").begin(.045)'), 'begin')).toBe(0.045)
  })

  it.each([
    ['a quoted mini pattern', '$: s("take_1").begin("<0 .25 .5 .75>")'],
    ['a computed expression', '$: s("take_1").begin(rand.rangex(0.1,.5))'],
    ['a bound identifier', '$: s("take_1").begin(beginVal)'],
  ])('reports null — not absent — for %s', (_label, code) => {
    expect(readRegionControl(chunkOf(code), 'begin')).toBeNull()
  })

  it('⚠ absent and refused must not collapse: one is writable and one is not', () => {
    const absent = readRegionControl(chunkOf('$: s("take_1")'), 'begin')
    const refused = readRegionControl(chunkOf('$: s("take_1").begin("<0 .5>")'), 'begin')
    expect(absent).not.toBe(refused)
  })

  it('the LAST spelling wins, because that is the one that plays', () => {
    expect(readRegionControl(chunkOf('$: s("t").begin(0.1).begin(0.7)'), 'begin')).toBe(0.7)
  })
})

describe('readRegion — the region as the document writes it', () => {
  it('resolves absent controls to superdough defaults', () => {
    expect(readRegion(chunkOf('$: s("take_1")'))).toEqual({ begin: 0, end: 1 })
    expect(readRegion(chunkOf('$: s("take_1").begin(0.3)'))).toEqual({ begin: 0.3, end: 1 })
  })

  it('refuses the whole region when EITHER end is patterned', () => {
    expect(readRegion(chunkOf('$: s("t").begin(0.2).end("<0.5 0.9>")'))).toBeNull()
    expect(readRegion(chunkOf('$: s("t").begin("<0 0.5>").end(0.9)'))).toBeNull()
  })
})

describe('regionControlEdit — replace, append, refuse', () => {
  it('appends the call when the control is absent', () => {
    const code = '$: s("take_1")'
    const edit = regionControlEdit(chunkOf(code), 'begin', 0.25)
    expect(edit).not.toBeNull()
    expect(applied(code, edit!)).toBe('$: s("take_1").begin(0.25)')
  })

  it('appends AFTER the whole chain, not inside it', () => {
    const code = '$: s("take_1").gain(0.8).room(0.3)'
    const edit = regionControlEdit(chunkOf(code), 'end', 0.5)
    expect(applied(code, edit!)).toBe('$: s("take_1").gain(0.8).room(0.3).end(0.5)')
  })

  it('replaces ONLY the literal, leaving every other byte alone', () => {
    const code = '$: s("take_1").begin(0.1).end(0.6).gain(0.8)'
    const edit = regionControlEdit(chunkOf(code), 'begin', 0.25)
    expect(applied(code, edit!)).toBe('$: s("take_1").begin(0.25).end(0.6).gain(0.8)')
  })

  it.each([
    ['patterned', '$: s("t").begin("<0 .25 .5 .75>")'],
    ['computed', '$: s("t").begin(rand.rangex(0.1,.5))'],
    ['bound', '$: s("t").begin(beginVal)'],
  ])('refuses a %s value rather than overwriting it', (_l, code) => {
    expect(regionControlEdit(chunkOf(code), 'begin', 0.25)).toBeNull()
  })

  it('does NOT clamp — clamping needs the other edge, and is regionTrimEdit`s job', () => {
    const code = '$: s("t").begin(0.1)'
    // Deliberately out of range. A primitive that silently repaired this would
    // make "refused" and "rewritten to something else" indistinguishable.
    expect(applied(code, regionControlEdit(chunkOf(code), 'begin', 4)!)).toBe('$: s("t").begin(4)')
  })
})

describe('regionTrimEdit — clamped against the OTHER edge', () => {
  it('writes the value when it is in range', () => {
    const code = '$: s("take_1")'
    const r = regionTrimEdit(chunkOf(code), 'begin', 0.25)
    expect(r.refusal).toBeNull()
    expect(r.value).toBe(0.25)
    expect(applied(code, r.edit!)).toBe('$: s("take_1").begin(0.25)')
  })

  it('a begin dragged past its end stops one span short of it, never past', () => {
    const code = '$: s("t").begin(0.1).end(0.6)'
    const r = regionTrimEdit(chunkOf(code), 'begin', 0.95)
    expect(r.value).toBeCloseTo(0.6 - MIN_REGION_SPAN, 10)
    expect(applied(code, r.edit!)).toBe('$: s("t").begin(0.59).end(0.6)')
  })

  it('an end dragged below its begin stops one span above it', () => {
    const code = '$: s("t").begin(0.4).end(0.9)'
    const r = regionTrimEdit(chunkOf(code), 'end', 0.05)
    expect(r.value).toBeCloseTo(0.4 + MIN_REGION_SPAN, 10)
    expect(applied(code, r.edit!)).toBe('$: s("t").begin(0.4).end(0.41)')
  })

  it('⚠ the clamp is against the PARTNER, not against 0..1 — the pair proves it', () => {
    // Same requested value, two documents differing only in `end`. If the clamp
    // read 0..1 instead of the partner, both would write 0.8.
    const wide = regionTrimEdit(chunkOf('$: s("t").begin(0).end(1)'), 'begin', 0.8)
    const narrow = regionTrimEdit(chunkOf('$: s("t").begin(0).end(0.3)'), 'begin', 0.8)
    expect(wide.value).toBe(0.8)
    expect(narrow.value).toBeCloseTo(0.3 - MIN_REGION_SPAN, 10)
  })

  it('clamps to 0 and 1 at the outer ends', () => {
    expect(regionTrimEdit(chunkOf('$: s("t").begin(0.5)'), 'begin', -3).value).toBe(0)
    expect(regionTrimEdit(chunkOf('$: s("t").end(0.5)'), 'end', 42).value).toBe(1)
  })

  it('refuses when the control being dragged is patterned', () => {
    const r = regionTrimEdit(chunkOf('$: s("t").begin("<0 .5>")'), 'begin', 0.25)
    expect(r.edit).toBeNull()
    expect(r.refusal).toBe('not-a-number')
  })

  it('⚠ refuses when the PARTNER is patterned, even though the target is a number', () => {
    // There is no single `end` to clamp against on the cycle being looked at,
    // and clamping against the default 1 would let `begin` be dragged past the
    // end this mark actually plays.
    const r = regionTrimEdit(chunkOf('$: s("t").begin(0.1).end("<0.3 0.8>")'), 'begin', 0.5)
    expect(r.edit).toBeNull()
    expect(r.refusal).toBe('not-a-number')
  })

  it('⚠ refuses an expression that combines several voices', () => {
    // A lane's anchor resolves to the OUTER combinator for a nested arm, and
    // appending there is valid code that trims the wrong sounds. The agreement
    // check cannot see it: neither the mark nor the `stack` has a region, so
    // both read the default and they agree.
    const r = regionTrimEdit(chunkAtAnchor('$: stack(s("drums"), s("take_1"))'), 'begin', 0.25)
    expect(r.edit).toBeNull()
    expect(r.refusal).toBe('not-one-voice')
  })

  it.each(['cat', 'seq', 'arrange', 'overlay', 'fastcat', 'polymeter'])(
    'refuses `%s` for the same reason',
    (head) => {
      const r = regionTrimEdit(chunkAtAnchor(`$: ${head}(s("a"), s("b"))`), 'begin', 0.25)
      expect(r.refusal).toBe('not-one-voice')
    },
  )

  it('CONTROL — a single-voice head is NOT refused, so the list discriminates', () => {
    // Without this, "everything is refused" would pass every arm above.
    expect(regionTrimEdit(chunkAtAnchor('$: s("take_1")'), 'begin', 0.25).refusal).toBeNull()
    expect(regionTrimEdit(chunkAtAnchor('$: note("c e g")'), 'begin', 0.25).refusal).toBeNull()
  })

  it('reports no-change rather than pushing an undo step that changes no bytes', () => {
    const r = regionTrimEdit(chunkOf('$: s("t").begin(0.25)'), 'begin', 0.25)
    expect(r.edit).toBeNull()
    expect(r.refusal).toBe('no-change')
  })

  it('no-change compares the FORMATTED form, since that is what lands in the doc', () => {
    // formatNumber caps at 4 decimals, so these two render identically.
    const r = regionTrimEdit(chunkOf('$: s("t").begin(0.25)'), 'begin', 0.250004)
    expect(r.refusal).toBe('no-change')
  })

  it('an absent control still round-trips through the clamp', () => {
    // begin absent → 0; asking for 0 is no change, asking for 0.2 appends.
    expect(regionTrimEdit(chunkOf('$: s("t")'), 'begin', 0).refusal).toBe('no-change')
    expect(regionTrimEdit(chunkOf('$: s("t")'), 'begin', 0.2).edit).not.toBeNull()
  })
})

describe('regionValueAtDrag — the scale is the caller`s, fixed at pointer-down', () => {
  it('is linear in the travel', () => {
    expect(regionValueAtDrag(0.2, 10, 0.01)).toBeCloseTo(0.3, 10)
    expect(regionValueAtDrag(0.2, -10, 0.01)).toBeCloseTo(0.1, 10)
    // Twice the travel is twice the change — the property that fails if a
    // caller re-derives the scale against a shrinking slice each move.
    expect(regionValueAtDrag(0.2, 20, 0.01) - 0.2).toBeCloseTo(
      2 * (regionValueAtDrag(0.2, 10, 0.01) - 0.2),
      10,
    )
  })

  it('returns the start value unchanged for a scale that cannot be used', () => {
    expect(regionValueAtDrag(0.2, 10, 0)).toBe(0.2)
    expect(regionValueAtDrag(0.2, 10, Number.NaN)).toBe(0.2)
    expect(regionValueAtDrag(0.2, Number.NaN, 0.01)).toBe(0.2)
  })
})

describe('the shapes that actually occur in the archive', () => {
  // Verbatim from the 558-document sweep. Each is a real call site.
  const REAL = [
    ['numeric', '.begin(0.05)', true],
    ['numeric, leading dot', '.begin(.045)', true],
    ['numeric', '.end(0.2)', true],
    ['quoted mini, alternation', '.begin("[0|0.05|0.1|0.15]/2")', false],
    ['quoted mini, cycle list', '.begin("<0 .25 .5 .75>")', false],
    ['quoted mini, a rest', '.begin("<0 - - >")', false],
    ['quoted number', '.begin("0")', false],
    ['bound identifier', '.begin(beginVal)', false],
    ['computed', '.end(rand.rangex(0.1,.5))', false],
    ['computed, multiline', '.end(perlin.range(0.02,.05).slow(8))', false],
    ['arithmetic', '.end(.25 + (.25 * .25 * .5))', false],
    // ⚠ WRITABLE, and this expectation was wrong before it was run. The chunk
    // detector reads THROUGH the parentheses — `raw` is `0.630`, `numeric` is
    // 0.63, and the range covers the literal alone — so the edit lands inside
    // them and yields `.end((0.42))`. Surgical and valid; the outer parens are
    // the user's bytes and stay theirs.
    ['parenthesised literal', '.end((0.630))', true],
  ] as const

  it.each(REAL)('%s — %s writable=%s', (_label, call, writable) => {
    const code = `$: s("take_1")${call}`
    const control = call.startsWith('.begin') ? 'begin' : 'end'
    const edit = regionControlEdit(chunkOf(code), control, 0.42)
    expect(edit !== null).toBe(writable)
  })

  it('reports the split, so a change in the refusal rate is visible', () => {
    const writable = REAL.filter((r) => r[2]).length
    expect(`${writable}/${REAL.length}`).toBe('4/12')
  })
})
