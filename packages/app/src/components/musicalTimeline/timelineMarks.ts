/**
 * timelineMarks — note-mark collection for the canvas Song timeline (#419).
 *
 * Split from `timelineScene.ts` because it needs the RUNTIME `collectCycles` /
 * `laneKeyOf` from `@stave/editor` — importing those values pulls the whole
 * editor bundle (and its CJS `gifenc` dep) into vitest, which breaks the loader.
 * Keeping this in its own file lets `timelineScene.ts` (the pure builder) stay
 * unit-testable without mocking. The real collection path is covered by the
 * Playwright spec against a real evaluated song.
 */

import type { IREvent, PatternIR } from '@stave/editor'

import type { SampleRegion } from './waveformLane'
import { positionalSectionName } from './sectionLabel'
import { structuralWalk, wholeWalkWindow } from '@stave/editor'
import { extractPitch } from './pitch'
import { containingAnchor } from './laneIdentity'
import type { SongWindow } from './songAxis'
import {
  downsampleMarksToCap,
  EMPTY_MARKS,
  type CollectedMarks,
  type SceneClip,
  type SceneNote,
} from './timelineScene'

/** Per-lane mini-note-mark cap, so a long/dense song can't retain unbounded
 *  marks. Density (per-cycle counts) always covers the full span regardless. */
export const NOTE_MARK_CAP_PER_LANE = 2000

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 1
  return n < 0 ? 0 : n > 1 ? 1 : n
}

/** The runtime hap accessors a windowed reader can go through. Both optional:
 *  with neither threaded (tests / non-Strudel runtimes) there are no haps. */
export interface TimelineEventAccessors {
  readonly getTimelineEventsBand?: ((startCycle: number, endCycle: number) => IREvent[]) | undefined
  readonly getTimelineEvents?: ((cycles: number) => IREvent[]) | undefined
}

/**
 * Read haps for `[startCycle, endCycle)` through whichever accessor is wired —
 * ONE definition of that choice, shared by the marks and by the analysis
 * collector, because they must never disagree about which events exist.
 *
 * ⚠ The prefix form is a correctness-preserving FALLBACK, not an equivalent.
 * `getTimelineEvents(endCycle)` returns `[0, endCycle)` — a superset — so every
 * caller still has to narrow the result itself. What it costs is the prefix: to
 * serve `[256, 288)` it queries 288 cycles and discards 256 of them. A paged
 * view without the band accessor is slow by construction, never wrong.
 *
 * `null` when no accessor is threaded at all, which callers read as "pre-eval".
 */
export function readEventsInBand(
  accessors: TimelineEventAccessors,
  startCycle: number,
  endCycle: number,
): IREvent[] | null {
  if (accessors.getTimelineEventsBand) return accessors.getTimelineEventsBand(startCycle, endCycle)
  if (accessors.getTimelineEvents) return accessors.getTimelineEvents(endCycle)
  return null
}

/**
 * Every DECLARED top-level track's containment anchor `(laneKey → $:-line start)`,
 * read straight from the IR Track wrappers — NOT from `collectCycles` events.
 *
 * #927 (P1b): a track whose note value is a signal (`n(run(8)).s(…)`,
 * `n(irand(8))…`) emits NO static-IR events, so the event-driven anchor build
 * below never registers its lane. Its eval haps, however, DO carry a `loc` (the
 * `.s("piano")` mini-string), so `irLaneFor` resolves them to the largest anchor
 * ≤ that offset — the PREVIOUS track's lane — and the signal track silently folds
 * into its neighbour (one lane where there should be two). Seeding the anchor map
 * from the declared Track wrappers (which exist and carry `trackId` + a `$:`-line
 * `loc` even with zero events) gives every declared track its own anchor, so a
 * located hap lands on its OWN lane and the eval-lane append (timelineScene) then
 * renders it. Loc-less haps (`note(sine…)`) are unaffected — they still fall
 * through to `evalTrackIdToLaneKey`. Only the TOP-LEVEL wrappers matter: a stack's
 * inner voices share their track's `trackId` (one lane), so no recursion.
 */
function declaredTrackAnchors(ir: PatternIR): Array<[string, number]> {
  const tracks = ir.tag === 'Stack' ? ir.tracks : [ir]
  const out: Array<[string, number]> = []
  for (const t of tracks) {
    if (t.tag !== 'Track') continue
    const start = t.loc?.[0]?.start
    if (typeof t.trackId === 'string' && typeof start === 'number' && Number.isFinite(start)) {
      out.push([t.trackId, start])
    }
  }
  return out
}

