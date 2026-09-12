/**
 * Test stub for the `structuralWalk` dependency timelineMarks / FullSongTimeline now pull from
 * `@stave/editor`. The app tests mock the whole barrel (it drags CJS `gifenc` into vitest, which
 * breaks the loader — see the mock comments), so they cannot get structuralWalk from it. This
 * re-exports the REAL walk + reducer straight from source (pure, type-only imports, no gifenc),
 * so the mocks derive lane skeletons the SAME way production does — never a hand-rolled copy of
 * the reducer, which would be a second oracle free to drift (PV192).
 */
import {
  aggregateLaneItems,
  structuralWalk,
  wholeWalkWindow,
  rootStackArms,
  armSourceSpan,
  type LaneItem,
  type WalkWindow,
} from '../../../../../editor/src/ir/structuralWalk'
import type { IREvent } from '../../../../../editor/src/ir/IREvent'

// `wholeWalkWindow` is re-exported because production calls it (the bare-song
// probe), and a barrel mock that omits it hands the component `undefined` —
// which tsc cannot see, since a `vi.mock` factory is untyped.
// `rootStackArms`/`armSourceSpan` join them for the same reason, and #1553 is
// the case that proves the reason: `declaredTrackAnchors` derives a comma
// stack's per-arm anchors from them, so a barrel mock that omits them anchors
// every arm at 0 and folds the lanes back together — the exact #950 failure,
// reintroduced by the mock rather than by the code under test.
export { structuralWalk, wholeWalkWindow, rootStackArms, armSourceSpan }

/**
 * Reduce collect-style events to lane skeletons exactly as `structuralWalk` aggregates its own
 * walk items — the identical event→LaneItem mapping the corpus gate's oracle uses
 * (`structuralWalk.test.ts` `collectLanes`). Lets a synthetic-event mock produce the structure
 * maps without a real IR to walk, while still routing through the production reducer.
 */
export function skeletonsFromEvents(
  events: readonly Partial<IREvent>[],
  window: WalkWindow,
): ReturnType<typeof aggregateLaneItems> {
  const items: LaneItem[] = events.map((ev) => ({
    laneKey: ev.trackId ?? ev.s ?? '$default',
    cycle: Math.floor(ev.begin ?? 0),
    ...(ev.dollarPos !== undefined ? { dollarPos: ev.dollarPos } : {}),
    ...(ev.leafIndex !== undefined ? { leafIndex: ev.leafIndex } : {}),
    ...(ev.armIndex !== undefined ? { armIndex: ev.armIndex } : {}),
    ...(ev.loc ? { loc: ev.loc } : {}),
    labelValue: ev.s ?? (ev.note != null ? String(ev.note) : undefined),
  }))
  // The window travels straight through — a mock that dropped it would report
  // the same skeletons at every origin, which is the defect #1209 fixed.
  return aggregateLaneItems(items, window)
}
