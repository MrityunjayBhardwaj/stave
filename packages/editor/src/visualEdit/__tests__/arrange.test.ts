/**
 * Phase 5b (#437) — arrangement write-back substrate: combinator-arm parser +
 * surgical serializer. Three layers, mirroring the P5a IR test:
 *   1. DETECT     — parser exposes per-arm ranges (weight + pattern) for
 *                   arrange/cat/slowcat at the JS-argument altitude.
 *   2. SERIALIZE  — each op is a surgical OffsetEdit set; byte-fidelity (only
 *                   the targeted bytes move).
 *   3. PARITY     — edit the TEXT, re-parse with parseStrudel → the Arrange IR
 *                   changed exactly as intended (the loop closes; PV122 #1–#3).
 */
import { describe, it, expect } from 'vitest'
import {
  detectArrangeAt,
  detectAllArrangeCalls,
  detectBarePattern,
  setWeight,
  reorderArm,
  insertArm,
  insertSilenceArm,
  removeArm,
  silenceArm,
  wrapBare,
  materializeBareDelete,
  materializeBareSplit,
  splitArm,
  setArmPattern,
  listArrangeSectionParts,
  applyEdits,
} from '../index'
import { parseStrudel } from '../../ir'
import type { PatternIR } from '../../ir'

/** Pull the inner expression out of parseStrudel's synthetic `d1` Track. */
function inner(ir: PatternIR): PatternIR {
  if (ir.tag === 'Track' && (ir as { userMethod?: string }).userMethod === undefined) {
    return (ir as { body: PatternIR }).body
  }
  return ir
}
function asArrange(code: string): PatternIR & { tag: 'Arrange' } {
  const node = inner(parseStrudel(code))
  if (node.tag !== 'Arrange') throw new Error(`expected Arrange, got ${node.tag}`)
  return node
}
const slice = (doc: string, r: [number, number]): string => doc.slice(r[0], r[1])

describe('arrange parser — detectArrangeAt', () => {
  it('exposes weight + pattern ranges for an arrange node', () => {
    const doc = 'arrange([2, s("bd")], [1, s("hh")])'
    const call = detectArrangeAt(doc, doc.indexOf('[2'))
    expect(call).not.toBeNull()
    expect(call!.mode).toBe('arrange')
    expect(slice(doc, call!.callRange)).toBe(doc)
    expect(slice(doc, call!.calleeRange)).toBe('arrange')
    expect(call!.arms).toHaveLength(2)
    expect(slice(doc, call!.arms[0].weightRange!)).toBe('2')
    expect(slice(doc, call!.arms[0].patternRange)).toBe('s("bd")')
    expect(slice(doc, call!.arms[0].armRange)).toBe('[2, s("bd")]')
    expect(slice(doc, call!.arms[1].weightRange!)).toBe('1')
    expect(slice(doc, call!.arms[1].patternRange)).toBe('s("hh")')
  })

  it('exposes bare-pattern arms (no weight) for cat / slowcat', () => {
    const doc = 'cat(s("bd"), note("c3 e3"))'
    const call = detectArrangeAt(doc, doc.indexOf('s("bd")'))
    expect(call!.mode).toBe('cat')
    expect(call!.arms[0].weightRange).toBeNull()
    expect(slice(doc, call!.arms[0].patternRange)).toBe('s("bd")')
    expect(slice(doc, call!.arms[1].patternRange)).toBe('note("c3 e3")')
  })

  it('binds the INNERMOST combinator when nested', () => {
    const doc = 'arrange([2, cat(s("bd"), s("hh"))], [1, s("cp")])'
    const inCat = doc.indexOf('s("hh")')
    const call = detectArrangeAt(doc, inCat)
    expect(call!.mode).toBe('cat')
    expect(slice(doc, call!.callRange)).toBe('cat(s("bd"), s("hh"))')
  })

  it('returns null off any combinator, and rejects a malformed arrange arm', () => {
    expect(detectArrangeAt('s("bd")', 2)).toBeNull()
    // arrange arm not a [n, pat] tuple → unparseable as an arrange clip
    expect(detectArrangeAt('arrange(s("bd"))', 10)).toBeNull()
  })

  it('detectAllArrangeCalls finds every call in source order', () => {
    const doc = '$: cat(s("a"), s("b"))\n$: arrange([2, s("c")], [1, s("d")])'
    const calls = detectAllArrangeCalls(doc)
    expect(calls.map((c) => c.mode)).toEqual(['cat', 'arrange'])
  })
})