/**
 * Collect read-only mini-note marks for the WINDOW on screen, grouped by the
 * SAME `laneKeyOf` identity the analysis lanes use, capped per lane. `null` IR
 * / non-positive span → empty.
 *
 * ── WHY A WINDOW AND NOT A SPAN (#1209) ─────────────────────────────────────
 * This used to take a bare `displayCycles` and derive everything over
 * `[0, span)`. That is correct only while the view starts at cycle 0. Once the
 * Song view pages, the analysis follows the window but this did not — and
 * because `SceneNote.cycle` is song-ABSOLUTE, marks collected over `[0, 256)`
 * map to negative x at origin 256 and are culled, so a paged window drew its
 * density heatmap with NO note marks at all and the FIRST window's clips. The
 * span and the origin are only meaningful as a pair, so they arrive as one.
 *
 * Deterministic for a given IR. Returns marks keyed by lane so the pure scene
 * builder can merge them onto the matching analysis lanes.
 */
export function collectNoteMarks(
  events: IREvent[] | null,
  ir: PatternIR | null,
  window: SongWindow,
  capPerLane: number = NOTE_MARK_CAP_PER_LANE,
): CollectedMarks {
  const displayCycles = window.spanCycles
  if (!ir || !Number.isFinite(displayCycles) || displayCycles <= 0) return EMPTY_MARKS
  const originCycle = Math.max(
    0,
    Math.floor(Number.isFinite(window.originCycle) ? window.originCycle : 0),
  )
  // Display fidelity requires the EVAL path when it's available: an evaluated
  // hap carries the RESOLVED note (`n("0 2 4").scale("C:major")` → "C3"/"E3"/"G3"
  // — Strudel applies the scale at query time) plus `context.locations`, while
  // the static IR carries the raw source token ("0") and drops `.scale` to an
  // unused param, so IR-read pitch is a flat/wrong-pitch bar for any degree/
  // scale pattern (PV174 / P274). So: STRUCTURE (lanes/clips/source anchors)
  // always comes from the IR walk below; MARKS come from `events` when present
  // (attributed to IR lanes by source containment) and fall back to the IR only
  // pre-eval — correct there for note-names + percussion, and the only source
  // before the first eval. `events` present ⇒ skip the IR mark build (discarded).
  const useEval = Array.isArray(events) && events.length > 0
  // IR-derived note marks — the pre-eval fallback. Left empty when `useEval`.
  const marksByLane = new Map<string, SceneNote[]>()
  // Per-lane representative source offset for expand-to-bind: the innermost
  // content anchor `structuralWalk` records (first-wins on the first leaf of the
  // lane that carries a `loc`; char offsets into the evaluated source). The bind
  // maps this → editor cursor → the Pattern panel rebinds (#422). First-wins so
  // the anchor is stable. Populated from the walk's `sourceOffset` below.
  const sourceByLane = new Map<string, number>()
  // Per-lane OUTERMOST combinator offset for clip gestures (#451). A lane's loc
  // set is ordered leaf→…→outermost wrappers, but the LAST entry can be a non-
  // combinator suffix (`.p('x')`, `.gain(…)`), so `structuralWalk` takes the
  // MINIMUM start: the outermost `arrange`/`cat` call begins earliest in the
  // source, while leaves, inner combinators and suffix methods all start later.
  // `detectArrangeAt(min)` then resolves the OUTER combinator (that offset lies
  // only inside it, not the inner one) so a nested combinator arm edits as one
  // outer clip. `sourceByLane` keeps the innermost (content) anchor for
  // expand→bind. This is the primary anchor the clip write-back targets (see
  // STRUCTURE-WRITEBACK-PROVENANCE.md).
  //
  // #456 — in a MULTI-track (`$:`) file, the walk layers a Track-WRAPPER loc
  // (`withWrapperLoc`) spanning the whole `$:` line, whose start is the line
  // start = `dollarPos` — STRICTLY before the combinator (which sits after the
  // `$: ` prefix). The raw minimum would pick that wrapper offset, which lies
  // OUTSIDE every combinator, so `detectArrangeAt` would resolve null and the clip
  // op silently no-ops (selection still works — it's display-side). A single-track
  // lane has no wrapper loc, which is why standalone arranges wrote back fine. So
  // `structuralWalk` EXCLUDES the wrapper loc (`start === dollarPos`) from the
  // minimum; the combinator start always exceeds `dollarPos`, so this never drops
  // a real combinator and is a no-op when `dollarPos` is absent (hand-built IR).
  const arrangeByLane = new Map<string, number>()
  // Per-lane statement (label) offset for the display NAME (#579 STEP 2). The
  // live engine drops the JS label and keys the track positionally as `d{N}`;
  // `dollarPos` is the `$:`/`bass:` STATEMENT offset, so the label is recoverable
  // from the source there. First-wins (one Track = one dollarPos; a stack's
  // voices share it). ALSO the containment index eval haps are attributed to
  // (`collectHapMarks`). The pure scene builder reads the source at this offset
  // to resolve a named track's label (`resolveLaneName`).
  const labelOffsetByLane = new Map<string, number>()
  // Clip derivation (#386): per lane, the active arrange-arm index for each
  // integer SONG cycle, from `structuralWalk`'s per-cycle arm selection (an arm
  // spans whole cycles). Run-length-encoded into clips below. Only lanes reached
  // under an arrangement combinator (an `armIndex`) appear here; bare tracks get
  // an implicit clip from the pure builder. `label` = the arm's first-reached
  // sample/note (`armLabels`), kept out of the pure scene module (editor bundle —
  // P172). Feeds the `armIndex` clip gestures write back (provenance doc).
  const nCycles = Math.ceil(displayCycles)
  const armByCycleByLane = new Map<string, Array<number | undefined>>()
  const armLabelByLane = new Map<string, Map<number, string>>()
  const armRangeByLane = new Map<string, Map<number, readonly [number, number]>>()
  let capped = false
  // STRUCTURE — lane anchors from the resilient structural walk (#945/#974), NOT reduced from
  // `collectCycles` events. The walk derives the SAME anchors from source structure — proven
  // byte-identical to collect over the corpus (structuralWalk.test.ts, then the equivalence
  // gate collectNoteMarks.structuralWalk.test.ts) — but survives mid-edit / semantically-
  // invalid code where an eval-backed producer throws: a bad sub-node blanks only its own lane,
  // so the timeline keeps its skeleton (PV212). Marks then JOIN to these lanes from haps
  // (below). `sourceByLane`/`arrangeByLane`/`labelOffsetByLane`/`clipsByLane` only ANNOTATE
  // rows by key (timelineScene builds rows from `analysis.lanes` + eval-mark keys), so an extra
  // resilience lane the walk reaches — collect never does on valid code — cannot add a phantom
  // row; it simply has no annotation consumer until a hap lands in it.
  for (const lane of structuralWalk(ir, { originCycle, spanCycles: nCycles })) {
    const key = lane.laneKey
    if (lane.sourceOffset !== undefined) sourceByLane.set(key, lane.sourceOffset)
    if (lane.dollarPos !== undefined) labelOffsetByLane.set(key, lane.dollarPos)
    if (lane.arrangeOffset !== undefined) arrangeByLane.set(key, lane.arrangeOffset)
    if (lane.armByCycle) armByCycleByLane.set(key, lane.armByCycle)
    if (lane.armLabels) armLabelByLane.set(key, lane.armLabels)
    if (lane.armRanges) armRangeByLane.set(key, lane.armRanges)
  }
  // #1209 — ANCHORS for lanes this window never reaches. A lane silent through
  // the visible stretch (an `arrange` arm that rests, a track that has not
  // entered yet) still gets a ROW: the analysis pins lane membership to the
  // song's lane set, so a silent track stays a silenced row rather than ceasing
  // to exist. Without this pass that row would page in with no label, no bind
  // anchor and no clip-gesture anchor — and worse, a missing entry in the
  // containment index folds an unrelated hap onto the PREVIOUS lane (PV175).
  //
  // Only the ANCHORS are backfilled, never `armByCycle`: the clips belong to the
  // window and a lane with no arm here genuinely has no clip here.
  //
  // Skipped entirely at origin 0, where the two walks are the same walk — so the
  // unpaged path costs exactly what it always did, and a paged one costs twice
  // that regardless of how deep it sits.
  if (originCycle > 0) {
    for (const lane of structuralWalk(ir, wholeWalkWindow(nCycles))) {
      const key = lane.laneKey
      if (lane.sourceOffset !== undefined && !sourceByLane.has(key)) {
        sourceByLane.set(key, lane.sourceOffset)
      }
      if (lane.dollarPos !== undefined && !labelOffsetByLane.has(key)) {
        labelOffsetByLane.set(key, lane.dollarPos)
      }
      if (lane.arrangeOffset !== undefined && !arrangeByLane.has(key)) {
        arrangeByLane.set(key, lane.arrangeOffset)
      }
    }
  }
  // MARKS come solely from eval haps now (`collectHapMarks` under `useEval`). The
  // pre-eval `collectCycles` fallback was removed with the collect interpreter
  // (#975): before the first eval a lane draws its structure (label/clips) but no
  // marks, which eval fills within ~90ms–1.3s (eval-on-load, #978). Per-onset marks
  // are BEHAVIOUR the structural walk does not compute, so `marksByLane` stays empty
  // here and only the eval branch of `activeMarksByLane` populates it.
  // #927 — seed containment anchors for DECLARED tracks the event walk missed
  // (a signal-valued track emits zero static-IR events, so it never appeared
  // above). Additive + `!has`-guarded: event-producing tracks keep their
  // event-derived `dollarPos`; only zero-event tracks gain an anchor, so a
  // located hap in their span lands on their OWN lane instead of folding into
  // the previous one. Only meaningful for the eval path (haps carry `loc`).
  if (useEval && ir.tag === 'Stack') {
    for (const [key, start] of declaredTrackAnchors(ir)) {
      if (!labelOffsetByLane.has(key)) labelOffsetByLane.set(key, start)
    }
  }
  // When eval events are present, derive the marks from them instead of the IR
  // (display fidelity — PV174). Attributed to the IR lanes by source containment
  // (NOT trackId equality, which diverges for anon `$:` — PV175). Structure
  // (source/arrange/label offsets, clips) stays IR-owned above.
  const activeMarksByLane = useEval
    ? collectHapMarks(events as IREvent[], { originCycle, spanCycles: displayCycles }, labelOffsetByLane)
    : marksByLane
  // Bound each lane to `capPerLane` marks by downsampling ACROSS its span (keep
  // every Nth), not by dropping the tail. A dense lane (e.g. a drum stack at
  // ~35 onsets/cycle) keeps its full clip extent with uniformly thinner ticks
  // instead of being cut off at cycle ~57 (#714). Sparse lanes (≤ cap) are
  // untouched (same array reference).
  for (const [key, arr] of activeMarksByLane) {
    const ds = downsampleMarksToCap(arr, capPerLane)
    if (ds.capped) {
      activeMarksByLane.set(key, ds.marks)
      capped = true
    }
  }
  // Run-length-encode each lane's per-cycle arm index into contiguous clips.
  // A change in arm index (or a silent cycle) closes the current clip; this
  // yields one clip per arm-occurrence per period (so a song shown over
  // multiple periods repeats its clips, matching the timeline). Silent cycles
  // inside an arm split it — acceptable for read-only display this PR.
  //
  // ⚠ THIS IS THE ONE PLACE THE ORIGIN GOES BACK ON (#1209, PV300). `armByCycle`
  // is window-relative — slot `i` is song cycle `originCycle + i` — but
  // `SceneClip.startCycle` is song-ABSOLUTE and feeds clip WRITE-BACK, so a
  // window-relative clip cycle escaping here would edit a different bar than the
  // one the user dragged. Every cycle published below is `originCycle + slot`.
  const clipsByLane = new Map<string, SceneClip[]>()
  for (const [key, byCycle] of armByCycleByLane) {
    const labels = armLabelByLane.get(key)
    const ranges = armRangeByLane.get(key)
    const clips: SceneClip[] = []
    let runArm: number | undefined
    // Never read: `runArm` starts undefined, so the first slot always opens a
    // run and reassigns this before any clip is flushed. Written as the origin
    // rather than 0 so it cannot be mistaken for the window-relative frame —
    // the two LIVE sites are both inside the loop below.
    let runStart = originCycle
    const flush = (endCycle: number): void => {
      if (runArm !== undefined) {
        clips.push({
          armIndex: runArm,
          startCycle: runStart,
          endCycle,
          label: labels?.get(runArm) ?? null,
          // The arm's own source range (#1391) — the NAME is resolved later, in
          // the pure builder, which is the layer that holds the user's code.
          // Carrying the range rather than the resolved string keeps this module
          // free of source-reading, exactly as `labelOffsetByLane` does for lanes.
          nameRange: ranges?.get(runArm) ?? null,
          // The POSITIONAL name, always. The pure builder upgrades it to the
          // source identifier when it has the user's code — so a clip that never
          // reaches that layer still carries a true name rather than an empty
          // string a caption would render as a blank.
          sectionName: positionalSectionName(runArm),
        })
      }
    }
    for (let i = 0; i < nCycles; i++) {
      const arm = byCycle[i]
      if (arm !== runArm) {
        flush(originCycle + i)
        runArm = arm
        runStart = originCycle + i
      }
    }
    flush(originCycle + nCycles)
    if (clips.length > 0) clipsByLane.set(key, clips)
  }
  return { marksByLane: activeMarksByLane, sourceByLane, arrangeByLane, labelOffsetByLane, clipsByLane, capped }
}

