/**
 * timelineScene — the render-agnostic scene model for the canvas Song timeline
 * (#419 / canvas milestone #416, design §4.4).
 *
 * The DOM `FullSongTimeline` drew its onset heatmap straight from `SongAnalysis`.
 * The canvas view instead draws a `TimelineScene`: per-lane density (the same
 * `onsetsByCycle` the heatmap used) PLUS capped mini-note marks (real note
 * positions) so the renderer can show readable rhythm/pitch when zoomed in and
 * coarse density when zoomed out (design §4.5). The scene is pure data over the
 * shared content-space transform (PV116) — it knows nothing about canvas, DPR,
 * or scroll. `drawTimeline` consumes it; `SongTimelineCanvas` owns the surface.
 *
 * This module is PURE (only TYPE imports from `@stave/editor`, so it stays out
 * of vitest's CJS-`gifenc` trap). The note-mark COLLECTION — which needs the
 * runtime `collectCycles`/`laneKeyOf` — lives in `timelineMarks.ts`; this
 * builder merges its already-collected output as data.
 */

import type { SongAnalysis, SongSection } from '@stave/editor'
import type { SongWindow } from './songAxis'
import { trackIdentity } from './colors'
import { containingAnchor } from './laneIdentity'
import { resolveLaneName } from './trackLabel'
import { resolveSectionName } from './sectionLabel'
import type { DeclaredTrack } from './trackOrder'
import type { SignalAutomation } from './signalAutomation'

/** Grouping key for marks with no sample name (`s == null`) — synth notes that
 *  carry only a `note`. Shared by the scene builder and the renderer so a
 *  null-`s` voice maps to the same sub-group on both sides (#424). The NUL char
 *  can't collide with a real sample name. */
export const NO_VOICE = '\0'

/** One shared empty list, so the common case (a lane with no automation)
 *  allocates nothing per lane per rebuild. */
const EMPTY_AUTOMATIONS: readonly SignalAutomation[] = []

/** A single read-only mini-note mark within a lane. */
export interface SceneNote {
  /** Fractional SONG-ABSOLUTE cycle of the onset (event `begin`). Absolute, not
   *  window-relative: this cycle reaches the edit path. */
  readonly cycle: number
  /** Fractional song cycle of the offset (event `end`), `≥ cycle`. The mark's
   *  width is `(end − cycle) × pxPerCycle` — DURATION-proportional, mirroring the
   *  live view's note blocks (`eventToRect`), not a fixed dab. */
  readonly end: number
  /** MIDI pitch for in-lane vertical placement, or null for percussive events. */
  readonly pitch: number | null
  /** Gain 0–1 — drives mark intensity. */
  readonly gain: number
  /** Sample/instrument name (`ev.s`) — the per-voice partition key within a lane
   *  (#424). A `$:` drum stack lands in ONE lane (shared `trackId`) but its
   *  events carry distinct `s` (bd/sd/hh), so grouping by `s` recovers the
   *  voices the track merged. `null`/absent → grouped under `NO_VOICE`. Captured
   *  in the runtime walk (`timelineMarks`), so this pure module never reads the
   *  editor IR. Optional so hand-built fixtures stay terse (treated as null). */
  readonly voice?: string | null
}

/**
 * Bound a lane's note-mark array to `cap` entries WITHOUT truncating its time
 * extent. When a lane has more marks than `cap` (a dense track over a long
 * span), keep every Nth mark (`stride = ceil(len / cap)`) so the survivors are
 * spread evenly across the WHOLE span — the first mark and a mark within one
 * stride of the last both survive, so the drawn clip still covers the track's
 * true extent, just with uniformly thinner ticks. Output length is always
 * `≤ cap`, so the retained-marks / per-frame-draw budget is unchanged.
 *
 * Replaces the earlier TAIL-DROP (keep the first `cap` in cycle order, discard
 * the rest), which cut a dense lane's clip off partway through the song (#714):
 * a ~35-onset/cycle drum stack hit the 2000 cap at cycle ~57, so its expanded
 * voice bars stopped there while sparser tracks spanned the full timeline.
 *
 * `marks` is assumed in collection (≈ cycle-ascending) order — the order
 * `collectNoteMarks` pushes them. Returns the SAME array reference (no copy)
 * when already within `cap`. `capped` is true iff a downsample happened.
 */
export function downsampleMarksToCap(
  marks: SceneNote[],
  cap: number,
): { marks: SceneNote[]; capped: boolean } {
  if (cap <= 0 || marks.length <= cap) return { marks, capped: false }
  const stride = Math.ceil(marks.length / cap)
  const out: SceneNote[] = []
  for (let i = 0; i < marks.length; i += stride) out.push(marks[i])
  return { marks: out, capped: true }
}

