/**
 * pickControl.test — #463 Stage 2 control-string write-back.
 *
 * Detection + the 5 section ops on a `pick*` control `<…@w …>`. Each structural
 * op asserts the resulting SOURCE STRING (the write-back — the op's own output).
 * The per-cycle SECTION TIMING those edits produce is a runtime property of
 * Strudel's eval (the retired collect engine's `pick`/`pickRestart` selection),
 * verified end-to-end by the app's full-song e2e, not re-collected here.
 */
import { describe, it, expect } from 'vitest'
import { detectPickControlAt } from '../parse'
import {
  setWeight,
  splitArm,
  removeArm,
  silenceArm,
  reorderArm,
  duplicateArm,
  insertSilenceArm,
  renameSection,
  countSectionArms,
  setArmHead,
  listSectionParts,
} from '../serialize'
import { normalizeEdits, type OffsetEdit } from '../../writeback'

const SONG = '"<~@2 verse@2 chorus@2>".pickRestart({verse: s("bd"), chorus: s("hh")})'
// The control `<…>` starts at index 1 (after the opening quote).
const CTRL_POS = 5

function apply(doc: string, edits: OffsetEdit[]): string {
  const sorted = [...edits].sort((a, b) => b.range[0] - a.range[0])
  let out = doc
  for (const e of sorted) out = out.slice(0, e.range[0]) + e.text + out.slice(e.range[1])
  return out
}

describe('#463 Stage 2 — detect pick control', () => {
  it('finds the pick* call + its weighted arms with correct ranges', () => {
    const ctl = detectPickControlAt(SONG, CTRL_POS)
    expect(ctl).not.toBeNull()
    expect(ctl!.method).toBe('pickRestart')
    expect(ctl!.arms).toHaveLength(3)
    expect(ctl!.arms.map((a) => a.weight)).toEqual([2, 2, 2])
    // Each arm's head text slices back to its token.
    expect(ctl!.arms.map((a) => SONG.slice(a.headRange[0], a.headRange[1]))).toEqual(['~', 'verse', 'chorus'])
    // The weight digits address the `2`s.
    expect(ctl!.arms.map((a) => (a.weightRange ? SONG.slice(a.weightRange[0], a.weightRange[1]) : null))).toEqual(['2', '2', '2'])
  })

  it('returns null when the cursor is not inside a pick* call', () => {
    expect(detectPickControlAt('s("bd hh")', 3)).toBeNull()
  })
})

describe('#463 Stage 2 — control ops (source write-back)', () => {
  it('TRIM (setWeight) — verse@2 → verse@4 lengthens the section', () => {
    const ctl = detectPickControlAt(SONG, CTRL_POS)!
    const out = apply(SONG, setWeight(SONG, ctl, 1, 4))
    // verse now spans c2-5, chorus c6-7 at runtime.
    expect(out).toContain('<~@2 verse@4 chorus@2>')
  })

  it('SPLIT — verse@2 → verse@1 verse@1 (two clips, same content)', () => {
    const ctl = detectPickControlAt(SONG, CTRL_POS)!
    const out = apply(SONG, splitArm(SONG, ctl, 1, 1))
    // Same audible timing (verse still c2-3), now two arms.
    expect(out).toContain('<~@2 verse@1 verse@1 chorus@2>')
  })

  it('DELETE (removeArm) — drop chorus; the lane loses that section', () => {
    const ctl = detectPickControlAt(SONG, CTRL_POS)!
    const out = apply(SONG, removeArm(SONG, ctl, 2))
    // period now 4: rest c0-1, verse c2-3, repeat — no hh anywhere.
    expect(out).toContain('<~@2 verse@2>')
  })

  it('MOVE (reorderArm) — swap verse and chorus order', () => {
    const ctl = detectPickControlAt(SONG, CTRL_POS)!
    const out = apply(SONG, reorderArm(SONG, ctl, 1, 2))
    expect(out).toContain('<~@2 chorus@2 verse@2>')
  })

  it('DUPLICATE — clone verse right after itself', () => {
    const ctl = detectPickControlAt(SONG, CTRL_POS)!
    const out = apply(SONG, duplicateArm(SONG, ctl, 1))
    // period 8: rest c0-1, verse c2-5 (two arms back-to-back), chorus c6-7.
    expect(out).toContain('<~@2 verse@2 verse@2 chorus@2>')
  })

  it('the section patterns + pickRestart object stay byte-verbatim after an op', () => {
    const ctl = detectPickControlAt(SONG, CTRL_POS)!
    const out = apply(SONG, reorderArm(SONG, ctl, 1, 2))
    expect(out).toContain('.pickRestart({verse: s("bd"), chorus: s("hh")})')
  })
})