/**
 * Lane key for an eval hap that has no IR lane — a signal (`.segment`) or
 * bare-ref track the static IR never emitted events for (#864 / P1b). Mirrors
 * `trackIdFromLabel`: an anonymous `$:` producer id (`$N`, source-ordered) → the
 * positional `d{N+1}`; a named track keeps its name. This aligns eval-only lane
 * identity with the IR convention (a signal at source position 1 reads `d2`, not
 * `$1`) and keeps eval lanes disjoint from IR lanes (which exist only for
 * event-producing tracks). Absent trackId (hand-built haps) → a single `d1`.
 */
function evalTrackIdToLaneKey(trackId: string | undefined): string {
  if (!trackId) return 'd1'
  const m = /^\$(\d+)$/.exec(trackId)
  return m ? `d${Number(m[1]) + 1}` : trackId
}

/**
 * The lane-anchor containment index eval haps are attributed to: `(laneKey,
 * dollarPos)` pairs ascending by `dollarPos`, from the resilient structural walk
 * plus the #927 declared-track seeding (zero-event tracks — signals / bare-refs —
 * the static IR emits nothing for). This is the SINGLE source of the hap→lane
 * join: `collectHapMarks` (marks) and the song-analysis remap (`analyzeSong`
 * onsets, #980) both attribute through `laneKeyForHap` over this index, so their
 * lane keyings can never drift (PV175 — a hap's `$N` trackId ≠ its `d{N}` IR lane
 * key; containment reconciles them via source offsets both sides carry).
 * `displayCycles` only bounds the walk — `dollarPos` is a source offset, so any
 * `≥ 1` yields the same anchors.
 */
