import { describe, it, expect } from 'vitest'
import { IR, type PatternIR } from '../PatternIR'
import { toStrudel } from '../toStrudel'
import { patternToJSON, patternFromJSON, PATTERN_IR_SCHEMA_VERSION } from '../serialize'
import { parseStrudel as _parseStrudel, __test_wrapAsOpaque } from '../parseStrudel'
import { unwrapD1 } from './helpers/unwrapD1'

// Phase 20-11 γ-4 — drill through the synthetic d1 Track wrapper. Tests
// that need the raw (Track-wrapped) shape import _parseStrudel directly.
const parseStrudel = (code: string): PatternIR => unwrapD1(_parseStrudel(code))

// ---------------------------------------------------------------------------
// Type construction — every node variant via smart constructors
// ---------------------------------------------------------------------------

describe('PatternIR smart constructors', () => {
  it('IR.pure() constructs Pure node', () => {
    expect(IR.pure()).toEqual({ tag: 'Pure' })
  })

  it('IR.play() constructs Play with defaults', () => {
    const node = IR.play('c4')
    expect(node.tag).toBe('Play')
    if (node.tag === 'Play') {
      expect(node.note).toBe('c4')
      expect(node.duration).toBe(0.25)
      expect(node.params.gain).toBe(1)
      expect(node.params.velocity).toBe(1)
    }
  })

  it('IR.play() accepts numeric note', () => {
    const node = IR.play(60, 0.5)
    expect(node.tag).toBe('Play')
    if (node.tag === 'Play') expect(node.note).toBe(60)
  })

  it('IR.play() merges params', () => {
    const node = IR.play('c4', 0.25, { s: 'piano', gain: 0.5 })
    if (node.tag === 'Play') {
      expect(node.params.s).toBe('piano')
      expect(node.params.gain).toBe(0.5)
    }
  })

  it('IR.sleep() constructs Sleep', () => {
    expect(IR.sleep(0.5)).toEqual({ tag: 'Sleep', duration: 0.5 })
  })

  it('IR.seq() constructs Seq', () => {
    const node = IR.seq(IR.play('c4'), IR.play('e4'))
    expect(node.tag).toBe('Seq')
    if (node.tag === 'Seq') expect(node.children.length).toBe(2)
  })

  it('IR.stack() constructs Stack', () => {
    const node = IR.stack(IR.play('c4'), IR.play('e4'))
    expect(node.tag).toBe('Stack')
    if (node.tag === 'Stack') expect(node.tracks.length).toBe(2)
  })

  it('IR.choice() constructs Choice', () => {
    const node = IR.choice(0.7, IR.play('c4'))
    expect(node.tag).toBe('Choice')
    if (node.tag === 'Choice') {
      expect(node.p).toBe(0.7)
      expect(node.else_.tag).toBe('Pure')
    }
  })

  it('IR.every() constructs Every', () => {
    const node = IR.every(4, IR.play('c4'))
    expect(node.tag).toBe('Every')
    if (node.tag === 'Every') {
      expect(node.n).toBe(4)
      expect(node.default_).toBeUndefined()
    }
  })

  it('IR.cycle() constructs Cycle', () => {
    const node = IR.cycle(IR.play('c4'), IR.play('e4'), IR.play('g4'))
    expect(node.tag).toBe('Cycle')
    if (node.tag === 'Cycle') expect(node.items.length).toBe(3)
  })

  it('IR.when() constructs When', () => {
    const node = IR.when('1 0 1 1', IR.play('bd', 0.25, { s: 'bd' }))
    expect(node.tag).toBe('When')
    if (node.tag === 'When') expect(node.gate).toBe('1 0 1 1')
  })


  it('IR.ramp() constructs Ramp', () => {
    const node = IR.ramp('gain', 0, 1, 4, IR.play('c4'))
    expect(node.tag).toBe('Ramp')
    if (node.tag === 'Ramp') {
      expect(node.param).toBe('gain')
      expect(node.from).toBe(0)
      expect(node.to).toBe(1)
      expect(node.cycles).toBe(4)
    }
  })

  it('IR.fast() constructs Fast', () => {
    expect(IR.fast(2, IR.play('c4'))).toEqual({ tag: 'Fast', factor: 2, body: IR.play('c4') })
  })

  it('IR.slow() constructs Slow', () => {
    expect(IR.slow(3, IR.play('c4'))).toEqual({ tag: 'Slow', factor: 3, body: IR.play('c4') })
  })

  it('IR.loop() constructs Loop', () => {
    const node = IR.loop(IR.play('c4'))
    expect(node.tag).toBe('Loop')
  })

  it('IR.code() constructs Code', () => {
    const node = IR.code('some complex expression')
    expect(node.tag).toBe('Code')
    if (node.tag === 'Code') {
      expect(node.code).toBe('some complex expression')
      expect(node.lang).toBe('strudel')
    }
  })

  it('nested trees compile', () => {
    const tree = IR.every(4, IR.fast(2, IR.play('bd', 0.25, { s: 'bd' })))
    expect(tree.tag).toBe('Every')
    if (tree.tag === 'Every') {
      expect(tree.body.tag).toBe('Fast')
      if (tree.body.tag === 'Fast') {
        expect(tree.body.body.tag).toBe('Play')
      }
    }
  })

  it('IR.stack(IR.play("c4"), IR.play("e4")) is valid', () => {
    const node = IR.stack(IR.play('c4'), IR.play('e4'))
    expect(node).toBeTruthy()
  })
})

