/**
 * #1547 / #1550 — THE DOCUMENT'S MAPS REACH A CHAIN ARGUMENT, AND STOP AT A BINDER.
 *
 * #1522 threaded the document's numeric bindings through `parseRoot`'s own
 * recursion, so a nested `arrange()` reads an identifier weight. It stopped at
 * `applyChain`, and deliberately: the chain is the one place the parser can
 * meet a LOCAL scope, and widening a resolver into a scope it does not model
 * turns an honest refusal into a wrong answer.
 *
 * This file records the answer to that, which is one rule covering both halves:
 *
 *     a chain ARGUMENT is evaluated in the document's scope — resolve it
 *     an arrow's PARAMETER binds inside its body — the document must not answer for it
 *
 * ⚠ THE RULE IS OLDER THAN THE NUMERIC MAP, AND THE PATTERN MAP HAD IT WRONG
 * (#1550). `applyChain` has always carried the pattern bindings and never
 * recorded that an arrow parameter binds locally, so with `let p = s("bd")` in
 * the document, `.every(2, p => p.cat(p))` resolved the arrow's OWN parameter
 * to `s("bd")` and cat'd the body with the wrong pattern — silently, and
 * byte-identically to the unshadowed `y => y.cat(p)`. Fixing the scope for the
 * numeric map without fixing it for the pattern map would have meant shipping
 * two different answers to one question, so both maps are shadowed by the same
 * helper at the same call.
 *
 * ⚠ WHAT DOES **NOT** REACH THIS, and the controls that prove it:
 *   · an arrow whose body is a FRESH EXPRESSION (`M => arrange([M, …])`) never
 *     consults any map — `parseTransform` returns null and the caller opaques
 *     the whole call site. It was the example in #1547 and it turned out to be
 *     the one shape that was never at risk.
 *   · `.arp(…)` / `.chop(…)` do not structurally parse their argument at all;
 *     they wrap opaque. Their arrange stays opaque with a LITERAL weight too,
 *     which is the control that says this is not about the map.
 *
 * ⚠ BOTH PARSERS, EVERY ARM — and here that is not free. The staged pipeline
 * applies the chain in a LATER stage from a stash, so the numeric map needed
 * its own `unresolvedNumbers` channel to arrive at the same call. A one-sided
 * fix fails on PARITY, not on shape.
 */

import { describe, it, expect } from 'vitest'
import { parseStrudel } from '../parseStrudel'
import type { PatternIR } from '../PatternIR'
import { pipeline, stripStageMeta } from './helpers/stagesParity'

function bothParsers(code: string): PatternIR {
  const mono = stripStageMeta(parseStrudel(code))
  const staged = stripStageMeta(pipeline(code))
  expect(JSON.stringify(staged)).toBe(JSON.stringify(mono))
  return mono
}

function census(n: PatternIR): Record<string, number> {
  const counts: Record<string, number> = {}
  const visit = (node: unknown): void => {
    if (node === null || typeof node !== 'object') return
    if (Array.isArray(node)) return void node.forEach(visit)
    const rec = node as Record<string, unknown>
    if (typeof rec.tag === 'string') counts[rec.tag] = (counts[rec.tag] ?? 0) + 1
    for (const [k, v] of Object.entries(rec)) { if (k === 'loc' || k === 'tag') continue; visit(v) }
  }
  visit(n)
  return counts
}

function weights(n: PatternIR): number[][] {
  const out: number[][] = []
  const visit = (node: unknown): void => {
    if (node === null || typeof node !== 'object') return
    if (Array.isArray(node)) return void node.forEach(visit)
    const rec = node as Record<string, unknown>
    if (rec.tag === 'Arrange') out.push((rec.arms as Array<{ weight: number }>).map(a => a.weight))
    for (const [k, v] of Object.entries(rec)) { if (k === 'loc' || k === 'tag') continue; visit(v) }
  }
  visit(n)
  return out
}

const ARMS = '[M, s("bd")], [M, s("hh")]'

describe('#1547 — a chain argument resolves against the document', () => {
  it.each([
    ['a .cat arm', `let M = 2\n$: s("cp").cat(arrange(${ARMS}))`],
    ['a .slowcat arm', `let M = 2\n$: s("cp").slowcat(arrange(${ARMS}))`],
    ['a .fastcat arm', `let M = 2\n$: s("cp").fastcat(arrange(${ARMS}))`],
    ['a .slice index', `let M = 2\n$: s("cp").slice(4, arrange(${ARMS}))`],
    ['inside an accepted arrow', `let M = 2\n$: s("bd").every(2, x => x.cat(arrange(${ARMS})))`],
  ])('%s', (_label, code) => {
    const ir = bothParsers(code)
    expect(census(ir).Builder ?? 0).toBe(0)
    expect(weights(ir)).toContainEqual([2, 2])
  })

  it('reads arithmetic as the product, inside a chain argument', () => {
    const ir = bothParsers(`let M = 2\n$: s("cp").cat(arrange([M*8, s("bd")], [M*4, s("hh")]))`)
    expect(weights(ir)).toContainEqual([16, 8])
  })
})