export function buildLaneAnchors(
  ir: PatternIR | null,
  displayCycles: number,
): Array<[string, number]> {
  if (!ir) return []
  const labelOffsetByLane = new Map<string, number>()
  const nCycles = Math.max(1, Math.ceil(displayCycles))
  // Deliberately the WHOLE-SONG window, at every page (#1209): this index is the
  // capture-space join the ANALYSIS reads through, and a hap must resolve to the
  // same lane wherever the view happens to be looking. Narrowing it to the
  // visible window would make a hap's lane depend on the page.
  for (const lane of structuralWalk(ir, wholeWalkWindow(nCycles))) {
    if (lane.dollarPos !== undefined) labelOffsetByLane.set(lane.laneKey, lane.dollarPos)
  }
  if (ir.tag === 'Stack') {
    for (const [key, start] of declaredTrackAnchors(ir)) {
      if (!labelOffsetByLane.has(key)) labelOffsetByLane.set(key, start)
    }
  }
  return [...labelOffsetByLane].sort((a, b) => a[1] - b[1])
}

/**
 * Attribute one eval hap to its display lane key: source containment into the
 * anchor index (the IR lane whose `dollarPos` is the LARGEST ≤ the hap's
 * `loc[0].start`), else the hap's own positional producer id
 * (`evalTrackIdToLaneKey`). NOT `laneKeyOf` string equality — that splits an
 * anon `$:`'s `$N` hap from its `d{N}` IR lane (PV175).
 */
