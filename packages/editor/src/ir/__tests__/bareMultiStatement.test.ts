/**
 * The bare branch declares a Track per top-level statement (#1096).
 *
 * ⚠ THIS FILE EXISTS BECAUSE TWO BREAK TESTS PASSED. After #1096 landed, deleting
 * the per-statement `loc` and deleting the transport-head filter EACH left the
 * whole editor suite green at 3250/3250. Both lines are load-bearing — one is how
 * a hap reaches the row that produced it, the other is why `setcps(0.5)` does not
 * become a track — and both were pinned only by a snapshot in the app package,
 * which the editor gate never runs. A snapshot in another package is not coverage
 * of this module; it is a downstream tripwire that reports the same fact much
 * later and without naming it.
 */
import { describe, it, expect } from 'vitest'
import { parseStrudel } from '../parseStrudel'
import type { PatternIR } from '../PatternIR'

const tracksOf = (ir: PatternIR) =>
  ir.tag === 'Stack' ? ir.tracks : ir.tag === 'Track' ? [ir] : []

describe('#1096 — a bare document declares every statement it names', () => {
  it('two bare statements become two Tracks, numbered in source order', () => {
    const ir = parseStrudel('s("bd*4")\ns("hh*8")')
    expect(ir.tag).toBe('Stack')
    expect(tracksOf(ir).map((t) => (t.tag === 'Track' ? t.trackId : t.tag))).toEqual(['d1', 'd2'])
  })

  it("each Track's loc slices back to its OWN statement — the anchor a hap joins by", () => {
    // The break this arm exists for: with the loc dropped, every hap falls
    // through to the positional mapping and lands on d1 regardless of which
    // statement produced it, which is the mis-anchored row #1096 is about.
    const code = 's("bd*4")\ns("hh*8")'
    const [t1, t2] = tracksOf(parseStrudel(code))
    // Asserted by SLICING the source, never against a literal offset — an offset
    // that drifts with the statement text would still pass a literal.
    expect(code.slice(t1.loc![0].start, t1.loc![0].end)).toBe('s("bd*4")')
    expect(code.slice(t2.loc![0].start, t2.loc![0].end)).toBe('s("hh*8")')
  })

  it('a transport head takes no Track — it is not something you can hear', () => {
    // ⚠ THE HEAD MUST BE MID-DOCUMENT, and finding that out is why this arm reads
    // oddly. The obvious fixture — `setcps(0.5)` on the first line — passes with
    // the statement filter DELETED, because a LEADING transport call is removed
    // by the prelude strip long before the splitter sees it. It would have been
    // an arm that always passes, testing a mechanism it does not name.
    //
    // `hush()` discriminates: it is a non-track head that the prelude strip
    // deliberately does not recognise (a prelude is boot calls, and `hush` stops
    // playback), so reaching it at all requires the filter under test.
    const code = 's("bd*4")\nhush()\ns("hh*8")'
    const tracks = tracksOf(parseStrudel(code))
    expect(tracks).toHaveLength(2)
    for (const t of tracks) {
      expect(code.slice(t.loc![0].start, t.loc![0].end)).not.toContain('hush')
    }
    // The two that survive are the music, in order.
    expect(code.slice(tracks[0].loc![0].start, tracks[0].loc![0].end)).toBe('s("bd*4")')
    expect(code.slice(tracks[1].loc![0].start, tracks[1].loc![0].end)).toBe('s("hh*8")')
  })

  it('a LEADING transport head is handled too — by the prelude strip, not the filter', () => {
    // Kept as its own arm so the two mechanisms stay distinguishable. If the
    // filter is removed, this one still passes; if the prelude strip changes,
    // this is the arm that reports it.
    const code = 'setcps(0.5)\ns("bd*4")\ns("hh*8")'
    const tracks = tracksOf(parseStrudel(code))
    expect(tracks).toHaveLength(2)
    expect(code.slice(tracks[0].loc![0].start, tracks[0].loc![0].end)).toBe('s("bd*4")')
  })

  it('comments do not become tracks', () => {
    const ir = parseStrudel('// kick\ns("bd*4")\n// hats\ns("hh*8")')
    expect(tracksOf(ir)).toHaveLength(2)
  })

  describe('what is ONE statement — the line breaks that must NOT split', () => {
    // Each of these is a single expression spanning several lines. Splitting any
    // of them fabricates a track the document never declared, which is worse than
    // missing one: it invents a row and a strip the user cannot explain.
    const oneStatement = [
      ['a leading-dot method chain', 's("bd*4")\n  .fast(2)\n  .gain(0.8)'],
      ['a multi-line call', 'stack(\n  s("bd*4"),\n  s("hh*8")\n)'],
      ['a head whose paren opens on the next line', 'stack\n(s("bd*4"), s("hh*8"))'],
      ['an argument list broken across lines', 's("bd*4").gain(\n  0.8\n)'],
    ] as const
    for (const [what, code] of oneStatement) {
      it(what, () => {
        expect(parseStrudel(code).tag).toBe('Track')
      })
    }
  })

  it('a single statement is untouched — no Stack, no loc, byte-identical shape', () => {
    const ir = parseStrudel('s("bd*4")')
    expect(ir.tag).toBe('Track')
    // The single-statement path deliberately did not move, so a bare document
    // that worked before #1096 parses to exactly what it always did.
    expect(ir.tag === 'Track' && ir.loc).toBeUndefined()
  })

  // ── #1523 — the one arm here that CHANGED, and why the old reason lapsed ──
  //
  // This used to read "a document with bindings keeps the existing single-Track
  // shape", because "declaring a track per statement here would need
  // substitution to be meaningful, so those documents are deliberately left
  // alone rather than given a second, weaker binding map."
  //
  // The reason was right and it has been overtaken rather than overruled: since
  // #1392 the substitution engine — `collectTopLevelBindings` — accepts an
  // N-statement tail, and `buildBindingMap` is a caller of it. So the tail can
  // be split reading the map that already exists, and no second one is
  // invented. What the old shape cost was the ordinary document
  //
  //     let M = 2
  //     s("cp")
  //     arrange([2, s("bd")], [2, s("hh")])
  //
  // which reached the IR wholly opaque — no rows, no marks, no sound — while
  // the same document with the `s("cp")` line deleted parsed perfectly.
  it('#1523 — a document with bindings splits too, reading the resolved map', () => {
    const code = 'let a = s("bd*4")\na.fast(2)\ns("hh*8")'
    const ir = parseStrudel(code)
    expect(ir.tag).toBe('Stack')
    const ts = tracksOf(ir)
    expect(ts.map((t) => (t.tag === 'Track' ? t.trackId : t.tag))).toEqual(['d1', 'd2'])
    // The binding is SUBSTITUTED, not merely tolerated: `a.fast(2)` is
    // Fast(2, …) over the pattern `a` names, so the identifier really resolved.
    const body = ts[0].tag === 'Track' ? ts[0].body : ts[0]
    expect(body.tag).toBe('Fast')
    expect(body.tag === 'Fast' && body.body.tag).toBe('Fast')
    // Only the TAIL declares tracks — the `let` line is not a row.
    expect(code.slice(ts[0].loc![0].start, ts[0].loc![0].end)).toBe('a.fast(2)')
    expect(code.slice(ts[1].loc![0].start, ts[1].loc![0].end)).toBe('s("hh*8")')
  })

  it('#1523 — a binding the ENGINE declines keeps the single-Track shape', () => {
    // The narrowness did not go away, it moved: a document whose bindings do
    // not resolve is still left whole rather than split on a map that does not
    // exist. Here the same name is bound twice, which the engine refuses.
    const code = 'let a = s("bd*4")\nlet a = s("sd*4")\na.fast(2)\ns("hh*8")'
    expect(parseStrudel(code).tag).toBe('Track')
  })
})
