/**
 * #1522 — A NESTED `arrange()` MUST READ AN IDENTIFIER WEIGHT, AT EVERY DEPTH.
 *
 * #1521 taught the document's numeric bindings to reach an `arrange()` at the
 * ROOT of a track, so `arrange([M*8, …])` sizes its arm instead of declining.
 * The map stopped there. Every call that recurses deeper — a `stack(…)`
 * argument, a `cat`/`slowcat`/`fastcat` arm, the pattern half of an `arrange`
 * ARM, and a binding's own right-hand side — threaded the PATTERN binding map
 * and not the numeric one, so one level down the weight went unread again:
 *
 *     let M = 2                                        → Arrange, arms=2   ✅
 *     $: arrange([M, s("bd")], [M, s("hh")])
 *
 *     let M = 2                                        → the arrange is GONE ❌
 *     $: stack(arrange([M, s("bd")], [M, s("hh")]), s("cp"))
 *
 * The failure is quieter than it sounds and that is worth stating precisely,
 * because the issue guessed otherwise: the document does NOT fall opaque. The
 * surrounding `stack` still parses, its `s("cp")` sibling still plays, and the
 * nested `arrange` alone degrades to an opaque `Builder` carrying its own
 * source text. So the timeline draws the other tracks and silently draws no
 * clips for the arranged one — a missing region, not a broken document.
 *
 * ⚠ WHAT THE MAP IS FOR, AND THEREFORE THE WHOLE BLAST RADIUS. `numbers` has
 * exactly ONE consumer in the parser — `evalWeightExpression`, resolving an
 * `arrange` ARM'S WEIGHT. Everywhere else it is pure transport. So threading
 * it into more call sites can change exactly one thing: an arm weight that
 * used to be unresolvable now resolves. That is why widening here is safe to
 * do across the whole family at once, and it is a fact about the code rather
 * than a hope — a reader can check it with one search for `numbers`.
 *
 * ⚠ THE CONTROLS ARE THE POINT OF THIS FILE, NOT THE HAPPY PATH. A weight is a
 * POSITION: an unreadable one cannot be defaulted to 1 the way an unreadable
 * item can be dropped, because a wrong position silently rewrites the song.
 * So `arrange([f(), …])` and `arrange([o.x, …])` must still DECLINE — at every
 * depth, before and after this change. Widening a resolver is exactly the
 * move that turns a refusal into a guess, so the refusals are asserted first.
 *
 * ⚠ BOTH PARSERS, EVERY ARM. `parseStrudelStages` delegates to this file's
 * `parseRoot`, so the fix reaches both by construction — which is precisely
 * why it must be ASSERTED rather than assumed: a shared implementation makes
 * a differential green for free. Shape first, agreement second.
 *
 * ⚠ NOT COVERED HERE, DELIBERATELY (#1547): the METHOD-chain half —
 * `s("cp").cat(arrange([M, …]))` — still declines. `applyChain` takes no
 * numeric map on either side, and a chain argument can be a LAMBDA whose
 * parameter shadows the document's `M`, so resolving there needs a scoping
 * answer this change does not have. The last arm below PINS that boundary, so
 * it fails loudly if the chain half is widened without one.
 */

import { describe, it, expect } from 'vitest'
import { parseStrudel } from '../parseStrudel'
import type { PatternIR } from '../PatternIR'
import { pipeline, stripStageMeta } from './helpers/stagesParity'

/** Both parsers, asserted to agree, and the agreed value returned. */
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
    for (const [k, v] of Object.entries(rec)) {
      if (k === 'loc' || k === 'tag') continue
      visit(v)
    }
  }
  visit(n)
  return counts
}

/** Every `Arrange` node's arm weights, outermost first. */
function weights(n: PatternIR): number[][] {
  const out: number[][] = []
  const visit = (node: unknown): void => {
    if (node === null || typeof node !== 'object') return
    if (Array.isArray(node)) return void node.forEach(visit)
    const rec = node as Record<string, unknown>
    if (rec.tag === 'Arrange') {
      out.push((rec.arms as Array<{ weight: number }>).map(a => a.weight))
    }
    for (const [k, v] of Object.entries(rec)) {
      if (k === 'loc' || k === 'tag') continue
      visit(v)
    }
  }
  visit(n)
  return out
}

const ARMS = '[M, s("bd")], [M, s("hh")]'

