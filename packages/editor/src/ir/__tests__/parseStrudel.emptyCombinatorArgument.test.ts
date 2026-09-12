/**
 * #1548 — AN ARGUMENT THAT IS ONLY A COMMENT IS NOT AN ARGUMENT.
 *
 * Commenting one arm out while leaving its comma is the most ordinary edit a
 * musician makes to an arrangement. It produced an argument whose text is a
 * comment and whose value, after the comment is consumed, is the empty string
 * — and each combinator then made its own different mistake with that phantom:
 *
 *     arrange(…, [8, s("hh")],      →  the arm has no `[`, the arm parse
 *       // [4, s("x")]                 returns null, and ONE unreadable arm
 *     )                                declines the WHOLE arrangement
 *
 *     stack(…, s("hh"),            →  '' parses to `Pure`, the silent
 *       // s("x")                      pattern, and the stack silently GROWS
 *     )                                a member the user never wrote
 *
 * ⚠ AND THE BLOCK-COMMENT HALF IS THE SEVERE ONE, because it is the only one
 * that ADDS SOUND. The splitter's comment skip knew line comments and not
 * block ones, so a block-commented argument kept its raw text — and the
 * `[4, s("x")]` inside it still looked like a tuple to the arm parser:
 *
 *     arrange([8, s("bd")], [8, s("hh")], <block-commented arm>)  →  THREE arms
 *
 * A commented-out arm was PLAYED, and the song was sized around it. Losing
 * music is loud; inventing it is not, which is why this arm leads the file.
 *
 * ⚠ THE TRIGGER IS THE PAIR, NOT EITHER HALF. A trailing comma alone is fine;
 * a comment alone is fine; a comment BETWEEN two arms is fine (it folds into
 * the next argument's leading region and is consumed there). It takes a comma
 * with nothing but a comment after it to produce an argument with no
 * expression in it. All of those are arms below, because without them the
 * failing case does not mean anything.
 *
 * THE FIX IS IN ONE PLACE, not three: the splitter drops an argument that is
 * empty once whitespace and comments are consumed, before any combinator gets
 * to decide what it is. The guard already existed for a whitespace-only
 * argument (`stack(a, , b)`); it ran on the raw text, so a comment-only one
 * walked past it.
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

/** Arm count of every Arrange, and track count of every Stack/Seq. */
function memberCounts(n: PatternIR): number[] {
  const out: number[] = []
  const visit = (node: unknown): void => {
    if (node === null || typeof node !== 'object') return
    if (Array.isArray(node)) return void node.forEach(visit)
    const rec = node as Record<string, unknown>
    if (rec.tag === 'Arrange') out.push((rec.arms as unknown[]).length)
    if (rec.tag === 'Stack') out.push((rec.tracks as unknown[]).length)
    if (rec.tag === 'Seq') out.push((rec.children as unknown[]).length)
    for (const [k, v] of Object.entries(rec)) { if (k === 'loc' || k === 'tag') continue; visit(v) }
  }
  visit(n)
  return out
}

