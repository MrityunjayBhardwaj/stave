/**
 * stagesParityCorpus — THE PINNED BASELINE for staged-pipeline parity with
 * `parseStrudel`, per document, over the 150 real tunes (#1375).
 *
 * ── THE CONTRACT, AND WHY IT NEEDED A WIDER GATE ─────────────────────────────
 * `parseStrudelStages.ts:6` states it plainly:
 *
 *   "End-to-end behavior at FINAL is byte-identical to parseStrudel(code)."
 *
 * The D-06 sentinel in `parseStrudelStages.test.ts` asserts exactly that — over
 * 13 hand-written fixtures. Of those 13, **0 contain a `const` or `let`** and
 * **0 contain `arrange(` / `cat(` / `slowcat(`**.
 *
 * ── THREE NUMBERS, AND WHY THE ISSUE'S 17 IS THE SMALLEST ────────────────────
 * Measured over the 150-tune corpus, "diverges" has three defensible readings.
 * They were 44 / 26 / 17 when first pinned, a 2.6× spread over one corpus:
 *
 *    3  deep equality      — the stated contract, and what D-06 asserts
 *    3  full shape tree    — the two sides disagree on structure anywhere
 *    2  top-level tag only — they disagree at the FIRST node inside Track
 *
 * Four fixes since, each scored against the class it claimed:
 *   #1376  ported the multi-statement track split to RAW  → 44 → 39, B 8 → 3
 *   #1375  resolved top-level bindings at MINI-EXPANDED   → 39 → 20, A 18 → 9,
 *          C 16 → 6, and B UNCHANGED at 3 exactly as predicted
 *   #1383  discriminated a structured `Code` wrapper from  → 20 → 5, A 9 → 0
 *          the parse's give-up fallback                        C 6 → 0
 *   #1384  kept a COMMENTED track's label and range        →  5 → 3, D 2 → 0
 *   #1553  stopped CHAIN-APPLIED dropping a chain applied  →  9 → 0, B 9 → 0,
 *          over a comma pattern, and moved the comma-arm         tag 6 → 0
 *          lane split out of the parser into the lane layer
 *
 * ⚠ THERE ARE NO SURVIVORS. The contract holds on every document in the
 * archive — not "every document where it is meant to", which is the weaker
 * claim this line used to make and which is what let a real defect live inside
 * a deliberate-looking exception.
 *
 * ⚠⚠ THAT SENTENCE WAS ALSO TRUE OF THE NINE, AND IT WAS WRONG ABOUT SIX OF
 * THEM. Between #1524's widening and #1553 this class held 9, described here
 * as deliberate by design; 6 were a chain being deleted at CHAIN-APPLIED —
 * `sound`, `gain`, `room`, `lpf` gone, one document down from 66 notes to 7 —
 * and they sat inside this green gate for exactly as long as the sentence went
 * unchecked. The claim is only worth what its most recent MECHANISM check is
 * worth, so when this class next grows, re-earn it: for each new member ask
 * whether any method survived the staged parse, which is the question that
 * separates a re-parenting from a deletion. The shape signature cannot.
 *
 * #1375's body quotes 17, measured before #1376 landed. That reading is the
 * weakest of the three: it counts a document only when the very top node
 * changed, so a document whose structure is wrong three levels down does not
 * appear in it at all. The contract the file actually states is byte-identity,
 * and by that measure **0 of 558** now diverge. Every row is still pinned
 * INCLUDING the matching ones, so no fix can improve one while quietly
 * worsening another, and no document can leave the sweep unnoticed.
 *
 * A gate is only as wide as its fixture list. This is the third bug of the class
 * — #113 (a prelude lifted as opaque Code → empty timeline), #671 (labelled
 * tracks losing their labels), #1373 (`arrange()` behind consts → a 3:28 song
 * bounced at 0:08) — each found through a downstream consumer degrading quietly,
 * each closed by adding one more fixture. This file replaces that loop with a
 * number that cannot drift unnoticed.
 *
 * ── WHY A PER-DOCUMENT PIN, AND NOT JUST THE COUNTS ──────────────────────────
 * A count is the wrong instrument: fixing three binding cases while breaking
 * three others reports 17 and looks like a no-op. Two entirely different sets of
 * documents produce the same headline. Every document's verdict is therefore
 * pinned individually, and the failure message IS the enumeration — which
 * documents moved, and which direction.
 *
 * The 150 rows are pinned INCLUDING the matching ones, deliberately. If only
 * divergences were pinned, a document dropping out of the sweep entirely would
 * shrink the denominator in silence and read as progress.
 *
 * A parse that THROWS is recorded as a divergence carrying its error, never
 * skipped, for the same reason.
 *
 * ── WHAT THEY ARE, as of this pin ────────────────────────────────────────────
 * The mechanisms are classified per document (see `classifyDivergence`). The
 * `A-opaque-collapse` and `C-via-vs-blob` classes are now EMPTY: measuring all
 * 20 residual documents showed those two were never two mechanisms. Both were
 * `parseRootWithChainMeta` discarding a `Code` node that carried a structured
 * `via`, and the classifier split them only by whether the difference surfaced
 * first as a changed tag (A) or a changed field (C). One predicate emptied
 * both — 15 documents, no regressions (#1383).
 *
 * ⚠ That is worth remembering when reading the classes below: a class boundary
 * can itself carry an unverified claim about mechanism. The counts here are
 * measured; the names are a hypothesis about what groups them.
 *
 * `D-metadata` is empty too. Both its documents were a COMMENTED track losing
 * its label and its `$:`-line range at this stage's empty-code guard, which
 * returned before reading the metadata RAW had threaded through — so a track
 * named `PR` renamed itself to `d1` the moment it was commented out (#1384).
 *
 * `B-track-count` is empty as of #1553, and HOW it emptied is the part worth
 * keeping. This paragraph used to say its documents were "not a bug to be fixed
 * by making the staged path match `parseStrudel`" — that they were #950's
 * deliberate per-arm lanes, so the contract was false BY DESIGN and reconciling
 * it was "a decision about #950, not a defect to patch here".
 *
 * The lanes were real; the conclusion was not. Expanding a comma into separate
 * `Track` lanes was the PARSER doing presentation's job, and it silently cost
 * the chain applied to the stack. Moving the per-arm derivation to the lane
 * layer kept every lane and took the divergence to zero — so the trade this
 * paragraph accepted as necessary never had to be made. When a divergence is
 * defended as the price of a feature, check first whether the feature is being
 * produced in the right place.
 *
 * ⚠ The `Stack→Seq` and `Param→Stack` rows deserve more alarm than the
 * `→Code` ones. An opaque blob is visibly nothing and fails loudly downstream;
 * a DIFFERENT structure looks right and is consumed as though it were correct.
 *
 * ── HOW TO RE-BASELINE, deliberately awkward ─────────────────────────────────
 *   UPDATE_STAGES_PARITY_BASELINE=1 pnpm --filter @stave/editor exec vitest run \
 *     src/ir/__tests__/stagesParityCorpus.test.ts
 * Then READ THE DIFF and enumerate the movers in the PR. The whole point of this
 * file is that the number moves for a stated reason; re-baselining without
 * reading the diff restores the blindness it was written to remove.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  hasCorpusArchive,
  loadEveryCorpusDocument,
  CORPUS_RESTORE_HINT,
} from '../../visualEdit/miniSource/__tests__/evalHarness'
import {
  parityRow,
  divergenceDetail,
  shapesEqualWarning,
  type ParityRow,
} from './helpers/stagesParity'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const BASELINE = path.join(HERE, 'STAGES-PARITY-BASELINE.json')

/**
 * Every document in the archive, deduped by sha256 of its `code` field.
 * Pinned so a short read fails loudly (#1524).
 *
 * ⚠ WAS 150 — which was 3 of the archive's input files, and 142 distinct
 * documents once six repeated groups are collapsed. The gate it fed missed the
 * fourth-through-seventh bug of the very class it exists to catch, not because
 * it was weak but because the document that exhibited it was never in its
 * slice: expression arm weights appeared 0 times in those 3 files and once in
 * the archive. **State a gate's population with its denominator; a gate whose
 * population is a frozen slice is a fixture list with more rows.**
 */