/** One voice (distinct sample/instrument) within a lane — the sub-row model an
 *  EXPANDED lane splits into (#424). Mirrors the live view's leaf voices
 *  (`layoutTrackRows` `LeafLayout`), but partitioned by `s` rather than the
 *  unreliable `leafIndex` bridge. A single-voice lane has one entry and renders
 *  unchanged (one band). */
export interface SceneVoice {
  /** Partition key — the sample name, or `NO_VOICE` for null-`s` synth notes. */
  readonly key: string
  /** Gutter label — the sample name; `·` for the null-`s` group. */
  readonly label: string
  /** True when any mark in this voice carries a pitch (melodic → pitch-Y band);
   *  false for percussive (flat baseline per voice). */
  readonly melodic: boolean
  /** Min/max MIDI across this voice's pitched marks, or null when percussive. */
  readonly pitchMin: number | null
  readonly pitchMax: number | null
}

/** One read-only timeline CLIP — a time-sequenced segment of a lane (Phase 5a,
 *  #386). A clip maps to one arm of an `arrange`/`cat`/`slowcat` combinator; a
 *  bare track (no combinator) is ONE implicit clip spanning the whole song
 *  (design §5 option b). Clips are STRUCTURE (the timeline owns them), distinct
 *  from the note CONTENT drawn inside them (design §3 layering). Read-only this
 *  PR — the 4 edit ops (move/trim/duplicate/split) come in P5b/c. */
export interface SceneClip {
  /** Index of the source `Arrange` arm (`IREvent.armIndex`), or `-1` for the
   *  implicit single clip of a bare track. Together with the lane key this is
   *  the clip's identity. */
  readonly armIndex: number
  /** Start cycle (inclusive) on the shared content-space axis. */
  readonly startCycle: number
  /** End cycle (exclusive), `> startCycle`. Width = `(end − start) × pxPerCycle`.
   *  Clip boundaries are whole-cycle-aligned (arms span whole cycles — grounded). */
  readonly endCycle: number
  /** A representative voice/sample/note label for the clip (the first event's
   *  `s` or `note`), or null when none — drives an optional clip caption. */
  readonly label: string | null
  /** Source range of the arm's `[n, pat]` tuple, or null with no provenance
   *  (#1391). Raw range rather than a resolved string because this module is the
   *  only layer that holds the user's code — see `sectionName`. */
  readonly nameRange: readonly [number, number] | null
  /** The SECTION NAME (#1391) — the identifier the musician bound the arm to
   *  (`intro`, `verse`), or a positional `§{n}` when the arm is an inline
   *  expression with no name to read.
   *
   *  ⚠ IDENTITY STAYS `armIndex`, exactly as `SceneLane` keeps `laneKey` while
   *  `displayName` resolves to the source label. Only the NAME resolves here, so
   *  a section that is renamed is still the same clip. */
  readonly sectionName: string
}

/** One timeline row. */
export interface SceneLane {
  readonly laneKey: string
  /** The display NAME (#579 STEP 2). The source LABEL for a named track
   *  (`bass`, `lead`), else the positional `laneKey` (`d{N}`) for an anonymous
   *  `$:`. The lane's IDENTITY stays `laneKey` (drives the live overlay match);
   *  only this name — and `color`, derived from it — resolves to the label. */
  readonly displayName: string
  readonly color: string
  /** `onsetsByCycle` — onset count per integer cycle. ⚠ The ONE window-relative
   *  array on the scene: `density[i]` is cycle `windowOriginCycles + i`. */
  readonly density: readonly number[]
  /** Capped mini-note marks; empty when no IR / not collected. */
  readonly notes: readonly SceneNote[]
  /** Min/max MIDI across this lane's pitched marks (for in-lane Y auto-fit),
   *  or null when the lane has no pitched marks (percussive). */
  readonly pitchMin: number | null
  readonly pitchMax: number | null
  /** Ordered voice sub-groups (by `s`), first-seen order (#424). One entry for a
   *  single-voice lane (renders unchanged). When a lane has ≥2 voices AND is
   *  expanded, `laneLayout` splits it into per-voice sub-rows. Empty when the
   *  lane has no collected marks (density-only). */
  readonly voices: readonly SceneVoice[]
  /** Ordered read-only clips (#386). At least one entry: an arrangement track
   *  has one clip per `arrange`/`cat` arm; a bare track has a single implicit
   *  clip spanning the whole window, in absolute cycles. Drawn as segment rects behind the
   *  lane's note marks (design §4.2); hit-testable for the later edit ops. */
  readonly clips: readonly SceneClip[]
  /** Source-character offset of a representative event for this lane (the first
   *  collected event's INNERMOST `loc[0].start`), or null when the IR has no
   *  source provenance. Drives expand-to-bind: lane → offset → editor cursor →
   *  the Pattern panel rebinds (#422, design §3.1) — the inner CONTENT anchor.
   *  Not used for drawing. */
  readonly sourceOffset: number | null
  /** Source offset of this lane's `$:`/`name:` STATEMENT (`IREvent.dollarPos`),
   *  or null when the lane has no source provenance. The rename anchor (#580):
   *  `detectAllChunks` finds the chunk whose `statementRange[0]` equals this, and
   *  `renameEdit` rewrites its label. Distinct from `sourceOffset` (the innermost
   *  CONTENT anchor for expand→bind) and `arrangeOffset` (the outer combinator). */
  readonly labelOffset: number | null
  /** Source-character offset of this lane's OUTERMOST arrangement combinator
   *  (the first event's MINIMUM `loc[*].start` — the outer call begins earliest;
   *  suffix wrappers like `.p`/`.gain` start later), or null. Drives clip
   *  GESTURES: `detectArrangeAt` resolves the outer `arrange`/`cat` so an arm
   *  whose pattern is itself a combinator edits as ONE outer clip (#451). Equals
   *  `sourceOffset` for a non-nested track (single `loc` entry). The
   *  structure-vs-content counterpart of `sourceOffset`. */
  readonly arrangeOffset: number | null
  /** Continuous automation this track declares (#1464 Stage 1) — one entry per
   *  automated parameter, or empty, which is the ordinary case (97 of 329 real
   *  documents carry any). READ-ONLY: the lane draws these and nothing writes
   *  them back, which is what keeps #1482's byte-verbatim round-trip safe by
   *  construction rather than by test. */
  readonly automations: readonly SignalAutomation[]
}