// ---------------------------------------------------------------------------
// Phase 20-04 — wrapAsOpaque helper shape (PV37 / PK13 step 2 / D-01..D-03)
// ---------------------------------------------------------------------------

describe('20-04 — wrapAsOpaque helper shape', () => {
  // Wave α probes: the helper alone, no parser wiring yet.
  // (Wave β proves the parser routes through this helper; see parity.test.ts.)
  // Tests use the test-only re-export `__test_wrapAsOpaque`; helper is
  // module-private at runtime per PLAN §7 T-02.
  void parseStrudel  // silence unused-import lint; consumed by other test files

  it('wrapper has tag="Code" with via populated', () => {
    const inner = IR.play('c4')
    const wrapper = __test_wrapAsOpaque(inner, 'release', '0.3', [10, 25])
    expect(wrapper.tag).toBe('Code')
    if (wrapper.tag !== 'Code') return
    expect(wrapper.via).toBeDefined()
    expect(wrapper.via?.method).toBe('release')
    expect(wrapper.via?.args).toBe('0.3')
  })

  it('wrapper carries callSiteRange and inner verbatim', () => {
    const inner = IR.play('c4')
    const wrapper = __test_wrapAsOpaque(inner, 'release', '0.3', [10, 25])
    if (wrapper.tag !== 'Code') return
    expect(wrapper.via?.callSiteRange).toEqual([10, 25])
    expect(wrapper.via?.inner).toBe(inner)   // structural reference, not copy
    expect(wrapper.via?.inner.tag).toBe('Play')
  })

  it('wrapper itself is loc-complete (PV36 — loc[0] = callSiteRange)', () => {
    const wrapper = __test_wrapAsOpaque(IR.play('c4'), 'release', '0.3', [10, 25])
    if (wrapper.tag !== 'Code') return
    expect(wrapper.loc).toBeDefined()
    expect(wrapper.loc?.length).toBe(1)
    expect(wrapper.loc?.[0]).toEqual({ start: 10, end: 25 })
  })

  it('args are stored RAW (untrimmed) per D-02 byte-fidelity', () => {
    // Whitespace inside parens is part of the round-trip contract.
    const wrapper = __test_wrapAsOpaque(IR.play('c4'), 'release', ' 0.5 ', [10, 26])
    if (wrapper.tag !== 'Code') return
    expect(wrapper.via?.args).toBe(' 0.5 ')   // NOT trimmed
  })

  it('code field is "" on wrapper path (unused — toStrudel branches on via)', () => {
    const wrapper = __test_wrapAsOpaque(IR.play('c4'), 'release', '0.3', [10, 25])
    if (wrapper.tag !== 'Code') return
    expect(wrapper.code).toBe('')
  })
})


