/**
 * An arrangement whose WEIGHT is an expression draws as an arrangement (#1514).
 *
 * ── WHY THIS EXISTS, AND WHY IT DRIVES THE STAGED PIPELINE ───────────────────
 * `parseStrudel` has read `[M*8, …]` since #1468: it collects the document's
 * numeric bindings once and resolves the weight through them. The TIMELINE does
 * not run `parseStrudel` — it runs the four staged passes, and that copy
 * collected no numeric map at all. So `detectArrangeAt` reported two arms,
 * `songExtent` reported the right length, every serializer handled the input
 * correctly, and the timeline still drew ONE bare clip with `armIndex: -1`.
 * Every clip gesture keys off a real arm, so all of them declined at once —
 * each of them correctly, given what it was handed.
 *
 * A unit arm on either parser alone cannot see that: they disagreed, and the
 * one under test was the one that was right. So these arms drive the same
 * pipeline the app wires in `StrudelEditorClient` and assert on the far end —
 * the arm indices the gestures actually read.
 *
 * ⚠ AND THEY ARE WRITTEN IN BOTH SPELLINGS ON PURPOSE. The bare document and
 * the `$:` track take DIFFERENT branches through MINI-EXPANDED (`buildBindingMap`
 * vs the RAW binding meta), so a suite that only ever wrote one of them would
 * leave the other free to regress in silence — which is exactly how this defect
 * survived (#1517's lesson, applied while it is still cheap).
 */
import { describe, it, expect, vi } from 'vitest'

// Same barrel mock as the harnesses next door: no IR events, so lane structure
// comes from the REAL `structuralWalk` over the REAL IR rather than from
// collect's events. That is the path that carries `armIndex`.
vi.mock('@stave/editor', async () => ({
  collectCycles: () => [],
  structuralWalk: (await import('./structuralWalkTestStub')).structuralWalk,
  wholeWalkWindow: (await import('./structuralWalkTestStub')).wholeWalkWindow,
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

/** Does the parsed IR contain an `Arrange` node at all? */
function hasArrange(ir: PatternIR): boolean {
  let found = false
  const walk = (n: unknown): void => {
    if (found || !n || typeof n !== 'object') return
    if ((n as { tag?: string }).tag === 'Arrange') { found = true; return }
    for (const v of Object.values(n as Record<string, unknown>)) {
      if (Array.isArray(v)) v.forEach(walk)
      else if (v && typeof v === 'object') walk(v)
    }
  }
  walk(ir)
  return found
}

/** Every clip the timeline would draw, as `armIndex@startCycle..endCycle`. */
function clipShape(code: string, cycles: number): string[] {
  const marks = collectNoteMarks(
    [] as unknown as Parameters<typeof collectNoteMarks>[0],
    pipeline(code),
    wholeSongWindow(cycles),
  )
  return [...marks.clipsByLane.values()]
    .flat()
    .map((c) => `${c.armIndex}@${c.startCycle}..${c.endCycle}`)
}

/** The same, grouped by lane — lane order as the document declares it. */
function clipShapeByLane(code: string, cycles: number): string[][] {
  const marks = collectNoteMarks(
    [] as unknown as Parameters<typeof collectNoteMarks>[0],
    pipeline(code),
    wholeSongWindow(cycles),
  )
  return [...marks.clipsByLane.values()].map((clips) =>
    clips.map((c) => `${c.armIndex}@${c.startCycle}..${c.endCycle}`),
  )
}

// The SAME song, four ways. `M * 2` is 2, so every one of these is the same
// music and must draw the same clips — that equality is the assertion, rather
// than a literal arm count, because it cannot be satisfied by a coincidence.
const BARE_LITERAL = `let M = 2
arrange([2, s("bd")], [4, s("hh")])`
const BARE_EXPRESSION = `let M = 2
arrange([M, s("bd")], [M * 2, s("hh")])`
const DOLLAR_LITERAL = `let M = 2
$: arrange([2, s("bd")], [4, s("hh")])`
const DOLLAR_EXPRESSION = `let M = 2
$: arrange([M, s("bd")], [M * 2, s("hh")])`

describe('#1514 — an expression weight still draws arms', () => {
  it('the bare document draws the same clips either way', () => {
    const literal = clipShape(BARE_LITERAL, 6)
    expect(literal).toEqual(['0@0..2', '1@2..6'])
    expect(clipShape(BARE_EXPRESSION, 6)).toEqual(literal)
  })

  it('the `$:` document draws the same clips either way — the ordinary spelling', () => {
    // This is the branch that was broken in the app: a `$:` track's lifted code
    // is its expression ALONE, so the `let M = 2` line is not in it and only
    // document-scope meta can carry the number. It drew `['-1@0..6']` before —
    // ONE bare clip, the shape a document with no arrangement at all produces.
    const literal = clipShape(DOLLAR_LITERAL, 6)
    expect(literal).toEqual(['0@0..2', '1@2..6'])
    expect(clipShape(DOLLAR_EXPRESSION, 6)).toEqual(literal)
  })

  it('a multi-track document resolves the weight on every track', () => {
    const code = `let M = 2
$: arrange([M, s("bd")], [M * 2, s("hh")])
$: arrange([M * 3, s("cp")])`
    // ⚠ Read PER LANE, not flattened. A flattened `toContain` cannot say WHICH
    // lane produced a clip, so "track 2 resolved and track 1 did not" would
    // satisfy it — and the whole claim of this arm is that the same document
    // map reaches EVERY track.
    expect(clipShapeByLane(code, 6)).toEqual([
      ['0@0..2', '1@2..6'],
      ['0@0..6'],
    ])
  })

  it('a weight that is NOT knowable is still declined, not guessed', () => {
    // The boundary, pinned as a test rather than a comment. A weight is a
    // POSITION — arm k starts at the sum of every earlier weight — so an
    // unreadable one cannot be defaulted to 1 the way an unreadable item can be
    // dropped. `f()` is a call, and a call is not a number we can know, so the
    // arrangement stays opaque and the timeline draws its one implicit clip.
    // Widening this is a different decision from #1514 and must be made on
    // purpose.
    //
    // ⚠ Asserted on the IR rather than on an EMPTY clip list. This harness
    // feeds no haps, so an opaque body yields no marks and therefore no clips
    // — `[]` here would be satisfied by any breakage upstream of the question
    // being asked. The positive artefact is the node itself: no `Arrange`.
    const declined = 'let M = 2\n$: arrange([f(), s("bd")], [2, s("hh")])'
    expect(hasArrange(pipeline(declined))).toBe(false)
    // and the control, which says the assertion above can fail: the same
    // document with a knowable weight DOES arrange.
    expect(hasArrange(pipeline(DOLLAR_EXPRESSION))).toBe(true)
    expect(clipShape(declined, 6).some((c) => !c.startsWith('-1@'))).toBe(false)
  })
})