describe('arrange parser — detectBarePattern (§2.1 wrap target)', () => {
  it('returns the bare pattern expression range', () => {
    const doc = 's("bd hh")'
    const bare = detectBarePattern(doc, 3)
    expect(bare).not.toBeNull()
    expect(slice(doc, bare!.patternRange)).toBe('s("bd hh")')
  })

  it('excludes a `$:` label — returns only the EXPRESSION range', () => {
    const doc = '$: s("bd hh")'
    const bare = detectBarePattern(doc, doc.indexOf('bd'))
    expect(slice(doc, bare!.patternRange)).toBe('s("bd hh")')
  })

  it('returns the whole expression for a `.p()`-named bare track', () => {
    const doc = 's("bd hh").p("drums")'
    const bare = detectBarePattern(doc, 3)
    expect(slice(doc, bare!.patternRange)).toBe('s("bd hh").p("drums")')
  })

  it('picks the top-level track CONTAINING pos in a multi-track doc', () => {
    const doc = '$: s("bd")\n$: note("c3 e3")'
    const bare = detectBarePattern(doc, doc.indexOf('c3'))
    expect(slice(doc, bare!.patternRange)).toBe('note("c3 e3")')
  })

  // #657 — a trailing `.viz(...)` is a DISPLAY annotation on the whole statement,
  // not part of the sound pattern, so it must be EXCLUDED from the wrap target.
  it('excludes a trailing `.viz(...)` from the pattern range (#657)', () => {
    const doc = '$: s("bd*4").viz("pianoroll")'
    const bare = detectBarePattern(doc, doc.indexOf('bd'))
    expect(slice(doc, bare!.patternRange)).toBe('s("bd*4")')
  })

  it('excludes only the trailing `.viz(...)`, keeping sound methods like `.gain()` (#657)', () => {
    const doc = '$: s("bd*4").gain(0.5).viz("pianoroll")'
    const bare = detectBarePattern(doc, doc.indexOf('bd'))
    expect(slice(doc, bare!.patternRange)).toBe('s("bd*4").gain(0.5)')
  })

  it('split MATERIALIZE keeps `.viz()` terminal on the statement, not in the arms (#657)', () => {
    const doc = '$: s("bd*4").viz("pianoroll")'
    const bare = detectBarePattern(doc, doc.indexOf('bd'))!
    expect(applyEdits(doc, materializeBareSplit(doc, bare.patternRange, 1, 2))).toBe(
      '$: arrange([1, s("bd*4")], [1, s("bd*4")]).viz("pianoroll")',
    )
  })

  it('returns null inside a combinator track (detectArrangeAt owns it)', () => {
    const doc = 'arrange([2, s("bd")], [1, s("hh")])'
    expect(detectBarePattern(doc, doc.indexOf('bd'))).toBeNull()
  })

  it('wrap path: detectBarePattern → wrapBare introduces the combinator', () => {
    const doc = 's("bd hh")'
    const bare = detectBarePattern(doc, 3)!
    // Move the bare track to start at cycle 3 (lead 3), 1-cycle clip.
    expect(applyEdits(doc, wrapBare(bare.patternRange, 3, 1))).toBe(
      'arrange([3, silence], [1, s("bd hh")])',
    )
  })

  // #489 — materialize a bare loop into an arrange by carving a one-cycle gap at
  // a selected bar over an N-bar span (the explicit "introduce the combinator").
  describe('materializeBareDelete (#489)', () => {
    const doc = 's("bd*4")'
    const range: [number, number] = [0, doc.length]

    it('carves a middle bar: gap at bar 2 of 4 → [2,pat],[1,silence],[1,pat]', () => {
      expect(applyEdits(doc, materializeBareDelete(doc, range, 2, 4))).toBe(
        'arrange([2, s("bd*4")], [1, silence], [1, s("bd*4")])',
      )
    })

    it('gap at the FIRST bar drops the leading pat arm', () => {
      expect(applyEdits(doc, materializeBareDelete(doc, range, 0, 4))).toBe(
        'arrange([1, silence], [3, s("bd*4")])',
      )
    })

    it('gap at the LAST bar drops the trailing pat arm', () => {
      expect(applyEdits(doc, materializeBareDelete(doc, range, 3, 4))).toBe(
        'arrange([3, s("bd*4")], [1, silence])',
      )
    })

    it('refuses to empty the track — deleting the sole bar is a no-op', () => {
      expect(materializeBareDelete(doc, range, 0, 1)).toEqual([])
    })

    it('preserves the pattern bytes verbatim in every surviving arm', () => {
      const d = 'note("c e g").s("sawtooth")'
      const out = applyEdits(d, materializeBareDelete(d, [0, d.length], 1, 3))
      expect(out).toBe(
        'arrange([1, note("c e g").s("sawtooth")], [1, silence], [1, note("c e g").s("sawtooth")])',
      )
    })
  })

  // #489 (reframe) — split-first materialization: selecting the whole bare loop
  // and splitting it introduces the combinator with NO audible change (two arms,
  // same pattern), after which the arms are individually selectable.
  describe('materializeBareSplit (#489)', () => {
    const doc = 's("bd*4")'
    const range: [number, number] = [0, doc.length]

    it('splits at an interior bar: bar 2 of 4 → [2,pat],[2,pat] (same sound)', () => {
      expect(applyEdits(doc, materializeBareSplit(doc, range, 2, 4))).toBe(
        'arrange([2, s("bd*4")], [2, s("bd*4")])',
      )
    })

    it('split at bar 1 of 4 → [1,pat],[3,pat]', () => {
      expect(applyEdits(doc, materializeBareSplit(doc, range, 1, 4))).toBe(
        'arrange([1, s("bd*4")], [3, s("bd*4")])',
      )
    })

    it('clamps the boundary into [1, span−1] — both halves stay ≥ 1 cycle', () => {
      expect(applyEdits(doc, materializeBareSplit(doc, range, 0, 4))).toBe(
        'arrange([1, s("bd*4")], [3, s("bd*4")])',
      )
      expect(applyEdits(doc, materializeBareSplit(doc, range, 4, 4))).toBe(
        'arrange([3, s("bd*4")], [1, s("bd*4")])',
      )
    })

    it('refuses a span < 2 — a 1-cycle loop has no interior boundary', () => {
      expect(materializeBareSplit(doc, range, 1, 1)).toEqual([])
    })

    it('preserves the pattern bytes verbatim in both arms', () => {
      const d = 'note("c e g").s("sawtooth")'
      expect(applyEdits(d, materializeBareSplit(d, [0, d.length], 1, 4))).toBe(
        'arrange([1, note("c e g").s("sawtooth")], [3, note("c e g").s("sawtooth")])',
      )
    })
  })
})

