/**
 * #1553 — A METHOD CHAIN OVER A COMMA PATTERN IS NOT A MULTI-TRACK STACK.
 *
 * Two different things arrive at CHAIN-APPLIED wearing the tag `Stack`:
 *
 *     $: note("a").gain(.5)     several statements  → chains on the CHILDREN
 *     $: note("b").gain(.8)
 *
 *     $: note("a, b").gain(.8)  ONE statement whose  → chain on the STACK
 *                               mini-notation has a
 *                               top-level comma
 *
 * `parseRootWithChainMeta` stashes the chain by spreading it onto whatever
 * `parseRoot` returned, so the second shape parks it on the comma-expanded
 * `Stack`. The stage modelled only the first: it mapped `applyOnTrack` over
 * the CHILDREN, none of which carries a chain, every call took its
 * `unresolvedChain === undefined` early return, and the chain was discarded
 * with nothing recording that it had existed.
 *
 * ⚠ NOTHING THROWS AND NOTHING IS MARKED OPAQUE. `.sound()`, `.gain()`,
 * `.room()`, `.lpf()` simply cease to exist and the document still parses into
 * a plausible tree — which is how this sat inside a green gate. Measured on
 * the 558-document archive it cost 6 documents every method in their chain;
 * one kept 7 of its 66 notes, and one kept every note and lost the instrument
 * they play on. The staged pipeline is the snapshot/timeline path, so that is
 * what the song is drawn and bounced from.
 *
 * ⚠ THE CHAIN HAS TO BE A REAL ONE, and this is the half that is easy to get
 * wrong. `splitRootAndChain` returns everything after the root, so a document
 * ending in a trailing comment stashes a "chain" whose whole content is
 * `// @version 1.1`. Three archive documents are exactly that shape, and they
 * are three of the deliberate comma-arm lane splits this guard must NOT touch
 * — testing for the field's mere PRESENCE collapsed all three from N lanes to
 * one. Both halves are pinned below, because the fix is only correct as a
 * pair.
 */

import { describe, it, expect } from 'vitest'
import { parseStrudel } from '../parseStrudel'
import type { PatternIR } from '../PatternIR'
import { pipeline, stripStageMeta } from './helpers/stagesParity'
import { rootStackArms } from '../structuralWalk'

/** The staged pipeline's FINAL IR, with stage-transition metadata stripped. */
function staged(code: string): PatternIR {
  return stripStageMeta(pipeline(code))
}

function mono(code: string): PatternIR {
  return stripStageMeta(parseStrudel(code))
}

/** Every method surviving in the tree: `Param` keys and `Code.via` methods. */
function methods(n: unknown): string[] {
  const out: string[] = []
  const visit = (x: unknown): void => {
    if (x === null || typeof x !== 'object') return
    if (Array.isArray(x)) return void x.forEach(visit)
    const r = x as Record<string, unknown>
    if (r.tag === 'Param' && typeof r.key === 'string') out.push(String(r.userMethod ?? r.key))
    const via = r.via as Record<string, unknown> | undefined
    if (r.tag === 'Code' && via && typeof via.method === 'string') out.push(String(via.method))
    for (const [k, v] of Object.entries(r)) {
      if (k === 'loc') continue
      visit(v)
    }
  }
  visit(n)
  return out.sort()
}

/**
 * The LANE count the timeline draws — arms of a root comma stack when there
 * are any, otherwise the `Track` wrappers.
 *
 * ⚠ NOT A COUNT OF `Track` NODES (#1553). A comma arm stopped being a `Track`
 * when the parser stopped fabricating one per arm; counting wrappers would now
 * report 1 for every comma document and quietly assert the opposite of what
 * these arms mean. This mirrors `timelineMarks.declaredTrackAnchors`, which is
 * the consumer whose answer actually reaches the screen.
 */
function laneCount(ir: PatternIR): number {
  const arms = rootStackArms(ir)
  if (arms) return arms.length
  let c = 0
  const visit = (x: unknown): void => {
    if (x === null || typeof x !== 'object') return
    if (Array.isArray(x)) return void x.forEach(visit)
    const r = x as Record<string, unknown>
    if (r.tag === 'Track') c++
    for (const [k, v] of Object.entries(r)) {
      if (k === 'loc') continue
      visit(v)
    }
  }
  visit(ir)
  return c
}

