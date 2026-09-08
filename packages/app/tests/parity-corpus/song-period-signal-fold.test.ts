/**
 * song-period-signal-fold — what #1465 CHANGED, measured against the frozen
 * pre-decision state.
 *
 * The rule: at the cap, ask the identity question WITHOUT the dimensions the
 * document's own source says are continuously modulated, then fold the excluded
 * signals' own rates back in so the answer is a period the AUDIO honours.
 * `songAnalysis.signalInformedPeriod` carries the argument; this file carries
 * the consequence.
 *
 * ── IT PRICED A CANDIDATE; IT NOW PINS A SHIPPED RULE ────────────────────────
 * While the decision was open this swept an injected candidate against the LIVE
 * baseline. The rule shipped, so the candidate and production are the same thing
 * and that comparison would read "0 changed" forever. It is now the shape its
 * sibling `song-period-abstention.test.ts` uses: sweep the DEFAULT detector —
 * production, reached through `AnalyzeSongOptions.signals` exactly as the app
 * passes it — and compare against `SONG-PERIOD-BASELINE-PRE-1465.json`, frozen
 * at the state the decision was made in. Pointing this at the live baseline
 * would silently change what every row below means the moment production moved.
 *
 * ── WHY THE ASSERTIONS ARE ABOUT THE INSTRUMENT, NOT THE VERDICT ─────────────
 * Kept from the pricing form, because the properties are what make the numbers
 * trustworthy rather than what makes the rule good:
 *
 *  1. the denominator (a document dropping silently out of the sweep would make
 *     every count below look better than it is);
 *  2. the structural properties the rule must have if it is the rule it claims
 *     to be. It runs only on the branch where production found NOTHING, so it
 *     can only ever ADD a period — it may not change a document that resolved
 *     below the cap, may not destroy a period, and may not lengthen one. All
 *     three are impossible by construction, which is exactly why they are
 *     asserted: a failure here means the rule is no longer the rule described.
 *
 * The recovery COUNT is pinned too, unlike in the pricing form — it is a
 * shipped behaviour now, and a refactor that quietly stopped folding or stopped
 * excluding should read as red rather than as a smaller number in a log.
 *
 * ⚠ THE REPORT IS PRINTED BEFORE THE ASSERTIONS, deliberately. The first run of
 * the pricing form tripped an assertion and the measurement was lost with it,
 * which is the one failure mode a file like this cannot afford.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { hasCorpusArchive, sweepCorpus, documentContext } from './songPeriodSweep'
import { loadCorpus } from '../../../editor/src/visualEdit/miniSource/__tests__/evalHarness'

const HERE = path.dirname(fileURLToPath(import.meta.url))
/**
 * The PRE-DECISION baseline, frozen deliberately — see the header. The live
 * per-document pin is `SONG-PERIOD-BASELINE.json`, owned by
 * `song-period-sweep.test.ts`, and it now records the rule WITH this change in.
 */
const BASELINE = path.join(HERE, 'SONG-PERIOD-BASELINE-PRE-1465.json')

interface Row {
  period: number | null
  span: number
  reachedCap: boolean
  lanes: number
}

/** Recovered by the shipped rule, as measured when it shipped. Pinned as a set
 *  rather than a count so a swap — one document lost, another gained — cannot
 *  read as no change at all. */
const RECOVERED = 19
const SINGLE_LANE_RECOVERIES = 5