// ---------------------------------------------------------------------------
// toStrudel interpreter
// ---------------------------------------------------------------------------

describe('toStrudel', () => {
  it('Pure → empty string', () => {
    expect(toStrudel(IR.pure())).toBe('""')
  })

  it('Play with note → note("c4")', () => {
    expect(toStrudel(IR.play('c4'))).toBe('note("c4")')
  })

  it('Play with s param → s("bd")', () => {
    expect(toStrudel(IR.play('bd', 0.25, { s: 'bd' }))).toBe('s("bd")')
  })

  it('Seq of notes collapses to mini-notation', () => {
    const tree = IR.seq(IR.play('c4'), IR.play('e4'), IR.play('g4'))
    expect(toStrudel(tree)).toBe('note("c4 e4 g4")')
  })

  it('Seq with Sleep collapses to mini-notation with ~', () => {
    const tree = IR.seq(IR.play('c4'), IR.sleep(0.25), IR.play('e4'))
    expect(toStrudel(tree)).toBe('note("c4 ~ e4")')
  })

  it('Seq of samples collapses to s(...)', () => {
    const tree = IR.seq(
      IR.play('bd', 0.25, { s: 'bd' }),
      IR.play('sd', 0.25, { s: 'sd' }),
    )
    expect(toStrudel(tree)).toBe('s("bd sd")')
  })

  it('Stack of uniform simple plays collapses to a mini chord (#508)', () => {
    // A uniform-voice Stack of simple Plays IS a chord, so it round-trips to
    // `[a,b,c]` mini-notation — the idiomatic source form, consistent with how a
    // Seq collapses to `"a b"`. An EXPLICIT `stack(...)` call (userMethod:'stack')
    // is preserved as `stack(...)`; see the parseStrudel round-trip suite.
    const tree = IR.stack(IR.play('c4'), IR.play('e4'))
    expect(toStrudel(tree)).toBe('note("[c4,e4]")')
  })

  it('Explicit stack() call is preserved as stack(...) (P62 code-invariance)', () => {
    const tree = IR.stack(IR.play('c4'), IR.play('e4'))
    const explicit = { ...tree, userMethod: 'stack' as const }
    const result = toStrudel(explicit)
    expect(result).toContain('stack(')
    expect(result).toContain('note("c4")')
    expect(result).toContain('note("e4")')
  })

  it('Fast wraps with .fast(n)', () => {
    expect(toStrudel(IR.fast(2, IR.play('c4')))).toBe('note("c4").fast(2)')
  })

  it('Slow wraps with .slow(n)', () => {
    expect(toStrudel(IR.slow(3, IR.play('c4')))).toBe('note("c4").slow(3)')
  })

  it('Cycle → note("<c4 e4 g4>")', () => {
    const tree = IR.cycle(IR.play('c4'), IR.play('e4'), IR.play('g4'))
    expect(toStrudel(tree)).toBe('note("<c4 e4 g4>")')
  })

  it('Cycle of samples → s("<bd sd>")', () => {
    const tree = IR.cycle(
      IR.play('bd', 0.25, { s: 'bd' }),
      IR.play('sd', 0.25, { s: 'sd' }),
    )
    expect(toStrudel(tree)).toBe('s("<bd sd>")')
  })

  it('Loop passes through to body', () => {
    expect(toStrudel(IR.loop(IR.play('c4')))).toBe('note("c4")')
  })

  it('Code returns original code', () => {
    expect(toStrudel(IR.code('const x = 42'))).toBe('const x = 42')
  })

  it('Param generates method chain', () => {
    const tree = IR.param('room', 0.8, '0.8', IR.play('c4'))
    const result = toStrudel(tree)
    expect(result).toContain('note("c4")')
    expect(result).toContain('.room(0.8)')
  })

  // --- #434: non-collapsible Seq uses fastcat() (one cycle), not cat() ---
  // Seq is FASTCAT semantics — all children share ONE cycle. Emitting cat()
  // (slowcat, one cycle PER child) would stretch a 1-cycle sequence to N.
  it('non-collapsible Seq uses fastcat() not cat()', () => {
    const tree = IR.seq(IR.fast(2, IR.play('c4')), IR.play('e4'))
    const result = toStrudel(tree)
    expect(result).toBe('fastcat(note("c4").fast(2), note("e4"))')
  })

  // --- Choice with Pure else_ uses sometimesBy (per-cycle) ---
  // Phase 19-03 Task 02: the per-event `.degradeBy()` round-trip target
  // now belongs to the new `Degrade` tag (introduced in Task 06). Choice
  // is per-cycle, so `.sometimesBy(p, x => x)` is the semantically-
  // correct Strudel emit (RESEARCH §2.2 collision note).
  it('Choice with Pure else_ → sometimesBy', () => {
    expect(toStrudel(IR.choice(0.5, IR.play('c4')))).toBe('note("c4").sometimesBy(0.5, x => x)')
    expect(toStrudel(IR.choice(0.7, IR.play('c4')))).toBe('note("c4").sometimesBy(0.7, x => x)')
  })

  it('Choice with non-Pure else_ → stack with sometimesBy on both branches', () => {
    const result = toStrudel(IR.choice(0.5, IR.play('c4'), IR.play('g4')))
    expect(result).toContain('stack(')
    expect(result).toContain('note("c4").sometimesBy(0.5, x => x)')
    expect(result).toContain('note("g4").sometimesBy(0.5, x => x)')
  })

  // --- Fixed: Every uses extracted transform, not hardcoded fast(2) ---
  it('Every with Fast body → correct transform extracted', () => {
    const base = IR.play('c4')
    const tree = IR.every(4, IR.fast(2, base), base)
    expect(toStrudel(tree)).toBe('note("c4").every(4, fast(2))')
  })

  it('Every with Slow body → slow(n) extracted', () => {
    const base = IR.play('c4')
    const tree = IR.every(4, IR.slow(3, base), base)
    expect(toStrudel(tree)).toBe('note("c4").every(4, slow(3))')
  })

  it('Every with a Param body → 0-arg arrow fallback (#967, FX tag deleted)', () => {
    const base = IR.play('c4')
    const tree = IR.every(4, IR.param('room', 0.8, '0.8', base), base)
    // The FX-only `x => x.room(0.8)` form is gone; a Param body takes the
    // generic `() =>` fallback (hap-identical — see controlClassificationGuards).
    expect(toStrudel(tree)).toContain('.every(4, () => note("c4").room(0.8))')
  })

  it('Every without default_ uses generic fallback', () => {
    const tree = IR.every(4, IR.fast(2, IR.play('c4')))
    // no default_ stored → generic fallback
    const result = toStrudel(tree)
    expect(result).toContain('.every(4,')
  })
})