describe('#1548 — a commented-out arm is neither played nor counted', () => {
  // ── The severe one first: the only shape that ADDED sound.
  it('a BLOCK-commented arm is not played', () => {
    const ir = bothParsers(`$: arrange(\n  [8, s("bd")],\n  [8, s("hh")],\n  /* [4, s("x")] */\n)`)
    expect(memberCounts(ir)).toEqual([2])
    // The commented-out arm played `s("x")`. Nothing in the tree may.
    expect(JSON.stringify(ir)).not.toContain('"x"')
  })

  it('a BLOCK-commented stack argument is not a track made of comment text', () => {
    const ir = bothParsers(`$: stack(\n  s("bd"),\n  s("hh"),\n  /* s("x") */\n)`)
    expect(memberCounts(ir)).toEqual([2])
    expect(census(ir).Code ?? 0).toBe(0)
  })

  describe('a line-commented argument is dropped, whichever combinator holds it', () => {
    it.each([
      ['arrange — used to decline the WHOLE arrangement', `$: arrange(\n  [8, s("bd")],\n  [8, s("hh")],\n  // [4, s("x")]\n)`, 2],
      ['stack — used to grow a silent track', `$: stack(\n  s("bd"),\n  s("hh"),\n  // s("x")\n)`, 2],
      ['cat — used to grow a silent arm', `$: cat(\n  s("bd"),\n  s("hh"),\n  // s("x")\n)`, 2],
      ['slowcat — used to grow a silent arm', `$: slowcat(\n  s("bd"),\n  s("hh"),\n  // s("x")\n)`, 2],
      ['fastcat — used to grow a silent child', `$: fastcat(\n  s("bd"),\n  s("hh"),\n  // s("x")\n)`, 2],
    ])('%s', (_label, code, expected) => {
      const ir = bothParsers(code)
      expect(memberCounts(ir)).toEqual([expected])
      // No phantom: neither the silent `Pure` the permissive combinators grew,
      // nor the opaque `Builder` the strict one fell back to.
      expect(census(ir).Pure ?? 0).toBe(0)
      expect(census(ir).Builder ?? 0).toBe(0)
    })
  })

  // ── The controls. Each isolates ONE half of the trigger, and without them
  // the arms above would also pass on a splitter that dropped real arguments.
  describe('the trigger is the PAIR — neither half alone does anything', () => {
    it.each([
      ['a trailing comma alone', `$: arrange(\n  [8, s("bd")],\n  [8, s("hh")],\n)`],
      ['a line comment with NO trailing comma', `$: arrange(\n  [8, s("bd")],\n  [8, s("hh")]\n  // [4, s("x")]\n)`],
      ['a block comment with NO trailing comma', `$: arrange(\n  [8, s("bd")],\n  [8, s("hh")]\n  /* [4, s("x")] */\n)`],
      ['a comment BETWEEN two live arms', `$: arrange(\n  [8, s("bd")],\n  // [4, s("x")],\n  [8, s("hh")]\n)`],
      ['no comment at all', `$: arrange(\n  [8, s("bd")],\n  [8, s("hh")]\n)`],
    ])('%s — still two arms', (_label, code) => {
      const ir = bothParsers(code)
      expect(memberCounts(ir)).toEqual([2])
      expect(census(ir).Builder ?? 0).toBe(0)
    })

    it('a doubled comma was ALREADY handled, and still is', () => {
      // `stack(a, , b)` — the whitespace-only guard has always dropped this.
      // It is here so a future edit to that guard cannot silently lose it.
      const ir = bothParsers(`$: stack(\n  s("bd"),\n  ,\n  s("hh")\n)`)
      expect(memberCounts(ir)).toEqual([2])
    })
  })

  // ── What must NOT be dropped. The fix removes arguments; these prove it
  // removes only the empty ones.
  describe('a real argument is never dropped', () => {
    it('a comment followed by a REAL argument keeps the argument', () => {
      const ir = bothParsers(`$: stack(\n  s("bd"),\n  // a note about the next one\n  s("hh")\n)`)
      expect(memberCounts(ir)).toEqual([2])
    })

    it('a block comment followed by a REAL argument keeps the argument', () => {
      const ir = bothParsers(`$: stack(\n  s("bd"),\n  /* about the next one */ s("hh")\n)`)
      expect(memberCounts(ir)).toEqual([2])
    })

    it('an UNTERMINATED block comment consumes the rest, as a real parser would', () => {
      // Everything after the opener is comment — in valid JS this document is
      // a syntax error, and consuming to end of input is the same answer the
      // `//` branch gives at EOF. Asserted so the choice is recorded rather
      // than discovered later.
      const ir = bothParsers(`$: stack(\n  s("bd"),\n  s("hh") /* never closed\n)`)
      expect(census(ir).Play ?? 0).toBeGreaterThanOrEqual(1)
    })
  })
})
