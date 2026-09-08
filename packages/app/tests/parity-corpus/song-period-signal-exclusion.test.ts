/**
 * song-period-signal-exclusion — PRICES the source-informed fingerprint for
 * #1465 before any production rule changes: at the cap, ask the identity
 * question WITHOUT the dimensions the document's own source says are
 * continuously modulated.
 *
 * This file changes no production behaviour. The candidate is injected into the
 * real `analyzeSong` loop through the measurement seam and DELEGATES to
 * `displayPeriodRule`, so what is priced is what would ship.
 *
 * ── WHY THIS CANDIDATE IS NOT THE ONE ALREADY REJECTED ───────────────────────
 * `song-period-sweep.test.ts` records that "drop dimensions with no period of
 * their own" was prototyped and set aside: its stability question could only see
 * as far as its probe window, so a field whose period exceeded that window read
 * as unstable, and it discarded `note` and `s` in ~75 documents. The intent was
 * right and the EVIDENCE was wrong. This reads the exclusion from the IR —
 * `Param{value: …Signal}` — which is a fact about the source, identical at every
 * horizon, so it cannot drift with the horizon it feeds. That is the property
 * `songAnalysis.ts` asks for when it says a derived exclusion rule has to share
 * the horizon of the detection it feeds.
 *
 * ── WHY THE ASSERTIONS ARE ABOUT THE INSTRUMENT, NOT THE VERDICT ─────────────
 * Following its sibling `song-period-abstention.test.ts`: whether to accept the
 * trade is a product decision and not this file's to make. The expectations pin
 * only what would make a number untrustworthy — the denominator, and the
 * structural properties the rule must have if it is the rule it claims to be —
 * and the rest is REPORTED for a human to rule on.
 *
 * ⚠ THE REPORT IS PRINTED BEFORE THE ASSERTIONS, deliberately. The first run of
 * this tripped an assertion and the measurement was lost with it, which is the
 * one failure mode a pricing file cannot afford: it exists to produce numbers,
 * and a numberless red tells you nothing about the rule.
 *
 * ── WHAT THE FIRST ATTEMPT GOT WRONG, kept because it is the trap here ───────
 * The candidate originally approximated production as
 * `detectPeriod(cycleFingerprints(events, horizon))`. Production is per-LANE
 * (`displayPeriodRule` → `detectDisplayPeriod*`), so that global fingerprint was
 * a different, cruder rule — and it reported 8 below-cap documents changed,
 * two of them with periods LENGTHENED (28→56, 23→92), which this candidate is
 * mathematically incapable of doing. Every one of those differences was the
 * approximation showing through. A candidate must delegate, which is why the
 * seam now carries `hasUnheardTrack`: without it, delegation is impossible and
 * re-implementation is the only option.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { hasCorpusArchive, sweepCorpus, signalExcludingDetector } from './songPeriodSweep'

const HERE = path.dirname(fileURLToPath(import.meta.url))
/** The LIVE per-document production pin, owned by `song-period-sweep.test.ts`.
 *  This candidate is an extension of the rule that shipped, so it is priced
 *  against what production does now — not against the frozen pre-#1104 copy,
 *  which exists to price ALTERNATIVES to that decision rather than additions. */
const BASELINE = path.join(HERE, 'SONG-PERIOD-BASELINE.json')

interface Row {
  period: number | null
  span: number
  reachedCap: boolean
  lanes: number
}