describe('arrange serializer — surgical, byte-fidelity', () => {
  it('round-trip: setting a weight to its current value is a no-op edit', () => {
    const doc = 'arrange([2, s("bd")], [1, s("hh")])'
    const call = detectArrangeAt(doc, doc.indexOf('[2'))!
    expect(applyEdits(doc, setWeight(doc, call, 0, 2))).toBe(doc)
  })

  it('set-weight changes ONLY the weight digits', () => {
    const doc = 'arrange([2, s("bd")], [1, s("hh")])'
    const call = detectArrangeAt(doc, doc.indexOf('[2'))!
    const out = applyEdits(doc, setWeight(doc, call, 0, 3))
    expect(out).toBe('arrange([3, s("bd")], [1, s("hh")])')
    // exactly one character differs
    expect([...out].filter((ch, i) => ch !== doc[i])).toEqual(['3'])
  })

  it('set-weight on cat promotes cat → arrange, patterns verbatim (PV122 #3)', () => {
    const doc = 'cat(s("bd"), note("c3 e3"))'
    const call = detectArrangeAt(doc, 0)!
    const out = applyEdits(doc, setWeight(doc, call, 1, 2))
    expect(out).toBe('arrange([1, s("bd")], [2, note("c3 e3")])')
  })

  it('set-weight 1 on cat is a no-op (cat weight is implicitly 1)', () => {
    const doc = 'cat(s("bd"), s("hh"))'
    const call = detectArrangeAt(doc, 0)!
    expect(applyEdits(doc, setWeight(doc, call, 0, 1))).toBe(doc)
  })

  it('§2.1 wrap: a bare pattern becomes an arrange with a leading silence', () => {
    const doc = 's("bd")'
    const out = applyEdits(doc, wrapBare([0, doc.length], 16, 1))
    expect(out).toBe('arrange([16, silence], [1, s("bd")])')
  })

  it('remove-arm drops the arm and one separator', () => {
    const doc = 'arrange([2, s("bd")], [1, s("hh")], [1, s("cp")])'
    const call = detectArrangeAt(doc, 0)!
    expect(applyEdits(doc, removeArm(doc, call, 1))).toBe(
      'arrange([2, s("bd")], [1, s("cp")])',
    )
    // last arm
    expect(applyEdits(doc, removeArm(doc, call, 2))).toBe(
      'arrange([2, s("bd")], [1, s("hh")])',
    )
  })

  it('remove-arm refuses to empty the combinator (PV122 #5)', () => {
    const doc = 'arrange([2, s("bd")])'
    const call = detectArrangeAt(doc, 0)!
    expect(removeArm(doc, call, 0)).toEqual([])
  })

  // #491 — GAP delete: silence an arm IN PLACE, keeping its width (later arms
  // do NOT slide left — the timeline is absolute, unlike removeArm's ripple).
  it('silence-arm replaces the arm pattern with silence, width kept', () => {
    const doc = 'arrange([2, s("bd")], [1, s("hh")], [1, s("cp")])'
    const call = detectArrangeAt(doc, 0)!
    expect(applyEdits(doc, silenceArm(doc, call, 1))).toBe(
      'arrange([2, s("bd")], [1, silence], [1, s("cp")])',
    )
    // last arm — same in-place silencing, no separator change
    expect(applyEdits(doc, silenceArm(doc, call, 2))).toBe(
      'arrange([2, s("bd")], [1, s("hh")], [1, silence])',
    )
  })

  it('silence-arm on a cat arm (implicit weight 1) → silence', () => {
    const doc = 'cat(s("bd"), s("hh"))'
    const call = detectArrangeAt(doc, 0)!
    expect(applyEdits(doc, silenceArm(doc, call, 0))).toBe('cat(silence, s("hh"))')
  })

  it('silence-arm is a no-op on an already-silent arm; may silence the sole arm', () => {
    const doc = 'arrange([2, silence], [1, s("hh")])'
    const call = detectArrangeAt(doc, 0)!
    expect(silenceArm(doc, call, 0)).toEqual([]) // already silence
    // unlike removeArm, silencing the SOLE arm is allowed (a muted track)
    const solo = 'arrange([4, s("bd")])'
    const soloCall = detectArrangeAt(solo, 0)!
    expect(applyEdits(solo, silenceArm(solo, soloCall, 0))).toBe('arrange([4, silence])')
  })

  it('insert-arm adds an arm at an index and at the end', () => {
    const doc = 'arrange([2, s("bd")], [1, s("hh")])'
    const call = detectArrangeAt(doc, 0)!
    expect(applyEdits(doc, insertArm(doc, call, 1, '[3, s("cp")]'))).toBe(
      'arrange([2, s("bd")], [3, s("cp")], [1, s("hh")])',
    )
    expect(applyEdits(doc, insertArm(doc, call, 2, '[3, s("cp")]'))).toBe(
      'arrange([2, s("bd")], [1, s("hh")], [3, s("cp")])',
    )
  })

  it('reorder-arm moves an arm, patterns verbatim', () => {
    const doc = 'arrange([2, s("bd")], [1, s("hh")], [1, s("cp")])'
    const call = detectArrangeAt(doc, 0)!
    expect(applyEdits(doc, reorderArm(doc, call, 2, 0))).toBe(
      'arrange([1, s("cp")], [2, s("bd")], [1, s("hh")])',
    )
  })

  it('split-arm slices [n, pat] → [n₁, pat], [n₂, pat], pattern verbatim', () => {
    const doc = 'arrange([4, s("bd")], [2, s("hh")])'
    const call = detectArrangeAt(doc, 0)!
    expect(applyEdits(doc, splitArm(doc, call, 0, 1))).toBe(
      'arrange([1, s("bd")], [3, s("bd")], [2, s("hh")])',
    )
    // midpoint split of the weight-2 arm
    expect(applyEdits(doc, splitArm(doc, call, 1, 1))).toBe(
      'arrange([4, s("bd")], [1, s("hh")], [1, s("hh")])',
    )
  })

  it('split-arm clamps firstWeight into [1, n−1]', () => {
    const doc = 'arrange([3, s("bd")], [1, s("hh")])'
    const call = detectArrangeAt(doc, 0)!
    // firstWeight 9 → clamped to n−1 = 2
    expect(applyEdits(doc, splitArm(doc, call, 0, 9))).toBe(
      'arrange([2, s("bd")], [1, s("bd")], [1, s("hh")])',
    )
  })

  it('split-arm refuses a weight-1 arm and a cat arm (indivisible)', () => {
    const arr = 'arrange([1, s("bd")], [2, s("hh")])'
    expect(splitArm(arr, detectArrangeAt(arr, 0)!, 0, 1)).toEqual([]) // weight 1
    const cat = 'cat(s("bd"), s("hh"))'
    expect(splitArm(cat, detectArrangeAt(cat, 0)!, 0, 1)).toEqual([]) // cat arm: weight 1
  })
})

