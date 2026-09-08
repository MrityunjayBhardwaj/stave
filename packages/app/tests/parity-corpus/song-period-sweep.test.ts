/**
 * song-period-sweep — THE PINNED BASELINE for the Song timeline's display span,
 * per document, over the 150 real tunes (#1102).
 *
 * ── WHY A PER-DOCUMENT PIN, AND NOT A HISTOGRAM ──────────────────────────────
 * The fix #1102 needs makes the cycle fingerprint read the adapter's whole value
 * partition instead of three curated fields ([[PV255]]). A stricter fingerprint
 * can only LENGTHEN a detected period or make it null, and `analyzeSong` falls
 * back to `horizonCycles` (cap 256) when it finds none — so the change's real
 * risk is not "does the fixture pass" but "which documents move, and how far".
 * A histogram would report the same shape for two completely different sets of
 * movers. Every document's verdict is therefore pinned individually, and the
 * failure message IS the enumeration the fix's gate asks for.
 *
 * Committed BEFORE the production change, on a tree where `cycleFingerprints` is
 * untouched, so the "before" side of the comparison cannot be reconstructed
 * after the fact or quoted from another branch.
 *
 * ── WHAT THE FIX MOVED, measured against that pinned before-side ─────────────
 * 142 documents · 122 unchanged · **20 moved, 16 of them to the 256-cycle cap**.
 * Four lengthened to a real period (4→36, 3→12, 1→3, 4→120) and sixteen went
 * from a bounded period to none.
 *
 * The sixteen are ONE mechanism, attributed per field: an LFO-modulated
 * continuous control makes every cycle differ, so no period exists. `cutoff` is
 * implicated in 11 of the 16, then `resonance`, `gain`, `pan`, `delaytime`,
 * `room`. That is the `.gain(sine)` hazard the invariant named, and it is the
 * TRUE answer for those documents — a filter sweeping over 40 cycles genuinely
 * does not repeat. What it exposes is a display question the corpus already had
 * before this change: **53 of 142 documents were already drawn on a 256-cycle
 * timeline, and this makes it 69.** How an aperiodic song should be displayed is
 * its own issue; it is not a reason to keep asking a narrower identity question.
 *
 * Three narrower rules were measured through this same harness before that was
 * settled — dropping params (6 to the cap), dropping params and gain (0 to the
 * cap), dropping gain alone (14) — and each buys its quiet by going blind on an
 * axis. The rule that keeps every axis AND costs nothing (drop dimensions with
 * no period of their own) was prototyped and REJECTED for now: its stability
 * question can only see as far as its probe window, so a field whose period
 * exceeds that window reads as unstable, and the prototype dropped `note` and
 * `s` in ~75 documents and newly collapsed two to period 1 — reintroducing this
 * very defect. It needs the progressive horizon the main detection has.
 *
 * ── THE DISPLAY QUESTION WAS THEN ANSWERED IN PART (#1104) ───────────────────
 * The baseline below is no longer the post-#1102 one. Once the horizon is
 * exhausted, a lane with no loop of its own now ABSTAINS from the span instead of
 * vetoing it (`detectDisplayPeriodAtCap`), which is the same phasing argument
 * #488 already makes about lanes of differing LENGTHS, extended to the case the
 * veto covered. Swept per document: **20 documents left the 256-cycle cap for a
 * real period** (6, 8, 14, 16, 23, 24, 28, 32×4, 48×2, 64, 96×3), nothing changed
 * below the cap, no period was lost and none collapsed to 1 — so aperiodic-at-cap
 * went 69 → 49.
 *
 * The candidates NOT taken, and the reasoning that killed them, are in
 * `song-period-abstention.test.ts`, which prices them against a frozen
 * pre-decision copy of this baseline. Read it before proposing a new rule here:
 * abstaining below the cap and three different tests of WHICH lanes answered are
 * all already measured and all fail.
 *
 * The 49 that remained — 56 after #1107, the tally line below carries the whole
 * chain — have 32 single-lane documents among them, so for those there is no
 * other lane to borrow a period from at all.
 *
 * ⚠ THEY WERE "aperiodic under every rule measured" WHEN THIS WAS WRITTEN. That
 * is no longer true: #1465 prices a rule recovering 19 of the 56, and 5 of those
 * are single-lane — the group this file calls unreachable, because #1104's
 * abstention needs a second lane to borrow from. The difference is where the
 * exclusion comes from. Every earlier candidate inferred it by watching events;
 * this one reads it from the IR, so it has no probe window to be shorter than a
 * field's period. See `song-period-signal-exclusion.test.ts`.
 *
 * ── AND THEN A FOURTH ERA (#1107): 49 → 56, A RISE ON PURPOSE ────────────────
 * Seven documents were accepting a span that left a whole track drawing empty and
 * unmarked. Two mechanisms, and the difference decided the fix: three had the
 * events and lost the lane to `accumulateLanes(events, period)` narrowing
 * MEMBERSHIP ([[P405]]); four accepted a period before the track had ever sounded
 * — `0/-Hx1rNCmeyD8` reads period 1 at horizon 8 while its other six tracks enter
 * at cycles 16, 32, 56, 95, 128 and 159 — so no post-hoc repair could reach them,
 * their events were never collected. `displayPeriodRule`'s two plausibility
 * clauses refuse both, moving EXACTLY those seven and nothing else, every one
 * recovering its full lane set (1→7 ×3, 2→4, 5→6, 3→5 ×2 = 25 lanes).
 *
 * Three of the seven are periods #1104 recovered. They are given back
 * deliberately: a span that hides 98.6% of a document's onsets is a loop claim
 * the document does not support, and #1105 already made the aperiodic display an
 * honest one. Both clauses test whether the ANSWER is plausible, never which
 * lanes answered — the family the abstention sibling measured and refused.
 *
 * ── HOW TO RE-BASELINE, deliberately awkward ─────────────────────────────────
 *   UPDATE_SONG_PERIOD_BASELINE=1 pnpm --filter @stave/app exec vitest run \
 *     tests/parity-corpus/song-period-sweep.test.ts
 * Then READ THE DIFF and enumerate the movers per axis in the PR. Re-baselining
 * without reading the diff is how a 256-cycle timeline ships green.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  hasCorpusArchive,
  periodHistogram,
  sweepCorpus,
  type PeriodVerdict,
} from './songPeriodSweep'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const BASELINE = path.join(HERE, 'SONG-PERIOD-BASELINE.json')

/** the per-document row the baseline pins — verdict only, no volatile counts */
interface BaselineRow {
  period: number | null
  span: number
  reachedCap: boolean
  lanes: number
}

