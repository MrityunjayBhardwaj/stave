import { I as IREvent, a as IRPattern, P as PatternIR, S as SourceLocation, L as LiveCodingEngine, E as EngineComponents, H as HapEvent, b as HapStream, c as PatternScheduler, V as VizDescriptor, d as VizRenderer, e as VizOptions, f as P5SketchFactory, g as VizQualityLevel, h as StreamingComponent, A as AudioComponent, Q as QueryableComponent, i as InlineVizComponent, j as VizRendererSource } from './vizConfig-yFweRUIY.js';
export { D as DEFAULT_VIZ_CONFIG, k as DEFAULT_VIZ_QUALITY, l as IR, m as IRComponent, n as PlayParams, o as VizConfig, p as VizQualitySettings, q as VizRefs, W as WorkerVizConfig, r as createVizConfig, s as deriveVizQuality, t as getVizConfig, u as setVizConfig, v as updateVizConfig } from './vizConfig-yFweRUIY.js';
import * as react_jsx_runtime from 'react/jsx-runtime';
import * as React from 'react';
import React__default, { ReactNode } from 'react';
import * as Monaco from 'monaco-editor';
import 'p5';

/**
 * Pure transform functions on IREvent arrays.
 *
 * No classes, no state. Each function takes events in, returns events out.
 * Composable: transpose(filter(events, pred), 12)
 */

/**
 * Merge multiple patterns into one. Events from all sources appear
 * in the merged query result, sorted by begin time.
 *
 * CONSTRAINT: All patterns must use the same time domain (all cycles
 * or all audio-seconds). Merging across time domains is undefined.
 */
declare function merge(patterns: IRPattern[]): IRPattern;
/**
 * Transpose note values by a number of semitones.
 * String notes are left unchanged (no enharmonic spelling logic).
 */
declare function transpose(events: IREvent[], semitones: number): IREvent[];
/**
 * Scale time positions by a factor.
 * factor < 1 = compress (faster), factor > 1 = stretch (slower).
 */
declare function timestretch(events: IREvent[], factor: number): IREvent[];
/**
 * Filter events by predicate. Returns only events where pred returns true.
 */
declare function filter(events: IREvent[], pred: (e: IREvent) => boolean): IREvent[];
/**
 * Scale gain of all events by a factor.
 */
declare function scaleGain(events: IREvent[], factor: number): IREvent[];

/**
 * toStrudel — PatternIR → Strudel code string interpreter.
 *
 * Generates valid Strudel code from a PatternIR tree.
 * The generated code should be evaluatable by StrudelEngine.
 *
 * Design decision: Simple Seq nodes where all children are Play nodes
 * collapse into mini-notation ("c4 e4 g4") for idiomatic Strudel output.
 * Any Seq with non-Play children uses explicit method chains.
 */

/** Generate Strudel code from a PatternIR tree. */
declare function toStrudel(ir: PatternIR): string;

/**
 * structuralWalk — the "keep" half of the collect.ts split (#945).
 *
 * `collect.ts` conflates two jobs: deriving lane STRUCTURE from source spans, and computing
 * BEHAVIOUR (onsets) by re-implementing Strudel's RNG / euclid / weighting. The split moves
 * behaviour to Strudel's own `queryArc` and keeps structure here — because the lane anchors
 * (`dollarPos` / `leafIndex` / `armIndex`) are sourced from source-span structure, which haps
 * do not carry, so haps must JOIN to a structural walk rather than replace it. See
 * `COLLECT-SPLIT-AUDIT.md` for the consumer map and `collect.ts:486/651/745` for where the
 * anchors are set today.
 *
 * This walk owns two properties the hap stream cannot give:
 *   1. the anchors above (lane / voice-row / clip identity from source position); and
 *   2. per-node resilience — a syntactically-valid but semantically-invalid sub-node (an
 *      unresolved binding, a mid-edit) degrades only its own lane, where `evaluate` throws and
 *      blanks everything. The timeline's lane skeleton must survive mid-edit code.
 *
 * Phase 1 (#973) IMPLEMENTS the seam by mirroring collect's ANCHOR threading (Track → dollarPos
 * outer-wins + leafIndex reset; voice-Stack → sequential leafIndex; Arrange/Cycle → per-cycle
 * arm selection) and its `withWrapperLoc` loc-layering, while DROPPING the behaviour (timing,
 * window-clip, RNG, euclid). It emits one structural item per leaf reached, then aggregates to
 * per-lane skeletons with the SAME first-wins rules `timelineMarks.ts` applies to collect's
 * events — so `aggregateLaneItems` is shared with the gate's oracle and the two cannot drift.
 *
 * A structural walk reaches leaves collect's onset/window logic would drop, so structuralWalk
 * may report ADDITIONAL lanes (the resilience it adds). For every lane collect DOES produce,
 * the anchors match byte-for-byte — proven over the corpus by `structuralWalk.test.ts`.
 */

/**
 * One lane of the timeline, described purely by SOURCE STRUCTURE — no onsets, no timing.
 * Marks (which notes play, and when) are joined on later from `queryArc` haps by source-span
 * containment (Phase 2, #974). Every offset is a char position into the evaluated source.
 *
 * Mirrors the per-lane maps `timelineMarks.ts` builds today from the event stream
 * (`labelOffsetByLane` / `sourceByLane` / `arrangeByLane` / `armByCycleByLane` /
 * `armLabelByLane`) — but produced directly from the IR, not reduced from onsets.
 */
interface LaneSkeleton {
    /** Lane identity — the same key `laneKeyOf` derives, so hap attribution and the structural
     *  walk agree on which lane is which. */
    laneKey: string;
    /** `$:`/`bass:` statement offset — the label anchor (`dollarPos`; `collect.ts:486`). Absent
     *  for a hand-built or single-expression IR with no statement. */
    dollarPos?: number;
    /** Innermost content anchor — the leaf/mini offset used for expand→bind (the first-event
     *  `loc[0].start` `sourceByLane` keeps today). */
    sourceOffset?: number;
    /** Outermost combinator offset — the `arrange`/`cat` call start used for clip gestures
     *  (`arrangeByLane`; excludes the `$:` wrapper loc per #456). */
    arrangeOffset?: number;
    /** Voice-row index within a `stack(...)` (`leafIndex`; `collect.ts:651`). Absent for a
     *  single-voice lane. */
    leafIndex?: number;
    /** Active arrange arm (clip) per integer cycle (`armByCycleByLane`). Absent for a lane with
     *  no arrangement combinator. Length == the window's `spanCycles`, and index 0 is the
     *  window's `originCycle` — WINDOW-RELATIVE, the same deliberate asymmetry
     *  `LaneActivity.onsetsByCycle` carries (an array cannot be indexed from 256 without wasting
     *  the prefix). Every cycle the consumer then PUBLISHES is song-absolute, so the one place
     *  that adds the origin back is the clip run-length encoder in `timelineMarks`. */
    armByCycle?: Array<number | undefined>;
    /** Arm index → its display label (first arm event's sample/note; `armLabelByLane`). */
    armLabels?: Map<number, string>;
    /** Arm index → the `[n, pat]` tuple's source range (#1391). The consumer slices
     *  the user's code at it to resolve the section's NAME. */
    armRanges?: Map<number, readonly [number, number]>;
}
/**
 * A single structural leaf hit — the raw input to `aggregateLaneItems`. Both structuralWalk
 * (from the IR) and the gate's oracle (from collect's `IREvent[]`) produce these, so the
 * per-lane reduction is byte-identical by construction.
 */
interface LaneItem {
    laneKey: string;
    /** Integer cycle this leaf was reached in (`floor(begin)` for a collect event). */
    cycle: number;
    dollarPos?: number;
    leafIndex?: number;
    armIndex?: number;
    loc?: readonly SourceLocation[];
    /** `s ?? String(note)` — the arm-label source (`armLabelByLane`). */
    labelValue?: string;
    /** SOURCE RANGE of the arrange arm this leaf plays under — the `[n, pat]`
     *  tuple's `[start, end)` (#1391). Carries the arm's own provenance out of the
     *  walk so a consumer can read the SECTION NAME off the source, the way
     *  `dollarPos` lets it read a track's label. Absent when the arm has no `loc`
     *  (hand-built fixtures) or the leaf plays under no arrangement. */
    armRange?: readonly [number, number];
}
/**
 * The stretch of song a walk covers (#1209).
 *
 * ── WHY ORIGIN AND SPAN TRAVEL AS ONE VALUE ─────────────────────────────────
 * They are both bare cycle counts, so as two positional arguments a swap
 * type-checks and yields a plausible skeleton of the wrong part of the song —
 * the exact failure this parameter was added to prevent, reintroduced through
 * argument order instead of omission. Bundled, it cannot be written.
 *
 * Structurally identical to the view's `SongWindow`, deliberately: the app hands
 * its own window straight in, with no adapter and nothing to keep in step.
 */
interface WalkWindow {
    /** First cycle of the window (inclusive, song-absolute). */
    readonly originCycle: number;
    /** Width of the window in cycles. */
    readonly spanCycles: number;
}
/** The window a whole-song walk uses: `[0, nCycles)`. Named rather than written
 *  as an object literal at each caller so "this one really is the whole song"
 *  is a statement instead of two numbers that happen to start at zero. */
declare function wholeWalkWindow(nCycles: number): WalkWindow;
/**
 * Reduce raw leaf items to per-lane skeletons, first-seen lane order, FIRST-WINS on every
 * anchor — the exact reduction `timelineMarks.ts:133-200` runs over collect's events. Shared
 * between structuralWalk and the corpus gate's oracle so neither can drift from the other.
 *
 * `armByCycle` is sized and indexed against `window`: slot `i` is song cycle
 * `originCycle + i`. An item outside the window is dropped rather than clamped.
 */
declare function aggregateLaneItems(items: readonly LaneItem[], window: WalkWindow): LaneSkeleton[];
/**
 * Walk the IR for lane STRUCTURE over `window`. Anchors only — never computes onsets.
 * Per-node resilient: a bad sub-node degrades its own lane, never the whole walk.
 *
 * The window is REQUIRED rather than defaulted (#1209): every previous caller passed a bare
 * span and got `[0, span)`, which is correct only while nothing pages. A default would let the
 * next caller inherit that assumption silently — and at origin 0 an origin-blind walk and a
 * correct one return the same thing, so no test would ever tell them apart. Callers that
 * genuinely mean the whole song say so with `wholeWalkWindow`.
 */
declare function structuralWalk(ir: PatternIR, window: WalkWindow): LaneSkeleton[];

/**
 * songAnalysis — full-song analysis for the navigable timeline (#385).
 *
 * Re-expresses the reference editor's `analyze`/`attribute` capabilities on
 * top of our IR: query the evaluated pattern over a PROGRESSIVE horizon
 * (hint-seeded, doubling to a cap) in budget-bounded slices, accumulate
 * per-lane onset activity, detect the loop PERIOD from per-cycle fingerprints,
 * and partition the horizon into SECTIONS by active-lane signature.
 *
 * Design SoT: VISUAL-EDITING-AND-SCRUB-DESIGN.md §7.5. Runs off the in-memory
 * IR and NEVER calls `toStrudel` (no fidelity tax). Pure sub-functions operate
 * on already-collected `IREvent[]`; the async `analyzeSong` wrapper owns the
 * budgeted collection. Both the collector, the clock, and the yield primitive
 * are injectable so the slicing logic is deterministic under test.
 *
 * Attribution note: lanes key on `trackId ?? s ?? '$default'` — the SAME key
 * the timeline's `groupEventsByTrack` uses — so analysis lanes line up exactly
 * with rendered rows. `trackId`/`dollarPos` already carry IR-node provenance
 * (assigned by collect.ts), so this is reuse, not a parallel attribution path.
 *
 * Seek caveat (§7.4): a pattern with no exact repeat has no clean loop —
 * `detectPeriod` returns null and the horizon falls back to the analyzed cap.
 *
 * ⚠ THAT CLASS IS MUCH LARGER THAN THE RNG CASE THIS COMMENT USED TO NAME.
 * Since the cycle fingerprint reads the event's whole value partition (#1102),
 * any CONTINUOUSLY MODULATED control — `.cutoff(sine)`, a slow `gain` LFO —
 * makes every cycle genuinely differ, and such a LANE is aperiodic in the only
 * sense this module measures. Swept over 150 real tunes, that took documents
 * landing on the cap from 53 to 69 of the 142 that evaluate.
 *
 * A lane being aperiodic no longer makes the SONG aperiodic (#1104). Once the
 * progressive horizon is exhausted such lanes ABSTAIN and the span comes from
 * the lanes that do loop, which is #488's phasing rule applied to the case the
 * veto used to cover — see `detectDisplayPeriodAtCap`. That returned 20 of the
 * 69 to a real period, so the swept figure was then 49. ⚠ #1107 later moved it
 * to 56 — see the sweep test's own tally line, which carries the whole chain
 * (53 pre-#1102 → 69 post-#1102 → 49 post-#1104 → 56 post-#1107 → 37 post-#1465).
 *
 * Of those, 32 have a single lane, so there is nothing to borrow a period from
 * at all, and what the display should do with them is #1105.
 *
 * ⚠ "APERIODIC UNDER EVERY RULE MEASURED" WAS TRUE WHEN WRITTEN AND IS NOT NOW.
 * #1465 SHIPPED a rule that recovers 19 of the 56 by asking the identity question
 * without the dimensions the document's own SOURCE says are continuously
 * modulated, then folding those signals' own rates back in so the answer is a
 * period the audio honours — an exclusion read structurally from the IR, which is
 * what the earlier probe-window attempt could not do. `signalInformedPeriod`
 * carries the argument; `song-period-signal-fold.test.ts` carries the numbers.
 * That leaves 37 aperiodic at the cap, and they belong to #1105.
 *
 * A DETECTED PERIOD CAN ALSO BE TOO SHORT TO BE THIS SONG'S (#1107). It can be
 * true of everything the analysis has heard and still describe only part of the
 * document — accepted before a track entered, or accepted with a span that
 * excludes one — and either way the missing track draws as an empty, UNMARKED
 * row, indistinguishable from silence. `displayPeriodRule` adds the two
 * plausibility clauses that refuse those spans; swept, they move exactly the
 * seven defective documents and take the at-cap figure 49 → 56.
 */

/**
 * Lane (row) key for an event. Mirrors `groupEventsByTrack`'s key so analysis
 * lanes and rendered timeline rows share identity.
 */
declare function laneKeyOf(ev: IREvent): string;
interface LaneActivity {
    readonly laneKey: string;
    /** `onsetsByCycle[c]` = count of event onsets with `floor(begin) === c`.
     *  Length === `horizonCycles`. */
    readonly onsetsByCycle: readonly number[];
}
interface SongSection {
    /** First cycle of the section (inclusive). */
    readonly startCycle: number;
    /** One past the last cycle (exclusive). */
    readonly endCycle: number;
    /** Lane keys active anywhere in the section, sorted for stable identity. */
    readonly laneKeys: readonly string[];
}
/**
 * The span the view should show, together with WHAT IT MEANS — the analysis's
 * own answer, not a number a consumer has to interpret.
 *
 * ── WHY THIS IS ONE VALUE AND NOT A NUMBER PLUS A BOOLEAN ───────────────────
 * `periodCycles` is a MEASUREMENT; a horizon is where the analysis STOPPED
 * LOOKING. They are different kinds of fact and they were previously told apart
 * by a sibling boolean that reached almost no consumer, so `periodCycles ??
 * horizonCycles` — the idiom that erases the difference — spread through the
 * view instead. Carrying the span and its meaning in one value makes the
 * distinction impossible to drop by accident: you cannot read `cycles` without
 * having `kind` in your hand.
 *
 * The three kinds are the three the view already distinguished by hand:
 *   `loop`    — a period was DETECTED. `cycles` is that period and the lanes
 *               span exactly one of them. This is the only cyclic kind: it is
 *               the only one where cycle `n + cycles` genuinely sounds like `n`.
 *   `capped`  — the horizon grew to its cap without confirming a period.
 *               `cycles` is where we gave up, not a property of the song.
 *   `horizon` — analysis ended before the cap with no period (collection was
 *               aborted, or there was nothing to analyze). `cycles` is what was
 *               actually looked at.
 *
 * ⚠ `capped` and `horizon` both mean "no period was found", and only `capped`
 * says the search was exhausted. They are kept apart because the view says
 * different things about them ("N+ cycles" vs "N cycles"), and collapsing them
 * would reintroduce exactly the erasure this type exists to prevent.
 */
interface DisplaySpan {
    readonly kind: 'loop' | 'capped' | 'horizon';
    /** The span in cycles the view spans. For `loop`, the detected period. */
    readonly cycles: number;
}
interface SongAnalysis {
    /** Detected loop period in cycles, or `null` if none within the horizon.
     *  A MEASUREMENT — for anything asking what the analysis found. A consumer
     *  choosing what to DISPLAY wants `displaySpan` instead. */
    readonly periodCycles: number | null;
    /** Number of cycles actually analyzed. A MEASUREMENT — see `periodCycles`. */
    readonly horizonCycles: number;
    /** Per-lane onset activity across the horizon, in first-seen lane order. */
    readonly lanes: readonly LaneActivity[];
    /** Contiguous sections partitioning `[0, horizonCycles)` by active-lane set. */
    readonly sections: readonly SongSection[];
    /** The span to show and what it means — the single answer for every consumer
     *  deciding geometry, wrapping, or what to tell the user. */
    readonly displaySpan: DisplaySpan;
}
/**
 * Accumulate per-lane onset counts bucketed by integer cycle over
 * `[0, horizon)`. Lane order is first-seen (matching `groupEventsByTrack`).
 * Events whose `floor(begin)` lands outside `[0, horizon)` are ignored.
 *
 * ⚠ A LANE IS CREATED ONLY BY AN ONSET INSIDE THE WINDOW, so narrowing the
 * window filters lane MEMBERSHIP and not merely the counts ([[P405]]). A track
 * whose first onset is later than `horizon` does not go empty — it ceases to
 * exist, and the display then rebuilds its row from the DOCUMENT's track set
 * (#1098) without the silenced treatment a muted track gets, which is how a
 * track playing thousands of notes came to look exactly like one playing none.
 *
 * `analyzeSong` re-accumulates over `[0, period)` when it accepts a period, so
 * that is the call this matters at — and it is safe there BY THE INVARIANT, not
 * by luck: `displayPeriodRule` refuses any period whose span leaves a known lane
 * empty (#1107), so every lane provably has an onset in range.
 */
declare function accumulateLanes(events: readonly IREvent[], horizon: number): LaneActivity[];
/**
 * `accumulateLanes` over an arbitrary window `[originCycle, originCycle + spanCycles)`
 * (#1108). `onsetsByCycle[i]` is the onset count at ABSOLUTE cycle
 * `originCycle + i` — the array is window-relative, everything else the view
 * holds stays song-absolute, and the scene carries the one conversion.
 *
 * ── `pinnedLaneKeys` IS THE POINT OF THIS FUNCTION ──────────────────────────
 * The header above warns that a lane exists only by having an onset inside the
 * window, so narrowing the window filters MEMBERSHIP and not merely counts. At
 * the period-trim call that is safe by an invariant — `displayPeriodRule`
 * refuses any period whose span leaves a known lane empty (#1107). **A paged
 * window has no such invariant**: nothing refuses window `[256, 512)` because
 * some track happens to be silent through it. Without a pin, paging re-opens
 * #1098/#1107 exactly — a track playing thousands of notes elsewhere in the
 * song draws as an empty, unmarked row, indistinguishable from silence.
 *
 * Membership is the UNION of the pin and what this window heard, which is the
 * only rule that avoids BOTH failures:
 *   - pinned but silent here  → an empty row, present and legible as silent
 *     (drop it and the track vanishes — the #1098 defect)
 *   - heard here but unpinned → appended
 *     (drop it and a track entering at cycle 300 is invisible forever, which is
 *      the same defect mirrored, and the one a strict pin would introduce)
 * Pinned keys come first, in the order given, so rows do not reorder as the
 * user pages; newly-seen lanes follow in first-seen order.
 */
declare function accumulateLanesInWindow(events: readonly IREvent[], originCycle: number, spanCycles: number, pinnedLaneKeys?: readonly string[]): LaneActivity[];
/**
 * Per-cycle fingerprint string — a sorted signature of every onset's
 * (lane, within-cycle offset, VALUE) in that cycle. Two cycles with identical
 * fingerprints are musically identical, which is what period detection needs.
 * Within-cycle offset is quantised to 1e-6 to absorb float noise from the
 * rational→number conversion in collect.
 *
 * The value half is `eventValueKey` — the adapter's WHOLE value partition, not
 * a subset curated here. It used to be `ev.note` alone, which meant an
 * arrangement whose sections differ only by which SAMPLE plays fingerprinted as
 * identical cycles: `detectPeriod` honestly returned 1 and the Song view's
 * display span collapsed to a single cycle (#1102). `s` had only ever reached
 * this token by accident, via `laneKeyOf`'s `trackId ?? s` fallback, so every
 * event carrying a real `trackId` — which is every event in production — lost
 * it. Naming `s` here would have fixed the one fixture and left the param and
 * gain axes just as blind; the fix is to stop curating (see `eventValueKey`).
 */
declare function cycleFingerprints(events: readonly IREvent[], horizon: number): string[];
/**
 * Smallest period `p` in `[1, floor(len/2)]` such that every cycle equals the
 * cycle `p` ahead of it — and at least two full repetitions exist (`len >= 2p`)
 * so a one-off prefix can't masquerade as a period. Returns `null` when no
 * such period exists within the analyzed length.
 */
declare function detectPeriod(fingerprints: readonly string[]): number | null;
/**
 * THE display-period rule — the combine step plus the two plausibility clauses,
 * in ONE definition so the decision that ends the analysis cannot be made by a
 * different rule than the one that drove it ([[P403]]).
 *
 * ── THE COMBINE STEP is situation-aware (#1104) ──────────────────────────────
 * At the cap the veto has nowhere to grow and lanes with no loop of their own
 * ABSTAIN; below it the veto stands, because a `null` there is what buys the
 * next doubling. `detectDisplayPeriodAtCap`'s own header carries that argument.
 *
 * ── THE PLAUSIBILITY CLAUSES (#1107) ─────────────────────────────────────────
 * A detected period can be true of everything the analysis has HEARD and still
 * be false about the song, and both ways it fails leave a track drawing as an
 * empty, unmarked row — pixel-identical to a track that plays nothing, and
 * without even the fade a muted one gets.
 *
 * (a) UNHEARD TRACK — the analysis converged before a track entered. Measured on
 *     the corpus: `0/-Hx1rNCmeyD8` accepts period 1 at horizon 8 while its other
 *     six tracks first sound at cycles 16, 32, 56, 95, 128 and 159. Nothing here
 *     can detect that, because those events have not been collected — only the
 *     caller knows the document declares tracks it has not heard from, so it is
 *     asked (`hasUnheardTrack`). Gated to `horizon < cap` for the same reason
 *     abstention is gated to the cap: below it a `null` is the signal that grows
 *     the horizon, and at the cap there is nowhere left to grow, so an unheard
 *     track must not be able to block an answer forever. That bound is what
 *     makes the clause verdict-NEUTRAL for a track that is simply silent: six
 *     corpus documents register a pattern that never sounds in 256 cycles, and
 *     all six keep their exact period — they only take longer to reach it.
 *
 * (b) EXCLUDED LANE — the analysis heard the track and then accepted a span that
 *     excludes it. `250/19FzyPQc7bcR` accepts period 6 while `x4` first sounds at
 *     cycle 6 and `x5` at cycle 23, putting ~98.6% of the document's onsets and
 *     2 of its 5 tracks outside the view, on a document whose own `.mask()`s
 *     spell a 32–64-cycle arrangement.
 *
 * Swept per document, both clauses together move EXACTLY the seven defective
 * documents and nothing else — every one recovering its full lane set (1→7 ×3,
 * 2→4, 5→6, 3→5 ×2) — and aperiodic-at-cap goes 49 → 56 of 142. Three of those
 * are periods #1104 recovered; they are given back deliberately, because a span
 * that hides a whole track is a loop claim the document does not support, and
 * #1105 already made the aperiodic display an honest one.
 */
/**
 * What the document's SOURCE says is continuously modulated (#1465).
 *
 * Two facts, read structurally off the IR and therefore HORIZON-FREE, which is
 * the property that makes them safe to feed a horizon-driven detection. An
 * earlier attempt at this exclusion derived it by watching a probe window, so a
 * field whose period exceeded that window read as unstable and got dropped — it
 * discarded `note` and `s` in ~75 documents. `Param{value: …Signal}` is the same
 * fact at horizon 4 and at horizon 256.
 */
interface SignalDimensions {
    /** Every parameter KEY whose argument carries a signal — the dimensions to ask
     *  the identity question WITHOUT. Named by key because that is how the cycle
     *  fingerprint names a dimension (`eventValueKey`). */
    readonly keys: ReadonlySet<string>;
    /** Cycle periods of the modulating signals that actually REPEAT. `rand`,
     *  `perlin`, `time` and the mouse signals contribute nothing here — see
     *  `hasTruePeriod`. Empty means "this document is modulated, but by nothing
     *  that comes back", which is a different answer from "not modulated". */
    readonly periods: readonly number[];
}
/**
 * Read `SignalDimensions` off a document's IR. The caller holds the IR;
 * `analyzeSong` only ever sees events, so this is how the fact reaches it.
 *
 * ⚠ MUTED TRACKS ARE EXCLUDED FROM THE READ (#1488), and the fold is why this
 * is not a nicety. The exclusion half could afford to be sloppy here — a muted
 * track emits no events, so stripping a key nothing carries changes no
 * fingerprint — but the fold is pure arithmetic on the IR and never consults
 * events at all. Measured on `0/-9BuEqUq3uzT`: its two audible tracks modulate
 * only `gain`, at period 1, while a SILENT `_$:` block carries
 * `.lpq(sine.range(2,10).slow(32))`. Reading the whole document folded that
 * document's 2-cycle structure up to 32 — a 16x overstatement sourced entirely
 * from a track that makes no sound, and offered to the user as a bounce length.
 *
 * Only the TOP level is scoped, which is the level muting exists at: a `_$:`
 * silences a whole statement, and nothing inside a sounding track is muted
 * independently.
 */
declare function signalDimensionsOf(ir: PatternIR | null | undefined): SignalDimensions;
/**
 * Partition `[0, horizon)` into contiguous sections, cutting wherever the set
 * of active lanes (lanes with ≥1 onset in that cycle) changes. Captures the
 * musical arc — intro/drop/breakdown emerge as the active-lane set thins and
 * thickens. Silent runs become their own (empty-lane) sections.
 */
declare function computeSections(lanes: readonly LaneActivity[], horizon: number): SongSection[];
/**
 * `computeSections` over `[originCycle, originCycle + spanCycles)` (#1108).
 *
 * ⚠ TWO FRAMES, DELIBERATELY. It READS `onsetsByCycle` window-relative (index 0
 * is the origin, matching `accumulateLanesInWindow`) and EMITS `startCycle` /
 * `endCycle` song-ABSOLUTE. That asymmetry is not an oversight: section bounds
 * become ruler chips on an axis whose labels must keep meaning absolute song
 * position, or a user cannot tell which part of the piece they are looking at.
 * The relative half is an implementation detail of the counts array; the
 * absolute half is what every consumer of a `SongSection` already assumes.
 */
declare function computeSectionsInWindow(lanes: readonly LaneActivity[], originCycle: number, spanCycles: number): SongSection[];
/**
 * Compose the pure analysis: lanes + period + sections over `[0, horizon)`.
 * `reachedCap` is supplied by the caller (it's a property of the collection
 * loop, not of the events). Synchronous — used directly in unit tests.
 */
declare function analyzeEvents(events: readonly IREvent[], horizon: number, reachedCap?: boolean, detectPeriodFn?: (events: readonly IREvent[], horizon: number) => number | null): SongAnalysis;
interface AnalyzeSongOptions {
    /** Initial horizon to collect before the first period check (default 8). */
    hintCycles?: number;
    /** Maximum horizon to grow to (default 256). */
    capCycles?: number;
    /** Cycles collected per slice before a budget check (default 4). */
    sliceCycles?: number;
    /** Wall-clock budget (ms) between yields to the event loop (default 10). */
    sliceBudgetMs?: number;
    /** Collector — the onset source. Production injects an eval-backed collector
     *  (queryArc haps); with none, analysis sees no onsets and returns empty. */
    collectFn?: (startCycle: number, endCycle: number) => IREvent[];
    /** Clock — defaults to `performance.now()`. Injected in tests. */
    now?: () => number;
    /** Yield to the event loop between budgeted slices. Default = macrotask. */
    yieldFn?: () => Promise<void>;
    /** Cooperative cancellation; checked between slices. */
    signal?: {
        readonly aborted: boolean;
    };
    /**
     * The display-period rule, defaulting to `detectDisplayPeriod`.
     *
     * A MEASUREMENT SEAM, not a behaviour option — production never passes it.
     * It exists because a candidate rule cannot be priced by post-processing a
     * finished analysis: a `null` from this function is exactly what doubles the
     * horizon below, so a different rule resolves at a different horizon and
     * yields a different span. Pricing one therefore requires running THIS loop,
     * and the alternative — copying the loop into the sweep — would re-implement
     * the doubling, the cap and the one-loop trim, i.e. build the second oracle
     * this module's injection points exist to avoid ([[PV192]]).
     *
     * The default keeps every verdict identical; `song-period-sweep.test.ts`'s
     * pinned per-document baseline is the control arm proving it.
     */
    detectPeriodFn?: (events: readonly IREvent[], horizon: number) => number | null;
    /**
     * What the document's SOURCE says is continuously modulated (#1465), from
     * `signalDimensionsOf(ir)`.
     *
     * Asked of the CALLER for the same reason `hasUnheardTrack` is: the question
     * is about the DOCUMENT, and `analyzeSong` only ever sees events. Unlike that
     * clause the answer is derivable here — the reader lives in this package now
     * (#1489) — but only from an IR the caller holds.
     *
     * Omitting it is safe and means exactly one thing: a document whose every lane
     * is aperiodic keeps the cap and the #1105 notice, which is what production
     * did before this existed. It can only ever ADD a period, never change one.
     */
    signals?: SignalDimensions;
    /**
     * "Does the document declare a track that has produced no onset yet?" — clause
     * (a) of `displayPeriodRule`, asked of the CALLER because only the caller can
     * answer it soundly.
     *
     * ── WHY THE CALLER OWNS IT, and it is not derived from `events` ─────────────
     * The question needs two sets in ONE key space: what the document declares,
     * and what has been heard. The events reaching `analyzeSong` are in the
     * DISPLAY lane space — production remaps every hap through `laneKeyForHap`
     * source containment (`MusicalTimeline.tsx`) so analysis lanes line up with
     * rendered rows ([[PV175]]) — and that space cannot answer it. Measured over
     * the corpus: 20 of the 78 documents with structural anchors have an anchor key
     * that NEVER receives an event in 256 cycles (a track whose haps carry no
     * `loc`, or whose `loc` precedes its own statement). There, "unheard" does not
     * mean a track that has yet to enter; it means a key nothing can ever land on,
     * so the clause would be waiting for something that does not exist.
     *
     * NOT a cost argument, which is worth saying because that was the first guess
     * and measurement refuted it: priced against its own control arm the structural
     * clause takes documents collected to the full cap from 71 to 85, +14, and the
     * capture-space clause costs +13 by construction (the 7 it moves, plus the 6
     * documents with a registered track that never sounds). The work is the same.
     * What differs is whether the question has an answer.
     *
     * In the CAPTURE key space the engine stamps — one key per registered pattern —
     * an unheard key can only mean a track that genuinely never sounds, which is 6
     * documents, and all 6 keep their exact period because the clause is bounded to
     * `horizon < cap`. Measured past the cap too: all 9 such tracks are silent
     * through 1024 cycles, so none is a late entry the bound hides.
     *
     * So the caller reads the raw capture keys BEFORE its own remap and compares
     * them against the engine's registered set. Absent, the clause is inert and
     * the rule is exactly the #1104 one — a deliberate default, since a caller
     * that cannot name the document's tracks has nothing to claim about them.
     */
    hasUnheardTrack?: () => boolean;
}
/**
 * Analyze the whole song off the in-memory IR. Collects a progressive horizon
 * (hint → doubling → cap) in budget-bounded slices, yielding to the event loop
 * whenever a slice exceeds `sliceBudgetMs`, and stops as soon as a loop period
 * is confirmed (or the cap is hit). Returns a `SongAnalysis` describing lanes,
 * period, and sections.
 *
 * `null` IR (or a collector returning nothing) yields an empty analysis.
 */
declare function analyzeSong(ir: PatternIR | null, opts?: AnalyzeSongOptions): Promise<SongAnalysis>;
/**
 * One window of a song that has no loop. Deliberately NOT a `SongAnalysis`.
 *
 * ── WHY THERE IS NO `periodCycles` FIELD ────────────────────────────────────
 * The period is a property of the SONG, detected once over `[0, cap)`. Paging
 * exists only on the branch where that detection FAILED — when a period was
 * found, cycle 257 genuinely is cycle 1 and there is nothing to the right to
 * reach. So a window can never contribute a period, and the decision recorded
 * on #1108 is that it must never try: a song aperiodic in `[0, 256)` is not
 * re-judged as an 8-cycle loop in `[256, 512)`, because that would change the
 * view's span underneath the user as they page and make the density heatmap's
 * scale incomparable between windows.
 *
 * Expressed as a MISSING FIELD rather than a flag on purpose. A
 * `periodCycles: null` that callers must remember to ignore is a rule kept in
 * step by hand; a type with nowhere to put a period cannot drift.
 */
interface WindowAnalysis {
    /** First cycle of this window (inclusive, song-absolute). */
    readonly originCycle: number;
    /** Window width in cycles. `onsetsByCycle` arrays have exactly this length. */
    readonly spanCycles: number;
    /** Per-lane onset activity across the window; index 0 is `originCycle`. */
    readonly lanes: readonly LaneActivity[];
    /** Sections partitioning the window, with song-ABSOLUTE bounds. */
    readonly sections: readonly SongSection[];
    /** False when collection was aborted before the whole window was gathered —
     *  the lanes then describe only a prefix of it, and the caller must not
     *  present a partial window as a complete one. */
    readonly complete: boolean;
}
interface AnalyzeWindowOptions {
    /** Cycles collected per slice before a budget check (default 4). */
    sliceCycles?: number;
    /** Wall-clock budget (ms) between yields to the event loop (default 10). */
    sliceBudgetMs?: number;
    /** Collector — the band accessor (#1197). With none, the window is empty. */
    collectFn?: (startCycle: number, endCycle: number) => IREvent[];
    /** Clock — defaults to `performance.now()`. Injected in tests. */
    now?: () => number;
    /** Yield to the event loop between budgeted slices. Default = macrotask. */
    yieldFn?: () => Promise<void>;
    /** Cooperative cancellation; checked between slices. */
    signal?: {
        readonly aborted: boolean;
    };
    /**
     * Lane keys that must appear as rows even when silent through this window —
     * normally the first window's lane set, or the document's track set. See
     * `accumulateLanesInWindow`: without this, a track silent here CEASES TO
     * EXIST rather than going empty, and the display rebuilds its row without the
     * silenced treatment (#1098/#1107).
     */
    pinnedLaneKeys?: readonly string[];
}
/**
 * Collect and accumulate ONE window `[originCycle, originCycle + spanCycles)`.
 *
 * Same budgeted, abortable slicing discipline as `analyzeSong` — but no
 * progressive horizon and no period rule, because a window neither grows nor
 * decides. It is the "keep looking further into a song we already know does not
 * repeat" half of #1108.
 */
declare function analyzeWindow(originCycle: number, spanCycles: number, opts?: AnalyzeWindowOptions): Promise<WindowAnalysis>;

/**
 * How long is the document — structurally, off the IR, with no evaluation and
 * no window.
 *
 * WHY THIS IS NOT `SongAnalysis.displaySpan`. That span answers "what should the
 * timeline SHOW", and it is measured over the evaluated event stream against a
 * progressive horizon. Three shapes make it wrong for a bounce, all measured
 * (#1359): a period-4 loop with 400 cycles of content reports `{loop, 4}`; an
 * aperiodic 400-cycle document reports `{capped, 256}` and truncates 144 cycles;
 * and — the one that surprises — an aperiodic document only 40 cycles long ALSO
 * reports `{capped, 256}`, because a song that ends still grows to the cap. A
 * bounce driven off it renders six times more silence than music.
 *
 * WHY IT IS NOT `SceneClip.endCycle` EITHER. Those cycles are song-absolute, but
 * the LAST clip of every lane is flushed at `originCycle + nCycles`
 * unconditionally, so `max(endCycle)` hands the visible window straight back.
 *
 * THE DATUM IS `ArrangeArm.weight`, which `PatternIR` already states outright:
 * "the whole node's period is `Σ weight`". This module is the one place that
 * reads it AS AN EXTENT. The three existing `Σ weight` reduces in
 * `structuralWalk.ts` are deliberately left alone — they compute a period in
 * order to modulo into it and SELECT an arm, which is a different job.
 *
 * THE ANSWER IS TYPED, NOT A NUMBER, for the same reason `DisplaySpan` refuses to
 * collapse `capped` into `horizon`: the cases mean different things and a bare
 * number erases which one answered. A caller that gets `0` cannot tell "this
 * document ends immediately" from "this document never ends".
 */

type SongExtent = 
/** A definite end. `cycles` is `Σ weight` over the longest arrangement, scaled
 *  by any time-scaling above it. Safe to bounce whole. */
{
    readonly kind: 'arranged';
    readonly cycles: number;
}
/** No arrangement anywhere — the document loops, and a loop has no end. NOT a
 *  failure: this is the correct answer for 96.7% of real documents (#1359).
 *  The caller pairs it with `SongAnalysis.periodCycles` to offer repeats. */
 | {
    readonly kind: 'loop';
}
/** An arrangement IS present but something unparsed sits above it, so its
 *  length cannot be trusted. Distinct from `loop` so the UI can say so rather
 *  than quietly presenting an arrangement as a loop. */
 | {
    readonly kind: 'opaque';
};
/**
 * The document's extent.
 *
 * WALK RULES, and each is load-bearing:
 *
 * - `Arrange` → `Σ weight`, and **the arms are not descended into**. An arm
 *   spans `n` WHOLE cycles at the pattern's natural rate, so a longer inner
 *   arrangement is TRUNCATED by its arm, not extended by it. Taking a max that
 *   descended would over-report exactly the documents most likely to be nested.
 * - `NamedPick` whose selector is a WEIGHTED `Cycle` → `Σ` slot weights, slots
 *   without an `Elongate` counting 1, entries not descended into (#1427). The
 *   second spelling of an arrangement; the case body says why the RECEIVER, not
 *   the weighting alone, is what keeps it narrow.
 * - `Stack` → the MAX over tracks, never the sum. Tracks are parallel. That is
 *   also the answer for a song whose tracks carry DIFFERENT section timelines:
 *   the piece is as long as its longest track, never their sum.
 * - `Track` / `Loop` → transparent.
 * - `Fast` / `Slow` → scale what is below them.
 * - `Code` → TAINT. A `Code` node is either an opaque wrapper around a
 *   `.method(args)` Stave could not parse (with the real receiver at
 *   `via.inner`) or a whole parse failure. Either way an unknown transform sits
 *   between the arrangement and the output, and it may be a time-scaling one —
 *   measured on the real corpus, 3 of the 5 arranged documents have a `Code` on
 *   the path, and one of those three also has a `Slow`. So the receiver is still
 *   walked (to learn WHETHER an arrangement exists) but any arrangement found
 *   under it is reported as `opaque` rather than measured.
 *
 * ⚠ WHAT THE WALK DELIBERATELY DOES NOT FOLLOW. Only `body`, `Stack.tracks` and
 * `Code.via.inner` are traversed — not `Seq.children`, `Cycle.items`,
 * `Choice.then`/`else_`, or the `Pick` selector. Every one of those
 * constructs repeats once per cycle (a `Seq` is fastcat, which COMPRESSES its
 * children into a single cycle; a `Cycle` alternates between them), so a
 * document whose only arrangement sits inside one still loops forever and `loop`
 * is the correct verdict, not a miss. Checked rather than assumed: a probe
 * walking EVERY object field finds arrangements in the same 5 corpus documents
 * this walk classifies, so the narrower traversal loses nothing on real code.
 * ⚠ ONE EXCEPTION SINCE #1427: a `NamedPick`'s selector is READ for its weights,
 * though still not walked into — reading a shape is not traversing it.
 * `Sleep.duration` is likewise unmodelled — it contributes time that this
 * function does not count.
 *
 * ⚠ TAINT IS DOCUMENT-WIDE ONCE ANY ARRANGEMENT IS TAINTED, deliberately. The
 * result is a MAX, so one unmeasurable arm invalidates the maximum — the
 * untrusted arrangement could be the longest. Being wrong towards `opaque` costs
 * nothing (the UI treats `opaque` and `loop` alike, asking for a length); being
 * wrong towards `arranged` silently truncates someone's bounce.
 */
declare function songExtent(ir: PatternIR | null): SongExtent;

/**
 * Continuous automation a track declares, read off the static IR (#1464 Stage 1).
 *
 * `.cutoff(saw.slow(4).range(200, 2000))` is a parameter that MOVES, and until
 * #1478/#1482 it reached the IR as an opaque `Code` — the timeline could not see
 * that anything was modulated at all. Those two landed the three legs #1464 names
 * as its prerequisite, so the shape, the rate and the range are now plain field
 * reads off a nested node:
 *
 *   Param{key:'cutoff', value: Range{lo:200, hi:2000,
 *                                body: Slow{factor:4,
 *                                       body: Signal{kind:'saw'}}}}
 *
 * This module turns that into what a lane needs to DRAW one, plus — since Stage 2
 * (#1464 option 2) — WHERE each leg is written, so a control can edit it in place.
 * It still emits no source and holds no inverse: `SignalSpans` carries source
 * COORDINATES, and the byte-verbatim round-trip #1482 established stays preserved
 * by construction here, because nothing in this file can produce text. What
 * changes is that a caller now has somewhere precise to write, which is exactly
 * the leverage Stage 2 needs and the whole of what this file lends it.
 *
 * Mirrors `trackOrder.ts`: pure and structural, no eval and no source scanning,
 * producing an IR-derived input for `buildTimelineScene` (which is documented
 * PURE — no IR walk) rather than reaching into the IR from inside the scene.
 */

type SignalNode = PatternIR & {
    tag: 'Signal';
};
type SignalKind = SignalNode['kind'];
/** One drawable continuous automation: which track, which parameter, and the
 *  three legs (#1464's own words) needed to plot it. */
interface SignalAutomation {
    /** The lane this belongs to — the same `trackId` `declaredTracks` keys on. */
    readonly trackId: string;
    /** The automated control: `cutoff`, `gain`, `pan`, … (the `Param`'s key). */
    readonly paramKey: string;
    /** The signal's SHAPE. */
    readonly kind: SignalKind;
    /** The signal's RATE, as the cycles one full period spans. `sine` is 1;
     *  `.slow(4)` makes it 4; `.fast(2)` makes it 0.5. Always finite and > 0. */
    readonly periodCycles: number;
    /** The signal's RANGE — its output floor and ceiling. */
    readonly lo: number;
    readonly hi: number;
    /** True when `lo`/`hi` came from an explicit `.range(lo, hi)`; false when they
     *  are the signal's natural polarity. Kept because it is the difference between
     *  a number the user wrote and one this module supplied, and a lane that ever
     *  labels the axis must not present the second as the first. */
    readonly ranged: boolean;
    /** Source offset of the `Param` call site, or null. The same coordinate the
     *  lanes already carry, so a later stage can bind this to the editor without a
     *  second provenance channel invented for it. */
    readonly offset: number | null;
    /** WHERE each leg is written (#1464 Stage 2). Read the type's own doc. */
    readonly spans: SignalSpans;
}
/**
 * Where each of the three legs is SPELLED in the source (#1464 Stage 2).
 *
 * ⚠ THIS IS THE ONLY WAY A CONTROL CAN WRITE, and the reason is structural, not
 * stylistic. `Range` regenerates from `rawArgs` and `Param` from its own
 * `rawArgs` (`toStrudel.ts:226`, `:196`) — that is what buys the byte-verbatim
 * round-trip #1482 established. The consequence is that setting `lo`/`hi` on an
 * IR node and re-emitting writes NOTHING: the raw text wins. So every Stage 2
 * edit is a source-offset replacement over these spans, on the same path every
 * other edit surface in this codebase uses.
 *
 * A span is `null` when the leg is not spelled — `sine` with no `.range()` names
 * no numbers to replace. That is not a gap to paper over: it is a DIFFERENT edit
 * (insert a call at `chainEnd`), and the two must not be confused, because one
 * preserves every other byte and the other lengthens the document.
 *
 * Measured over the sweep corpus (`loadCorpus`, 150 documents, 200 drawable
 * automations): range spelled 180 (90%), rate spelled 128 (64%), NEITHER 16 (8%).
 * ⚠ Those figures are OWNED BY A GATE, not transcribed here and left to rot:
 * `packages/app/tests/parity-corpus/signal-span-census.test.ts` derives them
 * from these spans and pins them, so the comment and the corpus cannot drift
 * apart silently. Update both together or neither. The 8% is what makes
 * `captionEdit`'s insert path real rather than defensive.
 */
interface SignalSpans {
    /** The signal identifier itself — `sine`, `perlin`. Replacing this text is the
     *  whole of a shape change. */
    readonly shape: SourceLocation | null;
    /** The single `.slow(n)` / `.fast(n)` call site.
     *
     *  ⚠ NULL when the chain carries MORE THAN ONE rate arm, not only when it
     *  carries none. `sine.slow(2).fast(4)` has a well-defined rate (the product)
     *  and no well-defined place to write a new one — editing either arm produces
     *  the asked-for rate while silently changing what the user wrote elsewhere.
     *  Abstaining is the same discipline `readChain` already applies to shapes it
     *  cannot account for. */
    readonly rate: SourceLocation | null;
    /** The `.range(lo,hi)` call site whose bounds WON — the outermost one, which
     *  is the one `readChain` adopted. An inner `.range()` it supersedes is dead
     *  in the document already and is not what a control should edit. */
    readonly range: SourceLocation | null;
    /** Offset just past the whole signal expression, where an ABSENT leg's call
     *  would be inserted: `sine` + `.range(0,1)` at `chainEnd`. Null when the
     *  outermost node carries no source range, in which case no edit is possible
     *  and a control must be offered as disabled rather than as broken. */
    readonly chainEnd: number | null;
}
/**
 * Every continuous automation the document declares, keyed by the track that
 * declares it, in source order. Empty for a document with none — which is most
 * of them, and is why the drawing side must treat absence as ordinary.
 */
declare function signalAutomations(ir: PatternIR | null | undefined): readonly SignalAutomation[];
/**
 * Every parameter KEY whose argument carries a signal anywhere (#1465).
 *
 * ⚠ THIS IS A DIFFERENT QUESTION FROM `signalAutomations`, ON THE SAME IR, and
 * the difference is the point rather than an oversight. That reader asks "can I
 * PLOT this?" and abstains on anything without a closed form. This one asks "does
 * this control MOVE?" — and `.gain(sine.add(saw))` has no closed form, cannot be
 * drawn, and absolutely does make every cycle differ.
 *
 * Measured over the sweep's own corpus (`loadCorpus`, 142 documents that
 * evaluate): the closed-form reader sees 199 signal-carrying `Param` nodes and
 * this one sees 239. Answering the period question with the drawing reader would
 * silently under-report by those 40.
 *
 * Returns KEYS rather than nodes because that is what the consumer needs: the
 * cycle fingerprint reads an event's whole value partition (`eventValueKey.ts` —
 * `{note, freq, s, gain, velocity, color} ∪ params`), and a key is how a
 * dimension is named there. `cutoff`/`resonance`/`pan`/`room` arrive via
 * `params`; `gain` has a dedicated slot. Both are addressed by key.
 *
 * Structural and horizon-FREE, which is the property that matters. An earlier
 * attempt at this exclusion derived it by watching a probe window, so a field
 * whose period exceeded that window read as unstable and got dropped — it
 * discarded `note` and `s` in ~75 documents. `Param{value: …Signal}` is the same
 * fact at horizon 4 and at horizon 256, so it cannot drift with the horizon it
 * feeds.
 */
declare function signalCarryingParamKeys(ir: PatternIR | null | undefined): ReadonlySet<string>;

/**
 * PatternIR JSON serialization.
 *
 * Serialize PatternIR trees to/from JSON.
 * Since PatternIR is already a tagged union of plain objects, round-trip is lossless.
 *
 * The JSON envelope adds a schema version for LLM consumption and versioning.
 */

declare const PATTERN_IR_SCHEMA_VERSION = "1.0";
/** Serialize a PatternIR tree to JSON. */
declare function patternToJSON(ir: PatternIR, pretty?: boolean): string;
/** Deserialize a PatternIR tree from JSON. Throws on invalid input. */
declare function patternFromJSON(json: string): PatternIR;

/**
 * parseMini — mini-notation string → PatternIR, via the krill grammar.
 *
 * The mini-notation grammar is STRUDEL'S, so we ask Strudel for it: this file
 * lowers `@strudel/mini`'s krill AST into PatternIR instead of re-tokenizing
 * the string ourselves. The hand-rolled tokenizer + byte-position operator
 * scanner it replaced (#943) was a second oracle of a grammar Strudel ships
 * complete and located — every "gap" in it was drift, never a missing feature,
 * and it shipped real bugs (a wrong bjorklund distribution, #907; `!`/`/`/`_`
 * silently mis-parsed). The notation layer (`visualEdit/notation/parse.ts`)
 * already parses the same mini via krill; this brings the IR world up to it.
 *
 * WHAT STAYS OURS is the LOWERING — krill's uniform ops model (`weight`/`reps`/
 * `ops[]` on every element) is lowered into PatternIR's structural tags:
 *   - `bd(3,8)`  → a flat Seq of Play/Sleep (euclid expanded via `bjorklund`)
 *   - `a*2`/`a/2`→ Fast / Slow      · `a?` → Choice      · `a@2` → Elongate
 *   - `a!3`      → three sibling Plays (replicate)        · `a:3` → slice param
 *   - `[a b]`    → Seq   · `[a,b]` → Stack (chord)
 *   - `<a b>`    → Cycle · `{a,b}` → Stack (polymeter)
 * Transform SEMANTICS are never modeled here — they run in Strudel; we only
 * shape the note tree and thread source `loc` back to it.
 *
 * loc: krill's element spans TILE the source (they include padding), so we
 * DERIVE tight per-token spans from the reliable anchors — an atom's
 * `location_.start` plus its `source_.length`, an op amount atom's start — never
 * copy krill's tiling `location_` end. `loc-fidelity.test.ts` (which slices each
 * node's `[start,end]` out of the source) is the gate that pins this.
 */

/**
 * Parse a mini-notation string. Returns Pure for empty input. Never throws.
 *
 * `baseOffset` — character offset of `input[0]` within the user's full source
 * code. Lets nodes carry `loc` so downstream consumers (Inspector
 * click-to-source, Monaco highlighting) map an event back to its source span.
 */
declare function parseMini(input: string, isSample?: boolean, baseOffset?: number): PatternIR;

/**
 * parseStrudel — Strudel code string → PatternIR.
 *
 * Structural pattern matcher (not a full JS parser).
 * Handles the most common Strudel patterns by regex extraction.
 *
 * Strategy:
 * 1. Split code by $: lines → extract track blocks
 * 2. For each track: identify root function (note/s/stack)
 * 3. Parse mini-notation string argument
 * 4. Walk the method chain (.fast/.slow/.every/etc.)
 * 5. Combine tracks into Stack
 *
 * Unsupported fragments fall back to Code nodes (never throws).
 */

declare function classifyLiteralRhs(rhs: string): {
    tag: 'Code';
    code: string;
    lang: 'strudel';
    via: {
        literal: true;
        raw: string;
    };
} | null;
/** Parse a Strudel code string. Always returns a tree (Code node for unsupported). */
declare function parseStrudel(code: string, _opts?: {
    recogniseGeneralChainRoots?: boolean;
}): PatternIR;

/**
 * parseStrudel — staged pipeline.
 *
 * Surfaces the 4 internal stages of parseStrudel as named passes so
 * the IR Inspector can render each as a tab. End-to-end behavior at
 * FINAL is byte-identical to parseStrudel(code) (D-06 regression gate).
 *
 * Stage boundaries (CONTEXT D-02):
 *   RAW            — extractTracks: per-track Code lifts + offsets
 *   MINI-EXPANDED  — parseRoot per track; chains held as metadata
 *   CHAIN-APPLIED  — applyChain runs per track; metadata dropped
 *   FINAL          — identity today; reserved for future polish
 *
 * Pass<IR> contract: each stage runs PatternIR → PatternIR.
 * Seed input: callers wrap raw source `code: string` in IR.code(code)
 * before pass 0. Pass 0 (RAW) reads input.tag === 'Code' && input.code.
 *
 * Phase 19-07 (#79).
 */

/**
 * RAW — per-track Code lifts.
 *
 * 0 tracks → single Code node carrying `code.trim()` text + loc spanning
 *            from first non-WS char to end of source.
 * 1 track  → single Code node carrying that track's `expr` text + loc
 *            from extractTracks.
 * ≥2 tracks → outer Stack of per-track Code lifts; userMethod undefined
 *             (synthetic from RAW; projects to mini polymetric `{}` per
 *             RESEARCH §6 D-04 risk acceptance).
 *
 * PV25: every Code lift threads extractTracks's existing offset into its
 * loc.start; loc.end = offset + expr.length.
 */
declare function runRawStage(input: PatternIR): PatternIR;
/**
 * MINI-EXPANDED — parseRoot per track; chains held as metadata.
 *
 * Reads RAW's Code lifts (0/1-track single Code, or multi-track Stack
 * of Codes); produces parsed root IR per track with `unresolvedChain`
 * + `chainOffset` metadata stashed on each root for CHAIN-APPLIED to
 * consume.
 *
 * PV31 hot spot: root-level `stack(...)` literal-construction sets
 * userMethod === 'stack' inside parseRoot. We delegate to parseRoot
 * directly so this is preserved by construction.
 */
declare function runMiniExpandedStage(input: PatternIR): PatternIR;
declare function runChainAppliedStage(input: PatternIR): PatternIR;
/**
 * FINAL — identity today; reserved for future normalization passes
 * (per CONTEXT scope). Keeps the name `'Parsed'` at the STRUDEL_PASSES
 * call site for tab-persistence backward-compat (RESEARCH §3.2).
 */
declare function runFinalStage(input: PatternIR): PatternIR;

/**
 * A pass is a sync, pure IR→IR transform. Must not mutate `input`;
 * returning the same reference is allowed for identity passes.
 */
interface Pass<IR> {
    readonly name: string;
    run(input: IR): IR;
}
/**
 * Runs passes in order, returning one entry per pass with the IR
 * after that pass ran. There is no implicit input entry — callers
 * that want to surface the raw input wrap it in an identity pass.
 */
declare function runPasses<IR>(input: IR, passes: readonly Pass<IR>[]): {
    name: string;
    ir: IR;
}[];

/**
 * BreakpointStore — engine-attached registry of irNodeIds that should
 * pause the scheduler when a hap with that id fires (PK13 step 9).
 *
 * Single source of truth for both registration UIs:
 *  - Monaco gutter click → toggleSet([leaf-ids on that line])
 *  - Inspector chain-row click → toggleSet([leaf-ids in that subtree])
 *
 * Hit-check at StrudelEngine.wrappedOutput reads `has(irNodeId)` on every
 * fired hap; HOT PATH — keep API to O(1) Set ops only (P50 — D-03 forbids
 * predicate evaluation here).
 *
 * Per-engine scope (CONTEXT T9): one instance per StrudelEngine, disposed
 * with the engine. File-switch resets breakpoints — documented v1
 * behaviour. Future 20-07-follow-up adds localStorage hydrate via
 * `serialize()` / `hydrate()` methods. Do NOT add them now (Q6 — premature
 * solidification).
 *
 * Phase 20-07 (PV38, PK13 step 9, P50).
 */
type Listener$7 = () => void;
/**
 * Phase 20-07 (R-3) — per-id metadata held alongside the irNodeId.
 *
 * `lineHint` is the 1-based Monaco line number captured at registration
 * time. It exists so an orphaned breakpoint (id no longer in
 * snap.irNodeIdLookup, e.g. user edited the s-string) can still render a
 * muted glyph on its original line — letting the user clear it via
 * gutter-click. Without `lineHint`, an orphaned id registered via the
 * Inspector chain-row (no Monaco line context) is unreachable from the
 * gutter and persists silently in the store.
 *
 * Set when add/addSet is called from the gutter handler (β):
 *   lineHint = clicked line.
 * Set when add/addSet is called from the Inspector chain-row (γ):
 *   lineHint = matched IREvent's loc[0] resolved to a 1-based line via
 *   snap.irNodeIdsByLine reverse-lookup, OR undefined if unavailable.
 *
 * `undefined` is allowed: an orphan with no lineHint is documented as
 * "Inspector-side orphan; cleared via Inspector right-click in
 * 20-07-follow-up."
 */
interface BreakpointMeta {
    readonly lineHint?: number;
}
declare class BreakpointStore {
    private ids;
    private listeners;
    has(id: string): boolean;
    size(): number;
    /** Phase 20-07 (R-3) — read the optional lineHint for orphan rendering. */
    getMeta(id: string): BreakpointMeta | undefined;
    add(id: string, meta?: BreakpointMeta): void;
    remove(id: string): void;
    toggle(id: string, meta?: BreakpointMeta): void;
    /**
     * Add every id in `ids` to the store. Existing ids keep their meta —
     * `meta` is applied to NEWLY added ids only. This is the discipline that
     * lets a gutter-click set lineHint without clobbering a hint set by an
     * earlier Inspector registration (CONTEXT T5 / R-3).
     */
    addSet(ids: readonly string[], meta?: BreakpointMeta): void;
    removeSet(ids: readonly string[]): void;
    /**
     * Toggle a SET semantically: if every id is already present, remove all;
     * else add all (treating the set as one breakpoint). The "any missing →
     * add all" rule resolves the gutter-vs-Inspector desync case (CONTEXT
     * T5) — gutter click on a line where Inspector removed individual ids
     * re-adds the full set.
     *
     * `meta` is applied to ids being ADDED in this call only; ids already
     * present keep their existing meta (don't clobber a lineHint set by an
     * earlier registration path).
     */
    toggleSet(ids: readonly string[], meta?: BreakpointMeta): void;
    /** Read-only iteration — for orphan detection + UI rendering. */
    entries(): ReadonlyMap<string, BreakpointMeta>;
    /** Convenience: just the ids without metadata. */
    idSet(): ReadonlySet<string>;
    /**
     * Subscribe to mutate events. Returns a disposer mirroring
     * `LiveCodingRuntime.onPlayingChanged` (RESEARCH Q3 / S3).
     */
    subscribe(cb: Listener$7): () => void;
    dispose(): void;
    private fireChanged;
}

type TierName = 'csound' | 'tidal' | 'midi' | 'osc' | 'serial' | 'gamepad' | 'motion' | 'mqtt';
type TierFlags = Record<TierName, boolean>;
/**
 * Read all 8 tier flags. Returns a fresh object each call; never null.
 * Unset / malformed keys read as `false` (schema-drift safe).
 */
declare function getTierFlags(): TierFlags;
/**
 * Set a single tier flag. Persists immediately; engine reads at next init().
 * β-3 settings modal calls this from its toggle handler.
 */
declare function setTierFlag(name: TierName, on: boolean): void;
/**
 * The canonical tier name list — exported so β-3's UI can enumerate
 * toggles without hard-coding the schema in two places.
 */
declare function listTiers(): readonly TierName[];

type HapHandler = (event: HapEvent) => void;
/**
 * A required boot step that did not complete. The engine cannot start.
 *
 * ⚠ THE STEP KNOWS WHICH STEP IT WAS; THE CATCHER DOES NOT — and until #1218
 * the only way to recover that upstream was to match the message text, which
 * is a second copy of a rule that lives here and drifts the first time the
 * wording is improved. The label and the deadline now ride on the error as
 * DATA, so a caller can decide what to show without re-deriving anything.
 */
interface BootStepFailure extends Error {
    /** the step's own label — `@strudel/transpiler`, `evalScope`, `initAudio` */
    readonly bootStep: string;
    /** the ceiling it was given, or 0 when the budget was already spent */
    readonly bootStepDeadlineMs: number;
}
/**
 * Is this a required-boot-step failure?
 *
 * ⚠ BRANDED, NOT `instanceof` — deliberately. This package ships ESM and CJS,
 * and a page that ends up holding both copies gets two of every class, so an
 * `instanceof` check would answer `false` for a perfectly real failure and the
 * app would silently fall back to the generic error path. An own-property brand
 * survives duplicate module instances, which is the failure this codebase has
 * already been bitten by once.
 */
declare function isBootStepFailure(err: unknown): err is BootStepFailure;
/**
 * Single source of truth for audio in Stave.
 * Wraps @strudel/webaudio (which wraps superdough) via webaudioRepl().
 *
 * API surface matches ARCHITECTURE.md.
 * One instance per page. Must be init()'d after a user gesture.
 */
declare class StrudelEngine implements LiveCodingEngine {
    private repl;
    private audioCtx;
    private analyserNode;
    private hapStream;
    private evalEpoch;
    private initialized;
    /** The one in-flight `init()`, shared by every overlapping caller (#815). */
    private initPromise;
    private evalResolve;
    private runtimeErrorHandler;
    private loadedSoundNames;
    private trackSchedulers;
    private songPatterns;
    private vizRequests;
    private vizOptions;
    private backdropVizOptions;
    private backdropVizRequest;
    private audioController;
    private trackAnalysers;
    private trackOrbit;
    private lastEvaluatedCode;
    private lastPatternIR;
    private lastIRNodeLocLookup;
    private breakpointStore;
    private isPausedState;
    private pauseChangedListeners;
    private transportOffset;
    private tierFlags;
    private lastAliasResolutions;
    private soundMapRef;
    /** Read-only snapshot of the tier flags consumed at this engine's init(). */
    getTierFlagsSnapshot(): Readonly<TierFlags> | null;
    /**
     * #384 — set the transport seek offset (cycles). Does NOT re-evaluate by
     * itself: the runtime's `seekTo` calls this and then `play()`, whose
     * re-eval re-reads `transportOffset` and applies the `.late()` wrap at the
     * `.p` seam. Kept off the `LiveCodingEngine` interface (v1) and reached via
     * `(engine as any).setTransportOffset?.()` so non-Strudel engines no-op,
     * mirroring the pause/resume delegation convention.
     */
    setTransportOffset(offset: number): void;
    /** #384 — current transport offset (cycles). `0` when no seek is active. */
    getTransportOffset(): number;
    /**
     * Phase 20-14 β-2 — read-only snapshot of alias rewrites that have fired
     * during the current evaluate() window. Each entry is one hap rewrite;
     * the same `from → to` pair may appear multiple times if the rewrite
     * fired across multiple cycles.
     *
     * Lifecycle: reset to empty at `evaluate()` entry, appended to by
     * `wrappedOutput`, read by friendlyErrors at message-build time.
     */
    getLastAliasResolutions(): ReadonlyArray<{
        from: string;
        to: string;
    }>;
    /**
     * Initialise the engine, at most once, no matter how many callers overlap.
     *
     * The flag alone was not enough (#815). `initInternal` sets `initialized`
     * only at the very END of a long async body, so every caller that arrives
     * before that point passes the `if (this.initialized) return` gate and runs
     * the whole body — and the body assigns `this.repl` near its own end. With
     * several inits in flight the last one to finish wins, which is fine right up
     * until `play()` has already started the scheduler on an earlier repl: the
     * engine then holds a repl nobody started, while the abandoned one keeps
     * making sound. Measured in the real app as five concurrent inits on one
     * engine, a scheduler reporting `started === false` mid-playback, and no
     * playhead (#1185, #1171).
     *
     * A flag is a sequential guard. Mutual exclusion needs the in-flight promise
     * itself, so late callers join the run already happening instead of starting
     * their own.
     *
     * The rejection path clears the cached promise deliberately: a failed init
     * must not be remembered, or every later caller re-awaits the same failure
     * with no way to retry. Cleared here, the next `init()` starts a fresh
     * attempt — which is what `StrudelEngine.test.ts` pins.
     */
    init(): Promise<void>;
    private initInternal;
    evaluate(code: string): Promise<{
        error?: Error;
    }>;
    get components(): Partial<EngineComponents>;
    /**
     * Scans code for $: blocks and maps each track's viz request to the line
     * after the last line of that block. Mirrors the line-scanning logic in
     * viewZones.ts but returns structured data instead of creating DOM zones.
     */
    private buildVizRequestsWithLines;
    play(): void;
    /** the destinationGain node our master analyser is currently tapping. */
    private taggedDestinationGain;
    /** resolves superdough's GLOBAL audio controller (the live one). */
    private superdoughControllerFn;
    /**
     * Keep the master `AnalyserNode` tapped to the LIVE output node. superdough
     * RECREATES `destinationGain` on reset (resetGlobalEffects → SuperdoughOutput
     * .reset(), superdoughoutput.mjs:151-159) — every evaluate swaps it for a fresh
     * GainNode. The analyser was connected once at init (line 478), so after a swap
     * it taps a dead node while the live mix flows through the new one and the
     * master meter freezes. On a swap, detach from the stale node and re-tap the
     * live one. Read-only side-tap — audio still flows unchanged to the destination
     * (no routing mutation, V-mixer-3). Master gain is NOT applied here anymore:
     * the master trim is the document's `all(x => x.gain())` (#794 removed the
     * synthetic per-file output-gain seam).
     */
    private followMasterAnalyser;
    stop(): void;
    /**
     * Phase 20-07 (DEC-AMENDED-1) — debugger pause. Calls
     * `scheduler.pause()` (NOT `.stop()`) — pause preserves cycle position
     * (cyclist.mjs:112-116), stop rewinds lastEnd to 0 (cyclist.mjs:117-122).
     * Idempotent: setPaused() guards against double-fire of listeners (T17).
     */
    pause(): void;
    /**
     * Phase 20-07 — debugger resume. Calls `scheduler.start()` which uses
     * the preserved lastEnd from pause (cyclist.mjs:101-111). Idempotent.
     */
    resume(): void;
    /** Current debugger pause state (true after a breakpoint hit). */
    getPaused(): boolean;
    /**
     * Subscribe to engine pause-state transitions. Mirrors the
     * subscriber-set pattern used by `LiveCodingRuntime.onPlayingChanged`
     * (RESEARCH Q3). Returns a disposer.
     */
    onPausedChanged(listener: (paused: boolean) => void): () => void;
    /**
     * Phase 20-07 — accessor onto the engine's BreakpointStore. The
     * runtime exposes this through its own `getBreakpointStore()` so the
     * editor's useBreakpoints hook (Wave β) and the Inspector (Wave γ)
     * share a single store.
     */
    getBreakpointStore(): BreakpointStore;
    /**
     * Internal — flip pause state and fan out to subscribers, with an
     * idempotence guard (T17): both Inspector + Monaco "Resume" surfaces
     * may fire setPaused(false) simultaneously; this short-circuits the
     * second call so listeners never see a redundant transition.
     */
    private setPaused;
    /**
     * Resolve once the master output has been QUIET for a sustained window, or
     * when `maxMs` elapses. Returns whether quiet was actually reached (#1356).
     *
     * `stop()` halts Strudel's scheduler but does not cancel Web Audio nodes
     * already scheduled in the lookahead window, so the graph keeps sounding
     * after the transport reads stopped — measured at near-full level for a full
     * second, gone by 1.25s. A bounce started in that window sums the previous
     * take under the opening of the new one (+24% RMS over the first 1.5s).
     *
     * Waiting on the ANALYSER rather than on a fixed delay means the common case
     * — a graph that is already silent — costs one hold window, and the wait can
     * never be shorter than the tail actually is.
     */
    waitUntilQuiet(maxMs?: number, threshold?: number): Promise<boolean>;
    /**
     * Capture `durationSeconds` of the LIVE master output as a WAV Blob.
     *
     * This is the honest bounce: it taps the same analyser the meters read, so
     * what you hear is what you get — unlike `renderOffline`, which re-evaluates
     * the code in an OfflineAudioContext and cannot currently reach a Stave
     * document at all (#1344).
     *
     * ⚠ It records the graph as it is, so the caller must start playback first.
     * If nothing is playing this now REJECTS with `SilentCaptureError` rather
     * than resolving with a valid WAV of silence and no error (#1402) — the
     * check lives at the capture boundary in `WavEncoder`, not here, because a
     * rule addressed to callers is one every caller can decline. Pass `signal`
     * to stop early and keep what was captured; a cancelled take is allowed to
     * be silent.
     */
    record(durationSeconds: number, signal?: AbortSignal): Promise<Blob>;
    renderOffline(code: string, duration: number, sampleRate?: number): Promise<Blob>;
    /**
     * #1398 SPIKE — render through the REAL superdough graph into an
     * `OfflineAudioContext`, so samples and effects apply.
     *
     * `OfflineRenderer` (the method above) skips every sample-based sound and
     * states why in its header: "AudioWorklets cannot be re-registered in a fresh
     * OfflineAudioContext." Upstream contradicts that — `@strudel/webaudio` ships
     * `renderPatternAudio`, which builds an offline context, calls `initAudio()`
     * against it and then the real `superdough()` per hap. This method runs that
     * function so the claim can be measured rather than argued.
     *
     * ⚠ THE COUPLING (#1400): `renderPatternAudio` opens with
     * `await getAudioContext().close()`. It closes whatever superdough's MODULE
     * GLOBAL holds — not a context handed to it — so the live one is the one that
     * dies unless the global is pointing somewhere expendable when upstream reads
     * it. That is what the sacrificial context below is for, and it is the whole
     * reason this method is more than a call.
     *
     * The live context cannot simply be rebuilt afterwards: this engine took it
     * once at `init()` and built `analyserNode`, the master tap and every
     * per-track analyser on it, `init()` is guarded against re-entry, and the
     * context is already published on the workspace audio bus, so viz consumers
     * hold the same nodes.
     *
     * ⚠ AND IT FAILS SILENTLY, which is why the guard is worth its weight: the
     * render's `finally` calls `setAudioContext(null)`, so the next
     * `getAudioContext()` returns a fresh context and every "is there a context"
     * check passes — while everything already wired to the old one stays wired to
     * a corpse. Measured before the fix, one page, one engine: live capture
     * peak 0.7826 → render ok → live capture peak 0.0000, ok=true, no error. A
     * valid full-length WAV of silence, reported as success. Looking at the
     * context tells you nothing; only the OUTPUT does, which is why the arm that
     * covers this reads peaks either side of a render
     * (`bounce-paths.spec.ts`, '#1400').
     *
     * ⚠ It also hands its result straight to a browser download and resolves with
     * nothing, so the Blob is caught on its way out by stubbing the two DOM calls
     * it uses. The render itself is untouched.
     */
    renderOfflineViaSuperdough(code: string, duration: number, cps?: number, sampleRate?: number): Promise<{
        blob: Blob;
        haps: number;
    }>;
    renderStems(stems: Record<string, string>, duration: number, onProgress?: (stem: string, i: number, total: number) => void): Promise<Record<string, Blob>>;
    getAnalyser(): AnalyserNode;
    getAudioContext(): AudioContext;
    on(_event: 'hap', handler: HapHandler): void;
    off(_event: 'hap', handler: HapHandler): void;
    getHapStream(): HapStream;
    /**
     * The tempo the scheduler is ACTUALLY running at, in cycles per second, or
     * `null` when there is no scheduler yet (engine not initialised).
     *
     * ⚠ WHY THIS EXISTS ALONGSIDE `extractBpmFromCode`. That helper regex-matches
     * a literal `setcps(...)` in the source and is what feeds the status bar's BPM
     * readout. It cannot see three things the scheduler knows: `setcpm(...)`,
     * which the repl routes through the same setter (`repl.mjs` — `setCpm = (cpm)
     * => scheduler.setCps(cpm/60)`); a tempo left at Strudel's default of `0.5`
     * (`cyclist.mjs:24`) by a document that sets none; and a cps CHANGED mid-
     * pattern from a hap value (`cyclist.mjs:72-74`). So `undefined` from the
     * regex means "the code did not spell setcps", never "there is no tempo" —
     * a distinction that matters the moment anything converts cycles to seconds.
     *
     * Deliberately NOT folded into `PatternScheduler`: that adapter is consumed by
     * ~10 visualiser modules, and a tempo read does not need their blast radius.
     */
    getCps(): number | null;
    /**
     * Returns a thin PatternScheduler wrapper around the Strudel scheduler.
     * Only available after evaluate() succeeds (scheduler.pattern is set then).
     */
    getPatternScheduler(): PatternScheduler | null;
    /**
     * Returns per-track PatternSchedulers captured during the last evaluate() call.
     * Each $: block gets its own scheduler that queries its Pattern directly via queryArc.
     * Keys: anonymous "$:" → "$0", "$1"; named "d1:" → "d1".
     * Empty Map before first evaluate or after evaluate error.
     */
    getTrackSchedulers(): Map<string, PatternScheduler>;
    /**
     * Evaluated note events across all tracks over `[0, ceil(cycles))`, for the
     * Song timeline's DISPLAY marks (#861). Iterates the per-track schedulers
     * captured during the last evaluate() and concatenates their normalized haps
     * (`sched.query` → `normalizeStrudelHap`), so every event carries the RESOLVED
     * note (`n("0 2 4").scale("C:major")` → `note:"C3","E3","G3"`, Strudel applies
     * the scale at query time) plus its `context.locations`.
     *
     * This is the eval-backed source of truth for what PLAYS — distinct from the
     * static IR (`collectCycles`), which carries the raw source token (`note:"0"`)
     * and drops `.scale` to an unused param, and so is source-lossy for pitch/scale
     * (PV174). Display must degrade to evaluation; the IR stays the source of truth
     * for structure (lanes/clips) and editing. Empty before the first evaluate; a
     * FAILED evaluate leaves the last good eval's patterns in place (as
     * `trackSchedulers` does — neither is reassigned outside the success branch),
     * which the timeline never sees, because it also needs the IR and the engine
     * DOES clear that on error. A per-track query that throws is skipped.
     *
     * SONG FRAME, not the scheduler frame (#863). Queries `songPatterns` — the
     * patterns as captured BEFORE the `.late(transportOffset)` seek wrap — so
     * cycle 0 is the start of the SONG. The timeline draws these marks on a
     * song-absolute axis, inside lanes/clips derived from the (unshifted) static
     * IR; querying the shifted `trackSchedulers` instead would slide every mark by
     * the transport offset after a seek and rotate the loop's tail into the window,
     * desyncing marks from their own lanes. The live surfaces that DO want the
     * scheduler frame (viz, signal bus, meters, playhead overlay) keep reading
     * `trackSchedulers` — the two frames coincide only while `transportOffset` is 0.
     */
    getTimelineEvents(cycles: number): IREvent[];
    /**
     * The same events over an ARBITRARY BAND `[startCycle, endCycle)` instead of a
     * prefix from zero. Same song frame, same normalisation, same `trackId`
     * stamping as `getTimelineEvents` — only the queried arc differs.
     *
     * ── WHY THIS EXISTS (#1197) ─────────────────────────────────────────────────
     * `analyzeSong`'s collector interface is already band-limited
     * (`(startCycle, endCycle) => IREvent[]`) and it collects the progressive
     * horizon in `sliceCycles`-sized bands. But with only a prefix accessor to call,
     * the app's collector had to query `[0, endCycle)` for every slice and discard
     * everything before the band. Derived over the production defaults (hint 8,
     * cap 256, slice 4), a document that runs to the cap queried 8320 cycles to
     * cover 256 — 32.5× the work for an identical answer, paid on every re-eval and
     * heaviest on exactly the documents that are most expensive to analyse.
     *
     * ⚠ THE CALLER STILL OWNS ONSET ATTRIBUTION, and must keep filtering.
     * `queryArc` returns every hap OVERLAPPING the arc, so a hap beginning at cycle
     * 3.5 is returned by both `queryArc(0, 4)` and `queryArc(4, 8)`. Analysis
     * buckets an onset by `floor(begin)` (`accumulateLanes`), so a caller walking
     * adjacent bands must drop haps whose `floor(begin)` precedes its band or it
     * will count that onset twice — which changes fingerprints, and therefore the
     * detected period. Deliberately NOT done here: overlap is `queryArc`'s honest
     * answer about what sounds during the band, and only the caller knows whether
     * it is walking bands or asking a one-off question.
     *
     * Equivalence to the prefix path it replaces, which is what makes the swap
     * safe: a hap with `floor(begin) ∈ [start, end)` has `begin ∈ [start, end)` and
     * so necessarily overlaps the band — every event that survived the old
     * `queryArc(0, end)` + filter survives `queryArc(start, end)` + the same filter.
     */
    getTimelineEventsBand(startCycle: number, endCycle: number): IREvent[];
    /**
     * The capture keys of every pattern the last evaluate() registered — the SAME
     * ids `getTimelineEvents` stamps on each hap as `trackId`, in the same order.
     *
     * Exists so a caller can tell "this track has not played yet" from "there is no
     * such track" (#1107). Deriving that from the events alone is impossible: a
     * track that has not sounded within the queried window contributes nothing to
     * distinguish itself from one that does not exist. Reading the REGISTERED set
     * is the only way to know the difference, and this is the one place that knows
     * it — `songPatterns` is private and mirrors what the repl actually plays, so a
     * `_`-muted track (never registered, `@strudel/core/repl.mjs:172-175`) is
     * correctly absent and can never be waited on.
     */
    getSongTrackIds(): string[];
    /**
     * Returns per-track viz requests captured during the last evaluate() call.
     * Maps track keys ("$0", "$1", "d1") to viz descriptor IDs ("pianoroll", "scope").
     * Only patterns that called .viz("name") in user code appear in this map.
     * Empty Map before first evaluate or if no patterns use .viz().
     */
    getVizRequests(): Map<string, string>;
    /** Register a handler for runtime audio errors (fires during scheduling, not evaluation). */
    setRuntimeErrorHandler(handler: (err: Error) => void): void;
    /** Returns all sound names registered after init() — useful for editor autocompletion. */
    getSoundNames(): string[];
    dispose(): void;
    /**
     * Query a pattern for its first non-silent hap within [0, lookahead) cycles
     * and return the orbit it uses. Default orbit is 1 (superdough's default).
     * Returns 1 for silent patterns — falls back to orbit 1 just like superdough.
     */
    private resolveOrbit;
    /**
     * Reconcile trackAnalysers against capturedPatterns.
     * - Creates analysers for new captureIds, tapped off their orbit's GainNode.
     * - Reuses analysers when (captureId, orbit) is unchanged.
     * - Rewires when a captureId's orbit changed (disconnect old, tap new).
     * - Removes+disconnects analysers for captureIds no longer present.
     *
     * Safe to call repeatedly. No-op if audioController isn't available yet.
     */
    private rebuildTrackAnalysers;
}

/**
 * Theme tokens applied to the WorkspaceShell root via inline CSS vars.
 *
 * Surface / text / border / accent tokens are NOT included here — they
 * come from globals.css's [data-stave-theme="dark|light"] selectors so
 * the editor chrome and the app chrome share one palette. Only
 * code-specific tokens (syntax colours, stem colours) live here.
 *
 * `--font-mono` is deliberately NOT set here. The host owns the mono font:
 * the app loads the real face via next/font and defines `--font-mono` on
 * `<html>`, and the editor inherits it. Setting it inline on the shell root
 * would win the cascade and pin the editor UI to an unbacked literal
 * (system-mono fallback) — the #691 bug. Leave it to the host.
 */
declare const DARK_THEME_TOKENS: Record<string, string>;
declare const LIGHT_THEME_TOKENS: Record<string, string>;
interface StrudelTheme {
    tokens: Record<string, string>;
}
declare function applyTheme(el: HTMLElement, theme: 'dark' | 'light' | StrudelTheme): void;

interface StrudelEditorProps {
    code?: string;
    defaultCode?: string;
    onChange?: (code: string) => void;
    autoPlay?: boolean;
    onPlay?: () => void;
    onStop?: () => void;
    onError?: (error: Error) => void;
    visualizer?: string;
    activeHighlight?: boolean;
    theme?: 'dark' | 'light' | StrudelTheme;
    showVizPicker?: boolean;
    vizDescriptors?: VizDescriptor[];
    height?: number | string;
    vizHeight?: number | string;
    showToolbar?: boolean;
    readOnly?: boolean;
    onExport?: (blob: Blob, stemName?: string) => Promise<string>;
    engineRef?: React__default.MutableRefObject<StrudelEngine | null>;
}
declare function StrudelEditor({ code: controlledCode, defaultCode, onChange, autoPlay, onPlay, onStop, onError, theme, height, vizHeight, showToolbar, showVizPicker, readOnly, activeHighlight, visualizer, vizDescriptors, onExport, engineRef: engineRefProp, }: StrudelEditorProps): react_jsx_runtime.JSX.Element;

interface LiveCodingEditorProps {
    engine: LiveCodingEngine;
    code?: string;
    defaultCode?: string;
    onChange?: (code: string) => void;
    autoPlay?: boolean;
    onPlay?: () => void;
    onStop?: () => void;
    onError?: (error: Error) => void;
    visualizer?: string;
    activeHighlight?: boolean;
    theme?: 'dark' | 'light' | StrudelTheme;
    showVizPicker?: boolean;
    vizDescriptors?: VizDescriptor[];
    height?: number | string;
    vizHeight?: number | string;
    showToolbar?: boolean;
    readOnly?: boolean;
    toolbarExtra?: React__default.ReactNode;
    onPostEvaluate?: (engine: LiveCodingEngine) => void;
    soundNames?: string[];
    bpm?: number;
    isExporting?: boolean;
    onExport?: () => void;
    engineRef?: React__default.MutableRefObject<LiveCodingEngine | null>;
    /** Monaco language ID (e.g. 'strudel', 'sonicpi'). Defaults to 'strudel'. */
    language?: string;
}
declare function LiveCodingEditor({ engine, code: controlledCode, defaultCode, onChange, autoPlay, onPlay, onStop, onError, theme, height, vizHeight: _vizHeight, showToolbar: _showToolbar, showVizPicker: _showVizPicker, readOnly: _readOnly, activeHighlight: _activeHighlight, visualizer: _visualizer, vizDescriptors: _vizDescriptors, toolbarExtra, onPostEvaluate, soundNames: _soundNames, bpm: bpmProp, isExporting: _isExportingProp, onExport: _onExportProp, engineRef: engineRefProp, language: _language, }: LiveCodingEditorProps): react_jsx_runtime.JSX.Element | null;

/**
 * Minimal LiveCodingEngine implementation using Web Audio directly.
 * Proves the engine protocol works for non-Strudel engines.
 *
 * Parses a simple format:
 *   note: c4 e4 g4    (space-separated note names)
 *   viz: scope         (optional inline viz request)
 *
 * Provides streaming + audio + inlineViz components. Does NOT provide queryable,
 * which validates that VizPicker correctly disables pianoroll/wordfall.
 */
declare class DemoEngine implements LiveCodingEngine {
    private audioCtx;
    private analyserNode;
    private hapStream;
    private oscillator;
    private gainNode;
    private initialized;
    private playing;
    private runtimeErrorHandler;
    private currentVizRequests;
    private schedulerInterval;
    private noteSequence;
    private noteIndex;
    private cyclePos;
    init(): Promise<void>;
    evaluate(code: string): Promise<{
        error?: Error;
    }>;
    play(): void;
    stop(): void;
    dispose(): void;
    setRuntimeErrorHandler(handler: (err: Error) => void): void;
    get components(): Partial<EngineComponents>;
    private noteToFreq;
}

/**
 * SonicPiEngine adapter — wraps the standalone sonicPiWeb engine
 * to conform to Stave's LiveCodingEngine interface.
 *
 * Responsibilities of the ADAPTER (not the engine):
 *  - SuperSonic CDN loading (bundler-proof dynamic import)
 *  - SoundEvent → HapEvent bridging (sonicPiWeb events → Stave events)
 *  - loc computation (engine provides srcLine, adapter computes char offsets)
 *  - Viz request capture (viz() injected here, not in the engine)
 *  - inlineViz component assembly (afterLine computed from code)
 *
 * The engine (sonicPiWeb) knows about music: play, sleep, sample.
 * The adapter knows about the editor: viz, components, highlighting.
 */

declare class SonicPiEngine implements LiveCodingEngine {
    private raw;
    private hapStream;
    private runtimeErrorHandler;
    private options;
    private vizRequests;
    /** Original code lines + char offsets — for computing loc from srcLine */
    private originalLines;
    private lineOffsets;
    /** Per-track HapStreams for scoped inline viz (keyed by live_loop name) */
    private trackStreams;
    constructor(options?: {
        schedAheadTime?: number;
    });
    init(): Promise<void>;
    evaluate(code: string): Promise<{
        error?: Error;
    }>;
    play(): void;
    stop(): void;
    dispose(): void;
    setRuntimeErrorHandler(handler: (err: Error) => void): void;
    get components(): Partial<EngineComponents>;
}

/**
 * NormalizedHap — backward-compatible alias for IREvent.
 *
 * All viz sketches import NormalizedHap. This re-exports from the IR module
 * so existing code keeps working. New code should import IREvent directly.
 */

/** @deprecated Use IREvent from '../ir' instead. */
type NormalizedHap = IREvent;
/**
 * Convert a raw Strudel hap into an IREvent (NormalizedHap).
 * Handles Fraction objects (Number() coercion), missing fields, and optional value bag.
 *
 * `trackId` is caller-supplied — Strudel haps don't carry it natively,
 * but per-track schedulers (`$:` blocks) know their id and pass it
 * through so downstream consumers (DAW view, transform debugger) can
 * attribute every event to a producer.
 *
 * `irNodeLocLookup` is caller-supplied — engine threads the published
 * snapshot's loc map so each hap can be enriched with its `irNodeId`
 * by structural match (PV38 clause 2). Both optional — additive widening.
 */
declare function normalizeStrudelHap(hap: any, trackId?: string, irNodeLocLookup?: ReadonlyMap<string, IREvent[]>): NormalizedHap;

/**
 * Engine-agnostic IRPattern built from a live HapStream.
 *
 * Accumulates HapEvents into a rolling buffer of IREvent[].
 * Any engine that provides streaming (HapStream) automatically gets
 * a synchronous queryable — no engine-specific code needed.
 */
declare class BufferedScheduler implements IRPattern {
    private buffer;
    private head;
    private audioCtx;
    private maxAge;
    private hapStream;
    private handler;
    /** Last event per instrument — for same-instrument overlap clipping */
    private lastByInstrument;
    constructor(hapStream: HapStream, audioCtx: AudioContext, maxAge?: number);
    now(): number;
    query(begin: number, end: number): IREvent[];
    clear(): void;
    dispose(): void;
}

/**
 * One 16-bit quantisation step. A sample quieter than this truncates to a
 * 16-bit zero, so a capture whose LOUDEST sample falls below it encodes to a
 * file of literal zeros — which is the only direction this guard needs.
 *
 * ⚠ DELIBERATELY CONSERVATIVE, AND THE CONVERSE DOES NOT HOLD. Positive and
 * negative samples do not scale by the same factor (`floatToInt16` uses 0x7fff
 * one way and 0x8000 the other), so the grey band is one step wide. Measured:
 *
 *     +1/32768 -> int16  0     (encodes to silence, yet clears this bound)
 *     -1/32768 -> int16 -1     (survives)
 *     +1/32767 -> int16  1     (survives)
 *
 * So a take whose peak sits in that single step, positive-only, can still
 * encode to zeros and pass. That is the right way round: this bound never
 * refuses a file that has audio in it, and the width of what it lets through
 * is one part in 32768 of full scale.
 *
 * ⚠ THIS IS DERIVED FROM THE FORMAT, NOT CALIBRATED AGAINST A DEVICE, and the
 * distinction is the whole reason the number is safe to hardcode. Absolute
 * audio thresholds in this codebase have twice turned out to be reporting the
 * sound card rather than the code — a level that read 0.1400 on one machine
 * read 0.30621 on another, and a capture length that divided evenly at 48kHz
 * did not at 44.1kHz. This bound asks only "did any sample survive
 * quantisation", which is a fact about the bytes and identical on every device.
 * Do not turn it into a loudness threshold; a quiet bounce is a valid bounce.
 */
declare const SILENCE_FLOOR: number;
/**
 * Thrown when a capture path would hand back a well-formed file of silence.
 *
 * ⚠ IT CARRIES THE REFUSED TAKE (#1410). The check runs AFTER the sample loop,
 * because the peak is not known until the samples have been walked — so by the
 * time this is thrown the WAV is already fully encoded. Attaching it costs
 * nothing and it is the difference between a user re-recording a three-minute
 * bounce and clicking once.
 *
 * This does not soften the refusal. `refused` is never RETURNED: the promise
 * still rejects, the default path still saves nothing, and reaching into a
 * thrown error to pull bytes out of it is unmistakably deliberate at the call
 * site — which is the same opt-OUT shape as `allowSilence`, not an opt-in that
 * a caller can forget. A silent take still cannot arrive anywhere by accident.
 */
declare class SilentCaptureError extends Error {
    readonly peak: number;
    readonly frames: number;
    /** The encoded WAV that was refused. Complete and playable — just silent. */
    readonly refused: Blob;
    constructor(peak: number, frames: number, refused: Blob);
}
interface EncodeOptions {
    /**
     * Encode silence instead of refusing it. For the cases where an empty or
     * silent result is the honest answer — an aborted take, or a test that is
     * about the header rather than the audio.
     */
    allowSilence?: boolean;
}
/**
 * Pure TypeScript RIFF WAV encoder.
 * No dependencies — works in any browser or Node.js environment.
 * Encodes stereo Float32 PCM into a standard 16-bit WAV Blob.
 *
 * ⚠ THIS IS THE CAPTURE BOUNDARY, NOT ONLY AN ENCODER (#1402). Every WAV the
 * live recorder and the offline renderer produce is born in `encodeChunks`, so
 * it is the one place that can answer "did this produce sound?" for all of
 * them. It refuses silence BY DEFAULT rather than reporting it, because the
 * rule used to live in `LiveRecorder`'s header addressed to "callers" — and all
 * four of them declined. An obligation delegated to callers is not an
 * invariant. Four bugs shared the same signature under that arrangement: a
 * valid, full-length WAV that played as nothing, returned with no error.
 *
 * ⚠ ONE CAPTURE PATH DOES NOT COME THROUGH HERE.
 * `StrudelEngine.renderOfflineViaSuperdough` intercepts a Blob that upstream's
 * `renderPatternAudio` already encoded, so this guard cannot see it. It is
 * unwired to any UI today; guarding it needs its own change.
 */
declare class WavEncoder {
    /**
     * Encode an AudioBuffer (e.g. from OfflineAudioContext) into a WAV Blob.
     */
    static encode(buffer: AudioBuffer, opts?: EncodeOptions): Blob;
    /**
     * Encode interleaved stereo chunks (e.g. from ScriptProcessorNode) into a WAV Blob.
     * Samples are clamped to [-1, 1] then converted to 16-bit signed integers.
     *
     * Throws `SilentCaptureError` when nothing in the take survives quantisation,
     * unless `opts.allowSilence` says the silence is intended.
     */
    static encodeChunks(chunksL: Float32Array[], chunksR: Float32Array[], sampleRate: number, opts?: EncodeOptions): Blob;
}

/**
 * Offline renderer — processes a Strudel pattern at CPU speed via OfflineAudioContext.
 * Completely isolated from the live AudioContext — safe to call while playing.
 *
 * Implementation: queries the pattern arc directly and renders each note using
 * native WebAudio oscillators. This avoids touching superdough's global context.
 *
 * LIMITATION: Only oscillator-based sounds work (sine, sawtooth, square, triangle).
 * Sample-based sounds (bd, sd, hh, etc.) are skipped (#1353).
 *
 * ⚠ THE "AudioWorklets cannot be re-registered in a fresh OfflineAudioContext"
 * REASON THIS USED TO GIVE IS FALSE, and it was load-bearing for three issues.
 * Upstream's own `renderPatternAudio` builds an `OfflineAudioContext`, calls
 * `initAudio()` against it and then the real `superdough()` per hap — measured
 * audible, samples and all (#1398/#1399). `StrudelEngine.renderOfflineViaSuperdough`
 * is that path; this hand-rolled oscillator renderer exists to work around a
 * constraint that was never there.
 *
 * ⚠ THE SKIP IS NO LONGER SILENT (#1402). A drum-only document renders to
 * nothing, and `WavEncoder` now REFUSES to hand back a file of silence as a
 * success — so this throws `SilentCaptureError` where it used to return a
 * well-formed, full-length WAV of zeros with no error at all. That is the
 * intended change: #1353 is still unfixed, but it can no longer be mistaken for
 * a working bounce.
 */
declare class OfflineRenderer {
    static render(code: string, duration: number, sampleRate: number): Promise<Blob>;
}

/**
 * Real-time audio capture via ScriptProcessorNode.
 * Records exactly what the user hears — useful when live tweaks during playback
 * need to be captured rather than re-rendered.
 *
 * Note: ScriptProcessorNode is deprecated but remains the most reliable cross-browser
 * option for in-browser audio capture without MediaRecorder latency issues.
 *
 * ⚠ This taps the master analyser, so it records whatever the graph is playing —
 * including nothing. With playback stopped it would otherwise resolve with a
 * valid WAV of pure silence and no error, which is the same silent-failure
 * shape the offline renderer has.
 *
 * ⚠ THAT RULE IS NOW ENFORCED RATHER THAN DELEGATED (#1402). It used to read
 * "callers must guarantee audio is flowing […] and assert the result is
 * non-silent" — a correct rule, written in a comment, addressed to four callers
 * of which all four declined. `WavEncoder` refuses a silent take at the point
 * the bytes are made, so `capture` now REJECTS instead of resolving with
 * silence. Callers still should start playback first; they can no longer fail
 * to notice that they didn't.
 */
declare class LiveRecorder {
    /**
     * Capture `duration` seconds of `analyser`'s output as a WAV Blob.
     *
     * Capture is real-time: eight seconds of audio costs eight seconds of wall
     * clock, and holds roughly 11.5 MB of Float32 chunks per minute until the
     * encode. Pass `signal` to stop early — the recorder disconnects and resolves
     * with the audio captured so far, so a cancelled bounce still yields a
     * playable (shorter) file rather than throwing away the take.
     *
     * ⚠ THE LENGTH IS COUNTED IN FRAMES, NOT MEASURED BY THE CLOCK (#1401).
     * `ScriptProcessorNode` delivers audio in fixed 4096-frame blocks, so ending
     * the take when a timer fires kept only the whole blocks that had arrived by
     * then and silently truncated the rest: the file came back short by
     * `(duration * sampleRate) mod 4096` frames — up to 93ms at 44.1kHz, at ANY
     * length. Measured before the fix: 4s→3.9938s, 8s→7.9877s, 16s→15.9753s,
     * every one landing on an exact block boundary.
     *
     * The loss was small but it was not harmless: it is one frame-boundary short
     * of the length the caller asked for, so a bounce could not be trusted to be
     * its own stated duration, and anything reassembling sections would drift.
     * ⚠ It was also invisible on hardware running at 48kHz, where a 32s take
     * divides into exactly 375 blocks and nothing is lost — the same code is
     * correct or wrong depending on the sample rate of the audio device.
     *
     * So the block counter is now what ends the take and the timer is only a
     * BACKSTOP: if the graph stalls and blocks stop arriving, the timer still
     * resolves with whatever exists rather than hanging forever.
     */
    static capture(analyser: AnalyserNode, ctx: AudioContext, duration: number, signal?: AbortSignal): Promise<Blob>;
}

/**
 * Convert a note name string or MIDI number to a MIDI note number.
 * Returns null if the input is unrecognized (e.g. percussion sample names).
 *
 * Examples: "c3" → 48, "eb4" → 63, "f#2" → 42, 60 → 60
 */
declare function noteToMidi(note: unknown): number | null;

/**
 * The one place `components.options` is captured (#883).
 *
 * ## Why this class exists
 *
 * `VizRenderer` is an interface, so "expose the options bag to the sketch" was a
 * rule every renderer had to remember independently — in TWO places each, since
 * the bag arrives on `mount()` AND is re-published on every `update()`. Six
 * implementations, twelve chances to forget.
 *
 * Three forgot. And forgetting is INVISIBLE: a dropped option is pixel-for-pixel
 * identical to a sketch drawing its default, so nothing errors, nothing warns,
 * and the viz just looks like it always did. #880 is what that costs — the worker
 * renderer omitted this exact field and every viz option was silently dead on the
 * DEFAULT path for six weeks, while the main-thread path kept working and hid it.
 *
 * So the invariant gets a home instead of a convention. `mount`/`update` are
 * sealed here and capture the bag before delegating to `onMount`/`onUpdate`. A
 * renderer cannot silently drop options, because it never handles the raw
 * lifecycle call that carries them — including the next renderer someone adds,
 * which is the case a code review would never catch.
 *
 * ## What subclasses still own
 *
 * EXPOSURE, which is irreducibly per-engine and cannot live here: p5 and hydra
 * hand the sketch a JS object (`stave.options`); a fragment shader cannot read
 * one at all and needs generated uniforms (#894). The base guarantees the bag
 * ARRIVES and stays live; how a language surfaces it is the leaf's business.
 *
 * ## The slot is a live ref, deliberately
 *
 * `optionsRef.current` is REPLACED (never mutated) on each publish, so sketch
 * scopes must read THROUGH the ref — a getter, not a captured value — or they
 * pin the first bag forever. The replace is what makes a removed key stop
 * applying, which merging would silently break (#881).
 *
 * Decorators (`FallbackVizRenderer`, `TeardownOnPauseRenderer`) deliberately do
 * NOT extend this: they forward `components` verbatim to an inner renderer whose
 * own base captures it. Extending here would capture a bag they never expose.
 */
declare abstract class VizRendererBase implements VizRenderer {
    /**
     * Live options bag from the viz call's argument (`.pianoroll({ labels: 1 })`).
     * Populated before `onMount`/`onUpdate` run, so subclasses may read it in
     * either. Read `.current` at USE time, never capture it.
     */
    protected readonly optionsRef: {
        current: VizOptions;
    };
    mount(container: HTMLDivElement, components: Partial<EngineComponents>, size: {
        w: number;
        h: number;
    }, onError: (e: Error) => void): void;
    update(components: Partial<EngineComponents>): void;
    /** As {@link VizRenderer.mount}; the options bag is already captured. */
    protected abstract onMount(container: HTMLDivElement, components: Partial<EngineComponents>, size: {
        w: number;
        h: number;
    }, onError: (e: Error) => void): void;
    /** As {@link VizRenderer.update}; the options bag is already captured. */
    protected abstract onUpdate(components: Partial<EngineComponents>): void;
    abstract resize(w: number, h: number): void;
    abstract pause(): void;
    abstract resume(): void;
    abstract destroy(): void;
}

/**
 * Adapter that wraps an existing p5 SketchFactory into the VizRenderer interface.
 * Each P5VizRenderer instance manages one p5 instance lifecycle.
 *
 * Bridges the component bag (Partial<EngineComponents>) to the individual ref
 * objects that P5SketchFactory expects. Refs are stored as instance fields so
 * update() can refresh them for live React rendering.
 *
 * `containerSizeRef` is maintained by the renderer and exposed to user
 * sketches via `stave.width` / `stave.height` (through the compiler).
 * It's initialized from the size passed to `mount()` and updated on
 * every `resize(w, h)` call, so a user's `createCanvas(stave.width,
 * stave.height)` always gets the live preview-pane dimensions — no
 * mismatches with `windowWidth` / `windowHeight` which track the
 * browser window rather than the container.
 */
declare class P5VizRenderer extends VizRendererBase {
    private sketch;
    private instance;
    private hapStreamRef;
    private analyserRef;
    private schedulerRef;
    private containerSizeRef;
    /**
     * Per-renderer named-signal bus (Phase 21). PURE (P12) — owned here, fed
     * UNCONDITIONALLY from the HapStream + scheduler (NOT analyser-gated; the bus
     * is IR-grounded and must stay live whenever a real analyser is published,
     * which is normal playback). Mirrors `HydraVizRenderer`'s bus discipline; the
     * only difference is the p5 SHAPE (D-01): bare `uKick` is a live GETTER
     * NUMBER here, not a `() => number` thunk.
     */
    private bus;
    /** Stable per-instance profiler key (`p5#N`) — frame/fps + bus timing (#228). */
    private readonly perfId;
    /**
     * The bus's HapStream `.env`-feed subscription. Kept as an instance ref so
     * `destroy()` can off it unconditionally (it is the bus's own subscription —
     * p5 has no analyser-fallback envelope, but keeping a named ref matches the
     * hydra teardown discipline and stays correct if a fallback is added later).
     */
    private busHapHandler;
    /** The HapStream the bus handler is subscribed to (for clean off()). */
    private boundHapStream;
    /**
     * The live named-signal uniform object handed to the sketch factory as the
     * 6th arg. Built ONCE in the constructor; its `uKick…` getters read the
     * stable `bus` live each access (U2 — frame-fresh through the inner
     * `with (staveUniforms)`). `update()` rebinds only the bus's scheduler refs
     * in place, so this SAME object's getters keep returning current values
     * without a re-compile.
     */
    private staveUniformsRef;
    constructor(sketch: P5SketchFactory);
    protected onMount(container: HTMLDivElement, components: Partial<EngineComponents>, size: {
        w: number;
        h: number;
    }, onError: (e: Error) => void): void;
    protected onUpdate(components: Partial<EngineComponents>): void;
    resize(w: number, h: number): void;
    pause(): void;
    resume(): void;
    destroy(): void;
}

/**
 * Stave-specific bag exposed to `.hydra` sketches as the second
 * function argument. Mirrors the `stave` namespace convention
 * already used by p5 sketches (see `p5Compiler.ts`). Stays present
 * across re-evaluations — `HydraVizRenderer.update()` rebinds the
 * fields on the same object so long-lived closures inside the
 * user sketch observe live references, not stale snapshots.
 *
 * `scheduler` / `tracks` are `null` / empty when no pattern runtime
 * is publishing — sketches must optional-chain (consistent with the
 * demo-mode path in `compiledVizProvider`).
 */
interface HydraStaveBag {
    /**
     * The viz call's options bag — `.viz('mysketch', { intensity: 0.8 })` reads as
     * `stave.options.intensity` (#883). Mirrors p5's `stave.options`.
     *
     * A GETTER over the renderer's live slot, not a captured value: the slot is
     * REPLACED on every re-publish (so a removed key stops applying), and this bag
     * is built once per mount and mutated in place. Capturing the bag here would
     * pin the first evaluate's options forever.
     *
     * Empty object when the viz was called with no argument — never undefined, so
     * `stave.options.foo` is always a safe read from a sketch.
     */
    readonly options: Record<string, unknown>;
    /** Combined pattern scheduler. Has `now()` and `query(begin, end)`. */
    scheduler: IRPattern | null;
    /** Per-track schedulers keyed by trackId (e.g. "$0", "drums"). */
    tracks: Map<string, IRPattern>;
    /**
     * Strudel-style pattern-to-hydra sugar. Returns a function Hydra can
     * call per frame:
     *
     *   osc(() => stave.H('drums')() * 10).out(o0)
     *
     * Equivalent Strudel idiom is `osc(H('drums')).out(o0)`. The outer
     * call picks the track; the inner call samples the track's current
     * event and reads `field` (default: `gain`). Returns `0` when no
     * event is active or the track doesn't exist — so sketches never
     * NaN a shader uniform even during silence.
     */
    H: (trackId: string, field?: keyof IREvent) => () => number;
    /**
     * The single `sig` namespace (#351). One callable carrying every Stave signal
     * as `() => number` thunks (so hydra calls them natively each frame), plus the
     * per-sound/per-track accessor and master DSP:
     *
     *   osc(() => stave.sig.kick() * 10).out(o0)        // per-drum envelope thunk
     *   osc(() => stave.sig('bd').env() * 10).out(o0)   // one sound
     *   shape(() => stave.sig('bd').fft[0] * 4).out(o0) // arrays index natively
     *   stave.sig.track('$0').color()
     *   osc(() => stave.sig.rms() * 10).out(o0)         // master scalar thunk
     *   shape(() => stave.sig.fft[2] * 6).out(o0)        // master spectrum array
     *
     * The per-drum scalars (`sig.kick`…`sig.tom`), global `sig.keyVelocity`, and
     * master DSP (`sig.rms`…`sig.treble`) are all `() => number` thunks ON `sig`.
     * `sig('bd')` / `sig.track('$0')` return per-reading thunks; `sig.fft`/`sig.wave`
     * are live arrays; `sig.tracks`/`sig.sounds` enumerate. The bus ticks ONCE per
     * rAF in `pumpAudio` (U2 — never inside a thunk); thunks are pure reads.
     */
    sig: HydraSigAccessor;
    [customAlias: string]: any;
}
/** A per-sound or per-track reading exposed as `() => value` thunks (D-01).
 *  DSP scalars (`rms`/`bass`/`mid`/`treble`) are thunks (same shape as `.env`);
 *  DSP arrays (`fft`/`wave`) are LIVE `number[]` so hydra indexes them natively
 *  (`() => u('bd').fft[i]`) — NOT thunk-of-number per element, NOT thunk-of-array. */
interface HydraSignalThunks {
    env: () => number;
    velocity: () => number;
    note: () => number | string | null;
    color: () => string | null;
    /** Time-domain RMS, 0..1 (thunk, re-reads the bus each call). */
    rms: () => number;
    /** Low-band magnitude, 0..1 (thunk). */
    bass: () => number;
    /** Mid-band magnitude, 0..1 (thunk). */
    mid: () => number;
    /** High-band magnitude, 0..1 (thunk). */
    treble: () => number;
    /** Live normalized magnitude spectrum, `number[]` (index natively). */
    fft: number[];
    /** Live time-domain waveform -1..1, `number[]` (index natively). */
    wave: number[];
}
/** The callable `u(...)` with attached `.track`/`.tracks`/`.sounds` props AND
 *  the MASTER-mix DSP feed (Slice 2): scalar thunks + live arrays. */
interface HydraSigAccessor {
    (sound: string): HydraSignalThunks;
    /** Per-track reading, keyed on the scheduler key space (`$0`/`drums`). */
    track: (id: string) => HydraSignalThunks;
    /** Enumerate published track keys (scheduler key space). */
    tracks: string[];
    /** Enumerate distinct sounds seen through the envelope feed. */
    sounds: string[];
    kick: () => number;
    snare: () => number;
    hat: () => number;
    openHat: () => number;
    clap: () => number;
    rim: () => number;
    tom: () => number;
    /** Active event velocity, global, 0..1 thunk (was `uKeyVelocity`). */
    keyVelocity: () => number;
    /** Master-mix time-domain RMS, 0..1 (thunk). */
    rms: () => number;
    /** Master-mix low-band magnitude, 0..1 (thunk). */
    bass: () => number;
    /** Master-mix mid-band magnitude, 0..1 (thunk). */
    mid: () => number;
    /** Master-mix high-band magnitude, 0..1 (thunk). */
    treble: () => number;
    /** Live master-mix magnitude spectrum, `number[]` (index natively). */
    fft: number[];
    /** Live master-mix waveform -1..1, `number[]` (index natively). */
    wave: number[];
}
type HydraPatternFn = (synth: any, stave: HydraStaveBag) => void;
/**
 * VizRenderer that uses hydra-synth for audio-reactive WebGL visuals.
 * Lazily loads hydra-synth on first mount to avoid bloating the main bundle.
 *
 * Audio source priority:
 *   1. AnalyserNode (real FFT) — always preferred when available.
 *   2. HapStream energy envelope (synthetic FFT from note events) —
 *      ONLY used as a fallback when no analyser is published. The
 *      envelope is only useful when there's no shared audio routing
 *      (e.g., a future runtime that emits hap events without exposing
 *      an analyser); in every current source — Strudel, the built-in
 *      examples, the (future) Sonic Pi runtime — an analyser is
 *      published and takes priority.
 *
 * The historical priority was (hapStream → envelope) → (analyser),
 * which broke audio reactivity for every built-in example source
 * because those sources published a HapStream that they never
 * actually emitted on. The renderer would lock onto the silent
 * envelope and ignore the working analyser, leaving s.a.fft[] at
 * all-zero forever and the shader visually unresponsive. Issue #7.
 *
 * Reads `hydraAudioBins` from the active VizConfig.
 *
 * ## Pause / loop ownership
 *
 * Hydra is constructed with `autoLoop: false` so the renderer (not
 * hydra) owns the animation loop. Our `pumpAudio` rAF callback both
 * polls the FFT data into `s.a.fft[]` AND calls `hydra.tick(time)` to
 * advance the shader by exactly one frame. This single-loop ownership
 * is what makes `pause()` actually pause:
 *   - With `autoLoop: true` (the old behavior), hydra's internal rAF
 *     keeps running independently. Setting our `paused` flag would
 *     stop FFT polling but hydra would keep rendering its last shader
 *     state, so the canvas never visibly froze. The user-visible
 *     symptom: the Stop button did nothing on hydra previews.
 *   - With `autoLoop: false`, cancelling our rAF in `pause()` halts
 *     the only path that ticks hydra. Resume re-arms the rAF and
 *     hydra picks up where it left off.
 *
 * The `hydraAutoLoop` config flag is no longer read — pause requires
 * us to own the loop. The flag is left in `vizConfig.ts` for now and
 * will be removed in a follow-up cleanup.
 */
declare class HydraVizRenderer extends VizRendererBase {
    private pattern?;
    private hydra;
    private canvas;
    private analyser;
    private freqData;
    private rafId;
    private paused;
    private destroyed;
    private hapStream;
    private envelope;
    private hapHandler;
    private useEnvelope;
    /** Stable per-instance profiler key (`hydra#N`) — frame/fps + bus/draw timing (#228). */
    private readonly perfId;
    /**
     * Per-renderer named-signal bus (Phase 21). Generalizes `H()` /
     * `HapEnergyEnvelope`: per-sound `.env` (bump+decay) + per-track query
     * (`.velocity`/`.note`/`.color`). Fed UNCONDITIONALLY — NOT analyser-gated
     * like the envelope (BLOCK-1): the bus is IR-grounded and must stay live
     * whenever a real analyser is published (which is normal playback), or
     * `uKick` is dead in the headline use case.
     */
    private bus;
    /**
     * The bus's own HapStream subscription — SEPARATE from `hapHandler` (the
     * analyser-fallback envelope handler) so `destroy()` can off it
     * independently and unconditionally. The bus feed is never gated on
     * `useEnvelope`.
     */
    private busHapHandler;
    /**
     * Live `stave` bag handed to the user's sketch function. Built once
     * per mount; `update()` mutates its fields in place so sketches that
     * capture `scheduler` or `tracks` in a per-frame closure observe the
     * latest refs without needing a re-compile. This is the same
     * live-ref idiom the p5 sketch bag uses.
     *
     * `H` closes over `this.staveBag` (the object, not the current field
     * values) so each per-frame invocation reads the current scheduler
     * / tracks — survives `update()` re-assignments. No rebuild needed
     * when the pattern runtime swaps underneath.
     */
    private staveBag;
    constructor(pattern?: HydraPatternFn | undefined);
    protected onMount(container: HTMLDivElement, components: Partial<EngineComponents>, size: {
        w: number;
        h: number;
    }, onError: (e: Error) => void): void;
    private initHydra;
    private defaultPattern;
    private pumpAudio;
    protected onUpdate(components: Partial<EngineComponents>): void;
    resize(w: number, h: number): void;
    pause(): void;
    resume(): void;
    destroy(): void;
}

/**
 * SignalFrame — the serializable per-frame snapshot that crosses main → worker
 * so a worker-side `SignalBus` produces the same readings as the main-side bus
 * (Phase B / B-2, epic #228).
 *
 * The pure `SignalBus` (PV65/P12) ports into the worker unchanged, but its FEED
 * is main-thread-bound: `AnalyserNode` bytes (Web Audio), `scheduler.now()` /
 * `query()` (IRPattern closures), the hap stream. Each frame the MAIN thread
 * samples those into a `SignalFrame`; the worker reconstructs the bus's inputs
 * from it. This module owns ONLY the data shape + (de)serialization helpers —
 * pure, no DOM/worker, plain-object unit tests.
 *
 * What the bus actually reads (so we ship exactly that, no more):
 *   - analysers → `frequencyBinCount` + the freq/time byte arrays (deriveAudio
 *     runs in the WORKER on these bytes, keeping the DSP off main).
 *   - scheduler → `now()` + the active `IREvent`s for [now, now+ε) (combined and
 *     per-track, keyed in the SCHEDULER key space — SignalBus TRAP §5).
 *   - bump feed → per hap: `s`, `color`, `gain` (drives the envelope).
 *
 * Active events are summarised to the four fields the bus reads off an active
 * `IREvent` (`s`/`velocity`/`note`/`color` — SignalBus.sound/track), NOT the full
 * IREvent. That keeps the frame small and the transport string-set bounded.
 */
/** The fields the bus reads off an active scheduler event (see SignalBus). */
interface ActiveEventSummary {
    /** Instrument/sample name — env-map + audioFor key. */
    s: string | null;
    /** Active-event velocity 0..1 (scheduler feed). */
    velocity: number;
    /** Note in the user's form (name|number|null). */
    note: number | string | null;
    /** Display color. */
    color: string | null;
}
/** A hap replayed into the worker bus's envelope feed (`SignalBus.bump`). */
interface BumpSummary {
    /** Env-map key (`BusHapEvent.s`). */
    s: string | null;
    /** `.color()` value, if any. */
    color: string | null;
    /** Gain 0..1 — the bus reads it from `hap.value.gain` (default 1). */
    gain: number;
}
/** One analyser's raw bytes for this frame (the worker runs `deriveAudio`). */
interface AnalyserBytes {
    /** Bus/scheduler key: `'master'` for the combined mix, else the SCHEDULER key
     *  space track key (`'$0'`/`'d1'` — TRAP §5), matching `trackAnalysers`. */
    key: string;
    /** `AnalyserNode.frequencyBinCount` (= fftSize/2). */
    frequencyBinCount: number;
    /** Magnitude spectrum, one byte per bin (0..255). length === frequencyBinCount. */
    freq: Uint8Array;
    /**
     * Time-domain waveform, one byte per sample (0..255, 128 = silence).
     * B-3: length === `fftSize` (the FULL time-domain), not `frequencyBinCount` —
     * the bus only reads the first `frequencyBinCount` samples (so parity is
     * unchanged), but a raw `stave.analyser` sketch (e.g. synthterrain) calls
     * `getFloatTimeDomainData(new Float32Array(fftSize))` and needs all `fftSize`.
     * Falls back to `frequencyBinCount` length for callers that don't set fftSize.
     */
    time: Uint8Array;
    /**
     * `AnalyserNode.fftSize` (= 2 × frequencyBinCount). B-3 — lets the worker's
     * raw `stave.analyser` shim report the same `fftSize` a sketch reads. Optional
     * (additive): the bus ignores it; absent → `frequencyBinCount × 2`.
     */
    fftSize?: number;
    /** `AnalyserNode.minDecibels` (default -100). B-3 — lets the raw shim
     *  reconstruct `getFloatFrequencyData` (dB) from the magnitude bytes. */
    minDecibels?: number;
    /** `AnalyserNode.maxDecibels` (default -30). See {@link AnalyserBytes.minDecibels}. */
    maxDecibels?: number;
}
/**
 * One scheduler event marshalled for a RAW `stave.scheduler.query()` consumer
 * (B-3). The signal BUS reads only the four `ActiveEventSummary` fields, but a
 * raw sketch (synthterrain, scope, pianoroll…) reads the full hap shape over an
 * arbitrary window. We ship the top-level `IREvent` fields the built-in sketches
 * actually read — NOT `loc`/`irNodeId`/`dollarPos` (heavy, viz-irrelevant). The
 * worker scheduler shim hands these back as plain objects, so a sketch reads
 * `h.begin`/`h.note`/`h.gain` exactly as on main.
 */
interface RawHapSummary {
    begin: number;
    end: number;
    endClipped: number;
    note: number | string | null;
    freq: number | null;
    s: string | null;
    gain: number;
    velocity: number;
    color: string | null;
}
/**
 * The raw COMBINED-scheduler feed for `stave.scheduler` (B-3). The main sampler
 * queries one WIDE window each frame (covering every built-in sketch's window —
 * scope needs `now-4`, pianoroll/wordfall need `now+2`); the worker shim's
 * `query(a,b)` filters these events to the requested sub-window. Only the
 * combined scheduler is shipped (per-track raw query is not a built-in need).
 */
interface RawSchedulerFrame {
    /** `scheduler.now()` at sample (same value as `SignalFrame.now`). */
    now: number;
    /** Events in the shipped wide window, in query order. */
    events: RawHapSummary[];
}
/** The master analyser key — the combined-mix analyser (`SignalBus.master()`). */
declare const MASTER_KEY = "master";
/**
 * One frame of signal state, fully serializable (structured-clone / transferable).
 * The Uint8Arrays are the transferable payload; everything else is small JSON.
 */
interface SignalFrame {
    /** Monotonic frame counter — lets the worker drop a stale/duplicate frame. */
    seq: number;
    /** Scheduler time at sample (`SignalBus.now()` source). */
    now: number;
    /** Per-analyser bytes. `key === MASTER_KEY` is the master; others are tracks. */
    analysers: AnalyserBytes[];
    /** Combined active events for [now, now+ε) (`SignalBus.refreshActive`). */
    activeEvents: ActiveEventSummary[];
    /** Active events per track key (SCHEDULER key space — TRAP §5). */
    activeByTrack: Array<[string, ActiveEventSummary[]]>;
    /** Haps fired since the previous frame, in order (envelope `bump` feed). */
    bumps: BumpSummary[];
    /**
     * Wide-window combined-scheduler feed for raw `stave.scheduler` sketches (B-3).
     * Optional + additive: absent in B-2 frames and ignored by the signal bus
     * (which uses `activeEvents`/`activeByTrack`). The worker scheduler shim reads
     * it; absent → the shim returns no events.
     */
    rawScheduler?: RawSchedulerFrame;
}
/** Collect the transferable `ArrayBuffer`s in a frame (for postMessage transfer
 *  list). Returns the underlying buffers of every analyser byte array — passing
 *  these as transfer makes the postMessage zero-copy (no structured clone of the
 *  bytes). The frame is unusable on the sender after transfer (by design). */
declare function frameTransferables(frame: SignalFrame): ArrayBuffer[];
/** An empty frame — the worker's degraded state before the first real frame, and
 *  the main sampler's value when no analyser/scheduler/haps are bound (demo /
 *  IR-only mode). Mirrors the bus degrading absent inputs to 0/[] (never NaN). */
declare function emptyFrame(seq?: number): SignalFrame;

/**
 * demoSignalSource — a muted, looping signal feed for viz PREVIEWS (#838).
 *
 * A viz-library card renders its real viz LIVE on hover, but nothing is playing
 * (and we produce no sound), so an audio-reactive shader would read near-black —
 * the master analyser is silent, no haps fire. This module synthesizes the SAME
 * `SignalFrame`s a running engine would, from the DEFAULT DRUM PATTERN we already
 * use for baking thumbnails — `s("bd*4, ~ sd, hh*8")`:
 *
 *   - kick  (`bd`) on every quarter        → 0, ¼, ½, ¾ of the cycle
 *   - snare (`sd`) on the second half      → ½              (`~ sd`)
 *   - hat   (`hh`) eight per cycle          → 0, ⅛, ¼, … , ⅞ (`hh*8`)
 *
 * Each onset emits a `bump` keyed by the Strudel sound name (`bd`/`sd`/`hh`), so
 * the worker `SignalBus` lights `uKick`/`uSnare`/`uHat` and decays them itself
 * (aliasMap `uKick → bd`). For spectrum-reading shaders (Prism's `iChannel0` →
 * `uBass/uMid/uTreble/uRms`) we also synthesize a master magnitude spectrum whose
 * low/mid/high bands pulse with the kick/snare/hat envelopes. No audio graph, no
 * scheduler, no DOM — a pure clock-in → frame-out function, unit-testable as
 * plain objects, and byte-deterministic for a given time.
 *
 * The consumer is `WorkerVizRenderer`: when a demo source is set it supersedes the
 * live `MainSignalSampler` in the frame pump (see `setDemoSource`). The frame
 * shape is exactly `signalFrame.ts`'s, so the worker path is unchanged.
 */

/** A clock-driven frame provider. `next(nowMs)` returns the frame for the given
 *  monotonic time (`performance.now()`-style ms); it is STATEFUL (tracks the
 *  previous time to detect onsets crossed since the last frame + a rising seq). */
interface SignalFrameSource {
    next(nowMs: number): SignalFrame;
}

/**
 * SignalBus — renderer-agnostic per-sound / per-track musical-signal bus.
 *
 * PURE module (P12): imports ONLY types + `noteToMidi`. NO p5 / hydra /
 * renderer import — anything that transitively imports the bus (every unit
 * test) must load in isolation. Renderers WRAP the shape (p5 getter-numbers,
 * hydra `() => number` thunks, D-01); the bus only knows numbers, maps, and
 * the alias constant.
 *
 * It generalizes two pre-existing per-renderer feeds:
 *   - `.env`  — `HapEnergyEnvelope`'s bump+decay (decay 0.92, clamp 0..1),
 *               but keyed `Map<sound, level>` on `e.s` ('bd'), NOT by MIDI bin.
 *   - instantaneous (`.velocity`/`.note`/`.color`) — `H()`'s query-at-now read
 *               (`scheduler.query(now, now + ε)`), ε = 0.001.
 *
 * ## Two key spaces (RESEARCH §5 — TRAP)
 * `track(id)` keys on the SCHEDULER key space — `trackSchedulers.get(id)` whose
 * keys are `$0`/`$1` (anonymous) or `d1`/`drums` (named). It does NOT key on
 * `IREvent.trackId` (which is `d1`/`d{N}` and DIFFERS from the scheduler key for
 * anonymous blocks). Keying on `IREvent.trackId` silently breaks anonymous-block
 * addressing.
 *
 * ## Per-field feed (RESEARCH §5 — TRAP)
 * `.env`      ← the envelope feed (`bump()` + `tick()` decay).
 * `.velocity` ← the SCHEDULER-query feed (active IREvent). `HapEvent` carries NO
 *               `velocity` — sourcing it from the envelope feed = silent ZERO.
 * `.note`     ← the scheduler-query feed (preserves the user's form, name|number).
 * `.color`    ← either feed (prefer the active IREvent; fall back to last bump).
 */

/** Minimal shape the `.env` feed consumes off a HapStream event.
 *  We deliberately type only the fields the bus reads (`s`, optional gain via
 *  `hap.value.gain`, optional color) so the bus does NOT import HapEvent and
 *  stays decoupled from the engine event class (P12 — structural typing). */
interface BusHapEvent {
    /** Instrument/sample name — the env-map key. */
    s: string | null;
    /** From `.color()` in the pattern (last-bumped fallback for `.color`). */
    color?: string | null;
    /** Full Strudel hap — gain is read from `hap?.value?.gain`. */
    hap?: any;
}
/** What an accessor returns for a single sound or track. */
interface SignalReading {
    /** Decayed envelope level 0..1 (envelope feed). */
    env: number;
    /** Active-event velocity 0..1 (scheduler feed — NOT the envelope). */
    velocity: number;
    /** Active-event note in the user's form (name|number|null — scheduler feed). */
    note: number | string | null;
    /** Display color (active event preferred, else last-bumped hap). */
    color: string | null;
    /** Time-domain RMS 0..1 from the resolved analyser. 0 if no analyser bound. */
    rms: number;
    /** Mean of the LOW third of `fft` (0..1). 0 if no analyser bound. */
    bass: number;
    /** Mean of the MID third of `fft` (0..1). 0 if no analyser bound. */
    mid: number;
    /** Mean of the HIGH third of `fft` (0..1). 0 if no analyser bound. */
    treble: number;
    /** Normalized magnitude spectrum, `FFT_BINS` buckets, each 0..1. `[]` if no
     *  analyser bound (never NaN). */
    fft: number[];
    /** Time-domain waveform normalized -1..1. `[]` if no analyser bound. */
    wave: number[];
}
/** Master/per-analyser DSP reading — the audio half of a `SignalReading`. */
interface AudioReading {
    rms: number;
    bass: number;
    mid: number;
    treble: number;
    fft: number[];
    wave: number[];
}
/** Structural shape the bus reads off a Web-Audio `AnalyserNode` (DOM type).
 *  Typed minimally so tests can feed a plain stub (P12 — structural typing,
 *  no DOM-lib dependency for the fake). */
interface BusAnalyser {
    /** Real `AnalyserNode` exposes `frequencyBinCount = fftSize / 2`. */
    frequencyBinCount: number;
    /** Fill `arr` with the current magnitude spectrum (0..255 per bin). */
    getByteFrequencyData(arr: Uint8Array): void;
    /** Fill `arr` with the current time-domain waveform (0..255, 128 = silence). */
    getByteTimeDomainData(arr: Uint8Array): void;
}
declare class SignalBus {
    /** Per-sound envelope levels (0..1), decayed each frame. Keyed on `e.s`. */
    private readonly envMap;
    /** Last-bumped color per sound — the `.color` fallback feed. */
    private readonly colorMap;
    private readonly decay;
    /** Active alias map (built-ins + any merged custom). NOT `readonly` — the
     *  renderer pushes the merged map in via `setAliases` at mount, mirroring the
     *  in-place rebind discipline of `bindScheduler`/`bindAnalysers`. The bus
     *  stays PURE (P12): it NEVER reads the editorRegistry settings surface — the
     *  renderer reads the impure settings and pushes the map down. */
    private aliasMap;
    /** Live refs — mutable so `bindScheduler()` rebinds in place
     *  (mirrors `HydraVizRenderer.update` live-ref discipline, `:369-371`). */
    private scheduler;
    private trackSchedulers;
    /** Per-frame snapshot of active events from the combined scheduler feed
     *  (set by `refreshActive`). The instantaneous feed for `sound()`. */
    private activeEvents;
    /** Per-frame snapshot of active events per track-key (scheduler key space). */
    private activeByTrack;
    /** Every distinct `e.s` ever bumped — backs `get sounds()`. */
    private readonly seenSounds;
    /** Live master analyser ref — mutable so `bindAnalysers()` rebinds in place
     *  (mirrors `bindScheduler`). Null in IR-only / demo mode. */
    private masterAnalyser;
    /** Per-track analyser refs, keyed the SAME as `trackSchedulers` (the SCHEDULER
     *  key space `$0`/`d1`, TRAP §5) — `trackAnalysers` is published with those
     *  keys by the engine (LiveCodingEngine.ts:25). */
    private trackAnalysers;
    /** Scratch byte buffers per analyser (freq + time), allocated/resized lazily
     *  keyed on analyser identity so a rebind to a new node re-allocates. */
    private readonly freqBufs;
    private readonly waveBufs;
    /** Per-frame derived DSP reading per analyser — filled by `readAudio()`,
     *  read by the accessors. Cleared each `readAudio()` so a now-unbound
     *  analyser stops reporting stale data. */
    private audioByAnalyser;
    constructor(aliasMap?: Record<string, string | string[]>);
    /** Store live scheduler refs (mutable rebind — mirror the renderer's
     *  in-place update discipline). Pass `null`/empty in demo mode. */
    bindScheduler(scheduler: IRPattern | null | undefined, trackSchedulers: Map<string, IRPattern> | null | undefined): void;
    /** Store live analyser refs (mutable rebind — mirror `bindScheduler`). The
     *  orbit is the shared reference: a sound resolves to its orbit, which has
     *  BOTH events (the scheduler feed) AND an analyser (this DSP feed). Pass
     *  `null`/empty in IR-only / demo mode → DSP fields degrade to 0/[]. */
    bindAnalysers(master?: BusAnalyser | null, trackAnalysers?: Map<string, BusAnalyser> | null): void;
    /** Replace the active alias map in place (mirror `bindScheduler`'s mutable
     *  rebind). The RENDERER builds the merged map — `{ ...ALIAS_MAP, ...custom }`
     *  with custom WINNING on collision — and pushes it here at mount. The bus
     *  stays PURE (P12): it does NOT import `getSignalAliases`; it only stores the
     *  numbers/maps it is handed. `envValue`/`resolveSounds` resolve ANY key
     *  through this map, so a freshly-set custom alias resolves with no other
     *  change. */
    setAliases(map: Record<string, string | string[]>): void;
    /** Bump the envelope for an event's sound. Mirrors `HapEnergyEnvelope.onHap`
     *  (`:67-82`): gain clamped 0..1, level = min(1, prev + gain). Keyed on
     *  `e.s` (NOT a MIDI bin). No-ops for an event with no sound name. */
    bump(e: BusHapEvent): void;
    /** Apply decay to every envelope entry. Call ONCE per frame, BEFORE
     *  `refreshActive` (mirror `HapEnergyEnvelope.tick`, `:85-89`). */
    tick(): void;
    /** Snapshot the active events at `now` from the combined scheduler and each
     *  per-track scheduler. Call ONCE per frame, AFTER `tick()`. The window is
     *  [now, now + ε) — the same tight window `H()` uses (`:175`). */
    refreshActive(now: number): void;
    /** Current scheduler time (mirror `H()`'s `sched.now()`), 0 in demo mode. */
    now(): number;
    /** Snapshot every bound analyser's spectrum + waveform for this frame. Call
     *  ONCE per frame, AFTER `refreshActive` — `audioFor()` resolves a sound to a
     *  trackKey via `activeByTrack`, which `refreshActive` populates (ordering is
     *  the T2 call-site's responsibility). Reads each analyser via
     *  `getByteFrequencyData` + `getByteTimeDomainData` (mirrors
     *  `HydraVizRenderer.pumpAudio:445-455`) and caches the derived
     *  `AudioReading`. An analyser that's no longer bound drops out of the cache. */
    readAudio(): void;
    /** Read one analyser into the per-frame cache (idempotent within a frame). */
    private readOne;
    /** Resolve a sound (or alias) → the analyser whose mix it lives in. Find the
     *  trackKey(s) in `activeByTrack` (SCHEDULER key space, TRAP §5 — NOT
     *  IREvent.trackId) whose active events include any resolved sound. EXACTLY
     *  one such track AND that track has a bound analyser → its isolated analyser.
     *  Otherwise (multi-track, none, or no per-track analyser) → the master
     *  analyser (the combined mix — still meaningful, never silent-zero-as-bug). */
    private audioFor;
    /** Cached DSP reading for an analyser (this frame), or the zero reading. */
    private audioReading;
    /** Master DSP reading (the combined-mix analyser). Surfaces `u.rms`/`u.fft`
     *  etc. — the T3 master accessor path. Zero reading if no master bound. */
    master(): AudioReading;
    /** Resolve an alias OR a raw sound name to a list of concrete sound names.
     *  `'uKick'` → `['bd']`, `'uTom'` → `['lt','mt','ht']`, `'bd'` → `['bd']`. */
    private resolveSounds;
    /** Decayed envelope level for a sound or alias. Array aliases (`uTom`)
     *  resolve as MAX over members. Demo-mode / never-fired → 0. */
    envValue(soundOrAlias: string): number;
    /** Find the first active IREvent (combined feed) whose `s` is in `sounds`. */
    private activeEventForSounds;
    /** Per-sound reading — merged across tracks via the combined active feed
     *  (D-03). `.env` from the envelope; `.velocity`/`.note` from the active
     *  IREvent (NOT the envelope — silent-zero trap §5); `.color` from the
     *  active IREvent, falling back to the last-bumped hap color. */
    sound(soundOrAlias: string): SignalReading;
    /** Last-bumped color over the resolved sounds (the `.color` fallback feed). */
    private colorFallback;
    /** Per-track reading, keyed on the SCHEDULER key space (TRAP §5 —
     *  `trackSchedulers.get(id)`, NOT IREvent.trackId). `.env` is the max env over
     *  the sounds this track fired this frame; `.velocity`/`.note`/`.color` come
     *  from the track's first active IREvent (scheduler feed). A `sound(s)`
     *  sub-accessor reads a specific sound within the track. Unknown id → zeros. */
    track(id: string): SignalReading & {
        sound: (s: string) => SignalReading;
    };
    /** Enumerate the published track keys — the SCHEDULER key space
     *  (`trackSchedulers.keys()`, §5), e.g. `['$0','$1']` or `['d1','drums']`. */
    get tracks(): string[];
    /** Enumerate distinct sounds ever bumped through the envelope feed. */
    get sounds(): string[];
    /** Normalize a note to a MIDI number (P93 — only when a NUMBER is explicitly
     *  requested; the raw `.note` preserves the user's name|number form). Returns
     *  null for percussion sample names / unrecognized input. */
    noteToMidi(note: number | string | null): number | null;
}

/**
 * FrameSampleCache — the per-rAF-tick memo that makes the shared frame pump a win
 * (PV72, #302). It collapses the work that N worker viz duplicate every frame when
 * they read the SAME live input object:
 *
 *   - ANALYSER READS — the expensive `getByteFrequencyData` (an FFT magnitude
 *     recompute + dB + byte quantize, O(fftSize)) on a SHARED master analyser runs
 *     ONCE per tick; each consumer gets its own TRANSFER-SAFE copy (a cheap slice),
 *     because `frameTransferables` detaches the buffer on postMessage (a single read
 *     could only be transferred to one worker). 1 FFT + k slices ≪ k FFTs.
 *   - SCHEDULER QUERIES — a `query(a,b)` over the SAME (scheduler, window) runs ONCE;
 *     the result is shared BY REFERENCE across consumers (each `.map`s it read-only,
 *     and postMessage structured-clones it per worker), so there is no per-consumer
 *     cost beyond the one query. Distinct schedulers (per-track binding,
 *     viewZones.ts:341) key separately → no false sharing.
 *
 * Constructed fresh by `vizFramePump` each tick and discarded after the tick — so it
 * can never serve a stale read across frames. Keyed by INPUT-OBJECT IDENTITY (not a
 * string key): two viz sharing the master analyser object hit the cache; two viz on
 * different track analysers don't (their data genuinely differs).
 *
 * Generic over the read/query implementations (injected by the caller) so this module
 * imports no sampler internals and stays DOM-free / plain-object testable.
 *
 * REF: PV72, signalSampler.ts (the injector), signalFrame.ts:frameTransferables (why
 *      copies are needed), viewZones.ts:341 (per-track binding → identity keys), #302.
 */

declare class FrameSampleCache {
    /** Raw read per analyser object (key-independent bytes). `null` = a zero-bin
     *  analyser already attempted (so we don't re-attempt). `.has()` distinguishes
     *  "not read yet" from "read → null". The stored arrays are NEVER transferred —
     *  only the per-call slices are — so they stay intact for the whole tick. */
    private readonly analyserReads;
    /** Query results per (scheduler object → `"a:b"` window). Shared by reference. */
    private readonly queries;
    /**
     * Read `an` at most once this tick; return a TRANSFER-SAFE copy stamped with
     * `key`. The first caller for a given analyser runs `read` (the FFT); later
     * callers (a shared master, or the same node read under both `'master'` and its
     * track key) get a fresh-buffer slice of the cached bytes — no second FFT.
     */
    readAnalyser(key: string, an: BusAnalyser, read: (a: BusAnalyser) => AnalyserBytes | null): AnalyserBytes | null;
    /**
     * Run `scheduler.query(a, b)` at most once this tick per (scheduler, window).
     * Returns the SHARED result array (callers must treat it read-only — they
     * `.map`/summarise it into their own frame). `run` is the actual query closure.
     */
    query<T>(scheduler: IRPattern, a: number, b: number, run: () => T[]): T[];
}

/**
 * vizFramePump — the single rAF clock + shared sampler for ALL worker viz (PV72,
 * #302). The MAIN-THREAD-side partner to `vizGovernor`: the governor coordinates the
 * TOTAL GPU frame budget (the GPU-bound heavy-viz case, P122); this pump collapses the
 * duplicated MAIN-THREAD per-frame SAMPLE work (the many-LIGHT-viz case).
 *
 * ── Why this exists ──
 * Before this, each `WorkerVizRenderer` ran its OWN `requestAnimationFrame` loop and
 * its OWN `MainSignalSampler.sample()`. With N worker viz the per-frame analyser
 * reads + scheduler queries ran N times — B-4 (#249) measured `viz.worker.sample`
 * ≈0.33ms per call, FLAT in N → the duplicated read is the only per-viz main cost
 * that scales. The frame is NOT shareable wholesale (the analyser buffers are
 * transfer-detached, and inline zones bind PER-TRACK so the scheduler/bumps/seq are
 * genuinely per-viz, viewZones.ts:341). So the pump shares the EXPENSIVE READ, not the
 * frame: one rAF, one `FrameSampleCache` per tick that dedups analyser reads +
 * shared-scheduler queries by input-object identity. Each renderer still builds its
 * OWN frame (own sampler/bumps/seq → byte-identical reactivity, PV75).
 *
 * ── What it owns ──
 *   - ONE `requestAnimationFrame` loop, alive only while ≥1 renderer is registered.
 *   - ONE `vizGovernor.observeFrame(ts)` per tick (was per-renderer; idempotent per
 *     ts, so this is equivalent — and now there's exactly one caller).
 *   - A fresh `FrameSampleCache` per tick, passed to every registered renderer.
 *
 * Each registered renderer (`PumpDriven`) keeps ALL its existing per-viz gates
 * (#261 backpressure, maxFps cap, `governor.mayProduce`, resolution lever, paused) —
 * the pump just calls `pumpTick(ts, cache)` instead of the renderer self-scheduling.
 * Registration is on the renderer's start (mount/resume); unregister on stop
 * (pause/destroy) — mirrors `vizGovernor.register`/`unregister` exactly so the two
 * stay in lockstep.
 *
 * The main-thread `P5VizRenderer` / `HydraVizRenderer` / `GLSLVizRenderer` fallback
 * paths are NOT driven here — they keep their own draw loops; only worker renderers
 * (whose sample work is the duplicated cost) join the pump.
 *
 * REF: PV72, vizGovernor.ts (the sibling cadence owner + observeFrame), PV80/#261
 *      (the per-viz backpressure this preserves), PK22 (1:1 cadence), frameSampleCache.ts,
 *      WorkerVizRenderer.pumpTick (the gate sequence), #302.
 */

/** A renderer the pump drives once per rAF tick. Implemented by `WorkerVizRenderer`. */
interface PumpDriven {
    /** Stable id for the registry (the renderer's `perfId`). */
    readonly perfId: string;
    /** Run this renderer's per-frame produce gates + sample(cache)+writeFrame. Called
     *  once per tick while registered. `cache` is the shared per-tick sampler memo
     *  (PV72) — `undefined` when the shared cache is disabled (A/B / escape hatch), in
     *  which case the renderer samples without dedup (every read runs locally). MUST
     *  NOT throw (the pump drives every renderer; one throw would skip the rest) — the
     *  renderer guards its own body. */
    pumpTick(ts: number, cache: FrameSampleCache | undefined): void;
}

/**
 * WorkerVizRenderer — a `VizRenderer` that runs the p5 sketch in an
 * OffscreenCanvas Web Worker, off the main thread (Phase B / B-3, epic #228).
 *
 * It is the MAIN-side counterpart to `hostP5Worker`:
 *   - `mount`   — create a `<canvas>`, `transferControlToOffscreen()`, spawn a
 *     worker (via the app-injected factory), post a `mount` with the sketch CODE
 *     STRING + transferred canvas, and start ONE main `requestAnimationFrame`
 *     loop that `sample()`s the live signal feed + `writeFrame()`s it to the
 *     worker. That rAF is the single clock — the worker draws exactly one frame
 *     per `writeFrame` (1:1 → cadence can't drift; PK22).
 *   - `update`  — rebind the sampler's live inputs (re-evaluate swaps analysers /
 *     scheduler / hap stream), mirroring P5VizRenderer.update.
 *   - `resize`  — forward the new size + DPR to the worker.
 *   - `pause`/`resume` — stop/start the sampling loop + tell the worker.
 *   - `destroy` — stop the loop, tell the worker to tear down, terminate it.
 *
 * The ONLY per-frame main-thread cost is `sample()` (read analyser bytes + ONE
 * wide scheduler query + now) + a transferable `postMessage` — the heavy
 * `draw()` is gone from main. That residual is what the matrix measures (PLAN §8).
 *
 * Falls back is NOT handled here: `makeRenderer` only constructs a
 * WorkerVizRenderer when a worker factory is registered AND the transport is
 * worker-capable; otherwise it builds a `P5VizRenderer`. If the factory is
 * somehow absent at mount, `mount` reports via `onError` so the host can recover.
 *
 * REF: hostP5Worker.ts, signalSampler.ts, signalTransport.ts, vizWorkerFactory.ts,
 *      P5VizRenderer.ts (the lifecycle + alias contract mirrored here), PK22.
 */

declare class WorkerVizRenderer extends VizRendererBase implements PumpDriven {
    private readonly kind;
    private readonly code;
    private readonly name;
    private worker;
    private writer;
    private readonly sampler;
    /** When set (viz PREVIEWS, #838), supersedes the live sampler in the pump: the
     *  frame comes from this muted demo feed instead of the analyser/scheduler, so a
     *  card can render its viz audio-reactively while nothing is playing. Null =
     *  the normal live path. */
    private demoSource;
    private running;
    /** Frames written but not yet acked by the worker (#261 backpressure). The
     *  sampler skips producing while this is at the cap so a slow worker can't be
     *  flooded into a stale backlog. Reset to 0 on (re)start so a resume can't be
     *  wedged by acks owed for frames written before a pause. */
    private inFlight;
    /** rAF timestamp of the last produced frame — the `vizConfig.maxFps` cap clock
     *  (#261). Reset on (re)start. */
    private lastProduceTs;
    /** Governor render-resolution scale currently applied to the backing store
     *  (lever 3, P122/PV91). 1 = full (the no-op common case). The tick re-posts a
     *  scaled `resize` only when `vizGovernor.resolutionScale()` crosses a quantized
     *  step, so the (relatively expensive) backing-store realloc fires rarely. */
    private govResScale;
    private size;
    private onError;
    /** Stable id — the `vizGovernor` round-robin key AND the `vizFramePump` registry
     *  key (public for the `PumpDriven` contract). */
    readonly perfId: string;
    private diagHandler;
    /** The presenting <canvas> this renderer appended (transferred to the worker).
     *  Tracked so destroy() removes it — else a fallback to the main-thread renderer
     *  would leave a dead, frozen canvas behind it (#247). */
    private canvasEl;
    /** Fired ONCE when the worker posts its first-frame `ready` (#247). The
     *  `FallbackVizRenderer` sets this to learn the worker is healthy. */
    private onReady;
    /** Unsubscribe from vizConfig changes — re-marshals the worker subset on a
     *  quality/LOD change (#269). Cleared in destroy() so a torn-down renderer
     *  doesn't post to a terminated worker. */
    private configUnsub;
    /** Whether this renderer drew its worker from the reuse POOL (#263 A). Decided
     *  at mount; on destroy a pooled worker is PARKED (kept warm) instead of
     *  terminated, so the next mount reuses the thread (no fresh allocation). */
    private pooled;
    /** Set once the worker reports its first `ready` frame. Only a HEALTHY worker
     *  is returned to the pool on destroy — a never-ready (broken/fallback) worker
     *  is terminated so it can't poison a future acquire. */
    private ready;
    /** Set when the worker reports it created a WebGL context (`glctx+`, #266) — so
     *  destroy() can decrement the `viz.glctx` gauge reliably (the worker's release
     *  happens after we've detached its listener, so we account it main-side). */
    private glAccounted;
    /** Serialized options last posted to the worker (#875) — `update()` only re-posts
     *  when the bag actually changed, so a re-publish with identical options costs
     *  nothing. `null` until mount. */
    private lastOptionsKey;
    /** @param kind renderer kind (`'p5'` B-3 / `'hydra'` B-5 / `'glsl'` #281).
     *  @param code raw sketch source. @param name workspace path (error attribution). */
    constructor(kind: 'p5' | 'hydra' | 'glsl', code: string, name: string);
    /** Register a callback fired once when the worker reports its first successful
     *  frame (`ready`). Used by `FallbackVizRenderer` to end the startup probation;
     *  must be set BEFORE `mount`. */
    whenReady(cb: () => void): void;
    /** Drive this renderer from a muted DEMO signal feed instead of the live
     *  analyser/scheduler (viz PREVIEWS, #838). Set before/after mount; null
     *  restores the live path. The pump reads `next(ts)` each produced frame. */
    setDemoSource(src: SignalFrameSource | null): void;
    protected onMount(container: HTMLDivElement, components: Partial<EngineComponents>, size: {
        w: number;
        h: number;
    }, onError: (e: Error) => void): void;
    protected onUpdate(components: Partial<EngineComponents>): void;
    /** The options bag as the worker can receive it: structured-CLONED, not shared.
     *  A non-cloneable value (a function passed to `.viz(name, {…})`) would throw
     *  DataCloneError from `postMessage` and take the whole mount down — so drop
     *  those keys instead. They could never have reached a worker sketch anyway, and
     *  dropping one key degrades exactly as far as the pre-fix behaviour did.
     *
     *  PURE — it must not touch `lastOptionsKey`. (It did, briefly: `update()` then
     *  compared the fresh key against the one this call had just written, so it saw
     *  "no change" every time and never posted. A silent no-op fix for a silent
     *  no-op bug.) */
    private postOptions;
    resize(w: number, h: number): void;
    /** Post a `resize` sizing the worker backing store to the CSS size scaled by the
     *  governor's render-resolution lever (P122/PV91). At scale 1 (disabled/smooth)
     *  this is byte-identical to posting the raw CSS size — transparent. Under stress
     *  it shrinks the backing store (smaller buffer, CSS size unchanged → stretched to
     *  fill, aspect-preserved PV76); ¼ the fragment work at scale 0.5. We scale `w,h`,
     *  NOT `dpr`, because the GLSL + hydra worker `resizeKind` IGNORE dpr (size to CSS
     *  px directly) — and those are exactly the heavy GPU-bound kinds this targets. */
    private postBackingSize;
    pause(): void;
    resume(): void;
    destroy(): void;
    /** Bind the sampler's live inputs from the component bag (mirror P5VizRenderer:
     *  scheduler + per-track schedulers, master + per-track analysers, hap stream). */
    private bindSampler;
    /** Join the shared frame pump — the SINGLE rAF + shared sampler now drives this
     *  renderer's per-frame produce via `pumpTick` (PV72), instead of each renderer
     *  owning its own rAF. Still registers with the governor for the GPU-budget pool. */
    private start;
    /**
     * One produce step, called by `vizFramePump` once per rAF tick while registered
     * (PumpDriven). This is the EXACT gate sequence the old per-renderer rAF ran —
     * resolution lever → #261 backpressure → maxFps cap → governor concurrency gate
     * → sample+write — moved verbatim, with two differences: the pump owns the rAF
     * (no self-reschedule) and calls `vizGovernor.observeFrame` once for all viz (it
     * was idempotent per ts, so equivalent); and `sample(cache)` routes the analyser
     * read + scheduler query through the SHARED per-tick cache, so N viz on the same
     * input collapse N reads → 1 (the PV72 win). The frame is still per-viz (own
     * sampler/bumps/seq) → byte-identical reactivity (PV75). Guarded so a throw can't
     * stall the pump's other renderers (PumpDriven contract).
     */
    pumpTick(ts: number, cache: FrameSampleCache | undefined): void;
    private stop;
}

/**
 * Viz-worker factory DI seam (Phase B / B-3).
 *
 * The worker MUST be constructed where the bundler can statically see
 * `new Worker(new URL('./viz-worker.ts', import.meta.url))` — that's the APP
 * (Next/Turbopack), not this tsup-built package. So the editor stays
 * bundler-agnostic: the app registers a factory at startup, and
 * `WorkerVizRenderer` reads it here. When no factory is registered (e.g. a host
 * that hasn't wired the worker, or the flag is off), `makeRenderer` falls back to
 * the main-thread `P5VizRenderer`.
 *
 * REF: PHASE-B-PLAN §4 (transport/bundling), vizCompiler.makeRenderer.
 */
/** Constructs a fresh viz worker. The app provides
 *  `() => new Worker(new URL('./viz-worker.ts', import.meta.url), { type: 'module' })`. */
type VizWorkerFactory = () => Worker;
/** Register (or clear with `null`) the app's worker constructor. Idempotent. */
declare function setVizWorkerFactory(f: VizWorkerFactory | null): void;
/** The registered factory, or `null` if the host hasn't wired worker rendering. */
declare function getVizWorkerFactory(): VizWorkerFactory | null;

/**
 * vizFlags — the SINGLE SOURCE OF TRUTH for the `stave.viz.*` localStorage knobs.
 *
 * These are developer / rollback flags (NOT user settings): each one A/B-toggles a
 * worker-viz perf lever from the browser console without a code change, e.g.
 * `localStorage.setItem('stave.viz.p5direct', '0')` then re-evaluate. They were
 * previously read with bare inline `localStorage.getItem(...)` calls spread across 5
 * sites in 2 packages, each re-implementing its own try/catch + default/parse logic
 * with subtle variance (#327). This module centralises the keys + the parse semantics
 * so there is ONE place to look them up and ONE definition of each default.
 *
 * THREE flag shapes:
 *   - default-ON  → enabled unless the value is exactly '0'  (p5direct, governor, pump)
 *   - opt-IN      → enabled only when the value is exactly '1' (pool)
 *   - tri-state / numeric → '1'|'0'→bool|null, or a finite positive number  (worker,
 *     maxFps, maxDpr — read app-side, applied as vizConfig overrides)
 *
 * Every reader is try/catch-safe (private mode / no-DOM → the documented default).
 *
 * INVENTORY of all `stave.viz.*` keys (this module owns reading them):
 *   stave.viz.worker    tri   force the OffscreenCanvas-worker renderer on('1')/off('0')
 *   stave.viz.p5direct  dON   p5 renders direct into the display canvas (#325 Tier A)
 *   stave.viz.pool      optIn warm worker-pool reuse (#263)
 *   stave.viz.governor  dON   adaptive-perf governor (also the "Adaptive performance" UI)
 *   stave.viz.pump      dON   per-tick shared sampler cache (PV72 dedup)
 *   stave.viz.maxFps    num   frames/sec cap override (e.g. '60'/'30')
 *   stave.viz.maxDpr    num   presenting/render dpr cap override (e.g. '1'/'1.5')
 *
 * NON-viz `stave.*` keys are intentionally NOT here — they belong to their own domains
 * and are single-site, not duplicated: `stave.debugger.*`, `stave.file.*`, `stave.play`,
 * `stave.stop`, `stave.strudel.tier.*`, `stave.u.*`, `stave.uClap`.
 */
/** The canonical key strings — the inventory consumers import instead of literals. */
declare const VIZ_FLAG_KEYS: {
    readonly worker: "stave.viz.worker";
    readonly p5direct: "stave.viz.p5direct";
    readonly pool: "stave.viz.pool";
    readonly governor: "stave.viz.governor";
    readonly pump: "stave.viz.pump";
    readonly maxFps: "stave.viz.maxFps";
    readonly maxDpr: "stave.viz.maxDpr";
};
/** #325 Tier A — p5 renders direct into the transferred display canvas. DEFAULT ON;
 *  `stave.viz.p5direct='0'` forces the old blit path. */
declare function isP5DirectCanvasEnabled(): boolean;
/** Adaptive-perf governor (PV91). DEFAULT ON; `stave.viz.governor='0'` disables. */
declare function isVizGovernorEnabled(): boolean;
/** Per-tick shared sampler cache (PV72 dedup). DEFAULT ON; `stave.viz.pump='0'` runs
 *  the pump WITHOUT the shared cache (every viz samples per-viz). */
declare function isVizPumpSharedCacheEnabled(): boolean;
/** Warm worker-pool reuse (#263). OPT-IN while validated; `stave.viz.pool='1'` enables. */
declare function isVizWorkerPoolEnabled(): boolean;
/** Force the worker renderer on('1')/off('0'); null = no override (keep the
 *  `vizConfig.workerRenderer` default). Read app-side in `registerVizWorker`. */
declare function getVizWorkerOverride(): boolean | null;
/** frames/sec cap override (#261), or null for the config default. */
declare function getVizMaxFpsOverride(): number | null;
/** presenting/render dpr cap override (#261), or null for the config default. */
declare function getVizMaxDprOverride(): number | null;

/**
 * Hydra shader presets for audio-reactive visualization — `HydraPatternFn`
 * closures (the public `@stave/editor` API; re-exported from index.ts).
 *
 * These are now DERIVED from the canonical code STRINGS in `builtinHydraCode.ts`
 * (B-5 #252): the strings are the single source of truth so the built-in hydra
 * descriptors can compile in a worker (a closure can't cross to one). Deriving
 * the closures from the same strings keeps the public API AND avoids the
 * picker-vs-source divergence the p5 path hit (PV56/#184). `compileHydraCode`
 * returns a `HydraPatternFn` that runs the string via `new Function('s','stave')`
 * — `s` = the hydra synth, `s.a.fft[0..3]` = the master audio bins.
 */
/** Scrolling frequency bands — hydra's take on a pianoroll. */
declare const hydraPianoroll: HydraPatternFn;
/** Audio-reactive oscilloscope — smooth waveform with frequency modulation. */
declare const hydraScope: HydraPatternFn;
/** Kaleidoscope — mirrored fractal patterns driven by audio energy. */
declare const hydraKaleidoscope: HydraPatternFn;

/**
 * All built-in visualization modes.
 *
 * IDs follow the "mode:renderer" convention when multiple renderers offer
 * the same concept. Bare "mode" is the default renderer for that concept.
 *
 * The 7 p5 entries compile their factories from the bundled source code
 * strings — the SAME strings the workspace `preset/viz/*.p5` files carry.
 * Previously the picker mounted 7 hand-written TypeScript sketch classes
 * that had diverged from the preset code; per #184 (PV56) the picker and
 * the preset file share one code path.
 *
 * Each factory creates a NEW renderer instance per mount — never share
 * a single instance across multiple mounts.
 *
 * Consumers extend via spread:
 *   vizDescriptors={[...DEFAULT_VIZ_DESCRIPTORS, myCustomDescriptor]}
 */
declare const DEFAULT_VIZ_DESCRIPTORS: VizDescriptor[];

/**
 * Resolves a viz ID to a VizDescriptor using the "mode:renderer" convention.
 *
 * Resolution order:
 *   1. User-named viz registry — exact name match first, then a
 *      NORMALIZED match (case/space/hyphen/underscore insensitive) in the
 *      runtime `namedVizRegistry` (populated by saved viz presets). User
 *      intent wins over built-ins, so a user-saved preset named
 *      `"pianoroll"` shadows the built-in `"pianoroll:hydra"`. The
 *      normalized hop is what lets inline `.viz("pianoroll")` reach the
 *      bundled `"Piano Roll"` preset — the SAME preset the `.pianoroll()`
 *      backdrop renders — instead of falling through to the built-in
 *      sketch (P73 / PV56).
 *   2. Exact match on `descriptor.id`
 *      e.g. "pianoroll:hydra" → "pianoroll:hydra"
 *   3. Default renderer — append `":${defaultRenderer}"` from config and retry
 *      e.g. "pianoroll" + defaultRenderer="hydra" → "pianoroll:hydra"
 *   4. Prefix fallback — bare mode matches first descriptor whose id starts
 *      with `vizId + ":"` (catches renderer variants not matching the default)
 *
 * Returns undefined if no match is found.
 */
declare function resolveDescriptor(vizId: string, descriptors: VizDescriptor[]): VizDescriptor | undefined;

/**
 * groupLayout — pure functions for the 2D workspace group layout.
 *
 * The workspace shell arranges editor/preview groups into a two-level
 * grid: an outer horizontal row of **columns**, and each column is a
 * vertical stack of **cells** (groups). This shape gives the user four
 * drop targets per group (N/S/E/W) while staying simple enough to
 * render as a top-level horizontal `SplitPane` whose children are
 * either a leaf group or a nested vertical `SplitPane`.
 *
 * @remarks
 * ## Why a 2-level grid and not a full tree
 *
 * VS Code's layout engine is a full recursive tree — each node can be
 * a horizontal split OR vertical split OR leaf, nested arbitrarily
 * deep. That supports layouts like "split left, then split the left
 * column vertically, then split the top of that horizontally again."
 *
 * For Phase 10.2 we need N/S/E/W drops from any group but not the
 * arbitrary nesting. The 2-level model (columns of cells) covers the
 * common case:
 *
 *     ┌──────┬──────┬──────┐
 *     │      │  B   │      │
 *     │  A   ├──────┤  D   │
 *     │      │  C   │      │
 *     └──────┴──────┴──────┘
 *
 * Column 0 = [A], column 1 = [B, C], column 2 = [D].
 *
 * If a future phase needs recursive nesting, this module's external
 * API (insertGroup, removeGroup, findGroupCoords) stays mostly the
 * same — only the internal representation changes.
 *
 * ## Why pure functions in a separate module
 *
 * The shell's React reducer is already crowded with state updaters.
 * Keeping the layout arithmetic pure and module-level:
 *
 *   1. Lets tests exercise every transition without a React harness.
 *   2. Avoids stale-closure bugs inside setState callbacks — every
 *      function takes the full layout and returns a new one.
 *   3. Makes the invariant "no group id appears twice in the layout"
 *      checkable in one place.
 *
 * Every function returns a NEW array (never mutates input). The shell
 * passes the result straight to `setLayout`.
 */
/**
 * One column is a vertical stack of group ids. `[g1]` is a column with
 * one cell; `[g1, g2]` stacks g1 on top of g2. Empty columns are not
 * allowed — `removeGroup` collapses them away.
 */
type LayoutColumn = readonly string[];
/**
 * The shell's full 2-D layout: an ordered list of columns arranged
 * left-to-right at the horizontal level. An empty root layout (`[]`)
 * means "no groups at all" and the shell renders a drop-target
 * placeholder.
 */
type GroupLayout = readonly LayoutColumn[];

/**
 * aliasMap — built-in named-signal aliases for the SignalBus, plus the
 * engine-keyed model that lets one alias NAME carry per-engine sound lists.
 *
 * ## Why engine-keyed
 * The bus is engine-agnostic at the IR level (it keys on `IREvent.s`), but the
 * `s` VALUES are the one place engine-specificity leaks through: Strudel writes
 * `bd`/`sd`/`hh`; Sonic Pi writes sample symbols (`drum_heavy_kick`,
 * `drum_snare_hard`) and synth names (`prophet`, `beep`) — verified against the
 * Sonic Pi source (`synthinfo.rb` `@@grouped_samples` :9304+, `@@synth_infos`
 * :9609; every trigger resolves to a single `scsynth_name` string,
 * `sound.rb:160-181`). The key fact: in BOTH engines a sound's identity is a
 * single STRING (or a list) — the alias VALUE type never needs to be richer,
 * only the values differ per engine. So an alias absorbs the leak: the NAME
 * (`kick`) stays unified across engines, only the sound list is per-engine.
 *
 *   kick → { strudel: ['bd','kick9'], sonicpi: ['drum_heavy_kick'] }
 *
 * The active engine is resolved at MOUNT (`resolveAliasesForEngine`) down to the
 * flat `Record<name, string|string[]>` the bus already consumes — so the bus and
 * its `setAliases` contract are UNCHANGED; the engine dimension lives entirely in
 * storage + this resolver (PV12: the bus stays pure, never sees an engine).
 *
 * ## Array aliases
 * An alias may map to a SINGLE sound (`uKick → 'bd'`) or an ARRAY
 * (`uTom → ['lt','mt','ht']`); for array aliases the bus resolves the envelope
 * value as the MAX over members (any tom firing lights the alias).
 *
 * NOTE: `uKeyVelocity` is NOT a sound alias — it resolves to the active event's
 * `.velocity` (handled in the per-renderer bare-alias preamble, not here).
 */
/** The live-coding engine a viz sketch is currently driven by. Strudel is the
 *  only engine wired today; `sonicpi` is reserved for Sonic Web (a thesis,
 *  not yet built — see `project_sonic_pi_web`). The union is open by intent:
 *  storage/sanitize keep ANY engine key with a valid value, so a future engine
 *  survives a round-trip through an older build. */
type VizEngine = 'strudel' | 'sonicpi';
/** A resolved alias value for one engine: a single sound name, or a list whose
 *  envelope reads as the MAX over members. */
type EngineAliasValue = string | string[];
/** One alias' per-engine sound lists. Partial: an alias may define a value for
 *  some engines and not others (e.g. a Strudel-only clap with no Sonic Pi
 *  equivalent → silently inert under Sonic Pi, never a crash). */
type EngineAliasMap = Partial<Record<VizEngine, EngineAliasValue>>;
/** The persisted custom-alias shape: alias name → per-engine sound lists. This
 *  is what lives in localStorage (`editorRegistry`); the flat per-engine view
 *  the bus consumes is derived from it via `resolveAliasesForEngine`. */
type StoredSignalAliases = Record<string, EngineAliasMap>;
/** The active viz engine. Strudel is the only live engine today; this is the
 *  single wire-point — when Sonic Web lands, source the active engine from
 *  the running `LiveCodingEngine` at the renderer mount and pass it to
 *  `resolveAliasesForEngine`. */
declare const DEFAULT_VIZ_ENGINE: VizEngine;
/**
 * Built-in aliases, engine-keyed. Strudel values are the canonical Strudel
 * sound names; Sonic Pi values are sample symbols from the Sonic Pi source
 * (`synthinfo.rb` `@@grouped_samples`, the `:drum` group) so the built-in
 * signals work cross-engine the day Sonic Web ships. Aliases with no
 * canonical Sonic Pi sample (`uClap`, `uRim`) intentionally omit the `sonicpi`
 * slot rather than guess — they stay Strudel-only until a user maps them.
 */
declare const BUILTIN_ALIASES: Record<string, EngineAliasMap>;
/**
 * Resolve built-ins + custom aliases into the flat `Record<name, value>` the bus
 * consumes for a single engine. Built-ins first, custom LAST so a user override
 * WINS on collision (mirrors the old `{ ...ALIAS_MAP, ...custom }` merge). An
 * alias with no value for `engine` is omitted (its bare name stays unbound under
 * that engine — honest, never a silent zero-as-bug). Pure: takes the stored
 * custom map as an arg, imports nothing impure (PV12).
 */
declare function resolveAliasesForEngine(custom: StoredSignalAliases, engine: VizEngine): Record<string, EngineAliasValue>;
/**
 * ALIAS_MAP — the built-in aliases flattened for the DEFAULT engine (Strudel).
 * Kept as a derived view for back-compat: the bus' default constructor and the
 * renderers' bare-name injection consume this flat shape. Equivalent to the
 * pre-engine-keyed constant (`uKick → 'bd'`, `uTom → ['lt','mt','ht']`).
 */
declare const ALIAS_MAP: Record<string, EngineAliasValue>;

/** Top-level statement nodes, or null when the doc doesn't parse
 * (mid-keystroke syntax error — the caller keeps the last good chunk). */
declare function parseTopLevel(doc: string): any[] | null;
/** Does the doc parse at all? Distinguishes "no statement here" from "broken doc". */
declare function docParses(doc: string): boolean;

/** Coarse hint for which editor a chunk can open. Panels still read the
 * structured fields below to decide what they can actually edit. */
type ChunkType = 'step' | 'roll' | 'knobs' | 'unknown';
interface ChainArg {
    /** source text of the argument expression, verbatim */
    raw: string;
    /** numeric value when the arg is a (possibly negated) number literal, else null */
    numeric: number | null;
    /** absolute doc offsets of the argument expression */
    range: [number, number];
}
interface ChainCall {
    name: string;
    args: ChainArg[];
    /**
     * For member calls: [dotOffset, callEnd] — replacing/deleting this range
     * removes the call. For the head call: the full call expression range.
     */
    range: [number, number];
}
interface ChunkInfo {
    /** the whole top-level statement (incl. any `$:` label) */
    statementRange: [number, number];
    /** the statement's exact source when detected — used to verify freshness */
    statementText: string;
    /** the pattern expression, excluding the `$:` label — append `.fx()` here */
    exprRange: [number, number];
    /** `$:` label name, or null */
    label: string | null;
    /** head function name, e.g. `s`, `note`, `stack` */
    headFn: string | null;
    /** contents of the mini string, quotes excluded — see `miniVia` for who found it */
    miniRange: [number, number] | null;
    miniString: string | null;
    /**
     * WHO FOUND `miniRange` (#1240). `literal` — the head call's first string
     * argument, the rule this module has always used. `resolver` — `miniSource`
     * named the span after the literal walk found nothing: a bound reference, a
     * chained argument, a root literal, a head that is not a content head.
     *
     * Carried rather than inferred because the two are DIFFERENT CONFIDENCE
     * LEVELS and a coverage table that blurs them cannot be read. `null` when
     * there is no mini span at all.
     */
    miniVia: 'literal' | 'resolver' | null;
    /**
     * The freshness guard for a mini span that lies OUTSIDE `statementRange` —
     * `s(drums)` whose content is declared in `const drums = "bd sd"` two
     * statements up. Null whenever the span is inside the unit's own statement,
     * which is every `literal` chunk and most resolver ones.
     *
     * WHY IT EXISTS. This module's contract is that `isChunkFresh` gates every
     * write, and it did that by watching `statementRange` — sound while the only
     * writable span was inside it. A resolver span breaks that premise: the guard
     * would watch the unit's statement while the write lands in a different one,
     * so an edit to the declaration between detect and write corrupts unrelated
     * code and every existing check still passes. The invariant is "every byte we
     * may write is freshness-guarded", and its span is now two statements — so
     * the guard widens rather than the feature narrowing (refusing these instead
     * costs 43 of 125 resolver units, including every `s`/`sound` one).
     */
    miniAnchor: {
        range: [number, number];
        text: string;
    } | null;
    /** calls in source order, head first */
    chain: ChainCall[];
    type: ChunkType;
    /** true when `detectChunk` descended into a combinator argument — i.e. this is
     *  a NESTED voice inside `stack(...)`/`cat(...)` (#395), not a top-level track.
     *  The Pattern inspector uses it to offer a per-voice gain knob (#620): a
     *  top-level track's gain is owned by the channel-strip fader, but a nested
     *  voice's isn't, so only there does the inspector surface gain. Always false
     *  for `detectAllChunks` (every chunk there is top-level). */
    nested: boolean;
}

/**
 * A chunk's ranges are only valid against the exact doc it was detected from.
 * Every write MUST check this first.
 */
declare function isChunkFresh(doc: string, chunk: ChunkInfo): boolean;
/**
 * The innermost editable chunk under `pos`, or null. Descends into combinator
 * arguments — a cursor on a track inside `stack(...)` binds THAT track, not the
 * whole `$: stack(...)` statement (#395). A top-level cursor is unchanged.
 */
declare function detectChunk(doc: string, pos: number): ChunkInfo | null;
/** Every editable chunk in the doc, in source order. */
declare function detectAllChunks(doc: string): ChunkInfo[];
/**
 * Best-guess primary editor for a chunk. Coarse — panels read `chain`/`mini`
 * directly to decide what they can edit. A pattern with a `note`/`n` head and
 * a mini string is roll-shaped; an `s`/`sound` head with a mini string is
 * grid-shaped; anything with a numeric chain literal can at least show knobs.
 */
declare function classifyChunk(info: ChunkInfo): ChunkType;

/**
 * writeback — chunk → document.
 *
 * The mutation half of the visual-editing spine. Visual panels read a
 * `ChunkInfo` (see `chunkDetect.ts`) to learn the doc offsets they may edit,
 * then route every edit through here so it is:
 *
 *  1. **Surgical** — only the named offset range changes; the rest of the
 *     statement (mini-notation quotes, spacing, indent) stays byte-identical.
 *     This is the whole reason write-back panels edit TEXT and not the IR:
 *     `toStrudel` is a whole-statement canonical regenerator that would
 *     reformat the leaf layer (design doc Appendix A).
 *  2. **Origin-tagged** — while a panel edit is applied, `currentSource` names
 *     it, so the host's `onDidChangeModelContent` listener can tell a panel
 *     edit (re-eval audio, keep panel model) from a typed edit (re-parse the
 *     panel model). Monaco's content-change event carries no source of its
 *     own, so the flag is set synchronously around the edit — the listener
 *     fires inside `pushEditOperations`, while the flag is up.
 *  3. **One undo step** — every call is a single `pushEditOperations`, so even
 *     a multi-cell drag (`replaceRanges`) is one Ctrl-Z.
 *
 * Range discipline: offsets come from a `ChunkInfo` and are valid ONLY against
 * the exact doc it was detected from. Use `applyFresh` (or call `isChunkFresh`
 * yourself) before every write — stale offsets corrupt unrelated code.
 *
 * The pure helpers (`formatNumber`, `normalizeEdits`) are string/number math
 * with no Monaco dependency, so they unit-test with plain assertions. The
 * `Writeback` class is the thin Monaco-bound shell, observed in the app.
 */

/**
 * Which panel originated an edit. The host content-change listener switches on
 * this to decide whether to re-parse its model (typed edit) or leave it
 * (panel-originated edit it already knows about).
 */
type WriteSource = 'knob' | 'seq' | 'roll' | 'arrange.weights' | 'arrange.structure' | 'transport' | 'mixer' | 'rename' | 'automation';
/** A single replacement, addressed by absolute pre-edit doc offsets. */
interface OffsetEdit {
    /** absolute [start, end) offsets in the document as it was when detected */
    range: [number, number];
    /** replacement text ('' to delete) */
    text: string;
}
/**
 * Format a number for insertion as a source literal. Drag handlers produce
 * values like `0.30000000000000004` or `2.9999999`; emitting those verbatim
 * would corrupt the user's code with float noise. We round to `maxDecimals`
 * and strip trailing zeros, so `0.3`, `2`, `-1.5` come out clean.
 *
 * Pure — no Monaco.
 */
declare function formatNumber(v: number, maxDecimals?: number): string;
/**
 * Validate a batch of edits and return them sorted ascending by start offset.
 * Throws on any overlap — overlapping ranges in a single `pushEditOperations`
 * have undefined application order and would corrupt the doc. Zero-width edits
 * (inserts) are allowed and never count as overlapping a neighbour that starts
 * at the same offset only if texts don't both target it; we conservatively
 * reject ranges that share interior space.
 *
 * Pure — no Monaco.
 */
declare function normalizeEdits(edits: OffsetEdit[]): OffsetEdit[];
/**
 * Apply a batch of offset edits to a string and return the result. Pure mirror
 * of what `Writeback.apply` does to a Monaco model — used by callers that edit
 * plain text (arrangement round-trip / parity tests) and to preview an edit
 * before it touches the document. Edits are validated + sorted by
 * `normalizeEdits`, then spliced from the END so earlier offsets stay valid.
 *
 * Pure — no Monaco.
 */
declare function applyEdits(doc: string, edits: OffsetEdit[]): string;
/**
 * Monaco-bound edit sink. One per editor. Construct with the editor instance
 * and the `monaco` namespace (for `Range`). All edits go through `apply`, which
 * keeps the origin flag up across the synchronous content-change event.
 */
declare class Writeback {
    private readonly editor;
    private readonly monaco;
    private writingSource;
    /** true between beginGesture/endGesture — suppresses per-edit undo boundaries */
    private inGesture;
    /** whether the in-flight gesture has applied any edit — gates the one re-eval
     * on `endGesture` so a gesture that wrote nothing doesn't re-evaluate. */
    private gestureDidEdit;
    /** trailing-debounce timer for the live re-eval (see `requestLiveReeval`). */
    private reevalTimer;
    constructor(editor: Monaco.editor.IStandaloneCodeEditor, monaco: typeof Monaco);
    /**
     * Open a gesture: edits applied until `endGesture` coalesce into ONE undo
     * step. Used for a continuous knob drag or a multi-cell sweep so the whole
     * gesture is a single Ctrl-Z. Re-eval still fires per edit (live audio); only
     * the undo grouping is affected. Idempotent if already in a gesture.
     */
    beginGesture(): void;
    /** Close the gesture, sealing all its edits as one undo step — and, if the
     * gesture changed anything, make it audible immediately (one re-eval on
     * release, not per drag frame). */
    endGesture(): void;
    /**
     * The source of the edit currently being applied, or null. The host's
     * `onDidChangeModelContent` listener reads this synchronously to attribute
     * the change. It is non-null ONLY for the duration of `apply`.
     */
    get currentSource(): WriteSource | null;
    /** Replace a single offset range. One undo step. */
    replaceRange(range: [number, number], text: string, source: WriteSource): void;
    /**
     * Replace several non-overlapping ranges as ONE edit — one undo step. Used
     * for multi-cell drags (toggle several steps, then a single Ctrl-Z reverts
     * the whole gesture).
     */
    replaceRanges(edits: OffsetEdit[], source: WriteSource): void;
    /** Insert text at an offset (zero-width edit). */
    insertAt(offset: number, text: string, source: WriteSource): void;
    /** Delete an offset range. */
    deleteRange(range: [number, number], source: WriteSource): void;
    /**
     * Freshness-guarded write. Re-reads the live model text and refuses the edit
     * if the chunk's statement no longer matches what it was detected from
     * (the doc changed under the panel). Returns true if applied, false if stale.
     * Prefer this over the raw methods on any path that can race a typed edit.
     */
    applyFresh(chunk: ChunkInfo, edits: OffsetEdit[], source: WriteSource): boolean;
    private apply;
    /**
     * Ask the app to re-evaluate the EDITED file so a visual mutation is audible
     * the moment it commits. Centralised here so every visual surface — sequencer,
     * piano roll, knobs, mixer — goes live from ONE place, not per panel. The app
     * re-evals only a PLAYING file, and only when live mode isn't already doing
     * it, so this never auto-starts audio nor double-evaluates.
     *
     * Trailing-debounced: rapid successive commits (e.g. clearing several
     * sequencer steps in a row) coalesce into ONE re-eval shortly after the last,
     * which also lets the Monaco→file-store sync settle so the re-eval reads the
     * final content rather than racing a not-yet-synced edit.
     */
    private requestLiveReeval;
}

/**
 * editorRegistry — tiny module-level map so callers outside the
 * editor package (shell, app, outline panel) can find the Monaco
 * editor instance that's currently rendering a given fileId. Used
 * for cross-file navigation features like "reveal at line".
 *
 * EditorView registers on mount and unregisters on unmount. Only the
 * ACTIVE editor for a fileId matters — if two groups show the same
 * file, the last mount wins, which matches the UX ("jump to this
 * symbol" lands wherever the editor is currently focused).
 */

type MonacoEditor = any;
/** The active Monaco editor, or null if none is focused/mounted. */
declare function getActiveEditor(): MonacoEditor | null;
/**
 * The fileId of the active editor, or null if none is active. Reverse-looks-up
 * the registry (one registered editor per fileId). Visual-editing consumers that
 * must follow the SAME file the active editor shows — e.g. the Mixer meters
 * pinning the audio bus to the active program rather than the bus's "default"
 * (most-recent) publisher, which can be a chord/sample/drum preview — use this.
 */
declare function getActiveFileId(): string | null;
/** Subscribe to active-editor changes. Returns an unsubscribe fn. */
declare function onActiveEditorChange(cb: () => void): () => void;
/** App-side: register how to re-evaluate a playing file. Returns an unregister fn. */
declare function registerReevalHandler(fn: (fileId: string) => void): () => void;
/** Editor-side: request an immediate re-eval of `fileId` (no-op if unregistered). */
declare function requestReeval(fileId: string | null): void;
/** Editor-side: register a transform applied to a file's source before eval.
 *  Returns an unregister fn. Replaces any prior transform (one owner). */
declare function registerEvalSourceTransform(fn: (fileId: string, raw: string) => string): () => void;
/** App-side: apply the registered eval-source transform (identity if none, and
 *  identity-on-throw so a transform bug can never break playback). */
declare function applyEvalSourceTransform(fileId: string, raw: string): string;
/**
 * Reveal the given line in the editor for `fileId` and set the cursor
 * at column 1. Returns true if the editor was found. Line numbers are
 * 1-based.
 */
declare function revealLineInFile(fileId: string, line: number): boolean;
/**
 * Reveal a source CHARACTER OFFSET in the editor for `fileId`, placing the cursor
 * at its exact line AND column (not column 1). Returns true if the editor was
 * found. Use this when the cursor position must land INSIDE a specific
 * expression — e.g. binding a track that is one arm of a combinator on a shared
 * line (`arrange([w, pat], …)`): column 1 resolves to the whole combinator
 * (standby), while the leaf's own offset descends to the arm (#472). Falls back
 * to line-only reveal if the model can't map the offset.
 */
declare function revealOffsetInFile(fileId: string, offset: number): boolean;
/**
 * Why a write-back did not land. Each value names ONE refusal the writer can
 * actually tell apart, because a report that cannot name its cause cannot drive
 * the next decision (#1414) — "the edit was declined" and "the document moved
 * under you" call for opposite responses from a caller, and a bare `false` says
 * neither.
 */
type WriteRefusal = 
/** No editor is registered for `fileId` — typically unmounted mid-gesture. */
'no-editor'
/** The monaco namespace was never captured, so no edit can be constructed. */
 | 'no-monaco'
/** Nothing to write — upstream (usually a serializer) declined the gesture. */
 | 'no-edits'
/** `expectedDoc` no longer matches the live model: the offsets are stale and
 *  applying them would corrupt unrelated code. RETRYABLE — unlike the rest. */
 | 'stale-document'
/** `Writeback.replaceRanges` threw. */
 | 'writeback-threw';
/** `'applied'`, or the reason the write-back refused. */
type WriteOutcome = 'applied' | WriteRefusal;
/**
 * Apply a batch of surgical offset edits to the model of `fileId`'s editor as
 * ONE undo step, tagged with `source`. This is the arrangement timeline's
 * write-back seam: the canvas hands up the edits (built by `visualEdit/arrange`),
 * the registry routes them through the same surgical `Writeback` the panels use,
 * and the runtime's debounced re-eval picks the change up (no explicit eval call
 * needed). PV122 #2.
 *
 * ⚠ RETURNS A REASON, NOT A BOOLEAN, AND THE REASON IS THE POINT (#1414). This
 * function has always refused correctly; every one of its fourteen call sites
 * discarded the answer, so a refused timeline gesture and an applied one were
 * indistinguishable to the user AND to us. A `boolean` could be read; naming the
 * cause is what makes the refusal actionable — and makes "how often does this
 * fire, and which one" a question with an answer. Callers should compare against
 * `'applied'` explicitly: every member of this union is truthy, so a bare
 * `if (result)` is always true and is always a bug.
 */
declare function applyOffsetEditsToFile(fileId: string, edits: OffsetEdit[], source: WriteSource, expectedDoc?: string): WriteOutcome;
/** CSS variable that scales every chrome-level icon glyph (menu gear,
 *  activity bar, etc.). Applied to documentElement on mount and on
 *  every change. */
declare const UI_ICON_SIZE_VAR = "--ui-icon-size";
/** Separate CSS variable for the floating action buttons (edit / crop)
 *  attached to inline `.viz()` zones. They sit inside the canvas area
 *  and tend to need a tighter scale than the rest of the chrome —
 *  hence their own slider, independent of the main UI icon size. */
declare const INLINE_VIZ_ACTION_SIZE_VAR = "--inline-viz-action-size";
/** Get the current global editor font size (px). */
declare function getEditorFontSize(): number;
/** Get the current global minimap visibility flag. */
declare function getEditorMinimap(): boolean;
/** Set the font size (clamped 8–40) and apply to every open editor. */
declare function setEditorFontSize(size: number): void;
/** Bump font size by delta (positive / negative). */
declare function bumpEditorFontSize(delta: number): void;
/** Toggle minimap visibility across every open editor. */
declare function toggleEditorMinimap(): void;
declare function getEditorUiIconSize(): number;
declare function setEditorUiIconSize(size: number): void;
declare function onUiIconSizeChange(cb: (size: number) => void): () => void;
/** Apply the persisted icon size to the document root on first mount. */
declare function applyPersistedUiIconSize(): void;
declare function getInlineVizActionSize(): number;
declare function setInlineVizActionSize(size: number): void;
declare function onInlineVizActionSizeChange(cb: (size: number) => void): () => void;
declare function applyPersistedInlineVizActionSize(): void;
/** Current inline-viz render resolution (height in px). */
declare function getInlineVizResolution(): number;
/** Set the inline-viz render resolution (clamped 64–2048). Notifies listeners;
 *  takes effect on the next zone (re)mount / evaluate. */
declare function setInlineVizResolution(n: number): void;
declare function onInlineVizResolutionChange(cb: (n: number) => void): () => void;
/** Current viz quality level ("performance mode"). */
declare function getVizQuality(): VizQualityLevel;
/** Set the viz quality level — persists, applies resolution + density to their
 *  channels (the density marshals live to worker viz), and notifies listeners. */
declare function setVizQuality(level: VizQualityLevel): void;
declare function onVizQualityChange(cb: (level: VizQualityLevel) => void): () => void;
/** Restore the persisted quality's DENSITY into the vizConfig singleton on
 *  startup (call once at app init, like `applyPersistedInlineVizActionSize`).
 *
 *  Density ONLY — deliberately NOT resolution. Resolution is pull-model (read
 *  fresh from its own `stave:inlineVizResolution` setting when a zone mounts),
 *  and `setVizQuality` already writes that setting at set-time, so a chosen
 *  level's resolution persists through that channel. Re-applying resolution here
 *  would CLOBBER a user's standalone render-resolution override on every reload
 *  (it would force the default level's 512 whenever quality was never changed).
 *  Density, by contrast, lives in the in-memory vizConfig singleton that resets
 *  to default(1) per page load, so it's the only knob that needs restoring. */
declare function applyPersistedVizQuality(): void;
/** Whether off-screen inline viz are torn down (destroyed to reclaim memory)
 *  after the threshold. Default ON. */
declare function getInlineVizTeardownEnabled(): boolean;
/** Enable/disable off-screen inline-viz teardown. Notifies listeners; takes
 *  effect on the next zone (re)mount / evaluate. */
declare function setInlineVizTeardownEnabled(on: boolean): void;
declare function onInlineVizTeardownChange(cb: (on: boolean) => void): () => void;
/** Whether the left-edge per-track colour bar is painted in the code view.
 *  Default ON. */
declare function getTrackColourBarsEnabled(): boolean;
/** Show/hide the left-edge track colour bar. Notifies listeners so open
 *  editors add/remove the overlay live. */
declare function setTrackColourBarsEnabled(on: boolean): void;
declare function onTrackColourBarsChange(cb: (on: boolean) => void): () => void;
/** Whether non-focused split-pane backdrops freeze unless hovered. Default OFF
 *  (all panes live, #768). */
declare function getPlayVizOnHoverEnabled(): boolean;
/** Enable/disable the hover-gated backdrop freeze. Notifies listeners so the open
 *  WorkspaceShell re-evaluates every pane's `paused` state live. */
declare function setPlayVizOnHoverEnabled(on: boolean): void;
declare function onPlayVizOnHoverChange(cb: (on: boolean) => void): () => void;
type BackdropVizSpan = 'file' | 'workspace';
/** Whether backdrops are per-pane ('file', default) or one shared viz spanning
 *  every split pane ('workspace'). */
declare function getBackdropVizSpan(): BackdropVizSpan;
/** Switch the backdrop span mode. Notifies listeners so the open WorkspaceShell
 *  re-renders (per-pane backdrops ⇄ one spanning backdrop) without a remount. */
declare function setBackdropVizSpan(span: BackdropVizSpan): void;
declare function onBackdropVizSpanChange(cb: (span: BackdropVizSpan) => void): () => void;
/** Effective teardown delay in ms for a newly-mounted inline zone: the threshold
 *  when enabled, 0 (= never tear down) when disabled. Read at mount. An optional
 *  `stave:inlineVizTeardownMs` localStorage override tunes the delay (advanced /
 *  test churn harnesses) — clamped to ≥1000ms; absent → the 60s default. */
declare function getInlineVizTeardownMs(): number;
/** Whether the open Stave Inputs drawer paints live master signal values
 *  (#346). Default ON. */
declare function getVizInputsLiveValuesEnabled(): boolean;
/** Enable/disable live values in the Stave Inputs drawer. Notifies listeners so
 *  a mounted panel can start/stop its paint loop without a reload. */
declare function setVizInputsLiveValuesEnabled(on: boolean): void;
declare function onVizInputsLiveValuesChange(cb: (on: boolean) => void): () => void;
declare function getMusicalTimelineSubRowHeight(): number;
declare function setMusicalTimelineSubRowHeight(h: number): void;
declare function onMusicalTimelineSubRowHeightChange(cb: (h: number) => void): () => void;
/** CSS variable read by the shell's code-panel blur rule (see
 *  globals.css). 0 disables the blur entirely; higher values push
 *  more toward frosted-glass legibility. */
declare const BACKDROP_BLUR_VAR = "--stave-backdrop-blur";
declare function getEditorBackdropBlur(): number;
declare function setEditorBackdropBlur(size: number): void;
declare function applyPersistedBackdropBlur(): void;
declare function getBackdropOpacity(): number;
declare function setBackdropOpacity(o: number): void;
declare function onBackdropOpacityChange(cb: (o: number) => void): () => void;
/** The flat per-engine view the bus consumes and the settings UI edits. */
type SignalAliasMap = Record<string, string | string[]>;
/** The raw engine-keyed custom-alias map (sanitized + migrated). Source of
 *  truth for the renderer's `resolveAliasesForEngine` and any future
 *  multi-engine settings UI. */
declare function getStoredSignalAliases(): StoredSignalAliases;
/** Custom signal aliases for ONE engine (default: the active engine, Strudel),
 *  as the flat `name → value` view the settings UI edits. Built-ins are NOT
 *  included — custom map only. */
declare function getSignalAliases(engine?: VizEngine): SignalAliasMap;
/** Replace the custom aliases for ONE engine (default: active/Strudel) from the
 *  flat `name → value` view, persist, and notify. Surviving names KEEP their
 *  other engines' slots (editing the Strudel column never wipes a Sonic Pi one);
 *  names absent from `map` are removed. The values are sanitized so a bad caller
 *  can't poison storage. */
declare function setSignalAliases(map: SignalAliasMap, engine?: VizEngine): void;
/** Subscribe to alias-map changes (fires on every setSignalAliases). The
 *  callback receives the FLAT view for the engine that was set. Returns an
 *  unsubscribe. */
declare function onSignalAliasesChange(cb: (map: SignalAliasMap) => void): () => void;
type BackdropQuality = 'full' | 'half' | 'quarter';
declare function getBackdropQuality(): BackdropQuality;
declare function setBackdropQuality(q: BackdropQuality): void;
declare function onBackdropQualityChange(cb: (q: BackdropQuality) => void): () => void;
/** Resolution factor applied to the backdrop — render at factor×
 *  viewport size, CSS-stretch to fill. Lower = cheaper GPU. */
declare function backdropQualityFactor(q: BackdropQuality): number;
type EditorTheme = 'dark' | 'light' | 'system';
type ResolvedTheme = 'dark' | 'light';
type ThemeListener = (t: ResolvedTheme) => void;
declare function getEditorTheme(): EditorTheme;
declare function getResolvedTheme(): ResolvedTheme;
declare function setEditorTheme(theme: EditorTheme): void;
/** Cycle dark → light → system → dark. Used by the menu command. */
declare function cycleEditorTheme(): EditorTheme;
/** Subscribe to resolved theme changes. Fires when mode changes or when
 * 'system' preference flips. Returns an unsubscribe. */
declare function onThemeChange(fn: ThemeListener): () => void;
/** Seed DOM + monaco with the persisted theme. Call after mounting. */
declare function applyPersistedTheme(): void;
/** Whether the perf overlay/profiler is enabled (persisted preference, or the
 *  `__STAVE_PERF__` global force-on). */
declare function getPerfEnabled(): boolean;
/** Enable/disable the perf profiler + overlay. Persists, flips the profiler
 *  singleton's live flag, and notifies listeners (the overlay subscribes). */
declare function setPerfEnabled(on: boolean): void;
/** Toggle the perf overlay; returns the new state. */
declare function togglePerfEnabled(): boolean;
/** Subscribe to perf-enabled changes (fires on set/toggle). Returns an
 *  unsubscribe. */
declare function onPerfEnabledChange(cb: (on: boolean) => void): () => void;
/** Apply the persisted perf-enabled preference to the profiler. Call once at
 *  app start so a reload restores an enabled overlay. */
declare function applyPersistedPerfEnabled(): void;
/** Whether adaptive performance (the viz governor) is enabled (persisted; ON by default). */
declare function getAdaptivePerfEnabled(): boolean;
/** Enable/disable adaptive performance. Persists, flips the governor's live gate
 *  (disabling releases the levers immediately — full resolution, no throttle),
 *  and notifies listeners. */
declare function setAdaptivePerfEnabled(on: boolean): void;
/** Toggle adaptive performance; returns the new state. */
declare function toggleAdaptivePerfEnabled(): boolean;
/** Subscribe to adaptive-performance changes (fires on set/toggle). */
declare function onAdaptivePerfChange(cb: (on: boolean) => void): () => void;
/** Apply the persisted adaptive-performance preference to the governor. Call once
 *  at app start (like applyPersistedPerfEnabled) so the governor's live flag agrees
 *  with the stored preference regardless of module-load ordering. */
declare function applyPersistedAdaptivePerf(): void;

/**
 * Reload policy per CONTEXT D-07. Encoded as a string literal rather than
 * a boolean so the three states stay distinguishable at call sites:
 *
 *   - `'debounced'` — the common case for compile-heavy providers.
 *   - `'instant'` — for cheap previews (e.g., markdown HTML rendering).
 *   - `'manual'` — for providers that own their own trigger (e.g., a
 *     user-driven "Run" button inside the rendered output).
 *
 * Adding a new mode requires updating `PreviewView`'s reload dispatch
 * switch. The exhaustiveness check there (a `never`-typed default case)
 * catches missing branches at compile time.
 */
type PreviewReloadPolicy = 'debounced' | 'instant' | 'manual';
/**
 * The runtime context handed to `PreviewProvider.render()` on every
 * reload. Fields are reactive — they represent a snapshot of the preview
 * state at the moment `render` was called. The provider's returned React
 * tree may hold onto `ctx` in a closure, but subsequent renders will
 * receive fresh `ctx` objects; providers that care about "the latest"
 * should read from the newest render's ctx, not cache the original.
 */
interface PreviewContext {
    /**
     * The workspace file being previewed. Reactive via `useWorkspaceFile`
     * inside `PreviewView`. On every reload triggered by content change,
     * this field holds the newest content.
     */
    readonly file: WorkspaceFile;
    /**
     * The current bus payload for the tab's `sourceRef`, or `null` if no
     * publisher matches. Providers MUST handle the `null` case with demo-mode
     * fallback content (CONTEXT P7). `PreviewView` deliberately passes `null`
     * through rather than substituting a placeholder, so the provider can
     * render something meaningful even in the "no audio source" state.
     */
    readonly audioSource: AudioPayload | null;
    /**
     * `true` when the tab is hidden AND the provider opted out of background
     * rendering (`keepRunningWhenHidden === false`). Providers that receive
     * `hidden: true` should stop rendering expensive frames (e.g., pause
     * their RAF loop) but stay mounted — `PreviewView` will trigger one
     * catch-up reload when the tab becomes visible again.
     */
    readonly hidden: boolean;
    /**
     * `true` when the user has explicitly paused this preview via the
     * chrome's Stop button. Unlike `hidden` (which tracks visibility),
     * `paused` is a user-initiated command — the preview tab is still
     * visible, but the provider should halt its animation loop so the
     * canvas freezes on the current frame. Providers handle this by
     * calling `renderer.pause()` (which, for p5, maps to
     * `p5.noLoop()`) when `paused` goes `true` and `renderer.resume()`
     * when it goes `false`. Optional because not every consumer of
     * `PreviewContext` sits behind a pause-able chrome.
     */
    readonly paused?: boolean;
}
/**
 * The provider contract. Every extension module exports one or more
 * `PreviewProvider` values and the Task 06 registry keys them by
 * `extensions`. For Task 03 this interface is the stub — no concrete
 * providers ship yet.
 */
interface PreviewProvider {
    /**
     * File extensions this provider claims, WITHOUT the leading dot
     * (e.g., `['hydra']`, not `['.hydra']`). The registry (Task 06) maps
     * `WorkspaceFile.language` to the provider via this field.
     */
    readonly extensions: readonly string[];
    /**
     * Human-readable label used in diagnostic messages, dropdown tooltips,
     * and the source-selector chrome.
     */
    readonly label: string;
    /**
     * `true` if the provider's render output should keep running while the
     * tab is hidden; `false` if it should pause.
     *
     * Per CONTEXT D-03: pattern runtimes are implicitly always-on (their
     * chrome, not their render, is what users interact with). Viz previews
     * (`HYDRA_VIZ`, `P5_VIZ`) default to `false` — no point burning a GPU
     * frame on an invisible canvas. `PreviewView` uses this flag to decide
     * whether to freeze the reload debounce when its `hidden` prop flips.
     */
    readonly keepRunningWhenHidden: boolean;
    /**
     * Per CONTEXT D-07 — see `PreviewReloadPolicy` doc above.
     */
    readonly reload: PreviewReloadPolicy;
    /**
     * Debounce window in milliseconds. Required when `reload === 'debounced'`.
     * Ignored by the host in the other two modes.
     */
    readonly debounceMs?: number;
    /**
     * Render the provider's output given a snapshot of the preview context.
     * Called ONCE on mount, then AGAIN on every reload event. Every call
     * should return a fresh `ReactNode`; `PreviewView` reconciles the tree
     * via React's normal rendering path. Do not return the same node twice
     * expecting React to treat it as unchanged — snapshot identity lives in
     * the ctx fields, not in the return value.
     */
    render(ctx: PreviewContext): ReactNode;
    /**
     * Optional chrome rendered on the EDITOR tab for files this provider
     * claims. Gives viz files a discoverable action bar (Preview to Side,
     * Background toggle, Save, Hot-reload toggle) matching the transport
     * chrome pattern files get from their runtime provider.
     *
     * If omitted, the editor tab has no chrome for this file type.
     */
    renderEditorChrome?(ctx: PreviewEditorChromeContext): ReactNode;
}
/**
 * Context handed to `PreviewProvider.renderEditorChrome()`. Contains the
 * file being edited and action callbacks the chrome can invoke. The shell
 * wires these callbacks to the command registry and the viz preset bridge.
 */
interface PreviewEditorChromeContext {
    /** The workspace file this editor tab is bound to. */
    readonly file: WorkspaceFile;
    /**
     * Open the preview for this file in a sibling split group.
     *
     * Idempotent: if a preview tab for this file already exists anywhere
     * in the shell, the shell's handler returns early without opening a
     * second one. The chrome can call this safely on every click without
     * having to track preview state itself.
     *
     * The optional `sourceRef` argument pins the new preview tab to a
     * specific audio source when opening. The chrome's source dropdown
     * passes the user's selection through this parameter so the preview
     * subscribes to the chosen publisher (a pattern file, the sample
     * sound, or `'none'` for demo mode) from the moment it mounts —
     * avoiding the default-tracking fallback that would otherwise race
     * the user's pattern-start clicks.
     *
     * The preview tab is closed by its own ✕ button, NOT by a chrome
     * action. Clicking Stop on the chrome (when a preview is open)
     * calls `onTogglePausePreview` below to pause the render loop
     * instead of tearing down the tab.
     */
    readonly onOpenPreview: (sourceRef?: AudioSourceRef) => void;
    /**
     * Whether a preview tab for this file currently exists in any
     * group. Drives the chrome's primary-button label: closed →
     * "▶ Preview", open → "■ Stop" or "▶ Play" depending on
     * `previewPaused`. Maintained by the shell — embedders of
     * `PreviewView` directly (outside the shell) can omit this and
     * the chrome will fall back to always showing "▶ Preview".
     */
    readonly previewOpen?: boolean;
    /**
     * Whether the open preview is currently paused (user clicked
     * Stop). Only meaningful when `previewOpen === true`. When true,
     * the chrome shows "▶ Play" and clicking resumes; when false,
     * the chrome shows "■ Stop" and clicking pauses.
     */
    readonly previewPaused?: boolean;
    /**
     * Toggle the paused state of the open preview. The shell's
     * handler flips its internal `pausedPreviews` set, which
     * propagates through PreviewView → provider ctx → the compiled
     * viz mount, which calls `renderer.pause()` / `renderer.resume()`.
     * Only rendered as a button when `previewOpen === true`.
     */
    readonly onTogglePausePreview?: () => void;
    /**
     * Update the audio source of an already-open preview tab without
     * closing it. When the chrome's source dropdown changes AND a
     * preview is currently open, the chrome calls this with the new
     * ref; the shell finds the preview tab for this file and mutates
     * its `sourceRef` field in place. Task 2's sourceRef-in-React-key
     * trick remounts the sketch on the swap so `setup()` re-runs
     * with fresh injected refs.
     *
     * If the preview isn't open, the chrome falls back to updating
     * its own local selection state and waits for the user to click
     * Preview.
     */
    readonly onChangePreviewSource?: (ref: AudioSourceRef) => void;
    /**
     * Toggle the background decoration (viz behind the editor). Used by the
     * viz-settings popover's preview control to enter / leave 'backdrop' mode.
     * When ENTERING backdrop, the chrome passes the selected audio source so the
     * shell can stop it on teardown (close / preview=off); omitted when clearing.
     */
    readonly onToggleBackground: (sourceRef?: AudioSourceRef) => void;
    /**
     * #788 — the source dropdown changed while THIS file's backdrop is live.
     * The chrome already swaps the audio itself (start next / stop prev, #784);
     * this call lets the shell re-key its audio-teardown record so a later
     * close / clear stops the CURRENT source instead of the stale one. Optional:
     * hosts without backdrop audio bookkeeping omit it.
     */
    readonly onBackdropSourceChange?: (ref: AudioSourceRef) => void;
    /**
     * Close the open side-preview tab for this file (#773). The viz-settings
     * popover calls this when the user picks 'off' or 'backdrop' while a side
     * preview is open. Optional: hosts that don't track preview tabs omit it.
     */
    readonly onClosePreview?: () => void;
    /**
     * #773 — backdrop controls surfaced inside the viz-settings popover when
     * this file is the group backdrop. The values are the ACTIVE group's
     * RESOLVED settings (per-group override, else the global default); the
     * setters route to the group's override. All optional — when a host omits
     * them the popover hides the corresponding control.
     */
    readonly backdropOpacity?: number;
    readonly backdropQuality?: BackdropQuality;
    readonly backdropVizSpan?: BackdropVizSpan;
    readonly onSetBackdropOpacity?: (opacity: number) => void;
    readonly onSetBackdropQuality?: (quality: BackdropQuality) => void;
    readonly onSetBackdropVizSpan?: (span: BackdropVizSpan) => void;
    /** Open the backdrop crop popup for this group's backdrop (#347/#350). */
    readonly onCropBackdrop?: () => void;
    /** Reveal the backdrop's source viz file in the editor. */
    readonly onRevealBackdrop?: () => void;
    /**
     * Whether this chrome's file is the active group's pinned backdrop.
     * The VizEditorChrome uses it to render the Set/Clear BG button as
     * an active (on) or inactive (off) toggle — no round-trip through
     * the shell on every render. Optional for callers that don't track
     * backdrop state (the button still works via onToggleBackground;
     * the label just can't flip).
     */
    readonly isBackground?: boolean;
    /** Save the file back to its persistent store (VizPresetStore). */
    readonly onSave: () => void;
    /**
     * Whether hot-reload is currently enabled.
     *
     * Optional because Phase 10.2 ships a provider-level `reload` policy
     * (per-provider, not per-tab) so most chromes render this as a static
     * "live" indicator rather than a toggle. A per-tab toggle would
     * require threading state through `PreviewView.reload` — scoped to a
     * follow-up phase.
     */
    readonly hotReload?: boolean;
    /** Toggle hot-reload on/off. Optional — see `hotReload` above. */
    readonly onToggleHotReload?: () => void;
}

/**
 * Phase 10.2 — Workspace type vocabulary.
 *
 * This file is the single source of truth for workspace-level types. Each
 * task in Phase 10.2 appends its own type surface here:
 *
 * - Task 01 (this task): WorkspaceFile, WorkspaceLanguage.
 * - Task 02: AudioSourceRef, AudioPayload, WorkspaceAudioBus.
 * - Task 03: EditorViewProps, PreviewViewProps.
 * - Task 04: WorkspaceTab, WorkspaceGroup, WorkspaceLayout.
 * - Task 05: LiveCodingRuntime, LiveCodingRuntimeProvider, ChromeContext.
 * - Task 06: PreviewProvider, PreviewContext.
 *
 * Keep this file type-only. No runtime code, no imports that bring in React
 * or DOM APIs. The types must be consumable from unit tests that run in a
 * plain Node environment. Type-only imports (`import type ...`) are erased
 * at compile time and are safe to add when a downstream task needs to
 * reference engine-layer types from the workspace public surface.
 *
 * @remarks
 * Task 03 adds `EditorViewProps` and `PreviewViewProps`. These DO depend
 * on React types (`ReactNode`) but the imports are type-only and erased at
 * compile time, so the "no React runtime imports" rule is preserved. The
 * concrete `PreviewProvider` interface lives in its own file
 * (`PreviewProvider.ts`) because it contains more than a type — it's a
 * behavioral contract Task 06 will key a registry on.
 */

/**
 * The set of languages a WorkspaceFile may declare. This is an explicit
 * string-literal union rather than an open string so that the exhaustiveness
 * checker inside providers catches unhandled cases. New languages are added
 * here as new provider registries land (e.g., Phase 7+ may add `.tidal`).
 */
type WorkspaceLanguage = 'strudel' | 'sonicpi' | 'hydra' | 'p5js' | 'glsl' | 'markdown';
/**
 * A single editable file owned by the workspace. Instances are **immutable
 * snapshots**: `setContent` replaces the record in the store instead of
 * mutating the object in place. This is load-bearing for
 * `useSyncExternalStore` snapshot identity — consumers compare by reference,
 * so a new object on content change is what triggers their re-render, and
 * an unchanged reference on unrelated content changes is what prevents
 * spurious re-renders.
 *
 * @remarks
 * The `meta` bag is an escape hatch for per-file data that does not belong
 * in the store's public API (e.g., provider-specific viz preset ids in
 * Phase 10.2, cursor position in Phase 10.3). Treat it as opaque — callers
 * should namespace their keys to avoid collisions.
 */
interface WorkspaceFile {
    readonly id: string;
    readonly path: string;
    readonly content: string;
    readonly language: WorkspaceLanguage;
    readonly meta?: Readonly<Record<string, unknown>>;
}
/**
 * Selector that a preview consumer hands to `WorkspaceAudioBus.subscribe`
 * to declare which publisher's payload it wants to receive. Discriminated
 * union per CONTEXT D-02 / D-04 (preview tab source dropdown).
 *
 * - `{ kind: 'default' }` — follow whichever publisher is currently
 *   most-recent. Snaps to a new publisher when one starts; falls through
 *   to the next-most-recent when the current default unpublishes.
 * - `{ kind: 'file', fileId }` — pin to a specific publisher. Fires once
 *   on subscribe with the current payload (or `null` if that publisher is
 *   not currently registered), again when that publisher (un)publishes,
 *   and never for any other publisher's events.
 * - `{ kind: 'none' }` — explicit "no audio input." Subscribers fire once
 *   on subscribe with `null` and then never again. Used by viz tabs in
 *   demo mode (P7 fallback).
 */
type AudioSourceRef = {
    kind: 'default';
} | {
    kind: 'file';
    fileId: string;
} | {
    kind: 'none';
};
/**
 * The component bag that a `LiveCodingRuntime` publishes to the bus when its
 * pattern starts playing, and that every viz consumer subscribes to in order
 * to drive its renderer.
 *
 * The shape mirrors `Partial<EngineComponents>` from `LiveCodingEngine.ts`
 * with the slots flattened (no nested `streaming.hapStream` indirection) so
 * that consumers can destructure `{ hapStream, analyser, scheduler }` in one
 * line. The slots themselves are the SAME references the engine holds —
 * the bus owns no audio nodes (PV3, UV6: observation, not mutation).
 *
 * @remarks
 * ## Identity contract (D-01 — subscribe + re-mount)
 *
 * The bus delivers ONE callback per publisher identity change, not per
 * audio frame. Identity is determined by shallow comparison across
 * `hapStream`, `analyser`, `scheduler`, `inlineViz`, and `audio` — if a
 * runtime calls `publish(sameId, newPayload)` and every slot reference
 * matches the previous payload, subscribers do NOT re-fire. This keeps the
 * bus out of the per-frame FFT read path; consumers reach into
 * `payload.analyser` directly for that.
 *
 * ## Optionality
 *
 * Every slot is optional because not every engine populates every slot
 * (e.g., the demo engine has streaming + audio but no scheduler). Consumers
 * MUST guard each slot before use.
 */
interface AudioPayload {
    readonly hapStream?: StreamingComponent['hapStream'];
    readonly analyser?: AudioComponent['analyser'];
    readonly scheduler?: QueryableComponent['scheduler'];
    readonly inlineViz?: InlineVizComponent;
    readonly audio?: AudioComponent;
    /**
     * Full engine components in their original nested shape. Needed by
     * `addInlineViewZones` which reads `queryable.trackSchedulers`,
     * `audio.trackAnalysers`, `inlineViz.trackStreams`, etc. The flat
     * fields above are convenience accessors for simple consumers
     * (PreviewView source selector, popout bridge). Inline zones and
     * viz renderers must read from this field to get per-track data.
     */
    readonly engineComponents?: Partial<EngineComponents>;
    /**
     * Phase 20-07 — per-engine breakpoint registry. The Monaco gutter UI in
     * EditorView reads this to subscribe + render glyphs; the gutter click
     * handler calls `toggleSet` to register breakpoints. Absent for engines
     * that don't support the breakpoint protocol.
     */
    readonly breakpointStore?: BreakpointStore;
    /**
     * Phase 20-07 — invoked when the user clicks "Debugger: Resume" via the
     * Monaco command palette. Calls `runtime.resume()`. Absent for engines
     * without scheduler-pause support.
     */
    readonly onResume?: () => void;
}
/**
 * Description of a single registered publisher, returned from
 * `WorkspaceAudioBus.listSources()`. Always read on demand (e.g., on dropdown
 * open) — never cached in React state, since it can desync between renders
 * when publishers start/stop rapidly. The bus emits `onSourcesChanged` to
 * trigger re-renders, but the source data must be fetched fresh each time.
 *
 * - `sourceId` — the file id the publisher registered under.
 * - `label` — display label (currently equals `sourceId`; future Task 05 may
 *   pass through `WorkspaceFile.path` for prettier dropdown text).
 * - `playing` — `true` while the publisher has an active payload on the bus.
 *   Phase 10.2 only ever lists currently-publishing entries, so this is
 *   always `true`. Reserved for Phase 10.3+ when "stopped but recently
 *   active" entries may also be surfaced.
 */
interface AudioSourceListing {
    readonly sourceId: string;
    readonly label: string;
    readonly playing: boolean;
}
/**
 * The public surface of the workspace audio bus. The bus is implemented as a
 * module-level singleton in `WorkspaceAudioBus.ts` (per CONTEXT U1, matching
 * the `VizPresetStore` precedent); this interface exists for type-driven
 * consumers and for the eventual Phase 11 multi-shell refactor that may
 * introduce a class-per-shell variant.
 */
interface WorkspaceAudioBus {
    /**
     * Register or replace the payload for a given source id.
     *
     * Calling `publish(id, payload)` for a brand-new id appends `id` to the
     * end of the recency list (making it the new "most recent" publisher) and
     * fires every default-tracker plus every pinned subscriber on `id`.
     *
     * Calling `publish(id, payload)` for an existing id and a payload whose
     * shallow component slots match the previous payload is a **no-op** —
     * subscribers do NOT re-fire and the recency list is unchanged. This is
     * the D-01 identity guarantee that keeps the bus out of the FFT read
     * path. Calling with an existing id and DIFFERENT slot references
     * replaces the entry, leaves the recency position alone, and fires the
     * affected subscribers.
     */
    publish(sourceId: string, payload: AudioPayload): void;
    /**
     * Remove the payload for a given source id. Pinned subscribers on `id`
     * fire once with `null`; default-trackers fire once with whatever
     * publisher is now most-recent (or `null` if no publishers remain).
     * Calling on an unknown id is a no-op.
     */
    unpublish(sourceId: string): void;
    /**
     * Subscribe to the bus with a consumer-side selector. Returns an
     * unsubscribe function.
     *
     * **Synchronous initial fire** (krama lifecycle step 2): the callback is
     * invoked SYNC, before `subscribe` returns, with the current payload for
     * `ref` (or `null` if no publisher matches). This handles the popout
     * window race where the consumer mounts before the publisher.
     *
     * The unsubscribe function is idempotent — calling it multiple times has
     * the same effect as calling it once.
     */
    subscribe(ref: AudioSourceRef, cb: (payload: AudioPayload | null) => void): () => void;
    /**
     * Synchronously read the current payload for a ref without subscribing.
     * Returns `null` for `{ kind: 'none' }` or when no publisher matches.
     * Used by consumers that want to peek at the current state without
     * setting up a subscription (e.g., for one-shot rendering).
     */
    consume(ref: AudioSourceRef): AudioPayload | null;
    /**
     * List every currently-registered publisher. Always returns a fresh array.
     *
     * **MUST be read on demand** — never cached in React state. The bus emits
     * `onSourcesChanged` whenever the publisher set changes; that event is
     * the signal to re-read `listSources()`, not a snapshot to memoize. See
     * the pre-mortem in PLAN.md §10.2-02.
     */
    listSources(): AudioSourceListing[];
    /**
     * Register a callback that fires whenever the set of currently-registered
     * publishers changes (i.e., a `publish` for a new id, or an `unpublish`).
     * Re-publishing an existing id with the same shallow payload does NOT
     * trigger this. Returns an unsubscribe function.
     */
    onSourcesChanged(cb: () => void): () => void;
}
/**
 * A theme value accepted by every new workspace top-level component. Every
 * view owns its own theme application per CONTEXT PV6 — the shell does not
 * bubble the theme down through inline style inheritance because each
 * group in the shell's split layout is its own DOM root and CSS custom
 * properties do not cross React portal boundaries.
 *
 * Defaults to `'dark'` when the prop is omitted.
 */
type WorkspaceTheme = 'dark' | 'light' | StrudelTheme;
/**
 * Props accepted by `EditorView` — the Monaco-based editor for a single
 * workspace file. Task 03 ships the editor with a theme, a chrome slot for
 * Task 05 to inject runtime transport UI into, and an optional mount
 * callback so downstream tests and host components can capture the Monaco
 * editor instance.
 *
 * @remarks
 * ## What this does NOT include (yet)
 *
 * - `sourceRef` — Task 07 wires a bus subscription inside `EditorView` to
 *   drive `.viz()` inline view zones and highlighting; that subscription
 *   reads its own file's publisher via `{ kind: 'file', fileId }` (D-08)
 *   and does not need a prop, so no `sourceRef` is exposed here.
 * - Control over Monaco options (font size, minimap, etc.) — Task 03 hard
 *   codes the same option set the legacy `EditorGroup.tsx` used. Future
 *   phases can open this up if embedders need it.
 * - Task 07 added: bus subscription for inline zones + highlighting,
 *   `error` prop for diagnostics squiggles (S7).
 */
interface EditorViewProps {
    /**
     * The workspace file id this editor binds to. The hook
     * `useWorkspaceFile(fileId)` drives the Monaco `value` prop. If the file
     * is not yet registered (`undefined`), `EditorView` renders a loading
     * placeholder — the file may be seeded after the editor mounts.
     */
    readonly fileId: string;
    /**
     * Theme applied to the editor container via `applyTheme()` on mount
     * and on every theme change. Defaults to `'dark'`. PV6 — every view
     * owns its own theme application.
     */
    readonly theme?: WorkspaceTheme;
    /**
     * Chrome injected ABOVE the Monaco editor, inside the same DOM root.
     * Task 05 fills this slot with per-language runtime chrome (e.g.,
     * transport bar for pattern files). Task 03 accepts whatever the host
     * passes and renders it verbatim — no wrapping, no styling beyond the
     * flex container boundary.
     */
    readonly chromeSlot?: ReactNode;
    /**
     * Called after Monaco has mounted, with the editor instance and the
     * Monaco module reference. Downstream tasks (Task 07 — inline view
     * zones, highlighting) use this to attach behavior to the editor. The
     * `editor` and `monaco` types are intentionally `unknown` at this
     * layer — typed consumers cast at the call site.
     */
    readonly onMount?: (editor: unknown, monaco: unknown) => void;
    /**
     * Current runtime evaluation error, or `null` when no error is active.
     * The parent (compat shim or shell integration) manages the runtime's
     * `onError` subscription and passes the latest error through this prop.
     * When non-null, `EditorView` calls `setEvalError(monaco, model, error)`
     * to show a squiggle marker. When cleared to `null`, it calls
     * `clearEvalErrors(monaco, model)`. S7 — diagnostics driven by prop,
     * not by direct engine subscription inside EditorView.
     */
    readonly error?: Error | null;
    /**
     * Called when the user presses Ctrl+Enter (Cmd+Enter on Mac) inside the
     * Monaco editor. The parent (compat shim or shell integration) wires this
     * to `runtime.play()`. If omitted, the keybinding is not registered.
     */
    readonly onPlay?: () => void;
    /**
     * Called when the user presses Ctrl+. (Cmd+. on Mac) inside the Monaco
     * editor. The parent wires this to `runtime.stop()`. If omitted, the
     * keybinding is not registered.
     */
    readonly onStop?: () => void;
    /** Called when the user clicks the "edit" icon on an inline viz zone.
     *  Receives the viz name (e.g., "Piano Roll"). The host should navigate
     *  to the corresponding viz file. */
    readonly onEditViz?: (vizId: string) => void;
    /** Called when the user clicks the "crop" icon on an inline viz zone.
     *  Receives the viz name, preset id, and `trackKey` — the per-$:-block
     *  identifier (same key used for trackSchedulers / trackAnalysers /
     *  vizRequests). Required so the host can save the crop as a per-instance
     *  override rather than overwriting the shared VizPreset. */
    readonly onCropViz?: (vizId: string, presetId: string | null, trackKey: string) => void;
}
/**
 * Props accepted by `PreviewView` — the host for a `PreviewProvider`'s
 * rendered output. Task 03 ships the view as a controlled component: the
 * shell (Task 04) owns the `sourceRef` state and passes it down plus an
 * `onSourceRefChange` callback so the built-in source selector chrome can
 * drive tab-level state updates.
 *
 * @remarks
 * ## What this does NOT include (yet)
 *
 * - A provider registry lookup — Task 06 adds that. Task 03 accepts the
 *   `provider` directly as a prop so the view can be tested in isolation.
 * - A `theme` broadcaster that writes to the popout window — the popout
 *   integration lives inside `usePopoutPreview` (Task 07's scope).
 * - Error reporting for provider render failures — Task 06 adds an error
 *   boundary around `provider.render` when the concrete providers land.
 *   Task 03 trusts the provider to not throw.
 */
interface PreviewViewProps {
    /**
     * The workspace file id being previewed. The view subscribes to the
     * file via `useWorkspaceFile(fileId)` so provider reloads see fresh
     * content on every content change.
     */
    readonly fileId: string;
    /**
     * The provider that knows how to render this file type. Task 06 will
     * move provider selection inside a registry lookup keyed on
     * `file.language`; Task 03 accepts the provider directly for isolated
     * testing. Changing the provider prop mid-life of the view triggers a
     * fresh render; the view does not dispose the old provider (providers
     * are stateless value objects).
     */
    readonly provider: PreviewProvider;
    /**
     * Which publisher the view subscribes to on the bus. Owned by the
     * shell (Task 04); this view is controlled. `'default'` follows
     * most-recent, `{ kind: 'file' }` pins, `'none'` forces demo mode.
     */
    readonly sourceRef: AudioSourceRef;
    /**
     * Called when the user picks a different source from the built-in
     * selector chrome. The view does NOT hold its own `sourceRef` state —
     * it dispatches to this callback and waits for the controlled prop to
     * update. The shell (Task 04) wires this callback to its tab state.
     */
    readonly onSourceRefChange: (ref: AudioSourceRef) => void;
    /**
     * Theme applied to the view container via `applyTheme()` on mount and
     * on every theme change. Defaults to `'dark'`. PV6 — every view owns
     * its own theme application.
     */
    readonly theme?: WorkspaceTheme;
    /**
     * `true` when the tab is currently hidden (another tab is active in
     * this group, or the preview is background-layered under an editor).
     * The view checks `provider.keepRunningWhenHidden` to decide whether
     * to pause — if `false`, the view freezes its reload debounce AND
     * passes `hidden: true` to the provider's render context. On un-hide,
     * the view triggers one catch-up reload to pick up any content changes
     * that arrived while hidden.
     */
    readonly hidden?: boolean;
    /**
     * User-initiated pause state. When `true`, the view threads
     * `paused: true` into the provider render context so compiled
     * viz mounts can call `renderer.pause()` (p5.noLoop / hydra
     * stop) and freeze the canvas. Unlike `hidden`, this is an
     * explicit user action via the chrome's Stop button — the tab
     * stays visible but the animation loop halts. Click Play to
     * resume.
     */
    readonly paused?: boolean;
}
/**
 * A single tab inside the workspace shell. Tabs are the user-visible units
 * the shell renders; the shell dispatches rendering by `kind`:
 *
 *   - `kind: 'editor'` → `EditorView` bound to `fileId`.
 *   - `kind: 'preview'` → `PreviewView` bound to `fileId` with the tab's
 *     `sourceRef` pinned as a tab-level field (so the source dropdown
 *     inside `PreviewView` drives state up to the shell, which persists
 *     it per tab — two viz preview tabs of the same file can be pinned to
 *     different publishers).
 *
 * Each tab carries its own `id` separate from `fileId` because multiple
 * tabs can reference the same file (e.g., an editor tab AND a preview tab
 * for the same `pianoroll.hydra`, or two preview tabs pinned to different
 * sources). The shell uses `id` as the reconciliation key and drag-drop
 * identifier; `fileId` routes to the underlying file store.
 *
 * ## PV7 — no rendering-mode field on the tab
 *
 * The legacy `EditorGroup.tsx` carried a single state field that enumerated
 * four rendering modes (panel / inline / background / popout) and
 * entangled editor and preview concerns. The whole point of Phase 10.2 is
 * to dissolve that entanglement — a preview tab is a first-class tab,
 * dispatched by `kind`, not a rendering mode on top of an editor. Any
 * future "background decoration" support is shaped as a file id on
 * `WorkspaceGroupState.backgroundFileId` (promote-to-backdrop flow),
 * NOT as a mode on the tab itself.
 */
type WorkspaceTab = {
    readonly kind: 'editor';
    readonly id: string;
    readonly fileId: string;
    /**
     * Preview tabs render in italic and are replaced when another file
     * is opened in preview mode. Promoted to pinned (preview=false) on
     * double-click or on first edit. Matches VSCode's preview-tab UX.
     */
    readonly preview?: boolean;
} | {
    readonly kind: 'preview';
    readonly id: string;
    readonly fileId: string;
    readonly sourceRef: AudioSourceRef;
} | {
    /**
     * A read-only history viewer hosted in the main editor area — the
     * project commit store's Diff / time-travel View, moved out of the
     * cramped Version History side panel (#210). Carries everything the
     * HistoryDiffOverlay / HistoryViewOverlay components need to render.
     *
     * Reuses the preview-tab mechanism: opened as a single italic
     * `preview` slot that the next Diff/View replaces, promoted to a
     * pinned tab on double-click (same UX as opening a file in preview).
     * Never persisted — `tabPersistence` keeps only `editor` tabs, and a
     * commit can be pruned between sessions, so a stale history tab would
     * be a ghost.
     */
    readonly kind: 'history';
    readonly id: string;
    /** The file the viewer is focused on (drives the tab label + initial selection). */
    readonly fileId: string;
    readonly mode: 'diff' | 'view';
    /** The commit being diffed / viewed. */
    readonly commitId: string;
    /**
     * Diff mode only (#211): open the diff in "vs current" (commit ↔ live
     * working tree) by default, for the "Uncommitted Changes" section's
     * live ↔ HEAD diff. With `commitId` = HEAD, the original side is the
     * file's HEAD content and the modified side is its live content.
     */
    readonly vsCurrent?: boolean;
    /**
     * Diff mode only (#211): scope the file picker to these ids instead of
     * the commit's own changeset — so an uncommitted file that HEAD didn't
     * touch is still selectable (the dirty-set snapshot at open time).
     */
    readonly pickerFileIds?: readonly string[];
    /** Preview slot (italic, replaced by the next open). Promoted on double-click. */
    readonly preview?: boolean;
};
/**
 * A single tab group inside the shell. Groups are the unit the `SplitPane`
 * layout operates on — N groups render as N panes, each with its own tab
 * bar and active-tab content area.
 *
 * - `id` — stable group identifier; used as drag-drop target id and as the
 *   React reconciliation key.
 * - `tabs` — the ordered list of tabs hosted by this group. Order is
 *   preserved across drag-drop moves and splits. Empty groups are legal
 *   (the last tab was closed but the group remains) and render an empty
 *   state prompting the user to drop a tab.
 * - `activeTabId` — which tab is visible inside this group. `null` when
 *   the group is empty. Closing the active tab selects the next adjacent
 *   tab (previous if one exists, else first).
 * - `backgroundFileId` — id of the viz file pinned as this group's
 *   backdrop (promote-to-backdrop / `Cmd+K B`). Independent of
 *   `activeTabId` — the backdrop survives tab switches; the active
 *   editor renders on top. Absent when no backdrop is set. Field is
 *   the FILE id (not a tab id) so a single source of truth survives
 *   tab churn — tabs come and go, but the promoted file reference is
 *   durable.
 */
interface WorkspaceGroupState {
    readonly id: string;
    readonly tabs: readonly WorkspaceTab[];
    readonly activeTabId: string | null;
    readonly backgroundFileId?: string;
    /**
     * Per-pane backdrop opacity override (#350c). When set, this group's
     * backdrop renders at this opacity instead of the global
     * `getBackdropOpacity()` default. Absent → the global default applies.
     * Persisted user intent (survives reload), unlike the transient code
     * override — so it lives on the group snapshot.
     */
    readonly backdropOpacity?: number;
    /**
     * Per-pane backdrop quality override (#350c). When set, this group's
     * backdrop renders at this quality tier instead of the global
     * `getBackdropQuality()` default. Absent → the global default applies.
     */
    readonly backdropQuality?: BackdropQuality;
}
/**
 * Per-file runtime that wraps a `LiveCodingEngine`. Created by a
 * `LiveCodingRuntimeProvider.createEngine`-derived factory inside Task 09's
 * compat shims (and Task 10's app rewire). Owns the engine lifecycle for a
 * single workspace file id, publishes its component bag to the workspace
 * audio bus when playing, and unpublishes on stop / dispose.
 *
 * @remarks
 * ## What the runtime is, and is not
 *
 * - **Is** a strict passthrough wrapper around an engine plus the bus
 *   publish/unpublish wiring required to surface the engine's component
 *   bag to viz consumers and the EditorView (for inline view zones / S7).
 * - **Is** the elevation point for `BufferedScheduler` (S8) — when an
 *   engine ships streaming + audio without a native queryable, the
 *   runtime constructs a `BufferedScheduler` lazily on first `play()` and
 *   places it on the published payload's `scheduler` slot.
 * - **Is NOT** a place to install Pattern.prototype interception (PV2 / P2).
 *   All Strudel Pattern method wrappers are installed inside
 *   `StrudelEngine.evaluate()`'s setter trap and live nowhere else. The
 *   runtime never reads, writes, or proxies anything on `Pattern.prototype`.
 * - **Is NOT** a place to mutate `file.content` before evaluation (P1).
 *   The runtime passes the file content unchanged into `engine.evaluate`.
 *
 * ## Lifecycle (PK1 — STRICT)
 *
 * `play()` runs nine ordered steps with no React state writes interleaved
 * between `engine.evaluate()` resolving and `bus.publish()` firing:
 *
 *   1. `await engine.init()` if not already initialized.
 *   2. `await engine.evaluate(getFileContent())`.
 *   3. If `error` — fire `onError`, do not publish, do not call play.
 *   4. SYNCHRONOUSLY read `engine.components` (no awaits between here and
 *      step 7).
 *   5. Determine the queryable scheduler. Native if `components.queryable`,
 *      otherwise elevate via `BufferedScheduler` (S8).
 *   6. Build the `AudioPayload` with `hapStream`, `analyser`, `scheduler`,
 *      `inlineViz`, and the full `audio` slot.
 *   7. `workspaceAudioBus.publish(fileId, payload)` — subscribers fire SYNC.
 *   8. `engine.play()` — schedules audio.
 *   9. Fire `onPlayingChanged(true)`.
 *
 * The `publish` BEFORE `play` ordering matters: viz consumers and the
 * EditorView's inline-zone subscription must see the payload before the
 * first hap event fires. The `publish` AFTER `evaluate` ordering matters
 * even more: only after `evaluate` resolves does `engine.components`
 * contain the captured `inlineViz.vizRequests` for the current code.
 */
interface LiveCodingRuntime$1 {
    /** The wrapped engine. Owned by the runtime; never escapes. */
    readonly engine: LiveCodingEngine;
    /** Workspace file id this runtime publishes under on the audio bus. */
    readonly fileId: string;
    /**
     * Initialize the engine if it has not been initialized yet. Idempotent.
     * `play()` calls this internally; callers usually do not need to.
     */
    init(): Promise<void>;
    /**
     * Evaluate the current file content, publish the engine's component bag
     * to the bus under `fileId`, then start the engine. Returns the
     * evaluation error if any (also fires `onError` listeners). On error, the
     * payload is NOT published and `engine.play()` is NOT called.
     *
     * @returns `{ error: null }` on success; `{ error: Error }` if
     *   `engine.evaluate` returned an error or the runtime caught one
     *   bridging to the bus.
     */
    play(): Promise<{
        error: Error | null;
    }>;
    /**
     * Stop the engine and unpublish from the bus. Idempotent — calling
     * `stop()` twice is safe.
     */
    stop(): void;
    /**
     * Dispose the runtime — calls `stop()`, releases the
     * `BufferedScheduler` if one was elevated, and disposes the underlying
     * engine. After `dispose()`, the runtime is unusable.
     */
    dispose(): void;
    /**
     * Subscribe to runtime errors — fired by `play()` on evaluate failure
     * AND by the engine's runtime error handler (audio scheduling errors
     * after `play()` succeeded). Returns an idempotent unsubscribe function.
     * S7 — the EditorView subscribes to this for `setEvalError` markers,
     * the chrome subscribes for the error badge.
     */
    onError(cb: (err: Error) => void): () => void;
    /**
     * Subscribe to playing-state changes. Fires SYNC after `play()` succeeds
     * with `true`, after `stop()` with `false`. Returns an idempotent
     * unsubscribe function. The chrome subscribes to drive its
     * `isPlaying`-dependent rendering without prop-drilling.
     */
    onPlayingChanged(cb: (playing: boolean) => void): () => void;
    /**
     * Read the engine's current BPM, if extractable. The runtime parses
     * `setcps(...)` from the last evaluated code and converts to BPM
     * (Strudel) or returns `undefined` for engines that have no analogous
     * concept. Used by the chrome's BPM display (U8). Returns `undefined`
     * before the first successful `play()`.
     */
    getBpm(): number | undefined;
    /**
     * Current cycle position from the engine's pattern scheduler, or `null`
     * when the scheduler is unavailable (engine not initialized, transport
     * stopped, non-Strudel runtime). Used by the IR Inspector timeline
     * strip's tooltip to anchor each captured snapshot to musical time.
     * The tooltip falls back to wall-clock when this returns `null`.
     *
     * Phase 19-08 (#85). Mirrors `getBpm()` shape.
     */
    getCurrentCycle(): number | null;
    /**
     * Enable or disable live mode (auto-refresh). When enabled and the
     * runtime is playing, every file content change triggers a
     * debounced re-`play()` (which re-evaluates the current code) so
     * the audio stays in sync with the source as you type.
     *
     * No-op if the runtime was constructed without a `subscribeToFile`
     * function (the default in tests) — the flag is still set, but no
     * subscription is installed.
     */
    setAutoRefresh(enabled: boolean): void;
    /** Current live-mode flag. */
    isAutoRefreshEnabled(): boolean;
    /**
     * Subscribe to live-mode state changes. Fires after every
     * `setAutoRefresh` mutation with the new enabled value. Returns an
     * idempotent unsubscribe. Used by the chrome's live-mode toggle to
     * re-render without polling.
     */
    onAutoRefreshChanged(cb: (enabled: boolean) => void): () => void;
}
/**
 * Context object handed to `LiveCodingRuntimeProvider.renderChrome` on every
 * chrome render. The chrome is a React component (the provider's
 * `renderChrome` is itself a React functional component), so it can use
 * hooks to subscribe to `runtime.onError` / `runtime.onPlayingChanged` and
 * track its own `isPlaying` / `error` state — but for callers that already
 * have those values in scope (e.g., the compat shims that wire chrome from
 * outside the provider), passing them through the context avoids a second
 * subscription.
 *
 * Per CONTEXT D-07 + U8.
 */
interface ChromeContext {
    /** The living runtime instance. The chrome calls `runtime.play()` etc. */
    readonly runtime: LiveCodingRuntime$1;
    /** The workspace file the runtime serves. */
    readonly file: WorkspaceFile;
    /** Current playing state — sourced by the embedder. */
    readonly isPlaying: boolean;
    /** Current evaluation / runtime error, if any. */
    readonly error: Error | null;
    /**
     * Beats-per-minute display value. Built-in per U8 — the runtime extracts
     * BPM from the engine where available; the chrome only renders. May be
     * `undefined` if BPM is not yet known or is not applicable.
     */
    readonly bpm?: number;
    /** Play handler — usually `() => runtime.play()`. */
    onPlay(): void;
    /** Stop handler — usually `() => runtime.stop()`. */
    onStop(): void;
    /**
     * Optional embedder-injected extras (e.g., the export button surfaced by
     * the legacy `StrudelEditor` shim in Task 09). Rendered to the right of
     * the built-in transport controls. Per U8.
     */
    readonly chromeExtras?: ReactNode;
    /**
     * Current live-mode (autoRefresh) state for this runtime. When `true`,
     * the chrome renders the live toggle button in its active style. When
     * omitted, the chrome renders the toggle in its inactive style.
     *
     * Sourced by the embedder — the app layer typically mirrors
     * `runtime.isAutoRefreshEnabled()` into React state so changes re-render
     * the chrome. Provider chromes that subscribe to
     * `runtime.onAutoRefreshChanged` directly may ignore this field.
     */
    readonly autoRefresh?: boolean;
    /**
     * Toggle handler for live mode. When supplied, the chrome renders a
     * live-mode toggle button; when omitted, the button is hidden. This
     * lets embedders that don't want a live-mode button (tests, kiosk
     * displays) opt out cleanly.
     */
    readonly onToggleAutoRefresh?: () => void;
    /**
     * End-behaviour state for a document that CAN end on its own (#1388,
     * inverted by #1396). `true` means the user has asked an arranged song to
     * stop at its last cycle instead of repeating.
     *
     * ⚠ DEFAULT IS `false` — LOOPING. #1388 had this the other way round and
     * #1396 flipped it: every reference DAW runs past the end of the arrangement
     * (REAPER stops, but as a preference), and a document that acquires an
     * `arrange(...)` should not silently gain the ability to stop under someone
     * mid-edit. Stopping is the specialised choice, so it is the one you ask for.
     *
     * Only meaningful alongside `onToggleStopAtEnd` — see below.
     */
    readonly stopAtEnd?: boolean;
    /**
     * Toggle handler for the end behaviour. Supplied by the embedder ONLY for
     * documents that have a definite end; when omitted the button is hidden,
     * exactly like the live-mode toggle above.
     *
     * ⚠ THE OMISSION IS THE FEATURE, not an oversight. 96.7% of real documents
     * have no arrangement and loop forever no matter what, so the toggle on them
     * would be a control that visibly does nothing — and a control that does
     * nothing teaches the user that the ones that DO work might not. The button
     * appears exactly when it changes what happens. That reasoning is unchanged
     * by #1396: what a document with no end lacks is an END, which is what both
     * settings are about, so neither of them means anything there.
     */
    readonly onToggleStopAtEnd?: () => void;
}
/**
 * Per-extension provider for executable file types. Owns engine creation
 * AND chrome rendering. Registered in the `liveCodingRuntimeRegistry` keyed
 * by extension. The shell never invokes a provider directly — Task 09's
 * compat shims and Task 10's app rewire instantiate runtimes from the
 * provider's `createEngine` and pass `renderChrome(ctx)` into
 * `WorkspaceShell.chromeForTab`.
 */
interface LiveCodingRuntimeProvider {
    /** Extensions this provider claims, including the leading dot. */
    readonly extensions: readonly string[];
    /** Workspace language id this provider corresponds to. */
    readonly language: WorkspaceLanguage;
    /** Factory for a fresh engine instance. The runtime owns disposal. */
    createEngine(): LiveCodingEngine;
    /**
     * Render the per-tab chrome for an editor of this language. Receives
     * the live runtime + state. Returns a `ReactNode` that the host
     * (Task 09 / Task 10) injects into `EditorView.chromeSlot`.
     */
    renderChrome(ctx: ChromeContext): ReactNode;
}
/**
 * Forward-compatible alias retained from Task 04. Resolves to the real
 * `LiveCodingRuntimeProvider` interface so any consumer that imported the
 * stub from the barrel keeps compiling without source changes.
 */
type LiveCodingRuntimeProviderStub = LiveCodingRuntimeProvider;
/**
 * Signature of the optional callback the shell uses to resolve per-tab
 * runtime chrome for editor-kind tabs. Task 05 will wire this through the
 * runtime provider registry so pattern-file editors receive a transport
 * bar. Task 04 accepts the callback as a prop and passes its return value
 * into `EditorView.chromeSlot`. Returning `undefined` (the default) means
 * "no chrome for this tab," which is the correct answer for viz / markdown
 * editors.
 */
type ChromeForTab = (tab: WorkspaceTab) => ReactNode | undefined;
/**
 * Props accepted by `WorkspaceShell`. The shell is uncontrolled — it
 * seeds group state from `initialTabs` on first mount and manages its own
 * layout state internally. Tab changes are broadcast via callbacks so
 * downstream host code (Task 08's command registry, Task 10's app page)
 * can observe without owning the state.
 *
 * @remarks
 * ## What the shell does NOT do (yet)
 *
 * - No `window.addEventListener('keydown', ...)` for Cmd+K V/B/W — Task
 *   08 adds that, using `onActiveTabChange` to know which tab the command
 *   should act on.
 * - No runtime provider instantiation — `runtimeProviders` is a typed
 *   slot for Task 05 / Task 07 to inject concrete providers. The shell
 *   never calls `createEngine`; it only passes the list to `chromeForTab`.
 * - No preview provider registry lookup — `previewProviders` is a slot
 *   for Task 06 to populate. Task 04 uses a single `previewProviderFor`
 *   callback to resolve the provider at render time so the shell is
 *   testable in isolation with a stub.
 * - No `Cmd+K B` background decoration rendering. The field is reserved
 *   on `WorkspaceGroupState.backgroundFileId` but Task 04 does not render
 *   anything based on it.
 */
interface WorkspaceShellProps {
    /**
     * Seed tabs for the shell on first mount. Splits into one initial group
     * holding every seed tab; the first tab becomes the active tab. The
     * shell does not re-read this prop after mount — changes to `initialTabs`
     * on re-render are ignored. Callers that need to add tabs later use
     * commands (Task 08) or the shell's imperative handle (future).
     */
    readonly initialTabs?: readonly WorkspaceTab[];
    /**
     * Theme applied to the shell root via `applyTheme()` on mount and on
     * every theme change. Defaults to `'dark'`. PV6 / P6 — every top-level
     * component owns its own theme application.
     */
    readonly theme?: WorkspaceTheme;
    /**
     * Explicit height for the shell root. Defaults to `'100%'` so the
     * shell fills whatever container the host mounts it in.
     */
    readonly height?: number | string;
    /**
     * Fires whenever the active tab changes — either because the user
     * clicked a different tab inside a group, or because the user
     * switched focus between groups. Task 08 listens so Cmd+K V/B/W can
     * dispatch against the currently-active tab.
     *
     * The callback fires with `null` when no tab is active (every group
     * is empty). Fires once on mount with the initial active tab (or
     * `null`) so late subscribers see the initial state.
     */
    /**
     * Persistence-friendly initial state. When provided, takes precedence
     * over `initialTabs` and seeds the shell's groups + 2-D pane layout +
     * active group id in one shot. Like `initialTabs` it is read exactly
     * once on mount.
     *
     * Issue #175 — lets the consumer hydrate from `tabPersistence` so the
     * user's pane splits + per-group tabs survive a refresh. If absent,
     * the shell falls back to the legacy single-group seed from
     * `initialTabs`.
     */
    readonly initialGroups?: ReadonlyMap<string, WorkspaceGroupState>;
    readonly initialLayout?: GroupLayout;
    readonly initialActiveGroupId?: string;
    /**
     * Fires reactively whenever the shell's groups / layout / activeGroupId
     * change — i.e. on tab open / close / reorder, group split / collapse,
     * active-tab change, active-group change, and `backgroundFileId`
     * transitions. The callback receives the full state snapshot in the
     * shape `tabPersistence.serializeShellState` expects, so the consumer
     * can pipe it straight through to localStorage / Yjs.
     *
     * Issue #175 — single sink for persistence. Does NOT fire on initial
     * mount (no-op write of just-hydrated state); only on subsequent
     * mutations.
     */
    readonly onGroupsChange?: (snapshot: {
        groups: ReadonlyMap<string, WorkspaceGroupState>;
        layout: GroupLayout;
        activeGroupId: string;
    }) => void;
    readonly onActiveTabChange?: (tab: WorkspaceTab | null) => void;
    /**
     * Fires when the user clicks the "+" action in a group's tab bar
     * (issue #612). The host opens its own new-file flow — the shell has
     * no knowledge of file creation, it only surfaces the affordance. When
     * omitted, the "+" button is not rendered.
     */
    readonly onNewFile?: () => void;
    /**
     * Fires when any group's `backgroundFileId` changes — either set
     * (pinned a file) or cleared (null). `groupId` identifies the
     * affected group. Used by the app to mirror backdrop state into
     * local React state (for the file-tree "Set ↔ Clear" label) and
     * to persist per-project. Fires once per real change; no initial-
     * state fire since an unset backdrop is the default.
     */
    readonly onBackgroundFileChange?: (groupId: string, fileId: string | null) => void;
    /**
     * Fires when the ACTIVE group's RESOLVED backdrop changes (#350a) — the code
     * override (`setBackgroundOverride`) if present, else the manual sticky. This
     * is "what is currently showing behind the active editor," for UI that must
     * reflect reality (the menubar bg indicator, the popover pinned-state). Unlike
     * `onBackgroundFileChange`, it is NOT a persistence signal — code overrides are
     * transient — so consumers must mirror it into UI state WITHOUT persisting.
     * Fires once per real change (ref-guarded); no per-eval churn for steady code.
     */
    readonly onActiveBackdropChange?: (fileId: string | null) => void;
    /**
     * #240 — open a viz file's preview in a pop-out browser window. The shell
     * forwards the Cmd+K W command (`workspace.openPreviewInWindow` →
     * `shell.openPopoutPreview(fileId)`) to this host callback; the app compiles
     * a descriptor + subscribes the audio bus and drives `usePopoutPreview`.
     * Optional: when the host omits it, Cmd+K W is a no-op (the command guards
     * on `shell.openPopoutPreview?.`).
     */
    readonly onOpenPopoutPreview?: (fileId: string) => void;
    /**
     * Crop region applied to the pinned backdrop — 0–1 fractional
     * `{x, y, w, h}`. Absent means render the full viz rect. The
     * shell's backdrop wrapper scales/positions its inner div so
     * only the cropped sub-rect fills the viewport, preserving the
     * quality-ladder transform math. Purely presentational; app
     * owns persistence, keyed by the backdrop's viz FILE (#1435 —
     * `stave:backdropCrops:${projectId}`, beside the per-tab backdrop
     * file itself). The shell never stores it, so a crop can't outlive
     * the sketch it was cut for.
     */
    readonly backgroundCrop?: {
        readonly x: number;
        readonly y: number;
        readonly w: number;
        readonly h: number;
    } | null;
    /**
     * Fires when a tab is closed by the user. Runtime disposal hooks
     * (Task 05 / Task 07) plug in here to call `runtime.dispose()` on
     * the closed tab's pattern file. The callback receives the tab that
     * was just removed; the tab has already been dropped from the group
     * state by the time this fires.
     *
     * CONTEXT U3 — closing a pattern file's last editor tab MUST dispose
     * its runtime. Task 04 exposes the seam; Task 05 fills it in.
     */
    readonly onTabClose?: (closingTab: WorkspaceTab) => void;
    /**
     * Runtime providers available to the shell. Forward-declared slot
     * type — Task 05 will replace `LiveCodingRuntimeProviderStub` with
     * the concrete `LiveCodingRuntimeProvider` interface. Task 04 accepts
     * the array and only hands it to `chromeForTab` (the shell itself
     * never instantiates engines).
     */
    readonly runtimeProviders?: readonly LiveCodingRuntimeProviderStub[];
    /**
     * Callback the shell uses to look up a preview provider for a given
     * preview tab. Task 06 will ship the registry that wires the default
     * implementation; Task 04 accepts the callback directly so tests can
     * pass a stub provider. Returning `undefined` means "no provider
     * available" — the shell renders a fallback message in the preview
     * tab's content area.
     */
    readonly previewProviderFor?: (tab: WorkspaceTab & {
        kind: 'preview';
    }) => PreviewProvider | undefined;
    /**
     * Callback for resolving per-tab runtime chrome (transport bar for
     * pattern files). Task 05 fills this in with a lookup into
     * `runtimeProviders`. Task 04 calls the callback for every editor tab
     * and passes the return value into `EditorView.chromeSlot`. Returns
     * `undefined` by default — viz / markdown editors have no chrome.
     */
    readonly chromeForTab?: ChromeForTab;
    /**
     * Callback for resolving per-tab editor extras (play/stop keybindings,
     * error prop). The compat shim (LiveCodingEditor) returns
     * `{ onPlay, onStop, error }` for pattern-file tabs; the shell passes
     * them through to `EditorView`. Returns `undefined` for tabs that don't
     * need extras (viz, markdown).
     */
    readonly editorExtrasForTab?: (tab: WorkspaceTab & {
        kind: 'editor';
    }) => {
        onPlay?: () => void;
        onStop?: () => void;
        error?: Error | null;
    } | undefined;
    /**
     * Host callback for "save this file" — fires when the user presses
     * Cmd+S / Ctrl+S anywhere in the shell, or clicks the Save button on
     * the preview-provider's editor chrome (viz files). The shell owns the
     * keybinding + chrome wiring; the host owns what "save" actually means
     * for a given file type (e.g., `flushToPreset` for viz files backed by
     * `VizPresetStore`).
     *
     * Fires with the currently-active editor tab. The shell does nothing
     * if the active tab is a preview tab or no tab is active.
     */
    readonly onSaveFile?: (tab: WorkspaceTab & {
        kind: 'editor';
    }) => void;
    /**
     * Fires when the user right-clicks on a tab's chrome. Receives the
     * tab, viewport coords of the click, and a minimal set of handles
     * the listener can call back to close tabs or reveal them in the
     * host app's sidebar. Host apps typically render a context menu
     * positioned at (x, y) and call the handles.
     */
    readonly onTabContextMenu?: (tab: WorkspaceTab, x: number, y: number) => void;
    /** Inline viz "edit" icon clicked — navigate to the viz file. */
    readonly onEditViz?: (vizId: string) => void;
    /** Inline viz "crop" icon clicked — open crop popup. `trackKey` scopes
     *  the crop to this specific zone instance; see onCropViz above for the
     *  per-instance rationale. */
    readonly onCropViz?: (vizId: string, presetId: string | null, trackKey: string) => void;
    /**
     * #773 — open the app's backdrop crop popup for the active group's backdrop.
     * Surfaced inside the viz-settings popover (crop… action). App-owned because
     * the crop UI is an app-level popup. */
    readonly onCropBackdrop?: () => void;
    /**
     * #773 — reveal the active group's backdrop source viz file in the editor.
     * Surfaced inside the viz-settings popover (reveal action). */
    readonly onRevealBackdrop?: () => void;
}

/**
 * A user-authored visualization saved to IndexedDB.
 * Compiled to a VizDescriptor at runtime for use with .viz("name").
 */
interface CropRegion {
    /** Fractional offset from left (0–1). */
    x: number;
    /** Fractional offset from top (0–1). */
    y: number;
    /** Fractional width (0–1). */
    w: number;
    /** Fractional height (0–1). */
    h: number;
}
interface VizPreset {
    id: string;
    name: string;
    renderer: 'hydra' | 'p5' | 'glsl';
    code: string;
    requires: (keyof EngineComponents)[];
    createdAt: number;
    updatedAt: number;
    /** Optional crop region for inline viz display. Fractional 0–1 coords
     *  relative to the full canvas. When set, the inline zone shows only
     *  this sub-region (scaled to fill). */
    cropRegion?: CropRegion;
    /** Native canvas dimensions the sketch renders at. If absent, the
     *  default (1200×600) is used. Set this when your sketch calls
     *  createCanvas(W, H) with specific values you want the inline viz
     *  to respect — the crop region is interpreted in these coords. */
    nativeSize?: {
        w: number;
        h: number;
    };
}
/**
 * Reserved prefix for app-bundled demo presets. User-created IDs cannot
 * start with this — guaranteed by `generateUniquePresetId`'s sanitizer
 * which strips leading underscores.
 */
declare const BUNDLED_PREFIX = "__bundled_";
/**
 * Sanitize a display name into an ID-safe slug:
 *   "My Aurora!"  →  "my_aurora"
 *   "  spaces  "  →  "spaces"
 *   ""            →  "untitled"
 */
declare function sanitizePresetName(name: string): string;
/**
 * Build the ID for an app-bundled preset:
 *   bundledPresetId('Piano Roll', 'p5')  →  '__bundled_piano_roll_p5__'
 *
 * Bundled IDs never collide with user IDs because user IDs follow the
 * `<name>_<renderer>_v<N>` format and never start with `__`.
 */
declare function bundledPresetId(name: string, renderer: 'hydra' | 'p5' | 'glsl'): string;
/** True if this id was generated by `bundledPresetId`. */
declare function isBundledPresetId(id: string): boolean;
/**
 * Generate a unique user preset ID in the format `<name>_<renderer>_v<N>`,
 * where N is the smallest positive integer such that the resulting id is
 * not present in `existingIds`.
 *
 * Examples (with no collisions):
 *   ('Piano Roll',  'p5',    [])  →  'piano_roll_p5_v1'
 *   ('Piano Roll',  'hydra', [])  →  'piano_roll_hydra_v1'
 *
 * With collisions:
 *   ('Piano Roll',  'p5',    ['piano_roll_p5_v1'])  →  'piano_roll_p5_v2'
 */
declare function generateUniquePresetId(name: string, renderer: 'hydra' | 'p5' | 'glsl', existingIds: Iterable<string>): string;
declare const VizPresetStore: {
    getAll(): Promise<VizPreset[]>;
    get(id: string): Promise<VizPreset | undefined>;
    put(preset: VizPreset): Promise<void>;
    delete(id: string): Promise<void>;
};

/**
 * vizLanguages — the single home for the viz `language` ↔ renderer `kind`
 * correspondence.
 *
 * ## Why this module exists
 *
 * A workspace file's `language` (`'p5js' | 'hydra' | 'glsl'`) maps to a
 * concrete renderer `kind` (`'p5' | 'hydra' | 'glsl'`), and the inverse.
 * Before this module that correspondence was duplicated as inline ternaries
 * and `language === 'p5js' || 'hydra'` allow-list filters across ~13 call
 * sites in the editor and app packages. Adding the GLSL renderer kind (#287)
 * meant threading `'glsl'` through every one of them — and the easily-missed
 * sites were the **filters**: a union-widen forces the type system to make you
 * add a ternary arm, but an allow-list filter compiles fine while silently
 * excluding the new kind, so the feature just no-ops (P118 / PV88 — the
 * named-viz registration filter and the backdrop filters dropped `'glsl'`
 * invisibly to tsc + unit tests; found only by live observation).
 *
 * Consolidating into one helper means:
 *   - the allow-list (`VIZ_LANGUAGES`) has ONE definition every filter calls,
 *     so a new kind can't be silently dropped by a forgotten filter, and
 *   - the maps are exhaustive `Record`s keyed by the renderer union, so a new
 *     renderer kind is a compile error until every arm is added — the next
 *     kind is a 1-line change, not a 13-site scavenger hunt.
 *
 * @see PV88 (the consolidation target), P118 (the silent-drop trap).
 */

/**
 * The concrete renderer kind a viz file compiles to. Mirror of
 * `VizPreset['renderer']` — kept as a named alias so call sites read
 * intent rather than reaching into the preset shape.
 */
type VizRendererKind = VizPreset['renderer'];
/**
 * The workspace languages that compile to a viz renderer — THE single
 * allow-list. Every "is this a viz file?" filter must derive from this
 * (via {@link isVizLanguage}) so a new viz language can never be silently
 * excluded by a forgotten filter site.
 *
 * `satisfies` (not `as`) keeps each entry checked against
 * `WorkspaceLanguage` while preserving the literal tuple type.
 */
declare const VIZ_LANGUAGES: readonly ["p5js", "hydra", "glsl"];
/** Narrowing of `WorkspaceLanguage` to the viz languages. */
type VizLanguage = (typeof VIZ_LANGUAGES)[number];
/** True when `lang` is a viz language (compiles to a renderer). */
declare function isVizLanguage(lang: WorkspaceLanguage): lang is VizLanguage;
/**
 * The renderer kind a workspace `language` compiles to, or `null` when the
 * language is not a viz language. Callers that have already established a
 * viz file (e.g. via {@link isVizLanguage}) typically fall back to `'p5'`.
 */
declare function rendererForLanguage(lang: WorkspaceLanguage): VizRendererKind | null;
/** The workspace language a renderer kind authors as. */
declare function languageForRenderer(renderer: VizRendererKind): WorkspaceLanguage;

/**
 * injectedGlobals — the single, authoritative catalogue of the Stave-injected
 * globals a viz sketch may read, per renderer kind (#309).
 *
 * This is the SOURCE OF TRUTH for two surfaces:
 *   - the read-only "Stave Inputs" reference block shown above the viz editor
 *     (ShaderToy-style — see {@link formatStaveInputs}); and
 *   - the Monaco hover provider that shows a token's doc + live master value
 *     (see {@link injectedGlobalByToken} + the `live` field).
 *
 * Keeping ONE list means the docs surfaced to authors cannot drift from what is
 * actually injected by the compilers/builders (`buildStaveUniforms` for p5,
 * `buildHydraStaveBag` for hydra, the `UNIFORMS` + `STAVE_TRACK_API` strings for
 * glsl). When a new bus signal is added to those builders, add it here too — the
 * same PV54 additive-floor obligation, applied to the doc surface (PV94).
 *
 * SCOPE (deliberate, issue #309): Stave-exclusive globals ONLY. The full p5 /
 * hydra built-in API is NOT listed — authors know p5/hydra; what they can't
 * discover is what STAVE injects on top.
 *
 * WORKER-SAFE: pure data + string formatting, no DOM / no renderer imports.
 */

/**
 * How the hover provider reads a token's LIVE value from the GLOBAL MASTER bus
 * (issue #309 — master-only, no per-instance focus). `null`/absent ⇒ no live
 * value (structural handle like `stave.scheduler`, or a per-instance/non-numeric
 * token) → hover shows the doc only.
 */
type LiveSpec = {
    kind: 'scalar';
    read: MasterScalar;
} | {
    kind: 'array';
    read: MasterArray;
} | {
    kind: 'time';
};
/** Master-mix scalar signals readable live (all 0..1). */
type MasterScalar = 'rms' | 'bass' | 'mid' | 'treble' | 'keyVelocity' | 'env:uKick' | 'env:uSnare' | 'env:uHat' | 'env:uOpenHat' | 'env:uClap' | 'env:uRim' | 'env:uTom';
/** Master-mix array signals readable live. */
type MasterArray = 'fft' | 'wave';
/**
 * One catalogued entry. `decl` is the human declaration line shown in the block
 * (kind-specific syntax); `comment` is the trailing `// ...`; `tokens` are the
 * individual identifiers the hover provider matches a hovered word against.
 */
interface InjectedGlobal {
    /** Declaration as it reads in the block, e.g. `uniform float iTime;`. */
    readonly decl: string;
    /** Trailing comment (no leading `//`). */
    readonly comment: string;
    /** Identifiers under this entry, for hover word-match. */
    readonly tokens: readonly string[];
    /**
     * Section the entry belongs to in the reference block. Entries are listed in
     * group order; {@link formatStaveInputs} emits a `// — <group> —` header when
     * the group changes. Makes the one-namespace rule visible at a glance
     * (every signal lives on `sig` — `sig.kick` a number, `sig.fft` an array).
     */
    readonly group: string;
    /** Live-value source on the master bus, when the token carries one. */
    readonly live?: Partial<Record<string, LiveSpec>>;
}
/** The catalogue of Stave-injected globals for a renderer kind (issue #309). */
declare function injectedGlobals(kind: VizRendererKind): readonly InjectedGlobal[];
/**
 * Render the read-only "Stave Inputs" reference block — a ShaderToy-style aligned
 * `decl // comment` list. Comments are padded to a common column so the block
 * reads like ShaderToy's "Shader Inputs". Multi-line decls (hydra) align each
 * continuation line's comment too.
 */
declare function formatStaveInputs(kind: VizRendererKind): string;
/**
 * Look up the catalogue entry + the specific token a hovered WORD matches, for a
 * renderer kind. Returns `null` when the word is not a Stave-injected token.
 * (A bare word like `uKick` / `iTime` / `rms` is matched against every entry's
 * `tokens`; the first match wins — token sets are disjoint within a kind.)
 */
declare function injectedGlobalByToken(kind: VizRendererKind, word: string): {
    entry: InjectedGlobal;
    token: string;
    live: LiveSpec | null;
} | null;

/**
 * namedVizRegistry — runtime map of user-chosen viz names → descriptors.
 *
 * Lets users reference their own viz files from inline patterns by the
 * `VizPreset.name` they chose, alongside the built-in descriptors:
 *
 *     $: note("c e g").viz("Piano Roll")   // user-named preset
 *     $: note("c e g").viz("pianoroll")    // built-in descriptor
 *
 * @remarks
 * ## How it plugs into the resolver
 *
 * `resolveDescriptor` checks this registry first (exact-name match),
 * then falls through to the passed-in descriptor list (`DEFAULT_VIZ_
 * DESCRIPTORS` or any embedder override) and runs its existing
 * "append default renderer" / "prefix" fallbacks. Names registered
 * here shadow built-ins — if a user saves a preset literally called
 * `"pianoroll"`, their version wins inside `.viz("pianoroll")`.
 * That's the right default: user intent is closer to what the user
 * controls than what ships in the library.
 *
 * ## Who writes to the registry
 *
 * `vizPresetBridge.seedFromPreset` and `flushToPreset` compile the
 * preset via `compilePreset()` and call `registerNamedViz(preset.name,
 * descriptor)` — so every viz file the user opens or saves is
 * automatically available to inline `.viz("name")` without any manual
 * registration step.
 *
 * If the user renames a preset (future save-as UI), the old name is
 * unregistered and the new name is registered in the same transaction.
 * Until that UI lands, a preset rename is a no-op at the registry
 * level; the stale name keeps working until page reload. Acceptable
 * for Phase 10.2 MVP — there's no rename UI yet.
 *
 * ## Change notifications
 *
 * `onNamedVizChanged` lets consumers subscribe to register/unregister
 * events. Phase 10.2 doesn't wire this to anything, but it's in place
 * so a future Monaco completion provider can invalidate its suggestion
 * cache when the registry mutates.
 */

type Listener$6 = () => void;
/**
 * Register a descriptor under a user-chosen name. Idempotent — calling
 * twice with the same name + descriptor is a no-op and does not fire
 * listeners. Calling with a new descriptor for an existing name
 * replaces the entry (and fires listeners) so saves can update a
 * previously-registered viz in place.
 */
declare function registerNamedViz(name: string, descriptor: VizDescriptor): void;
/**
 * Unregister a name. Idempotent — unknown names are silent no-ops.
 * Fires listeners only when an entry is actually removed.
 */
declare function unregisterNamedViz(name: string): void;
/**
 * Look up a descriptor by name. Returns `undefined` if the name is not
 * registered. The resolver falls through to the built-in descriptor
 * list in that case.
 */
declare function getNamedViz(name: string): VizDescriptor | undefined;
/**
 * List every registered name in insertion order. Used by tests and by
 * a future Monaco completion provider that wants to surface every
 * user-defined viz name inside `.viz("...")` autocomplete.
 */
declare function listNamedVizNames(): string[];
/**
 * List every (name, descriptor) pair. Mostly useful for debugging and
 * for tests that want to assert the full registry contents.
 */
declare function listNamedVizEntries(): Array<[string, VizDescriptor]>;
/**
 * Subscribe to registry changes. Fires on any register/unregister
 * transition. Returns an idempotent unsubscribe function. Does not
 * fire synchronously on subscription — subscribers receive only
 * future changes.
 */
declare function onNamedVizChanged(cb: Listener$6): () => void;

/**
 * Worker-viz capability detection — the degrade-path scaffold for Phase B.
 *
 * Phase B moves viz `draw()` off the main thread into an OffscreenCanvas worker
 * (epic #228). Whether that is possible — and *how* the per-frame signal data
 * reaches the worker — depends on browser capabilities that vary by environment:
 *
 *   - `Worker` + `OffscreenCanvas` + `HTMLCanvasElement.transferControlToOffscreen`
 *     → worker rendering is possible at all.
 *   - `crossOriginIsolated` + `SharedArrayBuffer`
 *     → the zero-copy SAB signal transport is available (the measured optimization,
 *       gated behind the COOP/COEP header — see B-1 #239 / Q2 #237).
 *
 * B-1 (#239) confirmed by observation that the live COOP=same-origin +
 * COEP=credentialless header yields `crossOriginIsolated === true` (and that a
 * `window.open` popup inherits it). This module turns that runtime truth into a
 * single capability snapshot + a sensible default transport choice, so B-2/B-3
 * can pick SAB vs postMessage vs main-thread without re-probing globals ad hoc.
 *
 * Pure + environment-injectable → plain unit tests (no IDB/DOM — see the editor
 * "split pure logic from I/O" rule). The live app passes nothing and reads
 * `globalThis`.
 */
/**
 * How per-frame viz signal data crosses to the renderer.
 *
 * - `'sab'`         — worker render + zero-copy SharedArrayBuffer transport
 *                     (requires cross-origin isolation; the primary path).
 * - `'postmessage'` — worker render + transferable-ArrayBuffer postMessage
 *                     transport (no isolation needed; the required fallback for
 *                     non-isolated browsers, e.g. Safari).
 * - `'main-thread'` — no worker offload possible; render on the main thread with
 *                     today's `P5VizRenderer` / `HydraVizRenderer`.
 */
type VizTransport = 'sab' | 'postmessage' | 'main-thread';
interface WorkerVizCapabilities {
    /** COOP/COEP cross-origin isolation is active (gates SharedArrayBuffer). */
    crossOriginIsolated: boolean;
    /** `OffscreenCanvas` constructor exists. */
    hasOffscreenCanvas: boolean;
    /** `SharedArrayBuffer` constructor exists (still needs isolation to be useful). */
    hasSharedArrayBuffer: boolean;
    /** `HTMLCanvasElement.prototype.transferControlToOffscreen` exists. */
    canTransferControl: boolean;
    /** `Worker` constructor exists. */
    hasWorker: boolean;
    /** Worker rendering is possible at all (worker + offscreen + transfer). */
    canUseWorker: boolean;
    /** The default transport given these capabilities (see {@link VizTransport}). */
    transport: VizTransport;
}
/**
 * The subset of the global environment this module reads. Injectable so the
 * selection logic can be unit-tested across capability matrices without touching
 * the real `globalThis`.
 */
interface CapabilityEnv {
    crossOriginIsolated?: boolean;
    OffscreenCanvas?: unknown;
    SharedArrayBuffer?: unknown;
    Worker?: unknown;
    /** Stand-in for `HTMLCanvasElement` — we only probe for the transfer method. */
    HTMLCanvasElement?: {
        prototype?: {
            transferControlToOffscreen?: unknown;
        };
    };
}
/**
 * Derive worker-viz capabilities + the default transport from an environment.
 *
 * Transport policy (capability-derived, deliberately separate from any
 * load/quality policy B-6 may add):
 *   1. Can't offload (no worker / offscreen / transferControl) → `'main-thread'`.
 *   2. Isolated + SharedArrayBuffer                            → `'sab'`.
 *   3. Worker-capable but not isolated                         → `'postmessage'`.
 *
 * Note: PHASE-B-PLAN §4's conservative line ("fallback to main if
 * !crossOriginIsolated") collapses cases 2+3; the plan's transport section +
 * decision §1 are the refined intent — worker rendering works without isolation,
 * only SAB needs it, so a non-isolated browser still offloads via postMessage.
 * This function encodes the refined three-tier truth; a consumer that wants the
 * conservative behaviour can treat anything but `'sab'` as main-thread.
 */
declare function detectWorkerVizCapabilities(env?: CapabilityEnv): WorkerVizCapabilities;

/**
 * MainSignalSampler — samples the main-thread signal feed into a `SignalFrame`
 * each frame (Phase B / B-2). It is the MAIN-side half of the marshalling: it
 * does the work that is main-thread-bound (read `AnalyserNode` bytes, query the
 * scheduler, collect haps) so a worker `SignalBus` can run off those values.
 *
 * It mirrors exactly what `SignalBus` does on main today (P5VizRenderer __tick):
 *   - `now = scheduler.now()`
 *   - active events = `scheduler.query(now, now + ε)` (combined + per-track)
 *   - analyser bytes = `getByte{Frequency,TimeDomain}Data` per bound analyser
 *   - bumps = the haps that fired since the previous `sample()`
 *
 * No DOM/worker — it consumes the same structural types the bus does
 * (`BusAnalyser`, `IRPattern`, `HapStream`), so it unit-tests with plain stubs.
 */

/** The live inputs the sampler reads — the main-thread feed. All optional: any
 *  absent input degrades to the bus's zero (empty arrays / no events). */
interface SamplerInputs {
    /** Combined scheduler (`now()` + `query()`). */
    scheduler?: IRPattern | null;
    /** Per-track schedulers, SCHEDULER key space (`$0`/`d1` — TRAP §5). */
    trackSchedulers?: Map<string, IRPattern> | null;
    /** Master/combined-mix analyser. */
    masterAnalyser?: BusAnalyser | null;
    /** Per-track analysers, keyed the SAME as `trackSchedulers`. */
    trackAnalysers?: Map<string, BusAnalyser> | null;
}
/** Minimal HapStream surface the sampler subscribes to (structural — the bus
 *  uses the same `.on`/`.off` guard discipline). */
interface HapSubscribable {
    on(handler: (e: HapEvent) => void): void;
    off(handler: (e: HapEvent) => void): void;
}
declare class MainSignalSampler {
    private inputs;
    private seq;
    /** Haps accumulated since the last `sample()` (the envelope feed). */
    private pendingBumps;
    private boundStream;
    private readonly hapHandler;
    /** Rebind the live inputs (mirror the renderer's in-place rebind on
     *  re-evaluate). Pass `null`/absent for demo / IR-only mode. */
    bind(inputs: SamplerInputs): void;
    /** (Re)subscribe to a HapStream for the envelope feed. Off the old, on the new
     *  — so the bump feed survives a re-evaluate that swaps the stream (mirror
     *  P5VizRenderer.update). A partial stream (no `.on`) degrades to no feed. */
    bindHapStream(stream: HapSubscribable | null): void;
    /**
     * Produce one frame from the current inputs + the haps since the last call.
     * Drains the pending bumps (so each hap ships exactly once).
     *
     * `cache` (the shared frame pump, PV72) deduplicates the EXPENSIVE per-frame
     * work across every viz sampling in the same rAF tick: the analyser FFT read and
     * the scheduler query run ONCE per shared input object, not once per viz. It is
     * keyed by input-object IDENTITY, so two viz on DIFFERENT tracks (distinct
     * scheduler/analyser, viewZones.ts:341) don't false-share. Absent (unit tests /
     * pre-pump path) → every read runs locally, byte-identical to before.
     */
    sample(cache?: FrameSampleCache): SignalFrame;
    /** Unsubscribe + reset (renderer destroy). */
    dispose(): void;
    /** The next seq an `emptyFrame` should carry (test/demo helper). */
    emptyFrame(): SignalFrame;
}

/**
 * WorkerBusFeed — drives a (pure) `SignalBus` from `SignalFrame`s on the WORKER
 * side (Phase B / B-2). The worker bus is the SAME `SignalBus` class as on main;
 * this feed reconstructs the bus's three inputs from a transported frame and runs
 * the per-frame sequence, so `bus` yields the same readings as a main-fed bus.
 *
 * No DOM, no worker API, no transport — pure object plumbing over `SignalBus`'s
 * public seams. Lives equally happily in a unit test (parity gate) or the real
 * `viz-worker` (B-3).
 *
 *   analysers → byte-backed `BusAnalyser` stubs whose identity is STABLE across
 *               frames (keyed by analyser key) so `SignalBus`'s per-analyser
 *               scratch-buffer cache (WeakMap on the stub) keeps hitting.
 *   scheduler → a minimal `IRPattern` stub `{ now, query }` returning the frame's
 *               `now` + active events (the bus only calls those two — IRPattern.ts).
 *   bumps     → replayed into `bus.bump()` (the envelope feed).
 *
 * Per-frame order (the worker frame contract): replay bumps → `tick()` →
 * `refreshActive(now)` → `readAudio()`. `readAudio` MUST follow `refreshActive`
 * (SignalBus Slice-2 ordering — `audioFor` resolves a sound→track via the active
 * map). The reference main-bus in the parity gate is driven the same way.
 */

declare class WorkerBusFeed {
    readonly bus: SignalBus;
    /** Stable analyser stubs by key (`'master'` + track keys). */
    private readonly analysers;
    private lastSeq;
    constructor(aliasMap?: Record<string, string | string[]>);
    /** Push the merged alias map (the renderer reads impure settings on main and
     *  ships the map; the worker bus stays pure — mirrors P5VizRenderer). */
    setAliases(map: Record<string, string | string[]>): void;
    /**
     * Apply one frame: rebuild the bus's inputs from `frame`, replay bumps, then
     * run the per-frame sequence. Idempotent on a duplicate/stale `seq` (no-op) so
     * a dropped or repeated transport frame can't double-decay the envelope.
     * Returns `true` if the frame advanced state, `false` if skipped as stale.
     */
    applyFrame(frame: SignalFrame): boolean;
}

/**
 * SignalTransport — how a `SignalFrame` crosses main → worker each frame
 * (Phase B / B-2). Two interchangeable implementations behind one interface so
 * B-3 can render against the de-risked transport and B-4 can swap in SAB as the
 * measured optimization without touching the renderer:
 *
 *   - postMessage-transferable (THIS file) — the de-risked default + the required
 *     fallback for non-isolated browsers (Safari). Zero-copy for the analyser
 *     bytes via `transfer`; the small JSON envelope is structured-cloned.
 *   - SAB (B-2b) — zero-copy ring + double-buffer, gated on `crossOriginIsolated`.
 *
 * Structural over the channel (no `lib.dom` `Worker`/`Transferable` dependency —
 * the bus stays DOM-free, P12): a `FrameChannel` is anything with
 * postMessage/addEventListener, i.e. a `Worker` on main or `self`/`MessagePort`
 * in the worker.
 */

/** The minimal channel surface a postMessage transport needs (structural — a
 *  `Worker` on main, `self`/`MessagePort` on the worker). */
interface FrameChannel {
    postMessage(message: unknown, transfer: ArrayBuffer[]): void;
    addEventListener(type: 'message', handler: (ev: {
        data: unknown;
    }) => void): void;
    removeEventListener(type: 'message', handler: (ev: {
        data: unknown;
    }) => void): void;
}
/** MAIN side — ships frames into the worker. */
interface SignalTransportWriter {
    /** Send one frame. The analyser byte buffers are TRANSFERRED (zero-copy), so
     *  the frame is unusable on the sender afterwards (the sampler mints fresh
     *  arrays each frame — safe). */
    writeFrame(frame: SignalFrame): void;
    dispose(): void;
}
/** WORKER side — delivers frames to a consumer (e.g. `WorkerBusFeed.applyFrame`). */
interface SignalTransportReader {
    /** Register the per-frame consumer. Replaces any previous one. */
    onFrame(cb: (frame: SignalFrame) => void): void;
    dispose(): void;
}
/** Build the MAIN-side writer over a channel (the `Worker`). */
declare function createPostMessageWriter(channel: Pick<FrameChannel, 'postMessage'>): SignalTransportWriter;
/** Build the WORKER-side reader over a channel (`self`/`MessagePort`). Ignores
 *  non-frame messages (B-3 control messages share the channel). */
declare function createPostMessageReader(channel: Pick<FrameChannel, 'addEventListener' | 'removeEventListener'>): SignalTransportReader;

interface VizPanelProps {
    vizHeight?: number | string;
    hapStream: HapStream | null;
    analyser: AnalyserNode | null;
    scheduler: PatternScheduler | null;
    source: VizRendererSource;
}
declare function VizPanel({ vizHeight, hapStream, analyser, scheduler, source }: VizPanelProps): react_jsx_runtime.JSX.Element;

interface VizPickerProps {
    descriptors: VizDescriptor[];
    activeId: string;
    onIdChange: (id: string) => void;
    showVizPicker?: boolean;
    /** When provided, descriptors whose requires[] aren't met are disabled. */
    availableComponents?: (keyof EngineComponents)[];
}
declare function VizPicker({ descriptors, activeId, onIdChange, showVizPicker, availableComponents }: VizPickerProps): react_jsx_runtime.JSX.Element | null;

interface VizDropdownProps {
    descriptors: VizDescriptor[];
    activeId: string;
    onIdChange: (id: string) => void;
    onNewViz?: () => void;
    availableComponents?: (keyof EngineComponents)[];
}
/**
 * Grouped dropdown picker for viz modes — replaces the icon button bar.
 * Groups descriptors by renderer field. Custom presets marked with ★.
 */
declare function VizDropdown({ descriptors, activeId, onIdChange, onNewViz, availableComponents, }: VizDropdownProps): react_jsx_runtime.JSX.Element;

interface VizEditorProps {
    components: Partial<EngineComponents>;
    hapStream: HapStream | null;
    analyser: AnalyserNode | null;
    scheduler: PatternScheduler | null;
    onPresetSaved?: (preset: VizPreset) => void;
    height?: number | string;
    previewHeight?: number | string;
    /** Theme applied to the container — defaults to 'dark'. */
    theme?: 'dark' | 'light' | StrudelTheme;
}
declare function VizEditor({ components: _components, hapStream: _hapStream, analyser: _analyser, scheduler: _scheduler, onPresetSaved, height, previewHeight: _previewHeight, theme, }: VizEditorProps): react_jsx_runtime.JSX.Element | null;

/**
 * Compiles user-authored viz code into a VizDescriptor.
 *
 * Hydra code: evaluated in a function scope with the hydra synth
 *   object as `s` and a `stave` namespace mirroring the p5 convention:
 *     - `stave.scheduler` — IRPattern | null (combined pattern scheduler)
 *     - `stave.tracks`    — Map<trackId, IRPattern> (per-track)
 *   Sketches that reference only `s` keep working — the `stave` arg
 *   is additive. Uses `new Function()`.
 *
 * p5 code: evaluated as a full p5 sketch script. Users write real
 *   `function preload/setup/draw` declarations and access injected
 *   Stave-specific inputs via a single `stave` namespace global:
 *     - `stave.scheduler`  — PatternScheduler | null
 *     - `stave.analyser`   — AnalyserNode | null
 *     - `stave.hapStream`  — HapStream | null
 *   Legacy draw-body snippets (no `function draw` declaration) are
 *   auto-wrapped for backwards compatibility.
 */
declare function compilePreset(preset: VizPreset): VizDescriptor;

/**
 * Shared imperative utility for the PICKER (`useVizRenderer`/`VizPanel`), BACKDROP
 * (`compiledVizProvider`) and CROP preview (`CropPopup`) seams: resolves a
 * VizRenderer, runs the shared per-mount lifecycle (mount + visibility pausing) via
 * `attachVizLifecycle`, and ADDS a ResizeObserver (this seam's container is sized
 * by CSS/layout, so a generic ResizeObserver is the right resize trigger here).
 *
 * NOT the inline `.viz()` path — `viewZones.ts` does its OWN mount (Monaco-layout
 * reflow, teardown-wrap, crop, decorations) and calls `attachVizLifecycle`
 * DIRECTLY. The single shared choke point for the mount+visibility concern-class
 * is `attachVizLifecycle`, NOT this function (P107: don't claim callers you don't
 * have — `viewZones` is not one).
 *
 * Returns the renderer instance and a disconnect function that tears down BOTH the
 * ResizeObserver and the visibility registration.
 */
declare function mountVizRenderer(container: HTMLDivElement, source: VizRendererSource, components: Partial<EngineComponents>, size: {
    w: number;
    h: number;
}, onError: (e: Error) => void): {
    renderer: VizRenderer;
    disconnect: () => void;
};

/**
 * mountVizPreview — render a viz LIVE, muted, into a small container (#838).
 *
 * The single app-facing seam for the viz-library card's ShaderToy-style hover
 * preview: given a viz's raw source (renderer kind + code), it mounts the real
 * worker viz into `container` and drives it from the muted drum-pattern demo
 * feed (`demoSignalSource`) so an audio-reactive shader animates while nothing
 * is playing and no sound is produced. The worker presents directly onto the
 * on-screen canvas — there is NO frame readback / ImageBitmap capture.
 *
 * Worker-ONLY by design: the demo feed is a worker `SignalFrame` stream, and the
 * user wants previews rendered in the dedicated viz worker. Where the worker path
 * is unavailable (old/non-isolated browser, flag off) this returns `null` and the
 * caller keeps its static baked/placeholder tile — a preview is a best-effort
 * enhancement, never a requirement.
 *
 * Teardown is the caller's responsibility on mouse-leave: call `disconnect()`,
 * which stops the ResizeObserver/lifecycle AND destroys the renderer so the
 * worker + its GPU context are released immediately (only one preview is ever
 * alive, so the shared GPU never accumulates contexts — P122).
 *
 * REF: mountVizRenderer (the shared preview lifecycle), WorkerVizRenderer
 *      (setDemoSource), demoSignalSource, [[project_asset_library]] (#838).
 */
/** The renderer kind + raw source a library card knows about its viz. */
interface VizPreviewSpec {
    readonly renderer: 'p5' | 'hydra' | 'glsl';
    readonly code: string;
    /** Display/attribution name (used for worker error messages). */
    readonly name: string;
}
/** Mount a muted live preview, or return `null` if the worker path is unavailable
 *  (caller then keeps its static tile). `disconnect()` fully tears down. */
declare function mountVizPreview(container: HTMLDivElement, spec: VizPreviewSpec, size: {
    w: number;
    h: number;
}, onError: (e: Error) => void): {
    disconnect: () => void;
} | null;

interface PopoutPreviewProps {
    descriptor: VizDescriptor | null;
    hapStream: HapStream | null;
    analyser: AnalyserNode | null;
    scheduler: PatternScheduler | null;
    onClose: () => void;
    theme?: 'dark' | 'light';
}
/**
 * Opens a pop-out browser window with the viz canvas.
 * Audio data is pumped via postMessage since the pop-out window
 * doesn't share the AudioContext.
 */
declare function usePopoutPreview({ descriptor, hapStream, analyser, scheduler, onClose, theme, }: PopoutPreviewProps): {
    cleanup: () => void;
};

/**
 * profiler — a zero-cost-when-disabled runtime performance profiler.
 *
 * WHY (issue #228): we want to optimize viz smoothness / main-thread budget /
 * scheduler latency, but had NO instrumentation — optimizing on inference, not
 * observation. This module measures the real per-frame cost so the next
 * optimization is chosen from data (OBSERVE before optimize).
 *
 * ## What it measures
 *   - SECTIONS: named timed spans (`p5.bus`, `hydra.draw`, …) → ring-buffer of
 *     the last N durations with count / mean / p50 / p95 / p99 / max / last.
 *   - FRAMES: per-instance inter-frame interval → fps + dropped-frame count
 *     (a frame > 2× the running median interval counts as a drop).
 *   - COUNTERS: monotone or live counts (`viz.p5` live instances,
 *     `audio.triggers` cumulative) — rate is derived in the snapshot.
 *   - LONGTASKS: `PerformanceObserver({entryTypes:['longtask']})` — main-thread
 *     blocks > 50ms the platform reports, which is exactly scheduler-vs-viz
 *     contention.
 *
 * ## Cost when disabled
 * Every hot-path method early-returns on `!this._enabled` BEFORE any allocation
 * or `performance.now()` call — the cost is one boolean branch. `enabled` is a
 * field read, not a getter, so it's a plain load. Instrumentation can therefore
 * live on the per-frame path unconditionally.
 *
 * ## Purity boundary
 * The SignalBus stays PURE (P12 / PV65) — it does NOT import this module.
 * Renderers (which already import settings/p5/hydra) call the profiler and wrap
 * the bus calls. The profiler itself imports nothing app-specific.
 *
 * ## Enabling
 *   - `globalThis.__STAVE_PERF__ === true` at module load (e2e / automation), OR
 *   - `Profiler.setEnabled(true)` at runtime (the overlay toggle / a setting).
 * When in a browser, `window.__stavePerf` exposes snapshot/reset/setEnabled so a
 * Playwright run can flip it on, drive a patch, and read the numbers.
 */
/** Aggregated stats for one section over its ring buffer. */
interface SectionStats {
    /** Total samples recorded since reset (NOT capped at RING). */
    count: number;
    /** Mean of the retained ring (ms). */
    mean: number;
    /** Median of the retained ring (ms). */
    p50: number;
    /** 95th percentile of the retained ring (ms). */
    p95: number;
    /** 99th percentile of the retained ring (ms). */
    p99: number;
    /** Max of the retained ring (ms). */
    max: number;
    /** Most recent sample (ms). */
    last: number;
}
/** Per-instance frame stats. */
interface FrameStats {
    /** Frames recorded since reset. */
    count: number;
    /** Frames/sec from the median inter-frame interval (0 if < 2 frames). */
    fps: number;
    /** Median inter-frame interval (ms). */
    p50: number;
    /** 95th-percentile inter-frame interval (ms) — the stutter tail. */
    p95: number;
    /** Frames whose interval exceeded DROP_FACTOR × running median (VARIANCE). */
    drops: number;
    /** Frames whose interval exceeded SLOW_FRAME_MS (<30fps) — the ABSOLUTE floor.
     *  Catches a uniformly-slow cadence that `drops` misses (every frame equally
     *  slow ⇒ 0 drops but many slowFrames). */
    slowFrames: number;
}
/** A full point-in-time read of the profiler. */
interface PerfSnapshot {
    enabled: boolean;
    /** ms since the profiler was first enabled / last reset. */
    uptimeMs: number;
    sections: Record<string, SectionStats>;
    frames: Record<string, FrameStats>;
    /** Cumulative counters since reset (e.g. `audio.triggers`) — rate = value/uptime. */
    counters: Record<string, number>;
    /** Live gauges — current state (e.g. `viz.p5` mounted instances). NOT cleared
     *  by reset(), because they represent what's live NOW, not accumulated samples. */
    gauges: Record<string, number>;
    longtasks: {
        count: number;
        totalMs: number;
        maxMs: number;
    };
}
declare class Profiler {
    /** Plain field (not a getter) so the hot-path branch is a bare load. */
    private _enabled;
    private startTs;
    private readonly sections;
    private readonly frames;
    private readonly counters;
    /** Live gauges (current-state counts) — survive reset(), unlike counters. */
    private readonly gauges;
    /** Open spans for begin()/end() keyed by label — last-write-wins (a label
     *  isn't expected to nest with itself within a frame). */
    private readonly open;
    private longtaskCount;
    private longtaskTotalMs;
    private longtaskMaxMs;
    private ltObserver;
    get enabled(): boolean;
    /** Turn profiling on/off. Enabling (re)starts the longtask observer and
     *  stamps the uptime origin; disabling tears the observer down so a disabled
     *  profiler has no live platform hook. Idempotent. */
    setEnabled(on: boolean): void;
    private startLongtaskObserver;
    /** Record a section duration directly (ms). Cheap no-op when disabled. */
    record(name: string, ms: number): void;
    /** Open a span. Pair with `end(name)`. No-op when disabled. */
    begin(name: string): void;
    /** Close a span opened by `begin(name)` and record its duration. No-op when
     *  disabled or when no matching open span exists. */
    end(name: string): void;
    /** Time a synchronous function and record it under `name`. Returns the fn's
     *  result. When disabled, calls the fn with no timing overhead. The fn runs
     *  even if disabled (it's the real work, not just measurement). */
    time<T>(name: string, fn: () => T): T;
    /** Record a rendered frame for an instance (e.g. `'p5#3'`). No-op when
     *  disabled. */
    frame(instanceId: string): void;
    /** Forget an instance's frame history (on renderer destroy) so a dead viz
     *  doesn't linger in the snapshot. No-op when disabled. */
    dropFrames(instanceId: string): void;
    /** Add to a CUMULATIVE counter (reset() clears it; rate = value/uptime). */
    inc(name: string, by?: number): void;
    dec(name: string, by?: number): void;
    /** Adjust a LIVE GAUGE (current-state count, e.g. mounted viz instances).
     *  Gauges survive reset() — they reflect what's live now, not samples.
     *  Use +1 on mount, -1 on destroy. */
    gauge(name: string, delta: number): void;
    snapshot(): PerfSnapshot;
    /** Clear all samples/counters but keep the enabled state + observer. Use to
     *  start a clean measurement window (e.g. before driving a heavy patch). */
    reset(): void;
}
/** The process-wide profiler singleton. Import and call directly:
 *  `perf.frame('hydra#1')`, `perf.time('hydra.draw', () => hydra.tick())`. */
declare const perf: Profiler;

interface SplitPaneProps {
    direction: 'horizontal' | 'vertical';
    children: React__default.ReactNode[];
    /** Initial sizes as percentages (must sum to 100). Defaults to equal splits. */
    initialSizes?: number[];
    /** Minimum size in pixels for each pane. */
    minSize?: number;
}
/**
 * Zero-dependency resizable split pane. Supports N children with
 * draggable dividers between each pair.
 */
declare function SplitPane({ direction, children, initialSizes, minSize, }: SplitPaneProps): react_jsx_runtime.JSX.Element;

/**
 * Bundled p5 viz source code — single source of truth.
 *
 * These strings power both:
 *   - `DEFAULT_VIZ_DESCRIPTORS` (the viz picker / demo / standalone
 *     embedders), compiled via `compileP5Code`.
 *   - The bundled `preset/viz/*.p5` workspace files seeded by the app
 *     template, which re-export these constants for backwards-compat.
 *
 * Until #184 (PR retiring the 7 TS sketch classes that previously powered
 * the picker), the picker rendered a different — richer or poorer — copy
 * of each viz than what users edited in the preset file. PV56 demands the
 * picker code path === the preset file code path; this module is that path.
 */
declare const PIANOROLL_P5_CODE = "// Stave p5 viz \u2014 Piano Roll\n// stave.scheduler, stave.analyser, stave.hapStream, stave.options are injected\n// globals. Fold-by-pitch lanes: each distinct pitch (or unpitched sound) gets\n// its own lane, sorted low\u2192high, so notes never overlap and the melodic\n// contour reads as a staircase. Notes scroll across a 4-cycle window; the\n// playhead sits at the half mark.\n//\n// Honours a subset of @strudel/draw's .pianoroll(options) vocabulary via\n// stave.options \u2014 defaults (no options) reproduce Stave's classic look:\n//   cycles, playhead, vertical, labels, flipTime, flipValues, fold,\n//   minMidi, maxMidi, autorange, fill, fillActive, strokeActive,\n//   active, inactive, background, playheadColor.\n\n// Drum/percussion sound-name prefixes for color classification.\nconst DRUM_PREFIXES = ['bd', 'sd', 'hh', 'rim', 'cp', 'cy', 'lt', 'mt', 'ht', 'oh', 'cl']\n\nfunction isDrum(s) {\n  return DRUM_PREFIXES.some(p => s === p || (s.startsWith(p) && /\\d/.test(s[p.length] || '')))\n}\n\n// Note NAME \u2192 MIDI. Returns null for unparseable names (octaveless or\n// sample names) \u2014 the caller folds those onto string lanes instead.\nfunction noteToMidi(n) {\n  if (typeof n === 'number') return Math.round(n)\n  if (typeof n !== 'string') return null\n  const m = n.toLowerCase().match(/^([a-g])(b|#)?(-?\\d+)$/)\n  if (!m) return null\n  const base = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 }[m[1]]\n  const acc = m[2] === 'b' ? -1 : m[2] === '#' ? 1 : 0\n  return (parseInt(m[3]) + 1) * 12 + base + acc\n}\n\n// Fold-grouping key: a MIDI number for pitched haps, a \"_sound\" string for\n// unpitched ones. Priority mirrors how Strudel fills a hap (freq is\n// pre-computed from note, so note(\"c e g\") resolves via freq, never NaN).\nfunction valueOf(h) {\n  if (typeof h.freq === 'number') return Math.round(12 * Math.log2(h.freq / 440) + 69)\n  if (typeof h.note === 'number') return h.note\n  if (typeof h.note === 'string') {\n    const mi = noteToMidi(h.note)\n    return mi !== null ? mi : '_' + h.note\n  }\n  if (h.s) return '_' + h.s\n  return 0\n}\n\n// Default label text for a hap (note name, else sound[:n]).\nfunction labelOf(h) {\n  if (typeof h.note === 'string') return h.note\n  if (typeof h.note === 'number') return String(h.note)\n  if (h.s) return h.s + (h.n != null ? ':' + h.n : '')\n  return ''\n}\n\nfunction parseHex(hex) {\n  const s = String(hex).replace('#', '')\n  if (s.length === 6) return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)]\n  if (s.length === 3) return [parseInt(s[0] + s[0], 16), parseInt(s[1] + s[1], 16), parseInt(s[2] + s[2], 16)]\n  return null\n}\n\n// Explicit hap color wins; else classify by sound family.\nfunction colorOf(h) {\n  if (h.color) { const c = parseHex(h.color); if (c) return c }\n  const s = h.s || ''\n  if (isDrum(s)) return [249, 115, 22]        // drums  \u2014 orange\n  if (s.startsWith('bass')) return [6, 182, 212]   // bass  \u2014 cyan\n  if (s.startsWith('pad')) return [16, 185, 129]   // pad   \u2014 green\n  return [139, 92, 246]                        // melody \u2014 purple\n}\n\nconst num = (v, d) => (typeof v === 'number' && !isNaN(v) ? v : d)\n\nfunction setup() {\n  createCanvas(stave.width, stave.height)\n  noStroke()\n}\n\nfunction draw() {\n  const W = width, H = height\n  const O = (stave.options && typeof stave.options === 'object') ? stave.options : {}\n\n  // \u2500\u2500 options (defaults match @strudel/draw's pianoroll). fold defaults ON\n  // (strudel.cc's real default, __pianoroll fold=1): distinct pitches pack into\n  // CONTIGUOUS adjacent lanes \u2014 no empty rows between non-adjacent semitones.\n  // The landscape note look comes from the wide/short native surface (#214),\n  // NOT from fold:0. fold:0 (opt-in) spaces notes by absolute MIDI, which shows\n  // gaps at the missing semitones (use with autorange for a tight range). \u2500\u2500\n  const CYCLES = num(O.cycles, 4)\n  const PLAYHEAD = num(O.playhead, 0.5)\n  const vertical = !!O.vertical\n  const labels = !!O.labels\n  const flipTime = !!O.flipTime\n  const flipValues = !!O.flipValues\n  const useFold = O.fold == null ? true : !!O.fold\n  const autorange = !!O.autorange\n  const inactiveFilled = O.fill == null ? true : !!O.fill\n  const activeFilled = O.fillActive == null ? true : !!O.fillActive   // Stave default: filled glow\n  const activeStroked = O.strokeActive == null ? true : !!O.strokeActive\n  const activeOverride = typeof O.active === 'string' ? parseHex(O.active) : null\n  const inactiveOverride = typeof O.inactive === 'string' ? parseHex(O.inactive) : null\n  const bg = typeof O.background === 'string' ? parseHex(O.background) : null\n  const playheadCol = typeof O.playheadColor === 'string' ? parseHex(O.playheadColor) : null\n\n  if (bg) background(bg[0], bg[1], bg[2]); else clear()\n\n  const sched = stave.scheduler\n  if (!sched) return\n  let now\n  try { now = sched.now() } catch (e) { return }\n\n  const from = now - CYCLES * PLAYHEAD\n  const to = now + CYCLES * (1 - PLAYHEAD)\n  const ext = to - from\n  let haps\n  try { haps = sched.query(from, to) } catch (e) { haps = [] }\n\n  // Distinct values (for fold lanes / autorange), sorted low\u2192high.\n  const seen = new Set(), vals = []\n  for (const h of haps) { const v = valueOf(h); if (!seen.has(v)) { seen.add(v); vals.push(v) } }\n  vals.sort((a, b) => {\n    if (typeof a === 'number' && typeof b === 'number') return a - b\n    if (typeof a === 'number') return -1\n    if (typeof b === 'number') return 1\n    return String(a).localeCompare(String(b))\n  })\n\n  // Value-axis slotting: fold (one slot per distinct value) OR absolute MIDI\n  // range (minMidi..maxMidi, optionally autoranged from the numeric values).\n  const numericVals = vals.filter(v => typeof v === 'number')\n  let minMidi = num(O.minMidi, 10), maxMidi = num(O.maxMidi, 90)\n  if (autorange && numericVals.length) { minMidi = Math.min(...numericVals); maxMidi = Math.max(...numericVals) }\n  const foldCount = Math.max(1, vals.length)\n  const absExtent = Math.max(1, maxMidi - minMidi + 1)\n  const slotCount = useFold ? foldCount : absExtent\n\n  // slotFromTop: 0 = top of the value axis (high pitch up).\n  const slotFromTop = (h) => {\n    const v = valueOf(h)\n    let s\n    if (useFold) { const lane = vals.indexOf(v); s = lane < 0 ? -1 : foldCount - 1 - lane }\n    else if (typeof v === 'number') s = maxMidi - v\n    else s = absExtent - 1 // unpitched sounds sit at the bottom in absolute mode\n    if (s < 0 || s >= slotCount) return -1\n    return flipValues ? slotCount - 1 - s : s\n  }\n\n  const timeAxis = vertical ? H : W\n  const valueAxis = vertical ? W : H\n  const barSize = valueAxis / slotCount\n\n  noStroke()\n  for (const h of haps) {\n    const sft = slotFromTop(h)\n    if (sft < 0) continue\n    let tp = (h.begin - from) / ext            // 0..1 along the time axis\n    if (flipTime) tp = 1 - tp\n    const tPx = tp * timeAxis\n    const durPx = Math.max(2, ((h.end - h.begin) / ext) * timeAxis)\n    const vPx = (sft / slotCount) * valueAxis\n    const endC = h.endClipped != null ? h.endClipped : h.end\n    const active = h.begin <= now && endC > now\n    const gain = Math.min(1, Math.max(0.1, h.gain == null ? 1 : h.gain))\n    const vel = Math.min(1, Math.max(0.1, h.velocity == null ? 1 : h.velocity))\n    const alpha = gain * vel\n    let col = colorOf(h)\n    if (active && activeOverride) col = activeOverride\n    else if (!active && inactiveOverride) col = inactiveOverride\n    const [r, g, b] = col\n\n    // rect coords \u2014 horizontal: time\u2192x, value\u2192y; vertical: time\u2192y, value\u2192x.\n    const rx = vertical ? vPx : tPx - (flipTime ? durPx : 0)\n    const ry = vertical ? tPx - (flipTime ? 0 : durPx) : vPx\n    const rw = vertical ? barSize : durPx\n    const rh = vertical ? durPx : barSize\n\n    if (active) {\n      if (activeFilled) {\n        // Brightened toward white unless an explicit active color was given.\n        if (activeOverride) fill(r, g, b, alpha * 255)\n        else fill(min(255, r + 60), min(255, g + 60), min(255, b + 60), alpha * 255)\n        rect(rx, ry + 1, rw - 2, rh - 2)\n      }\n      if (activeStroked) {\n        noFill(); stroke(255, 255, 255, 220); strokeWeight(1)\n        rect(rx, ry + 1, rw - 2, rh - 2); noStroke()\n      }\n    } else if (inactiveFilled) {\n      fill(r, g, b, alpha * 180)\n      rect(rx, ry + 1, rw - 2, rh - 2)\n    }\n\n    if (labels) {\n      const txt = labelOf(h)\n      if (txt) {\n        const fs = Math.min(14, Math.max(7, rh * 0.7))\n        noStroke(); fill(active ? 255 : 230); textSize(fs); textAlign(LEFT, TOP)\n        text(txt, rx + 2, ry + 1)\n      }\n    }\n  }\n\n  // Playhead line at the PLAYHEAD mark of the time axis.\n  const phc = playheadCol || [255, 255, 255]\n  stroke(phc[0], phc[1], phc[2], 128); strokeWeight(1)\n  if (vertical) line(0, PLAYHEAD * H, W, PLAYHEAD * H)\n  else line(PLAYHEAD * W, 0, PLAYHEAD * W, H)\n  noStroke()\n}";
declare const SCOPE_P5_CODE = "// Stave p5 viz \u2014 Scope (oscilloscope / event pulses)\n// PERF: one reused buffer (re-alloc only on size change) \u2014 never allocate per draw().\nlet _wave = null\nfunction setup() {\n  createCanvas(stave.width, stave.height)\n  noFill()\n}\nfunction draw() {\n  clear()\n  stroke(40, 50, 70); strokeWeight(0.5)\n  line(0, height * 0.5, width, height * 0.5)\n  if (stave.analyser) {\n    const buf = stave.analyser.frequencyBinCount\n    if (!_wave || _wave.length !== buf) _wave = new Float32Array(buf)\n    const data = _wave\n    stave.analyser.getFloatTimeDomainData(data)\n    let trig = 0\n    for (let i = 1; i < buf; i++) { if (data[i-1] > 0 && data[i] <= 0) { trig = i; break } }\n    stroke('#75baff'); strokeWeight(2); beginShape()\n    for (let i = trig; i < buf; i++) vertex((i - trig) * width / (buf - trig), (0.5 - 0.25 * data[i]) * height)\n    endShape()\n  } else if (stave.scheduler) {\n    const now = stave.scheduler.now()\n    const haps = stave.scheduler.query(now - 4, now + 0.1)\n    noStroke()\n    for (const h of haps) {\n      const age = now - h.begin, decay = max(0, 1 - age / 4)\n      const x = ((h.begin - now + 4) / 4) * width\n      const w = max(3, ((h.end - h.begin) / 4) * width)\n      const pH = height * 0.6 * decay * (h.gain ?? 1)\n      fill(117, 186, 255, decay * 200)\n      rect(x, height * 0.5 - pH / 2, w, pH, 2)\n    }\n  }\n}";
declare const FSCOPE_P5_CODE = "// Stave p5 viz \u2014 Frequency Scope (FFT bars / note bars)\n// PERF: one reused buffer (re-alloc only on size change) \u2014 never allocate per draw().\nlet _freq = null\nfunction setup() {\n  createCanvas(stave.width, stave.height)\n  noStroke()\n}\n// Hz from a hap \u2014 Strudel leaves note as a NAME string and freq null until\n// superdough renders, so parse the note name to MIDI ourselves.\nfunction hapFreq(h) {\n  if (typeof h.freq === 'number') return h.freq\n  let n = h.note\n  if (typeof n === 'string') {\n    const m = n.toLowerCase().match(/^([a-g])(b|#)?(-?\\d+)$/)\n    if (!m) return null\n    const base = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 }[m[1]]\n    n = (parseInt(m[3]) + 1) * 12 + base + (m[2] === 'b' ? -1 : m[2] === '#' ? 1 : 0)\n  }\n  if (typeof n !== 'number') return null\n  return 440 * pow(2, (n - 69) / 12)\n}\nfunction draw() {\n  clear()\n  stroke(40, 50, 70); strokeWeight(0.5); noFill()\n  line(0, height * 0.75, width, height * 0.75); noStroke()\n  if (stave.analyser) {\n    const buf = stave.analyser.frequencyBinCount\n    if (!_freq || _freq.length !== buf) _freq = new Float32Array(buf)\n    const data = _freq\n    stave.analyser.getFloatFrequencyData(data)\n    fill('#75baff')\n    const sw = width / buf\n    for (let i = 0; i < buf; i++) {\n      const n = constrain((data[i] + 100) / 100, 0, 1), v = n * 0.25\n      rect(i * sw, (0.75 - v * 0.5) * height, max(sw, 1), v * height)\n    }\n  } else if (stave.scheduler) {\n    const now = stave.scheduler.now()\n    const haps = stave.scheduler.query(now - 0.2, now + 0.05)\n    const bins = new Float32Array(64)\n    for (const h of haps) {\n      const freq = hapFreq(h)\n      if (freq == null) continue\n      if (freq < 30) continue\n      const idx = constrain(floor(log(freq / 30) / log(4000 / 30) * 64), 0, 63)\n      bins[idx] = max(bins[idx], max(0, 1 - (now - h.begin) / 0.5) * (h.gain ?? 1))\n    }\n    const sw = width / 64\n    for (let i = 0; i < 64; i++) {\n      if (bins[i] <= 0) continue\n      const v = bins[i] * 0.25\n      fill(117, 186, 255, bins[i] * 220)\n      rect(i * sw, (0.75 - v * 0.5) * height, max(sw - 1, 1), v * height)\n    }\n  }\n}";
declare const SPECTRUM_P5_CODE = "// Stave p5 viz \u2014 Spectrum (scrolling waterfall)\n// The waterfall scrolls by reading back the PREVIOUS frame (getImageData \u2192\n// putImageData(-2,0)). That needs the drawing surface to PERSIST across frames \u2014\n// but in the worker the Tier-2 present transferToImageBitmap()s (and CLEARS) the\n// main canvas every frame, so reading the MAIN canvas back yields nothing (#306).\n// Own a persistent OffscreenCanvas buffer (_wf) instead: scroll it (cheap, one\n// column/frame), then blit it to the main canvas each frame. _wf is never\n// transferred, so history accumulates. OffscreenCanvas is native in the worker AND\n// on the main thread, so this renders identically on both (no p5.Graphics, whose\n// HTMLCanvasElement instanceof checks are undefined in the worker shim).\nlet _freq = null\nlet _wf = null, _wctx = null\nfunction _ensureBuf(w, h) {\n  if (_wf && _wf.width === w && _wf.height === h) return\n  const old = _wf\n  _wf = new OffscreenCanvas(max(1, w), max(1, h))\n  _wctx = _wf.getContext('2d')\n  if (old && _wctx) { try { _wctx.drawImage(old, 0, 0) } catch (e) {} }\n}\nfunction setup() {\n  createCanvas(stave.width, stave.height)\n  pixelDensity(1); noStroke()\n  _ensureBuf(width, height)\n}\n// Hz from a hap \u2014 Strudel leaves note as a NAME string and freq null until\n// superdough renders, so parse the note name to MIDI ourselves.\nfunction hapFreq(h) {\n  if (typeof h.freq === 'number') return h.freq\n  let n = h.note\n  if (typeof n === 'string') {\n    const m = n.toLowerCase().match(/^([a-g])(b|#)?(-?\\d+)$/)\n    if (!m) return null\n    const base = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 }[m[1]]\n    n = (parseInt(m[3]) + 1) * 12 + base + (m[2] === 'b' ? -1 : m[2] === '#' ? 1 : 0)\n  }\n  if (typeof n !== 'number') return null\n  return 440 * pow(2, (n - 69) / 12)\n}\nfunction draw() {\n  _ensureBuf(width, height)\n  const ctx = _wctx\n  if (!ctx) { clear(); return }\n  if (stave.analyser) {\n    const buf = stave.analyser.frequencyBinCount\n    if (!_freq || _freq.length !== buf) _freq = new Float32Array(buf)\n    const data = _freq\n    stave.analyser.getFloatFrequencyData(data)\n    const img = ctx.getImageData(0, 0, width, height)\n    ctx.clearRect(0, 0, width, height)\n    ctx.putImageData(img, -2, 0)\n    ctx.fillStyle = '#75baff'\n    for (let i = 0; i < buf; i++) {\n      const n = constrain((data[i] + 80) / 80, 0, 1)\n      if (n <= 0) continue\n      ctx.globalAlpha = n\n      const yEnd = (log(i + 1) / log(buf)) * height\n      const yStart = i > 0 ? (log(i) / log(buf)) * height : 0\n      ctx.fillRect(width - 2, height - yEnd, 2, max(2, yEnd - yStart))\n    }\n    ctx.globalAlpha = 1\n  } else if (stave.scheduler) {\n    const now = stave.scheduler.now()\n    const img = ctx.getImageData(0, 0, width, height)\n    ctx.clearRect(0, 0, width, height)\n    ctx.putImageData(img, -2, 0)\n    const haps = stave.scheduler.query(now - 0.3, now + 0.05)\n    for (const h of haps) {\n      const freq = hapFreq(h)\n      if (freq == null) continue\n      if (freq < 20) continue\n      const logPos = log(freq / 20) / log(4000 / 20)\n      const y = height - logPos * height\n      const alpha = max(0.1, 1 - (now - h.begin) / 0.5) * (h.gain ?? 1)\n      ctx.fillStyle = h.color ?? '#75baff'\n      ctx.globalAlpha = alpha\n      ctx.fillRect(width - 2, y - 2, 2, max(4, height * 0.03))\n    }\n    ctx.globalAlpha = 1\n  } else { ctx.clearRect(0, 0, width, height) }\n  // Present the persistent buffer to the main canvas (which the worker clears\n  // every frame via transferToImageBitmap). drawImage accepts an OffscreenCanvas\n  // source on both the worker and the main-thread 2D context.\n  clear()\n  drawingContext.drawImage(_wf, 0, 0)\n}";
declare const SPIRAL_P5_CODE = "// Stave p5 viz \u2014 Spiral\nfunction setup() {\n  createCanvas(300, 200)\n  pixelDensity(window.devicePixelRatio || 1)\n  noFill()\n}\nfunction xySpiral(rot, margin, cx, cy, rotate) {\n  const a = ((rot + rotate) * 360 - 90) * PI / 180\n  return [cx + cos(a) * margin * rot, cy + sin(a) * margin * rot]\n}\nfunction draw() {\n  clear()\n  if (!stave.scheduler) return\n  const now = stave.scheduler.now()\n  const haps = stave.scheduler.query(now - 2, now + 1)\n  const cx = width / 2, cy = height / 2\n  const sz = min(width, height) * 0.38, mg = sz / 3\n  for (const h of haps) {\n    const active = h.begin <= now && h.end > now\n    const from = h.begin - now + 3, to = h.end - now + 3 - 0.005\n    const op = max(0, 1 - abs((h.begin - now) / 2))\n    const c = color(h.color ?? (active ? '#75baff' : '#8a919966'))\n    c.setAlpha(op * 255)\n    stroke(c); strokeWeight(mg / 2); strokeCap(ROUND)\n    beginShape()\n    for (let a = from; a <= to; a += 1/60) {\n      const [x, y] = xySpiral(a, mg, cx, cy, now)\n      vertex(x, y)\n    }\n    endShape()\n  }\n  stroke(255); strokeWeight(mg / 2)\n  beginShape()\n  for (let a = 2.98; a <= 3; a += 1/60) {\n    const [x, y] = xySpiral(a, mg, cx, cy, now)\n    vertex(x, y)\n  }\n  endShape()\n}";
declare const PITCHWHEEL_P5_CODE = "// Stave p5 viz \u2014 Pitchwheel\nconst ROOT_FREQ = 440 * pow(2, (36 - 69) / 12)\nfunction setup() {\n  createCanvas(300, 200)\n  pixelDensity(window.devicePixelRatio || 1)\n}\nfunction freq2angle(f) { return 0.5 - (log(f / ROOT_FREQ) / log(2) % 1) }\nfunction circPos(cx, cy, r, a) {\n  const rad = a * TWO_PI\n  return [sin(rad) * r + cx, cos(rad) * r + cy]\n}\n// Hz from a hap. Strudel leaves note as a NAME string and freq null until\n// superdough renders, so parse the note name to MIDI ourselves (h.freq is null\n// here \u2014 relying on it leaves every note stuck at the default pitch).\nfunction hapFreq(h) {\n  if (typeof h.freq === 'number') return h.freq\n  let n = h.note\n  if (typeof n === 'string') {\n    const m = n.toLowerCase().match(/^([a-g])(b|#)?(-?\\d+)$/)\n    if (!m) return null\n    const base = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 }[m[1]]\n    n = (parseInt(m[3]) + 1) * 12 + base + (m[2] === 'b' ? -1 : m[2] === '#' ? 1 : 0)\n  }\n  if (typeof n !== 'number') return null\n  return 440 * pow(2, (n - 69) / 12)\n}\nfunction draw() {\n  clear()\n  if (!stave.scheduler) return\n  const now = stave.scheduler.now()\n  let haps = stave.scheduler.query(now - 0.01, now + 0.01)\n  haps = haps.filter(h => h.begin <= now && h.end > now)\n  const sz = min(width, height), r = sz / 2 - 12\n  const cx = width / 2, cy = height / 2\n  noStroke(); fill(117, 186, 255, 64)\n  for (let i = 0; i < 12; i++) {\n    const a = freq2angle(ROOT_FREQ * pow(2, i / 12))\n    const [x, y] = circPos(cx, cy, r, a)\n    circle(x, y, 7)\n  }\n  noFill(); stroke(117, 186, 255, 48); strokeWeight(1)\n  circle(cx, cy, r * 2)\n  for (const h of haps) {\n    const freq = hapFreq(h)\n    if (freq == null) continue\n    const a = freq2angle(freq)\n    const [x, y] = circPos(cx, cy, r, a)\n    const c = h.color ?? '#75baff'\n    stroke(c); strokeWeight(2)\n    line(cx, cy, x, y)\n    fill(c); noStroke()\n    circle(x, y, 12)\n  }\n}";
declare const WORDFALL_P5_CODE = "// Stave p5 viz \u2014 Wordfall (vertical pianoroll with labels)\nfunction setup() {\n  createCanvas(stave.width, stave.height)\n  pixelDensity(window.devicePixelRatio || 1)\n}\nfunction draw() {\n  clear()\n  if (!stave.scheduler) return\n  const now = stave.scheduler.now()\n  const CYCLES = 4, PH = 0.5\n  const haps = stave.scheduler.query(now - CYCLES * PH, now + CYCLES * (1 - PH))\n  const vals = [...new Set(haps.map(h => h.note ?? h.s ?? 0))].sort()\n  if (!vals.length) return\n  const bw = width / vals.length\n  for (const h of haps) {\n    const active = h.begin <= now && h.end > now\n    const dur = h.end - h.begin\n    const yOff = h.begin - now\n    const y = height * PH - (yOff / CYCLES) * height\n    const dH = (dur / CYCLES) * height\n    const v = h.note ?? h.s ?? 0\n    const x = vals.indexOf(v) * bw\n    noStroke()\n    if (active) fill(255)\n    else { const c = color(h.color ?? '#75baff'); c.setAlpha(160); fill(c) }\n    rect(x + 1, y + 1, bw - 2, dH - 2)\n    if (dH > 10 && bw > 16) {\n      const label = h.note != null ? String(h.note) : (h.s ?? '')\n      textSize(min(bw * 0.55, dH * 0.7, 11))\n      textAlign(LEFT, TOP); fill(active ? 0 : 255); noStroke()\n      text(label, x + 3, y + 3)\n    }\n  }\n  stroke(255, 255, 255, 128); strokeWeight(1)\n  line(0, height * PH, width, height * PH)\n}";
declare const SIGNALS_SPECTRUM_P5_CODE = "// Stave p5 viz \u2014 Signals (Spectrum)\n// Showcases the named musical-signal bus. Try it over:  s(\"bd*4 hh*8\")\n//\n// Every signal lives on the 'sig' namespace in p5 \u2014 LIVE NUMBERS / ARRAYS,\n// refreshed every draw():\n//\n//   sig('bd')      \u2014 the 'bd' (kick) sound's live signals (a SignalReading).\n//   sig('bd').fft  \u2014 that sound's spectrum: a number[] of 32 buckets, each 0..1\n//                    (real audio off the kick's OWN analyser/orbit). [] if muted.\n//   sig('bd').rms  \u2014 that sound's loudness 0..1. .bass/.mid/.treble also exist.\n//   sig.kick       \u2014 the kick ENVELOPE, 0..1, bumped on each hit, decaying ~0.92\n//                    per frame. sig.snare / sig.hat / sig.clap / sig.tom \u2026 are siblings.\n//   sig.fft        \u2014 the MASTER mix spectrum (combined audio), same shape.\n//\n// In hydra these same names are () => number THUNKS \u2014 see \"Signals (Bands)\".\n\nfunction setup() {\n  createCanvas(stave.width, stave.height)\n  noStroke()\n}\n\nfunction draw() {\n  clear()\n\n  // \u2500\u2500 Spectrum bars from the kick's own audio: sig('bd').fft is a number[] \u2500\u2500\u2500\u2500\n  // Each bucket is 0..1. We fall back to the master mix (sig.fft) so the demo\n  // still moves before any 'bd' has fired its analyser.\n  const spectrum = (sig('bd').fft.length ? sig('bd').fft : sig.fft) || []\n  const bw = width / Math.max(1, spectrum.length)\n  for (let i = 0; i < spectrum.length; i++) {\n    const v = spectrum[i]            // 0..1 magnitude for this band\n    const h = v * height\n    fill(117, 186, 255, 180 + v * 75)\n    rect(i * bw, height - h, bw - 1, h)\n  }\n\n  // \u2500\u2500 A circle pulsed by sig.kick (a live NUMBER 0..1 in p5) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n  // sig.kick bumps to ~1 on each kick hit and decays each frame, so the circle\n  // punches outward on the beat. (hydra would call it: sig.kick().)\n  const base = min(width, height) * 0.18\n  const r = base + sig.kick * base * 1.6\n  noFill()\n  stroke(255, 255, 255, 120 + sig.kick * 135)\n  strokeWeight(2 + sig.kick * 4)\n  circle(width / 2, height / 2, r * 2)\n\n  // Inner dot brightens with overall loudness (master RMS, a number in p5).\n  noStroke()\n  fill(255, 255, 255, 60 + sig.rms * 195)\n  circle(width / 2, height / 2, base * 0.5)\n}";
declare const SIGNALS_BACKDROP_P5_CODE = "// Stave p5 viz \u2014 Signals (Backdrop)\n// One color band per code block (track). Showcases the per-track side of the\n// bus: sig.tracks enumerates the live track keys, and sig.track(id).color is the\n// color that block declared in the music via .color() (e.g. in Strudel:\n//   $: s(\"bd*4\").color(\"#f97316\")\n//   $: s(\"hh*8\").color(\"#06b6d4\")\n// ). Each band's brightness follows that track's loudness (rms).\n\nfunction setup() {\n  createCanvas(stave.width, stave.height)\n  noStroke()\n}\n\n// Parse a \"#rrggbb\" / \"#rgb\" hap color into [r,g,b]; null if unparseable.\nfunction parseHex(hex) {\n  const s = String(hex).replace('#', '')\n  if (s.length === 6) return [parseInt(s.slice(0,2),16), parseInt(s.slice(2,4),16), parseInt(s.slice(4,6),16)]\n  if (s.length === 3) return [parseInt(s[0]+s[0],16), parseInt(s[1]+s[1],16), parseInt(s[2]+s[2],16)]\n  return null\n}\n\nfunction draw() {\n  clear()\n\n  // sig.tracks \u2014 the live track keys ('$0','$1',\u2026 anonymous, or 'd1','drums'\u2026).\n  const tracks = sig.tracks || []\n  if (!tracks.length) {\n    fill(120); textAlign(CENTER, CENTER); textSize(13)\n    text('play a multi-block pattern\u2026', width / 2, height / 2)\n    return\n  }\n\n  const bandH = height / tracks.length\n  for (let i = 0; i < tracks.length; i++) {\n    const id = tracks[i]\n    const reading = sig.track(id)          // this track's live SignalReading\n    // .color \u2014 the color this block set with .color() in the music. p5: a value\n    // (string|null). Fall back to a neutral blue if the block set none.\n    const rgb = parseHex(reading.color) || [117, 186, 255]\n    // .rms \u2014 this track's loudness 0..1 (own analyser; 0 if silent). Drives the\n    // band's brightness so the active block lights up.\n    const lvl = reading.rms\n    fill(rgb[0], rgb[1], rgb[2], 60 + lvl * 195)\n    rect(0, i * bandH, width, bandH)\n  }\n}";

/**
 * WorkspaceShell — Phase 10.2 Task 04.
 *
 * Generic tab/group/split container. Holds any tab kind (editor or
 * preview), supports drag-drop between groups for either kind, and
 * dispatches rendering by `tab.kind` without knowing the file type. Owns
 * nothing about engines, runtime state, or keyboard shortcuts — those are
 * injected by Task 05 (`runtimeProviders` + `chromeForTab`), resolved by
 * Task 06 (`previewProviderFor`), and added by Task 08 (Cmd+K V/B/W
 * window listeners).
 *
 * @remarks
 * ## Relationship to the legacy `EditorGroup.tsx`
 *
 * The old `packages/editor/src/visualizers/editor/EditorGroup.tsx` bundled
 * tab bar + Monaco + preview layout with four rendering modes (panel,
 * inline, background, popout) encoded as a single state field on the
 * group. This file replaces the tab bar / group chrome / drag-drop logic
 * with a **lifted** implementation — not an import, not a delegation.
 * The old group stays on disk until Task 09 deletes it; until then it
 * owns zero dependencies on this shell, and this shell owns zero
 * dependencies on it. Lifting (rather than delegating) is the
 * non-negotiable constraint because the old group's rendering-mode field
 * is exactly what Phase 10.2 exists to dissolve — importing from it
 * would pull that field back in through the type system.
 *
 * The PV7 acceptance test in `WorkspaceShell.test.tsx` greps this file's
 * source for the legacy mode-field identifier and fails if any occurrence
 * is found. The string stays out of this file intentionally.
 *
 * ## Group state shape
 *
 * The shell owns a `Map<groupId, WorkspaceGroupState>` plus an ordered
 * `groupOrder: string[]` that records the left-to-right layout. Using a
 * Map (rather than an object keyed by id) is a deliberate choice: it
 * makes the ordering explicit via `groupOrder`, keeps lookups O(1) on
 * group id, and prevents the "key collision with builtin prototype"
 * class of bugs that plain-object stores suffer. The two fields are
 * always updated together inside a single `setGroups`/`setGroupOrder`
 * transaction so they can't desync.
 *
 * ## Tab dispatch (PV7)
 *
 * Inside `renderGroup()`, the active tab is looked up and dispatched on
 * `tab.kind` via an exhaustiveness-checked `switch`:
 *
 *   - `'editor'` → `<EditorView .../>`
 *   - `'preview'` → `<PreviewView .../>`
 *   - default → `assertNever(tab)` — a `never`-typed call that makes
 *     TypeScript fail the compile if a new tab kind is added without
 *     a branch here.
 *
 * The `chromeSlot` for the editor comes from `props.chromeForTab?.(tab)`
 * — Task 05 wires it to runtime chrome via the runtime provider registry.
 * Task 04 calls the callback if supplied and passes `undefined` otherwise
 * (viz / markdown editors have no chrome).
 *
 * ## Drag-drop logic (lifted from EditorGroup, sanitized for PV7)
 *
 * HTML5 drag-drop with a custom MIME type `application/workspace-tab`.
 * Payload is `{ sourceGroupId, tabId }` JSON-encoded into the dataTransfer.
 * On drop, the shell:
 *
 *   1. Reads the payload from `dataTransfer.getData`.
 *   2. Finds the source group + tab.
 *   3. Removes the tab from the source group.
 *   4. Appends the tab to the target group's tab list.
 *   5. Marks the target group's active tab = the dropped tab.
 *   6. Fires `onActiveTabChange` if the active tab changed.
 *
 * The source group may become empty after the drop — that's legal. The
 * shell does not auto-collapse empty groups (the user might be about to
 * drop something else into it); the explicit "close group" button handles
 * removal.
 *
 * ## Group split
 *
 * `splitGroup(groupId)` inserts a new empty group immediately after the
 * given group in `groupOrder`. The new group has a freshly generated id
 * and no tabs. `SplitPane`'s size reconciliation handles the new pane
 * sizing.
 *
 * ## Close group
 *
 * `closeGroup(groupId)` merges the closing group's tabs into the next
 * adjacent group (previous if this is the last one). If the shell has
 * only one group, close-group is disabled (the user must close individual
 * tabs instead). The merged tabs append to the neighbor's tab list and
 * the active tab in the neighbor stays unchanged.
 *
 * ## Active tab tracking
 *
 * Each group has its own `activeTabId`. The shell also tracks a single
 * `activeGroupId` — the group the user last interacted with — so that
 * `getActiveTab()` can return the one "shell-wide active tab." Clicking
 * a tab in a different group updates both `activeGroupId` and the group's
 * `activeTabId`; `onActiveTabChange` fires with the resolved tab.
 *
 * ## Theme ownership (PV6 / PK6)
 *
 * `applyTheme(shellRootRef.current, theme)` runs in a `useEffect` keyed
 * on `[theme]`. This is belt-and-suspenders: child `EditorView` /
 * `PreviewView` roots also apply their own theme, so the shell chrome
 * (tab bars, group dividers, split handles) has a themed ancestor even
 * when child views mount late.
 */

/**
 * Imperative handle exposed via `ref` on `WorkspaceShell`.
 *
 * Lets parent components programmatically control tab state without
 * going through the `initialTabs` prop (which is read once on mount).
 * Used by the PM Phase 2.5+ file tree to open/focus a file's tab when
 * the user clicks it in the sidebar.
 */
interface WorkspaceShellHandle {
    /**
     * Open or focus the editor tab for the given file id. If a tab with
     * `kind: 'editor'` and matching `fileId` already exists (in any group),
     * focuses it. Otherwise creates a new editor tab in the currently active
     * group and focuses it. No-op if already focused.
     *
     * When `options.preview` is true, the tab is marked preview — a single
     * preview slot per group is reused across successive preview opens,
     * matching VSCode's single-click-to-preview behaviour. Promotion to a
     * pinned tab happens on double-click or the first content edit.
     */
    openOrFocusFile(fileId: string, options?: {
        preview?: boolean;
    }): void;
    /**
     * Open a read-only history viewer (Diff or time-travel View) as a tab in
     * the main editor area (#210). Reuses a single italic preview slot per
     * the active group: a subsequent call replaces that slot's content
     * instead of stacking tabs; double-clicking the tab promotes it to a
     * pinned tab (same UX as opening a file in preview). Replaces the old
     * cramped sidebar overlay.
     */
    openHistoryTab(req: {
        mode: 'diff' | 'view';
        commitId: string;
        fileId: string;
        /** Diff: open in "vs current" (live ↔ commit) by default (#211). */
        vsCurrent?: boolean;
        /** Diff: file-picker scope override (the dirty set) (#211). */
        pickerFileIds?: readonly string[];
    }): void;
    /**
     * Promote the given tab out of preview mode — it becomes pinned and
     * stops being eligible for replacement by the next preview open. No-op
     * if the tab doesn't exist or was already pinned.
     */
    promoteTab(tabId: string): void;
    /**
     * Close every tab (editor + preview) that targets the given file id,
     * in any group. Used when a file is deleted from the sidebar so its
     * orphan tabs vanish without remounting the shell. No-op if no tabs
     * reference the file.
     */
    closeTabsForFile(fileId: string): void;
    /**
     * Close every tab in the tab's group EXCEPT the given tab. No-op if
     * the tab doesn't exist.
     */
    closeOtherTabs(tabId: string): void;
    /** Close every tab in the tab's group. */
    closeAllTabsInGroup(tabId: string): void;
    /**
     * Split the currently active group by inserting a new empty group in
     * the given direction (east = right, south = below). Focus stays on
     * the original group; the new group is a drop target for dragged
     * tabs. No-op if there is no active group.
     */
    splitActiveGroup(direction?: 'east' | 'south'): void;
    /**
     * Pin a FILE as the backdrop for a group. Pass `null` to clear.
     * `groupId` defaults to the active group. The pinned file's preview
     * renders behind the active editor and survives tab switches.
     * Called by the file-tree context menu and by `Cmd+K B`.
     */
    setBackgroundFile(fileId: string | null, groupId?: string): void;
    /**
     * Set the TRANSIENT code-override backdrop for a group (#350a). Pass `null`
     * to drop the override so the manual sticky (`setBackgroundFile`) shows again.
     * `groupId` defaults to the active group. Unlike `setBackgroundFile`, this is
     * NOT persisted and does NOT fire `onBackgroundFileChange` — it's the active
     * program's per-eval `.scope()` / `.viz({ backdrop })` declaration, which
     * OVERLAYS the sticky and clears back to it when the code stops declaring one.
     */
    setBackgroundOverride(fileId: string | null, groupId?: string): void;
    /**
     * Read the current backdrop fileId for a group (default: active
     * group). Returns `undefined` when no backdrop is pinned. Useful for
     * UI that needs to render a "Clear" vs "Set" label without
     * subscribing to every shell state change.
     */
    getBackgroundFileId(groupId?: string): string | undefined;
    /**
     * Set/clear a group's per-pane backdrop opacity (#350c). `null` drops the
     * override so the global default applies. `groupId` defaults to the active
     * group. Persisted (survives reload) — it's user intent, not transient
     * code state.
     */
    setBackdropOpacity(opacity: number | null, groupId?: string): void;
    /** Set/clear a group's per-pane backdrop quality (#350c). `null` → global default. */
    setBackdropQuality(quality: BackdropQuality | null, groupId?: string): void;
    /**
     * Read a group's RESOLVED backdrop settings (#350c) — the per-pane override
     * if set, else the global default. `groupId` defaults to the active group.
     * Lets the popover seed its controls without subscribing to shell state.
     */
    getBackdropSettings(groupId?: string): {
        opacity: number;
        quality: BackdropQuality;
    };
    /**
     * Write a sound into the code at the cursor (#820, Asset Library insert).
     * If the cursor sits in a note/roll chunk, sets/replaces its `.sound('x')`
     * (mirrors the Mixer picker); otherwise inserts a fresh `s("x")` at the
     * cursor. No-op when there's no active editor. Detects the chunk fresh from
     * the active editor at call time — it does NOT depend on the Pattern/Mixer
     * panel being open.
     */
    assignSoundToCursor(sound: string): void;
    /** Attach `.viz("name")` to the pattern chunk under the cursor (Asset Library
     *  viz insert). Returns true if it wrote, false when there's no pattern under
     *  the cursor (nothing to attach to) so the caller can guide the user. */
    assignVizToCursor(name: string): boolean;
}
declare const WorkspaceShell: React__default.ForwardRefExoticComponent<WorkspaceShellProps & React__default.RefAttributes<WorkspaceShellHandle>>;

/**
 * EditorView — Phase 10.2 Tasks 03 + 07.
 *
 * Pure Monaco editor view bound to a single workspace file, extended with
 * bus-driven inline view zones, active highlighting, and error diagnostics.
 *
 * ## Task 03 (base)
 *
 * Monaco mount, theme application (PV6/PK6), chrome slot injection, and
 * file store binding via `useWorkspaceFile`.
 *
 * ## Task 07 (wiring)
 *
 * Three bus-driven features layered on top of the Task 03 base:
 *
 * 1. **Inline view zones (D-08):** Subscribes to `workspaceAudioBus` with
 *    `{ kind: 'file', fileId }` — its OWN file's runtime, never `'default'`.
 *    On non-null payload with `inlineViz.vizRequests.size > 0`, calls
 *    `addInlineViewZones(editor, payload, descriptors)`. On null (runtime
 *    stopped) calls `pause()`, NOT `cleanup()` (PK3). On file content
 *    change calls `cleanup()` (zone line numbers stale).
 *
 * 2. **Active highlighting (S5):** Reads `payload.hapStream` from the same
 *    bus subscription and feeds it to `useHighlighting(editor, hapStream)`.
 *    Clears when payload goes null.
 *
 * 3. **Eval error diagnostics (S7):** Accepts an `error?: Error | null` prop.
 *    When error transitions from null to Error, calls `setEvalError`. When
 *    it transitions to null, calls `clearEvalErrors`. The parent (compat
 *    shim or shell integration) manages the runtime's `onError` subscription.
 */

declare function EditorView({ fileId, theme, chromeSlot, onMount, error, onPlay, onStop, onEditViz, onCropViz, }: EditorViewProps): React__default.ReactElement;

interface ErrorBoundaryProps {
    children: React__default.ReactNode;
    fallback?: (error: Error, reset: () => void) => React__default.ReactNode;
    onError?: (error: Error, info: React__default.ErrorInfo) => void;
    /**
     * When this key changes, the boundary resets. Use the tab id so
     * switching tabs (or reloading a file) clears a prior crash state.
     */
    resetKey?: string | number;
}
interface ErrorBoundaryState {
    error: Error | null;
}
/**
 * Narrow React error boundary. Wraps editor/preview subtrees so a throw
 * inside Monaco (e.g. `Illegal value for lineNumber` from a bad stack
 * trace — hetvabhasa P37) tears down only the crashing pane, not the
 * surrounding shell (status bar, activity bar, Console panel).
 */
declare class ErrorBoundary extends React__default.Component<ErrorBoundaryProps, ErrorBoundaryState> {
    state: ErrorBoundaryState;
    static getDerivedStateFromError(error: Error): ErrorBoundaryState;
    componentDidCatch(error: Error, info: React__default.ErrorInfo): void;
    componentDidUpdate(prev: ErrorBoundaryProps): void;
    private reset;
    render(): React__default.ReactNode;
}

/**
 * PreviewView — Phase 10.2 Task 03.
 *
 * Hosts a `PreviewProvider`'s rendered output for a single workspace file.
 * Owns:
 *
 *   1. Theme application on its DOM root (PV6 / PK6).
 *   2. Bus subscription via `props.sourceRef`, stored as local state.
 *   3. React-key-driven re-mount of the provider output on publisher
 *      identity change (CONTEXT D-01 — subscribe + re-mount).
 *   4. Hot-reload debounce per `provider.reload` / `provider.debounceMs`
 *      (CONTEXT D-07).
 *   5. Hidden-tab pause semantics (CONTEXT D-03) — `keepRunningWhenHidden`
 *      providers keep getting renders; others freeze the debounce and
 *      see `hidden: true` in their context; un-hiding triggers one
 *      catch-up reload so content changes that arrived while hidden are
 *      not lost.
 *   6. Source selector chrome (audio source dropdown).
 *
 * Does NOT own:
 *
 *   - Provider creation or registry lookup (Task 06).
 *   - Popout window bridging (existing `usePopoutPreview` handles that).
 *   - Error boundaries around `provider.render` (Task 06 adds them when
 *     the concrete providers ship and can throw meaningfully).
 *   - Tab-level `sourceRef` state (shell owns it in Task 04; this view is
 *     controlled).
 *
 * @remarks
 * ## Why re-mount on publisher identity change (D-01)
 *
 * A viz renderer typically captures the `AnalyserNode` on mount and reads
 * from it per frame. If the publisher changes while the renderer is
 * alive, the renderer is still holding the OLD analyser node reference
 * even after we update state with the new payload. The cleanest way to
 * force a fresh `analyser` capture is to unmount-and-remount the
 * renderer. We do this with a React `key` that includes the current
 * publisher's source id (or `'none'` when null). When the id changes,
 * React tears down the subtree and mounts a fresh one — the provider's
 * `render` is called again with the new `audioSource`, and any effects
 * inside its returned tree capture the new analyser on their own mount.
 *
 * The pre-mortem in PLAN.md §10.2-03 flags this as the most likely
 * secondary failure. The test case `switching sources re-mounts the
 * provider output` guards against regressions.
 *
 * ## Reload policy dispatch (D-07)
 *
 * Three modes:
 *   - `'instant'` — every file content change increments the reload
 *     counter synchronously. No timers.
 *   - `'debounced'` — a timer is (re)started on every content change.
 *     When it fires, the reload counter increments. Rapid typing
 *     collapses into a single reload after `debounceMs` of quiescence.
 *   - `'manual'` — file content changes do nothing. The provider is on
 *     its own to re-render (e.g., by keeping internal state).
 *
 * The reload counter is used as part of the React `key` on the provider
 * output, so every increment forces a full unmount/remount. This matches
 * the publisher-identity re-mount pattern — one mechanism, two triggers.
 *
 * ## Hidden-tab pause (D-03)
 *
 * `provider.keepRunningWhenHidden === false` means "do not burn frames
 * on an invisible canvas." When `props.hidden === true` AND the provider
 * opted out of background running, we:
 *
 *   1. Pass `hidden: true` to the provider's `render` context — the
 *      provider's returned component can check this and pause its RAF
 *      loop.
 *   2. Skip the reload counter bump on content change (the debounce
 *      timer is still cleared on every change, it just never fires
 *      a visible reload).
 *   3. On un-hide, trigger ONE reload to pick up any content changes
 *      that arrived during the hidden period. The `catchUpNeededRef`
 *      tracks whether any content changes were missed.
 *
 * Providers with `keepRunningWhenHidden === true` never see `hidden:
 * true` — the host always passes `false` for them, so the provider's
 * behavior is unchanged regardless of `props.hidden`.
 *
 * ## Demo mode (P7)
 *
 * When `sourceRef.kind === 'none'` OR the bus has no matching publisher,
 * `audioSource` is `null`. PreviewView deliberately DOES NOT render a
 * "no data" placeholder — the provider is responsible for demo-mode
 * fallback content (per CONTEXT P7). PreviewView DOES show a small badge
 * in the chrome area so the user understands why the canvas looks
 * different.
 *
 * ## Source selector chrome
 *
 * Reads `workspaceAudioBus.listSources()` on EVERY open of the selector
 * (not cached in state) per CONTEXT pre-mortem #6 — stale cached
 * entries would desync from actual publishers as they start/stop. A
 * simple `<select>` element serves as the minimal chrome for Task 03;
 * Task 04 / Task 05 may dress it up further.
 */

declare function PreviewView({ fileId, provider, sourceRef, onSourceRefChange, theme, hidden, paused, }: PreviewViewProps): React__default.ReactElement;

/**
 * WorkspaceFile store — Yjs-backed (PM Phase 1).
 *
 * Replaces the Phase 10.2 in-memory Map with a Yjs Y.Doc backing.
 * The public API is IDENTICAL to the original:
 *
 *   createWorkspaceFile, getFile, setContent, subscribe
 *
 * plus a new `seedWorkspaceFile` for persistence-aware create-or-load.
 *
 * ## How persistence works
 *
 * Each file is a Y.Map inside the doc's top-level "files" Y.Map.
 * Content is stored as Y.Text (ready for Phase 3 multiplayer).
 * A cached `WorkspaceFile` snapshot is maintained per file for
 * reference-stability (required by useSyncExternalStore).
 *
 * Two init modes:
 * - Real app: call `initProjectDoc(id)` (async, IDB-backed) BEFORE
 *   mounting components. Files loaded from IDB are available after.
 * - Tests: no init needed — the store lazy-inits an in-memory Y.Doc
 *   on first access via `ensureDoc()`.
 *
 * ## Snapshot identity contract (unchanged from Phase 10.2)
 *
 * `getFile(id) === getFile(id)` — unless content changed in between.
 * Achieved by caching snapshots and only rebuilding on Y.Text changes.
 */

type Subscriber$1 = () => void;
/**
 * Create a new WorkspaceFile. Always overwrites if the file already exists.
 * Safe to call multiple times for the same id.
 *
 * For persistence-aware "create only if not in IDB" semantics, use
 * `seedWorkspaceFile` instead (LiveCodingEditor uses that).
 */
declare function createWorkspaceFile(id: string, path: string, content: string, language: WorkspaceLanguage, meta?: Record<string, unknown>): WorkspaceFile;
/**
 * Persistence-aware create-or-load. If the file already exists in the
 * Y.Doc (loaded from IDB), returns the persisted version without
 * overwriting. If the file does not exist, creates it with the given
 * seed content.
 *
 * Use this from components that seed files on mount (LiveCodingEditor,
 * WorkspaceShell) to avoid overwriting persisted user work on refresh.
 */
declare function seedWorkspaceFile(id: string, path: string, content: string, language: WorkspaceLanguage, meta?: Record<string, unknown>): WorkspaceFile;
/**
 * Return the current snapshot for a file id, or `undefined` if the id
 * is not registered. Reference-stable across calls.
 */
declare function getFile(id: string): WorkspaceFile | undefined;
/**
 * Replace the content of a file. Writing to an unknown id is a no-op.
 */
declare function setContent(id: string, newContent: string): void;
/**
 * Register a subscriber for a specific file id. Returns unsubscribe fn.
 */
declare function subscribe(id: string, cb: Subscriber$1): () => void;
/**
 * Register a subscriber for file-list-level changes (file added, deleted,
 * or renamed). Fires after the change is committed to the Y.Doc.
 */
declare function subscribeToFileList(cb: Subscriber$1): () => void;
/**
 * Return all workspace files as a list. Snapshots are reference-stable
 * so this return value is suitable for useSyncExternalStore.
 */
declare function listWorkspaceFiles(): WorkspaceFile[];
/**
 * Delete a file from the Y.Doc. No-op if the id doesn't exist.
 */
declare function deleteWorkspaceFile(id: string): void;
/**
 * Rename a file's path. The file id stays the same — only the path field
 * is updated. This is how files move between folders (e.g., "foo.strudel"
 * → "sketches/foo.strudel"). No-op if the id doesn't exist.
 */
declare function renameWorkspaceFile(id: string, newPath: string): void;
/**
 * Return the explicit file-id order for a folder, or an empty array if
 * none is set (callers should fall back to alphabetical). The root is
 * addressed as the empty string `""`.
 */
declare function getFolderOrder(folderPath: string): string[];
/**
 * Replace the ordered file-id list for a folder. Missing file ids are
 * ignored at render time (tree builder filters to files that actually
 * belong to the folder). Empty array clears the explicit order.
 */
declare function setFolderOrder(folderPath: string, orderedIds: string[]): void;
/**
 * Subscribe to folder-order changes (both files and subfolders).
 * Fires after any reorder commits.
 */
declare function subscribeToFolderOrder(cb: Subscriber$1): () => void;
/**
 * Return the explicit subfolder-name order for a parent folder, or an
 * empty array if none is set. Names are relative (immediate children),
 * not full paths. Root = "".
 */
declare function getSubfolderOrder(parentPath: string): string[];
/**
 * Replace the ordered subfolder-name list for a parent folder. Names
 * that no longer correspond to a real subfolder are filtered out at
 * render time.
 */
declare function setSubfolderOrder(parentPath: string, orderedNames: string[]): void;
/**
 * Return the explicit mixed child order for a folder, or an empty array
 * if none is set. Each entry is `"d:folderName"` or `"f:fileId"`. When
 * present, this overrides the separate fileOrder + subfolderOrder for
 * rendering purposes — items appear in exactly this order (folders and
 * files interleaved).
 */
declare function getChildOrder(parentPath: string): string[];
/**
 * Replace the mixed child order for a folder. Entries are `"d:name"` for
 * folders and `"f:id"` for files. Empty array clears (reverts to
 * folders-first fallback).
 */
declare function setChildOrder(parentPath: string, entries: string[]): void;
declare function getZoneCropOverride(fileId: string, trackKey: string): {
    x: number;
    y: number;
    w: number;
    h: number;
} | undefined;
/**
 * Set the crop override for one (fileId, trackKey) pair. Pass `null` to
 * remove the override (revert to preset default). Triggers subscribers.
 */
declare function setZoneCropOverride(fileId: string, trackKey: string, cropRegion: {
    x: number;
    y: number;
    w: number;
    h: number;
} | null, vizId?: string, contentHash?: string): void;
declare function getZoneHeightOverride(fileId: string, trackKey: string): number | undefined;
/**
 * Set the drag-to-resize height override for one (fileId, trackKey) pair.
 *
 * `vizId` is stamped for the same reason `setZoneCropOverride` stamps it
 * (#1433): a height chosen for one viz's aspect ratio is meaningless for
 * another, and `pruneZoneOverrides` drops an override whose `vizId` no longer
 * matches. Without it a height survived `.viz("A")` → `.viz("B")` and the zone
 * stayed at A's size until the user nudged it — a 400×400 viz sitting at the
 * 600px clamp, switched to a 1100×200 one, left 410px of empty space under the
 * canvas with the resize bar floating at the bottom of it.
 *
 * `contentHash` cannot cover this on its own. It is the block's first ~120
 * characters, so a `.viz()` call past that window changes the viz without
 * changing the hash. And because height and crop share ONE `ZoneOverride`
 * record per `trackKey`, an unstamped height was pruned correctly only by
 * accident — when the user happened to have cropped the same zone too.
 */
declare function setZoneHeightOverride(fileId: string, trackKey: string, heightPx: number | null, contentHash?: string, vizId?: string): void;
/**
 * Prune stale zone overrides. Called on every evaluate — removes overrides
 * whose trackKey is no longer in the current `vizRequests` or whose vizId
 * has changed (crop picked for one viz's aspect is meaningless for another).
 *
 * `currentViz` maps trackKey → vizId for every $: block with a .viz() in
 * the latest evaluate result (same Map shape as `inlineViz.vizRequests`
 * but values are just the vizId string, not the full {vizId, afterLine}).
 */
declare function pruneZoneOverrides(fileId: string, currentViz: Map<string, {
    vizId: string;
    contentHash?: string;
}>): void;
/**
 * Subscribe to ANY zone-override change within a file. Fires after each
 * committed mutation.
 */
declare function subscribeToZoneOverrides(fileId: string, cb: Subscriber$1): () => void;
/**
 * Phase 20-12 D-01/D-02 — per-track UI metadata persisted in the file's PM
 * Yjs doc. Mirrors ZoneOverride shape; one record per trackId.
 *  - `color`: user-picked from TRACK_PALETTE_32 (overrides paletteForTrack auto)
 *  - `collapsed`: chevron state (default = expanded; users notice collapse by absence)
 */
interface TrackMeta {
    color?: string;
    collapsed?: boolean;
}
declare function getTrackMeta(fileId: string, trackId: string): TrackMeta;
/**
 * Read ALL of a file's per-track metadata as a ref-stable plain Map (Phase D,
 * #581). Both Phase-D consumers need every override at once: the Mixer colours N
 * strips per render and the Song Timeline builds its whole scene in one pass, so a
 * per-track `getTrackMeta` lookup per row is the wrong shape — they want one map
 * keyed by the track's DISPLAY NAME (the same key both views resolve to).
 *
 * The returned Map is CACHED and only rebuilt after a committed mutation (the
 * observer drops the cache entry), so repeated reads return the SAME reference —
 * `useTrackMetaMap`'s `useSyncExternalStore` contract. Read-only path: never
 * mutates the doc (safe during render). Absent map / map-less file → the shared
 * frozen-empty map.
 */
declare function getTrackMetaMapSnapshot(fileId: string): ReadonlyMap<string, TrackMeta>;
/**
 * Set per-track metadata. Merge-patch semantics: the partial shallow-merges
 * onto the existing record. When BOTH fields end up undefined the key is
 * deleted (cleanup keeps the Y.Map small for files where the user toggles
 * back to default state).
 */
declare function setTrackMeta(fileId: string, trackId: string, partial: Partial<TrackMeta>): void;
/**
 * Subscribe to ANY trackMeta change within a file. Fires after each committed
 * mutation. Returns an unsubscribe.
 *
 * Uses the read-only `getTrackMetaMap` for observer wiring — `subscribe` is
 * called from React `useEffect` AND `useSyncExternalStore.subscribe`, both
 * of which can race with first render. If the map doesn't exist yet, the
 * subscriber is still registered; when `setTrackMeta` later creates the
 * map, the observer wires at that point and back-fires to all existing
 * subscribers via the trackMetaSubscribers set.
 */
declare function subscribeToTrackMeta(fileId: string, cb: Subscriber$1): () => void;
declare function resetFileStore(): void;

/**
 * useTrackMetaMap — Phase D (#581).
 *
 * React hook surfacing ALL of a file's per-track UI metadata (custom palette
 * swatch + chevron collapsed state) from the per-file PM Yjs doc, as a ref-stable
 * map. Mirrors useWorkspaceFile's useSyncExternalStore pattern.
 *
 * (#588: the original per-track `useTrackMeta` hook — α-3 — was removed; it had no
 * call sites. Every view that paints overrides reads the whole map at once via
 * this hook, so the single-track surface was dead.)
 */

/**
 * useTrackMetaMap — ALL of a file's per-track metadata as a ref-stable map keyed
 * by trackId (the track's DISPLAY NAME, the key both the Mixer and the Song
 * Timeline resolve to). A view that paints many tracks at once (the Mixer strip
 * row, the Timeline scene) reads every custom-colour override in a single
 * reactive subscription rather than N hooks.
 *
 * Backed by `getTrackMetaMapSnapshot` (cached, ref-stable) + `subscribeToTrackMeta`,
 * so the returned map identity changes ONLY when an override is set/cleared — which
 * is exactly the signal a `useMemo`/scene rebuild wants. Returns the shared empty
 * map when `fileId` is undefined (no snapshot yet) — the setter on the per-track
 * hook still no-ops there.
 */
declare function useTrackMetaMap(fileId: string | undefined): ReadonlyMap<string, TrackMeta>;

/**
 * projectDoc — PM Phase 1 (local persistence).
 *
 * Manages the active Yjs document that backs the WorkspaceFile store.
 * Each project is a single Y.Doc persisted to IndexedDB via y-indexeddb.
 *
 * Two init paths:
 * - `initProjectDoc(id)` — async, wires y-indexeddb, awaits IDB sync.
 *   Used by the real app. Files loaded from IDB are available after resolve.
 * - `initProjectDocSync()` — sync, in-memory only, no IDB.
 *   Used by tests and as a lazy fallback if no explicit init was called.
 *
 * The store (WorkspaceFile.ts) calls `ensureDoc()` which lazy-inits
 * in-memory if no explicit init happened — making tests work without
 * any async ceremony while the real app gets persistence.
 */

/** Default budget for the IndexedDB initial sync before we degrade to memory. */
declare const IDB_SYNC_TIMEOUT_MS = 8000;
/**
 * Outcome of {@link initProjectDoc}. `persisted` is true when the Y.Doc was
 * hydrated from IndexedDB; false when we fell back to an in-memory doc because
 * the IDB open timed out or failed. The app uses this to decide whether to
 * warn the user that their edits won't persist this session.
 */
interface ProjectDocInitResult {
    persisted: boolean;
    reason?: 'timeout' | 'error';
}
/**
 * Async init with IndexedDB persistence. Resolves after IDB sync
 * completes — all persisted files are in the Y.Doc when this returns.
 *
 * Must be called BEFORE any createWorkspaceFile / seedWorkspaceFile
 * calls to avoid the seed-vs-persisted race condition.
 *
 * Bounded by `timeoutMs`: y-indexeddb's `whenSynced` only resolves on a
 * SUCCESSFUL open and never settles when `indexedDB.open` is blocked (another
 * tab holding an older DB version), rejected (private-browsing), or corrupted
 * — there is no `.catch` on the open inside y-indexeddb. Without a guard that
 * stuck open hangs the entire app boot forever (the "keeps on loading" bug).
 * On timeout/failure we abandon the dead provider and keep the fresh in-memory
 * Y.Doc so the app boots degraded (no persistence) instead of never at all.
 */
declare function initProjectDoc(projectId: string, opts?: {
    timeoutMs?: number;
}): Promise<ProjectDocInitResult>;
/**
 * Sync init without persistence. Used by tests and as a lazy fallback.
 * The Y.Doc lives only in memory — lost on refresh.
 */
declare function initProjectDocSync(): void;
/** Whether the doc has finished loading from IDB (always true for sync init). */
declare function isDocReady(): boolean;
/** Returns the active project id, or null if none initialized. */
declare function getActiveProjectId(): string | null;
/**
 * Switch to a different project. Destroys the current doc + provider,
 * creates a new Y.Doc for the target project, and awaits IDB sync.
 *
 * Callers MUST also call resetFileStore() (from WorkspaceFile.ts) to
 * clear cached snapshots and re-wire observers before any store reads.
 * initProjectDoc already handles the doc-level cleanup; this function
 * is a convenience alias that also updates the active project id.
 */
declare function switchProject(projectId: string): Promise<ProjectDocInitResult>;
/**
 * Subscribe to ANY update on the active Y.Doc (file content typing,
 * structural file-list changes, folder-order changes, etc). Used by
 * the app's auto-snapshot debouncer. Returns an unsubscribe function.
 *
 * Note: the subscription is bound to whatever Y.Doc is active at
 * registration time. Callers should re-register when the project
 * switches (the old doc gets destroyed).
 */
declare function subscribeToDocUpdate(cb: () => void, options?: {
    localOnly?: boolean;
}): () => void;

/**
 * Kick off loading the Monaco editor core ahead of the first <Editor> mount.
 *
 * `@monaco-editor/react` lazily loads Monaco through its loader only when the
 * first <Editor> renders. That render happens inside the app shell, AFTER the
 * boot preloader clears, so the editor pops in a beat late. Calling this during
 * the preloader window warms Monaco in parallel with the rest of boot, so the
 * core is usually already loaded by the time the editor mounts (#689). Combined
 * with the self-hosted `loader.config` above, the fetch is same-origin (#690).
 *
 * Idempotent + best-effort: the loader is a singleton (repeat `init()` returns
 * the same instance), the result is cached here, and a failed prefetch is
 * swallowed so the editor's own on-mount load can retry. Never throws; the
 * caller should fire-and-forget it (`void warmMonaco()`), never `await` it in a
 * path that gates the UI.
 */
declare function warmMonaco(): Promise<unknown>;

/**
 * Run `fn` inside a single structural transaction so every store
 * mutation it triggers (rename + folder-order updates, etc.) collapses
 * into ONE undo stack item instead of fanning into N items. Nested
 * transacts piggyback on the outer one — callers just call the
 * existing store functions as usual.
 */
declare function withStructBatch<T>(fn: () => T): T;
type Listener$5 = () => void;
/** Call when the active project Y.Doc changes so the undo stack rebuilds. */
declare function resetUndoManager(): void;
declare function undo(): boolean;
declare function redo(): boolean;
declare function canUndo(): boolean;
declare function canRedo(): boolean;
declare function subscribeToUndoState(cb: Listener$5): () => void;

/**
 * purgeLegacyMasterGain — one-time cleanup of the retired master-gain store.
 *
 * Before #794, the master fader wrote a synthetic per-file OUTPUT gain persisted
 * under `stave:mixer.master:<fileId>` (the old `masterStore`). #792/#793 moved
 * the master trim into the document as `all(x => x.gain())`, so that per-file
 * value is now dead — but an OLD project that once set a non-unity master still
 * has the key in localStorage. It's never read anymore, yet leaving it is a
 * latent second gain source if the seam ever came back. Purge it on boot.
 *
 * Pure over the key list (SSR-safe, tolerant of quota/private-mode throws), so
 * it unit-tests without a browser.
 */
/**
 * Remove every persisted `stave:mixer.master:*` value. Idempotent and safe to
 * call on every boot — after the first run there is nothing left to remove.
 * Returns the number of keys purged (for observation/tests).
 */
declare function purgeLegacyMasterGain(storage?: Storage | null): number;

type NoteColorMode = 'off' | 'velocity';
/**
 * The shared note-colour mode + a setter. Both grids call this; a change in one
 * re-renders the other (and persists) via the external store.
 */
declare function useNoteColorMode(): [NoteColorMode, (mode: NoteColorMode) => void];
/** Current note-colour mode — for the Settings modal to seed its control on open. */
declare function getNoteColorMode(): NoteColorMode;
/** Set the mode from outside the grids (the Settings modal). Persists + notifies
 *  every `useNoteColorMode` subscriber → the live grids recolour same-document. */
declare function setNoteColorMode(mode: NoteColorMode): void;
/** Subscribe to mode changes so the Settings modal reflects an external change
 *  while it's open. Returns an unsubscribe. */
declare function subscribeNoteColorMode(listener: () => void): () => void;

/**
 * SnapshotStore — PM Phase 4 (version history, MVP).
 *
 * IDB-backed store for project Y.Doc snapshots. One shared database
 * keyed by `${projectId}:${snapshotId}` — each value is a serialized
 * Y.Doc update (Uint8Array) captured via Y.encodeStateAsUpdate.
 *
 * MVP scope: manual save only, no auto-snapshot. Restore replaces the
 * current doc state by constructing a fresh Y.Doc from the snapshot
 * bytes and transferring its file-map contents into the active doc.
 */
interface SnapshotMeta {
    readonly id: string;
    readonly projectId: string;
    readonly label: string;
    readonly createdAt: number;
    readonly kind?: 'manual' | 'auto';
}
/**
 * Marker prefix for labels of snapshots created by the auto-snapshot
 * debouncer. Matching by this prefix lets the UI distinguish them
 * from manual saves without a separate schema field on older rows.
 */
declare const AUTO_SNAPSHOT_PREFIX = "Auto \u2014 ";
declare function saveSnapshot(projectId: string, label: string, kind?: 'manual' | 'auto'): Promise<SnapshotMeta>;
/**
 * List all snapshots for a project, newest first. Bytes are omitted —
 * callers must call `loadSnapshot` to fetch the payload.
 */
declare function listSnapshots(projectId: string): Promise<SnapshotMeta[]>;
/**
 * Delete a snapshot by id. No-op if the id doesn't exist.
 */
declare function deleteSnapshot(id: string): Promise<void>;
/**
 * Restore a snapshot into the currently active Y.Doc. The snapshot's
 * file set REPLACES the current file set. Implementation: rehydrate a
 * temporary Y.Doc from bytes, then in one transaction on the active
 * doc (a) delete all existing files and (b) recreate each file from
 * the snapshot.
 *
 * Callers must refresh UI state via `resetFileStore()` after this
 * returns so cached snapshots re-sync with the new doc contents.
 */
declare function restoreSnapshot(id: string): Promise<void>;

/**
 * assetNaming — the PURE half of the binary asset store (#1500, decision #1499).
 *
 * Everything here is a function of plain values: no IndexedDB, no `crypto`, no
 * `Date`. That split is not stylistic. `@stave/editor` does not install
 * `fake-indexeddb` and the vitest env (jsdom) has no IndexedDB, so a module that
 * touches storage cannot be unit-tested at all in this package — the established
 * convention is pure logic in vitest, I/O observed in a browser (P80/P81; the
 * `history/` modules were built this way in PR #205).
 *
 * The bugs in an import path live on this side anyway: what a file called
 * `My Take (2).wav` is allowed to become, and what happens when two different
 * files are both called `vocal.wav` — which is not hypothetical, it is what
 * every browser names the file you just downloaded.
 *
 * ## Why names are lowercase
 *
 * Not cosmetic. Superdough resolves a sound by lowercasing the key it was asked
 * for — `getSound` is `soundMap.get()[s.toLowerCase()]`
 * (`superdough/superdough.mjs:165`). A name registered with any uppercase
 * character is therefore registered at an address `s("...")` can never reach.
 * The sanitiser lowercases so a registered name is a reachable one.
 *
 * ## Two identities, on purpose
 *
 * A record carries BOTH a `blobHash` (what the bytes are) and an `id` (which
 * reference in the document this is). #1499 settled the pair: mutable documents
 * get stable minted ids, immutable blobs get content hashes. The consequence
 * that shows up here is that the same bytes imported twice are ONE blob and TWO
 * records — dedup belongs to the bytes, not to the user's intent to reference
 * them twice.
 */
/**
 * A reference to stored bytes, as the project document will carry it.
 *
 * The document wiring itself is the next slice (#1500 scopes it out) — this is
 * the shape that slice will persist, defined here so the naming and dedup
 * decisions that produce it are testable now.
 */
interface AssetRecord {
    /** Stable per-reference id. Minted, never derived from content — #1499. */
    readonly id: string;
    /** The `s("…")` address. Lowercase and unique within the project. */
    readonly name: string;
    /** Content hash of the bytes in the blob store. Shared by duplicates. */
    readonly blobHash: string;
    /** The blob's MIME type as the browser reported it, e.g. `audio/wav`. */
    readonly mime: string;
    /** Decoded length in seconds, when it could be measured. */
    readonly duration?: number;
}
/** The fallback name for a filename with nothing usable left after sanitising. */
declare const FALLBACK_ASSET_NAME = "asset";
/**
 * Strip a filename down to something `s("…")` can address.
 *
 * The extension goes (it is not part of the sound's identity), everything that
 * is not `a-z0-9` collapses to a single `_`, and leading/trailing separators are
 * trimmed. Mirrors `sanitizePresetName`'s shape rather than inventing a second
 * slug dialect.
 *
 *   `My Take (2).wav`   → `my_take_2`
 *   `vocal.wav`         → `vocal`
 *   `.wav`              → `asset`   (nothing left)
 *   `drums.take.1.aiff` → `drums_take_1`
 */
declare function soundNameFromFilename(filename: string): string;
/**
 * Make `base` unique against `taken` by suffixing the smallest free `_N`.
 *
 * The bare name is preferred, so the first `vocal.wav` is `vocal` and a second,
 * DIFFERENT `vocal.wav` becomes `vocal_2`. Counting starts at 2 for that reason:
 * `vocal_1` would imply a `vocal_0` that never exists.
 */
declare function uniqueSoundName(base: string, taken: Iterable<string>): string;
/** What an import is about to do, decided before anything is written. */
interface AssetImportPlan {
    /** The reference to add to the document. */
    readonly record: AssetRecord;
    /**
     * False when some record in `existing` already points at these bytes — i.e.
     * this import adds a second name for one blob.
     *
     * ⚠ This is a statement about the RECORD LIST, not about the blob store.
     * "Are these bytes already stored?" is a different question with a different
     * owner: IndexedDB, answered by `putAsset`. The two can legitimately
     * disagree (bytes present with no record left pointing at them), so neither
     * is derived from the other and neither is a proxy for the other.
     */
    readonly isFirstReference: boolean;
}
/** The measured facts about an incoming file, before it becomes a record. */
interface AssetImportInput {
    /** Content hash of the bytes — the blob store's key. */
    readonly blobHash: string;
    /** The name the user's file had. */
    readonly filename: string;
    /** The blob's reported MIME type. */
    readonly mime: string;
    /** Decoded length in seconds, when it could be measured. */
    readonly duration?: number;
}
/**
 * Decide the record and the write for one incoming file.
 *
 * `existing` is every record the project already holds — it supplies both the
 * taken names and the known hashes, which is why they are not two arguments.
 * `mintId` is injected rather than calling `crypto.randomUUID()` inside, so the
 * plan is deterministic under test; the production caller passes exactly that
 * (matching `projectRegistry` and `snapshotStore`).
 *
 * Re-importing the SAME bytes under the SAME filename still yields a second
 * record (`vocal`, then `vocal_2`) sharing one blob. A record is a reference the
 * user asked for; collapsing it would silently discard an intentional second
 * one. Only the bytes are deduplicated.
 */
declare function planAssetImport(input: AssetImportInput, existing: readonly AssetRecord[], mintId: () => string): AssetImportPlan;

/**
 * assetStore — where a user's bytes live (#1500, Phase 1 of #1352; decision #1499).
 *
 * Four features wanted somewhere to put binary data and none of them owned it
 * (#1499). This is that place: content-addressed blobs in IndexedDB, with the
 * document holding a reference rather than the bytes. Blobs cannot live in a
 * CRDT — a `Y.Text` carrying megabytes of base64 would wreck sync, undo and
 * document size — so the split is bytes here, `AssetRecord` in the doc.
 *
 * This module is the I/O half. Every decision that can be made from plain
 * values lives in `assetNaming.ts` and is unit-tested there; this file is the
 * thin part that cannot be, and is observed in a browser instead
 * (`asset-store-roundtrip.spec.ts`).
 *
 * ## Why the store opens through `openIdbWithTimeout`
 *
 * A raw `indexedDB.open` can hang forever — blocked by another tab's older
 * connection, rejected in private mode, corrupted — and that was the boot hang
 * (#685/#687). Four stores already route through the shared bounded opener; a
 * fifth that opened raw would reintroduce the exact failure the helper exists
 * to bound. Callers of this module catch and degrade, they do not await
 * indefinitely.
 *
 * ## Why object URLs are cached
 *
 * `URL.createObjectURL` mints a handle that pins the blob until it is revoked.
 * The sampler asks for a URL on the path to every note, so minting per call
 * leaks one blob handle per note — the leak grows with playback time, which is
 * the worst shape to discover later. The cache is keyed by content hash, which
 * is also what makes the dedup real: two records naming the same bytes share
 * one URL, not two.
 *
 * ## Why registration goes through `samples()`
 *
 * `samples(sampleMap, baseUrl)` is superdough's documented public entry
 * (`superdough/sampler.mjs:249`). It walks the map through `processSampleMap`
 * (`sampler.mjs:146`) and lands on `registerSampleSource` → `registerSample` →
 * `registerSound` (`sampler.mjs:361`, `:354`, `superdough.mjs:60`), which is a
 * plain write into the `soundMap` store — no audio context required, so an
 * asset can be registered before the engine has ever started.
 *
 * A blob URL survives that path intact: with an empty `baseUrl` the map value
 * is concatenated onto `''` (`sampler.mjs:159`), and playback bottoms out in
 * `loadBuffer` — `fetch(url) → arrayBuffer() → decodeAudioData`
 * (`sampler.mjs:88-104`). Nothing in it parses the URL or infers a format from
 * an extension, which is why a `blob:` URL with no extension decodes normally.
 */

/**
 * The asset database's name, exported so nothing has to keep a second copy.
 *
 * A test harness that wipes the store by literal string is a second owner of
 * this value: rename the database and the wipe silently stops wiping, while
 * every test still passes — on state inherited from the previous one. Observed,
 * not hypothetical — a break test that changed this name left the probe
 * deleting a database that no longer existed.
 */
declare const ASSET_DB_NAME = "stave-assets";
/** A stored blob and what we know about it without decoding. */
interface StoredAsset {
    /** Content hash — the object store's key. */
    readonly hash: string;
    /** The bytes. */
    readonly blob: Blob;
    /** The blob's reported MIME type. */
    readonly mime: string;
    /** `blob.size`, denormalised so `listAssets` need not carry the bytes. */
    readonly size: number;
    /** When these bytes first entered the store. */
    readonly storedAt: number;
}
/** What `listAssets` returns: every stored blob, minus the bytes. */
type StoredAssetMeta = Omit<StoredAsset, 'blob'>;
/** Hashes bytes to a hex string. Injected so the import path is testable. */
type AssetDigest = (bytes: ArrayBuffer) => Promise<string>;
/**
 * SHA-256, hex-encoded — the production digest.
 *
 * `crypto.subtle` needs a secure context, which localhost and https both are.
 * It is async, which is fine here (unlike `ir/nodeIdentity`, which needs a
 * synchronous hash and uses FNV-1a for that reason).
 */
declare const sha256Hex: AssetDigest;
/** What a `putAsset` did. */
interface PutAssetResult {
    /** The content hash the bytes are stored under. */
    readonly hash: string;
    /**
     * Whether the bytes were actually written. False means the store already
     * held them and the write was skipped.
     *
     * This is the store's OWN answer, read from IndexedDB. It is deliberately
     * not derived from — and does not derive — `AssetImportPlan.isFirstReference`,
     * which answers the different question of whether the document already
     * references these bytes.
     */
    readonly written: boolean;
}
/**
 * Store a blob under the hash of its content, deduplicating identical bytes.
 *
 * A second `putAsset` of the same bytes is a no-op rather than a rewrite: the
 * key is the content, so a rewrite could only ever replace the row with an
 * identical one while resetting `storedAt` to a time the bytes did not arrive.
 */
declare function putAsset(blob: Blob, digest?: AssetDigest): Promise<PutAssetResult>;
/** Read bytes back by content hash. `null` when the store has never held them. */
declare function getAsset(hash: string): Promise<Blob | null>;
/**
 * Drop bytes from the store, and any object URL minted for them.
 *
 * Revoking is not optional here: a URL left alive after its row is gone points
 * at bytes nothing can reach through the store, so it becomes the only handle
 * keeping them in memory.
 */
declare function deleteAsset(hash: string): Promise<void>;
/** Every stored blob's metadata, oldest first. The bytes are omitted. */
declare function listAssets(): Promise<StoredAssetMeta[]>;
/**
 * Resolve stored bytes to a URL the audio path can fetch, or `null` if the
 * store does not hold them.
 *
 * This is the seam #1499 asks for: IndexedDB is the first provider, and a
 * cloud one is additive behind the same signature. It addresses bytes by
 * **content hash** rather than by `AssetRecord.id`, for two reasons — the
 * id→hash mapping lives in the project document, whose wiring is the next
 * slice; and the URL cache has to be keyed by content or two records sharing
 * one blob would mint two URLs, undoing the dedup one layer up. A caller
 * holding a record already holds `record.blobHash`, so no lookup is lost.
 */
declare function resolveAsset(blobHash: string): Promise<string | null>;
/** Revoke the object URL for one blob, if any was minted. */
declare function releaseAsset(blobHash: string): void;
/** Revoke every object URL this module minted — e.g. on project close. */
declare function releaseAllAssets(): void;
/** The URL currently cached for a blob, without minting one. For observation. */
declare function peekAssetUrl(blobHash: string): string | null;
/**
 * Make one stored asset addressable as `s(name)`.
 *
 * Returns false when the store cannot produce a URL for the record's bytes,
 * which is a real outcome rather than an error: storage can be evicted by the
 * browser between the document being written and being opened.
 */
declare function registerAsset(record: AssetRecord): Promise<boolean>;
/**
 * Register every asset a project holds. Returns the names that resolved —
 * a record whose bytes are gone is skipped rather than registered at a URL
 * that will 404 on the first note.
 */
declare function registerAssets(records: readonly AssetRecord[]): Promise<string[]>;
/** Injectable edges of {@link importAsset}, so the whole path is observable. */
interface ImportAssetDeps {
    /** Content hash. Defaults to SHA-256. */
    readonly digest?: AssetDigest;
    /** Record id minting. Defaults to `crypto.randomUUID()`, as elsewhere. */
    readonly mintId?: () => string;
    /**
     * Decoded length in seconds, or undefined when it cannot be measured.
     *
     * Injected because decoding needs an `AudioContext`, which this module has
     * no business owning — and because an import whose bytes are not decodable
     * audio must still succeed as a stored blob rather than throw.
     */
    readonly measureDuration?: (blob: Blob) => Promise<number | undefined>;
}
/** What one import produced. */
interface ImportAssetResult extends AssetImportPlan {
    /** The store's own account of the blob write. */
    readonly put: PutAssetResult;
}
/**
 * Take one file all the way in: hash it, store the bytes, and decide the
 * record the project document will carry.
 *
 * `existing` is the project's current records — the source of both the taken
 * names and the known hashes. Persisting the returned record is the caller's
 * job; the document wiring is #1500's next slice.
 */
declare function importAsset(blob: Blob, filename: string, existing?: readonly AssetRecord[], deps?: ImportAssetDeps): Promise<ImportAssetResult>;

/**
 * assetDoc — the project document's memory of its assets (#1502).
 *
 * #1500 gave a byte somewhere durable to live and proved it survives a reload.
 * What it deliberately did not do is give the PROJECT a memory of that byte:
 * `listAssets()` returns hashes, sizes and MIME types, so after a reload
 * nothing knows a blob was ever called `my_take` and `s("my_take")` cannot
 * resolve. This module is that memory — a fifth top-level map on the project
 * Y.Doc beside `files`, `fileOrder`, `subfolderOrder` and `childOrder`.
 *
 * ## The split, restated
 *
 * Bytes are content-addressed and live in IndexedDB (`assetStore`). References
 * are minted, mutable and live in the CRDT (here). Blobs cannot go in a Y.Doc —
 * a `Y.Text` carrying megabytes of base64 would wreck sync, undo and document
 * size — and that constraint is what the whole two-identity design comes from.
 *
 * ## Why records are plain values, not inner `Y.Map`s
 *
 * A record is five small fields that are replaced together, so a rename is one
 * `set` on the outer map and the outer observer fires. Storing each record as
 * an inner `Y.Map` would buy per-field merge granularity nobody needs and cost
 * a real hazard: a write to an inner map does NOT propagate to the outer map's
 * observer, so every mutation site would have to rebuild-and-notify by hand or
 * the module would have to observe every inner map. That trap has been paid for
 * once already, in the file store's rename path.
 *
 * ## Root maps do not write when you ask for them
 *
 * The standing rule is that lazy sub-store allocation must live on write paths,
 * never on read paths — a getter that allocates writes to the doc during React
 * render and lands a `setState` mid-render of another component. That rule is
 * about NESTED maps. A root type is different: `doc.getMap('assets')` creates
 * the type lazily but emits no update until something is put into it, which is
 * why the existing readers call `getMap('fileOrder')` directly and are safe.
 * Stated here so nobody generalises the exemption to nested maps.
 */

type Subscriber = () => void;
/** Subscribe to any change in the project's asset records. */
declare function subscribeToAssets(cb: Subscriber): () => void;
/**
 * Every asset the project references, in insertion order.
 *
 * Read-only: wires the observer (observing an existing map is doc-write-free)
 * but never allocates.
 */
declare function listAssetRecords(): AssetRecord[];
/**
 * Add a reference to the project.
 *
 * ⚠ Must run AFTER `initProjectDoc` has resolved. A write that races the
 * IndexedDB sync is a concurrent `set` on the same key from two clients, and
 * Y.Map settles that by client id — non-deterministically.
 */
declare function addAssetRecord(record: AssetRecord): void;
/** Drop a reference. The BYTES are not touched — they may be shared. */
declare function removeAssetRecord(id: string): void;
/**
 * Rename a reference, returning the name actually taken.
 *
 * This exists before anything calls it, on purpose. A recording has no
 * filename, so a take's default name has to be an opaque positional one and the
 * only honest way to a meaningful name is an explicit user rename — the same
 * reason a track defaults to a bare positional id rather than an inferred
 * label. Shipping the store without a rename path would force the next slice to
 * either auto-derive a descriptive name or leave the user stuck with `take_3`.
 *
 * The requested name is made unique against the project's other assets, so a
 * rename can never produce two records answering to one `s()` address. Returns
 * null when there is no such record.
 */
declare function renameAssetRecord(id: string, name: string): string | null;

/**
 * historyGraph — PURE commit-graph logic for the project file-history store
 * (Phase F, #196).
 *
 * No IndexedDB, no Y.Doc, no Date.now/randomUUID. Every mutating function is
 * pure: it takes a `ProjectHistory`, plus any externally-generated `id` /
 * `createdAt`, and returns a NEW `ProjectHistory`. This keeps the graph logic
 * fully unit-testable with plain objects (the project does not fake IndexedDB
 * in vitest — IDB I/O lives in `historyStore.ts` and is verified by
 * observation; the driver that supplies ids/timestamps lives in
 * `historyDriver.ts`).
 *
 * Model: git-style. Commits store ONLY the files that changed vs their parent
 * (full content per changed file — NOT Yjs deltas, so reconstruction is a
 * parent back-walk with no replay chain). `fileIndex` maps each file to the
 * commits that wrote it, for O(1)-ish per-file history. The current branch's
 * HEAD is the runtime authority.
 *
 * See `.planning/phase-F-history/PLAN.md` and RESEARCH.md for the locked
 * decisions (cadence, retention, commit form).
 */

type CommitKind = 'seed' | 'auto' | 'manual' | 'fork';
/**
 * Per-file structural metadata needed to RECREATE a file on restore (path,
 * language, opaque meta bag). Stored at the history level (latest-wins) rather
 * than per-commit: commits carry only changed CONTENT (for clean diffing), but
 * restoring a deleted file needs its identity. Renames are rare; v1 uses the
 * latest known meta (historical-path restore is a later refinement).
 */
interface FileMeta {
    readonly path: string;
    readonly language: WorkspaceLanguage;
    readonly meta?: Readonly<Record<string, unknown>>;
}
interface OrderSnapshot {
    /** folderPath → ordered child file ids */
    readonly fileOrder: Record<string, readonly string[]>;
    /** parentPath → ordered subfolder names */
    readonly subfolderOrder: Record<string, readonly string[]>;
}
interface Commit {
    readonly id: string;
    /** null only for a seed commit (a branch root). */
    readonly parent: string | null;
    /** the branch this commit was created on. */
    readonly branch: string;
    readonly kind: CommitKind;
    readonly createdAt: number;
    /** present on manual commits (Phase I) and the seed ('Initial'). */
    readonly label?: string;
    /** ONLY files changed vs parent. fileId → full content. */
    readonly files: Readonly<Record<string, string>>;
    /** structural order as of this commit (whole-project restore needs it). */
    readonly order?: OrderSnapshot;
    /**
     * Set by retention pruning: this commit fell outside its display tier but
     * holds the nearest-writer copy of a file some retained commit still reads,
     * so it is kept on the STORAGE chain (back-walk traverses it) but HIDDEN
     * from the display lineage (`listCommits`/`fileHistory` skip it). This is
     * what lets only-changed-files pruning stay correct without a squash pass.
     * See historyRetention.ts + PV61.
     */
    readonly pinned?: boolean;
}
interface BranchRef {
    readonly head: string;
    readonly createdAt: number;
    /** commit this branch forked from; null for the root branch. */
    readonly createdFrom: string | null;
}
interface ProjectHistory {
    readonly projectId: string;
    readonly commits: Readonly<Record<string, Commit>>;
    readonly branches: Readonly<Record<string, BranchRef>>;
    readonly currentBranch: string;
    /** fileId → commit ids that wrote it, oldest-first. */
    readonly fileIndex: Readonly<Record<string, readonly string[]>>;
    /** fileId → latest structural metadata (for restore-recreate). */
    readonly fileMeta: Readonly<Record<string, FileMeta>>;
}
declare function getCommit(h: ProjectHistory, commitId: string): Commit | undefined;
declare function getCurrentBranch(h: ProjectHistory): string;
/**
 * Content of `fileId` as of `commitId` — the nearest writer at-or-before the
 * commit, found by walking parent links. Returns null if the file did not
 * exist at/before that commit. No replay chain.
 */
declare function getFileContentAt(h: ProjectHistory, fileId: string, commitId: string): string | null;
/**
 * Display lineage of a branch (HEAD → root via parent links), newest-first.
 * Skips `pinned` commits — they exist only to hold content for the back-walk
 * (see Commit.pinned), not for display.
 */
declare function listCommits(h: ProjectHistory, branch?: string): Commit[];
declare function listBranches(h: ProjectHistory): Array<{
    name: string;
} & BranchRef>;
/**
 * Commits that wrote `fileId`, newest-first (fileIndex projection). Skips
 * `pinned` commits for display consistency with `listCommits`.
 */
declare function fileHistory(h: ProjectHistory, fileId: string): Commit[];

/**
 * historyService — stateful orchestration for the project commit store
 * (Phase F, #196, Task 6). Combines the pure graph, the workspace bridge, and
 * IDB persistence behind a small imperative API the driver (cadence) and the
 * app (eval trigger, History panel, branch UI) call.
 *
 * Holds the active project's `ProjectHistory` in memory (mirrors projectDoc's
 * single-active-doc model). All ids/timestamps are generated HERE (crypto /
 * Date) and handed to the pure graph, keeping the graph deterministic.
 */

type Listener$4 = () => void;
/** Subscribe to history changes (commit/restore/branch/switch/active-file). Returns unsubscribe. */
declare function subscribeToHistory(cb: Listener$4): () => void;
/** The app sets this on tab focus so File-scope history targets the right file. */
declare function setActiveHistoryFile(fileId: string | null): void;
declare function getActiveHistoryFile(): string | null;
/** Focus the History panel on one file's history (null = project graph). */
declare function setFileHistoryTarget(fileId: string | null): void;
declare function getFileHistoryTarget(): string | null;
/** The in-memory active history (null before init). For UI reads. */
declare function getCurrentHistory(): ProjectHistory | null;
/**
 * Load (or, on first run, seed from the live workspace) the project's history.
 * Migration per RESEARCH Q3: legacy byte-snapshots are ignored — the live
 * workspace IS the newest state, so seed commit c0 from it.
 */
declare function initHistory(projectId: string): Promise<ProjectHistory>;
/** Drop the in-memory state (project switch / teardown) and notify. */
declare function resetHistoryState(): void;
interface CommitWorkspaceOpts {
    /** apply the significance floor (idle path); false for eval/manual/restore. */
    readonly gate?: boolean;
    readonly label?: string;
    /**
     * Commit even when nothing changed since HEAD (label-only anchor). Used by
     * manual checkpoints (#199) so a user can name the current exact state; the
     * auto/eval paths leave this off and keep their no-op-when-unchanged return.
     */
    readonly allowEmpty?: boolean;
    /**
     * Selective-file commit (#211, Tier 1.2 — the index-free analogue of git
     * staging): commit ONLY these file ids, leaving the rest of the working
     * changes uncommitted (captured by a later auto/eval commit). Filters the
     * computed diff to the subset before the empty-check. Absent = today's full
     * working-tree snapshot (auto/eval/restore stay byte-identical).
     */
    readonly only?: ReadonlySet<string>;
}
/**
 * Capture the current workspace state as a commit on the current branch.
 * Returns the new commit id, or null if nothing changed (or the change was
 * below the significance floor when gated). Auto-commits trigger pruning.
 */
/** Locked: capture the workspace as a commit. See {@link commitWorkspace}. */
declare function commitWorkspace(kind: CommitKind, opts?: CommitWorkspaceOpts): Promise<string | null>;
/**
 * Restore the whole project to `commitId`'s state, then record the restore as
 * a new commit on the current branch (non-destructive — the prior state stays
 * in history).
 */
declare function restoreProject(commitId: string): Promise<void>;
/**
 * Restore a single file to its content at `commitId` (or delete it if it did
 * not exist then), then record a new commit. The Phase B (#191) primitive.
 */
declare function restoreFileToCommit(fileId: string, commitId: string): Promise<string | null>;
/**
 * Restore a file to its seed (commit 0) content — the universal "reset to
 * default" (#191): "revert to default" === restore to the seed commit. No-op
 * (null) if there's no active history or no seed. Computes the seed id INSIDE
 * the lock so a project switch can't cross the read/restore boundary.
 */
declare function revertFileToSeed(fileId: string): Promise<string | null>;
/**
 * True if `fileId`'s live workspace content differs from current-branch HEAD.
 * A synchronous read (no mutation/persist → no lock needed) for the Phase D
 * file-tree badge and File-scope restore-button gating (#193). False when
 * there's no history or no HEAD yet.
 */
declare function isFileModifiedSinceHead(fileId: string): boolean;
/**
 * The set of file ids whose live content differs from current-branch HEAD —
 * the whole dirty set in ONE pass (one workspace read + one `changedFiles`),
 * for the file-tree badge (#193). Prefer this over calling
 * `isFileModifiedSinceHead` per file, which re-reads the workspace each call
 * (O(N²) over the tree). Empty when there's no history or no HEAD.
 */
declare function getModifiedFileIdsSinceHead(): ReadonlySet<string>;
/** Create a branch at `fromCommit` (does not switch to it). */
declare function createBranchAt(name: string, fromCommit: string): Promise<void>;
/**
 * Switch the current branch and re-sync the workspace to that branch's HEAD
 * (the new runtime authority).
 */
declare function switchToBranch(name: string): Promise<void>;

/**
 * historyDriver — auto-commit cadence for the project commit store (Phase F,
 * #196, Task 6). Replaces the 60s full-doc auto-snapshot effect that lived in
 * StaveApp (StaveApp.tsx:368-400). Extracted into the editor package so the
 * cadence is wired in one testable place rather than a React effect.
 *
 * Triggers (RESEARCH §1):
 *  - idle: 5s after the last LOCAL doc mutation, significance-gated.
 *  - unload: visibilitychange→hidden / pagehide, significance-gated (narrows
 *    the lost-debounce-window on reload).
 *  - per-eval: NOT here — `onEvaluateSuccess` lives on the runtime instance in
 *    the app, which calls commitWorkspace('auto', {gate:false}) directly.
 *
 * `initHistory(projectId)` must have run before starting the driver.
 */
/**
 * Wire the idle + unload auto-commit triggers. Returns a teardown function.
 * Each fire is significance-gated (idle/unload commit only meaningful change).
 */
declare function startHistoryDriver(): () => void;

/**
 * HistoryPanel — the project commit graph (Version History side panel).
 *
 * A VS Code / GitLens-style source-control graph: PROJECT-level commit history
 * (no per-file mode — that's a separate "File History" action on a file). Each
 * commit row has a branch-lane graph gutter, a kind badge + label + time, and
 * hover-revealed icon actions (Restore / Fork / View). Expanding a commit lists
 * the files it changed; clicking a file opens its diff.
 *
 * Reads the service singleton + re-renders on subscribeToHistory.
 */

/** Request to open a read-only history viewer in the main editor area (#210). */
interface OpenHistoryTabRequest {
    readonly mode: 'diff' | 'view';
    readonly commitId: string;
    readonly fileId: string;
    /** Diff: open in "vs current" (live ↔ commit) by default — the uncommitted diff (#211). */
    readonly vsCurrent?: boolean;
    /** Diff: file-picker scope override (the dirty set) so a file HEAD didn't touch is selectable (#211). */
    readonly pickerFileIds?: readonly string[];
}
interface HistoryPanelProps {
    /**
     * Open a Diff / time-travel View as a tab in the main editor area
     * (wired by the app to `shellRef.openHistoryTab`). Diff/View no longer
     * render as a cramped in-panel overlay (#210).
     */
    readonly onOpenHistoryTab?: (req: OpenHistoryTabRequest) => void;
}
declare function HistoryPanel({ onOpenHistoryTab }?: HistoryPanelProps): React.ReactElement;

type Listener$3 = () => void;
/**
 * Enter time-travel: the runtime reflects `commitId`'s snapshot (read-only).
 * `files` is the whole-project snapshot at that commit (Decision C). Calling
 * again with a different commit swaps the view in place.
 */
declare function enterRuntimeView(commitId: string, files: Record<string, string>): void;
/** Exit time-travel: restore HEAD authority. No-op when not viewing. */
declare function exitRuntimeView(): void;
/**
 * Viewed content for a file, or `null` when not viewing OR the file did not
 * exist at the checked-out commit. Callers fall back to live content on null.
 */
declare function getViewedContent(fileId: string): string | null;
declare function isViewing(): boolean;
declare function getViewedCommit(): string | null;
/** All file ids present in the current view (empty array when not viewing). */
declare function getViewedFileIds(): string[];
/** Subscribe to enter/exit/swap. Returns an unsubscribe fn. */
declare function subscribeToRuntimeView(cb: Listener$3): () => void;

/**
 * ProjectRegistry — PM Phase 2.
 *
 * IDB-backed metadata store for the project list. Each project's actual
 * content lives in a separate y-indexeddb database (one Y.Doc per project).
 * This store only holds the lightweight metadata needed to populate the
 * sidebar without loading any Y.Doc.
 *
 * Follows the same raw IndexedDB pattern as VizPresetStore.
 */
interface ProjectMeta {
    readonly id: string;
    readonly name: string;
    readonly createdAt: number;
    readonly lastOpenedAt: number;
    /**
     * @deprecated LEGACY, READ-ONLY (#1435). The backdrop crop is now stored per
     * viz FILE, app-side, beside the per-tab backdrop file itself
     * (`stave:backdropCrops:${projectId}`) — a crop is cut for one sketch's
     * aspect ratio, so a single project-wide rect rode onto whatever backdrop was
     * pinned next. Nothing writes this field any more; it survives ONLY so a
     * project saved before the move can hand its crop over once, after which
     * `dropLegacyBackgroundCrop` empties the slot. Safe to delete outright once
     * no project in the wild still carries one.
     *
     * (This finishes the sequence that moved the backdrop *file* out: #347 made
     * it per-tab, #371 retired the project-global `backgroundFileId`. The crop
     * was the last neighbour left behind.)
     */
    readonly backgroundCrop?: {
        readonly x: number;
        readonly y: number;
        readonly w: number;
        readonly h: number;
    };
}
/** List all projects, sorted by lastOpenedAt descending (most recent first). */
declare function listProjects(): Promise<ProjectMeta[]>;
/** Get a single project by id, or undefined if not found. */
declare function getProject(id: string): Promise<ProjectMeta | undefined>;
/** Get the most recently opened project, or undefined if none exist. */
declare function getLastOpenedProject(): Promise<ProjectMeta | undefined>;
/** Create a new project and return its metadata. */
declare function createProject(name: string): Promise<ProjectMeta>;
/** Update the lastOpenedAt timestamp. Call when opening a project. */
declare function touchProject(id: string): Promise<void>;
/**
 * Empty the legacy project-global backdrop crop slot (#1435). Called once, by
 * the app, AFTER the stored rect has been carried over to the viz file that was
 * actually wearing it — so the crop is never lost, and never applied a second
 * time to some later backdrop.
 *
 * This is a one-way drain, not a setter: there is no way to put a crop back
 * here, which is the point. No-op when the project is gone or the slot is
 * already empty.
 */
declare function dropLegacyBackgroundCrop(id: string): Promise<void>;
/** Rename a project. */
declare function renameProject(id: string, name: string): Promise<void>;
/**
 * Delete a project's metadata. Also deletes the y-indexeddb database
 * for the project's Y.Doc content.
 */
declare function deleteProject(id: string): Promise<void>;
/**
 * Duplicate a project. Creates a new metadata entry with a new id.
 * NOTE: does NOT duplicate the Y.Doc content — that requires loading
 * the source doc and creating a snapshot. For PM Phase 2, duplicate
 * creates an empty project with the same name + " (copy)". Full
 * content duplication is a Phase 3+ feature.
 */
declare function duplicateProject(id: string): Promise<ProjectMeta | undefined>;
/**
 * Id prefix for the in-memory ephemeral fallback session (boot dropped to
 * "Continue without saving"). Such a session has no registry entry and must
 * never persist one. The prefix is the tag that lets a later boot recognise
 * and prune any rows a background write left behind.
 */
declare const EPHEMERAL_ID_PREFIX = "ephemeral-";
declare function isEphemeralProjectId(id: string): boolean;

/**
 * Ephemeral-session cleanup (#688).
 *
 * When boot falls back to an in-memory ephemeral session ("Continue without
 * saving"), the synthetic project id is `ephemeral-<uuid>` and no registry
 * entry exists. If IndexedDB recovers mid-session (e.g. the blocking tab
 * closes), a background write — an auto-commit/snapshot or a `touchProject` —
 * could leave a phantom row for a project that has no real metadata or doc.
 *
 * The invariant "an ephemeral session never persists" spans three stores
 * (registry, snapshots, history), so cleanup is reconciled in one place rather
 * than gated at every write site (miss one and the phantom returns). On the
 * next successful persistent boot, prune every row tagged with the ephemeral
 * id prefix. Each store prune is bounded (routes through `openIdbWithTimeout`)
 * and independent — `allSettled` so a single blocked store doesn't stop the
 * others, and the whole thing can't hang the boot it fires after.
 */
declare function pruneEphemeralArtifacts(): Promise<void>;

/**
 * sampleSound — test audio source for viz development.
 *
 * A self-contained sawtooth oscillator with an LFO-modulated pitch that
 * feeds an `AnalyserNode`, plus a virtual `PatternScheduler` that
 * returns a repeating 4-note arpeggio synced to the LFO period. The
 * payload is published to the `workspaceAudioBus` under the fixed
 * source id `__sample__` so the user can pick "Sample sound" in a viz
 * tab's source dropdown and see both FFT-reactive shaders AND
 * scheduler-driven sketches (like the default pianoroll) react to a
 * predictable source without needing to play a real pattern first.
 *
 * @remarks
 * ## Design
 *
 * The sample sound is a **singleton** — one shared `AudioContext`,
 * oscillator graph, `AnalyserNode`, and virtual `PatternScheduler`.
 * Multiple viz previews pinning to `__sample__` all see the same FFT
 * data AND the same scheduler, which is what you want for "test the
 * viz with a known-stable audio source."
 *
 * ## Why an LFO-modulated sawtooth, specifically
 *
 * A pure sine at one frequency produces a single FFT spike that
 * doesn't move — the viz looks dead. A sawtooth produces a rich
 * harmonic series (multiple bins lit up), and modulating its frequency
 * with a slow LFO makes those bins shift over time. The result is a
 * visibly animated FFT without needing a complex score.
 *
 * ## Why a 4-note arpeggio for the virtual scheduler
 *
 * The pianoroll default (PIANOROLL_P5_CODE) polls
 * `stave.scheduler.query()` every frame and draws rectangles for the
 * returned events. Without a scheduler payload, the pianoroll shows
 * only the analyser spectrum — no notes. A minimal virtual pattern
 * lets users see their sketch respond to "pattern-like" data while
 * testing.
 *
 * The pattern is a 4-note A-minor arpeggio (A3, C4, E4, G4) with
 * each note holding for 0.5 seconds, cycling every 2 seconds — the
 * same period as the LFO sweep, so the visible note changes
 * roughly coincide with the audible pitch drift.
 *
 * ## Audibility
 *
 * The output routes to `ctx.destination` with a low gain (0.05) so the
 * user can actually HEAR the test audio. Most viz developers want to
 * hear what they're visualizing — muting it would require the user to
 * trust that audio is "there" purely on visual evidence. Setting a
 * low gain keeps it audible without being annoying.
 *
 * ## Lifecycle (user-driven)
 *
 *   - `start()` — lazy-initializes the AudioContext, oscillator graph,
 *     analyser, and scheduler on first call. No-op if already playing.
 *     Must be called from a user gesture (click handler) per browser
 *     autoplay policy.
 *   - `stop()` — disconnects nodes, unpublishes from the bus, closes
 *     the context. Called when the user selects a different source.
 *   - `isPlaying()` — query for UI state.
 *
 * ## Bus payload shape
 *
 * Publishes an `AudioPayload` with:
 *   - `analyser` — live FFT data from the oscillator
 *   - `audio: { analyser, audioCtx }` — nested component shape for
 *     consumers that read from `payload.audio`
 *   - `scheduler` — virtual `PatternScheduler` returning the arpeggio
 *   - `hapStream` — a fresh empty `HapStream`. The sample sound does
 *     NOT emit hap events in the current revision — event-driven
 *     sketches that subscribe via `hapStream.on()` see nothing. The
 *     field is populated for payload-shape completeness only.
 *
 * ## Identity guard interaction (D-01)
 *
 * The bus's identity guard (`payloadsEquivalent` in `WorkspaceAudioBus`)
 * treats same-ref publishes as no-ops. We publish ONCE on `start()`
 * with a stable payload — the live FFT data updates happen inside the
 * analyser node, not via re-publishing. The scheduler's `now()` reads
 * `ctx.currentTime` per call, so consumers get fresh time every frame
 * without needing a re-publish either.
 */

/** Fixed source id the sample sound publishes under on the workspace bus. */
declare const SAMPLE_SOUND_SOURCE_ID = "__sample__";
/** Human-readable label for the audio source dropdown. */
declare const SAMPLE_SOUND_LABEL = "Sample sound (test audio)";
/**
 * Start the sample sound. Lazy-initializes the AudioContext, oscillator
 * graph, and analyser on first call. Publishes a payload to the bus
 * under `SAMPLE_SOUND_SOURCE_ID` so any preview pinned to that id sees
 * live FFT data immediately. Safe to call multiple times — second and
 * later calls are no-ops.
 *
 * MUST be called from inside a user gesture handler. Browsers reject
 * `new AudioContext()` outside of click/touch/keydown handlers under
 * the autoplay policy, so tests and UI code should only invoke this
 * in response to a button press.
 */
declare function startSampleSound(): void;
/**
 * Stop the sample sound. Disconnects the oscillator graph, unpublishes
 * from the bus, and closes the AudioContext. No-op if not running.
 * Consumers pinned to `__sample__` receive `null` on their next bus
 * callback and fall back to demo mode.
 */
declare function stopSampleSound(): void;
/** Query whether the sample sound is currently running. */
declare function isSampleSoundPlaying(): boolean;

/**
 * useWorkspaceFile — Phase 10.2 Task 01.
 *
 * React hook surfacing a `WorkspaceFile` snapshot + its writer from the
 * module-level store. Backed by `useSyncExternalStore` (React 18+) for
 * correct concurrent-mode semantics with zero extra deps.
 *
 * @remarks
 * The `getSnapshot` returned to React is `() => getFile(id)`. Because the
 * store replaces entries instead of mutating them (see WorkspaceFile.ts
 * "Snapshot identity contract"), the reference returned by `getFile` is
 * stable across unrelated changes. React's tearing-detection will not
 * throw, and components that subscribe to a different file id will not
 * re-render when this file changes.
 *
 * The `setContent` callback is bound to the current `id` via `useCallback`
 * so that consumers can pass it as a dep without defeating memoization.
 */

/**
 * The return shape of `useWorkspaceFile`. `file` is `undefined` until a
 * file is registered with `createWorkspaceFile(id, …)` for this id, to let
 * consumers render a loading/fallback state without requiring eager
 * registration.
 */
interface UseWorkspaceFileResult {
    file: WorkspaceFile | undefined;
    setContent: (content: string) => void;
}
declare function useWorkspaceFile(id: string): UseWorkspaceFileResult;

/**
 * WorkspaceAudioBus — Phase 10.2 Task 02.
 *
 * Multi-publisher, consumer-routed audio bus. Pattern runtimes (Strudel,
 * SonicPi, future engines) `publish` their `engine.components` bag under
 * their `WorkspaceFile.id`; viz consumers (HYDRA_VIZ, P5_VIZ, popout
 * windows) `subscribe` with an `AudioSourceRef` selector — `'default'`
 * (follow most recent), `{ kind: 'file', fileId }` (pin), or `'none'`
 * (demo mode). Per CONTEXT D-02 / D-04 / U1.
 *
 * @remarks
 * ## Why a singleton (per CONTEXT U1)
 *
 * The bus is a module-level constant export, mirroring the `VizPresetStore`
 * precedent in `visualizers/vizPreset.ts`. Every `import` resolves to the
 * same instance, no class-per-shell. Multi-shell support (one bus per
 * `WorkspaceShell` instance) is deferred to Phase 11 if it ever arrives —
 * the `WorkspaceAudioBus` interface in `types.ts` documents the contract
 * abstractly so a class-based variant can be slotted in without churning
 * consumers.
 *
 * ## Why a recency LIST, not a single "current default"
 *
 * The pre-mortem (PLAN.md §10.2-02 secondary failure) calls out the easy
 * mistake: tracking the default as a single slot. Then this happens —
 *
 * 1. A publishes → default = A.
 * 2. B publishes → default = B (more recent).
 * 3. B unpublishes → default = null. **Wrong.** A is still publishing.
 *
 * The fix is to keep the recency as an ORDERED ARRAY: push on publish,
 * splice on unpublish. The "current default" is always
 * `recency[recency.length - 1]`, and `null` only when the list is empty.
 * This file's `recency` and `defaultPayload()` implement that contract.
 *
 * ## Why identity equality, not deep equality
 *
 * D-01 specifies "subscribe + re-mount" — the bus delivers ONE callback per
 * publisher identity change, not per audio frame. If the runtime pushes a
 * new payload object every audio tick, deep-equal would walk a non-trivial
 * graph and re-fire spuriously when sub-objects change for unrelated
 * reasons. Instead, we shallow-compare the public component slots
 * (`hapStream`, `analyser`, `scheduler`, `inlineViz`, `audio`). If every
 * slot reference matches, the publish is a no-op — same engine, same
 * audio nodes, no observable change. This keeps the bus out of the
 * per-frame FFT read path; consumers reach into `payload.analyser`
 * directly for that.
 *
 * ## What the bus does NOT own
 *
 * The bus stores `AudioPayload` records that hold REFERENCES to live
 * `AnalyserNode` / `HapStream` / `PatternScheduler` instances created
 * inside engines. The bus never creates, copies, or routes audio. PV3
 * (orbits) and UV6 (observation without mutation) are respected by
 * reference-passing — no audio routing changes happen here.
 *
 * ## Test isolation
 *
 * `__resetWorkspaceAudioBusForTests()` clears every internal collection.
 * Same pattern as `__resetWorkspaceFilesForTests()` from Task 01. Tests
 * call this in `beforeEach`.
 */

/**
 * The workspace audio bus singleton. Imported as a const, never
 * instantiated. Mirrors the `VizPresetStore` const-export precedent in
 * `visualizers/vizPreset.ts`. Multi-shell support is deferred to Phase 11
 * (per CONTEXT U1) and would replace this with a class-per-shell behind
 * the same `WorkspaceAudioBus` interface.
 */
declare const workspaceAudioBus: WorkspaceAudioBus;

/**
 * LiveCodingRuntime — Phase 10.2 Task 05.
 *
 * Per-file runtime that wraps a `LiveCodingEngine` with the workspace audio
 * bus publish/unpublish lifecycle. One runtime per workspace file id; the
 * runtime owns the engine, owns any elevated `BufferedScheduler`, and is
 * responsible for keeping the bus's view of "this file is playing" in sync
 * with the engine's actual state.
 *
 * @remarks
 * ## Why this lives in `workspace/runtime/` and not `engine/`
 *
 * The engine layer (`packages/editor/src/engine/`) defines the
 * `LiveCodingEngine` interface and ships concrete engines (`StrudelEngine`,
 * `SonicPiEngine`, `DemoEngine`). It knows nothing about the workspace,
 * the audio bus, or react. The runtime is the bridge: it lives in the
 * workspace layer because it depends on `workspaceAudioBus`, `WorkspaceFile`
 * snapshot identity, and the workspace concept of a "file id" — but it
 * never reaches into engine internals. The boundary is one-way: workspace
 * imports from engine, never the other way.
 *
 * ## What this file MUST NOT do (PV1, PV2, P1, P2)
 *
 * - It MUST NOT touch `Pattern.prototype`. All Strudel Pattern method
 *   wrappers are installed inside `StrudelEngine.evaluate()`'s `.p` setter
 *   trap. Re-installing them here would either no-op (if installed before
 *   `injectPatternMethods`, which the engine calls during `evaluate`) or
 *   silently break the engine's own wrappers (if installed after, which
 *   would race the engine's restoration in its `finally` block).
 *
 *   This restriction is enforced by a source-grep test in
 *   `__tests__/strudelRuntime.test.tsx` — the assertion fails if any of
 *   `Pattern.prototype` shows up in any runtime/ source file.
 *
 * - It MUST NOT mutate `file.content` before passing to `engine.evaluate`.
 *   Strudel's transpiler reifies string arguments (P1) — the EXACT string
 *   the engine sees is load-bearing. Any "preview validation" or
 *   "sanitization" in this layer breaks `.viz()` reification, mini-notation
 *   parsing, and `setcps()` extraction in unpredictable ways.
 *
 * - It MUST NOT install its own `.viz()` interceptor. The engine already
 *   captures viz requests in `engine.components.inlineViz.vizRequests` after
 *   `evaluate()` resolves; the runtime forwards the captured map through
 *   the bus payload's `inlineViz` slot. Task 07's EditorView reads from
 *   there to materialize Monaco view zones.
 *
 * ## Lifecycle (PK1)
 *
 * The `play()` method is the only nontrivial sequence in this file. The
 * nine-step lifecycle is documented in `LiveCodingRuntime` interface
 * JSDoc in `types.ts`. The two ordering constraints worth restating here:
 *
 *   - **`evaluate` MUST resolve before `engine.components` is read.** The
 *     engine populates `inlineViz.vizRequests` and `queryable.scheduler`
 *     during `evaluate`. Reading `components` mid-`evaluate` returns a
 *     half-baked bag.
 *   - **`bus.publish` MUST happen before `engine.play`.** Subscribers (viz
 *     consumers, the EditorView's inline-zone effect) need the payload in
 *     hand BEFORE the first hap event fires. If we published after
 *     `engine.play()`, the first cycle of audio events would land in a
 *     subscriber that hasn't been wired to a HapStream yet.
 *
 * Between step 4 (`evaluate` resolves) and step 7 (`bus.publish`), there
 * must be no `await`. A microtask boundary at that point would let another
 * `play()` invocation interleave its own evaluate and corrupt the
 * components view we're about to publish. Steps 5 and 6 are pure object
 * construction and synchronous BufferedScheduler instantiation; both are
 * safe.
 *
 * ## BufferedScheduler elevation (S8)
 *
 * Sonic Pi (and any future engine that ships streaming + audio without a
 * native queryable) does not provide a `PatternScheduler` in
 * `engine.components.queryable`. The runtime detects this on every play
 * and lazily constructs a `BufferedScheduler` wrapping the engine's
 * `HapStream` and `AudioContext`. The elevated scheduler is held on
 * `bufferedSchedulerRef` so `dispose()` can release it. On engines that
 * DO ship a native queryable, the elevated ref stays `null` and the
 * native scheduler is forwarded directly through the payload.
 *
 * ## Error semantics (S7)
 *
 * Two error sources flow through the runtime:
 *
 *   1. **Evaluate errors** — `engine.evaluate(code)` returns
 *      `{ error: Error }`. The runtime fires `onError` listeners and
 *      returns the error from `play()`. The bus is NOT touched (no
 *      publish, no unpublish-on-error).
 *   2. **Runtime audio errors** — the engine's
 *      `setRuntimeErrorHandler(cb)` fires AFTER `play()` succeeded, when
 *      a scheduled event hits a sound-not-found or similar runtime
 *      condition. The runtime forwards these to its own `onError`
 *      listeners as well. Audio keeps playing — these are not fatal,
 *      just visible diagnostics.
 *
 * The chrome subscribes to `onError` for the toolbar error badge; Task 07's
 * EditorView subscribes for Monaco squiggle markers via `setEvalError`.
 * Both consume the same event source, no two-way coupling.
 */

/**
 * Subscribe-to-file function shape. Callers supply one if they want the
 * runtime's live mode (`setAutoRefresh(true)`) to actually do anything —
 * otherwise live mode is a no-op (useful in tests that don't want to
 * stand up a full `WorkspaceFile` store).
 *
 * The callback fires on EVERY content change for the runtime's file id,
 * including changes that originate from `play()`'s own `evaluate` call
 * (which does not write back, so this is fine in practice). The returned
 * disposer is called by the runtime when it tears down the subscription.
 */
type SubscribeToRuntimeFile = (cb: () => void) => () => void;
/**
 * Constructor argument shape. Kept as a positional triple rather than an
 * options object because the contract is small and stable: a runtime is
 * defined entirely by its file id, the engine it wraps, and the function
 * that returns the file's current content at evaluate time.
 *
 * @param fileId - The workspace file id this runtime publishes under.
 *   Used both as the bus key and as the address for `dispose()` cleanup.
 * @param engine - The engine instance this runtime wraps. The runtime
 *   takes ownership; the caller MUST NOT dispose this engine independently.
 * @param getFileContent - Closure that returns the current file content
 *   at the moment `play()` is called. Passing a closure (rather than a
 *   string) lets the runtime stay decoupled from `useWorkspaceFile` /
 *   the workspace store — tests can pass a static string, the live
 *   compat shim can pass `() => getFile(fileId)?.content ?? ''`. This
 *   keeps the runtime testable in a plain Node environment.
 */
declare class LiveCodingRuntime implements LiveCodingRuntime$1 {
    readonly engine: LiveCodingEngine;
    readonly fileId: string;
    private readonly getFileContent;
    private readonly subscribeToFile;
    private bufferedSchedulerRef;
    private isInitialized;
    private isDisposed;
    private currentBpm;
    private isPlayingState;
    /**
     * Monotonic play generation. `play()` is async and yields across `await`
     * init/evaluate before it starts the scheduler. If a `stop()` (or a newer
     * `play()`) lands during those awaits, the in-flight `play()` must abort
     * BEFORE step 7/8 — otherwise it publishes stale state and restarts the
     * scheduler right after Stop already stopped it, leaving audio running while
     * `isPlayingState` reads `false` (Stop then becomes a permanent no-op). Each
     * `play()` captures this counter at entry; `stop()` and each new `play()`
     * bump it; after every await, `play()` bails if its token is stale (#811).
     */
    private playGeneration;
    /**
     * Serializes every `engine.evaluate()` call this runtime makes — `play()`'s
     * eval and `evaluateForTimeline()`'s eval share it (#977). The engine
     * installs its `.p` capture wrappers on the shared Pattern prototype and
     * closes them over the CURRENT evaluate's capture maps; two overlapping
     * evaluates would cross-wire captured patterns (the same audio-boundary
     * race class as the double-init in #815). A user can edit — firing a
     * debounced eval-on-load — and press Play a beat later, so the overlap is
     * real. Chaining through this promise guarantees one evaluate at a time;
     * `play()`'s supersession gate (#811) still runs after the wait, so a Stop
     * landing during the queue is honored.
     */
    private evalGate;
    /**
     * Diagnostics from the last SPECULATIVE evaluate (#1172) — the one run to
     * refresh timeline marks from a document the user is still typing. Kept
     * rather than discarded, because `console.error` is muted for that call and
     * information that is silenced without being recorded is information lost.
     * Read via {@link getTimelineEvalDiagnostics}.
     */
    private lastTimelineEvalError;
    private suppressedConsoleErrors;
    private readonly errorListeners;
    private readonly playingChangedListeners;
    private readonly evaluateSuccessListeners;
    /**
     * Unregister callback from the playback coordinator. Called in
     * `dispose()` to remove this runtime from the registry so its
     * stop callback can't be invoked after the runtime has been torn
     * down. Set in the constructor so every instance participates in
     * single-source playback coordination from birth.
     */
    private unregisterFromPlaybackCoordinator;
    private autoRefreshEnabled;
    private autoRefreshUnsub;
    private autoRefreshTimeout;
    private readonly autoRefreshChangedListeners;
    constructor(fileId: string, engine: LiveCodingEngine, getFileContent: () => string, subscribeToFile?: SubscribeToRuntimeFile | null);
    init(): Promise<void>;
    /**
     * Run `fn` (an `engine.evaluate()` call) exclusively, chained behind any
     * evaluate already in flight. See `evalGate` for why serialization is
     * mandatory. Errors are swallowed on the gate chain so one failed evaluate
     * doesn't poison the queue; the caller still sees `fn`'s own resolution.
     */
    private runExclusiveEval;
    /**
     * Populate the engine's timeline haps (`songPatterns`) WITHOUT starting
     * playback, so the Song timeline draws eval-faithful marks BEFORE the user
     * presses Play (#977). Runs init (idempotent) + `engine.evaluate` and stops
     * there: no bus publish, no `scheduler.start()`, no playing-state flip.
     *
     * ⚠ THE SCHEDULER-FREE CLAIM IS ENFORCED NOW, NOT ASSUMED (#1186). It used to
     * be false. `engine.evaluate` called Strudel's `repl.evaluate(code)` with a
     * single argument, and that function's `autostart` parameter DEFAULTS TO TRUE
     * (@strudel/core/repl.mjs:222 → setPattern :272/:105-107 →
     * cyclist.mjs:123-126) — so this path started the transport, and merely
     * mounting the Song view made the app emit notes with no user gesture. The
     * engine now passes `autostart = false`, which leaves the start to `play()`
     * step 8 alone. `evaluate()` captures patterns via the `.p` setter and
     * queryArcs them offline. Reusing the real `engine.evaluate` means pre-play
     * marks come from the SAME eval oracle as playback — there is no second
     * interpreter to drift.
     *
     * ⚠ AND WHAT THIS DOCBLOCK NO LONGER CLAIMS. It used to open with "the
     * AudioContext stays suspended". That was never measured, and it is not what
     * the fix establishes — Chrome grants user activation for a BROWSER-INITIATED
     * navigation, so a freshly loaded page can already hold a running context
     * before anything is clicked. The verified claim is narrower, and it is the
     * one that matters: no scheduler start, and no note events emitted. Measured
     * 45 → 0 in `packages/app/tests/pre-gesture-transport.spec.ts`. If you need
     * the context's state, measure it; do not read it out of this comment.
     *
     * Silent by design: does NOT fire `onError` / `evaluateSuccess`. A failed
     * evaluate (mid-edit invalid code) simply leaves `songPatterns` empty and the
     * timeline falls back to the structural walk + collect marks (the resilience
     * path). The only observable change is that pre-play marks for VALID code
     * become eval-computed instead of collect-computed.
     *
     * No-op while playing or disposed: `play()` already keeps `songPatterns`
     * fresh, so re-evaluating mid-play would be redundant churn.
     */
    evaluateForTimeline(): Promise<void>;
    /**
     * Run the speculative evaluate with `console.error` muted (#1172).
     *
     * WHY THIS IS NOT SUPPRESSING A SYMPTOM. This path is handed whatever the
     * document says WHILE THE USER IS STILL TYPING IT, so a failure here is the
     * expected case, not news: `s("bd` is a parse error on the way to
     * `s("bd sd")`, and `arrang` is a ReferenceError on the way to `arrange`.
     * Reporting those through the same channel as a real error is what makes the
     * console useless — a console where an error means nothing cannot warn anyone
     * about anything.
     *
     * WHY IT HAS TO BE DONE HERE RATHER THAN BY CATCHING. The write is not ours.
     * Strudel's repl logs the failure itself and does not rethrow
     * (`@strudel/core/repl.mjs`, the `evaluate` catch: `logger(…, 'error')` then
     * an unconditional `console.error(err)`), so no try/catch on our side can
     * reach it. Note it is NOT dev-gated the way `errorLogger` is, so this floods
     * production users' consoles too, not just ours.
     *
     * WHY NOTHING IS LOST. The same error arrives structurally through the repl's
     * `onEvalError` and comes back as `{ error }`, which the caller now records on
     * `lastTimelineEvalError` instead of discarding. Anything else that printed
     * during the window is kept verbatim on `suppressedConsoleErrors` rather than
     * dropped — see `getTimelineEvalDiagnostics()`.
     *
     * THE WINDOW IS AS NARROW AS IT CAN BE, AND ITS ONE RESIDUAL RISK IS STATED.
     * It spans a single `engine.evaluate` under the eval gate, so no other
     * evaluate of ours can run inside it. An unrelated subsystem logging
     * asynchronously in that window is still captured rather than printed —
     * which is why it is captured rather than dropped.
     */
    private evaluateQuietly;
    /**
     * What the last speculative timeline evaluate hit, if anything (#1172).
     *
     * `error` is the repl's own eval error, which used to be discarded here.
     * `suppressedConsoleErrors` is everything that tried to reach `console.error`
     * during that evaluate — normally the same failure, phrased by Strudel. Both
     * are diagnostics, not control flow: a failed speculative evaluate is a
     * routine consequence of evaluating a half-typed document, and the timeline
     * simply keeps its previous marks.
     */
    getTimelineEvalDiagnostics(): {
        readonly error: Error | null;
        readonly suppressedConsoleErrors: readonly string[];
    };
    /**
     * The nine-step play lifecycle (PK1). See class JSDoc above.
     *
     * Returns the evaluate error if any (also fires `onError` listeners).
     * The bus is left untouched on error — no publish, no unpublish.
     */
    play(): Promise<{
        error: Error | null;
    }>;
    /** Whether this runtime is currently playing (for the time-travel re-eval, #204). */
    getIsPlaying(): boolean;
    /**
     * Whether this runtime's engine can capture live audio (#1346).
     *
     * Duck-typed, matching how the app reads `getLastAliasResolutions` off the
     * engine: only `StrudelEngine` implements `record`, and a runtime whose
     * engine doesn't simply reports false rather than the caller casting.
     */
    canRecord(): boolean;
    /**
     * Capture `seconds` of this runtime's LIVE output as a WAV Blob (#1346).
     * Returns null when the engine cannot record — see `canRecord`.
     *
     * Playback is guaranteed for the duration of the take, because the capture
     * taps the master analyser: with the transport stopped it would return a
     * valid WAV of pure silence and no error.
     *
     * ⚠ THE CAPTURE ALWAYS BEGINS AT THE TOP OF THE SONG (#1371). The recorder
     * taps the master analyser in real time, so it records whatever the transport
     * is playing AT THAT MOMENT — and the transport is wherever the listening
     * left it. Measured on a three-section arrangement: bouncing after 4s of
     * listening rotated the exported song by 4s, and after 12s by 12s, so the
     * verse arrived early and the file opened mid-chorus. Nothing surfaced it,
     * because a rotated take is still valid, still full-length and still not
     * silent. So a bounce rewinds first and the export is reproducible: the same
     * document bounces to the same audio however long you had been playing it.
     *
     * The rewind is three steps and each is load-bearing:
     *   1. `stop()` — resets the scheduler's query cursor (`cyclist.stop()` sets
     *      `lastEnd = 0`, and each tick queries from `lastEnd`). `pause()` does
     *      NOT, which is exactly why this cannot be a pause.
     *   2. `setTransportOffset(0)` — clears any earlier seek. Song position is
     *      `scheduler.now() - transportOffset`, applied as a `.late()` wrap, so
     *      resetting the clock WITHOUT resetting the offset would rewind the
     *      scheduler and leave the pattern shifted — a subtler version of the
     *      same bug. Optional-chained: non-Strudel engines have no seek.
     *   3. `play()` — re-evaluates and starts from cycle 0.
     *
     * ⚠ The old comment here warned against calling `play()` when already
     * playing, because `play()` re-evaluates and would restart the audio
     * mid-take. That hazard is real and still respected: the restart happens
     * BEFORE the capture opens, never during it.
     *
     * The transport is stopped afterwards in every case, which is what the
     * modal has always told the user ("playback starts automatically and stops
     * again when the bounce finishes") and was previously true only when the
     * bounce had started it.
     */
    record(seconds: number, signal?: AbortSignal, onCaptureStart?: () => void): Promise<Blob | null>;
    stop(): void;
    dispose(): void;
    /**
     * Enable or disable live mode for this runtime.
     *
     * When enabled AND the runtime is currently playing AND a
     * `subscribeToFile` function was provided at construction time, the
     * runtime installs a subscription on the workspace file that
     * debounce-triggers `play()` (which re-evaluates the current content)
     * on every content change.
     *
     * When disabled or stopped, the subscription is torn down and any
     * pending debounce timeout is cleared — so toggling OFF mid-burst is
     * immediate, not "finish the pending re-play first."
     *
     * Idempotent — calling with the already-set value is a no-op and does
     * not fire the `onAutoRefreshChanged` listeners. Never throws; disposed
     * runtimes silently ignore the call.
     */
    setAutoRefresh(enabled: boolean): void;
    /** Current live-mode state. */
    isAutoRefreshEnabled(): boolean;
    /**
     * Subscribe to live-mode state changes. Fires after `setAutoRefresh`
     * mutations, with the new enabled value. Returns an idempotent
     * unsubscribe. Used by the chrome to re-render the live-mode toggle
     * without having to poll.
     */
    onAutoRefreshChanged(cb: (enabled: boolean) => void): () => void;
    /**
     * Install or tear down the file-content subscription so that its
     * presence matches `(autoRefreshEnabled && isPlayingState &&
     * subscribeToFile !== null)`. Called from `setAutoRefresh`, `play`,
     * `stop`, and `dispose`.
     *
     * Installing the subscription is idempotent — calling reconcile while
     * already subscribed is a no-op. Tearing down is likewise idempotent.
     */
    private reconcileAutoRefresh;
    /**
     * Debounced re-evaluate trigger. Called by the file subscription
     * callback on every content change. Cancels any pending timeout and
     * schedules a new one; when it fires, checks the invariants once more
     * (dispose/stop/toggle-off may have happened mid-debounce) and calls
     * `play()` to re-evaluate and re-schedule.
     */
    private onLiveModeContentChanged;
    private fireAutoRefreshChanged;
    onError(cb: (err: Error) => void): () => void;
    onPlayingChanged(cb: (playing: boolean) => void): () => void;
    /** Fires after each clean evaluate. The callback receives the EXACT source
     *  string that was evaluated (post eval-source transform), captured at eval
     *  time — so consumers don't have to re-read a lagging file snapshot (#583). */
    onEvaluateSuccess(cb: (code: string) => void): () => void;
    getBpm(): number | undefined;
    /**
     * The tempo the engine is actually running at, in cycles per second, or
     * `null` when the engine cannot report one (not initialised, or not a
     * Strudel engine).
     *
     * ⚠ THIS IS NOT `getBpm()` IN OTHER UNITS. `getBpm()` returns
     * `extractBpmFromCode`, a regex over the source that matches only a literal
     * `setcps(...)`; it is `undefined` for a document that sets no tempo, that
     * uses `setcpm(...)`, or that changes cps mid-pattern — none of which mean
     * the music has no tempo. Anything converting CYCLES to SECONDS must use
     * this and not the readout, or it will size a document by a number the
     * source text happened to spell. See `StrudelEngine.getCps`.
     *
     * Duck-typed on the engine for the same reason `record`/`canRecord` are
     * (#1346): the capability is Strudel-specific and the engine interface is
     * shared with runtimes that have no scheduler at all.
     */
    getCps(): number | null;
    /**
     * Current cycle position from the engine's pattern scheduler, or `null`
     * when the scheduler is unavailable (engine not initialized, transport
     * stopped, non-Strudel runtime). The IR Inspector timeline strip's
     * per-tick tooltip falls back to wall-clock when this returns `null`.
     *
     * Phase 19-08 (#85). RESEARCH §2.
     */
    getCurrentCycle(): number | null;
    /**
     * #384 — raw scheduler clock, ungated by `isPlayingState`. The seek math
     * needs the live wall-clock cycle at the instant the user clicks. Returns
     * `null` only when the engine exposes no scheduler. Used by
     * `seekTo`/`getSongPosition`.
     */
    private rawSchedulerNow;
    /**
     * #384 — seek the transport to song-cycle `targetCycle`. Sets the engine's
     * transport offset to `now - targetCycle` (so `songPosition` becomes
     * `targetCycle`) and re-evaluates via `play()` — the existing hot-swap
     * path — which re-applies the `.late(offset)` wrap at the engine's `.p`
     * seam. No-op on engines without `setTransportOffset` (non-Strudel) or
     * before the scheduler exists.
     *
     * AUDIO NOTE: the audible jump is not observable in the test harness — the
     * clock + no-error are; the audio half needs a manual check (design §10).
     */
    seekTo(targetCycle: number): Promise<{
        error: Error | null;
    }>;
    /**
     * #384 — current SONG position in cycles: `scheduler.now() - transportOffset`.
     * The full-song timeline playhead reads this (vs `getCurrentCycle`'s raw
     * window clock). Gated on `isPlayingState` like `getCurrentCycle` so the
     * playhead clears on stop. `null` on non-Strudel engines / when stopped.
     */
    getSongPosition(): number | null;
    /**
     * Engine-owned HapStream, or `null` when the engine doesn't expose one
     * (non-Strudel runtimes / not yet initialized). Mirrors `getCurrentCycle`'s
     * shape — read-through accessor over the engine's components.
     *
     * Phase 20-06 — consumed by MusicalTimeline (closure-bound accessor pattern
     * via StrudelEditorClient → StaveApp's `getHapStreamRef`) so the timeline
     * can subscribe to live hap dispatch and glow rows on real fires
     * (PV38 / PK13 step 8 — musician half).
     */
    getHapStream(): HapStream | null;
    /**
     * Evaluated note events over `[0, ceil(cycles))` for the Song timeline's
     * DISPLAY marks (#861) — read-through accessor over the engine's per-track
     * schedulers, mirroring `getHapStream`'s shape. Returns `[]` for non-Strudel
     * runtimes / not-yet-evaluated engines (optional-chained delegate). The IR
     * (structure) stays the timeline's source of truth; only note pitch/scale
     * comes from here, where Strudel has already resolved it (PV174).
     */
    getTimelineEvents(cycles: number): IREvent[];
    /**
     * The same events over a BAND `[startCycle, endCycle)` rather than a prefix
     * from zero (#1197) — read-through in the same shape, from the same engine, so
     * the two can never describe different frames. `[]` for a non-Strudel runtime.
     *
     * Consumed by the Song analysis collector, which walks adjacent bands as the
     * progressive horizon grows. ⚠ That caller must keep dropping haps whose
     * `floor(begin)` precedes its band — `queryArc` returns overlaps, and analysis
     * buckets by `floor(begin)`, so an onset straddling a band boundary would
     * otherwise be counted in both. The engine's own doc carries the full argument.
     */
    getTimelineEventsBand(startCycle: number, endCycle: number): IREvent[];
    /**
     * The capture keys behind those events (#1107) — read-through in the same
     * shape, from the same engine, so the two can never describe different track
     * sets. Lets the Song analysis tell "this track has not played yet" from
     * "there is no such track", which is the difference between a period that
     * describes the whole song and one that erases the tracks it has not heard.
     * `[]` for a non-Strudel runtime, which correctly claims nothing.
     */
    getSongTrackIds(): string[];
    /**
     * Backdrop viz requested by a non-underscore Strudel viz method
     * (e.g. `.scope()`, `.pianoroll()`) during the last evaluate, or `null`.
     * Read-through accessor over the engine's components, mirroring
     * `getHapStream`. Consumed by StrudelEditorClient → StaveApp, which maps
     * the resolved renderer id to a project viz file and pins it as the
     * backdrop (the "set bg" UI then auto-updates from `backgroundFileId`).
     */
    getBackdropVizRequest(): string | null;
    /** Phase 20-07 — explicit user-driven pause. Engine pauses scheduler. */
    pause(): void;
    /** Phase 20-07 — resume after pause (or breakpoint hit). */
    resume(): void;
    /** Phase 20-07 — current debugger pause state (false on engines without pause). */
    getPaused(): boolean;
    /**
     * Phase 20-07 — subscribe to engine pause-state transitions. Returns a
     * disposer. No-op disposer when the engine doesn't implement
     * onPausedChanged (non-Strudel runtimes).
     */
    onPausedChanged(listener: (paused: boolean) => void): () => void;
    /**
     * Phase 20-07 — accessor onto the engine's BreakpointStore. Returns
     * null when the engine doesn't expose one (non-Strudel runtimes / not
     * yet initialized). Mirrors `getHapStream`'s shape.
     */
    getBreakpointStore(): BreakpointStore | null;
    private fireOnError;
    private firePlayingChanged;
    private fireEvaluateSuccess;
}

/**
 * Live coding runtime provider registry — Phase 10.2 Task 05.
 *
 * Module-level Map keyed by file extension. Provider registration is
 * idempotent on extension; calling `registerRuntimeProvider(p)` for an
 * extension that already has a provider replaces the previous entry. This
 * matches the `VizPresetStore` precedent (the singleton store pattern Phase
 * 10.2 follows for every workspace registry — see `WorkspaceAudioBus.ts`'s
 * "Why a singleton" remark for the rationale).
 *
 * @remarks
 * ## Extension keying convention
 *
 * Keys include the leading dot (`.strudel`, `.sonicpi`). Mirrors how Node
 * and most editors talk about file extensions, and avoids the "is `.foo`
 * or `foo` the canonical form?" ambiguity that bites multi-language
 * routers. The lookup helpers normalize on input — callers can pass either
 * `.strudel` or `strudel` and get the same provider back.
 *
 * Each provider may claim multiple extensions (its `extensions` array).
 * `registerRuntimeProvider` registers under every claimed extension. If
 * another provider had previously registered any of those extensions, the
 * later call wins for those keys (a provider that claims `.foo` and `.bar`
 * after a previous provider claimed only `.bar` will overwrite `.bar` and
 * coexist with the previous one on `.foo`).
 *
 * ## Why also key by language
 *
 * Tab dispatch knows the file's language (`WorkspaceFile.language`), not
 * its extension. The two are 1:1 in 10.2 but the indirection lets future
 * languages with multiple extensions (e.g., `.tidal` + `.tidalcycles` →
 * `tidal`) avoid extension-leak through the chrome-resolution path. The
 * registry keeps a parallel `Map<language, provider>` so language-keyed
 * lookups stay O(1).
 *
 * ## Test isolation
 *
 * `resetRuntimeRegistryForTests()` clears the maps. Same pattern as
 * `__resetWorkspaceAudioBusForTests` — tests in `__tests__/` call this in
 * `beforeEach` to avoid cross-test leakage when one test registers a
 * provider another test doesn't expect.
 */

/**
 * Register a provider under every extension it claims AND its language id.
 * Calling for the same extension twice replaces the previous provider for
 * THAT extension only — other extensions are unaffected. This is the
 * "registration is idempotent on key" semantics every workspace registry
 * uses.
 */
declare function registerRuntimeProvider(provider: LiveCodingRuntimeProvider): void;
/**
 * Look up a provider by file extension. Accepts either dotted (`.strudel`)
 * or undotted (`strudel`) form. Returns `undefined` if no provider is
 * registered for the extension.
 */
declare function getRuntimeProviderForExtension(extension: string): LiveCodingRuntimeProvider | undefined;
/**
 * Look up a provider by workspace language id (e.g., `'strudel'`,
 * `'sonicpi'`). The shell's per-tab chrome resolution uses this — the tab
 * carries a language string (via `WorkspaceFile.language`), not an
 * extension. Returns `undefined` if no provider is registered for the
 * language.
 */
declare function getRuntimeProviderForLanguage(language: string): LiveCodingRuntimeProvider | undefined;
/**
 * The full registry as a read-only Map keyed by extension. Used by Task 09
 * (compat shims) and Task 10 (app rewire) when wiring `chromeForTab` —
 * those callers iterate the registry to discover the set of pattern-file
 * languages currently registered. The map is intentionally immutable from
 * the caller's perspective: mutation goes through `registerRuntimeProvider`
 * so both maps stay in sync.
 */
declare const liveCodingRuntimeRegistry: ReadonlyMap<string, LiveCodingRuntimeProvider>;

/**
 * STRUDEL_RUNTIME — Phase 10.2 Task 05.
 *
 * The `LiveCodingRuntimeProvider` for `.strudel` files. Wraps `StrudelEngine`
 * (untouched), declares its extension/language, and renders the per-tab
 * transport chrome (`▶ ⏹ BPM error chromeExtras`).
 *
 * @remarks
 * ## Pattern.prototype hands-off (PV1, PV2, P1, P2)
 *
 * This file does NOT touch `Pattern.prototype`. All Strudel Pattern method
 * interception lives inside `StrudelEngine.evaluate()`'s setter trap. The
 * runtime is a thin wrapper around `engine.play()` / `engine.stop()` /
 * `engine.evaluate()` plus bus publish/unpublish — nothing more.
 *
 * The constraint is enforced by a source-grep test in
 * `__tests__/strudelRuntime.test.tsx` — the assertion fails if any of
 * `Pattern.prototype` shows up in this file or `LiveCodingRuntime.ts`.
 * The grep is the canary for the most likely failure mode (P2): a future
 * maintainer reading "the runtime owns chrome AND engine wrapping" and
 * deciding to "own" the viz interceptor here too.
 *
 * ## Chrome rendering
 *
 * `renderChrome(ctx)` returns a small React component (`StrudelChrome`)
 * that renders the transport bar. The component is a function call, not a
 * class, so each invocation produces a fresh element with its own
 * lifecycle — the embedder mounts it inside the EditorView's `chromeSlot`
 * via Task 09's wiring.
 *
 * The component intentionally does NOT subscribe to `runtime.onError` or
 * `runtime.onPlayingChanged` itself — it reads from `ctx` directly. The
 * embedder (Task 09's compat shim) holds the subscription state and
 * passes the latest values through `ChromeContext`. This keeps the
 * provider stateless and lets the same chrome render in environments
 * (Task 09's `StrudelEditor` shim) where the embedder already has those
 * values from elsewhere (e.g., its own `useState`).
 *
 * The visual style mirrors the legacy `Toolbar.tsx` look so the
 * cutover is byte-comparable in screenshots. Inline styles only — no
 * import from `Toolbar.tsx` because the legacy toolbar bundles an export
 * button into its surface, and Phase 10.2 routes the export button
 * through `chromeExtras` instead (per U8). Reusing the legacy component
 * would force the export button into the chrome at the wrong layer.
 */

declare const STRUDEL_RUNTIME: LiveCodingRuntimeProvider;

/**
 * SONICPI_RUNTIME — Phase 10.2 Task 05.
 *
 * The `LiveCodingRuntimeProvider` for `.sonicpi` files. Wraps `SonicPiEngine`
 * (the adapter at `engine/sonicpi/adapter.ts`, which itself wraps the
 * standalone `sonicPiWeb` engine via a CDN-loaded SuperSonic backend).
 *
 * @remarks
 * ## Pattern.prototype hands-off (PV1, PV2, P1, P2)
 *
 * Sonic Pi has its own viz capture path inside `engine/sonicpi/adapter.ts`
 * (`parseVizRequests` / `stripVizCalls`). Like the Strudel runtime, this
 * file does NOT touch any prototype, does NOT install viz interceptors,
 * does NOT mutate `file.content` before evaluation. The runtime is a
 * passthrough.
 *
 * ## BufferedScheduler elevation (S8)
 *
 * Sonic Pi's adapter exposes streaming + audio in `engine.components` but
 * does NOT populate `queryable`. The `LiveCodingRuntime.play()` lifecycle
 * detects this and lazily constructs a `BufferedScheduler` wrapping the
 * adapter's `HapStream` and the underlying `AudioContext`. Inline view
 * zones for `.sonicpi` files use that elevated scheduler. The wiring is
 * automatic — this runtime provider does not need to opt in.
 *
 * ## Chrome rendering
 *
 * Same `▶ ⏹ BPM error chromeExtras` shape as `STRUDEL_RUNTIME`. BPM
 * extraction relies on the same `setcps()` regex inside
 * `LiveCodingRuntime`, which Sonic Pi files do not typically use — the
 * runtime returns `undefined` for `getBpm()` on Sonic Pi code, and the
 * chrome silently omits the BPM display. A future Sonic Pi BPM source
 * (e.g., `use_bpm 120` extraction) is a follow-up task; the chrome's
 * conditional rendering already handles `bpm === undefined` correctly.
 */

declare const SONICPI_RUNTIME: LiveCodingRuntimeProvider;

/**
 * Preview provider registry — Phase 10.2 Task 06.
 *
 * Module-level Map keyed by file extension. Mirrors the runtime provider
 * registry in `workspace/runtime/registry.ts` line-for-line — same
 * extension-normalization rules, same language parallel map, same test-only
 * reset helper. The duplication is deliberate: the two registries serve
 * different concerns (runtime = executable languages, preview = visual
 * output) and keeping them in lockstep at the API level makes callers (Task
 * 09's compat shims, Task 10's app rewire) symmetric across the two.
 *
 * @remarks
 * ## Extension keying convention
 *
 * Keys include the leading dot (`.hydra`, `.p5`). Mirrors how Node and
 * most editors talk about file extensions. The lookup helpers normalize
 * on input — callers can pass either `.hydra` or `hydra` and get the
 * same provider back.
 *
 * Each provider may claim multiple extensions (its `extensions` array).
 * `registerPreviewProvider` registers under every claimed extension. If
 * another provider had previously registered any of those extensions, the
 * later call wins for those keys.
 *
 * ## Why also key by language
 *
 * Tab dispatch knows the file's language (`WorkspaceFile.language`), not
 * its extension. The two are 1:1 in 10.2 (hydra↔hydra, p5↔p5js) but the
 * indirection lets future languages with multiple extensions avoid
 * extension-leak through the preview-resolution path. The registry keeps
 * a parallel `Map<language, provider>` so language-keyed lookups stay
 * O(1).
 *
 * Languages recognized by the 10.2 built-in providers:
 *   - `'hydra'` → HYDRA_VIZ
 *   - `'p5js'` → P5_VIZ
 *
 * ## MARKDOWN_HTML is NOT registered here
 *
 * Per CONTEXT U7, the markdown provider is deferred to Phase 10.3. The
 * slot for `.md` in the registry is intentionally open — when no provider
 * matches a preview request, `PreviewView`'s caller (Task 09/10) shows the
 * "No preview provider registered" fallback. Don't add a markdown stub
 * here "just in case"; the gap IS the spec.
 *
 * ## Test isolation
 *
 * `resetPreviewRegistryForTests()` clears the maps. Matches the runtime
 * registry's `resetRuntimeRegistryForTests`. Tests call this in
 * `beforeEach` to avoid cross-test leakage when one test registers a
 * provider another test doesn't expect.
 */

/**
 * Register a preview provider under every extension it claims AND every
 * mapped language id. Calling for the same extension twice replaces the
 * previous provider for THAT extension only — other extensions are
 * unaffected. Same "registration is idempotent on key" semantics as the
 * runtime registry.
 */
declare function registerPreviewProvider(provider: PreviewProvider): void;
/**
 * Look up a provider by file extension. Accepts either dotted (`.hydra`)
 * or undotted (`hydra`) form. Returns `undefined` if no provider is
 * registered for the extension.
 */
declare function getPreviewProviderForExtension(extension: string): PreviewProvider | undefined;
/**
 * Look up a provider by workspace language id (e.g., `'hydra'`, `'p5js'`).
 * The shell's per-tab preview resolution uses this — the tab carries a
 * language string (via `WorkspaceFile.language`), not an extension.
 * Returns `undefined` if no provider is registered for the language.
 */
declare function getPreviewProviderForLanguage(language: string): PreviewProvider | undefined;
/**
 * The full registry as a read-only Map keyed by extension. Used by Task 09
 * (compat shims) and Task 10 (app rewire) when enumerating providers at
 * startup. The map is intentionally immutable from the caller's
 * perspective: mutation goes through `registerPreviewProvider` so both
 * maps stay in sync.
 */
declare const previewProviderRegistry: ReadonlyMap<string, PreviewProvider>;

/**
 * HYDRA_VIZ — Phase 10.2 Task 06 preview provider for `.hydra` files.
 *
 * Thin adapter on top of `createCompiledVizProvider`. The shared helper
 * owns the compile-on-reload + mount-on-mount mechanics; this file just
 * declares the HYDRA identity:
 *
 *   - extensions: `.hydra`
 *   - label:       `'Hydra Visualization'`
 *   - renderer:    `'hydra'` (fed to `compilePreset`)
 *
 * Inherits D-03 (`keepRunningWhenHidden: false`) and D-07 (`reload:
 * 'debounced'`, `debounceMs: 300`) from the helper. Demo-mode fallback
 * (P7) is handled by `HydraVizRenderer`'s internal fallback chain — see
 * `compiledVizProvider.tsx` for the full rationale.
 *
 * @remarks
 * The entire body is one function call because hydra and p5 share the
 * reload lifecycle. A future format with different reload semantics
 * (e.g., GLSL with a "recompile only on save" button) would NOT use this
 * path — it would call the registry directly with its own render
 * function.
 */
declare const HYDRA_VIZ: PreviewProvider;

/**
 * P5_VIZ — Phase 10.2 Task 06 preview provider for `.p5` files.
 *
 * Thin adapter on top of `createCompiledVizProvider`. See
 * `hydraViz.tsx` for the rationale — the two providers are mirror images
 * of each other, and all the machinery lives in the shared helper.
 *
 *   - extensions: `.p5`
 *   - label:       `'p5 Visualization'`
 *   - renderer:    `'p5'` (fed to `compilePreset`)
 *
 * Demo-mode fallback (P7) works via the bundled p5 template's
 * `scheduler?.now() ?? 0` / `scheduler?.query(...) ?? []` optional-chaining
 * paths — when `ctx.audioSource` is null, the empty component bag means
 * `scheduler` is `null` and the user code hits its else branches
 * naturally. No provider-level overlay needed.
 */
declare const P5_VIZ: PreviewProvider;

/**
 * GLSL_VIZ — preview provider for `.glsl` files (issue #287).
 *
 * Thin adapter on top of `createCompiledVizProvider`, the mirror image of
 * `p5Viz.tsx` / `hydraViz.tsx` — all the machinery (compile-on-reload, the
 * stable-descriptor memo, the editor chrome) lives in the shared helper. This
 * is the editor surface for the GLSL renderer (issue #281): a `.glsl` file's
 * source is a ShaderToy `mainImage` or raw `void main()`, fed straight to
 * `compilePreset` → `makeGLSLRenderer`.
 *
 *   - extensions: `.glsl`
 *   - label:       `'GLSL Visualization'`
 *   - renderer:    `'glsl'` (fed to `compilePreset`)
 *
 * Demo-mode (no attached pattern) works the same as p5/hydra: with an empty
 * component bag the shader still animates off `iTime` and simply reads a silent
 * `iChannel0` / zero `u*` uniforms — no provider-level overlay needed.
 */
declare const GLSL_VIZ: PreviewProvider;

/**
 * vizPresetBridge — Phase 10.2 Task 06.
 *
 * Two small functions that bridge between the persisted `VizPresetStore`
 * (IndexedDB, Phase 10.1 artifact) and the in-memory `WorkspaceFile` store
 * (Phase 10.2 editing layer). Per CONTEXT S6: the two stores are NOT
 * continuously synced — they're bridged explicitly at tab-creation time
 * and at save-time, and nothing in between.
 *
 *   - `seedFromPreset(preset)` — read a preset and create a WorkspaceFile
 *     with the preset's code. Called by Task 09's viz editor compat shim
 *     on tab open, and by Task 10's app startup sequence when restoring
 *     the open-tab set.
 *
 *   - `flushToPreset(fileId, presetId)` — read the current file content
 *     from the workspace store and write it back to the preset store via
 *     `VizPresetStore.put`. Called by Task 09 when the user hits Ctrl+S
 *     inside a viz editor tab.
 *
 * @remarks
 * ## Why a dedicated bridge module
 *
 * Phase 10.1's `VizEditor.tsx` loads presets directly into its own tab
 * state (`VizEditor.tsx:136-148` today). Post-refactor, that coupling
 * dies — the editor doesn't know about `VizPresetStore`, and the
 * provider doesn't know about the file store beyond its `ctx.file`
 * snapshot. Something has to stitch the two sides at the bookends of a
 * file's lifetime. That something is this file.
 *
 * Both functions are pure data utilities — no React, no UI, no bus
 * subscription. Task 09 (the editor compat shim) mounts them into the
 * Ctrl+S keyboard handler. Task 10 (the app rewire) calls them on
 * startup. This file itself never renders anything.
 *
 * ## Language mapping
 *
 * `VizPreset.renderer` is either `'hydra'` or `'p5'`. `WorkspaceLanguage`
 * is either `'hydra'` or `'p5js'` (the extra `js` comes from the Monaco
 * language id that the p5 editor uses for syntax highlighting, which is
 * `p5js` not `p5`). We map at the boundary — callers don't need to know
 * the quirk.
 *
 * ## File id generation
 *
 * `seedFromPreset` returns the workspace file id so callers can track
 * which file belongs to which preset. The id is derived from the preset
 * id with a `viz:` prefix to avoid collisions with pattern file ids
 * (which use their extension as a hint) and with the bundled-preset
 * prefix. This keeps the two-store bridge visible at a glance in
 * debugging output — `viz:__bundled_piano_roll_hydra__` immediately
 * tells you "this workspace file was seeded from the piano-roll bundled
 * preset."
 *
 * Re-seeding the same preset is safe: `createWorkspaceFile` overwrites
 * the existing entry and notifies subscribers, so the editor view
 * picks up the fresh content on the next render.
 *
 * The `presetId` is stashed in `WorkspaceFile.meta.presetId` as a
 * back-reference so tests and future callers can read it without
 * having to re-parse the file id. The `meta` bag is the documented
 * escape hatch for per-file metadata that doesn't belong on the
 * store's public API.
 */

/**
 * Workspace file id derivation from a preset id. Namespaced with `viz:`
 * so that file ids are self-describing in debug output.
 */
declare function workspaceFileIdForPreset(presetId: string): string;
/**
 * Seed a `WorkspaceFile` from a `VizPreset`. The file id is derived from
 * the preset id; path is `${preset.name}.${preset.renderer}`; content is
 * the preset code; language is mapped via `languageForPresetRenderer`;
 * `meta.presetId` is set as a back-reference.
 *
 * Returns the workspace file id so callers can push it into a tab
 * descriptor without recomputing it.
 *
 * @remarks
 * ## Why this function is synchronous
 *
 * The caller passes a `VizPreset` object directly — the IndexedDB read
 * happens at the caller's layer (`VizPresetStore.getAll()` at app
 * startup, or `VizPresetStore.get(id)` for a specific preset). Keeping
 * the seed itself synchronous lets the Task 09 compat shim call it
 * inside a React `useEffect` without an async dance, and lets tests
 * exercise it without touching IndexedDB.
 *
 * The async variant — `seedFromPresetId(id)` — is a one-liner on top
 * of this function; see below.
 */
declare function seedFromPreset(preset: VizPreset): string;
/**
 * Async convenience: fetch a preset by id from the IndexedDB-backed
 * `VizPresetStore`, then seed a workspace file from it. Returns the
 * workspace file id, or `undefined` if the preset does not exist.
 *
 * This is the path Task 10 calls on app startup when it needs to hydrate
 * the open-tab set from persisted ids. Tests that want to avoid
 * IndexedDB should use the synchronous `seedFromPreset(preset)` form
 * with an in-memory preset object.
 */
declare function seedFromPresetId(presetId: string): Promise<string | undefined>;
/**
 * Read the current content of a workspace file and write it back to the
 * viz preset store. Caller supplies both the file id (identifying which
 * workspace file to flush) and the preset id (identifying which preset
 * entry to overwrite) — these are usually the same up to the `viz:`
 * prefix, but keeping them separate lets a future "save-as" flow write
 * to a different preset id from the file's origin.
 *
 * Returns a promise that resolves once the IndexedDB write completes.
 * On unknown file id the function is a no-op and resolves immediately —
 * the user hitting Ctrl+S on a dead tab should not throw.
 *
 * Updates `updatedAt` to the current time. `createdAt` and `id` are
 * preserved from the existing preset entry to keep persistence stable
 * across saves. If the preset does not yet exist in the store (e.g.,
 * first save of a brand-new file), the preset is created with
 * `createdAt` set to `updatedAt`.
 *
 * @remarks
 * ## Why the caller supplies the preset id
 *
 * `WorkspaceFile.meta.presetId` stores the back-reference (see
 * `seedFromPreset`), but meta is opaque typed (`Record<string,
 * unknown>`) so callers have to read it themselves. Requiring the
 * preset id as an explicit argument removes that bookkeeping from this
 * function and keeps the signature type-safe.
 */
declare function flushToPreset(fileId: string, presetId: string): Promise<void>;
/**
 * Read-only helper: given a workspace file, return the preset id it was
 * seeded from (if any). Useful for tests and for Task 09 when it needs
 * to know whether a tab is backed by a persisted preset.
 */
declare function getPresetIdForFile(file: WorkspaceFile): string | undefined;

/**
 * namedVizBridge — compile + register helpers for viz presets.
 *
 * This is the higher-level wrapper that `vizPresetBridge` deliberately
 * avoids being. It imports `compilePreset` (which transitively loads
 * the p5 / hydra renderer stack), so any test or module that wants to
 * stay decoupled from the renderer pack should import from
 * `vizPresetBridge` instead.
 *
 * @remarks
 * ## Why a separate file
 *
 * The plain `vizPresetBridge` is a pure data utility — tests exercise
 * it without mocking the renderer chain. Adding `compilePreset` to its
 * imports broke unit tests by transitively pulling in p5 (which imports
 * gifenc, which fails in vitest's ESM loader). Keeping the compile +
 * register combo in a sibling file that only the app layer / compat
 * shims import preserves the test isolation while still giving
 * consumers a one-line API for "make this preset resolvable by name."
 */

/**
 * Compile a preset into a `VizDescriptor` and register it in the
 * `namedVizRegistry` under `preset.name`. Subsequent inline lookups
 * via `resolveDescriptor` (e.g., `.viz("my-preset")`) will resolve to
 * this compiled descriptor.
 *
 * On compile error, unregisters any stale entry for the same name and
 * returns `false`. Returns `true` on successful registration.
 *
 * Callers:
 *   - App layer `StrudelEditorClient` — after seeding bundled presets
 *     and after saving via Ctrl+S, so the user's inline references
 *     keep working across code edits.
 *   - `VizEditor` compat shim — after `seedFromPreset` loads
 *     persisted presets from `VizPresetStore`.
 *
 * Idempotent for same-preset calls: registering the same descriptor
 * twice is a no-op. Registering a DIFFERENT descriptor for the same
 * name replaces the entry (so saves pick up fresh code).
 *
 * `name` defaults to `preset.name` but can be overridden to register
 * under a renderer-qualified key (e.g. `"scope:hydra"`) when two presets
 * share a basename — see the `mode:renderer` convention in
 * `resolveDescriptor`. This keeps the bare mode name reserved for the
 * default renderer instead of last-write-wins between p5 and hydra.
 */
declare function registerPresetAsNamedViz(preset: VizPreset, name?: string): boolean;

/**
 * Shared event store for every runtime's info / warn / error messages.
 *
 * Goal: one stream of structured log entries that multiple UI surfaces
 * subscribe to — toast on new errors, status-bar LED counting new
 * entries since last opened, Monaco inline markers on the offending
 * file, and a dedicated Console panel with history + filters. Each
 * runtime (Strudel, Sonic Pi, p5.js, Hydra) emits through the same
 * `emitLog` entry point so downstream consumers don't need per-runtime
 * special-casing.
 *
 * The store keeps a bounded history (MAX_HISTORY most recent entries).
 * Listeners are fired synchronously on emit so UI surfaces can update
 * in the same microtask as the runtime error handler.
 */
type LogLevel = 'info' | 'warn' | 'error';
type RuntimeId = 'strudel' | 'sonicpi' | 'p5' | 'hydra' | 'glsl'
/** Stave-itself errors (engine init, host-side failures). */
 | 'stave';
/**
 * "Did you mean X?" hint produced by the friendly-error formatter from
 * a fuzzy match against the runtime's `DocsIndex`. Carried on the log
 * entry so every UI surface (toast, console row, Monaco marker) can
 * render it the same way.
 */
interface LogSuggestion {
    /** Canonical symbol name (e.g. `noise`). */
    name: string;
    /** In-app docs page for the suggested symbol. */
    docsUrl: string;
    /** One-line example if the DocsIndex carried one. */
    example?: string;
    /** First-sentence description if present. */
    description?: string;
}
interface LogEntry {
    /** Monotonic-ish unique id — used as React key, preserved through history. */
    id: string;
    /** Epoch ms when the entry was emitted. */
    ts: number;
    level: LogLevel;
    runtime: RuntimeId;
    /** Workspace file path this entry originated from, if known. */
    source?: string;
    /** 1-indexed line number inside `source`, if known. */
    line?: number;
    column?: number;
    message: string;
    suggestion?: LogSuggestion;
    /** Raw error stack for the "expand stack" fold. */
    stack?: string;
    /**
     * How many times this identical entry has been emitted (1 on first
     * emit). Repeats — even non-consecutive ones — coalesce into this entry
     * (same `id`, position kept, `ts` bumped) and increment `count`; the
     * Console shows a `×N` badge. Without this a per-cycle runtime error
     * (e.g. a soundfont out-of-range note firing every beat) would flood the
     * panel with endless rows. (#563) Optional on the wire — `emitLog` always
     * stamps it (1 on first emit), so a present entry always has it; treat
     * absent as 1.
     */
    count?: number;
}
type LogListener = (entry: LogEntry | null, history: readonly LogEntry[]) => void;
/**
 * Signal that a `(runtime, source)` pair has just evaluated cleanly.
 * Live-mode filters use the marker timestamp to hide any log entry
 * emitted BEFORE it — "old errors the user has since fixed".
 */
interface FixedMarker {
    runtime: RuntimeId;
    /** Workspace file path (or omitted → runtime-wide fix). */
    source?: string;
    /** Epoch ms when the fix happened. */
    ts: number;
}
type FixedListener = (marker: FixedMarker, markers: ReadonlyMap<string, number>) => void;
/**
 * Emit a log entry. Returns the full entry (with generated id + ts) so
 * callers can hold a reference for later deduplication or jumping. A
 * `null` listener signal is reserved for `clearLog` / reset — emitLog
 * always passes the emitted entry.
 */
declare function emitLog(partial: Omit<LogEntry, 'id' | 'ts' | 'count'>): LogEntry;
/**
 * Subscribe to every future log entry. Returns an unsubscribe. Does
 * NOT replay history — consumers that need it should call
 * `getLogHistory()` on mount.
 */
declare function subscribeLog(fn: LogListener): () => void;
/**
 * Read the current history in chronological order. Safe to mutate the
 * returned array; we give back a frozen slice of the internal buffer.
 */
declare function getLogHistory(): readonly LogEntry[];
/**
 * Empty the history and fire a `null` notification so subscribers can
 * reset their local state (clear marker maps, zero the LED counter).
 */
declare function clearLog(): void;
/**
 * Record that `(runtime, source)` just evaluated cleanly. Non-destructive:
 * history is preserved. Consumers (the Console panel's Live mode) use
 * the marker timestamp to hide entries emitted before the fix. Called
 * from the runtime's `onEvaluateSuccess` bridge.
 */
declare function emitFixed(input: {
    runtime: RuntimeId;
    source?: string;
}): FixedMarker;
/**
 * Subscribe to fix events. Does NOT replay existing markers — call
 * `getFixedMarkers()` on mount if a starting snapshot is needed.
 */
declare function subscribeFixed(fn: FixedListener): () => void;
/** Read the current fix-marker table. Key format: `${runtime}:${source|*}`. */
declare function getFixedMarkers(): ReadonlyMap<string, number>;
/** Key helper exported for consumers that need to build the same key. */
declare function makeFixedKey(runtime: RuntimeId, source: string | undefined): string;

/**
 * Bridge engineLog → Monaco inline markers.
 *
 * Every log entry that carries `source` + `line` places a squiggle on
 * the matching file's Monaco model. `emitFixed` clears all log-driven
 * squiggles for that `(runtime, source)` pair — so a clean re-eval
 * immediately retires the prior error's marker, matching Live mode's
 * Console-panel behaviour at the inline surface.
 *
 * Owner namespace: `stave-log`. Deliberately different from the
 * `stave` owner used by `setEvalError` (driven by EditorView's `error`
 * prop for Strudel/Sonic Pi's existing in-prop error pipeline), so the
 * two paths don't clobber each other when they agree on a line — the
 * user just sees the line highlighted, Monaco merges same-owner lists
 * but shows different-owner markers stacked.
 *
 * The bridge is a module-level subscriber that installs once. Call
 * `installEngineLogMarkers()` from shell init; subsequent calls are
 * no-ops. Unsubscribes are not exposed — the bridge's lifetime matches
 * the process.
 */
/** Wire the bridge. Idempotent. */
declare function installEngineLogMarkers(): void;

/**
 * Global error floor — the structural safety net under every
 * per-runtime bridge.
 *
 * The observe-then-patch pattern (fix the Strudel path, then p5, then
 * Hydra, then the factory swallow, then the p5 `hitCriticalError`
 * halt…) happens because each runtime has its own wrapping and its
 * own error-eating paths. Bridging each one catches errors we already
 * know about; it doesn't stop the next unknown swallow.
 *
 * This module installs two listeners on `window` that catch whatever
 * escapes any bridge:
 *
 *   - `error`              — every uncaught synchronous throw.
 *   - `unhandledrejection` — every rejected promise with no handler.
 *
 * Both forward into `emitLog` so the Console panel, toast,
 * status-bar chip, and Monaco squiggle (when a line + source is
 * known) surface the error. The bridges remain useful — they
 * enrich the message with friendly hints, attribute the right
 * source, and translate wrapper line offsets — but they are no
 * longer the ONLY way an error becomes visible. If we miss a
 * runtime-specific hint, the user still sees a raw entry.
 *
 * Dedupe: the underlying `emitLog` already collapses consecutive
 * identical entries, so a tight per-frame flood from a draw-loop
 * throw becomes one Console row + one counting toast.
 */
/**
 * Attach the global listeners. Idempotent; safe to call on every
 * editor mount. No-op on non-browser environments so SSR / test
 * graphs don't trip.
 */
declare function installGlobalErrorCatch(): void;

/**
 * IR Inspector store — the latest parsed-and-collected snapshot from
 * the most recent successful Strudel eval. Subscribed by the IR
 * Inspector panel; emitted by `StrudelEditorClient`'s eval hook.
 *
 * Why a tiny purpose-built store instead of reusing engineLog: the
 * payload is structurally different (a tree + an event array, not a
 * sequence of log lines) and the UI semantics are different too —
 * Console keeps history, Inspector keeps only the latest.
 */

interface IRSnapshot {
    /** Epoch ms when the snapshot was captured. */
    ts: number;
    /** Workspace file path the source came from, if known. */
    source?: string;
    /** Runtime that produced this snapshot — only Strudel for v0. */
    runtime: RuntimeId;
    /** The raw user code that was parsed. */
    code: string;
    /** Per-pass IR snapshots, in execution order. IR-shaped only — collected events live in `events`. */
    passes: readonly {
        readonly name: string;
        readonly ir: PatternIR;
    }[];
    /** Alias of `passes[passes.length - 1].ir`. Publishers MUST keep these in sync. */
    ir: PatternIR;
    /** Collected events for one cycle window starting at t=0. */
    events: IREvent[];
    /** Lookup: irNodeId → IREvent. PV38 clause 1.
     *  Built at publish time by enrichWithLookups; ReadonlyMap enforces
     *  PV33 (snapshot immutability post-publish). */
    irNodeIdLookup: ReadonlyMap<string, IREvent>;
    /** Lookup: `${loc[0].start}:${loc[0].end}` → IREvent[]. Used by
     *  engine-side hap matching (normalizeStrudelHap); haps don't carry
     *  the hash, only the loc. ReadonlyMap enforces PV33. */
    irNodeLocLookup: ReadonlyMap<string, IREvent[]>;
    /** Lookup: 1-based Monaco line number → leaf irNodeIds whose
     *  loc[0] starts on that line. PV38 phase-20-07 use; built once
     *  at publish time by enrichWithLookups; ReadonlyMap enforces PV33.
     *  Empty map when no events carry both irNodeId and loc. Used by
     *  Monaco gutter click → leaf-set resolver for breakpoint
     *  registration (Phase 20-07). PV37 alignment: events without
     *  irNodeId never appear in this index. */
    irNodeIdsByLine: ReadonlyMap<number, readonly string[]>;
}
/** Input shape for publishIRSnapshot — caller does not construct lookups;
 *  the publisher enriches via enrichWithLookups. Type-system enforces
 *  this contract (Trap 9 mitigation — caller cannot bypass the publisher). */
type IRSnapshotInput = Omit<IRSnapshot, 'irNodeIdLookup' | 'irNodeLocLookup' | 'irNodeIdsByLine'>;
type Listener$2 = (snap: IRSnapshot | null) => void;
/**
 * Publish a snapshot. Two parallel side-effects fire on every publish
 * (PK9 step 8 — order independent, both must run):
 *  1. captureSnapshot fan-out — pushes into the timeline ring buffer
 *     (timelineCapture.ts) so past evals can be scrubbed.
 *  2. listener fan-out — single-slot consumers (the IR Inspector
 *     panel's live subscribe) re-render with the new snapshot.
 *
 * The optional `meta` parameter carries cycle position (read by the
 * publisher from `runtime.getCurrentCycle()`) onto the capture entry.
 * Existing callers pass no `meta` and continue to compile; capture
 * defaults `cycleCount` to `null` in that case.
 */
declare function publishIRSnapshot(snap: IRSnapshotInput, meta?: {
    cycleCount?: number | null;
}): void;
declare function clearIRSnapshot(): void;
declare function getIRSnapshot(): IRSnapshot | null;
declare function subscribeIRSnapshot(fn: Listener$2): () => void;

/**
 * BottomPanel — reusable bottom-drawer component for the editor surface.
 *
 * Mounted by `WorkspaceShell` below the groups area. Hosts a tab bar
 * with one active tab + a body. Tab content is contributed externally
 * via `bottomPanelRegistry` (DA-05); PR-A seeds a placeholder
 * "Timeline" tab so the surface is reviewable before PR-B fills it.
 *
 * Closed-state pixel cost: ~29px (28px header + 1px top border). When
 * zero tabs are registered the component returns `null` (true zero
 * shift — Trap 2). Default open=false so existing users see only the
 * 29px header strip until they expand the drawer.
 *
 * Persistence: height + open + activeTabId hydrate from localStorage in
 * `useState` initializers (Trap 7 — no first-paint flicker). Writes
 * happen in commit-time effects + a pagehide flush for the height.
 *
 * Audience: musician (PV35). Vocabulary lock (PV32 / D-06): the only
 * strings PR-A introduces are "Hide panel" / "Show panel" /
 * "Bottom panel" / "Bottom panel tabs" / "Resize bottom panel". Tab
 * titles are sourced from the registry (PR-A's seed uses "Timeline").
 *
 * Phase 20-01 PR-A.
 */

declare function BottomPanel(): React.ReactElement | null;

/**
 * bottomPanelRegistry — module-level singleton registry of tabs that the
 * BottomPanel component renders.
 *
 * Mirrors the activity-bar panel registry shape at
 * `packages/app/src/panels/registry.ts` (DA-05). Idempotent register
 * (re-registering by id REPLACES the existing entry) so a re-mount /
 * hot-reload doesn't double-up tabs.
 *
 * `listBottomPanelTabs()` returns a FRESH array on every call (PV34) so
 * React subscribers using `useMemo([])` or shallow-prop comparison don't
 * go stale on register/unregister.
 *
 * `__resetBottomPanelRegistryForTest` is intentionally NOT exported from
 * the top-level barrel — it's test-internal. Tests import directly from
 * this module path. (Trap 9 — vitest test isolation.)
 *
 * Phase 20-01 PR-A.
 */

interface BottomPanelTab {
    readonly id: string;
    /** User-facing tab title. Vocabulary discipline (PV32 / PV35) is the
     *  responsibility of the registering caller — the registry stores
     *  whatever string it's given. */
    readonly title: string;
    /** Optional codicon name without the `codicon-` prefix. */
    readonly icon?: string;
    /**
     * Tab body. Either a ReactNode rendered directly, or a function that
     * returns one (function form lets a future tab defer expensive mount
     * until first activation). PR-A always uses the ReactNode form.
     */
    readonly content: React.ReactNode | (() => React.ReactNode);
}
type Listener$1 = () => void;
/**
 * Register a tab. Idempotent — re-registering by `id` REPLACES the
 * existing entry (matches activity-bar `registerPanel` semantics, lets
 * PR-B re-register `'musical-timeline'` to swap the placeholder for the
 * real component without an explicit unregister).
 *
 * Returns an unsubscribe function that removes the tab IF it's still the
 * registered one (a later replace is the new owner).
 */
declare function registerBottomPanelTab(tab: BottomPanelTab): () => void;
/** Remove a tab by id. No-op if the id isn't registered. */
declare function unregisterBottomPanelTab(id: string): void;
/**
 * Fresh array of all registered tabs (insertion order). PV34 — never
 * cache between renders without subscribing.
 */
declare function listBottomPanelTabs(): readonly BottomPanelTab[];
/** Direct lookup by id. */
declare function getBottomPanelTab(id: string): BottomPanelTab | undefined;
/**
 * Subscribe to register / unregister / replace events. Listener fires
 * with no arguments — consumers re-read `listBottomPanelTabs()`.
 */
declare function subscribeToBottomPanelTabs(cb: Listener$1): () => void;

/**
 * currentCycle — a tiny accessor registry for the live transport cycle.
 *
 * The visual-editing panels are seeded inside the editor package and have no
 * direct line to the per-file runtime that owns the scheduler clock (that lives
 * in the app's StrudelEditorClient). The app already computes a "current cycle"
 * accessor for the MusicalTimeline; it registers the same accessor here so the
 * bottom-panel grids (Sequencer / Piano Roll) can read the playing cycle and
 * highlight the active step — independent of which bottom-panel tab is open
 * (so they can't rely on the Timeline's own rAF, which pauses when another tab
 * is active).
 *
 * Mirrors the active-editor registry shape: one process-wide accessor, set by
 * the app, read by the panels. Returns null when nothing is playing or no
 * accessor is registered.
 */
type CycleAccessor = () => number | null;
/** App registers the live-cycle accessor (or null to clear). */
declare function setCurrentCycleAccessor(fn: CycleAccessor | null): void;
/** Current transport cycle, or null when not playing / no accessor. */
declare function readCurrentCycle(): number | null;

/**
 * soundCatalog.ts — curated, GROUNDED option lists for the sound-assignment
 * pickers (#514 instrument, #515 kit, #516 add-voice).
 *
 * Every value here is verified against what the engine actually loads (spike
 * #427, doc artifacts/stave/GROUNDING-LOGIC-PARITY-427.md):
 *   - synth waveforms      → superdough/synth.mjs:23
 *   - `gm_*` soundfonts     → @strudel/soundfonts/gm.mjs (exact keys)
 *   - drum kits (`.bank`)   → live tidal-drum-machines.json (71 kits)
 *   - drum voice tokens     → the `_<voice>` suffixes in that same manifest
 *
 * This is a CURATED shortlist for the v1 pickers, not the authoritative
 * registry. PV141 #6: the eventual full-chrome pickers must enumerate the LIVE
 * `soundMap` (the manifests are CDN-loaded and can change). The write-back
 * itself is value-agnostic — it accepts any string — so this list bounds the
 * convenience UI, not the capability.
 */
interface SoundOption {
    value: string;
    label: string;
}
interface SoundGroup {
    group: string;
    options: SoundOption[];
}

/** The minimal shape we read off a superdough soundMap entry. */
interface SoundMapEntry {
    data?: {
        type?: string;
        tag?: string;
    };
}
/** A superdough soundMap dictionary: name → entry. */
type SoundMapDict = Record<string, SoundMapEntry>;
/**
 * Group a live soundMap dictionary into the melodic-instrument picker's
 * `SoundGroup[]` (#514). Synths and soundfonts are the relevant melodic
 * instruments for a `note(...).sound(...)`; bare samples are offered too but
 * the drum-machine voices (`tag: 'drum-machines'`) and superdough internals
 * (`_`-prefixed) are excluded — they belong to the Sequencer's kit/voice model,
 * not a melodic picker. Each group is sorted; empty groups are dropped. Returns
 * `null` when the dict is empty/absent so callers can fall back to the curated
 * list.
 */
declare function groupSoundCatalog(dict: SoundMapDict | null | undefined): SoundGroup[] | null;
/** A drum-machine sample manifest: `Bank_voice` key → sample url list. */
type DrumMachineManifest = Record<string, unknown>;
/**
 * Distinct bank names from a drum-machine manifest: the key prefix before the
 * last `_`. `_`-internals (`_base`) and bare-voice keys (no `_`, e.g.
 * uzu-drumkit's `bd`/`hh`) are skipped. Sorted for stable display.
 */
declare function banksFromDrumMachineManifest(manifest: DrumMachineManifest | null | undefined): string[];
/**
 * Group live bank names into the Kit picker's `SoundGroup[]` (#515). Banks are
 * grouped by major manufacturer (the rest → "Other"); the option VALUE is the
 * exact bank string (what `.bank('…')` writes), the label strips the maker
 * prefix and spaces out camelCase. Returns null when empty so callers fall back
 * to the curated `DRUM_KITS`.
 */
declare function groupDrumKits(bankNames: string[] | null | undefined): SoundGroup[] | null;
type CatalogAccessor = () => SoundGroup[] | null;
/** App registers the live instrument-catalog reader (or null to clear). */
declare const setSoundCatalogAccessor: (fn: CatalogAccessor | null) => void;
/** App calls this when the soundMap changes (samples finished loading). */
declare const notifySoundCatalogChanged: () => void;
/** App registers the live drum-kit reader (or null to clear). */
declare const setDrumKitAccessor: (fn: CatalogAccessor | null) => void;
/** App calls this when the live drum-kit list is ready. */
declare const notifyDrumKitChanged: () => void;

/**
 * General MIDI soundfont families (#807) — sub-categorise the ~125 `gm_*`
 * soundfonts by their well-known instrument family so both melodic pickers can
 * show "Soundfonts · Strings" / "· Brass" / … instead of one flat "Soundfonts"
 * bucket of 125 rows (which regressed browsability vs. the old curated list).
 *
 * SHARED domain knowledge: the GM program→family split is one spec fact, and it
 * has TWO consumers — the Mixer's melodic `<select>` (`groupSoundCatalog`) and
 * the Asset Library's Sounds provider (`classify`). Keeping the map + the group
 * label in ONE module means the two surfaces can never drift apart (PV168:
 * extract shares the CODE, not just a copied constant).
 *
 * GROUNDED in the vendored `@strudel/soundfonts@1.3.0` `gm.mjs`: its 125
 * top-level `gm_*` keys are exactly the names superdough registers into the live
 * `soundMap` (`registerSoundfonts` iterates that object), and each key's family
 * is read straight from gm.mjs's `// <Instrument>: <Family>` annotations. The 16
 * families are the canonical GM sound-set groups (Piano has 5 keys, not 8,
 * because strudel merges the four acoustic-grand variants into `gm_piano`).
 *
 * If a NEW upstream `gm_*` key ever appears that isn't in this map, `gmFamily`
 * returns null and `soundfontGroupLabel` falls back to the flat "Soundfonts"
 * bucket — never dropped, just ungrouped (the include-by-default rule, P254).
 */
/** The 16 GM families, in canonical program order — the display order for the
 *  `Soundfonts · <Family>` groups. */
declare const GM_FAMILY_ORDER: readonly ["Piano", "Chromatic Percussion", "Organ", "Guitar", "Bass", "Strings", "Ensemble", "Brass", "Reed", "Pipe", "Synth Lead", "Synth Pad", "Synth Effects", "Ethnic", "Percussive", "Sound Effects"];
type GmFamily = (typeof GM_FAMILY_ORDER)[number];
/** Total mapped keys — exposed so tests can assert the map stays in sync with
 *  the vendored gm.mjs (125 as of @strudel/soundfonts@1.3.0). */
declare const GM_FAMILY_KEY_COUNT: number;
/**
 * The GM family for a soundfont key, or null when the key isn't a mapped
 * `gm_*` soundfont (a bare/custom soundfont, or a new upstream key not yet in
 * the map — the caller keeps it in the flat "Soundfonts" bucket, never drops).
 */
declare function gmFamily(name: string): GmFamily | null;
/**
 * The group label for a soundfont: `Soundfonts · <Family>` for a mapped `gm_*`
 * key, else the flat `Soundfonts`. Both pickers use THIS so the label format is
 * defined once. The `Soundfonts · ` prefix (matching `Drums · <bank>`) keeps all
 * soundfonts clustered where the Asset Library sorts rows by group.
 */
declare function soundfontGroupLabel(name: string): string;

/** The literal combinator name — round-trip identity (PV122 #3). */
type ArrangeMode = 'arrange' | 'cat' | 'slowcat';
/** Per-arm source ranges within a detected combinator call. One arm = one clip. */
interface ArrangeArmRange {
    /**
     * Absolute `[start, end)` of the weight number literal — present for
     * `arrange` arms (the `n` in `[n, pat]`), `null` for `cat`/`slowcat` arms
     * (whose weight is an implicit `1`, with no literal to edit).
     */
    weightRange: [number, number] | null;
    /** Absolute `[start, end)` of the arm's pattern expression. */
    patternRange: [number, number];
    /**
     * Absolute `[start, end)` of the WHOLE arm: the `[n, pat]` array for
     * `arrange`, else identical to `patternRange`. This is the unit a
     * reorder/remove/insert op moves.
     */
    armRange: [number, number];
}
/** A detected `arrange(...)`/`cat(...)`/`slowcat(...)` call and its arms. */
interface ArrangeCall {
    mode: ArrangeMode;
    /** Absolute `[start, end)` of the whole `mode(...)` call expression. */
    callRange: [number, number];
    /** Absolute `[start, end)` of the callee identifier (`arrange`/`cat`/…). */
    calleeRange: [number, number];
    /** Absolute `[start, end)` of the argument region between `(` and `)`. */
    argsRange: [number, number];
    /** Arms in source order; clip order is arm order (PV122 #1). */
    arms: ArrangeArmRange[];
}
/**
 * The innermost `arrange|cat|slowcat(...)` call whose range contains `pos`, or
 * null. "Innermost" so a cursor on a clip inside a nested combinator binds THAT
 * combinator (mirrors `chunkDetect.innermostChainUnder`, #395). `pos` is
 * typically `Arrange.arms[i].loc[0].start` — the anchor the IR already carries.
 */
declare function detectArrangeAt(doc: string, pos: number): ArrangeCall | null;
/** Every combinator call in the doc, in source order. For tests / sweeps. */
declare function detectAllArrangeCalls(doc: string): ArrangeCall[];
/**
 * The bare PATTERN expression of the top-level track statement containing `pos`,
 * when that track is NOT already a combinator (so there is no `arrange`/`cat` to
 * reorder). Returns the expression's absolute `[start, end)` — the range §2.1
 * `wrapBare` wraps to INTRODUCE a combinator when a steady pattern is first
 * placed in time (the "move-on-a-bare-track" case).
 *
 * Returns null when: the doc doesn't parse; `pos` isn't inside a top-level
 * expression statement; or that statement already contains a combinator (then
 * `detectArrangeAt` owns the edit). A `$:`/label prefix and any trailing
 * statements are excluded — we return the EXPRESSION range only, so a wrap edits
 * just the pattern and leaves the rest of the line byte-identical.
 */
declare function detectBarePattern(doc: string, pos: number): {
    patternRange: [number, number];
} | null;

/**
 * arrange/serialize — structural ops on a detected combinator call.
 *
 * Each op is PURE: it takes an `ArrangeCall` (from `arrange/parse`) + the live
 * doc text and returns `OffsetEdit[]` addressed by pre-edit absolute offsets —
 * the exact shape `writeback.replaceRanges` consumes. We edit TEXT, not the IR:
 * `toStrudel` is a whole-statement canonical regenerator that would reformat
 * the leaf layer, so (like `notation/serialize`) we never call it. That is also
 * why #434 (toStrudel mislabels fastcat/Seq as `cat()`) does NOT block this —
 * no op here re-emits through `toStrudel`.
 *
 * Byte-fidelity: `setWeight` on an `arrange` arm changes ONLY the weight digits;
 * the structural ops (reorder/insert/remove/wrap) keep each arm's pattern text
 * verbatim and touch only the combinator scaffolding (callee name, brackets,
 * separators). Inter-arm separators normalise to `, ` on a reorder — that IS
 * the targeted region.
 *
 * No Monaco, no runtime IR import (P172).
 */

/**
 * Set arm `i`'s cycle weight to `weight`.
 *
 *  - On an `arrange` node: replace ONLY the weight literal — byte-minimal.
 *  - On a `cat`/`slowcat` node: weight 1 is a no-op (their implicit weight).
 *    A weight ≠ 1 PROMOTES the node to `arrange` (PV122 #3 — `cat` can't
 *    express weights): rename the callee and wrap every arm `pat` → `[w, pat]`
 *    (the target arm gets `weight`, the rest get `1`), keeping each pattern's
 *    bytes verbatim.
 */
declare function setWeight$1(doc: string, call: ArrangeCall, i: number, weight: number): OffsetEdit[];
/**
 * Move arm `from` to index `to`. Rebuilds the argument list in the new order,
 * each arm's text verbatim, joined by `, `. (Clip order = arm order, PV122 #1.)
 */
declare function reorderArm$1(doc: string, call: ArrangeCall, from: number, to: number): OffsetEdit[];
/**
 * Insert `armSource` as a new arm at index `at` (clamped to `[0, arms.length]`).
 * The caller supplies a well-formed arm: a `[n, pat]` tuple for an `arrange`
 * node, a bare pattern for `cat`/`slowcat`.
 */
declare function insertArm$1(doc: string, call: ArrangeCall, at: number, armSource: string): OffsetEdit[];
/**
 * Remove arm `i`, taking one adjacent `, ` separator with it. Refuses to empty
 * the combinator — a lane must keep ≥ 1 clip (PV122 #5); removing a sole arm is
 * a delete-the-whole-track op handled elsewhere, so this returns no edits.
 */
declare function removeArm$1(doc: string, call: ArrangeCall, i: number): OffsetEdit[];
/**
 * #491 — GAP delete: silence arm `i` IN PLACE, keeping its cycle width. The
 * DAW-standard plain Delete leaves a gap (the arrangement timeline is absolute —
 * later clips do NOT slide left), unlike `removeArm` which ripples the arm out and
 * shortens the loop. We replace ONLY the arm's pattern with `silence`, preserving
 * the `[n, …]` weight wrapper (and every other arm verbatim):
 *   `[n, pat]`        →  `[n, silence]`   (arrange arm — width n kept)
 *   `pat` (cat arm)   →  `silence`        (implicit width 1 kept)
 * Already-silent arm → no edits. Silencing every arm is allowed (a muted track,
 * `arrange([n, silence])` is valid) — unlike `removeArm`, this never empties the
 * combinator, so there's no sole-arm guard. Pure text surgery (PV123).
 */
declare function silenceArm$1(doc: string, call: ArrangeCall, i: number): OffsetEdit[];
/**
 * §2.1 "introduce the combinator". A bare steady pattern has no `arrange` to
 * edit; the first time it is placed in time it must be WRAPPED:
 *   `pattern`  →  `arrange([leadingWeight, silence], [patternWeight, pattern])`
 * `patternRange` is the bare pattern's absolute `[start, end)` (e.g. a chunk's
 * `exprRange`). The pattern's bytes are preserved verbatim between the inserts.
 */
declare function wrapBare(patternRange: [number, number], leadingWeight: number, patternWeight: number): OffsetEdit[];
/**
 * #489 — MATERIALIZE a bare loop into an `arrange` by carving a one-cycle gap at
 * `barIndex` over an arrangement of `span` whole cycles. The bare pattern (one
 * implicit loop) becomes:
 *   `pat`  →  `arrange([barIndex, pat], [1, silence], [span−barIndex−1, pat])`
 * with zero-width arms dropped (gap at bar 0 → no leading `pat`; gap at the last
 * bar → no trailing `pat`). `pat`'s bytes are preserved verbatim in each surviving
 * arm. This is the EXPLICIT "introduce the combinator" entry-point for a uniform
 * loop — the deliberate counterpart of the removed drag-to-wrap (#488).
 *
 * Refuses to empty the track: deleting the SOLE bar (span 1, or every non-gap arm
 * gone) would leave `arrange([1, silence])` = all silence, so it returns no edits
 * (a lane keeps ≥1 sounding clip — PV122 #5). `span ≥ 1`, `barIndex` clamped to
 * `[0, span)`. Pure text surgery; never re-emits through `toStrudel` (PV123).
 */
declare function materializeBareDelete(doc: string, patternRange: [number, number], barIndex: number, span: number): OffsetEdit[];
/**
 * #489 — MATERIALIZE a bare loop into an `arrange` by SPLITTING it at a whole-cycle
 * boundary `barIndex` over an arrangement of `span` whole cycles. The bare pattern
 * (one implicit loop spanning the song) becomes two ADDRESSABLE arms with IDENTICAL
 * sound — a uniform loop tiled across `span` cycles plays the same whether expressed
 * as one bare loop or as `arrange([k, pat], [span−k, pat])` (grounded in haps):
 *   `pat`  →  `arrange([barIndex, pat], [span−barIndex, pat])`
 * with `pat`'s bytes preserved verbatim in BOTH arms. This is the split-first
 * materialization entry-point (D1, reframe): selecting the whole bare clip and
 * splitting it introduces the combinator with no audible change, after which the
 * resulting arms are individually selectable and the existing arrange ops
 * (`removeArm` → carve a gap, `reorderArm`, `splitArm`, `setWeight`) apply.
 *
 * Both halves must be ≥ 1 whole cycle, so `span ≥ 2` is required (a 1-cycle loop
 * has no interior boundary — extend it first, #487); `barIndex` is clamped to
 * `[1, span−1]`. `span < 2` returns no edits. Pure text surgery; never re-emits
 * through `toStrudel` (PV123).
 */
declare function materializeBareSplit(doc: string, patternRange: [number, number], barIndex: number, span: number): OffsetEdit[];
/**
 * Split arm `i` at a whole-cycle boundary: `[n, pat]` → `[n₁, pat], [n₂, pat]`
 * (same pattern verbatim in both halves), where `n₁ = firstWeight` and
 * `n₂ = n − firstWeight`. Both halves must be ≥ 1 whole cycle, so this only
 * applies to an `arrange` arm whose weight is ≥ 2; `firstWeight` is clamped to
 * `[1, n−1]`. Returns no edits for a `cat`/`slowcat` arm (implicit weight 1 —
 * a single cycle can't be sliced into two whole cycles) or a weight-1 arm.
 */
declare function splitArm$1(doc: string, call: ArrangeCall, i: number, firstWeight: number): OffsetEdit[];

type PickMethod = 'pick' | 'pickRestart' | 'pickReset';
/** One arm of the `<…@w …>` control = one section clip. */
interface PickControlArm {
    /** Absolute `[start, end)` of the WHOLE arm token (`verse@8`, `~@4`, `[bd,sd]@2`). */
    armRange: [number, number];
    /** Absolute `[start, end)` of the arm's head (the section name / pattern,
     *  without the `@weight`): `verse`, `~`, `[bd,sd]`. */
    headRange: [number, number];
    /** Absolute `[start, end)` of the weight DIGITS after `@` — null when the arm
     *  has no `@` (implicit weight 1, no literal to edit; setWeight inserts one). */
    weightRange: [number, number] | null;
    /** Whole-cycle weight (the `n` in `@n`); default 1. */
    weight: number;
}
/**
 * One `{key: pattern}` entry of the pick call's section object (#1417 Stage 1).
 *
 * The section's NAME lives here, not in a binding: `{verse: bassLine}` names the
 * section `verse` while the pattern keeps its own name. That is what makes the
 * pick rename the smaller of the two — it never rewrites a symbol the user
 * didn't point at.
 */
interface PickSectionEntry {
    /** The key as the selector spells it — quotes stripped (`"verse"` → `verse`). */
    key: string;
    /** Absolute `[start, end)` of the key TOKEN, INCLUDING quotes when the key is
     *  written as a string literal (so a rewrite preserves the quoting style). */
    keyRange: [number, number];
    /** ES shorthand `{verse}` — the key token IS the value token, so a rename must
     *  EXPAND it (`{intro: verse}`) rather than rewrite it in place. */
    shorthand: boolean;
}
/** A detected `pick*` call and the arms of its `<…@w …>` control string. */
interface PickControl {
    method: PickMethod;
    /** Absolute `[start, end)` of the whole `recv.method(...)` call. */
    callRange: [number, number];
    /** Absolute `[start, end)` of the control string literal, INCLUDING quotes. */
    stringRange: [number, number];
    /** Absolute `[start, end)` of the content BETWEEN `<` and `>` — the region a
     *  duplicate/insert writes into (so a new arm lands inside the brackets). */
    innerRange: [number, number];
    /** Arms in source order; clip order = arm order. */
    arms: PickControlArm[];
    /** Object-literal section entries in source order — EMPTY when the call's
     *  first argument isn't an object literal (the array form `pick([a, b])`
     *  names nothing). Selector order and object order are independent, so an
     *  arm is joined to an entry by KEY STRING, never by slot (#1467). */
    entries: PickSectionEntry[];
}
/**
 * The innermost `pick*` call whose range contains `pos`, or null. `pos` is
 * typically the per-lane control offset the timeline carries (the `<…>` start).
 */
declare function detectPickControlAt(doc: string, pos: number): PickControl | null;
/** Every pick* control in the doc, source order. For tests / sweeps. */
declare function detectAllPickControls(doc: string): PickControl[];

/**
 * pickControl/serialize — structural ops on a detected `pick*` control string.
 *
 * #463 Stage 2. Each op is PURE: `PickControl` (from `pickControl/parse`) + the
 * live doc → `OffsetEdit[]` addressed by pre-edit absolute offsets (the shape
 * `writeback.replaceRanges` consumes). We edit the `<…@w …>` mini-notation TEXT
 * directly — never `toStrudel`/`serialize` (PV123) — so the section patterns and
 * the `.pickRestart({…})` object stay byte-verbatim; only the control arms move.
 *
 * Arms are space-separated; the weight is `@n` digits. `setWeight` touches only
 * the digits (or inserts `@n` on an implicit-1 arm); the structural ops keep each
 * arm's head text verbatim and re-join with single spaces.
 *
 * No Monaco, no runtime IR import (P172).
 */

/**
 * Set arm `i`'s weight (the dwell length, in whole cycles).
 *  - Arm already has `@n` → replace ONLY the digits (byte-minimal).
 *  - Implicit-weight arm + w === 1 → no-op (already 1).
 *  - Implicit-weight arm + w ≠ 1 → insert `@w` right after the head.
 */
declare function setWeight(doc: string, control: PickControl, i: number, weight: number): OffsetEdit[];
/**
 * Split arm `i` into two equal-headed arms: `verse@8` → `verse@4 verse@4`
 * (`n₁ = firstWeight`, `n₂ = n − firstWeight`, both ≥ 1). Only an arm with
 * weight ≥ 2 is divisible; a weight-1 (one-cycle) arm returns no edits.
 */
declare function splitArm(doc: string, control: PickControl, i: number, firstWeight: number): OffsetEdit[];
/**
 * #1462 — GAP delete, the pick spelling of `arrange/silenceArm` (#491).
 *
 * Replace ONLY the arm's HEAD with `~` (a mini rest), keeping its `@weight`:
 *   `verse@8`  →  `~@8`      (width 8 kept)
 *   `verse`    →  `~`        (implicit width 1 kept)
 *
 * ⚠ WHY THIS EXISTS AT ALL: the same Delete key on the same canvas used to mean
 * two different things depending on how the arrangement was SPELLED. `arrange()`
 * left a gap (#491, the DAW convention — the timeline is absolute, so later clips
 * do not slide left); the pick spelling called `removeArm` and rippled the section
 * out, shortening the song. The arrange side carried an explicit justification and
 * the pick side carried none, which is what marked it as an unconsidered
 * divergence rather than a design choice. Gap is the default on both now.
 *
 * GROUNDED against the real evaluator, not assumed: `<intro@4 ~@8 outro@4>` over
 * the same three sections queries 1,1,1,1 · 0×8 · 1,1,1,1 haps per cycle, against
 * 1,1,1,1 · 4×8 · 1,1,1,1 for the un-gapped control — the gap is silent, is
 * exactly 8 cycles wide, and the outro does NOT move.
 *
 * Already-silent arm → no edits (mirrors arrange). Silencing EVERY arm is allowed
 * — `<~@4 ~@8>` is a valid muted track — so unlike `removeArm` there is no
 * sole-arm guard here: this op can never empty the control.
 */
declare function silenceArm(doc: string, control: PickControl, i: number): OffsetEdit[];
/**
 * Remove arm `i`, taking one adjacent space with it. Refuses to empty the
 * control — a lane keeps ≥ 1 section (mirrors arrange/removeArm).
 */
declare function removeArm(doc: string, control: PickControl, i: number): OffsetEdit[];
/**
 * Move arm `from` to index `to`. Rebuilds the `<…>` content in the new order,
 * each arm's text verbatim, single-space-joined (clip order = arm order).
 */
declare function reorderArm(doc: string, control: PickControl, from: number, to: number): OffsetEdit[];
/**
 * Insert `armSource` (a bare control arm like `verse@4`) at index `at`
 * (clamped to `[0, arms.length]`), single-space-separated.
 */
declare function insertArm(doc: string, control: PickControl, at: number, armSource: string): OffsetEdit[];
/**
 * Duplicate arm `i`: insert a verbatim copy right after it. (The clone keeps the
 * same head + weight; clip order = arm order, so the copy plays next.)
 */
declare function duplicateArm(doc: string, control: PickControl, i: number): OffsetEdit[];
/**
 * How many selector arms carry section `i`'s name — 1 normally, more when the
 * section RETURNS (`<verse@8 chorus@4 verse@8>`). A rename moves all of them,
 * so the caller can say "this renames 2 sections" BEFORE writing (#1417).
 *
 * Returns 0 whenever `renameSection` would decline on the OLD name's side, so a
 * caller that shows the count and then writes can't be told "2 sections" and
 * handed no edits.
 */
declare function countSectionArms(doc: string, control: PickControl, i: number): number;
/**
 * Rename section `i` — the object KEY plus every selector arm that names it.
 *
 * `{verse: bassLine}` + `<verse@8>` → `{intro: bassLine}` + `<intro@8>`: the
 * section is renamed and the pattern keeps its own name, because in this
 * spelling the section name is the key, not a binding reference. ES shorthand
 * `{verse}` is the majority spelling and the one case where the two coincide,
 * so it EXPANDS — `{intro: verse}` — which renames the section and leaves the
 * binding `verse` exactly where the user put it.
 *
 * A returning section is renamed in every arm it occupies: they aren't two
 * sections sharing a name, they're one pattern arranged twice.
 *
 * Declines (no edits) when the name is not UNIQUELY AND COMPLETELY ADDRESSABLE,
 * because every one of those cases writes a document that means something other
 * than what the user asked for:
 *  - the new name isn't a bare identifier, is `__proto__`, or is already the
 *    current name;
 *  - the arm isn't a named section — `~`, an inline `[bd,sd]`, or a key this
 *    parser couldn't name (computed, spread);
 *  - the new name collides with another key in the same object;
 *  - the OLD name is written twice in the object (`{glitch: a, glitch: b}` —
 *    real, and in the corpus). JS keeps the last; renaming the first would move
 *    the selector onto the pattern that was being shadowed, silently changing
 *    the music;
 *  - the old name also occurs nested inside another arm's head, where this op
 *    would not rewrite it and the reference would break.
 */
declare function renameSection(doc: string, control: PickControl, i: number, newName: string): OffsetEdit[];

/**
 * One top-level element of the source, and the columns it produced.
 *
 * krill's element spans TILE the mini: concatenating them reconstructs the
 * input byte-for-byte, whitespace and all. Verified over the 1352 flat minis in
 * the real corpus (and all 380 the roll opens), and re-checked per parse — that
 * tiling is the whole basis for putting back exactly what we read.
 *
 * Where the whitespace LANDS inside a span is not something to have beliefs
 * about: `bd sd` spans as `"bd "` + `"sd"` (trailing) while `bd!3 sd` spans as
 * `"bd!3"` + `" sd"` (leading). So an untouched region is written back as its
 * whole `raw` span and no rule is needed; only a region we re-emit has to know
 * which side its padding sits on.
 *
 * `C` is what the element produced IN THE VIEW'S OWN TERMS — cells for the grid,
 * notes for the roll. The spans are the same fact about the source either way;
 * only the answer to "did the user change this?" is the view's.
 */
interface SourceRegion<C> {
    /** the element's bytes exactly as written, whitespace included */
    raw: string;
    /** `raw`'s padding, split out so a re-emit keeps the spacing around it */
    leading: string;
    trailing: string;
    /** `[from, to)` — the columns this element expanded to */
    from: number;
    to: number;
    /**
     * What the VIEW showed for these columns at parse time — the basis for "did
     * the user change this region?". Deliberately the model's own view rather
     * than the raw atoms: `[sd,sd]` is one lane to a grid that has one lane per
     * distinct sound, so comparing against the raw pair would report a change
     * nobody made and rewrite the region for nothing.
     */
    content: C;
}
/**
 * Source for a `<...>` alternation used as a sequence ELEMENT (`bd <sd hh>`),
 * not around the whole cycle (#920). The model bar-expands — one alternative per
 * bar, so `bd <sd hh>` is a 2-bar grid — but the SOURCE stays a single cycle:
 * the elements the user actually wrote (`bd`, `<sd hh>`). Each region owns a
 * within-bar column span and remembers what it showed IN EACH BAR, so the writer
 * copies an unchanged element's bytes through verbatim and re-emits only the one
 * edited — as `<...>` when its bars now differ, plain when they agree, promoting
 * a static cell to an alternation when an edit makes it vary.
 *
 * Distinct from `source`: there a region's `[from,to)` are the model's own
 * columns; here they are SINGLE-CYCLE columns, gathered strided across `bars`.
 * A model carries `altSource` XOR `source`, never both.
 */
interface AltRegion<C> {
    raw: string;
    leading: string;
    trailing: string;
    /** `[from, to)` columns WITHIN one bar (single-cycle space) */
    from: number;
    to: number;
    /** what the view showed for this element in each of `bars` cycles, at parse */
    perBar: C[];
}
interface AltSource<C> {
    /** columns per bar (one cycle) */
    perBar: number;
    bars: number;
    /** finest subdivision, so a re-emitted region splits on whole columns */
    div: number;
    /** the single-cycle top-level elements, tiling the source in order */
    regions: AltRegion<C>[];
}
/**
 * What a step grid shows for one column: each sound STARTING there, with how long
 * it sounds, in columns.
 *
 * Carried the length as of #1010 P4c (#1045). Sounds alone were enough while the
 * printer re-derived every length, because a length could not differ from what the
 * bytes already said. Once the printer PRESERVES lengths, "did the user change this
 * region?" has to include them, or the honouring is undetectable for exactly the
 * edits it exists for — a region whose only change is a length compares equal and is
 * copied back verbatim.
 */
interface GridCell {
    token: string;
    /** length in COLUMNS (see `StepNote.duration`) */
    duration: number;
}
/** what a step grid shows for a span of columns: the sounds in each, with their lengths */
type GridCells = GridCell[][];
/**
 * A leaf atom's OWN source span — `[start, end)` into the inner mini string.
 *
 * Read from a hap's `context.locations` (Strudel's `mini()` calls `.withLoc` per
 * atom), never computed here: a nested atom carries its own token span, not its
 * container's, so `s("a [b c]")` gives the `c` hap the span of `c` and never of
 * `[b c]` (#987).
 */
interface LeafSpan {
    start: number;
    end: number;
}
/**
 * one atom sounding in a column, paired with the source leaf it was read from
 *
 * ⚠ `duration` IS HERE SO THE WRITER CAN REFUSE, NOT SO IT CAN WRITE (#1235). This
 * anchor's whole point is a byte replacement at `span`, and a note's LENGTH has no
 * bytes of its own to replace — it is spelled by what surrounds the token (`_`, `@n`,
 * a bracket group), which is notation this writer must never author. Carrying the
 * length anyway is what lets `spliceByLeaf` NOTICE that a length changed and decline,
 * instead of comparing tokens, finding no difference, and returning the source bytes
 * as a successful write. A writer's contract has to state what it can notice, not only
 * what it can spell.
 *
 * Read from the same expression that fills the lane cells (`projectStepGridByLeaf`),
 * never derived a second time: the comparison is only meaningful if both sides come
 * from one rule. `RollLeafAnchor` has carried its own for the same reason since #989,
 * which is why the roll never had this defect.
 */
interface LeafAnchor {
    atom: string;
    span: LeafSpan;
    /** length in COLUMNS, the units of `StepNote.duration` */
    duration: number;
}
/**
 * The source of a LEAF-ANCHORED projection (#986) — the third write-back shape,
 * and the only one that never re-emits notation.
 *
 * `source`/`altSource` pair the view with the source's TOP-LEVEL elements, so an
 * edited element is re-spelled from the cell model (`reemitRegion`). That re-emit
 * is a mini-notation printer of our own, and it can only spell flat or one-level
 * output — which is why anything with internal structure (`[a [b c]]`, `<a b>*4`)
 * round-trips wrong and is refused.
 *
 * A leaf anchor pairs the view with the ATOM instead: an edit replaces that one
 * note's bytes and every other byte — brackets, spaces, operators, unedited notes
 * — is copied verbatim. Nothing about the grammar is authored, so the writer
 * cannot invent syntax; what it cannot express (a note where no leaf exists) it
 * REFUSES. See `spliceByLeaf`.
 */
interface LeafSource {
    /** the inner mini string the spans index into, byte-for-byte */
    src: string;
    /**
     * Per model column, the atoms sounding there and each one's own leaf span.
     *
     * Its LENGTH is also the layout these anchors were read against — the width
     * `anchorsDescribe` (`serialize.ts`) requires the model to still have before
     * either leaf writer may write. See `RollLeafSource.steps` for why.
     */
    cols: LeafAnchor[][];
    /**
     * Per column, the span of the REST (`~` / `-`) occupying it, where there is one.
     *
     * Deliberately not an entry in `cols`: an anchor is an atom the grid SHOWS and the
     * lanes are built from that set, so a rest joining it would draw a `~` lane. This
     * is the same information for a different purpose — the one span a column can offer
     * when it has no sounding leaf.
     *
     * WHAT IT IS FOR (#1154). Deleting a note on a leaf grid writes `~` over that note's
     * own bytes, which is right. But a rest produces no hap, so nothing indexed it, and
     * putting the note back was refused for want of a span — the user could not undo
     * their own delete anywhere on this path (0 of 402 asks over the corpus).
     *
     * ⚠ IT DOES NOT — AND CANNOT — MARK WHICH RESTS ARE OURS. The model is re-read from
     * the document after every write, so a `~` this writer produced and one the user
     * typed are the same bytes with the same span and no way to tell them apart. So this
     * field enables the undo AND placement on any rest a leaf grid shows: 248 of 3,584
     * empty cells across 17 of 82 leaf units. What is still refused is a column that
     * holds no leaf at all, where a note would have to AUTHOR a slot.
     *
     * Absent, or null at a column, simply means the older refusal still stands there.
     */
    rests?: (LeafSpan | null)[];
    /**
     * The width of the model these spans were ATTACHED to — `RollLeafSource.attachedSteps`
     * is the same field on the roll, and both exist for one reason (#1235, [[PV319]]).
     *
     * ⚠ IT IS NOT `cols.length`, AND THAT DIFFERENCE IS THE WHOLE POINT. `anchorsDescribe`
     * compares `cols.length` against the model's `steps`, and where these spans are
     * OVERLAID (`StepGridModel.surgical`) those two numbers are computed by different code
     * from different premises: the leaf path anchors per ATOM, the element path counts
     * EXPANDED columns. So their equality is evidence of nothing, and coincidence is
     * reachable by an ordinary gesture — a `÷2` moves the element model's width onto the
     * overlay's, the guard passes against spans describing a different layout, surgery
     * writes the pre-halved bytes back, and the user's divide-by-two silently does nothing.
     * Measured before #1233: unreachable on the overlay as it ships (0 of 52 grid and 0 of 43
     * roll restructures), and 13 grid + 2 roll under its core attachment.
     *
     * ⚠ THAT 13 + 2 WAS CONFIRMED WHEN #1233 SHIPPED, BY BREAKING THE REAL THING — and the
     * confirmation is worth recording because a cheaper reading disagreed with it. Dropping
     * the re-stamp in `lazyGridLeaf`/`lazyRollLeaf` on the built change swallows exactly 13
     * grid and 2 roll restructures; re-stamping makes it 0 and 0.
     *
     * ⚠⚠ THE CHEAPER READING SAID 2 + 2, AND IT WAS THE INSTRUMENT THAT WAS WRONG. Before
     * the attachment existed, `_1235-width-coincidence.spec.ts` SIMULATED it by spreading
     * spans fetched from `projectStepGridDerived` — which carry the DERIVED path's own
     * `attachedSteps`. That stamp usually disagrees with the core model they were being
     * pasted onto, so the simulated overlay was refused for a reason the real change never
     * has, and the figure came out five times too low. A simulation that does not reproduce
     * the field the guard reads is not measuring the guard. Break the built thing.
     *
     * Recording the width at ATTACH time makes "valid" mean "this is the model those spans
     * were read from", which is the property actually needed. `anchorsDescribe` stays: it
     * is still NECESSARY, it was only never sufficient.
     */
    attachedSteps: number;
}
/**
 * A leaf-span OVERLAY: the width the spans were attached to, plus the spans themselves
 * behind a thunk that projects them on first use (#1233).
 *
 * WHY THE SPANS ARE DEFERRED, and it is a cost fact rather than a style one. Building
 * them is a second full projection of the mini. They are read only when the writer
 * answers an EDIT — one write per many parses, and most parses never write at all — so
 * built eagerly the cost lands on every parse instead of on the writes that use it.
 * Measured on the path this field exists to reach: attaching eagerly where the syntactic
 * core answers takes a parse from 57.2us to 1459.8us, x25.5, on the parse that serves 791
 * of 958 corpus units and re-runs on every keystroke. Deferred, a parse pays one closure
 * and the projection is paid once by the write that needs it.
 *
 * ⚠ THE MEMO IS PART OF THE CONTRACT, NOT AN OPTIMISATION. A writer may ask more than
 * once, and a fresh projection per ask would put back the cost this shape exists to move.
 * A FAILED projection memoises too — `undefined` is an answer ("this mini has no leaf
 * spans"), not an absence — so the flag is separate from the value rather than a null
 * check, which would re-run the whole projection on every write to rediscover it.
 *
 * ⚠ AND IT IS GATED, by counting projections rather than by timing them (#1237). Losing
 * either the laziness or the memo changes no output, no count and no verdict — only
 * work — so no gate that reads models can see it, and a wall-clock assertion would be
 * flaky. `parse.ts` keeps a projection counter for exactly this and nothing else;
 * `surgicalMemo.test.ts` reads it as a delta around a parse and around repeated asks,
 * including the failing-projection case that the separate flag exists to serve.
 *
 * ⚠ IT IS MEMOISED PER MODEL, NOT PER MINI. A cache keyed on the mini string would help
 * only repeated parses of unchanged text, and the hot case is TYPING, where the mini
 * differs every keystroke and every lookup would miss.
 *
 * ⚠ `spans()` RETURNS A SOURCE ALREADY STAMPED WITH `attachedSteps` BELOW, so the width
 * rule stays in the one place that enforces it (`anchorsAreFor`, `serialize.ts`) and no
 * caller has to remember to re-check it. A source arrives from the leaf projection
 * describing the LEAF model's layout; overlaid it must describe the model it is landing
 * on, or the writer compares two independently-derived numbers and their agreement means
 * nothing ([[PV319]]).
 *
 * ⚠⚠ `spans` IS A FUNCTION, AND `JSON.stringify` DROPS FUNCTION-VALUED PROPERTIES. Any
 * gate that compares models structurally sees this field shrink to `attachedSteps` alone
 * rather than seeing it disappear — which is why that number stays a plain field. A gate
 * comparing an overlaid model against a bare one still sees a difference; one comparing
 * two overlaid models no longer sees their spans differ. `writer-census.test.ts` is the
 * gate that does this, and it strips the overlay from both sides explicitly rather than
 * letting `JSON.stringify` decide what it can see — a gate that passes because it went
 * blind reads exactly like one that passes because nothing changed.
 */
interface SurgicalOverlay<S> {
    /**
     * The width of the model this overlay was attached to. The writer refuses unless the
     * model still has it — see `LeafSource.attachedSteps` for the restructure that makes a
     * bare width comparison unsound.
     */
    attachedSteps: number;
    /** the spans, projected on first call and remembered — including a failure */
    spans: () => S | undefined;
}
/** The grid's overlay — see `SurgicalOverlay` for the contract and both hazards. */
type LazyLeafSource = SurgicalOverlay<LeafSource>;
/** The roll's overlay, with the same contract and the same hazards. */
type LazyRollLeafSource = SurgicalOverlay<RollLeafSource>;
/**
 * One played note, paired with the source leaf its PITCH was read from.
 *
 * The roll's analogue of `LeafAnchor`, and deliberately not the same shape: a grid
 * column holds a set of atoms, while a roll note is positioned AND held, so an
 * anchor has to carry where it starts and how long it lasts as well as what it
 * plays. Both are still the same fact — "these bytes are this note's own".
 */
interface RollLeafAnchor {
    /** the note as the model carries it — names case-folded, numerics stringified */
    pitch: string;
    /** the model column the note starts at, absolute across bars */
    start: number;
    /** length in columns */
    duration: number;
    /** the PITCH token's own `[start, end)` in `src` — never the `@n` hold (see below) */
    span: LeafSpan;
}
/**
 * The source of a leaf-anchored ROLL projection (#986 P1b) — `LeafSource` for the
 * pitched surface.
 *
 * Anchored per NOTE rather than per column, because a note is what the roll edits.
 * A chord contributes one anchor per member, each with its own disjoint leaf, so a
 * member can be cleared without touching the others.
 *
 * DURATION IS NOT WRITABLE HERE, and that is a fact about Strudel, not a shortcut:
 * a held note's hap carries ONLY its pitch leaf in `context.locations` — the `@n`
 * never appears as a location of its own (observed by driving `reifyMini` on
 * `c3@2`, `[c3 e3]@2`, `c3 e3@2 g3`, `0@2 2`: every one reports a single location,
 * the pitch). So there is no span through which a duration could be spliced, and
 * writing one would mean AUTHORING `@n` syntax — exactly the modelling this whole
 * mechanism exists to delete. A resized or moved note is therefore REFUSED by the
 * writer, never approximated. See `spliceRollByLeaf`.
 */
interface RollLeafSource {
    /** the inner mini string the spans index into, byte-for-byte */
    src: string;
    /** one per played note, in play order */
    anchors: RollLeafAnchor[];
    /**
     * The column count these anchors were read against — the roll's equivalent of
     * the grid's `cols.length`, and a REQUIRED guard rather than bookkeeping.
     *
     * Anchors are PROVENANCE: they describe where each note's bytes live in a
     * source laid out one particular way. A restructure (`resizeRoll`) re-lays the
     * grid while carrying the model's other fields through, so the anchors survive
     * describing a layout that no longer exists. Widening leaves every note's start
     * and length intact, which passes the writer's per-note check and would write
     * the ORIGINAL source back, silently discarding the resize. Narrowing is worse:
     * the notes that fell outside the new width look to the writer exactly like
     * notes the user DELETED, and it would splice `~` over them — data loss from a
     * gesture that edited nothing.
     *
     * So the check belongs at the WIDTH, the thing a restructure changes, not at
     * the item — and in ONE place: `anchorsDescribe` (`serialize.ts`), which both
     * leaf writers call ([[P329]], #990).
     */
    steps: number;
    /** the width of the model these anchors were ATTACHED to — see `LeafSource` (#1235) */
    attachedSteps: number;
}
/**
 * One `,`-separated part of the source, and the columns it produced.
 *
 * A flat sequence and a `<…>` alternation are the one-part case; a `,`-stack
 * has several, each with its OWN resolution. `bd sd, hh*4` lays two columns
 * against four, and the grid shows both on the finer of the two — so a part's
 * regions are indexed in its own column space and `factor` maps them onto the
 * shared grid.
 */
interface SourcePart<C> {
    /** the lane `part` index these regions describe */
    part: number;
    /** columns per top-level step INSIDE this part */
    div: number;
    /**
     * Shared-grid columns spanned by each of this part's own columns.
     *
     * Always 1 for the roll: `parseRollLanes` requires every part to report the
     * same step count and refuses the pattern otherwise, so a roll's parts share
     * one column space by construction. The grid is the view that stretches
     * (`bd sd, hh*4` lays two columns against four).
     */
    factor: number;
    /** the bytes before this part's content — its `,` and padding — verbatim */
    before: string;
    /** the bytes after it */
    after: string;
    /** one entry per top-level element, in source order, tiling the part */
    regions: SourceRegion<C>[];
}
/**
 * The bytes a model was read from, in the pieces the writer puts back.
 *
 * Present only on a model parsed from source and not restructured since —
 * `resize` drops it, because a re-laid grid makes every region a lie. Absent on
 * models built from scratch, and then the writer rebuilds from the grid, which
 * is lossy and always was.
 */
interface NotationSource<C> {
    /**
     * The wrapper the parts sit inside, written back around them verbatim: `<`
     * and `>` (with the user's padding) for a multi-bar alternation, empty for a
     * flat sequence. Kept as bytes rather than a flag so `< a b >` keeps its
     * spaces.
     */
    prefix: string;
    suffix: string;
    parts: SourcePart<C>[];
}
/** Drum/step grid: lanes (sounds) × steps (columns). */
interface StepGridModel {
    /** total columns across all bars */
    steps: number;
    /**
     * The source this model was read from, for span surgery on write (#913).
     * The writer re-emits ONLY the regions whose content the user actually
     * changed and copies every other region's bytes through untouched, so an
     * edit cannot destroy notation it never touched (`bd hh*2 sd cp`, nudge a
     * cell in the `bd`, and the `*2` survives). Absent → the writer rebuilds the
     * whole string from the grid, which is lossy and always was.
     */
    source?: NotationSource<GridCells>;
    /**
     * Set when the alternation sits INSIDE the sequence (`bd <sd hh>`, #920) rather
     * than around the whole cycle. The writer uses this instead of `source`; the
     * two are mutually exclusive.
     */
    altSource?: AltSource<GridCells>;
    /**
     * Set by the LEAF-anchored projection (#986) for patterns whose notation no
     * element re-emit can reproduce. Takes precedence over both of the above and
     * is TERMINAL: a leaf grid is never rebuilt from its cells, because rebuilding
     * is exactly what would destroy the notation it was opened to preserve — an
     * edit it cannot express as a byte replacement is refused instead.
     */
    leafSource?: LeafSource;
    /**
     * The same leaf spans, overlaid on a view the ELEMENT writer owns (#1010 P4d) —
     * a write channel, never a projection.
     *
     * `leafSource` above answers two questions at once: which writer owns the view,
     * and where that writer's spans are. Those are different questions, and binding
     * them is what made P4d a routing problem. Routing is decided once per model;
     * both writers answer per EDIT. So a per-model choice between them is silently
     * wrong for half the gestures either way — measured, the leaf-first form buys 17
     * more faithful documents and costs 1,763 placements and the finer view on the
     * same views, because a leaf-anchored view takes a new note only where a rest was
     * indexed (#1154) and has no span to subdivide for a refine (#1058).
     *
     * This field asks only the second question. The view stays the element
     * projection — its columns, its placements, its view scale are untouched — and
     * the writer tries byte surgery at the note's own span FIRST, falling back to the
     * element re-emit for any edit surgery cannot express. Nothing restates the leaf
     * writer's refusal rule anywhere; it is simply asked.
     *
     * ⚠ NOT INTERCHANGEABLE WITH `leafSource`, and the asymmetry is the safety
     * property. A leaf-PROJECTED view is terminal: an edit it cannot express is
     * REFUSED, because the re-emit is exactly what would destroy the notation that
     * view was opened to preserve (`amen/4` clearing its only cell comes back as
     * `<~ ~ ~ ~>`, and the 275 shared-leaf deletes #1160 declines would start being
     * written by the other writer). Falling back is permitted only here, where the
     * element writer was already the incumbent and the fallback restores exactly
     * today's behaviour.
     *
     * ⚠ ASKED THROUGH `spans()`, WHICH PROJECTS ON FIRST USE — see `SurgicalOverlay`. The
     * field became a thunk when #1233 attached it on the CORE path too, where a second
     * eager projection is x25.5 rather than the derived path's +59%, because the core parse
     * is cheap enough that the extra projection IS the cost.
     */
    surgical?: LazyLeafSource;
    /** cycles the pattern spans via `<...>` alternation; absent = a single cycle */
    bars?: number;
    /**
     * How much finer than the DOCUMENT this model is drawn (#1055, #1116). Absent =
     * `UNREFINED` — the document's own resolution, which is what every path that does
     * not apply a scale reports. That default is what makes `documentSteps(model)`
     * total: a projection which ignores the scale carries 1, so its document width and
     * its drawn width are the same number, which is the truth for it.
     */
    viewScale?: number;
    /**
     * Lanes in presentation order. `sound` is the whole token incl. any
     * `:variant` (e.g. `bd:3`). `part` is the top-level `,`-stack the lane was
     * written in (absent = 0) — purely syntactic, kept so a hand-written stack
     * round-trips as the user wrote it instead of being flattened.
     */
    lanes: StepLane[];
    /**
     * Per-COLUMN velocity, length `steps`, indexed by serialized column (NOT by
     * lane — a stacked `[bd,sn]` column shares one gain). `1` is neutral; a model
     * with every gain at `1` (or `gains` absent) emits no `.gain`. Read from /
     * written to a parallel `.gain("v1 v2 …")` mini aligned to the columns the
     * grid serializes (rest columns serialize as `~`). Only single-part,
     * single-bar grids carry gain in the first cut; richer shapes leave any
     * existing `.gain` untouched (see `serializeStepGain`).
     */
    gains?: number[];
    /**
     * Set when a `.gain("…")` string was present on read-back but did NOT align
     * to the grid columns (wrong length, a broadcast `.gain("0.8")`, an `@`/`*`
     * we didn't write). The grid then leaves that `.gain` byte-identical and the
     * velocity drag is disabled — we never delete a gain we didn't author.
     */
    gainForeign?: boolean;
}
/**
 * One column of one lane: `false` for no trigger, or the note that starts there.
 *
 * WHY THIS IS NOT A BOOLEAN (#1010 P4b). A cell used to be one bit, so how long
 * its note sounds was not part of the model — and a writer cannot preserve an axis
 * its model never carried ([[PV239]]). Every duration loss on this surface starts
 * there: the element re-emit has nothing to write with except the view's own
 * resolution, so `[hh ~]!16` — sixteen notes each sounding for HALF a column —
 * comes back as sixteen notes of a full column, twice their length, and the pattern
 * is quietly a different pattern. The piano roll's note has carried `duration`
 * since the beginning and has never produced one of these.
 *
 * `false` rather than `null`/`undefined` for the off cell, so that the many places
 * which only ask "is anything here?" keep reading exactly as they did —
 * truthiness, `.some(Boolean)`, `filter(Boolean)`.
 */
type StepCell = false | StepNote;
/** A note occupying one grid cell. */
interface StepNote {
    /**
     * How long the note SOUNDS, in COLUMNS: `1` is exactly this column, `2` spans
     * the next one too, `0.5` sounds for the first half of it and is silent after.
     *
     * COLUMNS, not cycles, and both units are deliberately in play at this boundary.
     * `Onset.durs` is cycle-relative so that no reader needs to know the grid's
     * resolution; a CELL is already positioned in the grid, and every consumer of
     * this field reasons in columns — the ×2/÷2 resolution ops, resize, and (P4c) the
     * printer deciding whether a note even needs a `[x ~]` to be spelled.
     * `RollNote.duration` is the same unit, which is what makes the two surfaces
     * comparable and is the direction #1032 goes.
     *
     * FRACTIONAL IS NORMAL — this is where it differs from the roll's integral `@n`.
     * Measured over the 1535-unit corpus: ~206 units carry a length that is not 1,
     * and 5 are sub-column (`[hh ~]!16` → 0.5, `[bd@0.5 - - -]` → 0.1429). A
     * consumer that assumes integers is wrong about real corpus material.
     */
    duration: number;
}
interface StepLane {
    sound: string;
    part?: number;
    cells: StepCell[];
}
/** A single note in the piano roll. */
interface RollNote {
    /** note token, e.g. `c3`, `eb4` */
    pitch: string;
    /** column index where the note begins */
    start: number;
    /**
     * Length in COLUMNS — frequently fractional, and not a count of `@n`s. `@n` is a
     * relative weight (`n / Σweights` of the enclosing sequence), so a whole `@n` lands on
     * whatever share of a column that works out to. The writer spells this back as `@n`
     * where it can, including fractionally, and declines below one column.
     */
    duration: number;
    /**
     * Per-note velocity. `1` (or absent) is neutral and emits no `.gain`. Chord
     * members sharing a `start` share one gain (like duration); on read-back the
     * group's gain is applied to all its members. Written to a parallel
     * `.gain("…")` mini that mirrors the note sequence's group/`@n`/rest
     * structure. Only single-bar rolls carry gain in the first cut.
     */
    gain?: number;
}
/** Pitched (melodic) grid: notes placed on a pitch × time grid. */
interface PianoRollModel {
    /** total columns across all bars */
    steps: number;
    /**
     * The source this model was read from, for span surgery on write (#916) —
     * the roll's half of what `StepGridModel.source` does for the grid. A region
     * owns columns `[from, to)` and the notes STARTING in that range are its own;
     * unchanged ones write their bytes back, so `C D` stays `C D` rather than
     * coming back lowercased for the crime of being looked at. Absent → the
     * writer rebuilds from the model, which is lossy and always was.
     */
    source?: NotationSource<RollNote[]>;
    /**
     * Set when the alternation sits INSIDE the sequence (`0 <2 3> 5`, #920) rather
     * than around the whole cycle. The writer uses this instead of `source`; the
     * two are mutually exclusive.
     */
    altSource?: AltSource<RollNote[]>;
    /**
     * Set by the LEAF-anchored projection (#986 P1b) for patterns whose notation no
     * element re-emit can reproduce — the roll's half of `StepGridModel.leafSource`,
     * and TERMINAL for the same reason: a leaf roll is never rebuilt from its notes,
     * because rebuilding is what would destroy the notation it was opened to
     * preserve. An edit it cannot express as a byte replacement is refused instead.
     */
    leafSource?: RollLeafSource;
    /**
     * The same leaf spans overlaid on a view the ELEMENT writer owns (#1010 P4e) — the
     * roll's half of `StepGridModel.surgical`, with the same meaning and the same
     * asymmetry against `leafSource` above.
     *
     * `leafSource` answers two questions at once: which writer owns the view, and where
     * that writer's spans are. This field asks only the second. The view stays the
     * element projection — its columns, its notes, its view scale untouched — and
     * `serializePianoRollWithExtent` tries byte surgery at each note's own span FIRST,
     * falling back to the element paths for anything surgery cannot express.
     *
     * ⚠ NOT INTERCHANGEABLE WITH `leafSource`, and the asymmetry is the safety property.
     * A leaf-PROJECTED roll is terminal: an edit it cannot express is REFUSED, because
     * the rebuild is what would destroy the notation the view was opened to preserve, and
     * falling back would hand the re-emit the shared-leaf deletes #1160 declines. Falling
     * back is permitted only here, where the element writer was already the incumbent, so
     * it can only restore today's behaviour and never introduce a write.
     *
     * ⚠ DECIDED ON THE ROLL, NEVER BY ANALOGY WITH THE GRID. `projectPianoRollDerived`
     * records the two surfaces answering the same routing flip with opposite signs — the
     * roll loses ten units of reach where the grid gains five — which is exactly why P4d's
     * result could not simply be assumed here and why every figure behind this field was
     * taken on the roll.
     *
     * ⚠ ASKED THROUGH `spans()`, exactly as the grid's is — see `SurgicalOverlay` for why
     * the projection is deferred and what the memo guarantees.
     */
    surgical?: LazyRollLeafSource;
    /** cycles the pattern spans via `<...>` alternation; absent = a single cycle */
    bars?: number;
    /**
     * How much finer than the DOCUMENT this model is drawn — the roll's half of
     * `StepGridModel.viewScale`, with the same meaning and the same default (#1055,
     * #1116). Absent = `UNREFINED`, which is the truth for every projection that does
     * not apply a scale and is what keeps `documentSteps(model)` total.
     *
     * ⚠ A ROLL COLUMN IS NOT A GRID COLUMN: `steps` here is a column COUNT that
     * `start`/`duration` are measured in, so a refine multiplies all three together.
     */
    viewScale?: number;
    notes: RollNote[];
    /** see `StepGridModel.gainForeign` — a `.gain` we read but don't manage. */
    gainForeign?: boolean;
    /**
     * The pitch tokens are bare integers (`note("60 62")` MIDI, `n("0 1 2")`
     * degrees) rather than note names (#469). Row math is the same (the number
     * IS the row), but new/dragged notes must emit numbers, not `c4`, so the
     * pattern round-trips. A pattern mixes one convention or the other, never
     * both (mixed is rejected at parse).
     */
    numeric?: boolean;
}
/**
 * WHY a view declined a pattern — the gate that actually stopped it (#990).
 *
 * Three writers stack behind one parse call (syntactic core → element projection
 * → leaf projection), and before this the `reason` string was whichever one
 * declined FIRST — almost always the core, describing a subsystem that often had
 * nothing to do with why the unit was unavailable. Measured over 1500 real units,
 * every pattern reporting "nested groups are beyond the editable subset" was in
 * fact stopped by a wrong-surface value or an unstable period; not one was stopped
 * by anything to do with nesting. A gate names the real cause.
 *
 * These are not a new list of features. Each is one face of the single editability
 * invariant — a played onset is editable iff it maps to a unique disjoint source
 * span, in a view that stays true:
 *   - `wrong-surface`      the values belong to the OTHER view (a drum pattern
 *                          asked of the piano roll, a number asked of the grid).
 *                          Not an editability failure — a routing fact.
 *   - `no-note-content`    nothing placeable sounds at all: a params/signal value,
 *                          a zero-length hap, silence, or a query that threw.
 *   - `unstable-period`    what it plays does not repeat inside the projection's
 *                          bar window, so any view of it stops being true.
 *   - `mixed-pitch-domain` numeric and named pitches in one pattern (roll only).
 *   - `irrational-onset`   an onset/duration/boundary that lands on no column.
 *   - `resolution`         the columns needed exceed the step ceiling.
 *   - `element-tiling`     the source's top-level elements do not tile the played
 *                          columns — the element writer's half of the bijection.
 *   - `no-leaf-anchor`     a played note has no source token of its own, or two
 *                          notes claim overlapping bytes — the leaf writer's half.
 *   - `note-crosses-bar`   a played note does not fit inside the bar it starts
 *                          in, so no column layout can hold it. Deliberately NOT
 *                          folded into `no-leaf-anchor`: such a note has a
 *                          perfectly good source token, and folding it in would
 *                          overstate the write-back guard — the exact kind of
 *                          misattribution this vocabulary exists to end.
 *   - `edit-unsafe`        the write-back probe and the engine disagreed.
 *   - `view-unusable`      the view opens but no single edit is expressible.
 *   - `no-finer-view`      a REFINED request came back unrefined: the path that
 *                          owns the pattern answered, and its answer does not
 *                          carry the requested scale. Distinct from
 *                          `view-resolution`, which is the ceiling saying no —
 *                          here nothing was too large, the owner simply has no
 *                          finer view to give. Reachable only through a refined
 *                          ask, which is why it went unnamed until #1132.
 *   - `not-a-pattern`      it does not reify at all; the core's own syntax
 *                          message is the better answer and is kept.
 */
type Gate = 'wrong-surface' | 'no-note-content' | 'unstable-period' | 'mixed-pitch-domain' | 'irrational-onset' | 'resolution'
/**
 * The VIEW asked for more columns than it may draw (#1055). Distinct from
 * `resolution`, which is the DOCUMENT's own blow-up guard: this one says the
 * document is fine and the requested magnification is not. Cannot fire while the
 * view scale is `UNREFINED`, since the document ceiling (64) is below the view
 * ceiling (256) — see `viewResolution.ts`.
 */
 | 'view-resolution' | 'element-tiling' | 'no-leaf-anchor' | 'note-crosses-bar' | 'edit-unsafe' | 'view-unusable' | 'no-finer-view'
/**
 * The source spells this content with a backslash escape (#1254). Narrower than
 * `not-a-pattern`, and separated from it deliberately: that gate means "nothing
 * reified, and the core's own message names the syntax", which is the better
 * answer and is why an unreified refusal is allowed to stay unnamed. This one is
 * the case where the core's message CANNOT be the better answer, because the
 * backslash is not something the author wrote into the pattern.
 *
 * A double-quoted literal is reified by the transpiler from `node.value`, the
 * JS-COOKED string, while the editor models the DOCUMENT SLICE between the quotes
 * — so every JS escape leaves a backslash on our side that the engine never sees.
 * A backtick literal cannot diverge (the raw text is what runs), and there the
 * backslash really is in the pattern and krill really does refuse it. The sentence
 * below is therefore written to be true of both, naming what is observable in the
 * string rather than a cause only the reader could know.
 */
 | 'escaped-source' | 'not-a-pattern';
/**
 * Parse outcome. `ok: false` is a first-class result, not an exception — every
 * panel checks it on open and disables itself (code-only) when the pattern is
 * outside the editable subset.
 *
 * `gate` is present whenever a projection ran and declined — the machine-readable
 * half of `reason`, so a measurement buckets by cause instead of by string match.
 * Absent when the refusal is the syntactic core's own (nothing reified).
 */
type ParseResult<M> = {
    ok: true;
    model: M;
} | {
    ok: false;
    reason: string;
    gate?: Gate;
};

/**
 * How much finer than the document the view draws. A whole-number multiplier ≥ 1;
 * `1` is the document's own resolution. Never an absolute column count — see the
 * header for why that distinction is the whole reset rule.
 */
type ViewScale = number;

/**
 * THE PUBLIC ENTRY, and the only place a caller can express a view resolution.
 *
 * #1055 threaded `ViewScale` into the DERIVED projections. But the core answers first
 * and answers for most patterns — 783 of the 958 corpus units that open the grid,
 * including `bd ~ sn ~`, the case #1052 is named after — so a scale that stopped at
 * the derived path could not reach 94% of the free-zone offers it exists to serve
 * (#1116). The core now carries it too, and the scale enters HERE so both halves get
 * the same number from the same caller.
 *
 * The order is unchanged and deliberately so ([[PK58]]): core, then derived. A view
 * scale must NOT re-route a pattern to a different projection, because the core and
 * the derived path build different `source` structures and therefore hand the document
 * to different writers — zooming would silently swap the writer that owns the user's
 * bytes. The finer view has to come from whichever writer already owns the pattern.
 *
 * ⚠ THAT GUARANTEE IS WHY OWNERSHIP IS ASKED AT `UNREFINED`, ALWAYS, and the first
 * version of this entry did not have it. Asking the core AT THE SCALE conflates two
 * different noes: "I do not own this pattern" (fall through to the derived path) and
 * "I own it but cannot draw it finer yet" (the alt-element path's refusal). Both
 * arrive as `ok: false`, so the scale refusal fell through and the derived projection
 * answered instead — measured, **20 grid and 17 roll units changed writer on a zoom**,
 * and 36 of the 37 were faithful magnifications that would have shipped in silence.
 * Routing is a property of the PATTERN, so it is decided at the pattern's own
 * resolution and the scale is applied only by the path that already owns it.
 */
declare function parseStepGrid(mini: string, viewScale?: ViewScale): ParseResult<StepGridModel>;
/**
 * THE PUBLIC ENTRY for the roll, and the only place a caller can express a view
 * resolution — the roll's twin of `parseStepGrid`, for the same reason and with the
 * same ordering guarantee (#1116). 412 of the 544 corpus units that open a roll are
 * core-parsed, so a scale that stopped at the derived projection was unreachable for
 * 93% of the free-zone offers it exists to serve.
 *
 * Core, then derived, unchanged: a view scale must not re-route a pattern to a
 * different projection, because the two build different `source` structures and so
 * hand the document to different writers. Ownership is therefore asked at `UNREFINED`
 * — see `parseStepGrid` for the measurement that forced this, and for why a core that
 * refuses the SCALE must not read as a core that refuses the PATTERN.
 */
declare function parsePianoRoll(mini: string, viewScale?: ViewScale): ParseResult<PianoRollModel>;

/**
 * Notation models → mini-notation. The round-trip law (golden-tested):
 *   serialize(parse(s).model) === s   for canonical strings
 *   parse(serialize(m)).model ≡ m
 *
 * Canonical form: single-space separated, lanes in first-appearance order,
 * multi-bar patterns as a whole-string `<...>` alternation (one slot per bar),
 * `,`-stack parts in ascending part order. Serializing a model the subset
 * can't express (overlapping roll notes, a note straddling a bar line) returns
 * null and the panel keeps the document untouched.
 */

/**
 * The mini a grid model writes back, or null where it has no spelling.
 *
 * Every caller that only needs the bytes uses this; the extent above is for the
 * ones asking how much of the document moved. One implementation, so the two can
 * never disagree about what was written.
 */
declare function serializeStepGrid(model: StepGridModel): string | null;
/**
 * The mini a roll model writes back, or null where it has no spelling.
 *
 * A projection of the function above, never a second implementation, so the bytes a
 * caller gets and the path the census reads can never describe different writes.
 */
declare function serializePianoRoll(model: PianoRollModel): string | null;

/**
 * Note-token ↔ MIDI helpers for the piano roll's vertical axis.
 *
 * Numeric convention matches the engine's `noteToMidi` (`c3 = 48`,
 * `eb4 = 63`). Accidentals accept Strudel's three spellings on read — `#`,
 * `b`, and `s` (`cs3`) — and emit `#` on write. Conversion only feeds row
 * placement and newly-created notes; the round-trip itself stores the token
 * verbatim, so emission style never threatens fidelity for existing notes.
 */
/**
 * `c3` / `c#3` / `cs3` / `eb4` → MIDI number, or null if not a note token.
 * The octave is OPTIONAL — a bare name (`c`, `eb`, `f#`) defaults to octave 3,
 * matching Strudel (`note("c")` plays C3). A bare integer (`60`, `0`, `-7`)
 * maps to that row directly — `note("60")` is MIDI; `n("0")` is a degree/index.
 * Either way the number IS the row, and the verbatim token is what the
 * serializer writes back (#469).
 */
declare function pitchToMidi(token: string): number | null;
/** MIDI number → canonical note token (sharps as `#`). Inverse of pitchToMidi. */
declare function midiToPitch(midi: number): string;
/** Is this MIDI pitch a black key (for striping the roll's pitch rows)? */
declare function isBlackKey(midi: number): boolean;

/**
 * Insert a note into a roll, resolving overlaps so the result stays a flat,
 * tileable sequence (what the serializer requires). DAW-style resolution:
 *  - a group already at `start` → the note joins the chord, adopting its duration.
 *    ⚠ THAT IS A PRODUCT RULING, NOT A WRITER CONSTRAINT, and the distinction is the
 *    one #1310 was about. "Chord members share one duration" was true of what this
 *    file could SPELL, and since the region writer learned parallel lanes it is not:
 *    `[g3@2 ~ ~, [c3,e3]@4]` says a chord whose members differ, and round-trips. So
 *    honouring a different requested length is available and we decline it — adding a
 *    voice to a chord is a gesture that shares the chord's length, and the compact
 *    spelling is the one the user wrote. Chosen, not forced;
 *    ⚠ where the notes at `start` DISAGREE about their length there is no single
 *    duration to adopt, and today the answer is whichever note the array holds first.
 *    That is live and pre-existing — 856 asks over the corpus reach such a start — and
 *    it is #1314, to be fixed with #1315 since both change what the writer is asked to
 *    spell and need one reach measurement between them;
 *  - an earlier note OF THE SAME PITCH sustaining across `start` → it trims to end at
 *    `start`. Other pitches sustaining through the column are left alone (#1310): they
 *    are voices the gesture did not touch, and the region writer can now spell a chord
 *    whose members have different lengths, so nothing forces them shorter;
 *  - the next group (or the grid end) caps the new note's duration.
 */
declare function placeNote(model: PianoRollModel, pitch: string, start: number, duration: number, opts?: RollWriteOptions): PianoRollModel;
/** Options a caller may tighten a roll write with. */
interface RollWriteOptions {
    /**
     * Require the result to READ BACK, not merely to spell (#1331). Off by default because
     * it parses, and the roll's writers run per drag frame; the panel turns it on once at
     * gesture commit, where one parse is affordable.
     */
    readback?: boolean;
}

type ResizeMode = 'spread' | 'pad';
/**
 * Both modes clamp lengths (`clampLane`) for the same reason `quantizeStepGridTo` and
 * `resizeRoll` do: rounding hits onto a coarser grid, or truncating one, can leave a
 * note reaching past the next hit or past the end of the grid, and neither is
 * something the writer could spell. The roll has always clamped here; the grid could
 * not, because a cell had no length to clamp (#1010 P4b).
 */
declare function resizeGrid(model: StepGridModel, nextSteps: number, mode: ResizeMode): StepGridModel;
declare function resizeRoll(model: PianoRollModel, nextSteps: number, mode: ResizeMode): PianoRollModel;

/**
 * VisualEditStandby — the empty state every write-back panel shows when there
 * is nothing editable to bind to (no pattern under the cursor, or the pattern
 * is outside the panel's editable subset).
 *
 * This is a first-class state, not a placeholder: the design's conservatism
 * rule (§4, §6) says a panel that can't safely round-trip a pattern stays in
 * standby rather than guess. The scaffold seeds all three tabs with it; each
 * panel swaps in its live UI when a compatible chunk is in focus, and falls
 * back here otherwise.
 *
 * Vocabulary discipline (PV32 / D-06): musician-facing copy only, no IR jargon.
 */

interface VisualEditStandbyProps {
    /** the panel id, used for a stable test hook */
    panel: string;
    /** one-line musician-facing hint, e.g. "Click a pattern to edit its knobs." */
    hint: string;
    /** optional codicon name (without the `codicon-` prefix) for the glyph */
    icon?: string;
}
declare function VisualEditStandby({ panel, hint, icon, }: VisualEditStandbyProps): React.ReactElement;

/**
 * division — pure snap/quantize helpers for the Pattern grids (#432 Slice 2).
 *
 * A "division" is the musical grid the user snaps move/resize to (Logic's Snap
 * value): 1/4, 1/8, 1/16 and their triplets, plus `'grid'` = the pattern's own
 * native cell (no extra snapping — the default, byte-identical to pre-#432
 * behaviour).
 *
 * The grids work in integer step COLUMNS, so a division only snaps cleanly when
 * it divides the grid evenly: the snap interval in columns is
 * `stepsPerBar / notesPerBar`, and a division is REPRESENTABLE only when that's
 * a whole number ≥ 1. A 16-step bar snaps to 1/4 (interval 4), 1/8 (2), 1/16
 * (1) but NOT 1/8-triplet (16/12 = 1.33…) — triplets need a triplet grid
 * (e.g. 12 steps). Non-representable divisions are surfaced DISABLED in the
 * picker, never silently no-op'd (an honest control — pre-mortem #5).
 *
 * Time signature is assumed 4/4 (the grid model carries no metre): a bar is
 * 4 quarters / 8 eighths / 16 sixteenths / 12 eighth-triplets / 24
 * sixteenth-triplets. Documented limit for #432.
 *
 * Pure (no React, no DOM) so both the Piano Roll (snaps its move/resize) and the
 * Mixer (renders the picker, greys out non-representable options) share one
 * source of truth — one snap path, no drift.
 */
/** the snap grids the picker offers; `'grid'` = native cell (no extra snap) */
type Division = 'grid' | '1/4' | '1/8' | '1/16' | '1/8T' | '1/16T';

/**
 * WHAT SETTING THE GRID TO `target` DID TO THE NOTES — reported by the op, never
 * reconstructed from its output (#1061).
 *
 * The control has to tell the user what a press costs BEFORE they make it, and a
 * coarsening can cost three different things independently. `SlotState` names the
 * MECHANISM (`lossless` / `quantize`); this names the CONSEQUENCES, which is what the
 * copy is actually about. Splitting them is deliberate: one control with one label
 * covering several effects is what left the last gate certifying a control that no
 * longer existed, and widening a single verdict until the arithmetic comes out buries
 * the very distinction the user needs.
 *
 * Every field is counted inside the loop that causes it, so a caller cannot describe a
 * write the op did not make. A DECLINED op reports `NO_EFFECT` — nothing happened, so
 * nothing is claimed.
 */
interface GridResolutionEffect {
    /**
     * notes held at one column because scaling would have put them BELOW one, and the
     * grid has no spelling for half a column. These sound LONGER than they did — the
     * length grows to the coarsest thing the new grid can say (#1061).
     */
    lengthened: number;
    /** notes whose onset moved off its exact proportional position — i.e. timing changed */
    snapped: number;
    /** notes that landed on a column their own lane had already filled, and merged */
    merged: number;
}
/**
 * how setting the grid to `target` slots behaves, for the control's label/state.
 *
 * `view` is the free zone (#1057): the click changes only how finely the panel DRAWS
 * the pattern and leaves the document byte-identical. Every other member still writes.
 */
type SlotState = 'active' | 'view' | 'lossless' | 'quantize' | 'disabled';

/**
 * ResolutionControl — the "Slots" grid-resolution control shared by both grids
 * (#479, reshaped by #1059).
 *
 *     Slots   ÷2   [ 16 ]   ×2
 *                    ▲ double-click → 4 / 8 / 16 / 32 / 64
 *
 * ── WHY RELATIVE STEPS AND NOT ABSOLUTE PRESETS ───────────────────────────────
 * `RESOLUTION_PRESETS` are absolute counts — the right vocabulary for a document
 * op ("make this pattern 16 elements"), the wrong one for a VIEW derived from the
 * pattern's own resolution. A 3-element pattern's clean finer views are 6, 12, 24
 * and none of them is a preset, so under absolutes every offer it gets is a
 * rewrite. Measured over the corpus (#1059): 334 grid offers / 219 roll offers
 * still wrote the file for that reason alone, and a ×k vocabulary converts every
 * one of them — grid 96 of 96 units, roll 64 of 64, none stranded.
 *
 * `freeZoneScale` never needed changing for this: its only shape test is
 * `target % docSteps`, so it already admits any whole multiple. The picker was the
 * one layer still speaking absolutes.
 *
 * ── GROUNDED IN THE DAW STANDARD, NOT INFERRED ────────────────────────────────
 * This is Ableton's model. Live drives its grid with *Narrow Grid* (Cmd-1), which
 * doubles grid density, and *Widen Grid* (Cmd-2), which halves it — relative
 * stepping is the primary interaction, and the absolute value stays on screen as a
 * readout rather than as the thing you click. Logic likewise offers a Division
 * value (1/1 … 1/64) you can also pick directly. So: steps to move, readout to
 * know where you are, dropdown to jump.
 *
 * ⚠ THE READOUT IS A COUNT, NOT A NOTE VALUE, AND THAT IS A DELIBERATE DIVERGENCE.
 * Every DAW labels this "1/16". That label asserts the cycle is a 4/4 bar, which
 * Strudel does not guarantee — `cps` is free and a pattern can be any length — so
 * "1/16" would be true only by coincidence. "16 slots" is what we can actually
 * warrant.
 *
 * ── THE TWO ZONES, AND WHERE THE LINE BETWEEN THEM ACTUALLY SITS ──────────────
 * Every target this control offers falls in one of two zones, and the boundary is
 * ONE number: the count the DOCUMENT itself spells (`documentSteps`, not `steps` —
 * `steps` is what is currently drawn, which may be a refined view of it).
 *
 *     target  >=  document count   →  FREE.   Nothing is written. The panel just
 *                                     draws the same notation more or less finely.
 *     target  <   document count   →  WRITES. This is an edit to the user's file.
 *
 * ⚠ THE ZONE IS NOT THE DIRECTION. The natural reading of a ÷2 / ×2 pair is "up is
 * a view, down is a rewrite", and it is wrong in the half nobody looks at. Coming
 * back DOWN through a refined view is free the whole way to the document — that is
 * exactly what makes refining reversible, and `freeZoneScale(D, D)` returns
 * `UNREFINED` by construction to say so. Only going below the document is an edit.
 *
 * So ÷2 is not one control with one meaning. Standing on a ×4 view of a 4-column
 * pattern, ÷2 is free; standing on the document itself, the same button is an edit
 * (and on the grid, a refused one). Which is why every button here ASKS `slotState`
 * for its own target rather than deriving anything from the arrow it is drawn with.
 *
 * Measured over every standing a user can occupy (#1059 — 3571 grid standings,
 * 1982 roll):
 *   - ×2 upward .................. 3420 free / 82 refused (leaf units, by design)
 *   - ÷2 staying >= document ..... 2613 grid / 1438 roll, ALL free — not one write
 *                                  leaks into the descent
 *   - ÷2 below the document ...... grid 546 of 546 REFUSED; roll 223 live writes
 *
 * That last asymmetry is the two surfaces disagreeing honestly, not a bug: the grid
 * preserves note length, and half a column has no spelling, so the writer declines
 * and the control says so. The roll carries a duration natively and can write it.
 * Whether the grid should offer anything there at all is #1061's product call.
 *
 * ── HOW A TARGET IS DRAWN ─────────────────────────────────────────────────────
 * Every button asks `slotState` for the target it would apply — the SAME call the
 * grid runs on click, never a prediction of it. States:
 *   - `active`   — the current count (highlighted, not clickable);
 *   - `view`     — the free zone (#1057): a whole multiple of what the DOCUMENT
 *      spells, so the panel simply draws the same notation more finely and your
 *      file is not touched at all. Drawn normal, and the tooltip says so — a user
 *      deciding whether it is safe to press should not find out by pressing;
 *   - `lossless` — writes, but every hit keeps its position (haps identical);
 *   - `quantize` — writes, and notes snap to the nearest new slot, so timing moves;
 *   - `disabled` — not offered.
 *
 * ⚠ THE `~` CUE MEANS ONE THING: THIS IS ABOUT TO REWRITE YOUR FILE (#1059). It
 * used to mark `quantize` alone, i.e. "this changes your timing". Since Phase 4
 * refining never writes at all, the honest split is no longer straight-vs-quantized
 * but FREE-vs-WRITES — and `lossless` is on the writing side of it (2 live offers
 * on the roll, 0 on the grid). Cueing only `quantize` would leave a file-rewriting
 * button drawn exactly like a free one.
 */

interface ResolutionControlProps {
    /** current column count — the active preset */
    steps: number;
    /** how setting the grid to `target` behaves (active / lossless / quantize / disabled) */
    slotState: (target: number) => SlotState;
    /** scale the grid to `target` columns */
    onScaleTo: (target: number) => void;
    /**
     * What pressing `target` would COST, asked of the op (#1061). `slotState` names the
     * mechanism; this names the consequences, and they are genuinely independent — a
     * coarsening can keep timing and still lengthen notes, or move timing and lengthen
     * nothing. Folding both into one label would hide whichever the user cared about.
     *
     * Optional, and the copy degrades to the mechanism alone without it: the piano roll
     * carries note duration natively, so it has no sub-column floor to report. Supplying
     * it is what a surface does when it has an effect to declare, not a requirement.
     */
    effect?: (target: number) => GridResolutionEffect;
}

/**
 * Mixer — the Pattern tab's cursor-bound inspector (#381).
 *
 * Finds the Strudel statement under the cursor (via `useActiveChunk`) and shows
 * its full knob chain. Since S4b the body itself lives in `MixerBody` (shared
 * with the Mixer console's per-strip expand drawer); `Mixer` is the thin wrapper
 * that supplies the *cursor* binding: it tracks the chunk under the cursor and
 * shows a standby when there's nothing editable there, then delegates the body
 * (picker + Snap + transforms + knob grid) to `MixerBody`. Behaviour is
 * unchanged from the pre-S4b single-file component — same write path, same DOM,
 * same #381 tests.
 *
 * Standby fires when the cursor isn't in a chunk with an editable chain (the
 * conservatism rule); `MixerBody` itself never standbys (an empty-chain chunk
 * still shows the transforms row to ADD effects — wanted in the drawer).
 */

interface MixerProps {
    /** Piano-Roll snap/quantize division (#432 Slice 2), owned by PatternPanel */
    division?: Division;
    onDivisionChange?: (d: Division) => void;
    /** grid-resolution ("Slots") control lifted from the active grid (#601) */
    resolution?: ResolutionControlProps | null;
}
declare function Mixer({ division, onDivisionChange, resolution }?: MixerProps): React.ReactElement;

/**
 * Sequencer — drum/step grid (#382, per-column velocity #409).
 *
 * Parses the mini-notation of the `s(...)` / `sound(...)` statement under the
 * cursor into a `StepGridModel` and renders lanes × steps. Toggling a cell
 * re-serializes the model and writes it back over the mini-notation range
 * (`'seq'`); a drag paints multiple cells as ONE undo step. Anything outside
 * the editable grid subset (`{}`, `/`, …) → standby, code-only — the
 * conservatism rule.
 *
 * Length: a note is drawn across the columns it covers (#1056) and its trailing
 * edge carries a handle that sets how long it sounds, in whole columns (#1053) —
 * the roll's gesture on the other surface. The handle is drawn only where the
 * writer would take the drag, so it never promises an edit the document refuses.
 *
 * Velocity: an ON cell shows its level as a bottom-anchored fill; dragging it
 * vertically sets the column's gain (DAW velocity-lane behaviour — drag down to
 * soften). The level is written to a parallel `.gain("…")` mini aligned to the
 * serialized columns; when every column returns to neutral the `.gain` is
 * removed. Gain is single-part / single-bar only; richer shapes keep toggling
 * but the `.gain` is left untouched.
 *
 * The model lives in component state, not derived per-render from the chunk, so
 * a lane the user clears completely keeps its row. The model is reseeded only
 * on EXTERNAL edits — see `useGridModel`.
 */

interface SequencerGridProps {
    /** lift the grid-resolution ("Slots") control to the Pattern inspector (#601) */
    onResolution?: (r: ResolutionControlProps | null) => void;
}
declare function SequencerGrid({ onResolution }?: SequencerGridProps): React.ReactElement;

/**
 * inspector — the Pattern grids' selection key + the shared `.gain` (velocity)
 * write transforms.
 *
 * (Named for the former Mixer-as-inspector; the inspector panel was removed —
 * pitch/position/velocity are read straight off the grid — but the selection
 * KEY and the velocity transforms it shared with the grids live on. Selection
 * is now the ⌘/Ctrl-click copy/paste target (#528); the velocity transforms are
 * the grids' vertical-drag write path.)
 *
 * A "selected" cell is a lightweight key, not a reference, so it survives the
 * model reseed every write triggers:
 *   - roll: keyed by `pitch` token + `start` column;
 *   - step: keyed by `lane` index + `step` column.
 *
 * VELOCITY = `.gain` (grounded #427 Q1). `setGroupGain`/`setColumnGain` live
 * HERE so the grid drag writes the SAME `.gain` transform everywhere — one path,
 * no dual-representation drift (PV129).
 */

/** The cell a grid has selected, keyed by stable musical identity. */
type SelectedNote = {
    kind: 'roll';
    pitch: string;
    start: number;
} | {
    kind: 'step';
    lane: number;
    step: number;
};

/**
 * Piano Roll — note grid (#383, drag-move + range stability from #391).
 *
 * Parses the mini-notation of the `note(...)` / `n(...)` statement under the
 * cursor into a `PianoRollModel` and renders pitch rows × step columns.
 * Interactions:
 *   - click an empty cell → place a note (one step; overlaps resolved);
 *   - click a note → remove it;
 *   - drag a note → move it in pitch + time (duration preserved), one undo;
 *   - drag a note's right-edge handle → resize its duration (`@n`), one undo.
 * Each edit re-serializes and writes back over the mini range (`'roll'`); a
 * serialization the subset can't express (e.g. a move that would overlap) is
 * dropped, leaving the document untouched — the conservatism rule.
 *
 * The visible pitch range is sticky within a binding: it expands to fit notes
 * but never shrinks when notes are removed, and resets only when the cursor
 * moves to a different statement (#391) — so editing doesn't make rows jump.
 */

interface PianoRollGridProps {
    /** the inspector's selected note (#432), owned by PatternPanel */
    selected?: SelectedNote | null;
    onSelect?: (sel: SelectedNote | null) => void;
    /** snap/quantize division for move + resize (#432 Slice 2), owned by PatternPanel */
    division?: Division;
    /** lift the grid-resolution ("Slots") control to the Pattern inspector (#601) */
    onResolution?: (r: ResolutionControlProps | null) => void;
}
declare function PianoRollGrid({ selected, onSelect, division, onResolution, }?: PianoRollGridProps): React.ReactElement;

/**
 * Pattern — the single adaptive visual-editing panel (#398).
 *
 * One tab that follows the cursor instead of three the musician has to choose
 * between. `chunkSurface` decides which grid editor the focused pattern needs:
 * a drum pattern (`s`/`sound`) gets the Sequencer step grid, a melody
 * (`note`/`n`) gets the Piano Roll, and — since #1240 — a unit whose content
 * span the RESOLVER named is routed on its content, because its head (`lpf`,
 * `seq`, `pick`, or none) says nothing about which view the values belong to.
 * Anything with no content span still shows a standby hint. The Mixer is pinned on the right for whatever is focused — it edits the
 * numeric chain args of any pattern, so it stays constant across the switch.
 *
 * This is pure composition: SequencerGrid / PianoRollGrid / Mixer keep their
 * own binding, write-back and standby behaviour unchanged. Each binds the
 * active chunk independently through useActiveChunk, so they all converge on
 * the same pattern under the cursor; this panel only picks which grid mounts.
 *
 * There is no "both grids at once" case — `chunkSurface` returns exactly one
 * surface, and the cursor→chunk binding resolves exactly one chain.
 */

declare function PatternPanel(): React.ReactElement;

/**
 * patternKind — the HEAD discriminator: which grid editor a chunk's chain head
 * asks for. `s`/`sound` make a drum/step pattern (Sequencer), `note`/`n` make a
 * melodic one (Piano Roll), and those are mutually exclusive.
 *
 * ⚠ KEEP THIS MODULE FREE OF THE NOTATION PARSER. `mixer/stripModel.ts` imports
 * it and the engine reaches that through `bareCapture.ts`, so a
 * `notation/parse.ts` edge here puts `@strudel/mini`'s krill parser into
 * `StrudelEngine`'s module graph — which breaks a `vi.mock` factory there at
 * LOAD and kills a 37-test suite, with both typechecks still at baseline.
 * Measured, not hypothetical: it happened while building #1240.
 *
 * That constraint is also the domain line. Until #1240 the head was the only
 * signal, so "what kind of head is this" and "which surface should this content
 * open" were one question. A resolver-supplied span has a head that says
 * nothing (`lpf`, `seq`, `pick`, none at all), so the second question now needs
 * the content parsed and the first still must not. The content-aware router
 * lives in `surfaceRoute.ts` and composes this one.
 *
 * One home per question, so the Sequencer, Piano Roll, the Pattern panel that
 * switches between them, and the coverage harness that scores them can't drift
 * on what counts as drum vs melody (PV108 spirit).
 */

/** the sequencer only edits sound/sample patterns; notes go to the Piano Roll */
declare function isStepChunk(chunk: ChunkInfo): boolean;
/** the piano roll only edits melodic patterns */
declare function isRollChunk(chunk: ChunkInfo): boolean;
type PatternKind = 'step' | 'roll' | null;
/**
 * Which grid editor the chunk's HEAD asks for, or null.
 *
 * Head-only and deliberately so — this module must stay free of the notation
 * parser. `mixer/stripModel.ts` imports it and the engine reaches that through
 * `bareCapture.ts`, so a `notation/parse.ts` edge here puts the krill parser in
 * `StrudelEngine`'s graph and breaks a mocked test suite at load. For the
 * content-aware answer (a span the resolver named, whose head says nothing),
 * call `chunkSurface` in `surfaceRoute.ts`.
 */
declare function patternKind(chunk: ChunkInfo | null): PatternKind;

/**
 * surfaceRoute — which grid a chunk's CONTENT belongs to (#1240).
 *
 * ── WHY THIS IS NOT IN `patternKind.ts` ──────────────────────────────────
 * It was, for about an hour, and the editor suite said no. `patternKind` is
 * imported by `mixer/stripModel.ts`, which the engine reaches through
 * `bareCapture.ts` — so putting the roll's content check there dragged
 * `notation/parse.ts`, and with it `@strudel/mini`'s krill parser, into
 * `StrudelEngine`'s module graph. That test file mocks `@strudel/mini` with a
 * factory closing over a top-level variable, and the earlier load turned it into
 * `Cannot access 'MockPattern' before initialization`: the whole 37-test suite
 * died AT LOAD, four modules from anything this change is about. Both package
 * typechecks stayed at their exact baselines throughout.
 *
 * The split is not a workaround for that failure, it is what the failure
 * revealed. There are two questions here and they were one question only while
 * the head was the sole signal:
 *
 *   1. WHAT KIND OF HEAD IS THIS?  Pure, cheap, no notation parsing.
 *      `patternKind` — and the mixer, the engine's graph, wants only this.
 *   2. WHICH SURFACE SHOULD THIS CONTENT OPEN?  Needs the content parsed,
 *      because a resolver-supplied span sits on a head that says nothing.
 *
 * Question 2 legitimately depends on the notation layer; question 1 must not.
 * The dependency line IS the boundary, so the modules are split along it.
 *
 * ── THE RULE ─────────────────────────────────────────────────────────────
 * Head first; where the head is silent ask the ROLL, never the grid; and where
 * a melodic head's own roll declines the CONTENT, ask whether the content is a
 * chord chart before letting it fall to code (#1243).
 *
 * That last clause is narrow on purpose and its bounds are measured, not
 * guessed — `rollUnlessChordChart` below carries both halves of why. The short
 * version: of twelve melodic units the roll declines and the grid would take,
 * seven are declined on CAPACITY rather than content, and of the five declined
 * on content only one is actually a chord chart. A rule any wider than this one
 * draws melodies as drum grids.
 *
 * The grid has no WORD vocabulary: every word-like token is a sound name, which
 * is correct for a drum grid where sample names are arbitrary. So it opens for
 * `"bd sd hh cp"`, `"<Gsus G7 Em7 D7>"` and `"lorem ipsum dolor sit"` alike, and
 * cannot tell a drum kit from a chord chart from prose. Asking it "is this
 * yours?" about any word pattern returns yes, so "ask both and take whichever
 * opens" is not a routing rule but the absence of one (#1238).
 *
 * ⚠ IT IS NOT A UNIVERSAL ACCEPTOR, and the earlier claim that it "never returns
 * `wrong-surface`" was measured only on word-like tokens. It DOES decline
 * NUMERICS — `"0 1 2"` and `"1*1, 2*2, 3*3"` come back `wrong-surface`, "the
 * pattern plays numbers, which the piano roll shows". Two consequences, both
 * load-bearing: the grid's silence is uninformative only ACROSS WORD PATTERNS,
 * which is still exactly the chord-vs-drums case this rule turns on; and the
 * grid arm below can REFUSE, so reaching it is not a promise that a view opens.
 * `"bd 3 hh"` is declined by both surfaces and correctly gets no editor.
 *
 * A chord progression drawn as a lane-per-chord-name grid IS a real editable
 * surface and counts as one — it parses, serialises, and a delete on a chord
 * lane really does remove that chord. It now also says what it is: the grid
 * asks `chordLanes` and drops its drum chrome when every lane is a chord
 * symbol (#1241). That was a labelling gap, and the same predicate turned out
 * to be what the routing clause above needed too, which is why one exists
 * rather than two.
 */

/** A decided surface. `routeSurface` always reaches one, so it never returns null. */
type Surface = Exclude<PatternKind, null>;
/**
 * Which surface a mini string belongs to, given the head that carries it.
 *
 * Exported so the coverage harness scores exactly what the panel mounts — a
 * second copy of a routing rule answers confidently and diverges silently.
 */
declare function routeSurface(headFn: string | null, mini: string): Surface;
/**
 * The surface for a chunk, or null when it has no editable content.
 *
 * Head-routed chunks answer exactly as they always did. A chunk whose span the
 * RESOLVER named is the new case: pre-#1240 a mini string on a non-content head
 * could not exist, so `patternKind` returned null and the user got code.
 *
 * Scoped to `miniVia === 'resolver'` deliberately. A head-call literal on a
 * non-content head (`lpf("0 1 2")`) has always landed in standby, and moving it
 * is a separate decision with its own measurement — this is the wiring of
 * admission, not a re-route of everything that owns a string.
 */
declare function chunkSurface(chunk: ChunkInfo | null): PatternKind;

interface KnobRange {
    min: number;
    max: number;
    step: number;
    /** 'log' methods (filter cutoffs) map the slider position logarithmically */
    scale: 'linear' | 'log';
}
/**
 * The knob range for a method given the literal's current value. Known methods
 * use the override table; unknown methods get a range that comfortably
 * contains the current value so the knob is still usable.
 */
declare function knobRangeFor(method: string, value: number): KnobRange;

/**
 * Knob — a draggable dial over a single numeric value.
 *
 * Vertical drag (or up/down arrows) changes the value across its range; the
 * Mixer maps each change to a surgical text edit of the underlying literal.
 * Accessible as a `slider` (aria-valuemin/max/now) so it's keyboard-usable and
 * Playwright-observable.
 *
 * Reports `onChange(value)` live during a drag and brackets the gesture with
 * `onGestureStart` / `onGestureEnd` so the Mixer can coalesce the whole drag
 * into one undo step.
 */

interface KnobProps {
    label: string;
    value: number;
    range: KnobRange;
    onChange: (value: number) => void;
    /** when set, a small `×` removes this effect's call (#575) */
    onRemove?: () => void;
    /** when set, double-clicking the dial opens an in-place popup to edit its
     *  range; committing calls this with the new start/end (#844). Absent → the
     *  dial isn't range-editable (e.g. a multi-arg function's real args). */
    onRangeChange?: (min: number, max: number) => void;
    /** when set, the popup shows a "Reset" that clears the custom range back to
     *  the method default (#844). Absent → no custom range to reset. */
    onRangeReset?: () => void;
    onGestureStart?: () => void;
    onGestureEnd?: () => void;
}
declare function Knob({ label, value, range, onChange, onRemove, onRangeChange, onRangeReset, onGestureStart, onGestureEnd, }: KnobProps): React.ReactElement;

/**
 * Single source of truth for the visual-editing bottom-panel tab.
 *
 * The scaffold seeds this as a standby tab alongside "Timeline"; the live
 * Pattern panel re-registers the id (idempotent replace) with its UI. Keeping
 * id/title/hint/icon here means the seed and the real panel agree on identity
 * and musician-facing copy without duplication.
 *
 * Since #398 there is ONE adaptive visual-editing tab — "Pattern" — that
 * switches between the Sequencer and Piano Roll grids and pins the Mixer. The
 * title carries NO IR jargon (PV32 / D-06): "Pattern" is what a musician calls
 * the thing they're shaping (and Strudel's own vocabulary).
 */
interface VisualEditTabDef {
    readonly id: string;
    readonly title: string;
    /** musician-facing standby hint shown before a pattern is bound */
    readonly hint: string;
    /** codicon name (without the `codicon-` prefix) */
    readonly icon: string;
}
/** the single adaptive visual-editing tab (#398) */
declare const PATTERN_TAB_ID = "pattern";
/**
 * The channel-strip Mixer console (#540 / S4) — a SECOND top-level tab, peer of
 * "Pattern". The Pattern tab is cursor-scoped (one track: its grid + knobs); the
 * Mixer console is cursor-INDEPENDENT (all tracks at once, for mixing/DJing the
 * whole composition). Distinct from `MIXER_TAB_ID` ('mixer'), which names the
 * Pattern tab's inner param panel — this is the console surface, not the panel.
 */
declare const MIXER_CONSOLE_TAB_ID = "mixer-console";
/**
 * Inner panel ids — no longer separate tabs (#398), but kept as the stable
 * `data-bottom-panel-tab` identity each grid/mixer renders inside the Pattern
 * panel, and as the standby test hook.
 */
declare const SEQUENCER_TAB_ID = "sequencer";
declare const MIXER_TAB_ID = "mixer";
declare const PIANO_ROLL_TAB_ID = "piano-roll";
declare const VISUAL_EDIT_TABS: readonly VisualEditTabDef[];

/**
 * Shared audition envelope (#816). Both this one-shot preview and PianoRollGrid's
 * key press (`playMidi`) trigger a note through this SAME shape, so a picker ▶
 * preview sounds identical to a key tap — one constant, no drift. `sustain: 1`
 * (full level, not the synth default pluck of 0) gives the note body; the short
 * `release` keeps the tail tight.
 */
declare const AUDITION_ENVELOPE: {
    readonly gain: 0.9;
    readonly attack: 0.01;
    readonly sustain: 1;
    readonly release: 0.08;
};
/**
 * One-shot / single-tap note length in seconds. A held pianoroll key retriggers
 * at this interval (PianoRollGrid `HOLD_RETRIGGER_MS = AUDITION_DUR_S * 1000`),
 * so a single tap and a ▶ preview are the same length.
 */
declare const AUDITION_DUR_S = 0.22;
/** Preview `sound` once (a single `note`, default c4). Safe to call anytime. */
declare function auditionSound(sound: string, note?: string): void;
/** Handle for a sustained preview — {@link stopAudition}/`stop()` ends it. */
interface AuditionHandle {
    /** Stop the preview. Idempotent — safe to call after it already ended. */
    stop: () => void;
}
/**
 * Start a SUSTAINED preview of `sound` (the Asset Library's play/pause), the
 * same way a held pianoroll key stays sounding (#633): retrigger an overlapping
 * note every {@link AUDITION_DUR_S} so a sample/synth keeps playing until the
 * user stops it. Uses the SAME `fireOnce` (hence the SAME {@link AUDITION_ENVELOPE},
 * PV166) as the one-shot preview, so sustained and single-tap match.
 *
 * Returns a handle whose `stop()` clears the retrigger; the final note's own
 * release tail lets it fade naturally. Never throws (audio-not-ready no-ops).
 */
declare function startAudition(sound: string, note?: string): AuditionHandle;

/**
 * stripModel.ts — the channel-strip Mixer's read-model.
 *
 * A `StripModel` is one editable, addressable track projected from one detected
 * chunk: its name, source, gain, pan, sends — everything a strip shows. The
 * whole array is a PURE function of the document (`detectAllChunks` →
 * `buildStripModels`), with no React and no audio, so it unit-tests directly and
 * the strips are a trustworthy projection: close the Mixer, reopen it,
 * re-derive from text → identical (invariant V-mixer-1).
 *
 * S0 is read-only — the model carries the ranges every control will later write
 * to (S1 fader/pan, S3 mute, …), but builds nothing that needs a live engine.
 * The `captureId` join to the analyser map is a CANDIDATE here (the documented
 * numbering rule); it is verified against the engine in S2 (grounding gate GR1)
 * before any meter trusts it.
 */

/**
 * Char offset of the top-level statement whose instrument (`.sound`/`.s`/
 * `.bank`) is `source`, or null when none matches. Used to LOCATE a per-hap
 * runtime error (e.g. a soundfont out-of-range note) back to its owning track's
 * line when the error's own stack is bundle-only and the hap's `loc` is
 * degenerate (#567). Reuses the strips' own source-extraction so the locate
 * agrees with what the Mixer shows. First match wins (rare: two tracks, one
 * instrument).
 */
declare function statementOffsetForSource(doc: string, source: string): number | null;
/**
 * The display names of every track in `doc` EXCEPT the statement starting at
 * `selfStatementStart` — the set a rename checks against to reject a duplicate
 * (#585). Keys off the SAME `buildStripModels` projection the Mixer renders, so
 * the names match exactly what `renameEdit`'s `takenNames` must compare against
 * (and what the colour-override store is keyed by). Used by the Song Timeline
 * rename handler, which has only the code text (the Mixer/Pattern chip pass their
 * already-derived `strips` instead). Excludes the renamed track by its statement
 * offset so renaming an anon `d{N}` to its own positional name isn't a self-
 * collision.
 */
declare function otherTrackNames(doc: string, selfStatementStart: number): string[];

/**
 * writeStrip.ts — the strip controls' write decisions, as PURE functions.
 *
 * Each takes a freshly-detected chunk and a target value and returns the single
 * surgical text edit to make (a replace range + text), or null when the control
 * must hand off (a foreign/patterned value it can't safely rewrite). Keeping the
 * decision pure — `ChunkInfo` + value → `StripEdit` — means the fader/pan
 * write-back is unit-testable without Monaco; the caller just applies the edit
 * through the tagged `Writeback` inside `applyToStrip` (one undo step).
 *
 * Surgical & conservative (V-mixer-1, P194): only the targeted literal changes;
 * a signal/expression value disables the control rather than corrupting it.
 */

/** a single surgical edit: replace `range` with `text` (insert = zero-width range). */
interface StripEdit {
    range: [number, number];
    text: string;
}
/** A valid track label: a JS identifier (incl. `$`/`_`) that is not a reserved
 *  word. Mirrors what a `name:` LabeledStatement accepts. Exported so the rename
 *  UIs can gate/validate keystrokes without re-deriving the rule. */
declare function isValidTrackLabel(name: string): boolean;
/**
 * The edit an inline rename makes — write the user's chosen `name:` label into
 * the code (#580, Phase C). Renaming is the ONLY way a descriptive name reaches
 * the file: the display never auto-names (the `d{N}` friction prompts THIS edit).
 *
 *  - named   (`bass:`)  → replace the label with `newLabel` (`lead: …`);
 *  - anon    (`$:`, label `'$'`) → replace the `$` → INSERT a name (`drums: …`);
 *  - the `_` mute marker is PRESERVED (only the bare label is rewritten), so a
 *    muted track stays muted across a rename and the edit round-trips cleanly.
 *
 * Returns null when the statement is unlabelled (a bare expression has no label
 * slot), when `newLabel` is not a valid track label (invalid → no write, the UI
 * reverts), when it equals the current bare label (no-op), or when it would
 * COLLIDE with another track's display name (#585 — see `takenNames`). Surgical:
 * only the label characters change; the pattern expression is byte-identical.
 *
 * `takenNames` = the display names of all OTHER tracks (the caller excludes the
 * track being renamed). A rename whose new label equals one of them is rejected
 * rather than written: a duplicate label collides on the engine's capture/meter
 * join AND on the per-track colour-override key (which is keyed by display name,
 * #581), so two tracks would share one meter and one colour. Consistent with the
 * friction principle (#579) — the UI reverts, exactly like an invalid label, and
 * the user picks a name that's free. Two tracks the user DELIBERATELY labels the
 * same are valid JS and stay shared identity by design (Phase D); this guard only
 * prevents a rename from silently CREATING a new duplicate.
 */
declare function renameEdit(fresh: ChunkInfo, newLabel: string, takenNames: ReadonlySet<string>): StripEdit | null;

/**
 * masterEdit — the MASTER strip's write decisions, as PURE functions.
 *
 * The master bus in Strudel is `all(x => …)`: it stacks every `$:`/named pattern
 * and applies the transform to the whole mix (`@strudel/core/repl.mjs:153`). So
 * the master strip's two round-tripped controls project to `all()` chains,
 * structurally identical to a channel line but scoped to the whole mix:
 *
 *   master fader   → all(x => x.gain(0.85))
 *   master pan     → all(x => x.pan(0.3))   (rides the gain line when present)
 *   master mute    → all(x => silence)      (a dedicated sentinel line)
 *   global backdrop→ all(x => x.viz("name", { backdrop: true }))
 *
 * By the SPLIT decision (design §9.4) gain and viz live on SEPARATE `all()`
 * lines — each edit function owns its own line, so they never coordinate on one
 * shared statement (`all()` transforms compose). The functions mirror
 * `writeStrip.ts`: pure `doc + value → StripEdit`, applied through the same
 * tagged `Writeback` seam every channel control uses (`MixerStrips.tsx`), so the
 * write-back is unit-testable without Monaco. The read path (code → live
 * backdrop / master gain) already ships in the engine — this is the write path.
 *
 * Robust to a hand-COMBINED chain: `masterGainEdit`/`masterVizEdit` bind to
 * whichever `all()` line already carries the relevant call, so a user who wrote
 * `all(x => x.gain(0.8).viz("a",{backdrop:true}))` still gets surgical edits;
 * only a fresh materialization uses the split convention.
 */

/** unity gain — an untouched master reads unity from the ABSENCE of a line. */
declare const MASTER_UNITY_GAIN = 1;
/** centre pan — an untouched master reads centre (0.5) from the ABSENCE of a pan
 *  call, exactly as a channel strip does (grounded GR2). */
declare const MASTER_CENTRE_PAN = 0.5;
/**
 * A top-level `all(<arrow>)` statement we can read/edit — an expression-body
 * arrow (`all(x => x.chain())`). Block-body arrows / non-arrow `all(fast(…))`
 * are master transforms too but carry no editable gain/viz chain, so the
 * detector skips them (a fresh gain/viz line is materialized alongside instead).
 */
interface MasterAll {
    /** the whole `all(...)` ExpressionStatement span */
    statementRange: [number, number];
    /** the statement's exact source when detected — freshness (mirrors ChunkInfo) */
    statementText: string;
    /** the arrow body expression (`x.gain(…)`) — append `.fx()` here */
    arrowBodyRange: [number, number];
    /** the chain in the arrow body, in source order (via the shared `collectChain`) */
    chain: ChainCall[];
}
/** Every editable master `all(x => …)` statement, in source order. Pure. */
declare function detectMasterAll(doc: string): MasterAll[];
/** the master gain the fader shows: the `all()` gain scalar, or unity when
 *  absent. `foreign` = a gain call whose arg is a signal/pattern (not a number),
 *  so the fader can't rewrite it and should disable (mirrors the channel fader). */
interface MasterGainState {
    value: number;
    foreign: boolean;
}
declare function readMasterGain(doc: string): MasterGainState;
/** the master pan the pan control shows: the `all()` pan scalar, or centre (0.5)
 *  when absent. `foreign` = a pan call whose arg is a signal/pattern (not a
 *  number), so the control can't rewrite it and disables (mirrors the channel). */
interface MasterPanState {
    value: number;
    foreign: boolean;
}
declare function readMasterPan(doc: string): MasterPanState;
/** whether the master is muted — a top-level `all(x => silence)` line is present.
 *  Orthogonal to gain (V-mixer-2): mute never touches `.gain`, only this sentinel
 *  line, so unmute is the exact inverse and the fader value survives untouched. */
declare function readMasterMute(doc: string): boolean;
/**
 * The master "audio" `all()` line — the one the EXPAND DRAWER binds its insert
 * chain to. It is the first expression-body `all(x => …)` that is NOT the mute
 * sentinel (`x => silence`) and NOT a pure backdrop-viz line (presentation, not
 * audio). Gain/pan/effect inserts all live here (pan rides the gain line), so the
 * drawer's effects chain and the fader/pan controls act on ONE statement.
 */
declare function detectMasterAudioAll(doc: string): MasterAll | undefined;
/**
 * Adapt a master `all(x => …)` line to a `ChunkInfo` so the shared `MixerBody` /
 * `ExpandDrawer` can render + edit its insert chain exactly as for a channel.
 *
 * A channel's `chain[0]` is its HEAD call (`s("bd")`); the master arrow's base is
 * the bare param `x` (an identifier, not a call), so `collectChain` yields a chain
 * with NO head. We prepend a SYNTHETIC head at index 0 so the body's index math
 * matches a channel: `MixerBody` skips index 0 for effect add/remove (`i > 0`, so
 * it never deletes the base), and `knobsFromChunk` ignores it (no numeric args).
 * `exprRange` is the arrow body, so a new `.fx()` appends at the chain's end
 * (`x.gain(1)` → `x.gain(1).room(0.4)`). Gain/pan carry knobs only when surfaced
 * (they're strip-owned — the fader/pan row), so the drawer shows the INSERTS.
 */
declare function adaptMasterChunk(doc: string, m: MasterAll): ChunkInfo;
/** the master backdrop the "set backdrop" UI shows: the `all()` backdrop-viz
 *  name, or null when no master backdrop is declared in code. */
declare function readMasterViz(doc: string): {
    name: string;
} | null;
/**
 * The edit the master fader makes for `value` (a linear gain, decision 1 =
 * REPLACE):
 *  - present scalar → replace the literal in the existing `all()` gain call;
 *  - absent         → insert a fresh `all(x => x.gain(value))` line (decision 4 =
 *                     write the literal, incl. `.gain(1)` at unity, matching the
 *                     channel `gainEdit`);
 *  - foreign        → null (a signal/empty gain — the fader is disabled).
 */
declare function masterGainEdit(doc: string, value: number): StripEdit | null;
/**
 * The edit the master pan control makes for `value` (0..1, 0.5 = centre), mirror
 * of the channel `panEdit` but scoped to the master bus:
 *  - present scalar → replace the literal in the existing `all()` pan call;
 *  - foreign        → null (a signal/pattern pan — the control is disabled);
 *  - absent         → append `.pan(value)` to the gain-bearing `all()` line if one
 *                     exists (channel-parity output `all(x => x.gain(1).pan(v))`),
 *                     else materialize its own `all(x => x.pan(value))` line.
 *
 * Appending to the gain line keeps the common case (fader dragged, then pan) on
 * ONE audio `all()` chain, exactly like a channel. The rarer pan-first order
 * yields its own line and a later gain drag adds a second — both compose (`all()`
 * transforms stack); the split is harmless, only slightly less tidy.
 */
declare function masterPanEdit(doc: string, value: number): StripEdit | null;
/**
 * The edit a master mute toggle makes — add/remove the `all(x => silence)` line
 * (design: the master analog of a channel's `_`-prefix). Mute is ORTHOGONAL to
 * gain (V-mixer-2, P194): it never touches `.gain`, only this dedicated sentinel
 * line, so unmute is the exact inverse and the fader value round-trips untouched.
 *  - mute (true)  → insert `all(x => silence)` (no-op/null if already muted);
 *  - unmute (false)→ remove the whole `all(x => silence)` line (null if not muted).
 */
declare function masterMuteEdit(doc: string, muted: boolean): StripEdit | null;
/**
 * The edit the "set backdrop" UI makes (decision 2 = code is the single source):
 *  - set `name`  → replace the name literal in the existing master backdrop viz,
 *                  or insert a fresh `all(x => x.viz("name", { backdrop: true }))`
 *                  line;
 *  - clear (null)→ remove the master backdrop viz: the whole `all()` statement
 *                  when it holds nothing else, else just the `.viz(...)` call
 *                  (so a hand-combined `gain().viz()` keeps its gain).
 *
 * Returns null when clearing with no master backdrop present (nothing to do), or
 * when an existing backdrop viz has no string name to rewrite.
 */
declare function masterVizEdit(doc: string, name: string | null): StripEdit | null;

declare function pruneTrackMetaForCode(fileId: string, code: string): void;

/**
 * The DISPLAY NAMES of every track that currently reads as silenced (muted, or
 * dimmed by a solo elsewhere) for the active file. Feed it to the Song Timeline
 * to fade the matching lanes, mirroring the Mixer. Empty when nothing is muted
 * and no solo is active (every track plays → nothing faded).
 */
declare function useSilencedTrackNames(): ReadonlySet<string>;

/**
 * persistence — SSR-safe localStorage helpers for BottomPanel state +
 * the `clampHeight` pure function shared with `useDragResize`.
 *
 * All readers MUST be safe to call from a `useState` initializer
 * (DA-06 + Trap 7). That means: no DOM access without the
 * `typeof window !== 'undefined'` guard, no throws on Safari private
 * mode (where `localStorage.getItem` raises), and a sensible default
 * return on every error path.
 *
 * Constants are exported so Playwright assertions (T-10) and component
 * tests (T-07) can reference the canonical key names.
 *
 * Phase 20-01 PR-A.
 */
declare const BOTTOM_PANEL_HEIGHT_KEY = "stave:bottomPanel.height";
declare const BOTTOM_PANEL_OPEN_KEY = "stave:bottomPanel.open";
declare const BOTTOM_PANEL_ACTIVE_TAB_KEY = "stave:bottomPanel.activeTabId";
declare const BOTTOM_PANEL_HEIGHT_MIN = 80;
declare const BOTTOM_PANEL_HEIGHT_MAX = 600;
declare const BOTTOM_PANEL_HEIGHT_DEFAULT = 240;
/**
 * Read the persisted open state. Default is `false` (closed) — the
 * drawer is opt-in for existing users (Trap 2 — closed-state pixel
 * cost is documented and bounded).
 */
declare function readPersistedOpen(): boolean;
/**
 * Read the persisted active tab id. Returns `null` when missing — the
 * caller decides the fallback (typically the first registered tab).
 * Empty string is treated as null.
 */
declare function readPersistedActiveTabId(): string | null;

/**
 * tabPersistence — SSR-safe localStorage helpers for the WorkspaceShell's
 * full layout snapshot (groups + tabs + per-group active + 2-D pane
 * layout + active group).
 *
 * Mirrors the shape and discipline of `bottomPanel/persistence.ts`:
 *   - Readers MUST be safe to call from a `useState` initializer (no DOM
 *     access without the `typeof window !== 'undefined'` guard, no throws
 *     on Safari private mode where `localStorage.getItem` raises).
 *   - Constants are exported so Playwright assertions can reference the
 *     canonical key names.
 *   - Pure helpers for everything not localStorage-bound, so the shell
 *     and tests can exercise validation without a real storage layer.
 *
 * @remarks
 * ## Scope (issue #175)
 *
 * Persist the full shell state per project — every group's tab set +
 * order, each group's active tab id, the 2-D pane layout (split groups),
 * the active group id, and per-group `backgroundFileId`. On reload, the
 * shell hydrates from this snapshot; on every shell-state change, the
 * snapshot is rewritten.
 *
 * **What's NOT persisted (deliberate):**
 *   - **Preview tabs.** Preview tabs are transient by design (VSCode
 *     parity — open another file in preview mode and the preview slot
 *     replaces). Persisting them would resurrect "stale ghosts" the user
 *     never explicitly pinned. They're filtered out at serialize-time;
 *     editor tabs go through verbatim.
 *   - **Drag/hover/scroll UI state.** Per-frame state isn't a preference.
 *
 * ## Validation on read
 *
 * Persisted state can drift from reality between sessions: a tab's
 * `fileId` may have been deleted in the file tree; a group id in the
 * layout may have been removed; the schema may have changed. The reader
 * validates against the current workspace file list and returns
 * `null` when nothing usable remains (caller falls back to
 * `buildDefaultSnapshot`). This keeps the "if persistence is bad, give
 * the user a sane fresh state" path obvious instead of crashing the
 * shell on a stale fileId.
 *
 * ## Versioning
 *
 * Persisted blobs carry a `version` field so future schema changes can
 * either migrate or fall back without throwing. v1 is the current shape.
 * Mismatched versions return `null` — the user loses tab state once, the
 * shell rebuilds the default, and forward writes use the new version.
 *
 * ## Key shape
 *
 *     stave:workspace:${projectId}:state
 *
 * Project-scoped via `projectId`. The active project is the unit of
 * persistence — switching projects remounts the editor (StaveApp keys by
 * `activeProject.id`) so the shell sees a fresh hydration each time.
 */

/**
 * Canonical localStorage key prefix. Per-project keys append `:${projectId}:state`.
 * Exported so Playwright/integration tests can clear or inspect persisted
 * state without hard-coding the format.
 */
declare const SHELL_STATE_KEY_PREFIX = "stave:workspace:";
/** Schema version of the persisted snapshot. Bump on breaking changes. */
declare const SHELL_STATE_VERSION = 1;
/** Build the full localStorage key for a project. */
declare function shellStateKeyFor(projectId: string): string;
/**
 * The shape stored in localStorage. JSON-friendly — readonly markers
 * from the source types are dropped because JSON has no concept of
 * "mutable vs not."
 */
interface PersistedShellState {
    readonly version: typeof SHELL_STATE_VERSION;
    readonly groups: Record<string, PersistedGroup>;
    /** 2-D pane layout: columns × cells, each cell is a group id. */
    readonly layout: readonly (readonly string[])[];
    readonly activeGroupId: string;
}
interface PersistedGroup {
    readonly id: string;
    /** Editor tabs only. Preview tabs are dropped at write-time. */
    readonly tabs: readonly PersistedEditorTab[];
    readonly activeTabId: string | null;
    readonly backgroundFileId?: string;
    /** Per-pane backdrop opacity override (#350c). Absent → global default. */
    readonly backdropOpacity?: number;
    /** Per-pane backdrop quality override (#350c). Absent → global default. */
    readonly backdropQuality?: BackdropQuality;
}
interface PersistedEditorTab {
    readonly kind: 'editor';
    readonly id: string;
    readonly fileId: string;
    /** Optional in V1 — preview-state-for-an-editor-tab survives across reloads
     *  because it's part of the user's working set, not the transient preview slot. */
    readonly preview?: boolean;
}
/**
 * Snapshot the shell hands to `saveShellState` — same shape the shell's
 * internal state holds. Slimmer than `PersistedShellState` because it
 * uses `Map` and the source `WorkspaceTab` union (with preview tabs the
 * serializer filters out).
 */
interface ShellSnapshot {
    readonly groups: ReadonlyMap<string, WorkspaceGroupState>;
    readonly layout: GroupLayout;
    readonly activeGroupId: string;
}
/**
 * Read the persisted shell state for this project, validate it against
 * the live workspace file list, and return the cleaned snapshot — or
 * `null` if there is no usable state (no key, malformed JSON, schema
 * mismatch, or no live tabs remained after validation).
 *
 * `validFileIds` is consulted at validation time to prune tabs whose
 * underlying file no longer exists.
 *
 * Safe to call from a `useState` initializer (no DOM, no throws).
 */
declare function loadShellState(projectId: string, validFileIds: ReadonlySet<string>): PersistedShellState | null;
/**
 * Pure validator — exported so unit tests can drive arbitrary inputs
 * without touching localStorage.
 *
 * Validation rules:
 *   - Schema version must match.
 *   - Tabs whose `fileId` is not in `validFileIds` are dropped.
 *   - A group's `activeTabId` is reassigned to the first remaining tab
 *     (or null) if the persisted active was pruned.
 *   - A group's `backgroundFileId` is dropped if no longer valid.
 *   - Layout cells referencing groups that no longer exist are removed;
 *     columns that become empty are collapsed.
 *   - If `activeGroupId` is not in the cleaned layout, falls back to the
 *     first group in reading order.
 *   - Returns `null` if the cleaned layout has no groups left — the
 *     caller should rebuild the default in that case.
 *
 * Empty groups (group exists, all tabs pruned) are KEPT — the shell
 * treats empty groups as legal and renders a drop-target placeholder.
 */
declare function validatePersistedState(input: unknown, validFileIds: ReadonlySet<string>): PersistedShellState | null;
/**
 * Serialize the shell's live state into the persisted form, dropping
 * preview tabs (they're transient by design — see header).
 *
 * Pure — exported so tests can exercise the round-trip without
 * localStorage.
 */
declare function serializeShellState(snapshot: ShellSnapshot): PersistedShellState;
/**
 * Write the snapshot to localStorage for this project. SSR-safe and
 * swallows quota/private-mode errors — a failed write degrades to "no
 * persistence this session," not a crash.
 */
declare function saveShellState(projectId: string, snapshot: ShellSnapshot): void;
/**
 * Remove the persisted entry for a project. Used by tests and by
 * "Reset workspace" flows.
 */
declare function clearShellState(projectId: string): void;
/**
 * Build a sane default snapshot for first-launch: a single group with at
 * most one tab — the Strudel pattern file when it exists in the workspace
 * (the natural starting point), otherwise an empty group with a drop-
 * target placeholder.
 *
 * Pure — exported so the caller can use it as the fallback when
 * `loadShellState` returns `null`.
 *
 * Why ONE tab and not zero: the user lands inside an editable Strudel
 * file out of the gate. Zero tabs would force a sidebar click before
 * anything is editable.
 */
declare function buildDefaultSnapshot(newGroupId: string, defaultFileId: string | null): ShellSnapshot;
/**
 * Inverse of `serializeShellState` — used by callers that load a
 * persisted snapshot and want to feed it back into the shell's
 * state shape (Map + GroupLayout + activeGroupId).
 */
declare function hydrateSnapshot(persisted: PersistedShellState): ShellSnapshot;

/**
 * timelineCapture — fixed-size FIFO ring buffer of IRSnapshot captures.
 *
 * Fed by publishIRSnapshot's capture fan-out (irInspector.ts) on every
 * successful eval. Default capacity 30 entries; configurable via
 * setCaptureCapacity (the chrome trace-length input persists capacity in
 * localStorage — entry storage itself is in-memory per CONTEXT D-06).
 *
 * Pin-by-reference contract: UI consumers hold the snapshot reference in
 * React state. FIFO eviction does NOT invalidate the held reference (JS
 * GC keeps it alive as long as the React state holds it). Trap #5
 * mitigation per RESEARCH §7.
 *
 * Defensive immutability: Object.freeze(snap) + Object.freeze(snap.passes)
 * applied at push time (RESEARCH §7 trap #1 mitigation). Shallow only
 * — the IR tree itself is NOT deep-frozen due to recursion cost on
 * large trees.
 *
 * Phase 19-08 (#85). PR-A.
 */

/**
 * Single entry in the capture buffer. `cycleCount` is captured from
 * `runtime.getCurrentCycle()` at publish time and lives on the entry
 * (not on `IRSnapshot`) so PV27's per-snapshot alias contract stays
 * untouched and snapshots remain wire-shaped.
 */
type TimelineCaptureEntry = Readonly<{
    snapshot: IRSnapshot;
    ts: number;
    cycleCount: number | null;
}>;
type Listener = () => void;
/**
 * Push a snapshot into the buffer. Defensive freeze at the snapshot
 * top-level + passes array prevents future code paths from mutating
 * captured state. FIFO eviction drops the oldest entry when capacity
 * is exceeded.
 */
declare function captureSnapshot(snap: IRSnapshot, meta?: {
    ts?: number;
    cycleCount?: number | null;
}): void;
/** Read-only view of the current buffer. Most recent entry is last. */
declare function getCaptureBuffer(): readonly TimelineCaptureEntry[];
/**
 * Subscribe to buffer changes (push, clear, capacity clamp). Listener
 * fires with no arguments — consumers re-read `getCaptureBuffer()`.
 */
declare function subscribeCapture(l: Listener): () => void;
/** Empty the buffer; notify subscribers. */
declare function clearCapture(): void;
/** Current configured capacity (default 30). */
declare function getCaptureCapacity(): number;
/**
 * Set capacity. Clamps existing entries from the oldest if the new
 * capacity is smaller. No-op for non-finite or sub-1 values.
 */
declare function setCaptureCapacity(n: number): void;

/**
 * Shared shape for every runtime's hover/completion documentation index.
 *
 * The goal is one schema across Strudel, Sonic Pi, p5.js, Hydra, and any
 * future runtime, so hover + completion providers are factory-built from
 * the same index — not hand-rolled per runtime.
 */
type DocKind = 'function' | 'method' | 'variable' | 'constant' | 'keyword' | 'synth' | 'sample' | 'fx';
/**
 * A curated friendly-error hint attached to a `RuntimeDoc` (per-symbol)
 * or to `DocsIndex.globalMistakes` (catch-alls). Consulted by
 * `formatFriendlyError` before the Levenshtein fallback.
 *
 * Three detector kinds, ordered by specificity:
 *   - `message` — regex / substring tested against the error's message.
 *   - `code`    — regex / substring tested against a window of user
 *                 source around the throw (caller passes `codeContext`).
 *   - `identifier` — old-name / cross-runtime alias for the
 *                    misspelling-fallback path.
 *
 * `match` accepts a string for forward-compat with JSON-shipped indexes
 * (regex literals don't survive JSON.stringify). Strings are treated as
 * the source of a `RegExp` with the `i` flag.
 */
interface CommonMistake {
    detect: {
        kind: 'message';
        match: string | RegExp;
    } | {
        kind: 'code';
        match: string | RegExp;
    } | {
        kind: 'identifier';
        alias: string;
    };
    /** Friendly one-liner. Renders in place of the raw error. */
    hint: string;
    /** Optional inline example, rendered below the hint. */
    example?: string;
    /**
     * Confidence weight for ranking. Default 1. Bump for runtimes where
     * the curated hint is clearly better than the algorithmic suggestion.
     */
    weight?: number;
}
interface RuntimeDoc {
    /** Callable form, e.g. `note(pattern: string)` or `.fast(n)` */
    signature: string;
    /** Prose description (Markdown allowed). */
    description: string;
    /** Short inline example, shown verbatim. */
    example?: string;
    /** Classification — drives the Monaco completion icon. */
    kind?: DocKind;
    /** Return description, e.g. `Pattern` or `void`. */
    returns?: string;
    /** Topic / category for filtering (e.g. `transform`, `shape`). */
    category?: string;
    /** Permalink into the upstream reference. */
    sourceUrl?: string;
    /**
     * Friendly-error hints scoped to this symbol. Consulted when the user
     * names this symbol but uses it wrong (right name, wrong arg shape /
     * idiom). See `CommonMistake`.
     */
    commonMistakes?: CommonMistake[];
}
interface DocsIndex {
    /** Monaco language id. */
    runtime: string;
    /** Identifier → doc entry. Identifier is the bare name, no `.` prefix. */
    docs: Record<string, RuntimeDoc>;
    /** Optional alias → canonical name map (e.g. `bg` → `background`). */
    aliases?: Record<string, string>;
    /**
     * Catch-alls that don't belong to a specific symbol — runtime-wide
     * gotchas, "you forgot to call play()", scheduler-not-set-up.
     * Matched after per-symbol `commonMistakes`, before the fuzzy fallback.
     */
    globalMistakes?: CommonMistake[];
    /** Provenance for sync scripts and staleness checks. */
    meta?: {
        version?: string;
        fetchedAt?: string;
        source?: string;
        /**
         * Fallback URL for the hover "Reference →" link when an entry has no
         * `sourceUrl` of its own. Useful for runtimes whose docs don't carry
         * stable per-function permalinks (e.g. Strudel).
         */
        docsBaseUrl?: string;
    };
}

/**
 * Turns a raw runtime error into a user-friendly `LogEntry` body.
 *
 * Inspired by p5.js's Friendly Error System (FES). We have a structural
 * advantage — every runtime ships its `DocsIndex` (the same one hover /
 * completion consume), so fuzzy-matching a misspelled identifier back
 * to a real symbol with its docs URL is a lookup, not a hard-coded
 * dictionary.
 *
 * Scope today:
 *   - Extract the offending identifier from a ReferenceError.
 *   - Fuzzy-match it (Levenshtein) against DocsIndex keys.
 *   - Format a friendly message + suggestion record.
 *
 * Not in scope yet:
 *   - Parsing TypeError arg-type mismatches (needs real signature parsing).
 *   - Parsing Sonic Pi's Ruby error format (different error surface).
 *   - Cross-runtime suggestions (*"stack is a Strudel fn; you're in Hydra"*).
 */

interface FriendlyErrorParts {
    /** Short sentence surfacing in toast + console row + Monaco marker. */
    message: string;
    /** Populated when we found a confident fuzzy match in DocsIndex. */
    suggestion?: LogSuggestion;
    /** Underlying stack, copied through so the Console panel can fold it. */
    stack?: string;
    /**
     * 1-based source line parsed from a V8 / Firefox / Safari stack
     * trace when one was present. Feeds the engineLog → Monaco marker
     * bridge — entries without a line get no inline squiggle.
     */
    line?: number;
    /** 1-based column, paired with `line`. */
    column?: number;
}
/**
 * Parse the first user-code line/column out of an error's stack.
 *
 * We only trust frames that clearly originate from a runtime eval
 * path — `<anonymous>` for `new Function` / direct eval, or an
 * explicit `eval at` chain. Matching any `:LINE:COL` pair we see
 * would false-positive on bundled paths (e.g. a stack containing
 * `.../@stave/editor/dist/index.js:1234:56`) and hand back a line
 * number that has nothing to do with the user's file — the
 * downstream marker then clamps to full-document range and the user
 * sees the whole sketch underlined.
 *
 * Returns `null` when the stack only contains compiled-bundle or
 * framework frames. Caller should treat that as "line unknown" and
 * skip the inline marker rather than painting the whole file.
 */
declare function parseStackLocation(err: unknown): {
    line: number;
    column: number;
} | null;
/**
 * Extract a source location from a parser error MESSAGE — the trailing
 * `(line:col)` that acorn/estree parsers append (e.g. Strudel's
 * "Unexpected token (3:11)"). Unlike `parseStackLocation`, which reads the
 * post-transpile eval stack (whose line is offset by Strudel's async-IIFE
 * wrapper and therefore dropped by callers), this location is reported in
 * the USER's original source coordinates — verified line-accurate across
 * positions — so it is safe to feed the marker bridge and the toast jump.
 *
 * Anchored to the END of the message and requires BOTH numbers so a stray
 * "(2)" or a parenthetical elsewhere in the text can't false-positive.
 * Returns `null` when the message carries no such trailing pair. Callers
 * should still range-check the line against the target file.
 */
declare function parseMessageLocation(message: unknown): {
    line: number;
    column: number;
} | null;
/**
 * Levenshtein edit distance. Small implementation — fine for runs of up
 * to a few thousand words, which is the order of magnitude of the
 * combined DocsIndex keys (~935).
 */
declare function levenshtein(a: string, b: string): number;
interface FuzzyMatch {
    name: string;
    distance: number;
}
/**
 * Return the closest identifiers to `word` from a corpus, sorted by
 * distance. `maxDistance` filters out anything beyond the threshold;
 * defaults to `Math.max(2, ceil(word.length / 3))` — generous for short
 * words, stricter for long ones. `limit` caps the returned list.
 */
declare function fuzzyMatch(word: string, corpus: readonly string[], options?: {
    maxDistance?: number;
    limit?: number;
}): FuzzyMatch[];
/**
 * Extract the undefined identifier from a ReferenceError's message.
 * Returns `null` when the error isn't a reference-miss we recognise.
 */
declare function extractReferenceIdentifier(err: unknown): string | null;
interface FormatOptions {
    /** DocsIndex for the runtime the code was running in. */
    index?: DocsIndex;
    /** Override the base URL pattern used for suggestion.docsUrl. */
    docsUrlFor?: (runtime: RuntimeId, name: string) => string;
    /**
     * A window of user source code around the throw — typically the line
     * the error happened on plus a couple of neighbours. Used by
     * `CommonMistake` detectors of `kind: 'code'` to recognise wrong-shape
     * idioms (`chord(C)` vs `chord("C")`) without needing a full parse.
     * Caller is free to omit it; `kind: 'code'` detectors simply won't fire.
     */
    codeContext?: string;
    /**
     * Phase 20-14 β-5 — bare-name sound alias context. Distinct from the
     * doc-level `detect.alias` CommonMistake field (which is per-doc fuzzy
     * suggestion); this is the runtime alias-resolution layer that
     * `wrappedOutput` operates.
     *
     * - `resolutions`: ordered list of alias rewrites that fired during the
     *   current evaluate() window. Populated from
     *   `StrudelEngine.getLastAliasResolutions()`. The friendly-error path
     *   appends `(tried alias "kick" → "bd")` to the message when populated
     *   on the same error window.
     * - `lookupAlias`: project-injected resolver (today, `resolveAlias` from
     *   `./aliases`). The miss path uses this to distinguish "the alias
     *   map has no entry for `xyz`" from "we tried `xyz → target` but
     *   `target` is not loaded either."
     */
    aliasContext?: {
        resolutions?: ReadonlyArray<{
            from: string;
            to: string;
        }>;
        lookupAlias?: (rawS: string) => string | undefined;
    };
}
/**
 * Build the alias-resolution suffix appended to "sound not found" friendly
 * errors. Returns an empty string when there's nothing to say. Exported
 * for unit testing — pure function over the inputs.
 */
declare function buildAliasSuffix(missingName: string | null, ctx: FormatOptions['aliasContext']): string;
/**
 * Build a FriendlyErrorParts from a raw thrown value. When `index` is
 * provided and the error is a ReferenceError, attempts a fuzzy-match
 * against the index and attaches the best suggestion.
 */
declare function formatFriendlyError(err: unknown, runtime: RuntimeId, options?: FormatOptions): FriendlyErrorParts;

/**
 * Bare-name to canonical-name aliases. Frozen so callers can't mutate the
 * shared table — the alias surface is a contract reviewed via PR, not a
 * runtime knob.
 */
declare const SOUND_ALIASES: Readonly<Record<string, string>>;
/**
 * Look up a bare name against `SOUND_ALIASES`. Returns the canonical name
 * if there is a curated alias, otherwise `undefined`. Lowercases the input
 * to match superdough's own lookup (`soundMap.get()[s.toLowerCase()]`).
 *
 * The caller (`wrappedOutput` in StrudelEngine) must ALSO verify the name
 * is not in the live `soundMap` before substituting — see header.
 */
declare function resolveAlias(rawS: string): string | undefined;

/**
 * p5.js hover + completion — sourced from the official p5.js reference
 * (YUIDoc build, vendored to `data/p5.json` via
 * `scripts/fetch-docs/p5.mjs`).
 *
 * Re-sync with upstream:
 *   node packages/editor/scripts/fetch-docs/p5.mjs
 *
 * The transform trims descriptions to one sentence and picks the shortest
 * real call-site line from each method's examples, so the vendored JSON
 * stays under 200 KB.
 */

declare const P5_DOCS_INDEX: DocsIndex;

/**
 * Hydra hover + completion — sourced from the hydra-synth function list
 * (`glsl-functions.js` vendored as `data/hydra.json` via
 * `scripts/fetch-docs/hydra.mjs`) plus a small hand-curated set of
 * runtime-only globals (output buffers, `hush`, `time`, etc.) that don't
 * live in the GLSL list.
 *
 * Re-sync with upstream:
 *   node packages/editor/scripts/fetch-docs/hydra.mjs
 */

declare const HYDRA_DOCS_INDEX: DocsIndex;

/**
 * Sonic Pi hover + completion — assembled from the upstream sonic-pi repo:
 *   - Language functions scraped from `app/server/ruby/lib/sonicpi/lang/*.rb`
 *     via the `doc name:` metadata blocks.
 *   - Synth symbols from `etc/doc/cheatsheets/synths.md`.
 *   - FX symbols from `etc/doc/cheatsheets/fx.md`.
 *
 * Re-sync with upstream:
 *   node packages/editor/scripts/fetch-docs/sonicpi.mjs
 *
 * Monaco's `getWordAtPosition` stops at `:`, so `:dull_bell` resolves to
 * the bare `dull_bell` identifier — which the docs index stores under
 * that bare key. One lookup covers both forms.
 */

declare const SONICPI_DOCS_INDEX: DocsIndex;

declare const STRUDEL_DOCS_INDEX: DocsIndex;

export { ALIAS_MAP, ASSET_DB_NAME, AUDITION_DUR_S, AUDITION_ENVELOPE, AUTO_SNAPSHOT_PREFIX, type ActiveEventSummary, type AnalyserBytes, type AnalyzeSongOptions, type AnalyzeWindowOptions, type ArrangeArmRange, type ArrangeCall, type ArrangeMode, type AssetDigest, type AssetImportInput, type AssetImportPlan, type AssetRecord, type AudioPayload, type AudioReading, type AudioSourceRef, type AuditionHandle, BACKDROP_BLUR_VAR, BOTTOM_PANEL_ACTIVE_TAB_KEY, BOTTOM_PANEL_HEIGHT_DEFAULT, BOTTOM_PANEL_HEIGHT_KEY, BOTTOM_PANEL_HEIGHT_MAX, BOTTOM_PANEL_HEIGHT_MIN, BOTTOM_PANEL_OPEN_KEY, BUILTIN_ALIASES, BUNDLED_PREFIX, type BackdropQuality, type BackdropVizSpan, type BootStepFailure, BottomPanel, type BottomPanelTab, type BranchRef, type BreakpointMeta, BreakpointStore, BufferedScheduler, type BumpSummary, type BusAnalyser, type BusHapEvent, type CapabilityEnv, type ChainArg, type ChainCall, type ChromeContext, type ChromeForTab, type ChunkInfo, type ChunkType, type Commit, type CommitKind, type CropRegion, DARK_THEME_TOKENS, DEFAULT_VIZ_DESCRIPTORS, DEFAULT_VIZ_ENGINE, DemoEngine, type DisplaySpan, type DocKind, type DocsIndex, type DrumMachineManifest, EPHEMERAL_ID_PREFIX, type EditorTheme, EditorView, type EncodeOptions, type EngineAliasMap, type EngineAliasValue, EngineComponents, ErrorBoundary, type ErrorBoundaryProps, FALLBACK_ASSET_NAME, FSCOPE_P5_CODE, type FixedMarker, type FormatOptions, type FrameChannel, type FrameStats, type FriendlyErrorParts, type FuzzyMatch, GLSL_VIZ, GM_FAMILY_KEY_COUNT, GM_FAMILY_ORDER, type GmFamily, HYDRA_DOCS_INDEX, HYDRA_VIZ, HapEvent, HapStream, HistoryPanel, type HistoryPanelProps, type HydraPatternFn, HydraVizRenderer, IDB_SYNC_TIMEOUT_MS, INLINE_VIZ_ACTION_SIZE_VAR, IREvent, IRPattern, type IRSnapshot, type ImportAssetDeps, type ImportAssetResult, type InjectedGlobal, Knob, LIGHT_THEME_TOKENS, type LaneActivity, type LaneItem, type LaneSkeleton, LiveCodingEditor, type LiveCodingEditorProps, LiveCodingEngine, LiveCodingRuntime, type LiveCodingRuntime$1 as LiveCodingRuntimeInterface, type LiveCodingRuntimeProvider, LiveRecorder, type LiveSpec, type LogEntry, type LogLevel, type LogSuggestion, MASTER_CENTRE_PAN, MASTER_KEY, MASTER_UNITY_GAIN, MIXER_CONSOLE_TAB_ID, MIXER_TAB_ID, MainSignalSampler, type MasterAll, type MasterArray, type MasterGainState, type MasterPanState, type MasterScalar, Mixer, type NormalizedHap, type NoteColorMode, OfflineRenderer, type OffsetEdit, type OpenHistoryTabRequest, P5VizRenderer, P5_DOCS_INDEX, P5_VIZ, PATTERN_IR_SCHEMA_VERSION, PATTERN_TAB_ID, PIANOROLL_P5_CODE, PIANO_ROLL_TAB_ID, PITCHWHEEL_P5_CODE, type ParseResult, type Pass, PatternIR, type PatternKind, PatternPanel, PatternScheduler, type PerfSnapshot, type PersistedEditorTab, type PersistedGroup, type PersistedShellState, PianoRollGrid, type PianoRollModel, type PickControl, type PickControlArm, type PickMethod, type PickSectionEntry, type PreviewContext, type PreviewProvider, PreviewView, type ProjectDocInitResult, type ProjectHistory, type ProjectMeta, type PutAssetResult, type ResizeMode, type ResolvedTheme, type RollNote, type RuntimeDoc, type RuntimeId, SAMPLE_SOUND_LABEL, SAMPLE_SOUND_SOURCE_ID, SCOPE_P5_CODE, SEQUENCER_TAB_ID, SHELL_STATE_KEY_PREFIX, SHELL_STATE_VERSION, SIGNALS_BACKDROP_P5_CODE, SIGNALS_SPECTRUM_P5_CODE, SILENCE_FLOOR, SONICPI_DOCS_INDEX, SONICPI_RUNTIME, SOUND_ALIASES, SPECTRUM_P5_CODE, SPIRAL_P5_CODE, STRUDEL_DOCS_INDEX, STRUDEL_RUNTIME, type SamplerInputs, type SectionStats, SequencerGrid, type ShellSnapshot, type SignalAliasMap, type SignalAutomation, SignalBus, type SignalDimensions, type SignalFrame, type SignalKind, type SignalReading, type SignalSpans, type SignalTransportReader, type SignalTransportWriter, SilentCaptureError, type SnapshotMeta, type SongAnalysis, type SongExtent, type SongSection, SonicPiEngine, type SoundMapDict, SourceLocation, SplitPane, type StepGridModel, type StepLane, type StoredAsset, type StoredAssetMeta, type StoredSignalAliases, type StripEdit, StrudelEditor, type StrudelEditorProps, StrudelEngine, type StrudelTheme, type Surface, type TierFlags, type TierName, type TimelineCaptureEntry, type TrackMeta, UI_ICON_SIZE_VAR, type UseWorkspaceFileResult, VISUAL_EDIT_TABS, VIZ_FLAG_KEYS, VIZ_LANGUAGES, VisualEditStandby, type VisualEditStandbyProps, type VisualEditTabDef, VizDescriptor, VizDropdown, VizEditor, type VizEditorProps, type VizEngine, type VizLanguage, VizPanel, VizPicker, type VizPreset, VizPresetStore, type VizPreviewSpec, VizQualityLevel, VizRenderer, type VizRendererKind, VizRendererSource, type VizTransport, type VizWorkerFactory, WORDFALL_P5_CODE, type WalkWindow, WavEncoder, type WindowAnalysis, WorkerBusFeed, type WorkerVizCapabilities, WorkerVizRenderer, type WorkspaceAudioBus, type WorkspaceFile, type WorkspaceGroupState, type WorkspaceLanguage, WorkspaceShell, type WorkspaceShellHandle, type WorkspaceShellProps, type WorkspaceTab, type WriteOutcome, type WriteRefusal, type WriteSource, Writeback, accumulateLanes, accumulateLanesInWindow, adaptMasterChunk, addAssetRecord, aggregateLaneItems, analyzeEvents, analyzeSong, analyzeWindow, applyEdits, applyEvalSourceTransform, applyOffsetEditsToFile, applyPersistedAdaptivePerf, applyPersistedBackdropBlur, applyPersistedInlineVizActionSize, applyPersistedPerfEnabled, applyPersistedTheme, applyPersistedUiIconSize, applyPersistedVizQuality, applyTheme, auditionSound, backdropQualityFactor, banksFromDrumMachineManifest, buildAliasSuffix, buildDefaultSnapshot, bumpEditorFontSize, bundledPresetId, canRedo, canUndo, captureSnapshot, chunkSurface, classifyChunk, classifyLiteralRhs, clearCapture, clearIRSnapshot, clearLog, clearShellState, commitWorkspace, compilePreset, computeSections, computeSectionsInWindow, createBranchAt, createPostMessageReader, createPostMessageWriter, createProject, createWorkspaceFile, cycleEditorTheme, cycleFingerprints, deleteAsset, deleteProject, deleteSnapshot, deleteWorkspaceFile, detectAllArrangeCalls, detectAllChunks, detectAllPickControls, detectArrangeAt, detectBarePattern, detectChunk, detectMasterAll, detectMasterAudioAll, detectPeriod, detectPickControlAt, detectWorkerVizCapabilities, docParses, dropLegacyBackgroundCrop, duplicateProject, emitFixed, emitLog, emptyFrame, enterRuntimeView, exitRuntimeView, extractReferenceIdentifier, fileHistory, filter, flushToPreset, formatFriendlyError, formatNumber, formatStaveInputs, frameTransferables, fuzzyMatch, generateUniquePresetId, getActiveEditor, getActiveFileId, getActiveHistoryFile, getActiveProjectId, getAdaptivePerfEnabled, getAsset, getBackdropOpacity, getBackdropQuality, getBackdropVizSpan, getBottomPanelTab, getCaptureBuffer, getCaptureCapacity, getChildOrder, getCommit, getCurrentBranch, getCurrentHistory, getEditorBackdropBlur, getEditorFontSize, getEditorMinimap, getEditorTheme, getEditorUiIconSize, getFile, getFileContentAt, getFileHistoryTarget, getFixedMarkers, getFolderOrder, getIRSnapshot, getInlineVizActionSize, getInlineVizResolution, getInlineVizTeardownEnabled, getInlineVizTeardownMs, getLastOpenedProject, getLogHistory, getModifiedFileIdsSinceHead, getMusicalTimelineSubRowHeight, getNamedViz, getNoteColorMode, getPerfEnabled, getPlayVizOnHoverEnabled, getPresetIdForFile, getPreviewProviderForExtension, getPreviewProviderForLanguage, getProject, getResolvedTheme, getRuntimeProviderForExtension, getRuntimeProviderForLanguage, getSignalAliases, getStoredSignalAliases, getSubfolderOrder, getTierFlags, getTrackColourBarsEnabled, getTrackMeta, getTrackMetaMapSnapshot, getViewedCommit, getViewedContent, getViewedFileIds, getVizInputsLiveValuesEnabled, getVizMaxDprOverride, getVizMaxFpsOverride, getVizQuality, getVizWorkerFactory, getVizWorkerOverride, getZoneCropOverride, getZoneHeightOverride, gmFamily, groupDrumKits, groupSoundCatalog, hydraKaleidoscope, hydraPianoroll, hydraScope, hydrateSnapshot, importAsset, initHistory, initProjectDoc, initProjectDocSync, injectedGlobalByToken, injectedGlobals, insertArm$1 as insertArm, installEngineLogMarkers, installGlobalErrorCatch, isBlackKey, isBootStepFailure, isBundledPresetId, isChunkFresh, isDocReady, isEphemeralProjectId, isFileModifiedSinceHead, isP5DirectCanvasEnabled, isRollChunk, isSampleSoundPlaying, isStepChunk, isValidTrackLabel, isViewing, isVizGovernorEnabled, isVizLanguage, isVizPumpSharedCacheEnabled, isVizWorkerPoolEnabled, knobRangeFor, laneKeyOf, languageForRenderer, levenshtein, listAssetRecords, listAssets, listBottomPanelTabs, listBranches, listCommits, listNamedVizEntries, listNamedVizNames, listProjects, listSnapshots, listTiers, listWorkspaceFiles, liveCodingRuntimeRegistry, loadShellState, makeFixedKey, masterGainEdit, masterMuteEdit, masterPanEdit, masterVizEdit, materializeBareDelete, materializeBareSplit, merge, midiToPitch, mountVizPreview, mountVizRenderer, normalizeEdits, normalizeStrudelHap, noteToMidi, notifyDrumKitChanged, notifySoundCatalogChanged, onActiveEditorChange, onAdaptivePerfChange, onBackdropOpacityChange, onBackdropQualityChange, onBackdropVizSpanChange, onInlineVizActionSizeChange, onInlineVizResolutionChange, onInlineVizTeardownChange, onMusicalTimelineSubRowHeightChange, onNamedVizChanged, onPerfEnabledChange, onPlayVizOnHoverChange, onSignalAliasesChange, onThemeChange, onTrackColourBarsChange, onUiIconSizeChange, onVizInputsLiveValuesChange, onVizQualityChange, otherTrackNames, parseMessageLocation, parseMini, parsePianoRoll, parseStackLocation, parseStepGrid, parseStrudel, parseTopLevel, patternFromJSON, patternKind, patternToJSON, peekAssetUrl, perf, countSectionArms as pickCountSectionArms, duplicateArm as pickDuplicateArm, insertArm as pickInsertArm, removeArm as pickRemoveArm, renameSection as pickRenameSection, reorderArm as pickReorderArm, setWeight as pickSetWeight, silenceArm as pickSilenceArm, splitArm as pickSplitArm, pitchToMidi, placeNote, planAssetImport, previewProviderRegistry, pruneEphemeralArtifacts, pruneTrackMetaForCode, pruneZoneOverrides, publishIRSnapshot, purgeLegacyMasterGain, putAsset, readCurrentCycle, readMasterGain, readMasterMute, readMasterPan, readMasterViz, readPersistedActiveTabId, readPersistedOpen, redo, registerAsset, registerAssets, registerBottomPanelTab, registerEvalSourceTransform, registerNamedViz, registerPresetAsNamedViz, registerPreviewProvider, registerReevalHandler, registerRuntimeProvider, releaseAllAssets, releaseAsset, removeArm$1 as removeArm, removeAssetRecord, renameAssetRecord, renameEdit, renameProject, renameWorkspaceFile, rendererForLanguage, reorderArm$1 as reorderArm, requestReeval, resetFileStore, resetHistoryState, resetUndoManager, resizeGrid, resizeRoll, resolveAlias, resolveAliasesForEngine, resolveAsset, resolveDescriptor, restoreFileToCommit, restoreProject, restoreSnapshot, revealLineInFile, revealOffsetInFile, revertFileToSeed, routeSurface, runChainAppliedStage, runFinalStage, runMiniExpandedStage, runPasses, runRawStage, sanitizePresetName, saveShellState, saveSnapshot, scaleGain, seedFromPreset, seedFromPresetId, seedWorkspaceFile, serializePianoRoll, serializeShellState, serializeStepGrid, setActiveHistoryFile, setAdaptivePerfEnabled, setBackdropOpacity, setBackdropQuality, setBackdropVizSpan, setCaptureCapacity, setChildOrder, setContent, setCurrentCycleAccessor, setDrumKitAccessor, setEditorBackdropBlur, setEditorFontSize, setEditorTheme, setEditorUiIconSize, setFileHistoryTarget, setFolderOrder, setInlineVizActionSize, setInlineVizResolution, setInlineVizTeardownEnabled, setMusicalTimelineSubRowHeight, setNoteColorMode, setPerfEnabled, setPlayVizOnHoverEnabled, setSignalAliases, setSoundCatalogAccessor, setSubfolderOrder, setTierFlag, setTrackColourBarsEnabled, setTrackMeta, setVizInputsLiveValuesEnabled, setVizQuality, setVizWorkerFactory, setWeight$1 as setWeight, setZoneCropOverride, setZoneHeightOverride, sha256Hex, shellStateKeyFor, signalAutomations, signalCarryingParamKeys, signalDimensionsOf, silenceArm$1 as silenceArm, songExtent, soundNameFromFilename, soundfontGroupLabel, splitArm$1 as splitArm, startAudition, startHistoryDriver, startSampleSound, statementOffsetForSource, stopSampleSound, structuralWalk, subscribeCapture, subscribeFixed, subscribeIRSnapshot, subscribeLog, subscribeNoteColorMode, subscribeToAssets, subscribeToBottomPanelTabs, subscribeToDocUpdate, subscribeToFileList, subscribeToFolderOrder, subscribeToHistory, subscribeToRuntimeView, subscribeToTrackMeta, subscribeToUndoState, subscribe as subscribeToWorkspaceFile, subscribeToZoneOverrides, switchProject, switchToBranch, timestretch, toStrudel, toggleAdaptivePerfEnabled, toggleEditorMinimap, togglePerfEnabled, touchProject, transpose, undo, uniqueSoundName, unregisterBottomPanelTab, unregisterNamedViz, useNoteColorMode, usePopoutPreview, useSilencedTrackNames, useTrackMetaMap, useWorkspaceFile, validatePersistedState, warmMonaco, wholeWalkWindow, withStructBatch, workspaceAudioBus, workspaceFileIdForPreset, wrapBare };