/** The full scene the canvas renderer draws. */
export interface TimelineScene {
  readonly lanes: readonly SceneLane[]
  readonly sections: readonly SongSection[]
  /** Display span in cycles (one loop period, or the analyzed horizon). ≥ 1. */
  readonly displayCycles: number
  /** First cycle of the window this scene shows (song-absolute); 0 unpaged.
   *  Every OTHER cycle on this scene is song-absolute; `SceneLane.density` is the
   *  single exception, indexed from here. Renderers convert once, at this field,
   *  and never subtract the origin at individual use sites. */
  readonly windowOriginCycles: number
  /** Detected loop period, or null. */
  readonly period: number | null
  /** Peak onset count across all lanes — normalises density intensity. ≥ 1. */
  readonly peakDensity: number
  /** True when any lane's note marks were truncated at the cap (no silent loss
   *  — the renderer can surface it; density still covers the whole span). */
  readonly notesCapped: boolean
}

export interface CollectedMarks {
  readonly marksByLane: ReadonlyMap<string, SceneNote[]>
  /** Per-lane representative source offset (first event's `loc[0].start`) for
   *  expand-to-bind. Absent lane → no source provenance (hand-built IR). */
  readonly sourceByLane: ReadonlyMap<string, number>
  /** Per-lane OUTERMOST combinator offset (first event's MINIMUM `loc[*].start`)
   *  for clip gestures (#451). Absent lane → no source provenance. */
  readonly arrangeByLane: ReadonlyMap<string, number>
  /** Per-lane statement (label) offset = `IREvent.dollarPos` (#579 STEP 2). The
   *  pure builder reads the source at this offset to resolve a named track's
   *  display label. Absent lane → no source provenance → keeps `d{N}`. */
  readonly labelOffsetByLane: ReadonlyMap<string, number>
  /** Per-lane read-only clips derived from `IREvent.armIndex` (#386). Present
   *  ONLY for lanes whose track is an `arrange`/`cat`/`slowcat` combinator;
   *  absent → the builder synthesises one implicit clip (bare track). */
  readonly clipsByLane: ReadonlyMap<string, SceneClip[]>
  /** True if any lane hit the cap (marks dropped — surfaced, not silent). */
  readonly capped: boolean
}

/** A shared empty collection (the no-IR / no-marks default). */
export const EMPTY_MARKS: CollectedMarks = {
  marksByLane: new Map(),
  sourceByLane: new Map(),
  arrangeByLane: new Map(),
  labelOffsetByLane: new Map(),
  clipsByLane: new Map(),
  capped: false,
}

/**
 * What the scene needs in order to DRAW: onset activity per lane, and the
 * sections partitioning what is on screen. Structurally satisfied by both
 * `SongAnalysis` (the whole song) and `WindowAnalysis` (one page of it), which
 * is the entire point — the scene never needed the difference between them.
 *
 * Everything a window cannot answer is a separate parameter: the period, which
 * belongs to the song rather than the page, and the span, which the window
 * itself carries.
 */
