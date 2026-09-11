/**
 * The `songExtent` census over the real saved corpus — the pin that says what
 * fraction of real documents a "whole arrangement" bounce can actually serve
 * (#1359).
 *
 * WHY A CENSUS AND NOT ONLY UNIT TESTS. The unit tests next door pin the walk's
 * SEMANTICS against synthetic IR. They cannot say whether those semantics reach
 * anything real, and the number that decides the feature's shape is exactly
 * that: measured here, 2 documents in 150 yield a trustworthy arrangement
 * extent. A change that quietly widened `arranged` — dropping the opaque taint,
 * say — would keep every unit test green while handing documents a confident
 * length a bounce would truncate to. This arm is what notices.
 *
 * ⚠ THE CORPUS IS SAVED LIVE-CODING SKETCHES, NOT STAVE SONGS. It skews hard to
 * loops because arrangements of the kind the full-song work is about mostly do
 * not exist out there yet. So `loop: 142` is a fact about what people write
 * TODAY, not a ceiling on the feature — read it as "the loop case cannot be the
 * unsupported half", never as "arrangements do not matter".
 *
 * ## WHY THIS PIN NAMES DOCUMENTS AND NOT ONLY COUNTS (#1469)
 *
 * It used to pin three integers. It drifted by three documents, in TWO steps
 * from TWO different modules, and the counts could say neither which documents
 * nor which module — so the drift was attributed entirely to the nearer of the
 * two changes and the third mover went unnoticed until it was measured.
 *
 * Reproduced by loading the old `songExtent` and the old `parseStrudel` beside
 * the current ones, in one run, over the byte-identical corpus:
 *
 * | mover | verdict | what moved it |
 * |---|---|---|
 * | `250/19FzyPQc7bcR` | loop → opaque | `songExtent` learning the weighted `NamedPick` (#1427) |
 * | `500/3Xv8ssjN67qW` | loop → opaque | the same |
 * | `500/3Y6Nw-c4WlmA` | loop → opaque | a `parseStrudel` change — the walk is unchanged for it |
 *
 * The last one is the point. **A census over parsed documents is a pin on the
 * PARSER as much as on the walk**, and nothing said so. `#1481`'s `Range` arm,
 * by contrast, moved nothing at all here.
 *
 * ⚠ AND ITS DIRECTION IS THE PROOF IT IS A SHARPENING AND NOT A REGRESSION. The
 * document moved loop → opaque, which means an arrangement became FOUND where
 * none was found before — only a parser that reads MORE can do that. A parser
 * that had started reading LESS would wrap the arrangement in a `Code` it could
 * not see past, and the document would have moved the other way. So the exact
 * commit among the fourteen need not be bisected to know the verdict is right.
 *
 * So the sets are named. A future drift fails with the document in the message,
 * and the two-line question "which module, and is the new verdict right?" is
 * answerable from the failure instead of from archaeology.
 *
 * ## WHY EVERY `opaque` DOCUMENT IS CORRECTLY OPAQUE, MEASURED 2026-09-11
 *
 * `opaque` means "an arrangement is here but something unread sits above it".
 * The tempting reading is that the taint is over-eager. It is not: each of the
 * six is tainted by a method the parser genuinely cannot read, and several of
 * those provably move time.
 *
 * | document | the unread method(s) above its arrangement |
 * |---|---|
 * | `0/-KLGNJUtyyj1`   | `.pianoroll(…)`, **`.cpm(55)`** |
 * | `250/19FzyPQc7bcR` | `.when("<0!10 1!2>", x=>x.ply(2))` |
 * | `250/19iySfKDfQK5` | `.pianoroll()`, **`.echo(3, 28/64, …)`**, `.note()` |
 * | `500/3HWHF_ZUbZD_` | `.dough()` |
 * | `500/3Xv8ssjN67qW` | `.when("<0!10 1!2>", x=>x.ply(2))` |
 * | `500/3Y6Nw-c4WlmA` | `.add(room(.25))`, `.mask4(…)`, `.warble()`, `.voicing()`, `.chord()` |
 *
 * `.cpm` sets tempo and `.echo` adds delayed repeats — for those two the extent
 * really is untrustworthy, not merely unproven. ⚠ And note what does NOT help:
 * `.pianoroll()` is a visualiser and provably moves nothing, but both documents
 * carrying it also carry a real transform, so exempting visualisers would move
 * no document out of `opaque`. **The road from `opaque` to `arranged` runs
 * through the parser learning these methods, not through relaxing the taint** —
 * which is the bias `songExtent`'s header already commits to.
 */