describe('#1550 — an arrow parameter shadows a document binding of the same name', () => {
  // ⚠ THE PAIR IS THE TEST. Each arm below differs from its sibling ONLY in
  // whether the arrow's parameter happens to be spelled like the document's
  // binding. If shadowing were dropped, the second of each pair would silently
  // adopt the first's answer — which is exactly the defect, and exactly what a
  // single-arm test cannot see.
  it('the NUMERIC map: an unshadowed name resolves', () => {
    const ir = bothParsers(`let M = 2\n$: s("bd").every(2, x => x.cat(arrange(${ARMS})))`)
    expect(weights(ir)).toContainEqual([2, 2])
    expect(census(ir).Builder ?? 0).toBe(0)
  })

  it('the NUMERIC map: a name the arrow binds does NOT resolve — it declines', () => {
    const ir = bothParsers(`let M = 2\n$: s("bd").every(2, M => M.cat(arrange(${ARMS})))`)
    // Declines, exactly as an unknowable weight must. It does NOT quietly
    // become 2 because a `let M = 2` happens to sit at the top of the file.
    expect(census(ir).Builder).toBe(1)
    expect(weights(ir).flat()).not.toContain(2)
  })

  it('the PATTERN map: an unshadowed name resolves', () => {
    const ir = bothParsers(`let p = s("bd")\n$: s("x").every(2, y => y.cat(p))`)
    expect(census(ir).Code ?? 0).toBe(0)
    expect(census(ir).Play).toBe(3)
  })

  it('the PATTERN map: a name the arrow binds does NOT resolve', () => {
    const shadowed = bothParsers(`let p = s("bd")\n$: s("x").every(2, p => p.cat(p))`)
    // The control that gives this its meaning: the SAME document with no
    // top-level `p` at all. The arrow's `p` must read the same either way —
    // if the document's binding still reached it, these would differ.
    const noDocBinding = bothParsers(`$: s("x").every(2, p => p.cat(p))`)
    // ⚠ loc-INSENSITIVE. The two documents differ in length by the `let` line,
    // so every offset shifts; comparing raw IR compares the prefix, not the
    // question. The SHAPE is what has to match.
    const noLoc = (n: PatternIR) =>
      JSON.stringify(n.tag === 'Track' ? n.body : n, (k, v) => (k === 'loc' ? undefined : v))
    expect(noLoc(shadowed)).toBe(noLoc(noDocBinding))
  })

  it('shadowing a name the document never bound changes nothing', () => {
    // The allocation-free path: `shadowParam` returns the same map when the
    // name is absent, so the overwhelmingly common arrow is byte-identical.
    const ir = bothParsers(`let M = 2\n$: s("bd").every(2, zz => zz.cat(arrange(${ARMS})))`)
    expect(weights(ir)).toContainEqual([2, 2])
  })
})

describe('#1547 — what a chain argument still refuses', () => {
  it.each([
    ['a call', `$: s("cp").cat(arrange([f(), s("bd")], [2, s("hh")]))`],
    ['a member expression', `let o = 1\n$: s("cp").cat(arrange([o.x, s("bd")], [2, s("hh")]))`],
    ['an unbound identifier', `$: s("cp").cat(arrange([Q, s("bd")], [2, s("hh")]))`],
  ])('%s is DECLINED, never defaulted to 1', (_label, code) => {
    const ir = bothParsers(code)
    // The arrange is still opaque — it did NOT become an Arrange whose first
    // arm quietly weighs 1.
    expect(census(ir).Builder).toBe(1)
    // ⚠ EXACTLY ONE Arrange, and it is the `.cat` itself. Asserting "no weight
    // equals 1" here would be a claim about the CONTAINER: a `.cat` method arm
    // weighs 1 by construction, so that arm fails on correct code. The count is
    // the honest form of the question — a resolved inner arrange would make it 2.
    expect(census(ir).Arrange).toBe(1)
  })

  it('an arrow whose body is a fresh expression consults no map at all', () => {
    // #1547 named this as THE lambda hazard. It turned out to be the one shape
    // that was never at risk: `parseTransform` cannot express it as a chain on
    // the body, returns null, and the caller opaques the whole call site.
    const ir = bothParsers(`let M = 2\n$: s("bd").every(2, M => arrange([M, s("x")], [M, s("y")]))`)
    expect(census(ir).Arrange ?? 0).toBe(0)
    expect(census(ir).Every ?? 0).toBe(0)
  })

  it('.arp / .chop do not parse their argument, with a LITERAL weight either', () => {
    // The control proving these are untouched by the map rather than failing
    // because of it: the literal-weight form is opaque too.
    const ident = bothParsers(`let M = 2\n$: s("cp").arp(arrange(${ARMS}))`)
    const literal = bothParsers(`$: s("cp").arp(arrange([2, s("bd")], [2, s("hh")]))`)
    expect(census(ident).Arrange ?? 0).toBe(0)
    expect(census(literal).Arrange ?? 0).toBe(0)
  })
})