describe('arrange parity — edit text → re-parse → IR changed (PV122 #1–#3)', () => {
  it('set-weight moves the clip extent: re-parsed arm weight + period change', () => {
    const doc = 'arrange([2, s("bd")], [2, s("hh")])'
    const before = asArrange(doc)
    expect(before.arms.map((a) => a.weight)).toEqual([2, 2]) // period 4
    // edit through the arm loc the IR already carries (the write-back anchor)
    const anchor = before.arms[0].loc![0].start
    const call = detectArrangeAt(doc, anchor)!
    const out = applyEdits(doc, setWeight(doc, call, 0, 4))

    const after = asArrange(out)
    expect(after.mode).toBe('arrange')
    expect(after.arms.map((a) => a.weight)).toEqual([4, 2]) // period now 6
    // arm 0 spans [0,4); arm 1 now starts at cycle 4 (was 2) — extent moved
    const period = after.arms.reduce((s, a) => s + a.weight, 0)
    expect(period).toBe(6)
  })

  it('cat promotion re-parses as a weighted arrange', () => {
    const doc = 'cat(s("bd"), s("hh"))'
    const before = asArrange(doc)
    expect(before.mode).toBe('cat')
    const call = detectArrangeAt(doc, before.arms[1].loc![0].start)!
    const out = applyEdits(doc, setWeight(doc, call, 1, 3))

    const after = asArrange(out)
    expect(after.mode).toBe('arrange')
    expect(after.arms.map((a) => a.weight)).toEqual([1, 3])
  })
})