function rowOf(v: PeriodVerdict): BaselineRow {
  return { period: v.period, span: v.span, reachedCap: v.reachedCap, lanes: v.lanes }
}

/**
 * The eight documents that do not evaluate headlessly. NAMED rather than
 * absorbed into a floor with slack in it, so a document that silently drops out
 * of the sweep fails here instead of quietly shrinking the denominator. The
 * classification (5 document-intrinsic · 2 browser-bound · 1 engine-version ·
 * 0 missing-scope) lives in `evalHarness.ts`; six of the eight cannot evaluate
 * in the live app either, which puts the honest ceiling at 144, not 150.
 */
const EVAL_FAILURES = [
  '0/-8Xqyjn750i4',
  '0/-MMxsqMYG_ID',
  '250/0vk9wpBvt6Nd',
  '500/3CMJf_qbfks9',
  '500/3HWHF_ZUbZD_',
  '500/3H_LAkg97Urt',
  '500/3HvvWoaCyciz',
  '500/3L25jxCjZ235',
]

describe('Song display period — corpus baseline (#1102)', () => {
  // `.bakery-runs/` is gitignored — unreviewed third-party tunes (#1307). On a
  // machine without it this SKIPS and vitest reports it as skipped, rather than
  // dying on an ENOENT naming a path git refuses to track. The rule is imported,
  // never restated, so it cannot drift from the read it guards.
  it.skipIf(!hasCorpusArchive())('every document reports the period it reported when this was pinned', async () => {
    const verdicts = await sweepCorpus()
    const evaluated = verdicts.filter((v) => v.ok)

    const actual: Record<string, BaselineRow> = {}
    for (const v of verdicts) if (v.ok) actual[v.name] = rowOf(v)

    if (process.env.UPDATE_SONG_PERIOD_BASELINE === '1') {
      fs.writeFileSync(BASELINE, JSON.stringify(actual, null, 2) + '\n')
    }

    const hist = [...periodHistogram(verdicts).entries()].sort((a, b) => b[1] - a[1])
    console.log(
      [
        '',
        `─── Song display period, ${evaluated.length}/${verdicts.length} documents evaluated ───`,
        ...hist.map(([k, n]) => `  period ${k.padEnd(22)} ${n}`),
        // Annotated with the WHOLE history, because there are now four eras and a
        // single "before the fix" number silently means the wrong one: 53 was
        // before #1102 made event identity total, 69 was after it, 49 is after
        // #1104 let lanes abstain at the cap, and 56 is after #1107 refused the
        // seven spans that hid a whole track. That last move is a rise on purpose —
        // three of the seven are periods #1104 recovered, given back because a span
        // excluding a track is a loop claim the document does not support, and
        // #1105 already made the aperiodic display an honest one.
        `  aperiodic-at-cap ${evaluated.filter((v) => v.reachedCap).length}   (53 pre-#1102 → 69 post-#1102 → 49 post-#1104 → 56 post-#1107)`,
        `  period 1          ${evaluated.filter((v) => v.period === 1).length}   (21 pre-#1102 → 19 post-#1102, unmoved by #1104)`,
        // A document that produced NO events is not an aperiodic document — it is
        // a document the sweep saw nothing of, and `analyzeSong` short-circuits it
        // to a zero-cycle span. Reported separately so it can never be read as
        // either a period or a regression.
        `  silent (0 events)  ${evaluated.filter((v) => v.events === 0).length}`,
      ].join('\n'),
    )

    // COVERAGE IS A RESULT, NOT A PRECONDITION — and the residual is named, not
    // floored with slack. Same population and same harness as the miniSource
    // calibration, so the two arms must agree about who is missing.
    expect(verdicts.filter((v) => !v.ok).map((v) => v.name).sort()).toEqual(EVAL_FAILURES)
    expect(evaluated.length).toBe(142)

    // #1107 — AN INVARIANT, ASSERTED SEPARATELY FROM THE PINNED ROWS, because a
    // re-baseline must not be able to accept it. A track that sounded inside the
    // analysed horizon and is still missing from `analysis.lanes` has not gone
    // empty, it has ceased to exist ([[P405]]): the display rebuilds its row from
    // the document (#1098) and draws it with no content and no silenced marking,
    // so a track playing thousands of notes looks exactly like one playing none.
    // Counted at `accumulateLanes`' own boundary rather than derived from the rule
    // that prevents it, and it names the documents when it fails.
    //
    // ITS REACH IS HALF THE CLASS, and that is measured rather than hoped for:
    // breaking the span clause turns it red on exactly `-F1MqbcpcByv: 1`,
    // `19FzyPQc7bcR: 2`, `3Xv8ssjN67qW: 2`, while breaking the UNHEARD-TRACK
    // clause leaves it green and reddens the pinned rows below instead. That is
    // not a hole in the gate — a document that converged before its other tracks
    // entered never collected their events, so nothing at this boundary can see
    // them. The other half is guarded by those pinned rows and by
    // `songAnalysis.test.ts`'s composed-loop arm.
    expect(evaluated.filter((v) => v.lostLanes > 0).map((v) => `${v.name}: ${v.lostLanes}`)).toEqual([])

    const expected: Record<string, BaselineRow> = JSON.parse(fs.readFileSync(BASELINE, 'utf8'))
    // Per-document, so a failure NAMES the movers rather than reporting a
    // distribution that moved. `toEqual` on the whole map gives the enumeration
    // in one diff.
    expect(actual).toEqual(expected)
  }, 600_000)
})
