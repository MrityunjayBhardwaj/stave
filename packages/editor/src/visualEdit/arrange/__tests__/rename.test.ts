/**
 * #1417 Stage 2 — renaming an `arrange(...)` section, which is a BINDING rename.
 *
 * The pick spelling's rename (Stage 1, #1472) renames an object key and leaves
 * the binding alone. This one is the exact opposite: the name IS the binding, so
 * the declaration and every reference move and the object keys must not. Both
 * halves of that are asserted, because getting either backwards produces a
 * document that parses cleanly and means something else.
 */
import { describe, it, expect } from 'vitest'

import { detectArrangeAt } from '../parse'
import { countSectionArms, renameSection } from '../rename'
import { normalizeEdits, type OffsetEdit } from '../../writeback'

function apply(doc: string, edits: OffsetEdit[]): string {
  const sorted = [...normalizeEdits(edits)].sort((a, b) => b.range[0] - a.range[0])
  let out = doc
  for (const e of sorted) out = out.slice(0, e.range[0]) + e.text + out.slice(e.range[1])
  return out
}

const SONG = [
  'const intro = s("bd")',
  'const verse = s("hh")',
  '$: arrange([4, intro], [8, verse])',
].join('\n')

const call = (doc: string) => detectArrangeAt(doc, doc.indexOf('arrange'))!

