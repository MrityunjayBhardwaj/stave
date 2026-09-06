/**
 * namedPick.test.ts — #463 Stage 1.
 *
 * Object/named-key pick family (`sel.pickRestart({verse:…, chorus:…})`) lifts
 * into a structured `NamedPick` node instead of an opaque `Code`, so the Song
 * timeline collects the section CONTENT (the verse/chorus patterns) instead of
 * the control-string LABELS, while toStrudel still round-trips byte-identically.
 *
 * Every collect expectation was GROUNDED against real `@strudel/core` haps
 * (the mini()-wrapped form, queried per cycle) during the fix.
 */
import { describe, it, expect } from 'vitest'
import { parseStrudel, toStrudel } from '../../ir'
import type { PatternIR } from '../../ir'
import { IR } from '../PatternIR'
import {
  runRawStage,
  runMiniExpandedStage,
  runChainAppliedStage,
  runFinalStage,
} from '../parseStrudelStages'
import { runPasses, type Pass } from '../passes'

// The staged pipeline that builds the app's IR SNAPSHOT (feeds the Song
// timeline). Must agree with one-shot parseStrudel (P185 divergence guard).
const STAGES: readonly Pass<PatternIR>[] = [
  { name: 'RAW', run: runRawStage },
  { name: 'MINI-EXPANDED', run: runMiniExpandedStage },
  { name: 'CHAIN-APPLIED', run: runChainAppliedStage },
  { name: 'Parsed', run: runFinalStage },
]
function pipeline(code: string): PatternIR {
  const passes = runPasses(IR.code(code), STAGES)
  return passes[passes.length - 1].ir
}

function bodyOf(ir: PatternIR): PatternIR {
  return ir.tag === 'Track' ? (ir as Extract<PatternIR, { tag: 'Track' }>).body : ir
}

const SONG = `"<~@2 verse@2 chorus@2>".pickRestart({verse: s("bd sd"), chorus: s("hh hh")})`

describe('#463 Stage 1 — object-form pick family → NamedPick', () => {
  it('parses object-form pickRestart into a structured NamedPick (not opaque Code)', () => {
    const body = bodyOf(parseStrudel(SONG))
    expect(body.tag).toBe('NamedPick')
    if (body.tag !== 'NamedPick') return
    expect(body.method).toBe('pickRestart')
    expect(body.entries.map((e) => e.key)).toEqual(['verse', 'chorus'])
    expect(body.entries[0].pattern.tag).not.toBe('Code') // the section is parsed
  })

  it('each entry carries a keyLoc pointing at its key token in the source', () => {
    const body = bodyOf(parseStrudel(SONG))
    if (body.tag !== 'NamedPick') throw new Error('not NamedPick')
    for (const e of body.entries) {
      expect(SONG.slice(e.keyLoc!.start, e.keyLoc!.end)).toBe(e.key)
    }
  })

  it('toStrudel round-trips byte-identically to the opaque-Code precedent', () => {
    const ir = parseStrudel(SONG)
    // The receiver re-emits via the (lossy-but-stable) mini gen, the args
    // verbatim — exactly what the opaque Code node produced pre-Stage-1.
    expect(toStrudel(ir)).toBe(
      `note("<~ note("verse") note("chorus")>").pickRestart({verse: s("bd sd"), chorus: s("hh hh")})`,
    )
  })

  it('array-form pickRestart stays opaque (only object form is structured here)', () => {
    const body = bodyOf(parseStrudel(`s("0 1").pickRestart([s("bd"), s("hh")])`))
    expect(body.tag).toBe('Code')
  })

  it('the staged snapshot pipeline produces the SAME NamedPick as parseStrudel (P185 guard)', () => {
    // The app's Song timeline reads the staged-pipeline snapshot, not one-shot
    // parseStrudel — they must agree or the timeline diverges silently.
    expect(pipeline(SONG)).toEqual(parseStrudel(SONG))
    expect(bodyOf(pipeline(SONG)).tag).toBe('NamedPick')
  })
})

