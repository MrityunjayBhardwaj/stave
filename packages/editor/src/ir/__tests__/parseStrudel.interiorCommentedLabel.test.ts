/**
 * A commented-out label INSIDE a live chain is a fragment of that chain, not a
 * track (#1476 — the second half of #1475).
 *
 * #1475 taught the label scan to read a commented label's TEXT: prose is not a
 * track, code-like text is. That is the right question for a line standing on
 * its own, and the wrong one here:
 *
 * ```js
 * $: note("[C G]")
 *   .roomsize("10")
 *
 *   // $: note("F")
 *   //   .sound("piano")
 *
 * .slow(".1275").gain(.8)
 * ```
 *
 * The `// $: note("F")` reads as code because it IS code — a commented-out
 * alternative the author parked inside the open chain of the track above. What
 * disqualifies it is its POSITION.
 *
 * ⚠ THE DAMAGE IS TO THE TRACK ABOVE, NOT TO THE GHOST ROW. A label match also
 * sets the END of the preceding entry, so admitting an interior label truncates
 * the live track at the comment. Its `.slow(".1275").gain(.8)` tail is dropped
 * — silently, with a plausible tree still produced. `0/2NQuAYDvjagj` is the
 * extreme case in the archive: two of its four tracks kept 19 bytes of a
 * 456-byte chain, losing `.scale`, `.sound("piano")`, `.delay`, `.room` and
 * `.gain(2)` each, and gained two phantom rows for the trouble.
 *
 * The rule delegates rather than deciding a second way: `splitTopLevelStatements`
 * already computes top-level statement extents, and a label strictly inside one
 * is interior to it. That is also why #1384's pin survives untouched — a
 * document that is nothing but a commented label yields NO statements, so the
 * label is interior to nothing and keeps its own name rather than renaming
 * itself to `d1`.
 *
 * Measured over the 558-document archive: 44 documents admit a commented label,
 * 5 of them admit one that is interior. After the rule, 0 are interior and 40
 * still admit a commented label — the boundary cases are untouched.
 *
 * ⚠ BOTH PARSERS OR NEITHER. `extractTracks` is shared by `parseStrudel` and
 * `parseStrudelStages`' RAW stage, which is why the fix lives here: a one-sided
 * change would show up as a PARITY failure rather than a shape one, and the
 * shape would look right in whichever half you inspected.
 */
import { describe, it, expect } from 'vitest'
import { extractTracks, parseStrudel } from '../parseStrudel'
import { runRawStage } from '../parseStrudelStages'
import { IR } from '../PatternIR'
import { pipeline } from './helpers/stagesParity'

/** The archive shape, reduced to its load-bearing bytes. */
const INTERIOR = [
  '$: note("[C G]")',
  '  .roomsize("10")',
  '',
  '  // $: note("F")',
  '  //   .sound("piano")',
  '',
  '.slow(".1275").gain(.8)',
].join('\n')

describe('#1476 — a commented label inside a chain is not a track', () => {
  it('does not admit the interior label', () => {
    const tracks = extractTracks(INTERIOR)
    expect(tracks).toHaveLength(1)
    expect(tracks[0].commented).toBe(false)
  })

  it('leaves the live track above it whole — the tail survives', () => {
    const [live] = extractTracks(INTERIOR)
    expect(live.expr).toContain('.roomsize("10")')
    expect(live.expr).toContain('.slow(".1275").gain(.8)')
    // `end` runs to the end of the document, not to the comment block.
    expect(live.end).toBe(INTERIOR.length)
  })

  it('truncation is the damage even when the ghost body is empty', () => {
    // The minimal form: one line of chain, a commented label, then the rest of
    // the chain. Without the rule the live track keeps only its first line.
    const src = '$: n("<1 3 5>")\n// $: n("<1 3 7>")\n  .scale("C:major")\n  .sound("piano")'
    const tracks = extractTracks(src)
    expect(tracks).toHaveLength(1)
    expect(tracks[0].expr).toContain('.sound("piano")')
  })

  it('a commented label at a statement BOUNDARY is still a track (#1384/#671)', () => {
    const src = '$: s("bd")\n// $: s("hh")\n$: s("cp")'
    const tracks = extractTracks(src)
    expect(tracks).toHaveLength(3)
    expect(tracks.map((t) => t.commented)).toEqual([false, true, false])
  })

  it('a document that is only a commented label keeps it — interior to nothing', () => {
    const tracks = extractTracks('// PR: s("bd")')
    expect(tracks).toHaveLength(1)
    expect(tracks[0].commented).toBe(true)
    expect(tracks[0].label).toBe('PR')
  })

  it('a named commented label interior to a chain is rejected too', () => {
    const src = '$: s("bd")\n  // PR: s("hh")\n  .gain(.5)'
    const tracks = extractTracks(src)
    expect(tracks).toHaveLength(1)
    expect(tracks[0].label).toBe('$')
    expect(tracks[0].expr).toContain('.gain(.5)')
  })

  it('the staged pipeline agrees — extractTracks is the shared seam', () => {
    // RAW is where extractTracks is consumed on the staged side. One track,
    // carrying the tail, exactly as `parseStrudel` sees it.
    const raw = JSON.stringify(runRawStage(IR.code(INTERIOR)))
    expect(raw).toContain('.slow(\\".1275\\")')
    // RAW lifts each track to a `Code` carrying its label and `$:` extent; one
    // track means one `trackLabel`, and its extent runs to the end of the file
    // rather than stopping at the comment block.
    expect((raw.match(/"trackLabel"/g) ?? []).length).toBe(1)
    expect(raw).toContain(`"dollarEnd":${INTERIOR.length}`)
  })

  it('and the two remain byte-identical on this document', () => {
    // The contract `parseStrudelStages.ts:6` states. ⚠ THIS ARM CANNOT FLIP ON
    // A TWO-SIDED CHANGE and does not cover the rule — break-tested: with the
    // interior check disabled, 5 of the 8 arms here go red and this one stays
    // green, because both parsers read the same `extractTracks` and move
    // together. It guards the OTHER failure: a future fix applied to one path
    // only, which shows up as a parity difference rather than a wrong shape.
    expect(pipeline(INTERIOR)).toEqual(parseStrudel(INTERIOR))
  })
})
