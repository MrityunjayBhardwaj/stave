/**
 * #1523 — a bare document with a binding AND several trailing expressions.
 *
 *     let M = 2                          → Arrange, arms=2       ✅
 *     arrange([2, s("bd")], [2, s("hh")])
 *
 *     let M = 2                          → NOTHING. Wholly opaque. ❌
 *     s("cp")
 *     arrange([2, s("bd")], [2, s("hh")])
 *
 * One extra top-level expression, same binding, same LITERAL weights, and the
 * whole document reached the IR as a single give-up `Code` node: no rows, no
 * marks, no gestures and nothing said. `buildBindingMap` wants `bindings*` then
 * exactly ONE expression; #1096's per-statement split wants NO bindings. The two
 * covered disjoint sets and this ordinary shape fell between them.
 *
 * ⚠ THE WEIGHT SPELLING IS NOT THE CAUSE, and this was found while chasing a
 * defect where it was. Swapping `[M, …]` for `[2, …]` changes nothing, which is
 * exactly what rules it out — so both spellings are arms below.
 *
 * ⚠ BOTH PARSERS HAD THE DEFECT AND BOTH HAD TO LEARN THE FIX, so every arm
 * asserts the staged pipeline as well. A differential proves agreement, never
 * correctness — the shape is asserted first, and agreement second.
 */

import { describe, it, expect } from 'vitest'
import { parseStrudel } from '../parseStrudel'
import type { PatternIR } from '../PatternIR'
import { pipeline, stripStageMeta } from './helpers/stagesParity'

const ARRANGE = 'arrange([2, s("bd")], [2, s("hh")])'

function census(n: PatternIR): Record<string, number> {
  const counts: Record<string, number> = {}
  const visit = (node: unknown): void => {
    if (node === null || typeof node !== 'object') return
    if (Array.isArray(node)) return void node.forEach(visit)
    const rec = node as Record<string, unknown>
    if (typeof rec.tag === 'string') counts[rec.tag] = (counts[rec.tag] ?? 0) + 1
    for (const [k, v] of Object.entries(rec)) {
      if (k === 'loc' || k === 'tag') continue
      visit(v)
    }
  }
  visit(n)
  return counts
}

/** Both parsers, asserted to agree, and the agreed value returned. */
function bothParsers(code: string): PatternIR {
  const mono = stripStageMeta(parseStrudel(code))
  const staged = stripStageMeta(pipeline(code))
  expect(JSON.stringify(staged)).toBe(JSON.stringify(mono))
  return mono
}

const tracksOf = (ir: PatternIR) =>
  ir.tag === 'Stack' ? ir.tracks : ir.tag === 'Track' ? [ir] : []

