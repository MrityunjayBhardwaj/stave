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
