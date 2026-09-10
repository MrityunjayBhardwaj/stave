/**
 * #1532 — a bracket inside a `/* … *​/` block comment must not be counted.
 *
 * `lexStateAt` decides whether a `$:` / `name:` label candidate is really at
 * top level. It modelled strings, escapes, `//` line comments and bracket depth
 * — and not block comments, so brackets written inside one were counted as
 * though they were code. `splitTopLevelStatements` was given exactly this
 * branch by #152; this walker was not, and nothing noticed because a comment's
 * brackets are usually balanced.
 *
 * The pairing that is not harmless is an ordinary licence header:
 *
 *     /* @license  CC BY-NC-SA (https://creativecommons.org/licenses/…/4.0/)
 *      *​/
 *
 * The `(` was counted, then the `//` in `https://` opened a line comment that
 * swallowed the `)`. Depth stuck at 1 for the rest of the document, every label
 * after it was rejected as "inside brackets", and a six-track tune reached the
 * IR as one opaque `Code` node — no rows, no marks, no gestures, no error.
 *
 * ⚠ THE CONTROLS ARE HALF THE POINT. Five of the arms below pass with this
 * change reverted; they are here to say that the fix moved the one thing it
 * claims to and nothing else. Break-tested: with the `/*` branch removed the
 * five REJECTED-cases-now-admitted arms flip and all five controls stay green.
 */

import { describe, it, expect } from 'vitest'
import { extractTracks, parseStrudel } from '../parseStrudel'

/** Is a known-good label still admitted after this prefix? */
function labelAdmittedAfter(prefix: string): boolean {
  return extractTracks(`${prefix}\nzzprobe: s("bd")\n`).some((t) => t.label === 'zzprobe')
}

describe('#1532 — lexStateAt must not count brackets inside a block comment', () => {
  // ── The arms this change moves, most-discriminating first (PV423) ──────────
  //
  // A lone open bracket inside a comment is the ONE document that separates
  // "block comments are not modelled at all" from every weaker story about
  // URLs or `//`. It has no `//` in it and no closing bracket to balance.
  it('admits a label after a comment containing a LONE open bracket', () => {
    expect(labelAdmittedAfter('/* ( */')).toBe(true)
    expect(labelAdmittedAfter('/* [ */')).toBe(true)
    expect(labelAdmittedAfter('/* { */')).toBe(true)
  })

  it('admits a label after a licence header with a parenthesised URL', () => {
    expect(labelAdmittedAfter('/* (https://example.com/a/b) */')).toBe(true)
    expect(labelAdmittedAfter('/* ( // */')).toBe(true)
  })

  it('does the same for a `$:` document, which is not special here', () => {
    const code = '/* @license CC BY-SA (https://example.com/l/4.0/) */\n$: s("bd")\n$: s("hh")'
    expect(extractTracks(code)).toHaveLength(2)
  })

  it('reads a whole tune whose only defect was its header', () => {
    // The shape of `0/32BM8hiYiJkS`, reduced: a header, some bindings, then six
    // labelled tracks. Before the fix `extractTracks` returned 0 and the whole
    // document reached the IR as a single opaque Code node.
    const code = [
      '/* @title    By Design',
      '   @license  CC BY-NC-SA (https://creativecommons.org/licenses/by-nc-sa/4.0/)',
      '*/',
      'const look = 1',
      '_vox_chop: s("bd*4")',
      '_vox_end: s("hh*8")',
      '_notes: n("0 2 4").s("piano")',
      '_bassline1: note("c2 e2").s("sawtooth")',
      '_bassline2: note("g1 a1").s("square")',
      'drums: s("bd sd")',
    ].join('\n')

    const tracks = extractTracks(code)
    expect(tracks.map((t) => t.label)).toEqual([
      '_vox_chop',
      '_vox_end',
      '_notes',
      '_bassline1',
      '_bassline2',
      'drums',
    ])
    // …and the document is no longer wholly opaque. Six labelled tracks means
    // six Track nodes, which is what gives the timeline six rows.
    const ir = parseStrudel(code)
    expect(ir.tag).toBe('Stack')
    if (ir.tag !== 'Stack') throw new Error('unreachable')
    expect(ir.tracks).toHaveLength(6)
  })

  it('does not mistake a URL inside a comment for a track called `https`', () => {
    // ⚠ FOUND BY THE CENSUS, NOT BY LOOKING FOR IT. The archive count of
    // "documents whose labels are all rejected" did not move — 28 before, 28
    // after — and the SET had changed underneath: one six-track document was
    // rescued, and one document joined because it had been declaring a track it
    // should never have had. A tune whose licence comment links a YouTube video
    // got a row named `https`, whose body was the rest of the comment.
    //
    // Reading the count alone would have called this a wash. It is two wins.
    const code = [
      '/*  @title Elvens on Mars',
      '    I was watching this video',
      '    https://www.youtube.com/watch?v=pY27JurC1Y0',
      '*/',
      'stack(n("[0 .. 11]"))',
    ].join('\n')
    expect(extractTracks(code).map((t) => t.label)).toEqual([])
    // …and the real music underneath is still read.
    expect(parseStrudel(code).tag).toBe('Track')
  })

  it('treats an UNTERMINATED block comment as swallowing what follows', () => {
    // The honest reading: everything after an unclosed `/*` really is inside a
    // comment, so nothing there is a top-level label.
    expect(labelAdmittedAfter('/* (')).toBe(false)
    expect(labelAdmittedAfter('/* everything after here is a comment')).toBe(false)
  })

  // ── Controls: these pass with the change reverted ──────────────────────────
  //
  // Without them "labels are admitted" could be satisfied by a walker that had
  // stopped counting brackets altogether, which would be a far worse bug than
  // the one being fixed.
  it('CONTROL — still counts brackets that are really open in CODE', () => {
    expect(labelAdmittedAfter('stack(')).toBe(false)
    expect(labelAdmittedAfter('const xs = [')).toBe(false)
    // …and a comment does not license the code around it to go uncounted.
    expect(labelAdmittedAfter('stack( /* a comment */')).toBe(false)
  })

  it('CONTROL — line comments were already modelled and still are', () => {
    expect(labelAdmittedAfter('// (')).toBe(true)
    expect(labelAdmittedAfter('// (https://example.com/a/b)')).toBe(true)
  })

  it('CONTROL — a balanced comment and a bare `//` were already fine', () => {
    expect(labelAdmittedAfter('/* (x) */')).toBe(true)
    expect(labelAdmittedAfter('/* // */')).toBe(true)
    expect(labelAdmittedAfter('/*\n// x\n*/')).toBe(true)
  })

  it('CONTROL — a bracket inside a STRING is still not counted', () => {
    expect(labelAdmittedAfter('const s = "("')).toBe(true)
  })
})
