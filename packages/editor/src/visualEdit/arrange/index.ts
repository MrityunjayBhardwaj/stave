/**
 * Arrangement write-back — combinator-arm parser + serializer (Phase 5b, #437).
 *
 * The JS-argument-altitude sibling of `notation/` (which is mini-notation
 * CONTENT). The timeline edits arrangement STRUCTURE (`arrange`/`cat`/`slowcat`
 * arms = clips); these surgical ops ride `writeback`'s reserved
 * `arrange.weights` / `arrange.structure` sources. PV121 / PV122.
 */
export { detectArrangeAt, detectAllArrangeCalls, detectBarePattern } from './parse'
export type { ArrangeCall, ArrangeArmRange, ArrangeMode } from './parse'
export { setWeight, reorderArm, insertArm, insertSilenceArm, removeArm, silenceArm, wrapBare, materializeBareDelete, materializeBareSplit, splitArm, setArmPattern, patternText } from './serialize'
export { renameSection, countSectionArms } from './rename'
export { listSectionParts } from './parts'