/**
 * #1462 — DELETE MEANS ONE THING, WHICHEVER WAY THE SONG IS SPELLED.
 *
 * Stave understands two spellings of one musical idea — a finite weighted
 * sequence of sections:
 *
 *     arrange([4, intro], [8, verse], [4, outro])
 *     "<intro@4 verse@8 outro@4>".pickRestart({ intro, verse, outro })
 *
 * The same Delete key, on the same canvas, used to mean two different things
 * across them: `arrange` silenced the arm in place and kept the song's length
 * (#491 — the DAW convention, an absolute timeline where later clips do not slide
 * left), while the pick spelling rippled the section out and made the song
 * SHORTER. One handler, `handleDeleteClip`, two semantics, decided by a syntax
 * choice the user very likely made for readability.
 *
 * The arrange branch carried an explicit justification and the pick branch carried
 * none. That asymmetry is what marked it an unconsidered divergence rather than a
 * design decision, so the pick side is the one that moved.
 *
 * ⚠ THE GAP IS NOT A REGRESSION AND MUST NOT BE "FIXED" BACK. Ripple delete — the
 * gesture that legitimately shortens a song — is a SECOND gesture that does not
 * exist yet on either spelling (#1460). `removeArm` below is its waiting
 * substrate, which is why its own arms stay green right beside these.
 */
describe('#1462 — the pick spelling deletes to a GAP, like arrange does', () => {
  it('SILENCE (silenceArm) — verse@2 → ~@2, the width is kept', () => {
    const ctl = detectPickControlAt(SONG, CTRL_POS)!
    const out = apply(SONG, silenceArm(SONG, ctl, 1))
    expect(out).toContain('<~@2 ~@2 chorus@2>')
  })

  it('the SECTIONS OBJECT is untouched — only the control arm changes', () => {
    // The point of editing the control TEXT (PV123): a deleted clip must not
    // rewrite the patterns, so undo/redo and byte-verbatim round-trip still hold.
    const ctl = detectPickControlAt(SONG, CTRL_POS)!
    const out = apply(SONG, silenceArm(SONG, ctl, 1))
    expect(out).toContain('.pickRestart({verse: s("bd"), chorus: s("hh")})')
  })

  it('the song does NOT get shorter — arm count and total weight are unchanged', () => {
    // The whole difference from `removeArm`, stated as the property it protects.
    const ctl = detectPickControlAt(SONG, CTRL_POS)!
    const out = apply(SONG, silenceArm(SONG, ctl, 1))
    const after = detectPickControlAt(out, CTRL_POS)!
    expect(after.arms).toHaveLength(ctl.arms.length)
    const total = (c: typeof ctl) => c.arms.reduce((n, a) => n + a.weight, 0)
    expect(total(after)).toBe(total(ctl))
  })

  it('an already-silent arm is a NO-OP (mirrors arrange/silenceArm)', () => {
    const ctl = detectPickControlAt(SONG, CTRL_POS)!
    expect(silenceArm(SONG, ctl, 0)).toEqual([]) // arm 0 is already `~@2`
  })

  it('silencing EVERY arm is allowed — a muted track is valid, not an empty one', () => {
    // Unlike removeArm, this op can never empty the control, so it needs no
    // sole-arm guard. Applied one at a time, as the user would.
    let doc = SONG
    for (let i = 0; i < 3; i++) {
      const c = detectPickControlAt(doc, CTRL_POS)!
      doc = apply(doc, silenceArm(doc, c, i))
    }
    expect(doc).toContain('<~@2 ~@2 ~@2>')
    expect(detectPickControlAt(doc, CTRL_POS)!.arms).toHaveLength(3)
  })

  it('an IMPLICIT-weight arm keeps its implicit width (verse → ~, no @1 invented)', () => {
    // Byte-minimality: writing `~@1` here would be a correct song and a rewritten
    // document — the same discipline setWeight follows for an implicit arm.
    const doc = '"<~ verse chorus>".pickRestart({verse: s("bd"), chorus: s("hh")})'
    const ctl = detectPickControlAt(doc, 5)!
    expect(apply(doc, silenceArm(doc, ctl, 1))).toContain('<~ ~ chorus>')
  })

  it('REMOVE still ripples — the substrate for #1460 is unchanged by this', () => {
    // The control arm for the change above: `removeArm` must keep doing what it
    // did, or the second gesture has nothing to be built on.
    const ctl = detectPickControlAt(SONG, CTRL_POS)!
    const out = apply(SONG, removeArm(SONG, ctl, 1))
    expect(out).toContain('<~@2 chorus@2>')
    expect(detectPickControlAt(out, CTRL_POS)!.arms).toHaveLength(2)
  })
})