describe('#1523 — a bare document with a binding and several trailing expressions', () => {
  it('declares a track per trailing expression and keeps the arrangement', () => {
    const code = `let M = 2\ns("cp")\n${ARRANGE}`
    const ir = bothParsers(code)
    expect(ir.tag).toBe('Stack')
    expect(tracksOf(ir)).toHaveLength(2)
    // ⚠ ASSERTED BEFORE THE COUNT, because "two tracks" is satisfied by two
    // opaque ones. The arrangement surviving is the property that was lost.
    expect(census(ir).Arrange).toBe(1)
    expect(census(ir).Code ?? 0).toBe(0)
    // Each track slices back to its OWN statement — the `let` line is not a row.
    const [t1, t2] = tracksOf(ir)
    expect(code.slice(t1.loc![0].start, t1.loc![0].end)).toBe('s("cp")')
    expect(code.slice(t2.loc![0].start, t2.loc![0].end)).toBe(ARRANGE)
  })

  it('resolves the binding inside the tail — an IDENTIFIER weight reads', () => {
    // The numeric map has to travel to every statement of the tail, not just to
    // a single final expression. `M` as a global length multiplier is how the
    // longest real arrangement in the corpus is written.
    const code = 'let M = 2\ns("cp")\narrange([M, s("bd")], [M, s("hh")])'
    const ir = bothParsers(code)
    expect(census(ir).Arrange).toBe(1)
    expect(census(ir).Code ?? 0).toBe(0)
    // …and the weight really resolved to 2 rather than defaulting to 1.
    const arrange = tracksOf(ir)
      .map((t) => (t.tag === 'Track' ? t.body : t))
      .find((b) => b.tag === 'Arrange')
    expect(arrange?.tag === 'Arrange' && arrange.arms.map((a) => a.weight)).toEqual([2, 2])
  })

  it('resolves a PATTERN binding inside the tail too', () => {
    const code = 'let riff = s("bd*4")\nriff.fast(2)\ns("hh*8")'
    const ir = bothParsers(code)
    expect(tracksOf(ir)).toHaveLength(2)
    // `riff` was substituted, not left opaque: Fast(2, Fast(4, Play(bd))).
    const b = tracksOf(ir)[0]
    const body = b.tag === 'Track' ? b.body : b
    expect(body.tag).toBe('Fast')
    expect(body.tag === 'Fast' && body.body.tag).toBe('Fast')
    expect(census(ir).Code ?? 0).toBe(0)
  })

  // ── Controls: every one of these passes with the change reverted ───────────
  it('CONTROL — one trailing expression is unchanged, no Stack', () => {
    // The `buildBindingMap` path. If this moved, the fix would have taken over
    // a population that was already working rather than the one that was not.
    const ir = bothParsers(`let M = 2\n${ARRANGE}`)
    expect(ir.tag).toBe('Track')
    expect(census(ir).Arrange).toBe(1)
  })

  it('CONTROL — no binding at all is still #1096 exactly', () => {
    const ir = bothParsers(`s("cp")\n${ARRANGE}`)
    expect(ir.tag).toBe('Stack')
    expect(tracksOf(ir)).toHaveLength(2)
  })

  it('CONTROL — a `$:` document is untouched by any of this', () => {
    const ir = bothParsers(`let M = 2\n$: s("cp")\n$: ${ARRANGE}`)
    expect(ir.tag).toBe('Stack')
    expect(tracksOf(ir)).toHaveLength(2)
  })

  it('CONTROL — bindings the ENGINE declines keep the whole-document shape', () => {
    // The narrowness did not disappear, it moved. A document whose bindings do
    // not resolve is still left whole rather than split against a map that does
    // not exist — no second, weaker binding map is invented here.
    const dup = 'let a = s("bd*4")\nlet a = s("sd*4")\na.fast(2)\ns("hh*8")'
    expect(bothParsers(dup).tag).toBe('Track')
    // …and a document whose FIRST statement is an expression has no leading
    // binding run for the engine to read, so it is left whole too.
    const late = 's("cp")\nlet a = s("bd*4")\na.fast(2)'
    expect(bothParsers(late).tag).toBe('Track')
  })

  // ⚠ NOT A CONTROL, and it was labelled as one until the break test said
  // otherwise: it flips with the change reverted, so it is a claim about the new
  // branch's semantics. The four arms above it really do stay green.
  it('a statement the parser cannot read takes a silent row, not a veto', () => {
    // Deliberately #1096's rule, not a new one: an unreadable statement becomes
    // an opaque track rather than being dropped, so the row count still matches
    // what the user wrote. Keeping only the statements that parse would give
    // this file two answers to one question, and the staged pipeline splits
    // before anything is parsed, so it could not mirror the filter anyway.
    const code = 'let M = 2\nfunction helper(x) { return x }\n' + ARRANGE
    const ir = bothParsers(code)
    expect(tracksOf(ir)).toHaveLength(2)
    expect(census(ir).Arrange).toBe(1)
    expect(census(ir).Code).toBe(1) // the `function` declaration, drawn silent
  })
})