export interface SceneActivity {
  readonly lanes: SongAnalysis['lanes']
  readonly sections: readonly SongSection[]
}

/**
 * Build the render scene from the activity (density, sections, span, period)
 * merged with the collected note marks. PURE — no IR walk, no canvas. Lanes keep
 * `analyzeSong`'s key, so the canvas rows line up with the DOM lane labels
 * exactly; their ORDER is the caller's `declaredTracks` when given (#871),
 * else `analyzeSong`'s first-seen order with the eval lanes appended.
 *
 * ROWS COME FROM THREE SOURCES, in this order of preference per track:
 *   1. an `analyzeSong` lane      — the track produced events;
 *   2. an eval-marks key          — a signal/bare-ref/bare-document track whose
 *                                   marks come from haps (#864, #1094);
 *   3. a DECLARED track (#1098)   — the document says the track exists and both
 *                                   sources above are legitimately empty, as for
 *                                   a muted track.
 * (1) and (2) are evaluated output; (3) is structure. Without (3) the row set is
 * "what played" rather than "what was written", and a muted track vanishes
 * instead of fading — silently, since an absent row reads as a valid state.
 */
export function buildTimelineScene(
  /** The onset activity and sections to draw. Deliberately NARROWER than
   *  `SongAnalysis`: these two fields are all the scene ever read from it, and
   *  asking for only them is what lets a `WindowAnalysis` drive the scene without
   *  first being dressed up as a whole song. A window has no period and no
   *  display span, and the alternative — synthesising them so it satisfies
   *  `SongAnalysis` — would put a `periodCycles: null` on a window, which is the
   *  one thing that type exists to make impossible. */
  activity: SceneActivity | null,
  /** WHICH window is on screen — origin and span together, never as two loose
   *  numbers. The same `SongWindow` the axis takes, and the same shape
   *  `WindowAnalysis` already publishes.
   *
   *  ⚠ ONE OBJECT ON PURPOSE. Origin and span are both plain cycle counts, so as
   *  separate positional arguments a swap type-checks and yields a plausible
   *  timeline of the wrong part of the song — the exact failure the origin was
   *  made required to avoid, reintroduced by argument order instead of by
   *  omission. Bundled, the swap cannot be written.
   *
   *  ⚠ This is the ONE frame conversion in the scene. `LaneActivity.onsetsByCycle`
   *  is indexed FROM the origin (an array cannot start at 256 without wasting the
   *  prefix), while every cycle the scene EXPORTS — clip bounds, note cycles,
   *  section bounds — stays song-absolute, because those feed the edit path and a
   *  window-relative cycle would write the edit to the wrong bar. So the scene
   *  carries the origin and `density` is the only thing indexed relative to it. */
  songWindow: SongWindow,
  /** The detected loop period, or null when the song has none. Passed EXPLICITLY
   *  rather than read off the activity, because a window cannot answer it: the
   *  period is a property of the whole song, decided once, and a paged view only
   *  exists on the branch where that decision came back empty. A window therefore
   *  passes null structurally rather than by remembering to. */
  period: number | null,
  /** Normalisation floor for the density colour scale, or null to normalise over
   *  THIS window alone. Required — see the trade-off where `peakDensity` is
   *  computed. A single-window view passes null and gets the historical
   *  behaviour; anything that pages has to state which it means, because the two
   *  differ silently and only in how the same music is coloured. */
  carriedPeakDensity: number | null,
  marks: CollectedMarks = EMPTY_MARKS,
  /** Raw user source (#579 STEP 2) — read at each lane's `labelOffset`
   *  (`dollarPos`) to resolve a NAMED track's display label. Absent → every
   *  lane keeps its positional `d{N}` name (the pre-STEP-2 behaviour). */
  code?: string | null,
  /** Per-track custom colour overrides (Phase D, #581), keyed by the lane's
   *  DISPLAY NAME (the same key the Mixer uses). A lane with an override colours
   *  `customColor ?? colorForTrack(name)` via the shared `trackIdentity`; absent
   *  → the deterministic palette. Drives the lane dot AND the canvas density bars
   *  (the renderer reads `lane.color`). */
  customColorByName?: ReadonlyMap<string, string>,
  /** Track ids in SOURCE order (#871), from the IR's track list — the lane order
   *  the user wrote. Ranks IR-backed and eval-backed lanes together, so a track
   *  that emits no static-IR events (a signal, a bare ref) sits where it was
   *  written instead of after every IR lane. Absent/empty → no order information,
   *  keep `analyzeSong`'s first-seen order with the eval lanes appended.
   *
   *  PROMOTED BY #1098, and the promotion is the thing to notice: this is no
   *  longer only an ORDERING hint, it is also the row-EXISTENCE source for a
   *  declared-but-silent track. Same datum — the document's top-level tracks —
   *  read two ways, so nothing is derived twice and there is no second
   *  enumeration to keep in step. The consequence is that passing a PARTIAL list
   *  now drops rows rather than merely mis-ordering them, so callers must pass the
   *  whole track list or nothing: `declaredTracks(ir)` (trackOrder.ts) is the only
   *  intended producer, and it is total over top-level `Track` nodes and
   *  mute-invariant via `trackIdFromLabel`. Absent/empty is still fully supported
   *  (no rows added).
   *
   *  EACH ENTRY CARRIES ITS STATEMENT OFFSET (#1101), which is what makes the
   *  existence question answerable without comparing names — see the
   *  reconciliation below. Ordering reads only the ids. */
  declaredTracks?: readonly DeclaredTrack[],
  /** Continuous automation per track id (#1464 Stage 1), from `signalAutomations`
   *  (signalAutomation.ts) — the IR-derived input, computed by the CALLER.
   *
   *  ⚠ Passed in rather than read here, for the same reason `declaredTracks` is:
   *  this function is PURE and walks no IR, and that is the property that lets a
   *  window drive the scene without an IR at hand. Absent → every lane gets an
   *  empty list and draws no curve, which is also what a document with no
   *  automation gets, so the two are indistinguishable to the renderer and there
   *  is no third state to handle. */
  automationsByTrack?: ReadonlyMap<string, readonly SignalAutomation[]>,
): TimelineScene {
  // The span comes from the window, always — there is no longer a fallback that
  // infers it from the analysis. The caller owns the authoritative span because
  // it floors a bare loop to a minimum arrangement length so the single implicit
  // clip has room to split (#489 D3), and it drives both the bare clip's
  // `endCycle` and `scene.displayCycles`, keeping the clip rect and the geometry
  // transform in lock-step.
  //
  // The removed fallback read `displaySpan`, which a window does not have. Rather
  // than give windows a synthetic one, the inference moved OUT of production: it
  // was only ever exercised by tests and density-only callers (`FullSongTimeline`
  // has always passed an explicit span), so it lives in the test helper now,
  // where being a convenience is honest.
  const displayCycles = Math.max(1, Math.round(songWindow.spanCycles) || 1)
  const windowOriginCycles = songWindow.originCycle
  const lanesIn = activity?.lanes ?? []
  const analysisKeys = new Set(lanesIn.map((l) => l.laneKey))
  const nCycles = Math.ceil(displayCycles)

  // Eval-backed lanes (#864 / P1b): marks lanes the static-IR analysis never
  // produced — a signal (`.segment`) or bare-ref track that emits no static IR
  // events, so it has no `LaneActivity` here. `collectHapMarks` already keys them
  // by the positional/named eval identity (`evalTrackIdToLaneKey`), disjoint from
  // the IR lane keys, so any marks key not in `analysisKeys` is one such track.
  // Their coarse density is synthesised from their marks (below); they append
  // AFTER the IR lanes in first-seen (Map) order. Absent → the IR-only behaviour.
  const evalLaneKeys = [...marks.marksByLane.keys()].filter((k) => !analysisKeys.has(k))
  const evalDensities = new Map<string, number[]>()
  for (const key of evalLaneKeys) {
    evalDensities.set(
      key,
      densityFromNotes(marks.marksByLane.get(key) ?? [], nCycles, windowOriginCycles),
    )
  }

  // Declared-but-silent lanes (#1098): a track the DOCUMENT declares that
  // produced NEITHER analysis events NOR eval marks. Both row sources above are
  // evaluated output, so a track that legitimately plays nothing has no row at
  // all — and an absent row raises nothing, it just reads as "you wrote no such
  // track". A MUTED track is the everyday case: Strudel returns `silence` for a
  // `_`-prefixed id without registering it (`@strudel/core/repl.mjs:172-175`)
  // and our capture hook mirrors that branch deliberately, so it emits no haps
  // BY DESIGN and every eval-derived source is correctly empty for it.
  //
  // So these rows come from STRUCTURE instead: the display's row set is the
  // DOCUMENT's track set. That is a DIFFERENT statement from the engine's
  // capture set equalling what the runtime plays (#1094) — the engine still
  // captures nothing for a muted track and still should not. Which is why the
  // repair lives here, in the row builder, and not at the capture hook.
  //
  // The source is `declaredTracks` — the IR's TOP-LEVEL `Track` nodes, one per
  // `$:`/`name:` statement, mute-invariant via `trackIdFromLabel` — and
  // deliberately NOT the marks annotation maps (`labelOffsetByLane` and
  // siblings). Those additionally carry lanes the RESILIENT structural walk
  // reaches on mid-edit/invalid code, plus the #927 zero-event anchor seeds;
  // promoting them to a row source is exactly the phantom row that
  // `collectNoteMarks`'s annotate-only rule exists to prevent (timelineMarks.ts
  // ~:143). A top-level Track node is a statement the user actually wrote.
  // THE KEY SPACES CAN DIVERGE, so key difference alone is not enough — and
  // getting this wrong ADDS a duplicate row, which is worse than the missing one
  // being fixed. A track's IR id and its row key are two naming systems that
  // normally agree because eval haps are attributed by SOURCE CONTAINMENT
  // (`laneKeyForHap`), which resolves both to the IR id. They diverge when
  // containment cannot run and the hap falls back to its own producer id:
  // `$: s("bd*4").p('kick')` draws its row under `kick` while the IR calls the
  // statement `d1` (`.p()` is a chain method, not the statement's label), so a
  // plain key difference invents a second `d1` row for the one track.
  //
  // Measured: that divergence needs the document to have ONE top-level
  // statement — the IR root is then a `Track` rather than a `Stack`, which is
  // the case containment misses. With two or more statements the anchors exist
  // and every row comes back keyed by its IR id (verified for `.p('name')`
  // alongside a muted track: rows `d1`,`d2`).
  //
  // So the guard is a pigeonhole on REPRESENTATION rather than on names: if the
  // display already shows at least as many rows as the document declares
  // tracks, every track is represented — possibly under a name we cannot match —
  // and nothing may be added. In the only shape where the names can disagree
  // the document declares exactly ONE track, so any drawn row satisfies it.
  // When the display is genuinely SHORT of the document, the missing tracks are
  // the ones no row is keyed to, which is what the filter names.
  //
  // SO THE MATCH IS POSITIONAL, NOT BY NAME (#1101). Both sides already carry the
  // statement offset — the declared track its label's `loc[0].start`, a drawn row
  // its `labelOffset` — and only the NAMES disagree. `containingAnchor` is the
  // reconciler the rest of this subsystem uses for exactly this (`laneKeyForHap`
  // attributes every hap by it), so asking it here means one rule with one
  // definition rather than a second, private comparison beside it.
  //
  // A declared track with NO offset is never given a row, and that is a syntactic
  // argument rather than a cautious one: an offset is the label's position, muting
  // is a PREFIX on that label (`_$:`, `_name:`), so an unlabelled statement cannot
  // be muted and is never owed a silent row. It is also exactly the pre-#1098
  // behaviour for bare documents, whose row comes from the eval capture (#1094).
  // (Consequence, deliberate: a bare `silence` statement draws no row. Nothing
  // declared it as a track, and nothing played.)
  //
  // Representation takes the UNION of both readings — a row keyed by the track's
  // own id, or a row whose offset lands in the track's statement. The asymmetry is
  // the point: a false "represented" leaves a row missing, a false "unrepresented"
  // draws the same track TWICE. Only the second corrupts what the user sees, so
  // any evidence of representation is enough to withhold.
  const drawnKeys = [...analysisKeys, ...evalLaneKeys]
  const anchors = (declaredTracks ?? [])
    .flatMap((t) => (typeof t.offset === 'number' && Number.isFinite(t.offset) ? [[t.id, t.offset] as const] : []))
    .sort((a, b) => a[1] - b[1]) // `containingAnchor` requires ascending
  const represented = new Set<string>()
  for (const key of drawnKeys) {
    represented.add(key)
    const owner = containingAnchor(anchors, marks.labelOffsetByLane.get(key))
    if (owner !== undefined) represented.add(owner)
  }
  const declaredSilentKeys = anchors
    .filter(([id]) => !represented.has(id))
    .map(([id]) => id)

  // Peak onset across ALL lanes (IR + eval, ≥1) so the busiest cell is full-intensity.
  //
  // ⚠ THE DOMAIN OF THIS MAXIMUM IS THE DOMAIN OF THE COLOUR SCALE, and once the
  // view can page they stop being obviously the same thing. A window-local max
  // means the busiest cell in view is always full-intensity, so paging to a
  // quieter stretch silently BRIGHTENS it: identical music reads as a different
  // density depending on what else happens to be on screen, with nothing saying
  // the scale moved. `carriedPeakDensity` is how a caller that shows more than
  // one window says "normalise against this instead".
  //
  // Neither answer is free, and the caller is the only one that can choose:
  //   · window-local (null) — every page uses its full colour range, and no two
  //     pages are comparable.
  //   · carried — pages are comparable, but the scale then depends on which
  //     windows have been VISITED, so the same page can render differently
  //     depending on how the user got there. A carried value should therefore
  //     come from something stable (the song's own peak), not from a running
  //     maximum accumulated by browsing.
  let peakDensity = Math.max(1, carriedPeakDensity ?? 1)
  for (const lane of lanesIn) {
    for (const c of lane.onsetsByCycle) if (c > peakDensity) peakDensity = c
  }
  for (const density of evalDensities.values()) {
    for (const c of density) if (c > peakDensity) peakDensity = c
  }

  const buildLane = (laneKey: string, density: readonly number[]): SceneLane => {
    const notes = marks.marksByLane.get(laneKey) ?? []
    let pitchMin: number | null = null
    let pitchMax: number | null = null
    for (const n of notes) {
      if (n.pitch == null) continue
      if (pitchMin == null || n.pitch < pitchMin) pitchMin = n.pitch
      if (pitchMax == null || n.pitch > pitchMax) pitchMax = n.pitch
    }
    // Clips: an arrangement track contributes per-arm clips; a bare/eval track
    // (no combinator → no `armIndex` events) gets ONE implicit clip spanning the
    // whole song (design §5 option b). The implicit clip is synthesised here
    // (the pure builder owns `displayCycles`) so every lane has ≥1 clip.
    const rawClips: SceneClip[] = marks.clipsByLane.get(laneKey) ?? [
      {
        armIndex: -1,
        startCycle: windowOriginCycles,
        endCycle: windowOriginCycles + displayCycles,
        label: null,
        nameRange: null,
        // A bare track is not an arrangement, so it has no section to name. The
        // implicit clip spans the whole song and says so.
        sectionName: '',
      },
    ]
    // #1391 — resolve each arm's NAME from the user's code, here rather than in
    // the collector, because this is the layer that holds `code`. Same division
    // of labour as a lane's `displayName`: the walk carries an offset, the pure
    // builder reads the source at it.
    const clips: SceneClip[] = marks.clipsByLane.has(laneKey)
      ? rawClips.map((c) => ({
          ...c,
          sectionName: resolveSectionName(c.armIndex, c.nameRange, code),
        }))
      : rawClips
    // Display name (#579 STEP 2): a NAMED track's source label, else the
    // positional `d{N}`. Both the name AND the colour key on it, so a named
    // lane reads + colours identically to its Mixer strip (one `trackIdentity`).
    // An eval lane has no `labelOffset` → `resolveLaneName` returns the key, which
    // `evalTrackIdToLaneKey` already made the positional `d{N}` (or the name).
    const displayName = resolveLaneName(laneKey, marks.labelOffsetByLane.get(laneKey), code)
    // Colour resolves through the SHARED `trackIdentity` (V-track-1/2): the
    // deterministic palette by default, the per-track custom override when set —
    // `customColor ?? colorForTrack(displayName)` — keyed by the display name so
    // the lane matches its Mixer strip. Drives the dot AND the canvas density bars
    // (the renderer reads `lane.color`).
    return {
      laneKey,
      displayName,
      color: trackIdentity(displayName, customColorByName?.get(displayName)).color,
      density,
      notes,
      pitchMin,
      pitchMax,
      voices: groupVoices(notes),
      clips,
      sourceOffset: marks.sourceByLane.get(laneKey) ?? null,
      arrangeOffset: marks.arrangeByLane.get(laneKey) ?? null,
      automations: automationsByTrack?.get(laneKey) ?? EMPTY_AUTOMATIONS,
      labelOffset: marks.labelOffsetByLane.get(laneKey) ?? null,
    }
  }

  // IR lanes keep `analyzeSong`'s first-seen order; eval lanes follow in marks
  // order. That concatenation is only a DEFAULT — it puts every eval lane after
  // every IR lane, which reverses a signal/bare-ref track written first (#871).
  const built: SceneLane[] = [
    ...lanesIn.map((lane) => buildLane(lane.laneKey, lane.onsetsByCycle)),
    ...evalLaneKeys.map((key) => buildLane(key, evalDensities.get(key)!)),
    // Zero density through the SAME helper the eval lanes use, so the array
    // length rule (one bucket per displayed cycle) is stated in one place.
    // No notes, no clips of its own → `buildLane` gives it the whole-song
    // implicit clip, so the row is present and empty rather than degenerate.
    ...declaredSilentKeys.map((key) =>
      buildLane(key, densityFromNotes([], nCycles, windowOriginCycles)),
    ),
  ]
  // Source order (#871): rank IR-backed and eval-backed lanes TOGETHER by the
  // IR's track list, so each lane sits where the user wrote it regardless of
  // which layer produced its marks. A lane whose key isn't a track id (a hand-
  // built IR, an `s`-keyed fallback lane) has no source position — it keeps its
  // relative order at the end rather than being dropped or guessed at. The sort
  // is stable, so an IR-only song (whose analysis order ALREADY follows the IR)
  // is unchanged.
  const rank = new Map(declaredTracks?.map((t, i) => [t.id, i] as const) ?? [])
  // A lane's source position is found the SAME two ways its existence is (#1101):
  // by its own key, else by which declared statement CONTAINS its offset. Without
  // the second reading a `.p('name')` track — whose row key is the producer id and
  // not the IR id — has no rank and sorts to the end, so it renders BELOW a track
  // written after it. Same rule, same primitive, so order and existence can never
  // disagree about which statement a row belongs to.
  //
  // Resolved ONCE per lane rather than inside the comparator: a sort calls its
  // comparator O(n log n) times and each call would re-run the anchor scan.
  const rankByLane = new Map<string, number>()
  for (const lane of built) {
    const own = rank.get(lane.laneKey)
    const owner = own !== undefined ? undefined : containingAnchor(anchors, lane.labelOffset ?? undefined)
    const resolved = own ?? (owner === undefined ? undefined : rank.get(owner))
    if (resolved !== undefined) rankByLane.set(lane.laneKey, resolved)
  }
  const lanes: SceneLane[] =
    rank.size === 0
      ? built
      : [
          ...built
            .filter((l) => rankByLane.has(l.laneKey))
            .sort((a, b) => rankByLane.get(a.laneKey)! - rankByLane.get(b.laneKey)!),
          ...built.filter((l) => !rankByLane.has(l.laneKey)),
        ]

  return {
    lanes,
    sections: activity?.sections ?? [],
    displayCycles,
    windowOriginCycles,
    period,
    peakDensity,
    notesCapped: marks.capped,
  }
}

