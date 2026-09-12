/**
 * MusicalTimeline — the bottom drawer's "Timeline" tab (Phase 20-01 PR-B).
 *
 * As of #497/U5 the timeline has ONE renderer: the full-song canvas
 * (FullSongTimeline) with a per-note live overlay (#500) painted over it.
 * The old Live/Song `viewMode` fork — a DOM-rendered live 2-cycle window
 * vs the canvas song map — was retired here; this component is now a thin
 * host that owns the data + analysis + the clip write-back handlers and
 * delegates all rendering to FullSongTimeline.
 *
 * Audience: MUSICIAN (PV35 lock). Vocabulary discipline (PV32 / D-06)
 * applies to every visible string.
 *
 * Data flow:
 *   subscribeIRSnapshot ──▶ snapshot ──▶ analyzeSong (budgeted, abortable)
 *                                         ──▶ analysis ──▶ FullSongTimeline
 *
 * Lifecycle gates (DB-02 + Trap NEW-1):
 *   - Snapshot subscription is ALWAYS on (cheap fan-out; PK9).
 *   - #394: on mount with no snapshot yet, request one so a cold eval's
 *     ~2.5s publish lag doesn't leave the view empty.
 *
 * Clip ops (Phase 5, #386/#437): the canvas hands up a lane's source
 * offset + arm index; trim/delete/move/duplicate/split parse the
 * combinator at that offset and route a surgical edit through the editor
 * write-back. Lane bind (#422) reveals the lane's offset (revealOffsetInFile,
 * PV36 / D-02) to rebind the Pattern panel — no second note editor.
 */
'use client'

import * as React from 'react'
import { useEffect, useMemo, useState } from 'react'
import {
  signalDimensionsOf,
  type IRSnapshot,
  type HapStream,
  type IREvent,
  type PatternIR,
  getIRSnapshot,
  subscribeIRSnapshot,
  revealOffsetInFile,
  applyOffsetEditsToFile,
  type OffsetEdit,
  type WriteSource,
  type WriteOutcome,
  detectAllChunks,
  getActiveEditor,
  getActiveFileId,
  onActiveEditorChange,
  renameEdit,
  otherTrackNames,
  getTrackMeta,
  setTrackMeta,
  useTrackMetaMap,
  detectArrangeAt,
  detectBarePattern,
  detectChunk,
  readRegionControl,
  regionTrimEdit,
  setWeight,
  silenceArm,
  removeArm,
  reorderArm,
  insertArm,
  insertSilenceArm,
  renameArrangeSection,
  countArrangeSectionArms,
  setArmPattern,
  listArrangeSectionParts,
  splitArm,
  materializeBareDelete,
  materializeBareSplit,
  detectPickControlAt,
  pickSetWeight,
  pickSilenceArm,
  pickRemoveArm,
  pickInsertSilenceArm,
  pickRenameSection,
  pickCountSectionArms,
  pickSetArmHead,
  pickListSectionParts,
  pickReorderArm,
  pickDuplicateArm,
  pickSplitArm,
  analyzeSong,
  analyzeWindow,
  useSilencedTrackNames,
  type SongAnalysis,
  type WindowAnalysis,
} from '@stave/editor'
import { FullSongTimeline } from './FullSongTimeline'
import { createSongCollector } from './musicalTimeline/songCollector'
import { createWaveformSource } from '../audio/waveformSource'
import { subscribeWaveformsReady } from '../audio/waveformWarm'
import {
  reportRegionRefusal,
  reportWriteRefusal,
  type RegionRefusal,
} from '../lib/writeRefusal'
import { regionAnchorAgrees, type RegionSide } from './musicalTimeline/regionEdge'

export interface MusicalTimelineProps {
  /** Current cycle (post-collect coords) from the active runtime, or
   *  null when stopped / non-Strudel runtime. Read on each rAF tick
   *  through a closure so the active runtime can change without
   *  re-registering the tab content. */
  readonly getCycle: () => number | null
  /** Current cycles-per-second from the active runtime, or null. Reserved:
   *  the BPM segment of the status line that read it was removed (#653). */
  readonly getCps: () => number | null
  /**
   * Phase 20-06 (PV38, PK13 step 7+8) — closure-bound accessor onto the
   * active runtime's HapStream. Returns null when the engine isn't
   * running or the runtime is non-Strudel. The timeline subscribes to
   * this stream to drive activeKeys (D-01: real-hap REPLACES cycle-derived).
   */
  readonly getHapStream: () => HapStream | null
  /**
   * #861 — evaluated per-track note events over `[0, ceil(cycles))`, forwarded
   * to FullSongTimeline to drive its eval-backed DISPLAY marks (pitch/scale are
   * resolved by Strudel at query time; the static IR is source-lossy for them —
   * PV174). Optional: registrations that predate this pass nothing → the song
   * view falls back to IR-collected marks (pre-eval behaviour).
   */
  readonly getTimelineEvents?: (cycles: number) => IREvent[]
  /**
   * #1197 — the same events over a BAND `[startCycle, endCycle)`. The analysis
   * collector below walks adjacent bands as the progressive horizon grows;
   * without this it had to ask for `[0, endCycle)` each time and discard the
   * prefix. Optional like its sibling — a caller that does not thread it falls
   * back to the prefix accessor, which is correct but does the old amount of work.
   */
  readonly getTimelineEventsBand?: (startCycle: number, endCycle: number) => IREvent[]
  /**
   * #1107 — the capture keys of every track the engine registered, the same ids
   * `getTimelineEvents` stamps as `trackId`. Lets the analysis refuse a period
   * accepted before a declared track has been heard at all. Optional: without it
   * the analysis makes no claim about tracks it has not seen (the #1104 rule).
   */
  readonly getSongTrackIds?: () => string[]
  /** Drawer open state — forwarded to FullSongTimeline to gate its playhead
   *  rAF loop (Trap NEW-1). */
  readonly getDrawerOpen: () => boolean
  /** Active tab id — forwarded to FullSongTimeline; its playhead loop runs
   *  only while this equals the timeline tab. Same gating as `getDrawerOpen`. */
  readonly getActiveTabId: () => string | null
  /**
   * #384/#385 — transport-offset-aware song position (cycles), or null when
   * stopped / non-Strudel. The full-song view's scrubbable playhead reads
   * this instead of the raw window clock. Optional: registrations that
   * predate scrub pass nothing → song view's playhead simply stays hidden.
   */
  readonly getSongPosition?: () => number | null
  /**
   * #384 — seek the transport to an absolute song cycle (full-song ruler
   * click → seekTo). Optional for the same back-compat reason; when absent
   * the full-song view renders read-only (clicks are ignored).
   */
  readonly onSeek?: (cycle: number) => void
  /**
   * #394 — request an immediate IR snapshot capture for the active file. The
   * song view analyzes the published snapshot, but a cold eval publishes it
   * ~2.5s late; the view calls this on entering song mode with no snapshot so
   * it populates at once instead of sitting empty. Optional / no-op when the
   * registration predates the fix or the runtime is non-Strudel.
   */
  readonly onRequestSnapshot?: () => void
}

/**
 * Phase 20-17 D-1c — see also `__test_collectTrackBodies` at the bottom
 * of this file (test-only re-export, mirrors the `__test_wrapAsOpaque`
 * convention in parseStrudel.ts).
 */