import { describe, it, expect } from 'vitest'
import { hasCorpusArchive, loadCorpus } from './songPeriodSweep'
import { CORPUS_RESTORE_HINT } from '../../../editor/src/visualEdit/miniSource/__tests__/evalHarness'
import { parseStrudel } from '../../../editor/src/ir/parseStrudel'
import { songExtent } from '../../../editor/src/ir/songExtent'

/**
 * ⚠ A SKIP THAT MEANS "THIS MACHINE CANNOT RUN IT" READS EXACTLY LIKE A PASS.
 *
 * That is how #1427's two movers sat red from 2026-09-06 to 2026-09-11: the arm
 * is gated on a gitignored archive, so it skipped in CI and on every fresh
 * clone, and the only machine that could see the red was one nobody watched. The
 * gate cannot be removed — the archive is unreviewed third-party tunes — so the
 * silence is what gets removed instead, and the message carries the way to make
 * the arm runnable rather than merely noting that it did not run.
 */
if (!hasCorpusArchive()) {
  console.warn(
    `[song-extent-census] NOT RUN — the corpus archive is not on this machine, so the\n` +
      `arranged/loop/opaque pin was neither checked nor refuted here.\n${CORPUS_RESTORE_HINT}`,
  )
}

/** The two documents with a trustworthy extent, and what it measures as. */
const ARRANGED = ['0/-HyFCSbuSlq5=274', '0/-P5TIfAEmiGv=32']

/** Every document holding an arrangement Stave cannot measure — see the header. */
const OPAQUE = [
  '0/-KLGNJUtyyj1',
  '250/19FzyPQc7bcR',
  '250/19iySfKDfQK5',
  '500/3HWHF_ZUbZD_',
  '500/3Xv8ssjN67qW',
  '500/3Y6Nw-c4WlmA',
]

describe('songExtent over the real corpus', () => {
  it.skipIf(!hasCorpusArchive())('pins the arranged / loop / opaque split', async () => {
    const docs = await loadCorpus()
    const tally: Record<string, number> = { arranged: 0, loop: 0, opaque: 0 }
    const arranged: string[] = []
    const opaque: string[] = []
    for (const d of docs) {
      let ir = null
      try {
        ir = parseStrudel(d.code)
      } catch {
        continue
      }
      const e = songExtent(ir)
      tally[e.kind] += 1
      if (e.kind === 'arranged') arranged.push(`${d.name}=${e.cycles}`)
      if (e.kind === 'opaque') opaque.push(d.name)
    }

    // 150 documents, all of which parse.
    expect(tally.arranged + tally.loop + tally.opaque).toBe(docs.length)

    // NAMES FIRST, COUNTS SECOND — deliberately. Both are asserted, but the
    // named sets are what a failure reads out, and a count that moves without a
    // name moving would mean the corpus itself had changed rather than a
    // classification, which is a different bug with a different fix.
    expect(arranged.sort()).toEqual(ARRANGED)
    expect(opaque.sort()).toEqual([...OPAQUE].sort())
    expect(tally).toEqual({ arranged: 2, loop: 142, opaque: 6 })

    // ⚠ One of the two (274) runs PAST the 256-cycle horizon cap that
    // `SongAnalysis.displaySpan` stops at — which is precisely why a bounce
    // cannot read the display span. Asserted off the measured value, not off a
    // literal, so it still means something if the corpus moves.
    const longest = Math.max(...arranged.map((a) => Number(a.split('=')[1])))
    expect(longest).toBeGreaterThan(256)
  })
})