/**
 * #1534 — a binding declared AFTER the first expression took a row of its own.
 *
 *     let a = s("bd*4")
 *     a.fast(2)
 *     let b = 2          ← a silent row named after itself, nothing to click
 *     s("hh*8")
 *
 * The tail is "everything from the first non-binding statement onward", so a
 * later `let` lands in it and became a track. It declares no sound and cannot.
 *
 * ⚠ NOT A REVERSAL OF #1523's SHOW-DON'T-DROP RULE — see the arm above it.
 * That rule is about an EXPRESSION the parser failed to read, which still earns
 * a row so the count matches what the user wrote. A declaration is not an
 * expression, and no parser improvement would ever give it a sound. Dropping it
 * is not hiding a failure; keeping it was miscounting the parts.
 *
 * ⚠ AND IT COULD NOT BE A PLAIN DELETION. The split branch is taken when the
 * tail has ≥ 2 statements, so filtering first can drop a document BELOW the
 * fence, into the whole-body parse — wholly opaque for a multi-statement body.
 * A naive filter trades one meaningless row for a document with nothing in it.
 */
describe('#1534 — a declaration in the tail is not a part', () => {
  it('a trailing binding does not take a row, and the binding still resolves', () => {
    const code = 'let a = s("bd*4")\na.fast(2)\nlet b = 2\ns("hh*8")'
    const ir = bothParsers(code)
    expect(ir.tag).toBe('Stack')
    const ts = tracksOf(ir)
    expect(ts).toHaveLength(2)
    expect(ts.map((t) => code.slice(t.loc![0].start, t.loc![0].end))).toEqual([
      'a.fast(2)',
      's("hh*8")',
    ])
    // Dropped as a ROW, never as a MEANING: `a` is still substituted in the row
    // that uses it — Fast(2, Fast(4, Play(bd))).
    const body = ts[0].tag === 'Track' ? ts[0].body : ts[0]
    expect(body.tag).toBe('Fast')
    expect(body.tag === 'Fast' && body.body.tag).toBe('Fast')
    expect(census(ir).Code ?? 0).toBe(0)
  })

  // ⚠ THE ARM THE WHOLE SHAPE OF THIS FIX EXISTS FOR. Written before the
  // filter was: this is the document a deletion breaks, and it breaks it in the
  // direction that looks like nothing happened.
  it('one surviving expression gives one PLAYING row, not an opaque document', () => {
    const ir = bothParsers('let a = 1\ns("bd*4")\nlet b = 2')
    expect(ir.tag).toBe('Track')
    // Asserted before the tag, in spirit: an opaque body here IS the
    // regression, and `Track` alone is satisfied by one.
    expect(census(ir).Code ?? 0).toBe(0)
    expect(census(ir).Play).toBe(1)
  })

  it('…stated as the identity it really is: the declaration changes NOTHING', () => {
    // The surviving expression sits at the same offset and resolves through the
    // same map, so the two documents differ only in text the IR should never
    // have represented. Byte-identical, both parsers.
    const withDecl = 'let a = 1\ns("bd*4")\nlet b = 2'
    const without = 'let a = 1\ns("bd*4")'
    expect(JSON.stringify(bothParsers(withDecl))).toBe(JSON.stringify(bothParsers(without)))
  })

  it('CONTROL — a tail that was ALREADY one statement keeps its whole-document shape', () => {
    // Fenced on "the filter actually moved something", so the shape that
    // reaches here by the P67 fall-through — `buildBindingMap` succeeded and
    // its expression still parsed opaque — is not widened into a Track per
    // statement. Passes with the change reverted.
    const code = 'let a = 1\n?!nonsense?!'
    const ir = bothParsers(code)
    expect(ir.tag).toBe('Track')
    const body = ir.tag === 'Track' ? ir.body : ir
    expect(body.tag === 'Code' && body.code).toBe(code)
  })

  it('CONTROL — a document of plain expressions is untouched by the filter', () => {
    // Passes with the change reverted.
    const ir = bothParsers('s("bd*4")\ns("hh*8")')
    expect(tracksOf(ir)).toHaveLength(2)
  })

  // ⚠ THE FILTER REACHES THE NO-BINDING LIST TOO, and this arm exists because
  // that was written down as "provably a no-op" while it was true only of the
  // narrower predicate. A destructuring `const` declares nothing the engine can
  // resolve, so this document has NO binding map — and the filter still drops
  // its row, which drops the split below its own fence. Fenced on the map's
  // existence, the single-survivor arm did not fire and the document came back
  // wholly opaque: the regression re-entered by the other door.
  it('one surviving expression with NO binding map still plays', () => {
    const ir = bothParsers('const {m} = createParams("x")\ns("bd*4")')
    expect(ir.tag).toBe('Track')
    expect(census(ir).Code ?? 0).toBe(0)
    expect(census(ir).Play).toBe(1)
  })

  // ⚠ THE ROW QUESTION IS NOT THE RESOLUTION QUESTION, and writing the filter
  // with `BINDING_RE` — the predicate the substitution engine uses — left this
  // exact line drawing a silent row in the ONE archive document the change was
  // measured on. `BINDING_RE` wants a plain identifier because its answer feeds
  // a map; "can this ever be a part?" wants no such thing.
  it('a DESTRUCTURING declaration does not take a row either', () => {
    const code = 'let a = 1\ns("bd*4")\nconst {movement} = createParams("movement")\ns("hh*8")'
    const ir = bothParsers(code)
    const ts = tracksOf(ir)
    expect(ts).toHaveLength(2)
    expect(ts.map((t) => code.slice(t.loc![0].start, t.loc![0].end))).toEqual([
      's("bd*4")',
      's("hh*8")',
    ])
  })

  it('CONTROL — an identifier that merely STARTS with a keyword is not a declaration', () => {
    // `letters` / `constant` / `variation` must not be eaten by the keyword
    // test. ⚠ THIS ARM CANNOT DISCRIMINATE THE TWO SPELLINGS OF THE PREDICATE:
    // there is no word boundary inside a longer identifier, so whitespace and
    // `\\b` both refuse it. Kept as the liveness check it actually is; the arm
    // below is the one that chose between them.
    const code = 'let letters = s("bd*4")\nletters.fast(2)\ns("hh*8")'
    const ir = bothParsers(code)
    expect(tracksOf(ir)).toHaveLength(2)
    expect(census(ir).Code ?? 0).toBe(0)
  })

  // ⚠ THE ARM THAT CHOSE THE PREDICATE. A declaration written without a space
  // after the keyword is still a declaration, and the whitespace spelling the
  // first draft shipped misses it — while the control written to justify that
  // spelling passed under both, which is what a vacuous arm looks like.
  it('a declaration written without a space is still not a part', () => {
    const code = 'let a = 1\ns("bd*4")\nconst{m}=createParams("x")\ns("hh*8")'
    const ir = bothParsers(code)
    const ts = tracksOf(ir)
    expect(ts).toHaveLength(2)
    expect(ts.map((t) => code.slice(t.loc![0].start, t.loc![0].end))).toEqual([
      's("bd*4")',
      's("hh*8")',
    ])
  })

  it('a tail that is ALL declarations reaches the whole-document shape', () => {
    // No fence fires: nothing in the tail can sound, so there is no row to
    // draw, and the document keeps the single opaque shape it has always had.
    // Pinned so the outcome is a decision rather than an accident.
    const code = 'let a = 1\nconst {m} = x\nconst {n} = y'
    expect(bothParsers(code).tag).toBe('Track')
  })

  // ⚠ KNOWN NEIGHBOUR, DELIBERATELY NOT COVERED, and it is asserted rather than
  // described so the asymmetry cannot drift unnoticed. A `function` declaration
  // is equally not a part, and still takes a silent row (the arm above pins
  // that as #1096's rule). The filter reads ONE predicate — the same
  // `BINDING_RE` the substitution engine uses to find its bindings — rather
  // than growing a second, hand-rolled notion of "declaration" in a file whose
  // recorded failure mode is exactly that.
  it('a `function` declaration still takes a silent row — one predicate, not two', () => {
    const code = 'let a = 1\nfunction helper(x) { return x }\ns("bd*4")'
    const ir = bothParsers(code)
    expect(tracksOf(ir)).toHaveLength(2)
    expect(census(ir).Code).toBe(1)
  })
})