// ---------------------------------------------------------------------------
// Late tag — Tier 4 forced tag (Phase 19-03 Task 02)
// ---------------------------------------------------------------------------

describe('Late tag (Tier 4)', () => {
  it('IR.late() constructs Late node', () => {
    const tree = IR.late(0.125, IR.play('c4'))
    expect(tree.tag).toBe('Late')
    if (tree.tag === 'Late') {
      expect(tree.offset).toBe(0.125)
      expect(tree.body.tag).toBe('Play')
    }
  })

  it('toStrudel(Late) emits .late(offset) on the body', () => {
    expect(toStrudel(IR.late(0.125, IR.play('c4')))).toBe('note("c4").late(0.125)')
    expect(toStrudel(IR.late(0.5, IR.play('e4')))).toBe('note("e4").late(0.5)')
  })
})

// ---------------------------------------------------------------------------
// Degrade tag — Tier 4 forced tag (Phase 19-03 Task 06)
// ---------------------------------------------------------------------------

describe('Degrade tag (Tier 4)', () => {
  it('IR.degrade() constructs Degrade node with retention probability', () => {
    const tree = IR.degrade(0.5, IR.play('c4'))
    expect(tree.tag).toBe('Degrade')
    if (tree.tag === 'Degrade') {
      expect(tree.p).toBe(0.5)
      expect(tree.body.tag).toBe('Play')
    }
  })

  it('toStrudel(Degrade) emits .degrade() when p=0.5, else .degradeBy(1-p)', () => {
    expect(toStrudel(IR.degrade(0.5, IR.play('c4')))).toBe('note("c4").degrade()')
    // p=0.7 → drop=0.3
    expect(toStrudel(IR.degrade(0.7, IR.play('c4')))).toBe('note("c4").degradeBy(0.3)')
    // p=0.2 → drop=0.8
    expect(toStrudel(IR.degrade(0.2, IR.play('c4')))).toBe('note("c4").degradeBy(0.8)')
  })
})