const CORPUS_SIZE = 558

/**
 * TWO headline numbers, because the contract and the damage are different
 * questions — see `ParityRow`.
 *
 * ⚠ #1375's body quotes 17. That is the SHAPE number, and it was measured
 * before #1376 landed. Measured deeply — which is what
 * `parseStrudelStages.ts:6` actually promises and what the D-06 sentinel
 * asserts with `toEqual` — the corpus diverged on 44 at the first pin and on
 * 3 now. All three are pinned so none can drift, and so that a fix which
 * improves one while worsening another cannot report success.
 */
// #1524 — 3 / 3 / 2 over 150 rows became 9 / 9 / 6 over 558 documents when the
// population was widened from 3 archive files to all of them. ⚠ READ THAT AS A
// RATE, NOT A REGRESSION: 2.0% of 150 rows diverged before, 1.6% of 558 now.
//
// ⚠⚠ AND THE CLAIM MADE HERE AT THAT WIDENING — that "every one of the 6
// newly-visible documents is the SAME class as the 3 that were already pinned"
// — WAS WRONG, which is the part worth keeping. The 6 shared the 3's shape
// SIGNATURE (`parseStrudel` keeps one `Track→…`, the staged path lifts each
// comma arm to its own `Stack→[Track→…]`) and were checked against exactly
// that. They did not share its mechanism. The 3 are the deliberate lane split;
// the 6 were `runChainAppliedStage` DROPPING the whole chain, so `.sound()`,
// `.gain()`, `.room()` and `.lpf()` ceased to exist and one document kept 7 of
// its 66 notes (#1553). Both produce "more tracks on the staged side", and the
// signature cannot tell a re-parenting from a deletion.
//
// The lesson is about the instrument, not the arithmetic: a class whose
// membership test is a SHAPE will absorb any defect that happens to deform the
// shape the same way, and pinning it then holds the defect in place with the
// full authority of a green gate. `classifyDivergence` groups by shape; the
// names are still a hypothesis about mechanism (as the note below already
// warned) and 6 of 9 members falsified it. When a class grows, check the new
// members against the MECHANISM — here, "did any method survive?" — and not
// only against the signature that put them in the bucket.
//
// 9 / 9 / 6 → 0 / 0 / 0 with #1553 fixed. The staged pipeline is byte-identical
// to `parseStrudel` on every document in the archive — the contract
// `parseStrudelStages.ts:6` has stated since #1375, met in full for the first
// time. 6 of the 9 were the dropped chains; the other 3 were the comma-arm lane
// split, which is no longer a DIVERGENCE because it is no longer done by the
// parser at all: the parse states the source's shape and the per-arm lanes are
// derived in the lane layer (`rootStackArms`). The lanes are unchanged — what
// changed is that producing them no longer requires the two parsers to disagree.
//
// ⚠ ZERO IS A STRONGER PIN THAN ANY OTHER NUMBER, SO GUARD IT AS ONE. A future
// divergence cannot now hide inside an existing allowance; it has to move this
// literal off 0, and the per-document report names it. Do not re-baseline a
// non-zero number here without writing down which document and which mechanism.
const DEEP_DIVERGENCE = 0
const SHAPE_DIVERGENCE = 0
const TAG_DIVERGENCE = 0

