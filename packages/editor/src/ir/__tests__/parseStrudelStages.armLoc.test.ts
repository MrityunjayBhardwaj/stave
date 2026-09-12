/**
 * A stack arm is addressable by its own source span (#950).
 *
 * The song timeline partitions LANES by IR structure — one lane per stack arm —
 * but attributes MARKS by source containment: each evaluated hap goes to the
 * lane whose `Track` wrapper `loc` is the largest one ≤ the hap's own `loc`
 * (`timelineMarks.ts` `declaredTrackAnchors` → `irLaneFor`). That only works if
 * every arm carries a distinct anchor.
 *
 * Arms coming from real `$:` statements always did — they have a statement
 * offset. Arms produced by expanding a top-level comma inside ONE statement
 * (`$: s("bd, cp")`) had no statement of their own and so got NO `loc` at all.
 * The anchor map came out empty, every hap fell back to the engine trackId
 * (identical for all arms of one statement), and all marks piled onto the first
 * arm while every later arm rendered an empty lane.
 *
 * Nothing threw. Both lanes appeared, so a lane-COUNT assertion cannot see this
 * — it passes just as happily when one of the lanes is blank. The property that
 * discriminates is that the arms have DISTINCT anchors, which is what this pins.
 *
 * Measured in the running app before the fix: `labelOffsetByLane` empty and
 * `marksByLane` `[["d1", 8]]`; after, anchors `[["d1",6],["d2",10]]` and
 * `marksByLane` `[["d1",4],["d2",4]]`.
 *
 * ── WHERE THIS NOW LIVES (#1553) ────────────────────────────────────────────
 * The property is unchanged and still pinned; what moved is WHO PROVIDES IT.
 * It used to be arranged by the staged parser, which fabricated a top-level
 * `Track` wrapper per comma arm so the anchor map would see them. That reshaped
 * the parse tree to serve a presentation need, and it cost the chain: with the
 * arms wrapped there was nowhere to put the thing wrapping THEM, so `.gain()`,
 * `.sound()` and `.room()` applied to the whole stack were dropped outright —
 * six archive documents, one of which kept 7 of its 66 notes.
 *
 * The parse now states the source's own shape (`Track[Param:gain[Stack[…]]]`,
 * byte-identical to `parseStrudel`) and the per-arm lanes are derived in the
 * lane layer from `rootStackArms`. The assertions below read that layer — the
 * same question, asked of whoever answers it. `declaredTrackAnchors` keys the
 * eval-side marks from the same rule, so skeleton and marks cannot drift.
 */
import { describe, it, expect } from 'vitest'
import { IR, type PatternIR } from '../PatternIR'
import {
  runRawStage,
  runMiniExpandedStage,
  runChainAppliedStage,
  runFinalStage,
} from '../parseStrudelStages'
import { runPasses, type Pass } from '../passes'
import { rootStackArms, armSourceSpan } from '../structuralWalk'

const PASSES: readonly Pass<PatternIR>[] = [
  { name: 'RAW', run: runRawStage },
  { name: 'MINI-EXPANDED', run: runMiniExpandedStage },
  { name: 'CHAIN-APPLIED', run: runChainAppliedStage },
  { name: 'Parsed', run: runFinalStage },
]

function pipeline(code: string): PatternIR {
  const passes = runPasses(IR.code(code), PASSES)
  return passes[passes.length - 1].ir
}

/**
 * Every LANE with its containment anchor, as the timeline derives them.
 *
 * ⚠ READS THE LANE LAYER, NOT THE `Track` WRAPPERS (#1553). A comma arm is no
 * longer a `Track` — the parse keeps the stack whole so a chain applied to it
 * survives — so interrogating the wrappers would answer a question nobody is
 * asking. `rootStackArms` + `armSourceSpan` are exactly what
 * `timelineMarks.declaredTrackAnchors` calls, so this pins the value the app
 * actually consumes rather than a proxy for it.
 */
function trackAnchors(ir: PatternIR): Array<[string, number | undefined]> {
  const arms = rootStackArms(ir)
  if (arms) return arms.map(({ arm, laneId }) => [laneId, armSourceSpan(arm)?.start])
  const tracks = ir.tag === 'Stack' ? ir.tracks : [ir]
  const out: Array<[string, number | undefined]> = []
  for (const t of tracks) {
    if (t.tag !== 'Track') continue
    out.push([String(t.trackId), t.loc?.[0]?.start])
  }
  return out
}

describe('stack arms are addressable (#950)', () => {
  it('a comma-expanded arm anchors on its own span, not on nothing', () => {
    //             0123456789...
    // `$: s("bd, cp")` — `bd` at 6, `cp` at 10.
    const anchors = trackAnchors(pipeline('$: s("bd, cp")'))
    expect(anchors).toEqual([
      ['d1', 6],
      ['d2', 10],
    ])
  })

  it('a bracketed stack anchors per arm too (the always-broken spelling)', () => {
    // `$: s("[bd,cp]")` — `bd` at 7, `cp` at 10.
    expect(trackAnchors(pipeline('$: s("[bd,cp]")'))).toEqual([
      ['d1', 7],
      ['d2', 10],
    ])
  })

  it('every arm of a multi-arm stack gets a DISTINCT anchor', () => {
    const anchors = trackAnchors(pipeline('$: s("bd*2, ~ sd, hh*4")'))
    expect(anchors).toHaveLength(3)
    const starts = anchors.map(([, start]) => start)
    expect(starts.every((s) => typeof s === 'number')).toBe(true)
    expect(new Set(starts).size).toBe(3)
    // Ascending, so `largest anchor ≤ hap start` partitions the mini BY ARM.
    expect([...starts].sort((a, b) => (a as number) - (b as number))).toEqual(starts)
  })

  it('a chain on the stack does not widen an arm into its neighbour', () => {
    // `.gain(...)` applies to the whole stack, so its `loc` must not enter any
    // arm's subtree — if it did, both arms would extend to the chain call and
    // their spans would overlap, breaking the ordering containment relies on.
    for (const code of ['$: s("bd, cp").gain(0.5)', '$: s("bd, cp").slow(2).room(0.3)']) {
      const spans = trackAnchors(pipeline(code)).map(([, start]) => start)
      expect(spans).toEqual([6, 10])
    }
  })

  it('real `$:` statements still anchor on the STATEMENT, byte-identically', () => {
    // The pre-existing path: two statements, anchored at their `$:` offsets
    // (0 and 11), NOT at their minis (6 and 17). Unchanged by the fix.
    expect(trackAnchors(pipeline('$: s("bd")\n$: s("cp")'))).toEqual([
      ['d1', 0],
      ['d2', 11],
    ])
  })

  it('a named track keeps its statement anchor', () => {
    expect(trackAnchors(pipeline('drums: s("bd")\nlead: s("cp")'))).toEqual([
      ['drums', 0],
      ['lead', 15],
    ])
  })
})