describe('renameSection — the arrange spelling', () => {
  it('renames the declaration and the arm together', () => {
    expect(apply(SONG, renameSection(SONG, call(SONG), 1, 'chorus'))).toBe(
      [
        'const intro = s("bd")',
        'const chorus = s("hh")',
        '$: arrange([4, intro], [8, chorus])',
      ].join('\n'),
    )
  })

  it('renames a RETURNING section in every arm it occupies', () => {
    // One pattern arranged twice is what a song does when a chorus comes back.
    // These are not two sections that share a name.
    const doc = [
      'const allTogether = s("bd")',
      'const bass = s("hh")',
      '$: arrange([16, allTogether], [8, bass], [12, allTogether])',
    ].join('\n')
    expect(apply(doc, renameSection(doc, call(doc), 0, 'chorus'))).toBe(
      [
        'const chorus = s("bd")',
        'const bass = s("hh")',
        '$: arrange([16, chorus], [8, bass], [12, chorus])',
      ].join('\n'),
    )
  })

  it('counts the arms a rename will move, before writing', () => {
    const doc = [
      'const allTogether = s("bd")',
      '$: arrange([16, allTogether], [12, allTogether])',
    ].join('\n')
    expect(countSectionArms(doc, call(doc), 0)).toBe(2)
    expect(countSectionArms(SONG, call(SONG), 0)).toBe(1)
  })

  it('renames a reference that is not an arm at all', () => {
    // The binding's whole span, not just the arrangement — a section used inside
    // another pattern has to follow its name.
    const doc = [
      'const verse = s("hh")',
      'const double = stack(verse, verse)',
      '$: arrange([8, verse], [8, double])',
    ].join('\n')
    expect(apply(doc, renameSection(doc, call(doc), 0, 'main'))).toBe(
      [
        'const main = s("hh")',
        'const double = stack(main, main)',
        '$: arrange([8, main], [8, double])',
      ].join('\n'),
    )
  })

  // ── the three places an identifier is NOT a reference ────────────────────

  it('leaves an object KEY that happens to share the name', () => {
    const doc = [
      'const verse = s("hh")',
      'const cfg = { verse: 1, other: verse }',
      '$: arrange([8, verse])',
    ].join('\n')
    expect(apply(doc, renameSection(doc, call(doc), 0, 'main'))).toBe(
      [
        'const main = s("hh")',
        'const cfg = { verse: 1, other: main }',
        '$: arrange([8, main])',
      ].join('\n'),
    )
  })

  it('leaves a member PROPERTY that happens to share the name', () => {
    const doc = [
      'const verse = s("hh")',
      'const x = cfg.verse',
      '$: arrange([8, verse])',
    ].join('\n')
    expect(apply(doc, renameSection(doc, call(doc), 0, 'main'))).toBe(
      [
        'const main = s("hh")',
        'const x = cfg.verse',
        '$: arrange([8, main])',
      ].join('\n'),
    )
  })

  it('leaves a STATEMENT LABEL alone — that is how Stave names a track', () => {
    // Not hypothetical: `drums: s("bd")` is the labelled-track spelling, so a
    // binding sharing a track's name is an ordinary document rather than a trap.
    const doc = [
      'const verse = s("hh")',
      'verse: s("bd")',
      '$: arrange([8, verse])',
    ].join('\n')
    expect(apply(doc, renameSection(doc, call(doc), 0, 'main'))).toBe(
      [
        'const main = s("hh")',
        'verse: s("bd")',
        '$: arrange([8, main])',
      ].join('\n'),
    )
  })

  it('expands SHORTHAND so the key stays and only the value moves', () => {
    // `{verse}` means `{verse: verse}`. A binding rename must keep the key.
    const doc = [
      'const verse = s("hh")',
      'const song = pick({verse})',
      '$: arrange([8, verse])',
    ].join('\n')
    expect(apply(doc, renameSection(doc, call(doc), 0, 'main'))).toBe(
      [
        'const main = s("hh")',
        'const song = pick({verse: main})',
        '$: arrange([8, main])',
      ].join('\n'),
    )
  })

  // ── declines ─────────────────────────────────────────────────────────────

  it('declines a built-in, checked as "no declaration" and not by a name list', () => {
    const doc = 'const bass = s("bd")\n$: arrange([1, silence], [6, bass])'
    expect(renameSection(doc, call(doc), 0, 'intro')).toEqual([])
    expect(countSectionArms(doc, call(doc), 0)).toBe(0)
  })

  it('declines an inline expression, which has no name to rename', () => {
    const doc = '$: arrange([8, stack(s("bd"), s("hh"))], [8, s("cp")])'
    expect(renameSection(doc, call(doc), 0, 'intro')).toEqual([])
    expect(countSectionArms(doc, call(doc), 0)).toBe(0)
  })

  it('declines when the new name is already taken ANYWHERE', () => {
    const doc = [
      'const verse = s("hh")',
      'const chorus = s("bd")',
      '$: arrange([8, verse])',
    ].join('\n')
    expect(renameSection(doc, call(doc), 0, 'chorus')).toEqual([])
    // …including as a label or a property, where merging two names would be
    // silent rather than a syntax error.
    const labelled = 'const verse = s("hh")\nchorus: s("bd")\n$: arrange([8, verse])'
    expect(renameSection(labelled, call(labelled), 0, 'chorus')).toEqual([])
  })

  it('declines when the name is SHADOWED by a parameter', () => {
    // Inside the arrow, `verse` is a different thing; renaming every occurrence
    // would change what the document plays.
    const doc = [
      'const verse = s("hh")',
      'const f = (verse) => verse.fast(2)',
      '$: arrange([8, verse])',
    ].join('\n')
    expect(renameSection(doc, call(doc), 0, 'main')).toEqual([])
  })

  it('declines a no-op and an invalid name', () => {
    expect(renameSection(SONG, call(SONG), 1, 'verse')).toEqual([])
    expect(renameSection(SONG, call(SONG), 1, '2bad')).toEqual([])
    expect(renameSection(SONG, call(SONG), 1, 'with space')).toEqual([])
    expect(renameSection(SONG, call(SONG), 1, '__proto__')).toEqual([])
    expect(renameSection(SONG, call(SONG), 1, '')).toEqual([])
  })

  it('declines for an arm that names nothing', () => {
    expect(renameSection(SONG, call(SONG), 9, 'x')).toEqual([])
    expect(countSectionArms(SONG, call(SONG), 9)).toBe(0)
  })

  it('leaves a document that still reads back as an arrangement', () => {
    const out = apply(SONG, renameSection(SONG, call(SONG), 1, 'chorus'))
    const reparsed = detectArrangeAt(out, out.indexOf('arrange'))
    expect(reparsed).not.toBeNull()
    expect(reparsed!.arms).toHaveLength(2)
  })

  it('never disagrees with its own count', () => {
    // The pairing that matters at a call site: a caller shown "2 sections" and
    // then handed no edits would be worse than either outcome alone.
    const docs = [
      SONG,
      'const bass = s("bd")\n$: arrange([1, silence], [6, bass])',
      '$: arrange([8, stack(s("bd"))], [8, s("cp")])',
      'const a = s("bd")\nconst f = (a) => a\n$: arrange([8, a])',
    ]
    for (const doc of docs) {
      const c = detectArrangeAt(doc, doc.indexOf('arrange'))
      if (!c) continue
      for (let i = 0; i < c.arms.length; i++) {
        const n = countSectionArms(doc, c, i)
        const edits = renameSection(doc, c, i, 'brandNewName')
        expect(n > 0).toBe(edits.length > 0)
      }
    }
  })
})
