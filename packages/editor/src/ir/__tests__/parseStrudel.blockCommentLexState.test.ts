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
 * ⚠ THE CONTROLS ARE HALF THE POINT — they are here to say the fix moved the one
 * thing it claims to and nothing else. Without them "labels are admitted" would
 * also be satisfied by a walker that had stopped counting brackets altogether,
 * which is a worse bug than the one being fixed.
 *
 * Break-tested, and the numbers are read off the run rather than guessed: with
 * the `lexStateAt` branch removed 6 arms flip and 4 controls stay green. With the
 * #1533 branch below removed, 3 arms flip, its 3 controls stay green, and this
 * whole describe stays green — the two fixes are independent.
 */

import { describe, it, expect } from 'vitest'
import { extractTracks, parseStrudel, stripParserPrelude } from '../parseStrudel'

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

  it('does not open a comment for a `/*` inside a STRING', () => {
    // The `inString` branch runs before the new one, and this says so. Without
    // this arm the fix could have been written to scan for `/*` anywhere.
    expect(extractTracks('const s = "/*"\nfoo: s("bd")').map((t) => t.label)).toEqual(['foo'])
    expect(extractTracks("const s = '/*'\nfoo: s(\"bd\")").map((t) => t.label)).toEqual(['foo'])
  })

  it('a label inside a TERMINATED block comment is not a track', () => {
    // ⚠ THIS BEHAVIOUR CHANGED AND WAS UNPINNED. Before the fix a `name:` inside
    // a block comment was admitted as a LIVE track; now it is rejected. The
    // mechanism is the bounded scan: `lexStateAt` stops at the candidate, so a
    // label inside a comment that closes LATER is indistinguishable from one
    // after a `/*` that never closes — and rejecting both is right.
    //
    // ⚠ Note the deliberate asymmetry with `//`: a line-commented track is kept
    // as an empty-body placeholder so d{N} numbering survives comment toggling
    // (#1178 / 20-12.1). A block-commented one is dropped outright. Making it a
    // placeholder too would be a further improvement, not this change.
    const code = '/*\nfoo: s("bd")\n*/\n$: s("hh")'
    expect(extractTracks(code).map((t) => t.label)).toEqual(['$'])
  })
})

/**
 * #1533 — the THIRD walker, and the one that made the simplest document break.
 *
 * `stripParserPrelude` removes the leading run of comments, blank lines and boot
 * calls before the bare branch parses. Its only comment rule was
 * `trimmed.startsWith('//')`, so a `/* … *​/` licence header was not prelude: the
 * scan stopped on line 1 and the body handed onward was the ENTIRE source, comment
 * included. `parseExpression` met a comment as its root and gave up.
 *
 * ⚠ WHY IT HID — the ≥2-statement path repairs it downstream, because
 * `splitTopLevelStatements` DOES model block comments. So a two-pattern document
 * with the same header plays, and only the single-statement fallback broke. The
 * simplest document was the broken one, which is the opposite of where anyone
 * looks.
 */
describe('#1533 — a block-comment header is prelude, like a `//` one', () => {
  const censusOf = (code: string): Record<string, number> => {
    const c: Record<string, number> = {}
    const walk = (n: unknown): void => {
      if (n === null || typeof n !== 'object') return
      if (Array.isArray(n)) return void n.forEach(walk)
      const r = n as Record<string, unknown>
      if (typeof r.tag === 'string') c[r.tag] = (c[r.tag] ?? 0) + 1
      for (const [k, v] of Object.entries(r)) if (k !== 'loc' && k !== 'tag') walk(v)
    }
    walk(parseStrudel(code))
    return c
  }

  // ── The rows this change moves ──────────────────────────────────────────────
  it('a ONE-pattern document with a block header plays', () => {
    expect(censusOf('/* h */\ns("bd")').Play).toBe(1)
    expect(censusOf('/* h */\ns("bd")').Code ?? 0).toBe(0)
    expect(censusOf('/* h */\nsamples("x")\ns("bd")').Play).toBe(1)
    expect(censusOf('/* a\nb\n*/\nsamples("x")\ns("bd")').Play).toBe(1)
  })

  it('strips a block header the way it strips a line header', () => {
    expect(stripParserPrelude('/* h */\nsamples("x")\ns("bd")').body.trim()).toBe('s("bd")')
    expect(stripParserPrelude('/* a\nb\n*/\ns("bd")').body.trim()).toBe('s("bd")')
  })

  it('code after `*/` ON THE SAME LINE is still recognised as prelude', () => {
    // Decided, not accidental: the line scanner resumes AT the code following
    // `*/`, so rule 3 still sees the boot call.
    expect(stripParserPrelude('/* h */ samples("x")\ns("bd")').body.trim()).toBe('s("bd")')
  })

  it('CONTROL — an UNTERMINATED block header leaves the body alone', () => {
    // ⚠ RELABELLED AFTER THE BREAK TEST: this arm does NOT flip when the #1533
    // branch is removed, because without the branch the scan stops on line 1 and
    // the body is the whole source either way. It passes for a different reason
    // in each arm, which makes it a control on unchanged behaviour rather than a
    // claim about the fix. Worth keeping — everything after an unclosed `/*` is a
    // comment, so there is no musical body to strip toward, the same verdict
    // `lexStateAt`'s `inComment` reaches — but not worth counting as evidence.
    const code = '/* h\ns("bd")'
    expect(stripParserPrelude(code).body).toContain('/* h')
  })

  // ── Controls: these pass with the change reverted ───────────────────────────
  it('CONTROL — a `//` header is unchanged, one pattern and two', () => {
    expect(censusOf('// h\nsamples("x")\ns("bd")').Play).toBe(1)
    expect(censusOf('// h\nsamples("x")\ns("bd")\ns("hh")').Play).toBe(2)
  })

  it('CONTROL — a block header with TWO patterns already worked', () => {
    // This is the row that hid the defect: it passes either way, because the
    // statement splitter repairs it downstream.
    expect(censusOf('/* h */\nsamples("x")\ns("bd")\ns("hh")').Play).toBe(2)
  })

  it('CONTROL — a document with no header at all is untouched', () => {
    expect(stripParserPrelude('samples("x")\ns("bd")').body.trim()).toBe('s("bd")')
    expect(censusOf('s("bd")').Play).toBe(1)
  })
})