describe('#1522 — a nested arrange() reads an identifier weight', () => {
  // ── The refusals first. A widened resolver that starts GUESSING a weight is
  // a worse outcome than the bug this file fixes, so these lead.
  describe('a weight that cannot be known is still DECLINED, at every depth', () => {
    it.each([
      ['a call, at the root', `$: arrange([f(), s("bd")], [2, s("hh")])`],
      ['a call, nested in stack', `$: stack(arrange([f(), s("bd")], [2, s("hh")]), s("cp"))`],
      ['a member expression, nested', `let o = 1\n$: stack(arrange([o.x, s("bd")], [2, s("hh")]), s("cp"))`],
      ['an UNBOUND identifier, nested', `$: stack(arrange([Q, s("bd")], [2, s("hh")]), s("cp"))`],
      // A name bound to something that is not a number is not a weight either.
      ['a PATTERN-bound name, nested', `let P = s("x")\n$: stack(arrange([P, s("bd")], [2, s("hh")]), s("cp"))`],
    ])('%s', (_label, code) => {
      const ir = bothParsers(code)
      // The arrange declines to an opaque Builder — it does NOT become an
      // Arrange whose first arm silently weighs 1.
      expect(census(ir).Builder).toBe(1)
      expect(weights(ir).flat()).not.toContain(1)
    })
  })

  describe('an identifier weight resolves wherever the arrange sits', () => {
    // The third column is the INNER arrange's arm weights, spelled out per row
    // rather than inferred — `M*2` weighs 4, and a shared "both arms match M"
    // assertion would have quietly passed on a resolver that dropped the `*2`.
    it.each([
      ['a stack argument', `let M = 2\n$: stack(arrange(${ARMS}), s("cp"))`, [2, 2]],
      ['a stack argument, arithmetic', `let M = 2\n$: stack(arrange([M*2, s("bd")], [M*2, s("hh")]), s("cp"))`, [4, 4]],
      ['a stack inside a stack', `let M = 2\n$: stack(stack(arrange(${ARMS}), s("x")), s("cp"))`, [2, 2]],
      ['a cat arm', `let M = 2\n$: cat(arrange(${ARMS}), s("cp"))`, [2, 2]],
      ['a slowcat arm', `let M = 2\n$: slowcat(arrange(${ARMS}), s("cp"))`, [2, 2]],
      ['a fastcat arm', `let M = 2\n$: fastcat(arrange(${ARMS}), s("cp"))`, [2, 2]],
      ["another arrange's arm", `let M = 2\n$: arrange([M, arrange(${ARMS})], [M, s("cp")])`, [2, 2]],
      ['a receiver under a chain', `let M = 2\n$: stack(arrange(${ARMS}).fast(2), s("cp"))`, [2, 2]],
      ['a bare document, no $: label', `let M = 2\nstack(arrange(${ARMS}), s("cp"))`, [2, 2]],
      ["a binding's own right-hand side", `let M = 2\nlet p = arrange(${ARMS})\n$: stack(p, s("cp"))`, [2, 2]],
      // ⚠ THE SAME DOCUMENT WITHOUT ITS `$:` LABEL IS A DIFFERENT CODE PATH IN
      // THE STAGED PARSER, and it is the one this change first got wrong. A
      // labelled document resolves its bindings through the RAW stage's
      // document map; a bare one resolves them through its own
      // `buildBindingMap` call, which is a SECOND copy of the monolithic call
      // and had to learn the argument separately. The labelled arm above was
      // green while this one diverged — so the pair is the test, not either one.
      ["a binding's RHS, no $: label", `let M = 2\nlet p = arrange(${ARMS})\nstack(p, s("cp"))`, [2, 2]],
    ])('%s', (_label, code, expected) => {
      const ir = bothParsers(code)
      // ⚠ ASSERTED BEFORE THE COUNT. "An Arrange exists" is satisfied by the
      // OUTER cat/arrange in three of these arms while the inner one is still
      // opaque, which is exactly how the defect hid: `cat(arrange([M,…]), …)`
      // reported one Arrange throughout. No Builder is the real property.
      expect(census(ir).Builder ?? 0).toBe(0)
      // The weight the user wrote, read as the number they wrote it as.
      expect(weights(ir)).toContainEqual(expected)
      // The arms' patterns parsed too — an Arrange of two opaque arms would
      // satisfy everything above.
      expect(census(ir).Play).toBeGreaterThanOrEqual(3)
    })
  })

  it('reads an arithmetic weight as the product, not as the identifier', () => {
    const ir = bothParsers(`let M = 2\n$: stack(arrange([M*8, s("bd")], [M*4, s("hh")]), s("cp"))`)
    expect(weights(ir)).toEqual([[16, 8]])
  })

  it('a literal weight is untouched by any of this', () => {
    const ir = bothParsers(`$: stack(arrange([2, s("bd")], [2, s("hh")]), s("cp"))`)
    expect(weights(ir)).toEqual([[2, 2]])
    expect(census(ir).Builder ?? 0).toBe(0)
  })

  // ── The boundary pin. Not an endorsement of the gap — a tripwire on it.
  it('PINS #1547: the METHOD-chain half still declines, and must not be widened silently', () => {
    const ir = bothParsers(`let M = 2\n$: s("cp").cat(arrange(${ARMS}))`)
    // `applyChain` carries no numeric map on either side. When #1547 answers
    // the lambda-shadowing question and threads one, THIS ARM FAILS — that is
    // the intent. Update it there, with the scoping decision written down.
    expect(census(ir).Builder).toBe(1)
  })
})
