/**
 * Marks land on the stack arm that produced them (#950).
 *
 * Lanes are partitioned by IR structure — one per stack arm — while marks are
 * attributed by source containment. For arms that come from expanding a
 * top-level comma inside ONE `$:` statement there is no statement offset to
 * anchor on, so the arms used to share no anchor at all: the map came out empty,
 * every hap fell back to the engine trackId (identical for all arms of one
 * statement), and all marks piled onto the first arm while the rest rendered
 * empty lanes.
 *
 * The other tests in this directory mock `collectCycles` into RETURNING IR
 * events, which supplies anchors via `dollarPos`. That is the wrong scenario
 * here: #950's anchors come from `declaredTrackAnchors` reading the Track
 * wrappers on the IR itself. So this file mocks `collectCycles` to return
 * NOTHING, which is what forces the wrapper path — and it builds the IR by
 * running the REAL staged pipeline over real source, so the anchors under test
 * are the ones the app actually gets rather than a hand-drawn imitation.
 *
 * Only the haps are synthetic, and their offsets are the real ones: in
 * `$: s("bd, cp")` the two atoms sit at 6 and 10.
 */
import { describe, it, expect, vi } from 'vitest'

// No IR events → the pre-eval collect path is empty, which is exactly the #950 situation.
// STRUCTURE now comes from the REAL `structuralWalk` on the REAL IR these tests build via the
// staged pipeline — so this file genuinely exercises structuralWalk's comma-arm lane split
// (#974), not a stub. `laneKeyOf` keeps its real behaviour.
vi.mock('@stave/editor', async () => ({
  collectCycles: () => [],
  structuralWalk: (await import('./structuralWalkTestStub')).structuralWalk,
  // Production calls this (the whole-song anchor pass); a barrel mock that omits
  // it hands `undefined` to a call site tsc cannot check, because a vi.mock
  // factory is untyped.
  wholeWalkWindow: (await import('./structuralWalkTestStub')).wholeWalkWindow,
  // #1553 — `declaredTrackAnchors` derives a comma stack's per-arm anchors
  // from these. Omitted, they are `undefined` at an untyped call site and every
  // arm anchors at 0, which folds the lanes back together and fails these very
  // tests for a reason that has nothing to do with the code under test.
  rootStackArms: (await import('./structuralWalkTestStub')).rootStackArms,
  armSourceSpan: (await import('./structuralWalkTestStub')).armSourceSpan,
  laneKeyOf: (ev: { trackId?: string; s?: string }) => ev?.trackId ?? ev?.s ?? '$default',
}))

import { collectNoteMarks } from '../timelineMarks'
import { wholeSongWindow } from '../songAxis'
import { IR, type PatternIR } from '../../../../../editor/src/ir/PatternIR'
import {
  runRawStage,
  runMiniExpandedStage,
  runChainAppliedStage,
  runFinalStage,
} from '../../../../../editor/src/ir/parseStrudelStages'
import { runPasses, type Pass } from '../../../../../editor/src/ir/passes'

const PASSES: readonly Pass<PatternIR>[] = [
  { name: 'RAW', run: runRawStage },
  { name: 'MINI-EXPANDED', run: runMiniExpandedStage },
  { name: 'CHAIN-APPLIED', run: runChainAppliedStage },
  { name: 'Parsed', run: runFinalStage },
]
const pipeline = (code: string): PatternIR => {
  const passes = runPasses(IR.code(code), PASSES)
  return passes[passes.length - 1].ir
}

/** A hap located at `start`, carrying a trackId shared by every arm — which is
 *  what the engine really does for one `$:` statement, and why trackId alone
 *  cannot separate the arms. */
const hapAt = (start: number, note: string) => ({
  begin: 0,
  end: 0.5,
  trackId: '$0',
  note,
  gain: 1,
  loc: [{ start, end: start + 2 }],
})

describe('stack-arm mark attribution (#950)', () => {
  it('splits marks across the arms of one comma-expanded statement', () => {
    // `$: s("bd, cp")` — `bd` at 6, `cp` at 10. Both haps share trackId `$0`.
    const haps = [hapAt(6, 'C3'), hapAt(10, 'E3')] as unknown as Parameters<
      typeof collectNoteMarks
    >[0]

    const marks = collectNoteMarks(haps, pipeline('$: s("bd, cp")'), wholeSongWindow(4))

    expect(marks.marksByLane.get('d1')).toHaveLength(1)
    expect(marks.marksByLane.get('d2')).toHaveLength(1)
    // The pre-fix failure: everything on d1 and d2 empty.
    expect(marks.marksByLane.get('d1')).not.toHaveLength(2)
  })

  it('anchors each arm so containment can separate them', () => {
    // Anchor seeding only runs on the EVAL path (it exists to place located
    // haps), so this needs at least one hap to exercise it.
    const haps = [hapAt(6, 'C3')] as unknown as Parameters<typeof collectNoteMarks>[0]
    const marks = collectNoteMarks(haps, pipeline('$: s("bd, cp")'), wholeSongWindow(4))
    expect([...marks.labelOffsetByLane]).toEqual([
      ['d1', 6],
      ['d2', 10],
    ])
  })

  it('handles a three-arm stack whose arms are not bare atoms', () => {
    // `$: s("bd*2, ~ sd, hh*4")` — arm spans [6,10], [12,16], [18,22]. The
    // middle arm is a Seq with no `loc` of its own and the outer arms are
    // combinators whose `loc` covers the operator, so the anchor has to come
    // from the arm's subtree extent.
    const haps = [hapAt(6, 'C3'), hapAt(14, 'E3'), hapAt(18, 'G3')] as unknown as Parameters<
      typeof collectNoteMarks
    >[0]

    const marks = collectNoteMarks(haps, pipeline('$: s("bd*2, ~ sd, hh*4")'), wholeSongWindow(4))

    expect(marks.marksByLane.get('d1')).toHaveLength(1)
    expect(marks.marksByLane.get('d2')).toHaveLength(1)
    expect(marks.marksByLane.get('d3')).toHaveLength(1)
  })

  it('renders the bracketed and comma spellings identically (they are one pattern)', () => {
    const haps = [hapAt(7, 'C3')] as unknown as Parameters<typeof collectNoteMarks>[0]
    const bracketed = collectNoteMarks(haps, pipeline('$: s("[bd,cp]")'), wholeSongWindow(4))
    // Same arm count, each separately anchored — only the offsets differ by the
    // bracket character.
    expect([...bracketed.labelOffsetByLane]).toEqual([
      ['d1', 7],
      ['d2', 10],
    ])
  })
})