// ---------------------------------------------------------------------------
// Chunk tag — Tier 4 forced tag (Phase 19-03 Task 08)
// ---------------------------------------------------------------------------

describe('Chunk tag (Tier 4)', () => {
  it('IR.chunk() constructs Chunk node', () => {
    const body = IR.seq(IR.play('a'), IR.play('b'), IR.play('c'), IR.play('d'))
    const transform = IR.fast(2, body)
    const tree = IR.chunk(4, transform, body)
    expect(tree.tag).toBe('Chunk')
    if (tree.tag === 'Chunk') {
      expect(tree.n).toBe(4)
      expect(tree.transform.tag).toBe('Fast')
      expect(tree.body.tag).toBe('Seq')
    }
  })

  it('toStrudel(Chunk) emits .chunk(n, transform)', () => {
    const body = IR.play('c4')
    const transform = IR.param('gain', 0.5, '0.5', body)
    const result = toStrudel(IR.chunk(4, transform, body))
    expect(result).toContain('.chunk(4,')
    expect(result).toContain('gain(0.5)')
  })
})

// ---------------------------------------------------------------------------
// JSON serialization
// ---------------------------------------------------------------------------

describe('patternToJSON / patternFromJSON', () => {
  it('round-trips Pure', () => {
    const tree = IR.pure()
    expect(patternFromJSON(patternToJSON(tree))).toEqual(tree)
  })

  it('round-trips Play', () => {
    const tree = IR.play('c4', 0.5, { s: 'piano', gain: 0.8 })
    expect(patternFromJSON(patternToJSON(tree))).toEqual(tree)
  })

  it('round-trips Sleep', () => {
    const tree = IR.sleep(0.25)
    expect(patternFromJSON(patternToJSON(tree))).toEqual(tree)
  })

  it('round-trips Seq', () => {
    const tree = IR.seq(IR.play('c4'), IR.sleep(0.25), IR.play('e4'))
    expect(patternFromJSON(patternToJSON(tree))).toEqual(tree)
  })

  it('round-trips Stack', () => {
    const tree = IR.stack(IR.play('c4'), IR.play('e4'))
    expect(patternFromJSON(patternToJSON(tree))).toEqual(tree)
  })

  it('round-trips Choice', () => {
    const tree = IR.choice(0.7, IR.play('c4'), IR.play('g4'))
    expect(patternFromJSON(patternToJSON(tree))).toEqual(tree)
  })

  it('round-trips Every', () => {
    const tree = IR.every(4, IR.play('c4'), IR.pure())
    expect(patternFromJSON(patternToJSON(tree))).toEqual(tree)
  })

  it('round-trips Every without default', () => {
    const tree = IR.every(4, IR.play('c4'))
    expect(patternFromJSON(patternToJSON(tree))).toEqual(tree)
  })

  it('round-trips Cycle', () => {
    const tree = IR.cycle(IR.play('c4'), IR.play('e4'), IR.play('g4'))
    expect(patternFromJSON(patternToJSON(tree))).toEqual(tree)
  })

  it('round-trips When', () => {
    const tree = IR.when('1 0 1 1', IR.play('c4'))
    expect(patternFromJSON(patternToJSON(tree))).toEqual(tree)
  })

  it('round-trips a single-body Param wrapper', () => {
    const tree = IR.param('room', 0.8, '0.8', IR.play('c4'))
    expect(patternFromJSON(patternToJSON(tree))).toEqual(tree)
  })

  it('round-trips Ramp', () => {
    const tree = IR.ramp('gain', 0, 1, 4, IR.play('c4'))
    expect(patternFromJSON(patternToJSON(tree))).toEqual(tree)
  })

  it('round-trips Fast', () => {
    const tree = IR.fast(2, IR.play('c4'))
    expect(patternFromJSON(patternToJSON(tree))).toEqual(tree)
  })

  it('round-trips Slow', () => {
    const tree = IR.slow(3, IR.play('c4'))
    expect(patternFromJSON(patternToJSON(tree))).toEqual(tree)
  })

  it('round-trips Loop', () => {
    const tree = IR.loop(IR.play('c4'))
    expect(patternFromJSON(patternToJSON(tree))).toEqual(tree)
  })

  it('round-trips Code', () => {
    const tree = IR.code('const x = 42')
    expect(patternFromJSON(patternToJSON(tree))).toEqual(tree)
  })

  it('round-trips Code-with-via wrapper preserves via fields (Phase 20-04 / PV37 clause 4 / T-11)', () => {
    // Trap 4 catcher: pre-T-11 serialize.ts stripped via silently. Now
    // the validator carries via through, including method/args/callSiteRange/inner.
    // Note: loc on inner Play is stripped by the existing serialize Play
    // arm (pre-20-04 behaviour, out of scope for this phase) — assertion
    // narrows to via fidelity + outer wrapper loc + inner tag.
    // #928 note: `.release` became a registry-classified control (Param); this
    // wrapper-fidelity probe needs a genuinely-unrecognised method, so
    // `.notreal` (same 7-char length → same callSiteRange) stands in.
    const tree = parseStrudel('note("c").notreal(0.3)')
    expect(tree.tag).toBe('Code')
    const round = patternFromJSON(patternToJSON(tree))
    expect(round.tag).toBe('Code')
    if (round.tag === 'Code') {
      expect(round.via?.method).toBe('notreal')
      expect(round.via?.args).toBe('0.3')
      expect(round.via?.callSiteRange).toEqual([9, 22])
      expect(round.via?.inner.tag).toBe('Play')
      // Outer wrapper loc round-trips
      expect(round.loc?.[0]).toEqual({ start: 9, end: 22 })
    }
  })

  it('round-trips double-wrap Code-with-via preserves nesting (D-06 / T-11)', () => {
    const tree = parseStrudel('note("c").foo(1).bar(2)')
    const round = patternFromJSON(patternToJSON(tree))
    expect(round.tag).toBe('Code')
    if (round.tag === 'Code' && round.via) {
      expect(round.via.method).toBe('bar')
      // Inner is the foo(1) wrapper.
      const inner = round.via.inner
      expect(inner.tag).toBe('Code')
      if (inner.tag === 'Code' && inner.via) {
        expect(inner.via.method).toBe('foo')
        expect(inner.via.inner.tag).toBe('Play')
      }
    }
  })

  it('round-trips Code-with-via through toStrudel byte-equal after JSON round-trip (T-11 + T-10)', () => {
    // The strict round-trip property: serialize → deserialize → toStrudel
    // produces the same source as toStrudel(parseStrudel(code)). via is
    // sufficient to reconstruct the source even if inner-Play.loc is
    // stripped by serialize (loc isn't read on the round-trip path).
    // #928: `.notreal` (unrecognised) keeps this a genuine Code-with-via path;
    // `.release` now classifies as a control (Param) and would no longer
    // exercise the wrapper this test is named for.
    const code = 'note("c").notreal(0.3)'
    const tree = parseStrudel(code)
    const round = patternFromJSON(patternToJSON(tree))
    expect(toStrudel(round)).toBe(code)
  })

  it('round-trips complex nested tree', () => {
    const tree = IR.stack(
      IR.seq(IR.play('bd', 0.25, { s: 'bd' }), IR.sleep(0.25),
             IR.play('bd', 0.25, { s: 'bd' }), IR.sleep(0.25)),
      IR.seq(IR.sleep(0.25), IR.play('sd', 0.25, { s: 'sd' }), IR.sleep(0.5)),
      IR.fast(2, IR.play('hh', 0.125, { s: 'hh' })),
    )
    expect(patternFromJSON(patternToJSON(tree))).toEqual(tree)
  })

  it('pretty mode produces indented JSON', () => {
    const result = patternToJSON(IR.play('c4'), true)
    expect(result).toContain('\n')
    expect(result).toContain('  ')
  })

  it('schema version is present', () => {
    const result = patternToJSON(IR.pure())
    const parsed = JSON.parse(result)
    expect(parsed.$schema).toBe(`patternir/${PATTERN_IR_SCHEMA_VERSION}`)
  })

  it('throws on invalid JSON', () => {
    expect(() => patternFromJSON('not json')).toThrow()
  })

  it('throws on missing tag', () => {
    const json = JSON.stringify({ $schema: 'patternir/1.0', tree: { note: 'c4' } })
    expect(() => patternFromJSON(json)).toThrow(/tag/)
  })

  it('throws on unknown tag', () => {
    const json = JSON.stringify({ $schema: 'patternir/1.0', tree: { tag: 'Unknown' } })
    expect(() => patternFromJSON(json)).toThrow(/tag/)
  })

  it('throws on Play without note', () => {
    const json = JSON.stringify({ $schema: 'patternir/1.0', tree: { tag: 'Play', duration: 0.25, params: {} } })
    expect(() => patternFromJSON(json)).toThrow(/note/)
  })

  it('throws on Play with wrong duration type', () => {
    const json = JSON.stringify({ $schema: 'patternir/1.0', tree: { tag: 'Play', note: 'c4', duration: 'long', params: {} } })
    expect(() => patternFromJSON(json)).toThrow(/duration/)
  })

  it('throws on Choice without p', () => {
    const json = JSON.stringify({ $schema: 'patternir/1.0', tree: { tag: 'Choice', then: { tag: 'Pure' }, else_: { tag: 'Pure' } } })
    expect(() => patternFromJSON(json)).toThrow(/p/)
  })

  it('error message includes field path for nested errors', () => {
    const json = JSON.stringify({
      $schema: 'patternir/1.0',
      tree: {
        tag: 'Stack',
        tracks: [
          { tag: 'Play', duration: 0.25, params: {} }, // missing note
        ],
      },
    })
    expect(() => patternFromJSON(json)).toThrow(/tracks\[0\]/)
  })
})

