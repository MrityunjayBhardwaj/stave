/**
 * The corpus gate's failure MESSAGE is a deliverable, and it is tested as one
 * (#1525).
 *
 * When `stagesParityCorpus` goes red, the message it prints is the whole
 * product — it names the document, the direction, and what moved, so that the
 * reader does not have to re-derive the comparison by hand. That is the cost
 * the per-document pin was built to remove.
 *
 * ⚠ THE MESSAGE HAD A HOLE EXACTLY WHERE IT COULD LEAST AFFORD ONE. The
 * enumeration rendered each side with `displayShape`, and one divergence class
 * — `C-via-vs-blob` — is by definition a difference shape cannot show: both
 * sides are a `Code` node, differing in whether `via` carries the parsed chain
 * or the node is the parse's give-up fallback. So a real regression printed
 *
 *     250/1qReIiYTCTb-  Track→[Code]  !=  Track→[Code]
 *
 * two identical strings joined by `!=`, and a reader's first conclusion is that
 * the instrument is broken. `cls` and `at` were already measured and on the
 * row; the enumeration dropped them.
 *
 * ⚠⚠ AND THAT IS THE ONE CLASS A REAL REGRESSION REFILLS — it is pinned at 0.
 * The uninformative rendering was reserved for precisely the case that has to be
 * read on sight, by someone who did not write it, on the day it goes red.
 *
 * ## Why this is a unit test and not only a break test
 *
 * It was FOUND by break-testing (revert the #1514 numeric-map thread in
 * `parseStrudelStages` and read what the gate prints — it reproduces the exact
 * document and class above). A break test proves the message once, on the day
 * someone remembers to run it. Since the fix is pure formatting over fields
 * already on the row, the message can be asserted off a plain object on every
 * run instead — so the next person to widen `displayShape`'s blind spot finds
 * out here rather than on a Monday.
 */
import { describe, it, expect } from 'vitest'
import {
  divergenceDetail,
  shapesEqualWarning,
  type ParityRow,
} from './helpers/stagesParity'

/** The real row from the break test, verbatim. */
const VIA_VS_BLOB: ParityRow = {
  match: false,
  shapeMatch: true,
  tagMatch: true,
  direct: 'Track→[Code]',
  staged: 'Track→[Code]',
  cls: 'C-via-vs-blob',
  at: '$.body',
}

/** A divergence shape DOES show — the ordinary case. */
const STRUCTURAL: ParityRow = {
  match: false,
  shapeMatch: false,
  tagMatch: false,
  direct: 'Track→[Param:gain→[Stack]]',
  staged: 'Stack→[Track, Track]',
  cls: 'B-track-count',
  at: '$.body',
}

describe('#1525 — the parity gate reports what moved, not just that something did', () => {
  it('carries the class and the path that parityRow already measured', () => {
    expect(divergenceDetail(VIA_VS_BLOB)).toBe('  (C-via-vs-blob at $.body)')
    expect(divergenceDetail(STRUCTURAL)).toBe('  (B-track-count at $.body)')
  })

  it('names the shapes-equal case instead of letting it look like a broken instrument', () => {
    const warning = shapesEqualWarning(VIA_VS_BLOB)
    expect(warning).toContain('SHAPES RENDER EQUAL')
    expect(warning).toContain('NOT structural')
    // The reader is pointed at the thing that DOES carry the answer.
    expect(warning).toContain('class in brackets')
  })

  it('stays silent when the shapes differ — a warning on every row is skipped', () => {
    expect(shapesEqualWarning(STRUCTURAL)).toBe('')
  })

  it('the assembled line is actionable for the class that renders identically', () => {
    // Exactly how the REGRESSED enumeration composes it.
    const line =
      `  250/1qReIiYTCTb-  ${VIA_VS_BLOB.direct}  !=  ${VIA_VS_BLOB.staged}` +
      `${divergenceDetail(VIA_VS_BLOB)}${shapesEqualWarning(VIA_VS_BLOB)}`
    expect(line).toContain('250/1qReIiYTCTb-')
    expect(line).toContain('C-via-vs-blob')
    // ⚠ The `X != X` rendering is NOT removed — it is still the truthful output
    // of `displayShape`, and hiding it would be a second lie. What changes is
    // that it is now explained.
    expect(line).toContain('Track→[Code]  !=  Track→[Code]')
    expect(line).toContain('SHAPES RENDER EQUAL')
  })

  it('degrades cleanly on a row carrying neither field (a THREW row)', () => {
    const threw: ParityRow = {
      match: false, shapeMatch: false, tagMatch: false,
      direct: 'THREW: boom', staged: '—',
    }
    expect(divergenceDetail(threw)).toBe('')
    expect(shapesEqualWarning(threw)).toBe('')
  })
})