/**
 * Hit-test: the clip in `lane` containing fractional song `cycle`, or null when
 * the cycle is outside every clip (#386). Pure — the scene-level primitive the
 * canvas host will map a pointer (x → cycle via the shared transform) onto when
 * the edit ops land (P5b/c). Read-only this PR; nothing wires a gesture yet.
 * `startCycle` inclusive, `endCycle` exclusive.
 */
export function clipAtCycle(lane: SceneLane, cycle: number): SceneClip | null {
  for (const clip of lane.clips) {
    if (cycle >= clip.startCycle && cycle < clip.endCycle) return clip
  }
  return null
}

/**
 * Per-integer-cycle onset counts for a lane synthesised from its marks (#864).
 * Eval-backed lanes have no `analyzeSong` `LaneActivity`, so their coarse density
 * (the zoomed-out heatmap) is counted here from the note onsets by `floor(cycle)`
 * — the same bucketing `accumulateLanes` uses for IR lanes. Length is `nCycles`
 * (the display span); onsets outside `[0, nCycles)` are ignored, mirroring the
 * IR path. PURE — operates on already-collected marks only.
 */
function densityFromNotes(
  notes: readonly SceneNote[],
  nCycles: number,
  windowOriginCycles: number,
): number[] {
  const density = new Array<number>(Math.max(0, nCycles)).fill(0)
  for (const n of notes) {
    // `n.cycle` is song-absolute; `density` is indexed from the window origin.
    // This is the same conversion the IR path gets from `accumulateLanesInWindow`.
    const c = Math.floor(n.cycle) - windowOriginCycles
    if (c >= 0 && c < density.length) density[c] += 1
  }
  return density
}

/**
 * Partition a lane's marks into ordered voice sub-groups by sample name (`s`),
 * first-seen order (#424). Each group records whether it's melodic (any pitched
 * mark) and its pitch range. A lane with one distinct `s` (or all null-`s`)
 * yields one group → the lane renders unchanged (one band). Marks with no `s`
 * pool under `NO_VOICE`. PURE — operates on already-collected marks only.
 */
function groupVoices(notes: readonly SceneNote[]): SceneVoice[] {
  const order: string[] = []
  const acc = new Map<
    string,
    { label: string; min: number | null; max: number | null; melodic: boolean }
  >()
  for (const n of notes) {
    const key = n.voice ?? NO_VOICE
    let g = acc.get(key)
    if (!g) {
      g = { label: n.voice ?? '·', min: null, max: null, melodic: false }
      acc.set(key, g)
      order.push(key)
    }
    if (n.pitch != null) {
      g.melodic = true
      if (g.min == null || n.pitch < g.min) g.min = n.pitch
      if (g.max == null || n.pitch > g.max) g.max = n.pitch
    }
  }
  return order.map((key) => {
    const g = acc.get(key)!
    return { key, label: g.label, melodic: g.melodic, pitchMin: g.min, pitchMax: g.max }
  })
}