/**
 * #1456 — ES object shorthand `{verse}` is the same song as `{verse: verse}`.
 *
 * ─── THE SPECIFICATION IS AN EQUIVALENCE, NOT A LIST ────────────────────────────
 * The oracle below is the EXISTING spelling, not a hand-written expectation:
 *
 *     parse("{verse}")  ===  parse("{verse: verse}")     (modulo locs)
 *
 * That is deliberate. Writing out what shorthand "should" produce would re-decide
 * every question the `key: value` path already answered — bound vs unbound idents,
 * the sub-pattern grammar, which tag an unresolvable name gets — and would drift
 * from it the first time any of those changes. Pinning the two spellings TO EACH
 * OTHER inherits all of it for free and cannot drift: whatever `{verse: verse}`
 * grows into, `{verse}` grows into with it.
 *
 * ⚠ MODULO LOCS IS LOAD-BEARING, NOT A CONVENIENCE. In `{verse}` the key token and
 * the value token are the SAME range, so the value's `loc` genuinely differs from
 * the explicit form's — it points at the one identifier that is both. Stripping
 * locs is what lets the rest be compared exactly; the locs themselves are asserted
 * separately below, against the source text.
 *
 * ─── WHY IT MATTERS BEYOND THE PARSER ───────────────────────────────────────────
 * `NamedPick` is what `pickControl/` (#463) keys off for everything it does, and
 * what `songExtent` (#1427) reads to call a weighted section timeline a song. The
 * old bail returned null for the WHOLE object on one colon-less property, so a
 * single shorthand poisoned every entry and the document fell to an opaque `Code`
 * — silently, while Strudel went on playing it correctly. Naming sections as
 * consts is exactly what makes a timeline readable, so shorthand is the spelling
 * most likely to be reached for:
 *
 *     "<verse@8 chorus@8>".pickRestart({ verse, chorus })
 */
