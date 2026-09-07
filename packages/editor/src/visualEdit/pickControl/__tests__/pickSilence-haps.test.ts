// @vitest-environment node
/**
 * pickSilence-haps.test.ts — #1462 HAPS GROUNDING.
 *
 * `pickSilenceArm` claims that rewriting a control arm's head to `~` makes that
 * section SILENT while KEEPING its width — the pick spelling of the gap delete
 * `arrange/silenceArm` performs (#491). Both halves of that are runtime claims
 * about Strudel's evaluator, not about our own text surgery, so they are OBSERVED
 * against the real evaluator here rather than inferred — the same discipline
 * `arrange-materialize-haps.test.ts` applies to the arrange side.
 *
 * ⚠ THE UN-GAPPED ARM IS NOT DECORATION. "Zero haps in cycles 4–11" is satisfied
 * just as well by a document that is silent everywhere, or one this harness failed
 * to evaluate. The control is what makes the gap mean something: the SAME song
 * with `verse@8` in place of `~@8` must be LOUD in exactly those cycles.
 *
 * The receiver is `mini("<…>")` rather than the bare `"<…>"` the app detects,
 * because the bare form needs the transpiler's string reification, which this
 * harness (evalScope + miniAllStrings) does not run. The control string and the
 * pick call are identical either way — this is a harness detail, not a difference
 * in what is being measured.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { evalScope, evaluate } from '@strudel/core/evaluate.mjs'
import * as strudelCore from '@strudel/core'
import { mini, miniAllStrings } from '@strudel/mini/mini.mjs'

beforeAll(async () => {
  await evalScope(Promise.resolve(strudelCore), Promise.resolve({ mini }))
  miniAllStrings()
})

type StrudelHap = { whole?: { begin?: { valueOf(): number } } }
type StrudelPattern = { queryArc: (b: number, e: number) => StrudelHap[] }

/** Sounding haps (deduped by un-clipped onset) in each cycle of [0, cycles). */
async function hapsPerCycle(code: string, cycles: number): Promise<number[]> {
  const { pattern } = (await evaluate(code)) as { pattern: StrudelPattern }
  const counts: number[] = []
  for (let c = 0; c < cycles; c++) {
    const begins = new Set(pattern.queryArc(c, c + 1).map((h) => h.whole?.begin?.valueOf()))
    counts.push(begins.size)
  }
  return counts
}

/** intro/outro sound 1 hap per cycle; verse sounds 4. */
const SECTIONS = '{intro: s("bd ~ ~ ~"), verse: s("bd*2 sd*2"), outro: s("bd ~ ~ ~")}'
const NORMAL = `mini("<intro@4 verse@8 outro@4>").pickRestart(${SECTIONS})`
const GAPPED = `mini("<intro@4 ~@8 outro@4>").pickRestart(${SECTIONS})`

describe('#1462 — a `~` control arm is a silent gap of the SAME width', () => {
  it('the un-gapped song sounds in every cycle (the control arm)', async () => {
    expect(await hapsPerCycle(NORMAL, 16)).toEqual([1, 1, 1, 1, 4, 4, 4, 4, 4, 4, 4, 4, 1, 1, 1, 1])
  })

  it('the gapped song is silent for exactly the section it replaced', async () => {
    expect(await hapsPerCycle(GAPPED, 16)).toEqual([1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1])
  })

  it('THE OUTRO DOES NOT MOVE — the gap keeps its width, nothing slides left', async () => {
    // The single property that separates this gesture from a ripple delete, and
    // the reason the two spellings had to agree (#1462). Stated as its own arm so
    // a regression to `removeArm` fails HERE, naming the reason, rather than as a
    // confusing off-by-eight in the arrays above.
    const gapped = await hapsPerCycle(GAPPED, 16)
    expect(gapped.slice(4, 12), 'the gap should be silent').toEqual([0, 0, 0, 0, 0, 0, 0, 0])
    expect(gapped.slice(12, 16), 'the outro must still be at cycles 12–15').toEqual([1, 1, 1, 1])
    expect(gapped).toHaveLength(16) // the song is still 16 cycles long
  })
})