describe('#1553 — a chain over a comma pattern survives the staged pipeline', () => {
  describe('the chain is applied, not dropped', () => {
    const CHAINED: [string, string, string[]][] = [
      ['one method', '$: note("a, b").gain(.8)', ['gain']],
      ['two methods', '$: note("a, b").sound("piano").gain(.8)', ['gain', 'sound']],
      ['chain on the next line', '$: note("a, b")\n  .gain(.8)', ['gain']],
      ['s() rather than note()', '$: s("bd, cp").gain(.8)', ['gain']],
      ['no `$:` label at all', 'note("a, b").gain(.8)', ['gain']],
      ['three comma arms', '$: s("bd, cp, hh").room(1)', ['room']],
      // The chain walker's tolerance is not the thing under test here, but a
      // chain that SPANS comment lines is the shape that surfaced all of this,
      // so it earns an arm.
      ['chain across blank and comment lines', '$: note("a, b")\n\n  // parked\n\n.gain(.8)', ['gain']],
    ]

    for (const [name, code, expected] of CHAINED) {
      it(`keeps every method :: ${name}`, () => {
        expect(methods(staged(code))).toEqual(expected)
      })

      it(`matches parseStrudel byte-for-byte :: ${name}`, () => {
        expect(JSON.stringify(staged(code))).toBe(JSON.stringify(mono(code)))
      })
    }

    // The regression in one line: before the fix this was `[]`.
    it('a dropped chain would leave NO methods at all — the whole chain went, not part of it', () => {
      expect(methods(staged('$: note("a, b").sound("piano").cpm(30).gain(.8).room(1)'))).toEqual([
        'cpm', 'gain', 'room', 'sound',
      ])
    })
  })

  describe('the deliberate comma-arm lane split is untouched', () => {
    // No chain to lose → the arms keep their own lanes, and the staged shape
    // deliberately does NOT match `parseStrudel`. These are the documents
    // `stagesParityCorpus` pins as the intended floor.
    const SPLIT: [string, string, number][] = [
      ['two arms, no chain', '$: note("a, b")', 2],
      ['three arms, no chain', '$: s("bd, cp, hh")', 3],
      ['bare document, no chain', 's("bd, cp")', 2],
      // ⚠ THE ARM THAT CAUGHT THE OVER-REACH. A trailing comment is not a
      // chain; testing for the stash field's presence alone collapsed this
      // from 2 lanes to 1.
      ['trailing comment is not a chain', 's("bd, cp")\n// @version 1.1', 2],
      ['trailing block comment is not a chain', 's("bd, cp")\n/* notes */', 2],
    ]

    for (const [name, code, lanes] of SPLIT) {
      it(`keeps one lane per arm :: ${name}`, () => {
        expect(laneCount(staged(code))).toBe(lanes)
      })
    }

    it('and a comment-only chain still loses nothing, because there was nothing in it', () => {
      expect(methods(staged('s("bd, cp")\n// @version 1.1'))).toEqual([])
    })
  })

  describe('genuinely multi-track documents are unaffected', () => {
    // Their chains live on the CHILDREN, so the outer `Stack` never carries
    // one and the guard never fires. The two populations are disjoint: over
    // the 558-document archive, 142 `Stack`s carry an outer chain and NONE of
    // them also carries a per-track chain.
    const MULTI: [string, string, number, string[]][] = [
      ['two labelled tracks, each chained', '$: note("a").gain(.5)\n$: note("b").gain(.8)', 2, ['gain', 'gain']],
      ['three labelled tracks', '$: note("a")\n$: note("b")\n$: note("c")', 3, []],
      ['one track has a comma stack', '$: note("a, b").gain(.5)\n$: note("c")', 2, ['gain']],
      // `s(` here is the track's ROOT, not a chain method, so `gain` is the
      // only method in the tree — the point of the arm is that the OTHER
      // track's chain is not disturbed by its neighbour's comma stack.
      ['named labels', 'drums: s("bd, cp").gain(.5)\nbass: note("c")', 2, ['gain']],
    ]

    for (const [name, code, lanes, ms] of MULTI) {
      it(`keeps its tracks and its chains :: ${name}`, () => {
        expect(laneCount(staged(code))).toBe(lanes)
        expect(methods(staged(code))).toEqual(ms)
      })
    }
  })

  describe('a pattern with no comma is unchanged either way', () => {
    for (const code of ['$: note("a").gain(.8)', '$: s("bd").room(1).gain(.5)']) {
      it(`matches parseStrudel :: ${code}`, () => {
        expect(JSON.stringify(staged(code))).toBe(JSON.stringify(mono(code)))
      })
    }
  })
})
