/**
 * pick-control write-back — section-clip parser + serializer (#463 Stage 2).
 *
 * The `pick`/`pickRestart`/`pickReset` sibling of `arrange/`. A pick* track's
 * clips are the weighted arms of its `<…@w …>` CONTROL string (not `[n, pat]`
 * arrange arms); these surgical ops edit that mini-notation directly and ride
 * the SAME `writeback` `arrange.weights` / `arrange.structure` channels. PV127.
 *
 * The serializer ops share names with `arrange/serialize` (setWeight/splitArm/…);
 * the outer barrel re-exports them aliased as `pick*` to avoid a collision.
 */
export { detectPickControlAt, detectAllPickControls } from './parse'
export type { PickControl, PickControlArm, PickMethod, PickSectionEntry } from './parse'
export {
  setWeight,
  splitArm,
  removeArm,
  silenceArm,
  reorderArm,
  insertArm,
  insertSilenceArm,
  duplicateArm,
  renameSection,
  countSectionArms,
  setArmHead,
  listSectionParts,
} from './serialize'