/**
 * The measured mechanisms behind what remains — see `classifyDivergence`.
 * Pinned per class so a fix is scored against the mechanism it claims to
 * address, instead of against one total that three different changes could
 * move by the same amount.
 *
 * A class that reaches 0 STAYS IN THIS MAP AS 0. Dropping the key would let
 * the class come back without the literal moving, which is the drift this
 * whole file exists to prevent.
 *
 * ⚠ THIS FILE USED TO CARRY A STANDING EXCUSE, AND THE EXCUSE IS THE LESSON.
 * It read: the survivors are #950's deliberate comma-arm lane split, matching
 * `parseStrudel` on them would REVERT #950, so the number is "a floor, not a
 * backlog". That was measured against 3 documents. It then stayed on the page
 * unaltered while #1524's widening took the class to 9 — vouching for 6
 * documents it had never been measured against, every one of them a real loss
 * (#1553). A sentence that explains away a number has to be re-earned every
 * time the number moves, or it becomes a place for defects to live.
 *
 * It turned out the premise was wrong too: matching `parseStrudel` did NOT
 * require reverting #950. The lane split was never the parser's to make, and
 * once it moved to the lane layer the lanes survived and the divergence went to
 * zero. "We must diverge in order to keep X" deserves the same suspicion —
 * check whether X is being kept in the right place before accepting the cost.
 */
const BY_CLASS: Record<string, number> = {
  'A-opaque-collapse': 0,
  'C-via-vs-blob': 0,
  // #1524 — 3 → 9 purely by looking at 416 documents the gate had never read.
  // ⚠ The label was not taken on trust: every one of the 9 was checked against
  // the MECHANISM rather than the classifier, by its shape signature
  // (`parseStrudel` keeps one `Track→…`, the staged path lifts each comma arm
  // to its own `Stack→[Track→…]`). Control: 364 documents carry a comma inside
  // a string and match anyway, so the signature is not just "has a comma".
  // #1553 — 9 → 0, and the class is now empty for TWO different reasons, which
  // is worth keeping straight. 6 members were never this mechanism at all: a
  // chain dropped wholesale at CHAIN-APPLIED, wearing this class's shape
  // signature. The remaining 3 were the real comma-arm lane split — and they
  // left not because the lanes changed but because the parser stopped being the
  // thing that produced them. Same lanes, derived in the lane layer, so the two
  // parsers no longer have to disagree to draw them.
  'B-track-count': 0,
  'D-metadata': 0,
}