/**
 * #1417 Stage 1 — rename a pick-spelled section.
 *
 * The section's name is the OBJECT KEY, so a rename here moves the key and every
 * selector token that names it, and touches no binding. Every arm asserts the
 * resulting SOURCE STRING, because a rename's whole risk surface is the bytes —
 * the IR is a model of the runtime object, not the runtime path.
 */
const SHORTHAND = '"<verse@8 chorus@4>".pickRestart({verse, chorus})'
const RETURNING = '"<verse@8 chorus@4 verse@8>".pickRestart({verse: s("bd"), chorus: s("hh")})'

describe('#1417 Stage 1 — section entries', () => {
  it('carries each object key with a range that slices back to its token', () => {
    const ctl = detectPickControlAt(SONG, CTRL_POS)!
    expect(ctl.entries.map((e) => e.key)).toEqual(['verse', 'chorus'])
    expect(ctl.entries.map((e) => SONG.slice(e.keyRange[0], e.keyRange[1]))).toEqual(['verse', 'chorus'])
    expect(ctl.entries.map((e) => e.shorthand)).toEqual([false, false])
  })

  it('marks ES shorthand — the key token IS the value token', () => {
    const ctl = detectPickControlAt(SHORTHAND, CTRL_POS)!
    expect(ctl.entries.map((e) => e.key)).toEqual(['verse', 'chorus'])
    expect(ctl.entries.every((e) => e.shorthand)).toBe(true)
  })

  it('reads a quoted key and spans the quotes', () => {
    const doc = '"<verse@2>".pickRestart({"verse": s("bd")})'
    const ctl = detectPickControlAt(doc, CTRL_POS)!
    expect(ctl.entries[0].key).toBe('verse')
    expect(doc.slice(ctl.entries[0].keyRange[0], ctl.entries[0].keyRange[1])).toBe('"verse"')
  })

  it('SKIPS a property it cannot name rather than losing the whole object', () => {
    const doc = '"<verse@2 chorus@2>".pickRestart({["ver" + "se"]: s("bd"), chorus: s("hh")})'
    const ctl = detectPickControlAt(doc, CTRL_POS)!
    // The computed key is unnameable; `chorus` beside it is still nameable.
    expect(ctl.entries.map((e) => e.key)).toEqual(['chorus'])
  })

  it('is empty for the array form — those sections have no names to rename', () => {
    const doc = '"<0@2 1@2>".pick([s("bd"), s("hh")])'
    const ctl = detectPickControlAt(doc, CTRL_POS)!
    expect(ctl.arms).toHaveLength(2)
    expect(ctl.entries).toEqual([])
  })
})