// ---------------------------------------------------------------------------
// Phase 20-10 — Param tag shape (α-2)
// ---------------------------------------------------------------------------

describe('20-10 — Param tag', () => {
  it('IR.param constructs a Param node with literal value', () => {
    const node = IR.param('s', 'sawtooth', '"sawtooth"', IR.play('c4'))
    expect(node.tag).toBe('Param')
    if (node.tag === 'Param') {
      expect(node.key).toBe('s')
      expect(node.value).toBe('sawtooth')
      expect(node.rawArgs).toBe('"sawtooth"')
      expect(node.body.tag).toBe('Play')
    }
  })

  it('IR.param accepts numeric value', () => {
    const node = IR.param('gain', 0.3, '0.3', IR.play('c4'))
    if (node.tag === 'Param') {
      expect(node.value).toBe(0.3)
      expect(node.key).toBe('gain')
    }
  })

  it('IR.param accepts PatternIR value (pattern-arg form)', () => {
    const inner = IR.play('bd')
    const node = IR.param('s', inner, '"bd"', IR.play('c4'))
    if (node.tag === 'Param') {
      expect(typeof node.value).toBe('object')
      if (typeof node.value === 'object') {
        expect((node.value as PatternIR).tag).toBe('Play')
      }
    }
  })

  it('IR.param attaches loc + userMethod via meta', () => {
    const body = IR.play('c4')
    const node = IR.param('s', 'bd', '"bd"', body, {
      loc: [{ start: 5, end: 14 }],
      userMethod: 's',
    })
    if (node.tag === 'Param') {
      expect(node.loc).toEqual([{ start: 5, end: 14 }])
      expect(node.userMethod).toBe('s')
    }
  })

  it('IR.param does not set userMethod when meta omitted', () => {
    const node = IR.param('s', 'bd', '"bd"', IR.play('c4'))
    if (node.tag === 'Param') {
      expect(node.userMethod).toBeUndefined()
      expect(node.loc).toBeUndefined()
    }
  })

  it('IR.param preserves rawArgs untrimmed', () => {
    const node = IR.param('s', 'bd', '  "bd"  ', IR.play('c4'))
    if (node.tag === 'Param') {
      expect(node.rawArgs).toBe('  "bd"  ')
    }
  })
})