describe('staged pipeline vs parseStrudel — corpus parity baseline (#1375)', () => {
  // `.bakery-runs/` is gitignored — unreviewed third-party tunes (#1307). On a
  // machine without it this SKIPS rather than dying on an ENOENT naming a path
  // git refuses to track. `CORPUS_RESTORE_HINT` says how to rebuild it.
  it.skipIf(!hasCorpusArchive())(
    'every document reports the parity verdict it reported when this was pinned',
    async () => {
      const corpus = await loadEveryCorpusDocument()
      expect(
        corpus.length,
        `corpus is ${corpus.length}, expected ${CORPUS_SIZE}. ${CORPUS_RESTORE_HINT}`,
      ).toBe(CORPUS_SIZE)

      const actual: Record<string, ParityRow> = {}
      for (const { name, code } of corpus) actual[name] = parityRow(code)

      if (process.env.UPDATE_STAGES_PARITY_BASELINE === '1') {
        fs.writeFileSync(BASELINE, JSON.stringify(actual, null, 2) + '\n')
        return
      }

      const expected: Record<string, ParityRow> = JSON.parse(fs.readFileSync(BASELINE, 'utf8'))

      // Enumerate the movers, per document and per direction — this message is
      // the deliverable when the gate goes red, not a hint to go investigate.
      const gained: string[] = []   // diverged -> matches  (a FIX)
      const lost: string[] = []     // matches  -> diverges (a REGRESSION)
      const reshaped: string[] = [] // still diverges, differently
      const missing: string[] = []

      for (const name of Object.keys(expected)) {
        const e = expected[name]
        const a = actual[name]
        if (!a) { missing.push(name); continue }
        if (e.match && !a.match) lost.push(`  ${name}  ${a.direct}  !=  ${a.staged}${divergenceDetail(a)}${shapesEqualWarning(a)}`)
        else if (!e.match && a.match) gained.push(
            `  ${name}  now matches (was ${e.direct} != ${e.staged}${divergenceDetail(e)})` +
              `${shapesEqualWarning(e)}`,
          )
        else if (!e.match && !a.match && (e.direct !== a.direct || e.staged !== a.staged)) {
          reshaped.push(
            `  ${name}\n    was  ${e.direct} != ${e.staged}${divergenceDetail(e)}` +
              `\n    now  ${a.direct} != ${a.staged}${divergenceDetail(a)}${shapesEqualWarning(a)}`,
          )
        }
      }
      const added = Object.keys(actual).filter((n) => !(n in expected))

      const report = [
        lost.length     ? `REGRESSED — these matched when pinned and no longer do (${lost.length}):\n${lost.join('\n')}` : '',
        gained.length   ? `FIXED — these diverged when pinned and now match (${gained.length}):\n${gained.join('\n')}` : '',
        reshaped.length ? `RESHAPED — still diverging, differently (${reshaped.length}):\n${reshaped.join('\n')}` : '',
        missing.length  ? `DROPPED OUT of the sweep (${missing.length}):\n  ${missing.join('\n  ')}` : '',
        added.length    ? `NEW in the corpus (${added.length}):\n  ${added.join('\n  ')}` : '',
      ].filter(Boolean).join('\n\n')

      expect(report, `staged-pipeline parity moved.\n\n${report}\n\nIf this is intended, re-baseline and enumerate the movers in the PR.`).toBe('')
    },
  )

  it.skipIf(!hasCorpusArchive())(
    'the divergence count is the number the issue quotes',
    async () => {
      const expected: Record<string, ParityRow> = JSON.parse(fs.readFileSync(BASELINE, 'utf8'))
      const diverging = Object.values(expected).filter((r) => !r.match).length
      // Not a second source of truth — a guard on the FIRST. It exists so that
      // a re-baseline which quietly accepts a worse number has to change a
      // literal a reviewer can see in the diff.
      const shapeDiverging = Object.values(expected).filter((r) => !r.shapeMatch).length
      const tagDiverging = Object.values(expected).filter((r) => !r.tagMatch).length
      expect(diverging).toBe(DEEP_DIVERGENCE)
      expect(shapeDiverging).toBe(SHAPE_DIVERGENCE)
      expect(tagDiverging).toBe(TAG_DIVERGENCE)

      // Seeded from BY_CLASS's own keys so a class pinned at 0 is COMPARED at
      // 0 rather than being absent. An emptied class keeps its row, and a
      // regression that refills it has to move a literal a reviewer can see.
      const byClass: Record<string, number> = Object.fromEntries(
        Object.keys(BY_CLASS).map((k) => [k, 0]),
      )
      for (const r of Object.values(expected)) {
        if (!r.match && r.cls) byClass[r.cls] = (byClass[r.cls] ?? 0) + 1
      }
      expect(byClass).toEqual(BY_CLASS)
      expect(Object.values(BY_CLASS).reduce((a, b) => a + b, 0)).toBe(DEEP_DIVERGENCE)
      expect(Object.keys(expected)).toHaveLength(CORPUS_SIZE)
    },
  )
})