export function laneKeyForHap(
  ev: IREvent,
  anchors: ReadonlyArray<readonly [string, number]>,
): string {
  // The containment scan itself lives in `laneIdentity` — one definition, shared
  // with the scene builder's declared-row reconciliation (#1101), so the two
  // cannot answer "which statement owns this offset" differently.
  return containingAnchor(anchors, ev.loc?.[0]?.start) ?? evalTrackIdToLaneKey(ev.trackId)
}

/**
 * Derive note marks from EVALUATED haps (#861), attributed to a lane by SOURCE
 * CONTAINMENT when possible, else to an EVAL-BACKED lane (#864 / P1b).
 *
 * Containment: the IR lane whose `$:`/`name:` statement offset (`dollarPos`, in
 * `labelOffsetByLane`) is the LARGEST one ≤ the hap's `loc[0].start`. NOT
 * `laneKeyOf(hap)` string equality — the IR lane key for an anon `$:` is `d{N}`
 * while the eval hap trackId is `$N`, so equality would SPLIT them (PV175).
 * Containment aligns them via the source offsets both sides already carry.
 *
 * When a hap has no `loc` (a sampled signal), or its `loc` lands before every IR
 * lane's statement (a bare-ref whose `loc` points at the `const` definition), it
 * belongs to a track the static IR produced no lane for. It is routed to an EVAL
 * lane keyed by its own `trackId` (`evalTrackIdToLaneKey`); `buildTimelineScene`
 * renders those keys as their own rows (#864). This surfaces signal/bare-ref
 * tracks AND stops their marks polluting an unrelated IR lane (the prior
 * default-lane behaviour).
 *
 * Pitch comes from `extractPitch` — the hap's `note` is already the RESOLVED
 * name/number ("C3", or a fractional MIDI for a sampled signal).
 */