describe('20-11 — Track tag', () => {
  it('IR.track constructs a Track node with trackId + body', () => {
    const node = IR.track('d1', IR.play('c4'))
    expect(node.tag).toBe('Track')
    if (node.tag !== 'Track') throw new Error('unreachable')
    expect(node.trackId).toBe('d1')
    expect(node.body.tag).toBe('Play')
    expect(node.loc).toBeUndefined()
    expect(node.userMethod).toBeUndefined()
  })

  it('IR.track attaches loc via meta', () => {
    const node = IR.track('d1', IR.play('c4'), { loc: [{ start: 0, end: 10 }] })
    expect(node.tag).toBe('Track')
    if (node.tag !== 'Track') throw new Error('unreachable')
    expect(node.loc).toEqual([{ start: 0, end: 10 }])
    expect(node.userMethod).toBeUndefined()
  })

  it('IR.track attaches userMethod via meta (for .p() form)', () => {
    const node = IR.track('lead', IR.play('c4'), {
      loc: [{ start: 5, end: 15 }],
      userMethod: 'p',
    })
    expect(node.tag).toBe('Track')
    if (node.tag !== 'Track') throw new Error('unreachable')
    expect(node.trackId).toBe('lead')
    expect(node.loc).toEqual([{ start: 5, end: 15 }])
    expect(node.userMethod).toBe('p')
  })

  it('IR.track does not set userMethod when meta omitted (synthetic d{N} form)', () => {
    const node = IR.track('d2', IR.play('c4'))
    expect(node.tag).toBe('Track')
    if (node.tag !== 'Track') throw new Error('unreachable')
    expect(node.userMethod).toBeUndefined()
    // Property should be absent, not just undefined-valued.
    expect(Object.prototype.hasOwnProperty.call(node, 'userMethod')).toBe(false)
  })

  it('serialize round-trip preserves trackId + loc + userMethod', () => {
    const node = IR.track('lead', IR.play('c4'), {
      loc: [{ start: 5, end: 15 }],
      userMethod: 'p',
    })
    const json = patternToJSON(node)
    const recovered = patternFromJSON(json)
    expect(recovered).toEqual(node)
  })

  it('serialize throws when trackId missing or non-string', () => {
    const bad = JSON.stringify({
      $schema: `patternir/${PATTERN_IR_SCHEMA_VERSION}`,
      tree: { tag: 'Track', body: { tag: 'Pure' } },   // trackId missing
    })
    expect(() => patternFromJSON(bad)).toThrow(/trackId/)
  })
})