// ---------------------------------------------------------------------------
// #1461 — INSERT SILENCE: an empty section as wide as the one it follows.
// ---------------------------------------------------------------------------
describe('insertSilenceArm (#1461)', () => {
  const doc = 'arrange([2, s("bd")], [4, s("hh")])'
  const call = () => detectArrangeAt(doc, 0)!

  it('adds an empty section AFTER the selected one, at its width', () => {
    expect(applyEdits(doc, insertSilenceArm(doc, call(), 0))).toBe(
      'arrange([2, s("bd")], [2, silence], [4, s("hh")])',
    )
  })

  it('adds at the END when the last section is selected', () => {
    expect(applyEdits(doc, insertSilenceArm(doc, call(), 1))).toBe(
      'arrange([2, s("bd")], [4, s("hh")], [4, silence])',
    )
  })

  it('copies the weight as TEXT, so an expression survives', () => {
    // Real documents write `[M*8, …]`. Reading that as a number would pin the new
    // section to 8 and quietly decouple it from the variable.
    const expr = 'arrange([M*8, s("bd")], [2, s("hh")])'
    expect(applyEdits(expr, insertSilenceArm(expr, detectArrangeAt(expr, 0)!, 0))).toBe(
      'arrange([M*8, s("bd")], [M*8, silence], [2, s("hh")])',
    )
  })

  it('writes a BARE pattern into a cat, matching its siblings', () => {
    // `cat` arms carry no weight literal at all — an implicit 1 each.
    const cat = 'cat(s("bd"), s("hh"))'
    expect(applyEdits(cat, insertSilenceArm(cat, detectArrangeAt(cat, 0)!, 0))).toBe(
      'cat(s("bd"), silence, s("hh"))',
    )
  })

  it('declines for an arm that names nothing', () => {
    expect(insertSilenceArm(doc, call(), 9)).toEqual([])
    expect(insertSilenceArm(doc, call(), -1)).toEqual([])
  })

  it('leaves a document that still reads back as an arrangement', () => {
    // The whole point of copying bytes: the result has to re-parse, with one
    // more arm and the original arms untouched.
    const out = applyEdits(doc, insertSilenceArm(doc, call(), 0))
    const reparsed = detectArrangeAt(out, 0)
    expect(reparsed).not.toBeNull()
    expect(reparsed!.arms).toHaveLength(3)
  })
})