function collectTrackBodies(node: PatternIR): Map<string, PatternIR> {
  const out = new Map<string, PatternIR>()
  const visit = (n: PatternIR): void => {
    if (n.tag === 'Track') {
      if (!out.has(n.trackId)) out.set(n.trackId, n.body)
      visit(n.body)
      return
    }
    // Single-body wrappers + multi-child carriers — descend per the projection
    // shape used by the inspector (irChildren). Defensive: rather than
    // duplicating that switch, use property checks.
    const anyN = n as unknown as Record<string, unknown>
    if (anyN.body && typeof anyN.body === 'object' && (anyN.body as PatternIR).tag) {
      visit(anyN.body as PatternIR)
    }
    if (Array.isArray(anyN.tracks)) {
      for (const c of anyN.tracks as PatternIR[]) visit(c)
    }
    if (Array.isArray(anyN.children)) {
      for (const c of anyN.children as PatternIR[]) visit(c)
    }
    if (anyN.then && typeof anyN.then === 'object' && (anyN.then as PatternIR).tag) {
      visit(anyN.then as PatternIR)
    }
    if (anyN.else_ && typeof anyN.else_ === 'object' && (anyN.else_ as PatternIR).tag) {
      visit(anyN.else_ as PatternIR)
    }
    if (anyN.transform && typeof anyN.transform === 'object' && (anyN.transform as PatternIR).tag) {
      visit(anyN.transform as PatternIR)
    }
    if (anyN.selector && typeof anyN.selector === 'object' && (anyN.selector as PatternIR).tag) {
      visit(anyN.selector as PatternIR)
    }
    if (Array.isArray(anyN.lookup)) {
      for (const c of anyN.lookup as PatternIR[]) visit(c)
    }
    // Phase 20-17 D-1c HIGH-SEVERITY — Code.via union discriminant.
    // PRE-20-17: this branch assumed `via` was always the wrapAsOpaque
    // shape `{method, args, callSiteRange, inner}`. POST-20-17 (D-02
    // CORRECTION) the union has a literal arm `{literal:true;raw}` which
    // is truthy AND typeof === 'object'. WITHOUT the `'literal' in via`
    // guard the literal arm enters this branch, reads `via.inner` =
    // undefined, `if (inner)` is false, and the literal subtree is
    // silently dropped from the timeline projection (P67 silent-wrong —
    // no throw, no log, wrong-but-plausible render). The literal node
    // itself is still visited as a leaf by the surrounding walk; only
    // the spurious `via.inner` recursion is suppressed.
    if (anyN.via && typeof anyN.via === 'object' && !('literal' in anyN.via)) {
      const inner = (anyN.via as { inner?: PatternIR }).inner
      if (inner) visit(inner)
    }
  }
  visit(node)
  return out
}





/**
 * Phase 20-17 D-1c — test-only re-export of `collectTrackBodies` for the
 * HIGH-severity Code.via literal-arm projection guard test. Mirrors
 * parseStrudel.ts's `__test_wrapAsOpaque` convention; not part of the
 * public component API.
 */
export const __test_collectTrackBodies = collectTrackBodies