describe('#1417 Stage 1 — renameSection (source write-back)', () => {
  it('renames the key and the selector token, leaving the pattern alone', () => {
    const ctl = detectPickControlAt(SONG, CTRL_POS)!
    const out = apply(SONG, renameSection(SONG, ctl, 1, 'intro'))
    expect(out).toBe('"<~@2 intro@2 chorus@2>".pickRestart({intro: s("bd"), chorus: s("hh")})')
  })

  it('EXPANDS shorthand — the section is renamed, the binding is not', () => {
    const ctl = detectPickControlAt(SHORTHAND, CTRL_POS)!
    const out = apply(SHORTHAND, renameSection(SHORTHAND, ctl, 0, 'intro'))
    expect(out).toBe('"<intro@8 chorus@4>".pickRestart({intro: verse, chorus})')
  })

  it('keeps the quoting style of a quoted key', () => {
    const doc = '"<verse@2>".pickRestart({"verse": s("bd")})'
    const ctl = detectPickControlAt(doc, CTRL_POS)!
    expect(apply(doc, renameSection(doc, ctl, 0, 'intro'))).toBe(
      '"<intro@2>".pickRestart({"intro": s("bd")})',
    )
  })

  it('renames a RETURNING section in every arm it occupies', () => {
    const ctl = detectPickControlAt(RETURNING, CTRL_POS)!
    expect(countSectionArms(RETURNING, ctl, 0)).toBe(2)
    const out = apply(RETURNING, renameSection(RETURNING, ctl, 0, 'intro'))
    expect(out).toBe('"<intro@8 chorus@4 intro@8>".pickRestart({intro: s("bd"), chorus: s("hh")})')
  })

  it('leaves arm COUNT and ORDER untouched — a rename is not a restructure', () => {
    const ctl = detectPickControlAt(RETURNING, CTRL_POS)!
    const out = apply(RETURNING, renameSection(RETURNING, ctl, 1, 'bridge'))
    const after = detectPickControlAt(out, CTRL_POS)!
    expect(after.arms).toHaveLength(ctl.arms.length)
    expect(after.arms.map((a) => a.weight)).toEqual(ctl.arms.map((a) => a.weight))
    expect(after.arms.map((a) => out.slice(a.headRange[0], a.headRange[1]))).toEqual([
      'verse',
      'bridge',
      'verse',
    ])
  })

  it('produces edits writeback accepts (no overlap, no inverted range)', () => {
    const ctl = detectPickControlAt(RETURNING, CTRL_POS)!
    expect(() => normalizeEdits(renameSection(RETURNING, ctl, 0, 'intro'))).not.toThrow()
  })

  it('DECLINES an arm that is not a named section (`~`, inline pattern)', () => {
    const ctl = detectPickControlAt(SONG, CTRL_POS)!
    expect(renameSection(SONG, ctl, 0, 'intro')).toEqual([])
    const inline = '"<[bd,sd]@2 verse@2>".pickRestart({verse: s("bd")})'
    const ctl2 = detectPickControlAt(inline, CTRL_POS)!
    expect(renameSection(inline, ctl2, 0, 'intro')).toEqual([])
  })

  it('DECLINES a collision with another section in the same object', () => {
    const ctl = detectPickControlAt(SONG, CTRL_POS)!
    expect(renameSection(SONG, ctl, 1, 'chorus')).toEqual([])
  })

  it('DECLINES a name that is not a bare identifier, and a no-op rename', () => {
    const ctl = detectPickControlAt(SONG, CTRL_POS)!
    for (const bad of ['', 'my verse', 'verse@2', '2verse', '[bd]', '~', 'a-b']) {
      expect(renameSection(SONG, ctl, 1, bad)).toEqual([])
    }
    expect(renameSection(SONG, ctl, 1, 'verse')).toEqual([])
  })

  it('DECLINES on the array form — no key to carry the name', () => {
    const doc = '"<0@2 1@2>".pick([s("bd"), s("hh")])'
    const ctl = detectPickControlAt(doc, CTRL_POS)!
    expect(renameSection(doc, ctl, 0, 'intro')).toEqual([])
    expect(countSectionArms(doc, ctl, 0)).toBe(0)
  })
})