describe('setArmPattern — point a section at a different part (#1560)', () => {
  const doc = 'let bass = s("bd")\nlet lead = s("hh")\narrange([2, bass], [4, lead])'
  const call = () => detectArrangeAt(doc, doc.indexOf('arrange'))!

  it('rewrites ONLY the clicked arm\'s pattern, keeping its weight', () => {
    expect(applyEdits(doc, setArmPattern(doc, call(), 1, 'bass'))).toBe(
      'let bass = s("bd")\nlet lead = s("hh")\narrange([2, bass], [4, bass])',
    )
  })

  it('leaves a returning section alone — this is not the rename', () => {
    // Two arms name `bass`; pointing the FIRST at `lead` must not move the second.
    const twice = 'let bass = s("bd")\nlet lead = s("hh")\narrange([2, bass], [4, bass])'
    expect(applyEdits(twice, setArmPattern(twice, detectArrangeAt(twice, twice.indexOf('arrange'))!, 0, 'lead'))).toBe(
      'let bass = s("bd")\nlet lead = s("hh")\narrange([2, lead], [4, bass])',
    )
  })

  it('writes into a cat arm, which has no weight wrapper to keep', () => {
    const cat = 'let bass = s("bd")\ncat(s("hh"), s("sd"))'
    expect(applyEdits(cat, setArmPattern(cat, detectArrangeAt(cat, cat.indexOf('cat'))!, 0, 'bass'))).toBe(
      'let bass = s("bd")\ncat(bass, s("sd"))',
    )
  })

  it('replaces an inline expression, which is what the gesture means', () => {
    // 62 of 123 corpus arms are expressions rather than names. The expression is
    // overwritten, not preserved — one undo step, and the chooser is what warns.
    const expr = 'let bass = s("bd")\narrange([2, stack(s("hh"), s("cp"))], [4, bass])'
    expect(applyEdits(expr, setArmPattern(expr, detectArrangeAt(expr, expr.indexOf('arrange'))!, 0, 'bass'))).toBe(
      'let bass = s("bd")\narrange([2, bass], [4, bass])',
    )
  })

  it('declines an arm that names nothing', () => {
    expect(setArmPattern(doc, call(), 9, 'bass')).toEqual([])
    expect(setArmPattern(doc, call(), -1, 'bass')).toEqual([])
  })

  it('declines a blank source rather than emptying the section', () => {
    // `[2, ]` is a syntax error, and the document would stop sounding entirely.
    expect(setArmPattern(doc, call(), 0, '')).toEqual([])
    expect(setArmPattern(doc, call(), 0, '   ')).toEqual([])
  })

  it('declines the part the section already plays', () => {
    expect(setArmPattern(doc, call(), 0, 'bass')).toEqual([])
  })

  it('re-parses with the SECOND section now playing the first one\'s pattern', () => {
    // ⚠ Asserting only "it still parses as an arrangement" would pass on an op
    // that wrote nothing at all — the unedited document parses too. The arm has
    // to read the section's CONTENT back out, which is the thing that moved.
    const out = applyEdits(doc, setArmPattern(doc, call(), 1, 'bass'))
    const after = detectArrangeAt(out, out.indexOf('arrange'))!
    expect(after.arms).toHaveLength(2)
    const text = (k: number) => out.slice(after.arms[k].patternRange[0], after.arms[k].patternRange[1])
    expect(text(0)).toBe('bass')
    expect(text(1)).toBe('bass')
    expect(asArrange(out.slice(out.indexOf('arrange'))).arms).toHaveLength(2)
  })
})