export function MusicalTimeline(
  props: MusicalTimelineProps,
): React.ReactElement {
  // ── Snapshot subscription (Trap NEW-4: re-sync after subscribe) ─────────
  const [snapshot, setSnapshot] = useState<IRSnapshot | null>(getIRSnapshot)
  useEffect(() => {
    const unsub = subscribeIRSnapshot(setSnapshot)
    // Re-sync in case publishIRSnapshot raced our mount — an intentional
    // external-store sync, not a render-driven cascade.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSnapshot(getIRSnapshot())
    return unsub
  }, [])

  // ── Whole-song analysis (#385) ───────────────────────────────────────────
  // The timeline has ONE renderer now (#497/U5): the full-song canvas + the
  // live overlay (#500). The Live/Song `viewMode` fork and its DOM Live
  // renderer were retired in U5.
  const [analysis, setAnalysis] = useState<SongAnalysis | null>(null)
  /**
   * The paged window (#1201 item 3), or null while the view is showing the
   * song's own first span.
   *
   * ── WHY THIS IS NOT FOLDED INTO `analysis` ──────────────────────────────
   * A window is deliberately NOT a `SongAnalysis` — it has no period and no
   * displaySpan, because paging exists only on the branch where period
   * detection FAILED and a window must never re-judge one. The view keeps
   * reading `analysis` for the things that are properties of the SONG (its
   * span, whether that span loops, the readout) and reads this only for the
   * activity it draws. Two values, because they answer two questions.
   */
  const [windowAnalysis, setWindowAnalysis] = useState<WindowAnalysis | null>(null)
  /** The origin the view is currently showing. 0 until something pages. */
  const [windowOrigin, setWindowOrigin] = useState(0)
  const analysisRef = React.useRef<SongAnalysis | null>(null)
  analysisRef.current = analysis

  // #980 — latest-value ref for the runtime's queryArc event accessor. The
  // analyze effect sources onsets from EVAL haps (getTimelineEvents → queryArc)
  // instead of the `collect` interpreter, so analysis + the eval-backed marks
  // (#978) share one oracle. Held in a ref because props.getTimelineEvents is a
  // fresh closure every render (StaveApp binds it inline) — reading it through a
  // ref keeps the analyze effect keyed on `snapshot` alone, not re-running each
  // render. The snapshot is republished AFTER eval-on-load populates
  // songPatterns, so the accessor returns real haps by the time we query.
  const getTimelineEventsRef = React.useRef(props.getTimelineEvents)
  getTimelineEventsRef.current = props.getTimelineEvents
  // #1197 — the banded accessor, held in a ref for the same reason as its
  // sibling above (the prop is a fresh closure every render).
  const getTimelineEventsBandRef = React.useRef(props.getTimelineEventsBand)
  getTimelineEventsBandRef.current = props.getTimelineEventsBand
  // #1107 — same latest-value ref shape, for the same reason (fresh closure per
  // render; the analyze effect stays keyed on `snapshot` alone).
  const getSongTrackIdsRef = React.useRef(props.getSongTrackIds)
  getSongTrackIdsRef.current = props.getSongTrackIds

  // Analyze the whole song from the IR snapshot on every new snapshot
  // (re-eval). The previous run is aborted via a per-run signal so a fast edit
  // cadence can't pile up overlapping budgeted collections.
  useEffect(() => {
    const ir = snapshot?.ir ?? null
    // #1201 — a new snapshot is a new document: the page the user was on no
    // longer describes it, and a stale window would draw the old song's
    // activity at the new song's origin. Reset BEFORE the early return so an
    // edit that empties the IR clears the page too.
    setWindowAnalysis(null)
    setWindowOrigin(0)
    if (!ir) {
      // Reset derived analysis when the snapshot has no IR (intentional).
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setAnalysis(null)
      return
    }
    // #980 — queryArc-backed collector: eval haps for the whole song, sliced to
    // each requested [startCycle, endCycle) band. `analyzeSong` reads only
    // {trackId, s, begin, note}, all present on hap events. When no runtime
    // accessor is threaded (tests / non-Strudel), fall through to analyzeSong's
    // default `collectCycles(ir)` — the collect path stays as the safety net.
    //
    // Eval haps carry the engine's POSITIONAL trackId (`$N`); analyzeSong groups
    // lanes by laneKeyOf(=trackId ?? s), while the timeline scene keys rows by the
    // IR/structural lane (`d{N}` / name). Remap each hap to its containment lane
    // via the SAME join the marks use (buildLaneAnchors + laneKeyForHap) so
    // analysis lanes and mark lanes share keys — else the scene renders BOTH and
    // duplicates every row (PV175). Anchors are built once per analysis run
    // (cheap; dollarPos is a source offset, so the cycle count is irrelevant).
    // #1201 — the collector is built by a shared factory rather than inline,
    // because paging adds a SECOND caller (`analyzeWindow`) that needs onsets
    // in the same key space under the same band rule. Its header carries why a
    // copy would drift.
    const { collectFn, hasUnheardTrack } = createSongCollector(ir, {
      getTimelineEvents: getTimelineEventsRef.current,
      getTimelineEventsBand: getTimelineEventsBandRef.current,
      getSongTrackIds: getSongTrackIdsRef.current,
    })
    const signal = { aborted: false }
    // #1465 — what the SOURCE says is continuously modulated. Read here because
    // only the caller holds the IR; the rule that uses it is `displayPeriodRule`.
    analyzeSong(ir, { signal, collectFn, hasUnheardTrack, signals: signalDimensionsOf(ir) })
      .then((result) => {
        if (!signal.aborted) setAnalysis(result)
      })
      .catch(() => {
        /* analysis is best-effort; leave the prior result in place */
      })
    return () => {
      signal.aborted = true
    }
  }, [snapshot])

  /**
   * Page to a window (#1201 item 3) — the request `FullSongTimeline` makes when
   * the playhead nears the end of what it is showing.
   *
   * ── WHY A PREFETCH AND NOT A RECOMPUTE AT THE BOUNDARY ────────────────────
   * #1201 predicted the recompute would be the hard part — a stall, or a
   * refresh landing after the boundary had passed. Measured over the 56 corpus
   * documents that can page, it is not: window cost is FLAT with depth (0.98x
   * from cycle 0 to 4096, bought by the band accessor) at a 383ms median,
   * against a window that lasts 128-512 seconds of playback. That is 100-1000x
   * headroom, so asking early and letting it land is ample and no budget
   * negotiation is needed. The same measurement says a SMALLER window would buy
   * nothing — the worst single slice is flat with span — so the span stays a UX
   * choice.
   *
   * Requests are idempotent by origin: the trigger fires on a frame condition
   * that stays true for many frames, so re-requesting the origin already shown
   * or already in flight must be a no-op rather than a cancel-and-restart.
   */
  const pagingRef = React.useRef<{ inFlight: number | null; signal: { aborted: boolean } | null }>({
    inFlight: null,
    signal: null,
  })
  const snapshotRef = React.useRef(snapshot)
  snapshotRef.current = snapshot
  const windowOriginRef = React.useRef(windowOrigin)
  windowOriginRef.current = windowOrigin

  const handleRequestWindow = React.useCallback((originCycle: number, spanCycles: number) => {
    const origin = Math.max(0, Math.floor(originCycle))
    const span = Math.max(1, Math.floor(spanCycles))
    // Already showing it, or already fetching it.
    if (origin === windowOriginRef.current && origin !== 0) return
    if (pagingRef.current.inFlight === origin) return
    const ir = snapshotRef.current?.ir ?? null
    if (!ir) return

    // Supersede any older in-flight page — the user has moved on from it.
    if (pagingRef.current.signal) pagingRef.current.signal.aborted = true
    const signal = { aborted: false }
    pagingRef.current = { inFlight: origin, signal }

    // The SAME collector definition the whole-song pass reads through, so a
    // window cannot disagree with the song about what an onset is or which
    // lane it belongs to. `hasUnheardTrack` is deliberately not passed: a
    // window neither detects nor may contribute a period.
    const { collectFn } = createSongCollector(ir, {
      getTimelineEvents: getTimelineEventsRef.current,
      getTimelineEventsBand: getTimelineEventsBandRef.current,
      getSongTrackIds: getSongTrackIdsRef.current,
    })
    // Pin lane membership to the lanes the SONG knows about, so a track silent
    // through this window stays a (silenced) row instead of ceasing to exist —
    // and a track first entering inside this window still appears, because
    // membership is the UNION of the pin and what the window heard.
    const pinnedLaneKeys = analysisRef.current?.lanes.map((l) => l.laneKey)

    analyzeWindow(origin, span, { signal, collectFn, pinnedLaneKeys })
      .then((result) => {
        if (signal.aborted) return
        pagingRef.current.inFlight = null
        // ⚠ `complete: false` now means ABORTED, never "ran out of budget" —
        // analyzeWindow has no budget ceiling, only a cooperative signal. A
        // partial window must not be presented as a whole one, so keep the
        // page the user is already looking at and let the trigger ask again.
        if (!result.complete) return
        setWindowAnalysis(result)
        setWindowOrigin(origin)
      })
      .catch(() => {
        pagingRef.current.inFlight = null
        /* paging is best-effort; the current window stays on screen */
      })
  }, [])

  // #980 — test-only observation of the eval-backed analysis (consumer 4).
  // Gated on the same debug flag as the marks probe (FullSongTimeline), so
  // production pays nothing. Lets a browser e2e adjudicate the verdict move at
  // true fidelity: a signal-only track — which `collect` CANNOT onset — gains an
  // analysis lane once analyzeSong reads eval haps instead of collect.
  useEffect(() => {
    if (typeof window === 'undefined') return
    let on = false
    try {
      on = !!window.localStorage.getItem('stave:debug.timelineMarks')
    } catch {
      on = false
    }
    if (!on) return
    ;(
      window as unknown as { __staveTimelineAnalysis?: unknown }
    ).__staveTimelineAnalysis = {
      periodCycles: analysis?.periodCycles ?? null,
      horizonCycles: analysis?.horizonCycles ?? 0,
      lanes: (analysis?.lanes ?? []).map((l) => ({
        laneKey: l.laneKey,
        onsets: l.onsetsByCycle.reduce((a, b) => a + b, 0),
      })),
    }
  }, [analysis])

  // #394 — on mount the timeline may render before its IR snapshot has been
  // published (a cold eval lags ~2.5s behind the keypress); proactively ask the
  // editor to capture one now. The publish flows back through
  // subscribeIRSnapshot → setSnapshot → the analyze effect above, so the view
  // populates at once instead of sitting empty. Gated on `!snapshot`, so once a
  // snapshot exists this is a no-op — no request loop even if the callback
  // identity changes per render.
  const { onRequestSnapshot } = props
  useEffect(() => {
    if (!snapshot) {
      onRequestSnapshot?.()
    }
  }, [snapshot, onRequestSnapshot])

  // ── Per-track custom colour (Phase D, #581) ──────────────────────────────
  // Overrides live in the per-file TrackMeta Yjs store, keyed by the track's
  // DISPLAY NAME — the same key the Mixer uses, so a colour set in either view
  // shows in both. `useTrackMetaMap` returns a ref-stable map (changes only when
  // an override is set/cleared), so threading it into the scene recolours lanes
  // (dot + canvas density) exactly when the user picks, not every render.
  const fileId = snapshot?.source ?? undefined
  const trackMeta = useTrackMetaMap(fileId)
  const customColorByName = React.useMemo(() => {
    const m = new Map<string, string>()
    for (const [name, meta] of trackMeta) {
      if (meta.color) m.set(name, meta.color)
    }
    return m
  }, [trackMeta])

  // #731 — the display names of tracks that read as silenced (muted, or dimmed by
  // a solo elsewhere), from the Mixer's own solo/mute state. The Timeline fades the
  // matching lanes so a solo/mute shows identically in both views (PV155). Read-
  // only: observing solo here never keeps the audio overlay alive (soloStore).
  const silencedNames = useSilencedTrackNames()

  // ── Caret-driven lane selection (#641) ───────────────────────────────────
  // The editor caret is the single source of truth for "which track is current"
  // — the same selection bus the Mixer derives its strip from (V-mixer-18). The
  // Song Timeline highlights the lane whose statement contains the caret: map the
  // caret offset → the head offset of the chunk it sits in, which equals that
  // lane's `labelOffset`. Guarded to THIS timeline's file so a caret in another
  // editor doesn't select a lane here. Re-derives on cursor move and on
  // active-editor switch — so clicking a lane (#610 moves the caret) and
  // typing/clicking in the editor both converge on the same highlighted lane.
  // ── The waveform tier's two halves (#1506) ────────────────────────────────
  // The SOURCE is stable for the life of the component: it reads tempo through
  // the prop accessor on every draw rather than closing over a value, so a tempo
  // change cannot leave it rebuilding or drawing at a stale width.
  const waveforms = useMemo(
    () => createWaveformSource(() => props.getCps()),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- read through the
    // accessor above; rebuilding on every render would defeat the canvas's own
    // dirty-flagging and repaint the timeline continuously.
    [],
  )
  // The EPOCH is the redraw signal. The canvas repaints on scene/transform/size
  // and a decode finishing is none of those, so without this a warmed take would
  // be drawable in memory and absent on screen until something else forced a
  // repaint.
  const [waveformsEpoch, setWaveformsEpoch] = useState(0)
  useEffect(() => subscribeWaveformsReady(() => setWaveformsEpoch((n) => n + 1)), [])

  const [selectedStatementOffset, setSelectedStatementOffset] = useState<number | null>(null)
  useEffect(() => {
    const recompute = (): void => {
      try {
        const ed = getActiveEditor()
        if (!ed || !fileId || getActiveFileId() !== fileId) {
          setSelectedStatementOffset(null)
          return
        }
        const model = ed.getModel?.()
        const pos = ed.getPosition?.()
        if (!model || !pos) {
          setSelectedStatementOffset(null)
          return
        }
        const off = model.getOffsetAt(pos)
        const chunk = detectAllChunks(model.getValue()).find(
          (c) => off >= c.statementRange[0] && off <= c.statementRange[1],
        )
        const next = chunk ? chunk.statementRange[0] : null
        setSelectedStatementOffset((prev) => (prev === next ? prev : next))
      } catch {
        /* selection is a courtesy — never let it throw into render */
      }
    }
    // Bind to the active editor's cursor; rebind on active-editor change (split /
    // tab switch) so the timeline always follows the editor in view.
    let cursorSub: { dispose(): void } | null = null
    const bind = (): void => {
      cursorSub?.dispose()
      cursorSub = getActiveEditor()?.onDidChangeCursorPosition?.(recompute) ?? null
      recompute()
    }
    bind()
    const unsubActive = onActiveEditorChange(bind)
    return () => {
      cursorSub?.dispose()
      unsubActive()
    }
  }, [fileId])

  const handleSetTrackColor = React.useCallback(
    (displayName: string, color: string) => {
      if (!fileId) return
      setTrackMeta(fileId, displayName, { color })
    },
    [fileId],
  )
  const handleResetTrackColor = React.useCallback(
    (displayName: string) => {
      if (!fileId) return
      // Clearing both fields deletes the record (store cleanup) → the lane falls
      // back to the deterministic palette colour.
      setTrackMeta(fileId, displayName, { color: undefined })
    },
    [fileId],
  )

  // Expand-to-bind for the Song view (#422, design §3.1): the canvas timeline
  // hands up a lane's representative source offset; the SAME cursor-move seam as
  // handleNoteClick reveals it, which re-detects the active chunk and rebinds the
  // Pattern panel (Sequencer/Piano Roll) to that track. No second note editor.
  const handleBindLane = React.useCallback(
    (sourceOffset: number | null) => {
      if (!snapshot?.source || sourceOffset == null) return
      // Position the cursor at the lane's exact source OFFSET (line + column),
      // not column 1: a track that is one arm of a combinator on a shared line
      // (`arrange([w, pat], …)`) only binds when the cursor lands INSIDE the arm
      // leaf — column 1 resolves to the whole combinator → standby (#472). The
      // offset is the leaf's innermost atom (loc[0].start), which is inside the
      // mini for every layout, so this also keeps the top-level single-track case.
      revealOffsetInFile(snapshot.source, sourceOffset)
    },
    [snapshot],
  )

  // #610 — select a track on the timeline → jump the editor to its code. The
  // twin of the Mixer's strip cursor-follow (#595/#596): the timeline hands up
  // the lane's STATEMENT offset (the `$:`/`name:` head, == the Mixer's
  // `statementRange[0]`) and the SAME `revealOffsetInFile` seam reveals it.
  // Unlike handleBindLane this does not expand the lane or rebind the Pattern
  // panel — it is a pure "go to this track in the editor".
  const handleSelectLane = React.useCallback(
    (statementOffset: number) => {
      if (!snapshot?.source) return
      // Move the caret (the selection bus) so the editor + Mixer follow, AND
      // mirror the selection here eagerly so the lane highlights the instant the
      // header is clicked — never waiting on (or risking a missed)
      // cursor-change event. Gated on the reveal succeeding so the timeline can't
      // diverge from a caret that didn't actually move (e.g. editor unmounted);
      // on success the caret lands at the SAME offset, so all three views agree.
      const moved = revealOffsetInFile(snapshot.source, statementOffset)
      if (moved) setSelectedStatementOffset(statementOffset)
    },
    [snapshot],
  )

  // ── The Song Timeline's ONE write seam (#1414) ──────────────────────────
  //
  // ⚠ WHY THIS EXISTS, AND WHY IT IS A FUNCTION AND NOT A CONVENTION.
  // `applyOffsetEditsToFile` has always refused correctly and has always said so
  // — it names five distinct refusals. Every one of its fourteen call sites threw
  // the answer away, and twelve of them bailed out one line earlier on an empty
  // edit list without telling anyone either. The result: a clip drag that was
  // REFUSED and one that was APPLIED looked identical, to the user and to us.
  //
  // The fix is not a rule asking handlers to check; a rule addressed to callers is
  // a wish, and this boundary has already proved it by being ignored fourteen
  // times. It is this seam being the ONLY thing that calls the writer, with the
  // empty-edits case folded IN — so "forget to check" stops being a thing a
  // handler can do, because there is no longer a separate check to forget.
  //
  // Reporting is `warn`, deliberately: warnings reach the Console panel but do NOT
  // raise a toast (StaveApp's bridge toasts errors only). A declined drag should
  // be findable, not shouty — and the clip already snaps back on its own, because
  // the canvas re-derives clip extents from the IR and drops the drag ghost before
  // this is ever called. The snap-back was never the missing part; knowing WHICH
  // refusal fired is.
  const writeArrange = React.useCallback(
    (edits: OffsetEdit[], source: WriteSource, gesture: string): WriteOutcome => {
      const fileId = snapshot?.source
      const outcome: WriteOutcome = !fileId
        ? 'no-editor'
        : applyOffsetEditsToFile(fileId, edits, source, snapshot.code)
      // ⚠ `'applied'` compared explicitly. Every member of WriteOutcome is a
      // non-empty string and therefore truthy, so `if (outcome)` is always true.
      // The count this builds up in the Console IS the instrument #1414 asked
      // for; before it, any claim about how often these fire was unfalsifiable.
      if (outcome !== 'applied') reportWriteRefusal(fileId, `Timeline: ${gesture}`, outcome)
      return outcome
    },
    [snapshot],
  )

  // Edit an automation's bounds from its lane caption (#1464 Stage 2).
  //
  // The edit arrives already BUILT — `captionEdit` composed it from the
  // automation's own numbers and refused anything it could not do honestly, so
  // there is nothing left to decide here. All this owes is the write seam: the
  // offsets came from the IR the timeline is currently drawing, and `writeArrange`
  // guards them against a stale document and NAMES the refusal when one fires,
  // which is the whole reason every timeline write goes through it (#1414).
  const handleEditAutomation = React.useCallback(
    (edit: OffsetEdit, gesture: string): void => {
      writeArrange([edit], 'automation', gesture)
    },
    [writeArrange],
  )

  // Trim a clip on the Song canvas (Phase 5b, #437): the timeline hands up the
  // dragged clip's source anchor (a lane offset inside the combinator call), its
  // arm index, and the new whole-cycle weight. We parse the arrangement at that
  // anchor against the SAME snapshot text the offsets came from, build a surgical
  // set-weight edit (cat→arrange promotion handled by the serializer), and route
  // it through the editor registry's write-back — guarded against a stale model
  // (`snapshot.code`). The runtime's debounced re-eval then republishes the IR
  // and the timeline re-derives the clip's new extent (PV122 #2/#3).
  const handleTrimClip = React.useCallback(
    (req: { sourceOffset: number | null; armIndex: number; weight: number }) => {
      if (!snapshot?.source || req.sourceOffset == null) return
      const call = detectArrangeAt(snapshot.code, req.sourceOffset)
      if (call) {
        if (req.armIndex < 0 || req.armIndex >= call.arms.length) return
        const edits = setWeight(snapshot.code, call, req.armIndex, req.weight)
        writeArrange(edits, 'arrange.weights', 'trim clip')
        return
      }
      // #463 Stage 2 — a pick* track's clips are the `<…@w …>` control arms.
      const ctl = detectPickControlAt(snapshot.code, req.sourceOffset)
      if (!ctl || req.armIndex < 0 || req.armIndex >= ctl.arms.length) return
      const edits = pickSetWeight(snapshot.code, ctl, req.armIndex, req.weight)
      writeArrange(edits, 'arrange.weights', 'trim clip')
    },
    [snapshot],
  )

  // Trim the SLICE a sample mark plays, from the Song canvas (#1527).
  //
  // The timeline hands up the lane's anchors, the side of the mark that was
  // dragged, the new 0..1 value, and — the part that makes this safe — what the
  // ENGINE resolved this mark to be playing.
  //
  // ⚠ THE ANCHOR IS TRIED, NOT TRUSTED. Measured over every spelling a take can
  // be written in, no single lane anchor lands on the expression that owns the
  // region in all of them: the statement anchor is right for
  // `const vox = s("take")` / `$: vox.begin(0.1)`, where the content anchor lands
  // on the const; the content anchor is the only one that exists for an
  // unlabelled bare expression. So both are tried in order and each candidate has
  // to AGREE with what the mark plays before it is written through. Without that,
  // the const case appends a second `.begin` to a shared binding which the outer
  // call then overrides — the document changes, other tracks using that binding
  // change, and the sound does not move.
  //
  // Both ends are checked, not just the dragged one: the clamp inside
  // `regionTrimEdit` reads the partner, so agreeing about `begin` while
  // disagreeing about `end` would clamp against a number this mark never played.
  const handleTrimRegion = React.useCallback(
    (req: {
      anchors: readonly number[]
      side: RegionSide
      value: number
      playing: { begin: number; end: number }
    }) => {
      const fileId = snapshot?.source
      if (!fileId) return
      const gesture = `Timeline: trim ${req.side}`
      if (req.anchors.length === 0) {
        reportRegionRefusal(fileId, gesture, 'no-anchor')
        return
      }
      // ⚠ "PATTERNED" IS A DEFINITE ANSWER, NOT A REASON TO TRY THE NEXT ANCHOR,
      // and telling them apart is the difference between a message that helps
      // and one that misleads. A `.begin("<0 .5>")` makes every anchor disagree
      // — there is no single number for the mark's resolved value to match — so
      // without this the user is told the code "does not set the slice", when in
      // fact it sets it in a way a drag must not overwrite. Recorded and carried
      // past the loop, because a LATER anchor might still be writable.
      let known: RegionRefusal | null = null
      for (const anchor of req.anchors) {
        const chunk = detectChunk(snapshot.code, anchor)
        if (!chunk) continue
        const doc = { begin: readRegionControl(chunk, 'begin'), end: readRegionControl(chunk, 'end') }
        if (doc.begin === null || doc.end === null) {
          known ??= 'not-a-number'
          continue
        }
        const agrees = (['begin', 'end'] as const).every((s) =>
          regionAnchorAgrees(req.playing[s], s, doc[s]),
        )
        if (!agrees) continue
        const result = regionTrimEdit(chunk, req.side, req.value)
        if (!result.edit) {
          reportRegionRefusal(fileId, gesture, result.refusal ?? 'anchor-mismatch')
          return
        }
        writeArrange([result.edit], 'region.trim', `trim ${req.side}`)
        return
      }
      // Every anchor resolved to nothing, to a patterned control, or to an
      // expression that disagreed. Reported rather than dropped: the mark snaps
      // back on its own, so a silent decline is indistinguishable from a drag
      // that never took.
      reportRegionRefusal(fileId, gesture, known ?? 'anchor-mismatch')
    },
    [snapshot, writeArrange],
  )

  // Rename a track from the Song Timeline (#580, Phase C). The lane hands up its
  // STATEMENT offset (`labelOffset` = `dollarPos`); we detect the chunk anchored
  // there in the SAME snapshot text, write the `name:` label via `renameEdit`
  // (which validates + no-ops + preserves a `_` mute marker), and apply it
  // surgically. The debounced re-eval republishes the IR and BOTH views
  // re-resolve the new label (Timeline via the Step 2 dollarPos resolver, Mixer
  // via `bareLabel`) — so the rename shows everywhere.
  const handleRenameLane = React.useCallback(
    (labelOffset: number, newLabel: string, oldDisplayName: string) => {
      if (!snapshot?.source) return
      const chunk = detectAllChunks(snapshot.code).find(
        (c) => c.statementRange[0] === labelOffset,
      )
      if (!chunk) return
      // Reject a rename that would duplicate another track's display name (#585) —
      // `otherTrackNames` is every track EXCEPT the one being renamed.
      const taken = new Set(otherTrackNames(snapshot.code, labelOffset))
      const edit = renameEdit(chunk, newLabel, taken)
      if (!edit) return // invalid name / no-op / duplicate → no write
      // ⚠ GATED ON THE WRITE ACTUALLY LANDING (#1414). The colour migration below
      // is keyed by DISPLAY NAME, so it is only correct once the document really
      // says the new name. Before the outcome was read this ran unconditionally:
      // a rename refused by the stale-document guard still moved the override to
      // a name no track has and cleared it from the name that does — the track
      // silently lost its colour because of an edit that never happened. This is
      // the concrete cost of discarding the writer's answer, in one path.
      if (writeArrange([edit], 'rename', 'rename track') !== 'applied') return
      // Migrate a custom-colour override from the OLD display name to the new
      // label (#581) — else the rename orphans the colour (the override is keyed
      // by display name, which the rename changes). snapshot.source === fileId.
      const prevColor = getTrackMeta(snapshot.source, oldDisplayName).color
      if (prevColor && oldDisplayName !== newLabel) {
        setTrackMeta(snapshot.source, newLabel, { color: prevColor })
        setTrackMeta(snapshot.source, oldDisplayName, { color: undefined })
      }
    },
    [snapshot],
  )

  // Delete a clip on the Song canvas (Phase 5c, #386): the timeline hands up the
  // selected clip's lane source anchor + arm index. We parse the arrangement at
  // that anchor against the SAME snapshot text the offsets came from, build a
  // surgical GAP edit: `silenceArm` replaces the arm's pattern with `silence`,
  // KEEPING its cycle width (#491) — the DAW-standard plain Delete leaves a gap,
  // the arrangement timeline is absolute so later clips do NOT slide left (unlike
  // a ripple `removeArm`). Routed through the write-back (`arrange.structure`).
  // Deleting an already-silent clip is a no-op; silencing every arm (a muted
  // track) is allowed. The debounced re-eval republishes the IR and the lane
  // re-derives.
  //
  // ⚠ ALL THREE BRANCHES BELOW LEAVE A GAP, AND THAT AGREEMENT IS THE POINT
  // (#1462). A user did not choose a "spelling" — they wrote a song, and Delete
  // has to mean one thing. `arrange` silences the arm in place, the pick control
  // writes `~` in the arm's head, and a bare loop materializes an arrange around
  // the silenced bar; all three keep the song's length. Ripple delete — the
  // gesture that DOES shorten a song — is a separate, second gesture that does
  // ⚠ SUPERSEDED IN PART (#1460): ripple delete now EXISTS, as a second gesture
  // on Cmd/Ctrl+Shift+Delete — see `handleRippleDeleteClip` below. What is said
  // above about plain Delete is unchanged and is the reason the two are separate:
  // a gap is the right answer for the bare key, and shortening the song is a
  // different request that has to be asked for differently.)
  const handleDeleteClip = React.useCallback(
    (req: { sourceOffset: number | null; armIndex: number; barIndex?: number; span?: number }) => {
      if (!snapshot?.source || req.sourceOffset == null) return
      const call = detectArrangeAt(snapshot.code, req.sourceOffset)
      if (call) {
        if (req.armIndex < 0 || req.armIndex >= call.arms.length) return
        const edits = silenceArm(snapshot.code, call, req.armIndex)
        writeArrange(edits, 'arrange.structure', 'delete clip')
        return
      }
      // #463 Stage 2 — pick* section clip. #1462: GAP, exactly as the arrange
      // branch above. `pickSilenceArm` writes `verse@8` → `~@8`, so the section
      // goes quiet and keeps its width. It used to call `pickRemoveArm`, which
      // rippled the section out and made the song shorter — the same keypress on
      // the same canvas meaning two different things depending only on how the
      // arrangement happened to be spelled.
      const ctl = detectPickControlAt(snapshot.code, req.sourceOffset)
      if (ctl) {
        if (req.armIndex < 0 || req.armIndex >= ctl.arms.length) return
        const edits = pickSilenceArm(snapshot.code, ctl, req.armIndex)
        writeArrange(edits, 'arrange.structure', 'delete clip')
        return
      }
      // #489 — bare loop: silence the SELECTED bar (gap) by materializing an
      // arrange. detectBarePattern finds the pattern's range; materializeBareDelete
      // rewrites `pat` → `arrange([lead, pat], [1, silence], [rest, pat])` at the
      // clicked `barIndex` over the loop's `span`, keeping the bytes verbatim. The
      // deliberate counterpart of split (#488 drag-to-wrap removal): silencing the
      // SOLE bar would empty the track, which the serializer refuses (PV122 #5).
      if (req.armIndex >= 0 || req.barIndex == null || req.span == null) return
      const bare = detectBarePattern(snapshot.code, req.sourceOffset)
      if (!bare) return
      const edits = materializeBareDelete(snapshot.code, bare.patternRange, req.barIndex, req.span)
      writeArrange(edits, 'arrange.structure', 'delete clip')
    },
    [snapshot],
  )

  // RIPPLE-delete a clip (#1460): remove the arm and close the gap after it, so
  // the song gets SHORTER. The SECOND delete gesture, and the counterpart of the
  // one above rather than a replacement for it.
  //
  // ⚠ WHY TWO GESTURES AND NOT A BETTER ONE. Plain Delete leaving a gap is
  // correct and stays correct: an arrangement timeline is absolute, so clearing
  // a clip must not drag everything after it leftwards. Every DAW manual checked
  // separates the two the same way and gives ripple its own name and its own
  // chord — Ableton calls it Delete Time on Cmd+Shift+Delete, Logic calls it
  // Snip, and none of them puts it on the bare Delete key. Reaper is the real
  // alternative design and makes ripple a MODE rather than a command; that is a
  // different product decision, not this one.
  //
  // Both spellings ripple, because #1462 settled that a keypress means one thing
  // whichever way the user happened to write their song. `removeArm` and
  // `pickRemoveArm` have been written, exported and callerless since #491 was
  // built, waiting for exactly this.
  //
  // Refusals, and each is the serializer's rather than a check invented here: a
  // sole remaining arm is not removable (a lane keeps at least one clip), and a
  // bare loop has no arm at all — the gesture layer already declines that one
  // before this is called, so a bare clip cannot reach here.
  const handleRippleDeleteClip = React.useCallback(
    (req: { sourceOffset: number | null; armIndex: number }) => {
      if (!snapshot?.source || req.sourceOffset == null || req.armIndex < 0) return
      const call = detectArrangeAt(snapshot.code, req.sourceOffset)
      if (call) {
        if (req.armIndex >= call.arms.length) return
        const edits = removeArm(snapshot.code, call, req.armIndex)
        writeArrange(edits, 'arrange.structure', 'ripple delete clip')
        return
      }
      const ctl = detectPickControlAt(snapshot.code, req.sourceOffset)
      if (!ctl) return
      if (req.armIndex >= ctl.arms.length) return
      const edits = pickRemoveArm(snapshot.code, ctl, req.armIndex)
      writeArrange(edits, 'arrange.structure', 'ripple delete clip')
    },
    [snapshot],
  )

  // INSERT SILENCE after a clip (#1461): a new, EMPTY section directly after the
  // selected one, exactly as wide.
  //
  // ⚠ WHY EMPTY, WHEN DUPLICATE ALREADY HANDS YOU SOMETHING THAT PLAYS. The
  // objection was raised while measuring #1347 — a section you must then go and
  // type into is worse than a clone. It answers a different question than this
  // gesture asks. Duplicate writes CONTENT; this writes TIME. You reach for it
  // when the song needs room, not when you know what goes in the room, which is
  // exactly why the DAW command it mirrors is called Insert Silence and sits on
  // this chord. They are complements.
  //
  // The spelling of "empty" belongs to the serializers, not here: `silence` for
  // an arrange arm and `~` for a pick arm, each matching what its own delete
  // already writes for a gap. Both copy the selected arm's weight as TEXT, so a
  // section written `[M*8, …]` yields another `M*8` rather than a pinned number.
  const handleInsertSilenceClip = React.useCallback(
    (req: { sourceOffset: number | null; armIndex: number }) => {
      if (!snapshot?.source || req.sourceOffset == null || req.armIndex < 0) return
      const call = detectArrangeAt(snapshot.code, req.sourceOffset)
      if (call) {
        if (req.armIndex >= call.arms.length) return
        const edits = insertSilenceArm(snapshot.code, call, req.armIndex)
        writeArrange(edits, 'arrange.structure', 'insert silence')
        return
      }
      const ctl = detectPickControlAt(snapshot.code, req.sourceOffset)
      if (!ctl) return
      if (req.armIndex >= ctl.arms.length) return
      const edits = pickInsertSilenceArm(snapshot.code, ctl, req.armIndex)
      writeArrange(edits, 'arrange.structure', 'insert silence')
    },
    [snapshot],
  )

  // RENAME a section (#1417 Stage 3) — the gesture that makes the two rename
  // primitives reachable at all. Stage 1 shipped the pick rename with ZERO
  // callers, so a musician could not rename anything; building the second
  // primitive without a gesture would only have doubled the unreachable code.
  //
  // ⚠ THE TWO SPELLINGS RENAME OPPOSITE THINGS, and routing is the whole job
  // here. In `arrange(...)` the section name IS a top-level binding, so the
  // rename moves its declaration and every reference across the document. In the
  // pick family it is an object KEY and no binding is touched — renaming the
  // section leaves the pattern's own name exactly where the user put it. One
  // gesture, two edits, and a shared implementation with a flag would have had
  // to be wrong about one of them.
  //
  // Both primitives decline rather than half-rewrite: a built-in with no
  // declaration, an inline expression with no name, a collision, a shadowed
  // name. A decline reaches the user through the same write seam every other
  // gesture reports through, because zero edits is `no-edits` there.
  const handleRenameSection = React.useCallback(
    (req: { sourceOffset: number | null; armIndex: number; newName: string }) => {
      if (!snapshot?.source || req.sourceOffset == null || req.armIndex < 0) return
      const call = detectArrangeAt(snapshot.code, req.sourceOffset)
      if (call) {
        const edits = renameArrangeSection(snapshot.code, call, req.armIndex, req.newName)
        writeArrange(edits, 'rename', 'rename section')
        return
      }
      const ctl = detectPickControlAt(snapshot.code, req.sourceOffset)
      if (!ctl) return
      const edits = pickRenameSection(snapshot.code, ctl, req.armIndex, req.newName)
      writeArrange(edits, 'rename', 'rename section')
    },
    [snapshot],
  )

  // How many sections a rename would move, asked BEFORE the write so the editor
  // can say "renames 2 sections" while the user can still change their mind.
  // Returns 0 whenever the rename would decline, so the hint and the write can
  // never tell the user different things.
  const sectionArmCount = React.useCallback(
    (req: { sourceOffset: number | null; armIndex: number }): number => {
      if (!snapshot?.source || req.sourceOffset == null || req.armIndex < 0) return 0
      const call = detectArrangeAt(snapshot.code, req.sourceOffset)
      if (call) return countArrangeSectionArms(snapshot.code, call, req.armIndex)
      const ctl = detectPickControlAt(snapshot.code, req.sourceOffset)
      if (!ctl) return 0
      return pickCountSectionArms(snapshot.code, ctl, req.armIndex)
    },
    [snapshot],
  )

  // Point a section at a different PART (#1560). The routing is the job, and it
  // is the same shape the rename needed: in `arrange(...)` an arm IS the
  // reference, so the edit rewrites the arm's pattern expression; in the pick
  // family the arm is a NAME resolving inside the call, so it rewrites the head.
  //
  // ⚠ ONE ARM MOVES, WHICHEVER SPELLING. That is what separates this from the
  // rename, where touching a name necessarily moves every section that uses it.
  // A returning chorus keeps returning; only the section the user clicked plays
  // something else.
  //
  // Both primitives decline rather than half-write — an arm that names nothing,
  // a blank part, a key this call does not define, the part already playing —
  // and a decline reaches the user through the same seam every other gesture
  // reports through, because zero edits is `no-edits` there.
  const handleAssignSectionPart = React.useCallback(
    (req: { sourceOffset: number | null; armIndex: number; part: string }) => {
      if (!snapshot?.source || req.sourceOffset == null || req.armIndex < 0) return
      const call = detectArrangeAt(snapshot.code, req.sourceOffset)
      if (call) {
        const edits = setArmPattern(snapshot.code, call, req.armIndex, req.part)
        writeArrange(edits, 'arrange.structure', 'assign section part')
        return
      }
      const ctl = detectPickControlAt(snapshot.code, req.sourceOffset)
      if (!ctl) return
      const edits = pickSetArmHead(snapshot.code, ctl, req.armIndex, req.part)
      writeArrange(edits, 'arrange.structure', 'assign section part')
    },
    [snapshot, writeArrange],
  )

  // What this section may be pointed at, asked when the chooser OPENS so the
  // list and the write read the same document. Returns an empty list rather than
  // a guess whenever the question cannot be answered — the chooser then says
  // there is nothing to offer, which is a different thing from not opening.
  const sectionParts = React.useCallback(
    (req: { sourceOffset: number | null; armIndex: number }): string[] => {
      if (!snapshot?.source || req.sourceOffset == null || req.armIndex < 0) return []
      const call = detectArrangeAt(snapshot.code, req.sourceOffset)
      if (call) return listArrangeSectionParts(snapshot.code, call)
      const ctl = detectPickControlAt(snapshot.code, req.sourceOffset)
      if (!ctl) return []
      return pickListSectionParts(ctl)
    },
    [snapshot],
  )

  // Move a clip on the Song canvas (Phase 5c, #386): `reorder` only — the dragged
  // clip is a real arm, swapped to a new slot in the combinator (reorderArm
  // fromIndex→toIndex). Clip time-order = arm order. A bare track's implicit clip
  // is NOT movable (#488): a uniform pattern tiles every cycle identically, so a
  // drag would swap identical content — injecting a leading `silence` to "place"
  // it invents a gap the source never had. Parses against the SAME snapshot the
  // offsets came from and routes through the structural write-back; the debounced
  // re-eval re-derives the clips.
  const handleMoveClip = React.useCallback(
    (req: { kind: 'reorder'; sourceOffset: number | null; fromIndex: number; toIndex: number }) => {
      if (!snapshot?.source || req.sourceOffset == null) return
      const call = detectArrangeAt(snapshot.code, req.sourceOffset)
      if (call) {
        const edits = reorderArm(snapshot.code, call, req.fromIndex, req.toIndex)
        writeArrange(edits, 'arrange.structure', 'move clip')
        return
      }
      // #463 Stage 2 — reorder pick* control sections.
      const ctl = detectPickControlAt(snapshot.code, req.sourceOffset)
      if (!ctl) return
      const edits = pickReorderArm(snapshot.code, ctl, req.fromIndex, req.toIndex)
      writeArrange(edits, 'arrange.structure', 'move clip')
    },
    [snapshot],
  )

  // Duplicate a clip on the Song canvas (Phase 5c, #386): clone the selected
  // arm's VERBATIM source and insert it right after, via insertArm. The clone is
  // byte-identical (same weight + pattern), so the song gains a repeat of that
  // clip. Real arms only — a bare track has no arm to clone (move-wrap first).
  const handleDuplicateClip = React.useCallback(
    (req: { sourceOffset: number | null; armIndex: number }) => {
      if (!snapshot?.source || req.sourceOffset == null) return
      const call = detectArrangeAt(snapshot.code, req.sourceOffset)
      if (call) {
        if (req.armIndex < 0 || req.armIndex >= call.arms.length) return
        const arm = call.arms[req.armIndex]
        const armSource = snapshot.code.slice(arm.armRange[0], arm.armRange[1])
        const edits = insertArm(snapshot.code, call, req.armIndex + 1, armSource)
        writeArrange(edits, 'arrange.structure', 'duplicate clip')
        return
      }
      // #463 Stage 2 — clone a pick* control section.
      const ctl = detectPickControlAt(snapshot.code, req.sourceOffset)
      if (!ctl || req.armIndex < 0 || req.armIndex >= ctl.arms.length) return
      const edits = pickDuplicateArm(snapshot.code, ctl, req.armIndex)
      writeArrange(edits, 'arrange.structure', 'duplicate clip')
    },
    [snapshot],
  )

  // Split a clip on the Song canvas (Phase 5c, #386): slice the selected arm at
  // a whole-cycle boundary into two arms with the SAME pattern (splitArm). The
  // gesture passes the first half's cycle count (the clip midpoint); the
  // serializer clamps it to [1, n−1] and no-ops a clip < 2 cycles or a cat arm.
  // A BARE clip (`armIndex < 0`) has no combinator yet — splitting MATERIALIZES it
  // (#489): detectBarePattern finds the pattern's range and materializeBareSplit
  // rewrites `pat` → `arrange([firstWeight, pat], [span−firstWeight, pat])` (same
  // sound, two addressable arms). This is the explicit "introduce the combinator"
  // entry-point that replaced the removed drag-to-wrap (#488).
  const handleSplitClip = React.useCallback(
    (req: { sourceOffset: number | null; armIndex: number; firstWeight: number; span: number }) => {
      if (!snapshot?.source || req.sourceOffset == null) return
      const call = detectArrangeAt(snapshot.code, req.sourceOffset)
      if (call) {
        if (req.armIndex < 0 || req.armIndex >= call.arms.length) return
        const edits = splitArm(snapshot.code, call, req.armIndex, req.firstWeight)
        writeArrange(edits, 'arrange.structure', 'split clip')
        return
      }
      // #463 Stage 2 — split a pick* control section.
      const ctl = detectPickControlAt(snapshot.code, req.sourceOffset)
      if (ctl) {
        if (req.armIndex < 0 || req.armIndex >= ctl.arms.length) return
        const edits = pickSplitArm(snapshot.code, ctl, req.armIndex, req.firstWeight)
        writeArrange(edits, 'arrange.structure', 'split clip')
        return
      }
      // #489 — bare loop: materialize into an arrange by splitting (armIndex < 0).
      if (req.armIndex >= 0) return
      const bare = detectBarePattern(snapshot.code, req.sourceOffset)
      if (!bare) return
      const edits = materializeBareSplit(snapshot.code, bare.patternRange, req.firstWeight, req.span)
      writeArrange(edits, 'arrange.structure', 'split clip')
    },
    [snapshot],
  )

  return (
    <div
      data-bottom-panel-tab="musical-timeline"
      role="region"
      aria-label="Timeline"
      style={styles.root}
    >
        <FullSongTimeline
          analysis={analysis}
          windowActivity={windowAnalysis}
          windowOriginCycles={windowOrigin}
          onRequestWindow={handleRequestWindow}
          ir={snapshot?.ir ?? null}
          source={snapshot?.code ?? null}
          getHapStream={props.getHapStream}
          getTimelineEvents={props.getTimelineEvents}
          getTimelineEventsBand={props.getTimelineEventsBand}
          waveforms={waveforms}
          waveformsEpoch={waveformsEpoch}
          getSongPosition={props.getSongPosition ?? (() => null)}
          onSeek={props.onSeek ?? (() => {})}
          getDrawerOpen={props.getDrawerOpen}
          getActiveTabId={props.getActiveTabId}
          onEditAutomation={handleEditAutomation}
          onTrimClip={handleTrimClip}
          onTrimRegion={handleTrimRegion}
          onDeleteClip={handleDeleteClip}
          onRippleDeleteClip={handleRippleDeleteClip}
          onInsertSilenceClip={handleInsertSilenceClip}
          onRenameSection={handleRenameSection}
          sectionArmCount={sectionArmCount}
          onAssignSectionPart={handleAssignSectionPart}
          sectionParts={sectionParts}
          onMoveClip={handleMoveClip}
          onDuplicateClip={handleDuplicateClip}
          onSplitClip={handleSplitClip}
          onBindLane={handleBindLane}
          onSelectLane={handleSelectLane}
          onRenameLane={handleRenameLane}
          selectedStatementOffset={selectedStatementOffset}
          customColorByName={customColorByName}
          onSetTrackColor={handleSetTrackColor}
          onResetTrackColor={handleResetTrackColor}
          silencedNames={silencedNames}
        />
    </div>
  )
}

// ───── Styles ───────────────────────────────────────────────────────────────
// Phase 20-12 wave-δ — theme-aware. The chrome reads CSS variables from
// the global theme (globals.css), so the timeline tracks light/dark/system
// alongside the rest of the IDE. Each var carries a mockup-literal fallback
// (the original Phase 20-02 DV-08 values) so the chrome remains legible if
// loaded outside the global theme (storybook, isolated tests).

const FONT_MONO = 'var(--font-mono), ui-monospace, monospace'

const styles = {
  root: {
    display: 'flex',
    flexDirection: 'column' as const,
    height: '100%',
    width: '100%',
    overflow: 'hidden',
    fontFamily: FONT_MONO,
    fontSize: 11, // mockup body font-size: 11px (DV-02)
    color: 'var(--text-body, #e2e8f0)',
    background: 'var(--bg-app, #090912)',
  },
} satisfies Record<string, React.CSSProperties>