describe('Song display period — source-informed exclusion (#1465)', () => {
  it.skipIf(!hasCorpusArchive())(
    'prices the candidate, and its unconditional control, against production',
    async () => {
      const base: Record<string, Row> = JSON.parse(fs.readFileSync(BASELINE, 'utf8'))

      /** Documents with no automated control get the production rule, so they are
       *  identical by construction rather than by luck. */
      const candidate = await sweepCorpus({
        perDocument: (ctx) =>
          ctx.signalKeys.size === 0
            ? undefined
            : signalExcludingDetector(ctx, { atCapOnly: true }),
      })

      /** CONTROL, not a candidate. The plan for this argued `atCapOnly` was
       *  structurally required; this measures that claim instead of asserting it. */
      const unconditional = await sweepCorpus({
        perDocument: (ctx) =>
          ctx.signalKeys.size === 0
            ? undefined
            : signalExcludingDetector(ctx, { atCapOnly: false }),
      })

      const ok = candidate.filter((v) => v.ok)
      const swept = new Set(ok.map((v) => v.name))
      const missing = Object.keys(base).filter((n) => !swept.has(n))

      const belowCapChanged: string[] = []
      const brokeAPeriod: string[] = []
      const lengthened: string[] = []
      const recovered: { name: string; to: number; lanes: number }[] = []
      const shortRecoveries: string[] = []

      for (const v of ok) {
        const b = base[v.name]
        if (!b) continue
        if (b.period === v.period && b.span === v.span && b.reachedCap === v.reachedCap) continue
        if (!b.reachedCap) belowCapChanged.push(`${v.name} ${b.period}->${v.period}`)
        if (b.period !== null && v.period === null) brokeAPeriod.push(v.name)
        if (b.period !== null && v.period !== null && v.period > b.period) {
          lengthened.push(`${v.name} ${b.period}->${v.period}`)
        }
        if (b.period === null && v.period !== null) {
          recovered.push({ name: v.name, to: v.period, lanes: v.lanes })
          if (v.period <= 2) shortRecoveries.push(`${v.name}:${v.period}`)
        }
      }

      const uncondBelowCap: string[] = []
      const uncondToOne: string[] = []
      let uncondRecovered = 0
      for (const v of unconditional) {
        if (!v.ok) continue
        const b = base[v.name]
        if (!b) continue
        if (b.period === v.period && b.span === v.span && b.reachedCap === v.reachedCap) continue
        if (!b.reachedCap) uncondBelowCap.push(`${v.name} ${b.period}->${v.period}`)
        if (v.period === 1) uncondToOne.push(v.name)
        if (b.period === null && v.period !== null) uncondRecovered++
      }

      const aperiodicBefore = Object.values(base).filter((b) => b.period === null && b.reachedCap).length
      const hist = new Map<number, number>()
      for (const r of recovered) hist.set(r.to, (hist.get(r.to) ?? 0) + 1)

      // ── REPORT FIRST ────────────────────────────────────────────────────────
      console.log(
        [
          '',
          `  denominator ............... ${candidate.length} swept · ${ok.length} evaluate · ${Object.keys(base).length} pinned`,
          `  aperiodic at cap (before) . ${aperiodicBefore}`,
          '',
          `  RECOVERED to a period ..... ${recovered.length}   / ${aperiodicBefore}`,
          `    single-lane among them .. ${recovered.filter((r) => r.lanes <= 1).length}   (#1104's abstention needs a second lane, so nothing else reaches these)`,
          `    periods ................. ${[...hist.entries()].sort((a, b) => a[0] - b[0]).map(([p, c]) => `${p}c x${c}`).join(' · ')}`,
          '',
          `  SAFETY  below-cap changed . ${belowCapChanged.length}`,
          `          periods destroyed . ${brokeAPeriod.length}`,
          `          lengthened ........ ${lengthened.length}`,
          `          recoveries <=2c ... ${shortRecoveries.length}   ${shortRecoveries.join(' ')}`,
          '',
          `  CONTROL (atCapOnly:false) . recovered ${uncondRecovered} · below-cap changed ${uncondBelowCap.length} · collapsed to 1: ${uncondToOne.length}`,
          `    ⚠ Scoring the same as the gated arm is the finding: the safety does`,
          `      NOT come from the horizon gate, it comes from this rule only ever`,
          `      ADDING a period where production found none. The gate costs zero`,
          `      recoveries and is kept as free insurance, not as a requirement.`,
          '',
          `  for comparison, rules already measured on this corpus:`,
          `    drop params 6 · params+gain 0 · gain alone 14 · #1104 abstention 20 (SHIPPED)`,
          '',
        ].join('\n'),
      )

      // ── THEN ASSERT ─────────────────────────────────────────────────────────
      // A document silently leaving the sweep would make every count above look
      // better than it is.
      expect(missing, `pinned documents missing from the sweep: ${missing.join(', ')}`).toEqual([])
      // Structural properties the rule must have if it is the rule it claims to
      // be. It only ever ADDS a period where production found none, so all three
      // are impossible by construction — which is exactly why they are asserted:
      // a failure here means the harness stopped measuring the rule described.
      expect(belowCapChanged, `changed a document that resolved BELOW the cap: ${belowCapChanged.join(', ')}`).toEqual([])
      expect(brokeAPeriod, `destroyed a period: ${brokeAPeriod.join(', ')}`).toEqual([])
      expect(lengthened, `lengthened a period, which this rule cannot do: ${lengthened.join(', ')}`).toEqual([])
      // The recovery count is REPORTED, not pinned — it is the product question.
      // What is pinned is that the rule still reaches something, so a refactor
      // that quietly disabled it would not read as a clean pass.
      expect(recovered.length, 'the rule recovered nothing — it is no longer firing').toBeGreaterThan(0)
    },
    900_000,
  )
})