/**
 * The slice of its file an event plays, or undefined when it plays all of it (#1512).
 *
 * ⚠ THESE NUMBERS ARE ALREADY RESOLVED, WHICH IS THE WHOLE REASON THIS IS FOUR
 * LINES. `.chop(4)` arrives as four haps each carrying its own quarter,
 * `.slice(4, "0 2")` as two haps carrying theirs, and a PATTERNED
 * `.begin("<0 0.5>")` as the value for the cycle being drawn. Strudel does the
 * resolving; reading `hap.value` is all that is left. Modelling any of it in our
 * own IR would be a second opinion about a number the engine has already fixed.
 *
 * They ride in `params` rather than in a dedicated slot because none of the four
 * is in `KNOWN_VALUE_FIELDS`, so `extractParams` sweeps them up already
 * (`engine/NormalizedHap.ts`).
 *
 * Returns undefined unless at least one of the four is present, so a plain mark
 * allocates nothing and every downstream reading of it is byte-identical to
 * what it was — `undefined` and "the whole file at rate 1" must stay
 * distinguishable at the call site even though they draw the same thing.
 */
function regionOf(ev: IREvent): SampleRegion | undefined {
  const p = ev.params
  if (!p) return undefined
  const begin = finiteOrNull(p.begin)
  const end = finiteOrNull(p.end)
  const speed = finiteOrNull(p.speed)
  const unit = typeof p.unit === 'string' ? p.unit : null
  if (begin == null && end == null && speed == null && unit == null) return undefined
  // superdough's own defaults (`sampler.mjs:67`, `:36`) — a hap that sets only
  // `speed` still begins at 0 and ends at 1.
  return { begin: begin ?? 0, end: end ?? 1, speed: speed ?? 1, unit }
}

function finiteOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function collectHapMarks(
  events: readonly IREvent[],
  window: SongWindow,
  labelOffsetByLane: ReadonlyMap<string, number>,
): Map<string, SceneNote[]> {
  const out = new Map<string, SceneNote[]>()
  // (laneKey, dollarPos) pairs ascending by dollarPos — the containment index.
  const anchors = [...labelOffsetByLane].sort((a, b) => a[1] - b[1])
  // #1209 — the band the window shows, not a width measured from zero. The
  // caller may hand us a whole-song prefix (the fallback accessor returns
  // `[0, end)`), so this is what narrows it to what is on screen.
  const firstCycle = window.originCycle
  const endCycle = window.originCycle + window.spanCycles
  for (const ev of events) {
    const cycle = ev.begin
    if (!Number.isFinite(cycle) || cycle < firstCycle || cycle >= endCycle) continue
    // The ONE join (`laneKeyForHap`): containment first (keeps a hap on its
    // named/positional IR lane), else an eval-backed lane keyed by the hap's own
    // producer id (#864 / P1b). Shared with the song-analysis remap (#980).
    const key = laneKeyForHap(ev, anchors)
    let arr = out.get(key)
    if (!arr) {
      arr = []
      out.set(key, arr)
    }
    const end = Number.isFinite(ev.end) && ev.end > cycle ? ev.end : cycle
    const region = regionOf(ev)
    arr.push({
      cycle,
      end,
      pitch: extractPitch(ev)?.midi ?? null,
      gain: clamp01(ev.gain ?? 1),
      voice: ev.s ?? null,
      ...(region ? { region } : {}),
    })
  }
  return out
}
