/**
 * Where a Stage 2 control can actually WRITE, measured over real documents.
 *
 * `SignalSpans` carries the source coordinates of each leg, and its doc comment
 * quotes how often each leg is spelled. This test is what OWNS those numbers.
 * They were originally taken by a throwaway probe that read `ranged` and
 * `periodCycles` — proxies for spelling — and a number transcribed beside the
 * type it describes rots the moment either moves.
 *
 * ⚠ THE PROXIES AND THE SPANS ARE NOT THE SAME QUESTION, which is the reason
 * this measures spans directly. `periodCycles !== 1` says the chain HAS a rate;
 * `spans.rate` says a control may WRITE one, and it is deliberately null when
 * two rate arms compose — `sine.slow(2).fast(4)` has a well-defined rate and no
 * well-defined place to put a new one. So the span figure is a floor under the
 * proxy figure, never equal to it by construction.
 *
 * What the numbers are FOR: the share spelling NEITHER leg is the whole
 * justification for `captionEdit`'s insert path, which appends a call instead of
 * replacing one. If that share were zero the insert path would be dead code; it
 * is not, and this is the evidence.
 *
 * ⚠ Denominator is `loadCorpus` — the sweep corpus, NOT `ref/bakery-runs-inputs`
 * (329 by content) and NOT all of `.bakery-runs`. The three are not
 * interchangeable and a figure measured on one predicts nothing about another.
 */
import { describe, it, expect } from 'vitest'
import { loadCorpus } from '../../../editor/src/visualEdit/miniSource/__tests__/evalHarness'
import { parseStrudel } from '../../../editor/src/ir/parseStrudel'
import { signalAutomations } from '../../../editor/src/ir/signalAutomation'

describe('signal span census over the sweep corpus', () => {
  it('pins where a control can write, and proves the insert path is reachable', async () => {
    const docs = await loadCorpus()
    let parsed = 0
    let automations = 0
    let rangeSpelled = 0
    let rateSpelled = 0
    let neitherSpelled = 0
    let noChainEnd = 0
    // The two reasons `spans.rate` can be null, which want OPPOSITE answers from
    // a rate control: nothing spelled means a control can INSERT `.slow(n)` the
    // way the range control already inserts `.range()`; two arms composing means
    // there is a rate but no honest place to put a new one, and the only correct
    // answer is to decline. Counting them together would hide that.
    //
    // ⚠ `periodCycles !== 1` is a PROXY for "the chain states a rate" and it
    // misreads an explicit `.slow(1)`, which states one and computes to 1. No
    // corpus document does that today; if one appears, the split moves and this
    // is the line to distrust first.
    let rateAbsent = 0
    let rateAmbiguous = 0

    for (const doc of docs) {
      let ir
      try {
        ir = parseStrudel(doc.code)
      } catch {
        continue
      }
      parsed++
      for (const a of signalAutomations(ir)) {
        automations++
        if (a.spans.range) rangeSpelled++
        if (a.spans.rate) rateSpelled++
        if (!a.spans.range && !a.spans.rate) neitherSpelled++
        // A leg with no insertion point cannot be edited at all, and the control
        // must be offered disabled rather than broken. If this ever leaves zero,
        // that path stopped being hypothetical and needs its own arm.
        if (a.spans.chainEnd === null) noChainEnd++
        if (!a.spans.rate) {
          if (a.periodCycles === 1) rateAbsent++
          else rateAmbiguous++
        }
      }
    }

    // The load-bearing claims, stated as properties rather than as arithmetic on
    // the pinned totals — these are what the design rests on.
    expect(parsed).toBeGreaterThan(0)
    expect(automations).toBeGreaterThan(0)
    expect(neitherSpelled, 'the insert path in captionEdit would be dead code').toBeGreaterThan(0)
    expect(rangeSpelled + neitherSpelled).toBeLessThanOrEqual(automations)

    // And the pin. If this moves, the corpus or the reader moved — read the diff,
    // then update BOTH this object and the figures quoted on `SignalSpans`.
    // The reach question a rate control has to answer before it is designed.
    expect(rateSpelled + rateAbsent + rateAmbiguous).toBe(automations)

    expect({ automations, rangeSpelled, rateSpelled, neitherSpelled, noChainEnd, rateAbsent, rateAmbiguous }).toEqual({
      automations: 200,
      rangeSpelled: 180,
      rateSpelled: 128,
      neitherSpelled: 16,
      // Never null on any real document today. The disabled-control path this
      // would trigger is therefore UNEXERCISED, not proven — if this leaves
      // zero, that path needs an arm before it is trusted.
      noChainEnd: 0,
      // Every automation a rate control cannot replace into is one that spells
      // NO rate at all — insertable at `chainEnd`, which is non-null throughout.
      rateAbsent: 72,
      // ZERO. The multi-arm guard in `readChain` protects a tree no real
      // document produces, which is what its own comment claims and this is the
      // evidence for. It stays: the cost is one integer and the failure it
      // prevents is a silently wrong document. But a rate control needs no
      // decline path for it on any corpus input.
      rateAmbiguous: 0,
    })
  })
})
