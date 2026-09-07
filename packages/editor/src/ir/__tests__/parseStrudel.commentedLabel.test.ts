/**
 * A `//` comment that merely READS like `word:` is prose, not a track (#1475).
 *
 * `extractTracks`'s label scan matches an optional `//` prefix on purpose: a
 * commented-out `$:` line must still be seen so `d{N}` numbering stays stable
 * while a live coder toggles a comment prefix. But the prefix group accepted ANY
 * `// word:` line, and ordinary prose is full of them. One such line anywhere in
 * a file flipped the whole document onto the labelled-track branch, where every
 * real binding and the arrangement were discarded and each prose line became an
 * empty `Track(Pure)` ghost.
 *
 * There is no error and nothing throws — Strudel keeps playing the document
 * correctly. Only the IR loses it, so it surfaces as a timeline that draws
 * nothing.
 *
 * ⚠ THE COUNT THAT MATTERS IS NOT THE NUMBER OF `// word:` LINES. Most of them
 * are REAL commented-out tracks and the flag exists for those. Measured with the
 * parser as the oracle — neutralise the colon and re-parse — over 329 distinct
 * documents (`ref/bakery-runs-inputs`, deduped by content hash): 36 carry such a
 * comment, and 5 LOSE content to it, every one of them parsing as completely
 * silent while holding 484 sound-producing leaves and 11 arrangements between
 * them. Corpus `Play` leaves 26016 -> 26946; arrange documents reaching an
 * arrangement AND sound 9/13 -> 12/13.
 *
 * The discriminator is what follows the colon: a commented-out track's body
 * reads as code, prose does not. Two details, both found by measuring rather
 * than reasoning, and both pinned below:
 *
 *   - the remainder must be consumed ENTIRELY. `acorn.parseExpressionAt` stops
 *     at the first valid prefix, so it reads `reverb volume` as `reverb` and
 *     reports success.
 *   - a real track's body may CONTINUE on following `//` lines, so judging one
 *     line alone rejects a genuine commented track.
 */
import { describe, it, expect } from 'vitest'
import { parseStrudel, extractTracks } from '../parseStrudel'
import type { PatternIR } from '../PatternIR'

function count(ir: unknown, acc = { play: 0, arrange: 0, code: 0 }) {
  if (Array.isArray(ir)) { ir.forEach((x) => count(x, acc)); return acc }
  if (!ir || typeof ir !== 'object') return acc
  const n = ir as Record<string, unknown>
  if (n.tag === 'Play') acc.play++
  if (n.tag === 'Arrange') acc.arrange++
  if (n.tag === 'Code') acc.code++
  for (const [k, v] of Object.entries(n)) {
    if (k === 'loc' || k === 'keyLoc' || k === 'callSiteRange') continue
    count(v, acc)
  }
  return acc
}

const SONG = `let a = s("bd")\nlet b = s("hh")\narrange([4, a], [4, b])`

describe('#1475 — prose in a comment is not a commented-out track', () => {
  it('a prose comment above a song leaves the song intact', () => {
    const control = count(parseStrudel(SONG))
    expect(control).toEqual({ play: 2, arrange: 1, code: 0 })

    for (const prose of [
      '// TODO: mix the drums',
      '// room: reverb volume',
      '// rsize: reverb size',
      '// license: https://creativecommons.org/licenses/by-nc-sa/4.0/',
      '// PR: https://github.com/tidalcycles/strudel/issues/670',
      '// https://strudel.cc/workshop/first-notes/',
      '// note: this used to be twice as fast',
    ]) {
      expect(count(parseStrudel(`${prose}\n${SONG}`)), prose).toEqual(control)
    }
  })

  it('a lone identifier stays a track — the one shape that is genuinely ambiguous', () => {
    // `// Author: hazzajenko` and `// $: drums` have the SAME shape: a remainder
    // that is one bare identifier, which is a complete expression. Nothing in the
    // text separates the prose from the commented-out track, so this admits both
    // rather than guessing — the conservative direction, since admitting is what
    // the parser did before. Measured cost on the corpus: zero. The one document
    // carrying such a line (`1c43849a`) is not among the 5 that lose content, so
    // no real document is asking to be told apart here.
    expect(extractTracks('// Author: hazzajenko\n$: s("cp")').some((t) => t.commented)).toBe(true)
    expect(extractTracks('// $: drums\n$: s("cp")').some((t) => t.commented)).toBe(true)
  })

  it('a real commented-out track is still a track, so d{N} numbering holds', () => {
    for (const track of [
      '// $: note("F")',
      '//$: s("bd ~ [~ bd] ~, ~ [~ sd] ~ sd")',
      '//x3: arrange([1, a], [1, b])',
      '// b: bytebeat(cat(\'t%64\')).dough()',
      '// speak: s("temporality end").gain(4)',
      '// $:',
    ]) {
      const tracks = extractTracks(`${track}\n$: s("cp")`)
      expect(tracks.some((t) => t.commented), track).toBe(true)
    }
  })

  it("a commented track's body may continue on following lines", () => {
    const tracks = extractTracks('// A:note(`<\n//   c e g\n// `)\n$: s("cp")')
    expect(tracks.some((t) => t.commented)).toBe(true)
  })

  it('the whole remainder must parse, not merely a prefix of it', () => {
    // `reverb volume` starts with a valid expression (`reverb`) and is not one.
    expect(extractTracks('// room: reverb volume\n$: s("cp")').some((t) => t.commented)).toBe(false)
    // `s("bd")` is one, entire.
    expect(extractTracks('// room: s("bd")\n$: s("cp")').some((t) => t.commented)).toBe(true)
  })

  it('a prose line no longer truncates the track declared above it', () => {
    // A rejected label used to become a `start`, cutting the PREVIOUS track's
    // slice short at that line even though its own body was discarded.
    const ir = parseStrudel('$: s("bd").gain(0.5)\n// note: quieter than it was\n$: s("hh")')
    expect(count(ir).play).toBe(2)
  })

  it('the songwriter-named corpus document parses', () => {
    // 86b5c692 in miniature: named sections, an arrange, and two lines of prose
    // explaining what reverb does.
    const src = [
      'let drums = s("bd*4")',
      '  // room: reverb volume',
      '  // rsize: reverb size',
      'let section00 = stack(drums)',
      'let section01 = stack(drums)',
      'arrange (',
      '  [8, section00],',
      '  [8, section01]',
      ')',
    ].join('\n')
    const c = count(parseStrudel(src))
    expect(c.arrange).toBe(1)
    expect(c.play).toBeGreaterThan(0)
  })
})