describe('Track.muted survives the JSON round-trip (#1488)', () => {
  it('carries the flag through serialize -> deserialize', () => {
    // `patternToJSON` is a plain stringify, but `patternFromJSON` rebuilds a
    // Track field by field — so a new field is dropped on READ unless it is
    // explicitly carried. A document would then lose its muting on
    // save-and-reload, and the period rule would silently go back to folding
    // silent tracks into the song's length.
    const ir = IR.stack(
      IR.track('d1', IR.pure(), undefined, false),
      IR.track('d2', IR.pure(), undefined, true),
    )
    const back = patternFromJSON(patternToJSON(ir)) as Extract<PatternIR, { tag: 'Stack' }>
    const tracks = back.tracks as Extract<PatternIR, { tag: 'Track' }>[]
    expect(tracks[0].muted).toBeUndefined()
    expect(tracks[1].muted).toBe(true)
  })

  it('leaves an unmuted track byte-identical to before the field existed', () => {
    // The flag is spread in only when true, so nothing that was not muted
    // gains a key — old snapshots and pinned JSON stay valid.
    expect(JSON.parse(patternToJSON(IR.track('d1', IR.pure())))).toEqual(
      JSON.parse(patternToJSON(IR.track('d1', IR.pure(), undefined, false))),
    )
  })
})