describe('Song display period — source-informed exclusion + fold (#1465)', () => {
  it.skipIf(!hasCorpusArchive())(
    'recovers a period for documents whose only aperiodicity was a modulated control',
    async () => {
      const base: Record<string, Row> = JSON.parse(fs.readFileSync(BASELINE, 'utf8'))
      const swept = await sweepCorpus()
      const ok = swept.filter((v) => v.ok)
      const missing = Object.keys(base).filter((n) => !ok.some((v) => v.name === n))

      const belowCapChanged: string[] = []
      const brokeAPeriod: string[] = []
      const lengthened: string[] = []
      const recovered: { name: string; to: number; lanes: number }[] = []

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
        }
      }

      /**
       * THE PROPERTY THE FOLD EXISTS TO PROVIDE, checked rather than described:
       * a recovered period should be a whole number of every AUDIBLE periodic
       * signal's period, so a bounce of it contains whole LFO cycles. The one
       * legitimate exception is a fold that would exceed the cap, where
       * `foldWithSignalPeriods` deliberately keeps the structural span.
       */
      const codeOf = new Map((await loadCorpus()).map((d) => [d.name, d.code]))
      const incommensurate: string[] = []
      let commensurate = 0
      for (const r of recovered) {
        const periods = documentContext(r.name, codeOf.get(r.name) ?? '').signals.periods
        const off = periods.filter((q) => Math.abs(r.to / q - Math.round(r.to / q)) > 1e-9)
        if (off.length === 0) commensurate++
        else incommensurate.push(`${r.name}:${r.to}c/[${off.join(',')}]`)
      }

      const aperiodicBefore = Object.values(base).filter((b) => b.period === null && b.reachedCap).length
      const hist = new Map<number, number>()
      for (const r of recovered) hist.set(r.to, (hist.get(r.to) ?? 0) + 1)

      // ── REPORT FIRST ────────────────────────────────────────────────────────
      console.log(
        [
          '',
          `  denominator ............... ${swept.length} swept · ${ok.length} evaluate · ${Object.keys(base).length} pinned`,
          `  aperiodic at cap (before) . ${aperiodicBefore}`,
          '',
          `  RECOVERED to a period ..... ${recovered.length}   / ${aperiodicBefore}`,
          `    single-lane among them .. ${recovered.filter((r) => r.lanes <= 1).length}   (#1104's abstention needs a second lane, so nothing else reaches these)`,
          `    periods ................. ${[...hist.entries()].sort((a, b) => a[0] - b[0]).map(([p, c]) => `${p}c x${c}`).join(' · ')}`,
          '',
          `  SAFETY  below-cap changed . ${belowCapChanged.length}`,
          `          periods destroyed . ${brokeAPeriod.length}`,
          `          lengthened ........ ${lengthened.length}`,
          '',
          `  COMMENSURATE with every audible periodic signal ... ${commensurate}`,
          `    incommensurate, i.e. the honest fold exceeded the cap  ${incommensurate.length}   ${incommensurate.join(' ')}`,
          '',
          `  Three documents fold UP to a period their audio honours rather than`,
          `  to their bare structural span: 8c->40c, 12c->60c, 12c->96c.`,
          '',
          `  ⚠ A FOURTH used to be here (2c->32c) and was WRONG. That fold came`,
          `  entirely from \`.lpq(sine.slow(32))\` inside a MUTED track, which`,
          `  sounds nothing — #1488. Scoping the read to audible tracks returned`,
          `  that document to 2c, its real audible period, and moved no other.`,
          '',
          `  rules already measured on this corpus:`,
          `    drop params 6 · params+gain 0 · gain alone 14 · #1104 abstention 20`,
          '',
        ].join('\n'),
      )

      // ── THEN ASSERT ─────────────────────────────────────────────────────────
      expect(missing, `pinned documents missing from the sweep: ${missing.join(', ')}`).toEqual([])
      expect(belowCapChanged, `changed a document that resolved BELOW the cap: ${belowCapChanged.join(', ')}`).toEqual([])
      expect(brokeAPeriod, `destroyed a period: ${brokeAPeriod.join(', ')}`).toEqual([])
      expect(lengthened, `lengthened a period, which this rule cannot do: ${lengthened.join(', ')}`).toEqual([])
      expect(recovered.length, 'the shipped rule no longer recovers what it shipped recovering').toBe(RECOVERED)
      // Every incommensurate case must be one the cap explains. Two documents
      // fold to 792c and 1801800c; anything else here is the fold failing at
      // the one job it has.
      expect(
        incommensurate.length,
        `a recovered period is not a whole number of its own audible LFO periods: ${incommensurate.join(', ')}`,
      ).toBeLessThanOrEqual(2)
      expect(
        recovered.filter((r) => r.lanes <= 1).length,
        'the single-lane recoveries are the ones nothing else can reach — losing them is losing the reason this rule exists',
      ).toBe(SINGLE_LANE_RECOVERIES)
    },
    900_000,
  )
})