describe('listSectionParts — what a section may be pointed at (#1560)', () => {
  it('lists top-level bindings in source order', () => {
    const doc = 'let bass = s("bd")\nlet lead = s("hh")\narrange([2, bass])'
    expect(listArrangeSectionParts(doc, detectArrangeAt(doc, doc.indexOf('arrange'))!)).toEqual([
      'bass',
      'lead',
    ])
  })

  it('NEVER offers the binding the call is being written into', () => {
    // `let song = arrange([8, song])` parses, and recurses forever. Nothing
    // downstream can catch it, so it must be absent from the list.
    const doc = 'let bass = s("bd")\nlet song = arrange([2, bass], [4, bass])'
    const parts = listArrangeSectionParts(doc, detectArrangeAt(doc, doc.indexOf('arrange'))!)
    expect(parts).toEqual(['bass'])
    expect(parts).not.toContain('song')
  })

  it('drops a number — the corpus weight-multiplier idiom is not a part', () => {
    const doc = 'let M = 8\nlet bass = s("bd")\narrange([M*2, bass])'
    expect(listArrangeSectionParts(doc, detectArrangeAt(doc, doc.indexOf('arrange'))!)).toEqual([
      'bass',
    ])
  })

  it('drops a function — arranging a transform plays nothing', () => {
    const doc = 'let f = (p) => p.fast(2)\nlet bass = s("bd")\narrange([2, bass])'
    expect(listArrangeSectionParts(doc, detectArrangeAt(doc, doc.indexOf('arrange'))!)).toEqual([
      'bass',
    ])
  })

  it('KEEPS a string — it is a pattern in Strudel\'s own reading', () => {
    const doc = 'let riff = "bd sd"\nlet bass = s("bd")\narrange([2, bass])'
    expect(listArrangeSectionParts(doc, detectArrangeAt(doc, doc.indexOf('arrange'))!)).toEqual([
      'riff',
      'bass',
    ])
  })

  it('drops a part declared AFTER the call — it is in its dead zone there', () => {
    // ⚠ Also the mutual-recursion case the enclosing-declarator guard misses:
    // two arrangements pointed at each other, where the second is always the
    // later declaration.
    const doc = 'let bass = s("bd")\nlet song = arrange([2, bass])\nlet later = s("hh")'
    const parts = listArrangeSectionParts(doc, detectArrangeAt(doc, doc.indexOf('arrange'))!)
    expect(parts).toEqual(['bass'])
    expect(parts).not.toContain('later')
  })

  it('offers nothing when the document does not parse', () => {
    const good = 'let bass = s("bd")\narrange([2, bass])'
    const call = detectArrangeAt(good, good.indexOf('arrange'))!
    expect(listArrangeSectionParts('let bass = s("bd"', call)).toEqual([])
  })
})
