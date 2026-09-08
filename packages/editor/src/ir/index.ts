// IR types — the universal music representation
export type { IREvent, SourceLocation } from './IREvent'
export type { IRPattern } from './IRPattern'

// Transforms — pure functions on IR events/patterns
export { merge, transpose, timestretch, filter, scaleGain } from './transforms'

// PatternIR — free monad over musical effects
export type { PatternIR, PlayParams } from './PatternIR'
export { IR } from './PatternIR'

// Serializer
export { toStrudel } from './toStrudel'

// Structural walk (#945/#974) — lane anchors from source structure alone, no onsets. The
// "keep" half of the collect split: the timeline joins queryArc haps to these lanes by
// source-span containment, and the walk survives mid-edit code where evaluate() throws.
export {
  structuralWalk,
  aggregateLaneItems,
  walkLeafItems,
  walkLeafItemsInWindow,
  wholeWalkWindow,
} from './structuralWalk'
export type { LaneSkeleton, LaneItem, WalkWindow } from './structuralWalk'
// Node identity — content-addressed irNodeIds for IR nodes (a structural
// property, not a behavioural one). `buildNodeLocIndex` is the eval-path
// loc→irNodeId lookup the engine feeds to `normalizeStrudelHap`, replacing the
// collect-derived one (#975/#982).
export { buildNodeLocIndex, fnv1a, assignNodeId } from './nodeIdentity'

// Full-song analysis (#385) — progressive-horizon period/section/lane analysis
export {
  analyzeSong,
  analyzeEvents,
  accumulateLanes,
  cycleFingerprints,
  detectPeriod,
  computeSections,
  laneKeyOf,
  // #1465 — the source-informed facts the period rule needs, read off the IR
  // by the caller because `analyzeSong` only ever sees events.
  signalDimensionsOf,
  // Windowed collection (#1108) — paging past the first span on the branch
  // where no period was found.
  analyzeWindow,
  accumulateLanesInWindow,
  computeSectionsInWindow,
} from './songAnalysis'
export type {
  SongAnalysis,
  DisplaySpan,
  LaneActivity,
  SongSection,
  AnalyzeSongOptions,
  SignalDimensions,
  WindowAnalysis,
  AnalyzeWindowOptions,
} from './songAnalysis'

// Structural song extent (#1359) — the length question answered off the IR,
// with no evaluation and no window. Exported for the bounce (#1365), which is
// the first production caller; `songExtent`'s own header says why the display
// span cannot size a render.
export { songExtent } from './songExtent'
export type { SongExtent } from './songExtent'

// Continuous automation read off the IR (#1464 Stage 1, moved here by #1489).
// Two questions on the same nodes, deliberately different: `signalAutomations`
// asks "can I PLOT this?" and abstains without a closed form, while
// `signalCarryingParamKeys` asks "does this control MOVE?" and never abstains.
// It lives beside the IR rather than beside its first consumer because it reads
// nothing else — and because `songAnalysis` needs it too, which a module in
// `@stave/app` could not serve (the dependency only runs app -> editor).
export { signalAutomations, signalCarryingParamKeys } from './signalAutomation'
export type { SignalAutomation, SignalKind } from './signalAutomation'

// Event identity (#1102) — exported so the NEXT consumer asking "are these two
// events the same sound" finds the one answer instead of curating its own field
// list, which is exactly how the period bug got in.
export { eventValueKey } from './eventValueKey'

// Serialization
export { patternToJSON, patternFromJSON, PATTERN_IR_SCHEMA_VERSION } from './serialize'

// Parsers
export { parseMini } from './parseMini'
export { parseStrudel, classifyLiteralRhs } from './parseStrudel'

// Phase 19-07 (#79) — staged parser pipeline. Each stage helper runs
// PatternIR → PatternIR; STRUDEL_PASSES wires them as named passes so
// the IR Inspector renders one tab per stage. End-to-end FINAL output
// is byte-identical to parseStrudel(code).
export {
  runRawStage,
  runMiniExpandedStage,
  runChainAppliedStage,
  runFinalStage,
} from './parseStrudelStages'

// Pass runner — runtime-neutral IR→IR transform machinery
export type { Pass } from './passes'
export { runPasses } from './passes'