describe('#1456 — object shorthand parses as the key:value spelling does', () => {
  const HEAD = `const intro = s("bd ~ ~ ~")\nconst verse = s("bd*2 sd*2")\nconst outro = s("bd ~ ~ ~")\n`

  /** Recursively drop every `loc`/`keyLoc`, so two spellings of one song compare. */
  function stripLocs<T>(v: T): T {
    if (Array.isArray(v)) return v.map(stripLocs) as unknown as T
    if (v && typeof v === 'object') {
      const out: Record<string, unknown> = {}
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        if (k === 'loc' || k === 'keyLoc') continue
        out[k] = stripLocs(val)
      }
      return out as T
    }
    return v
  }

  function entriesOf(code: string) {
    const body = bodyOf(parseStrudel(code))
    if (body.tag !== 'NamedPick') throw new Error(`expected NamedPick, got ${body.tag} for: ${code}`)
    return body
  }

  // Each row is ONE song written twice. The shorthand arg is the subject; the
  // `key: value` arg is the control, and it is the control precisely because it
  // is already covered by the Stage 1 arms above.
  const PAIRS: ReadonlyArray<readonly [string, string, string]> = [
    ['all bound', `{ intro, verse, outro }`, `{ intro: intro, verse: verse, outro: outro }`],
    ['mixed with a literal', `{ verse, chorus: s("hh hh") }`, `{ verse: verse, chorus: s("hh hh") }`],
    ['mixed, shorthand last', `{ chorus: s("hh hh"), verse }`, `{ chorus: s("hh hh"), verse: verse }`],
    ['single entry', `{ verse }`, `{ verse: verse }`],
    ['no inner spaces', `{intro,verse}`, `{intro: intro,verse: verse}`],
    // An identifier bound to nothing is NOT a special case to decide here — it is
    // whatever the existing spelling makes of it (observed: an opaque `Code`), and
    // the equivalence is what keeps the two answers the same one.
    ['unbound identifiers', `{ nowhere, alsoNowhere }`, `{ nowhere: nowhere, alsoNowhere: alsoNowhere }`],
  ]

  for (const [label, shortArgs, explicitArgs] of PAIRS) {
    it(`${label}: the shorthand IR equals the key:value IR, modulo locs`, () => {
      const short = `${HEAD}"<intro@4 verse@8 outro@4>".pickRestart(${shortArgs})`
      const explicit = `${HEAD}"<intro@4 verse@8 outro@4>".pickRestart(${explicitArgs})`
      expect(stripLocs(entriesOf(short).entries)).toEqual(stripLocs(entriesOf(explicit).entries))
    })
  }

  it('the whole family is covered by the one reader — pick and pickReset too', () => {
    // The fix lives below the method switch, so this is a claim about the call
    // site, not three separate fixes. Asserted rather than assumed (#1456 asked).
    for (const method of ['pick', 'pickRestart', 'pickReset'] as const) {
      const body = bodyOf(parseStrudel(`${HEAD}"<intro@4 verse@8>".${method}({ intro, verse })`))
      expect(body.tag, `${method} did not lift to NamedPick`).toBe('NamedPick')
      if (body.tag !== 'NamedPick') return
      expect(body.method).toBe(method)
      expect(body.entries.map((e) => e.key)).toEqual(['intro', 'verse'])
    }
  })

  it("a shorthand entry's keyLoc spans the identifier in the SOURCE", () => {
    // The one thing the equivalence deliberately cannot check, since it strips
    // exactly this. Both key and value read from this single range.
    const src = `${HEAD}"<intro@4 verse@8 outro@4>".pickRestart({ intro, verse, outro })`
    const body = entriesOf(src)
    for (const e of body.entries) {
      expect(src.slice(e.keyLoc!.start, e.keyLoc!.end)).toBe(e.key)
    }
  })

  it('the section CONTENT is collected, not the label — the point of NamedPick', () => {
    // Guards against a shorthand entry that lifts to NamedPick but whose value
    // silently resolved to the bare name instead of the bound section.
    const src = `${HEAD}"<intro@4 verse@8 outro@4>".pickRestart({ intro, verse, outro })`
    const entries = entriesOf(src).entries
    expect(entries.map((e) => e.key)).toEqual(['intro', 'verse', 'outro'])
    for (const e of entries) {
      expect(e.pattern.tag, `${e.key} did not resolve to its bound section`).not.toBe('Code')
    }
  })

  it('toStrudel round-trips the shorthand VERBATIM (rawArgs is carried, not rebuilt)', () => {
    // `{ intro, verse, outro }` must come back out spelled the way it went in —
    // the same promise the key:value form makes. A serializer that "normalized"
    // it to `{intro: intro, …}` would rewrite the user's document on every edit.
    //
    // ⚠ THE `NamedPick` ASSERTION BELOW IS NOT DECORATION. An opaque `Code` also
    // re-emits its source verbatim, so the round-trip alone passes with the fix
    // REMOVED — it was green under the break-test. Pinning the tag beside it is
    // what makes this arm about the shorthand rather than about Code's fallback.
    const src = `"<intro@4 verse@8 outro@4>".pickRestart({ intro, verse, outro })`
    expect(bodyOf(parseStrudel(src)).tag).toBe('NamedPick')
    expect(toStrudel(parseStrudel(src))).toContain(`.pickRestart({ intro, verse, outro })`)
  })

  describe('the guard admits ONLY a bare identifier — everything else stays opaque', () => {
    // These are the reason the fix is a narrow admission and not a removal of the
    // bail. Each is colon-less too; none is an identifier.
    const NEGATIVES: ReadonlyArray<readonly [string, string]> = [
      ['spread', `{ ...rest }`],
      ['method shorthand', `{ verse() {} }`],
      ['a spread BESIDE a good shorthand', `{ verse, ...rest }`],
      ['bare string', `{ "verse" }`],
    ]
    for (const [label, args] of NEGATIVES) {
      it(`${label} → opaque Code`, () => {
        const body = bodyOf(parseStrudel(`${HEAD}"<verse@8>".pickRestart(${args})`))
        expect(body.tag).toBe('Code')
      })
    }

    it('a computed key is UNCHANGED by this fix (it has a colon; out of scope)', () => {
      // Pinned as a control, not endorsed: `{[k]: x}` already lifted to NamedPick
      // with a junk key before #1456 and still does. Named here so a later reader
      // sees it was observed and left alone rather than missed.
      const body = bodyOf(parseStrudel(`"<a@4>".pickRestart({ [k]: s("bd") })`))
      expect(body.tag).toBe('NamedPick')
    })
  })

  it('the staged snapshot pipeline agrees for shorthand too (P185 guard)', () => {
    // The Song timeline reads the staged snapshot, not one-shot parseStrudel.
    const src = `${HEAD}"<intro@4 verse@8 outro@4>".pickRestart({ intro, verse, outro })`
    expect(pipeline(src)).toEqual(parseStrudel(src))
    expect(bodyOf(pipeline(src)).tag).toBe('NamedPick')
  })
})