describe('#1417 Stage 1 — the name must be uniquely and completely addressable', () => {
  it('DECLINES a duplicate key — JS keeps the last, so renaming the first moves the music', () => {
    // Real shape, from the corpus: `.pickRestart({arp, lead, glitch, glitch})`.
    const doc = '"<a@2 g@2>".pickRestart({a: s("bd"), g: s("hh"), g: s("cp")})'
    const ctl = detectPickControlAt(doc, CTRL_POS)!
    expect(ctl.entries.map((e) => e.key)).toEqual(['a', 'g', 'g'])
    expect(renameSection(doc, ctl, 1, 'glitch')).toEqual([])
    expect(countSectionArms(doc, ctl, 1)).toBe(0)
    // the section beside it is unaffected — one bad key costs only itself
    expect(renameSection(doc, ctl, 0, 'intro')).not.toEqual([])
  })

  it('DECLINES when the name also sits NESTED inside another arm head', () => {
    // `[verse chorus]` is one arm whose head is the whole group; the `verse`
    // inside it is a real reference this op would not rewrite.
    const doc = '"<verse@8 [verse chorus]@4>".pickRestart({verse: s("bd"), chorus: s("hh")})'
    const ctl = detectPickControlAt(doc, CTRL_POS)!
    expect(renameSection(doc, ctl, 0, 'intro')).toEqual([])
    expect(countSectionArms(doc, ctl, 0)).toBe(0)
  })

  it('is not fooled by a LONGER name that merely starts with this one', () => {
    const doc = '"<verse@8 verse2@4>".pickRestart({verse: s("bd"), verse2: s("hh")})'
    const ctl = detectPickControlAt(doc, CTRL_POS)!
    expect(apply(doc, renameSection(doc, ctl, 0, 'intro'))).toBe(
      '"<intro@8 verse2@4>".pickRestart({intro: s("bd"), verse2: s("hh")})',
    )
  })

  it('DECLINES `__proto__` — it sets a prototype, it does not make a key', () => {
    const ctl = detectPickControlAt(SONG, CTRL_POS)!
    expect(renameSection(SONG, ctl, 1, '__proto__')).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// #1461 — INSERT SILENCE, the pick spelling. Must stay equivalent to the
// arrange one: a keypress means one thing whichever way the song is written.
// ---------------------------------------------------------------------------
describe('insertSilenceArm (#1461)', () => {
  const ctl = () => detectPickControlAt(SONG, CTRL_POS)!

  it('adds an empty section AFTER the selected one, at its width', () => {
    expect(apply(SONG, insertSilenceArm(SONG, ctl(), 1))).toBe(
      '"<~@2 verse@2 ~@2 chorus@2>".pickRestart({verse: s("bd"), chorus: s("hh")})',
    )
  })

  it('adds at the END when the last section is selected', () => {
    expect(apply(SONG, insertSilenceArm(SONG, ctl(), 2))).toBe(
      '"<~@2 verse@2 chorus@2 ~@2>".pickRestart({verse: s("bd"), chorus: s("hh")})',
    )
  })

  it('writes a BARE rest when the section carries no explicit width', () => {
    // No `@` means an implicit 1, and there is no literal to copy — so the new
    // arm looks like its siblings rather than carrying an invented `@1`.
    const bare = '"<verse chorus>".pickRestart({verse: s("bd"), chorus: s("hh")})'
    expect(apply(bare, insertSilenceArm(bare, detectPickControlAt(bare, 5)!, 0))).toBe(
      '"<verse ~ chorus>".pickRestart({verse: s("bd"), chorus: s("hh")})',
    )
  })

  it('adds NO object entry — a rest is grammar, not a name to resolve', () => {
    // The section object must come back exactly as the user wrote it; inventing
    // a key would put a pattern in the document that nobody asked for.
    const out = apply(SONG, insertSilenceArm(SONG, ctl(), 1))
    expect(out).toContain('{verse: s("bd"), chorus: s("hh")}')
  })

  it('declines for an arm that names nothing', () => {
    expect(insertSilenceArm(SONG, ctl(), 9)).toEqual([])
    expect(insertSilenceArm(SONG, ctl(), -1)).toEqual([])
  })

  it('leaves a control that still reads back, one section longer', () => {
    const out = apply(SONG, insertSilenceArm(SONG, ctl(), 1))
    const reparsed = detectPickControlAt(out, CTRL_POS)
    expect(reparsed).not.toBeNull()
    expect(reparsed!.arms).toHaveLength(4)
  })
})

describe('setArmHead — point a section at a different part (#1560)', () => {
  const ctl = () => detectPickControlAt(SONG, CTRL_POS)!

  it('rewrites ONLY the clicked arm, keeping its weight', () => {
    expect(apply(SONG, setArmHead(SONG, ctl(), 1, 'chorus'))).toBe(
      '"<~@2 chorus@2 chorus@2>".pickRestart({verse: s("bd"), chorus: s("hh")})',
    )
  })

  it('leaves a returning section alone — this is not the rename', () => {
    // Arms 1 and 2 both name a section; pointing arm 2 elsewhere must not touch
    // arm 1. The rename is the op where one name necessarily moves every arm.
    expect(apply(SONG, setArmHead(SONG, ctl(), 2, 'verse'))).toBe(
      '"<~@2 verse@2 verse@2>".pickRestart({verse: s("bd"), chorus: s("hh")})',
    )
  })

  it('points a REST at a real section, which is how a gap is refilled', () => {
    expect(apply(SONG, setArmHead(SONG, ctl(), 0, 'verse'))).toBe(
      '"<verse@2 verse@2 chorus@2>".pickRestart({verse: s("bd"), chorus: s("hh")})',
    )
  })

  it('leaves the section object byte-verbatim while the SELECTOR moves', () => {
    // ⚠ The verbatim half alone passes on an op that writes nothing, so the
    // selector half is what makes this arm say anything.
    const out = apply(SONG, setArmHead(SONG, ctl(), 1, 'chorus'))
    expect(out.slice(out.indexOf('.pickRestart'))).toBe(
      '.pickRestart({verse: s("bd"), chorus: s("hh")})',
    )
    expect(out.slice(0, out.indexOf('.pickRestart'))).toBe('"<~@2 chorus@2 chorus@2>"')
  })

  it('declines a key this call does not define', () => {
    // ⚠ The decline that matters most: a head naming no key is not an error the
    // user can see — it is a section that silently plays nothing.
    expect(setArmHead(SONG, ctl(), 1, 'bridge')).toEqual([])
  })

  it('declines a key the selector cannot spell', () => {
    const quoted = '"<a@2 b@2>".pickRestart({"my part": s("bd"), a: s("hh"), b: s("cp")})'
    const c = detectPickControlAt(quoted, 5)!
    expect(setArmHead(quoted, c, 0, 'my part')).toEqual([])
  })

  it('declines the part the section already plays', () => {
    expect(setArmHead(SONG, ctl(), 1, 'verse')).toEqual([])
  })

  it('declines an arm that names nothing', () => {
    expect(setArmHead(SONG, ctl(), 9, 'verse')).toEqual([])
    expect(setArmHead(SONG, ctl(), -1, 'verse')).toEqual([])
  })

  it('re-detects with the arm now naming the other section', () => {
    const out = apply(SONG, setArmHead(SONG, ctl(), 1, 'chorus'))
    const after = detectPickControlAt(out, CTRL_POS)!
    expect(after.arms).toHaveLength(3)
    expect(out.slice(after.arms[1].headRange[0], after.arms[1].headRange[1])).toBe('chorus')
    expect(after.arms[1].weight).toBe(2)
  })
})

describe('listSectionParts — what a pick section may be pointed at (#1560)', () => {
  it('lists the call\'s own sections, in object order', () => {
    expect(listSectionParts(detectPickControlAt(SONG, CTRL_POS)!)).toEqual(['verse', 'chorus'])
  })

  it('offers exactly what setArmHead accepts — no name it would decline', () => {
    // ⚠ The list and the op share one predicate for this reason: a chooser that
    // offers a name the write refuses declines silently after the user picked it.
    const quoted = '"<a@2 b@2>".pickRestart({"my part": s("bd"), a: s("hh"), b: s("cp")})'
    const c = detectPickControlAt(quoted, 5)!
    const parts = listSectionParts(c)
    expect(parts).toEqual(['a', 'b'])
    for (const name of parts) {
      if (name === 'a') continue
      expect(setArmHead(quoted, c, 0, name).length).toBeGreaterThan(0)
    }
  })

  it('offers nothing when the call names nothing — the array form', () => {
    const arr = '"<0@2 1@2>".pickRestart([s("bd"), s("hh")])'
    const c = detectPickControlAt(arr, 5)
    expect(c ? listSectionParts(c) : []).toEqual([])
  })
})
