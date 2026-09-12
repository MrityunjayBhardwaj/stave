"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useVizRefWatcher } from "../useVizRefWatcher";
import { reportBootFailure } from "../dialogs/bootFailureNotice";
import { promptAndCreateFile } from "../lib/newFile";
import { BackdropPopover } from "./BackdropPopover";
import {
  TIMELINE_EVAL_WAIT_MS,
  publishSnapshotAfterBoundedEval,
} from "./timelineSnapshotRefresh";
import { PopoutPreviewController } from "./PopoutPreviewController";
import { registerVizWorker } from "../visualizers/registerVizWorker";
import {
  WorkspaceShell,
  getResolvedTheme,
  onThemeChange,
  type WorkspaceShellHandle,
  type ResolvedTheme,
  getFile,
  subscribeToWorkspaceFile,
  listWorkspaceFiles,
  initHistory,
  startHistoryDriver,
  resetHistoryState,
  commitWorkspace,
  getViewedContent,
  isViewing,
  pruneTrackMetaForCode,
  subscribeToRuntimeView,
  subscribeToFileList,
  registerRuntimeProvider,
  registerPreviewProvider,
  getRuntimeProviderForLanguage,
  getPreviewProviderForLanguage,
  STRUDEL_RUNTIME,
  SONICPI_RUNTIME,
  HYDRA_VIZ,
  P5_VIZ,
  GLSL_VIZ,
  LiveCodingRuntime,
  VizPresetStore,
  bundledPresetId,
  flushToPreset,
  getPresetIdForFile,
  isVizLanguage,
  rendererForLanguage,
  compilePreset,
  registerPresetAsNamedViz,
  emitLog,
  emitFixed,
  formatFriendlyError,
  parseMessageLocation,
  statementOffsetForSource,
  resolveAlias,
  runPasses,
  publishIRSnapshot,
  IR,
  runRawStage,
  runMiniExpandedStage,
  runChainAppliedStage,
  type Pass,
  type PatternIR,
  STRUDEL_DOCS_INDEX,
  SONICPI_DOCS_INDEX,
  type DocsIndex,
  type RuntimeId,
  type WorkspaceTab,
  type ChromeContext,
  type VizPreset,
  type VizDescriptor,
  type PreviewProvider,
  type HapStream,
  type IREvent,
  type BreakpointStore,
  loadShellState,
  saveShellState,
  buildDefaultSnapshot,
  hydrateSnapshot,
  type ShellSnapshot,
  PIANOROLL_P5_CODE,
  setVizQuality,
  type VizQualityLevel,
  registerReevalHandler,
  applyEvalSourceTransform,
  purgeLegacyMasterGain,
  getBackdropVizSpan,
  setBackdropVizSpan,
  getActiveEditor,
  applyOffsetEditsToFile,
  masterVizEdit,
  readMasterViz,
  onActiveEditorChange,
  readPersistedOpen,
  readPersistedActiveTabId,
  getIRSnapshot,
  parseStrudel,
  analyzeSong,
  songExtent,
  signalDimensionsOf,
  listAssetRecords,
  registerAssets,
  type SongExtent,
} from "@stave/editor";
import { reportWriteRefusal } from "../lib/writeRefusal";
import { createSongCollector } from "./musicalTimeline/songCollector";
import { measureSongLength, type BounceSizing } from "./songLength";
import {
  createEndOfSongWatcher,
  hasDefiniteEnd,
  sameExtent,
} from "./songTermination";
import { PIANOROLL_HYDRA_CODE, seedMissingPresetFiles } from "../templates";
import { installBounceProbe } from "../e2e/bounceProbe";
import { installAssetProbe } from "../e2e/assetProbe";
import { warmWaveforms } from "../audio/waveformWarm";
import {
  buildStrudelPasses,
  type StrudelPassDeps,
} from "./strudelPasses";


// Phase 19-07 (#79) — the Inspector's INTERMEDIATE views. RAW reads
// input.code from the pre-pass-0 seed (Code-wrapped raw source); the next two
// take the previous stage's PatternIR output. Future passes that rewrite Play
// nodes must preserve or compose `loc` (PV24).
//
// ⚠ #1558 — THE FINAL TAB IS NOT IN THIS LIST, AND THAT IS THE POINT. These
// three are `parseStrudelStages.ts`, a parallel reimplementation of decisions
// `parseStrudel` makes, kept in sync by hand. It exists so the Inspector can
// show the parse in steps — `parseStrudel` does all of it in one pass and never
// stops to show its work.
//
// That makes it a DEBUGGING affordance, and the song timeline must not eat its
// output: `MusicalTimeline` analyses `snapshot.ir`, so a bug in a hidden debug
// panel's data source was able to silence a track. #1553 did exactly that —
// `runChainAppliedStage` dropped a chain applied over a comma pattern, and six
// archive documents lost every method in their chain; one kept 7 of its 66
// notes. That bug is not expressible in `parseStrudel`, which passes the chain
// straight from `parseRoot` to `applyChain` as a local instead of stashing it
// on a node to carry it across a stage boundary.
//
// So the FINAL entry is appended at the call site from `parseStrudel` directly.
// The tab name 'Parsed' is unchanged (IRInspectorPanel persistence,
// RESEARCH §3.2) and there are still four tabs.
const STRUDEL_STAGE_PASSES: readonly Pass<PatternIR>[] = [
  { name: "RAW",            run: runRawStage           },
  { name: "MINI-EXPANDED",  run: runMiniExpandedStage  },
  { name: "CHAIN-APPLIED",  run: runChainAppliedStage  },
];

/**
 * #1558 — the real wiring for `buildStrudelPasses`. Lives HERE because this
 * file already imports the `@stave/editor` barrel; `strudelPasses.ts` must not,
 * or it drags `gifenc` (CJS) into the app's vitest run.
 */
const STRUDEL_PASS_DEPS: StrudelPassDeps = {
  runStages: (code) => runPasses(IR.code(code), STRUDEL_STAGE_PASSES),
  parse: parseStrudel,
};

// Phase 20-12 — the timeline collects across the same cycle window the live
// monitor displays (WINDOW_CYCLES in musicalTimeline/timeAxis.ts is 2).
// Duplicated here because chrome (app) and engine (editor) can't import each
// other; if WINDOW_CYCLES changes there, update this to match.
const TIMELINE_WINDOW_CYCLES = 2;

// #977 — eval-on-load is LAZY: the Song timeline's pre-play marks only switch
// from collect-computed to eval-computed while the timeline is actually on
// screen, so a file whose timeline is never opened never pays the evaluate
// cost. The tab id matches FullSongTimeline's `TAB_ID` and the bottom-panel
// tab's `data-bottom-panel-tab`. Visibility is polled localStorage (there is
// no change event), read through the same two accessors the timeline's own
// playhead loop uses.
const MUSICAL_TIMELINE_TAB_ID = "musical-timeline";
function isSongTimelineVisible(): boolean {
  return (
    readPersistedOpen() && readPersistedActiveTabId() === MUSICAL_TIMELINE_TAB_ID
  );
}
// Cadence for the visibility EDGE poll (hidden→visible). Only the transition
// does work — one evaluate per open, never per tick. Mirrors the timeline's
// own ~250ms visibility poke; 500ms is imperceptible for "open tab → see marks".
const TIMELINE_VISIBILITY_POLL_MS = 500;

/**
 * How often the end-of-song watcher samples the transport (#1388).
 *
 * This is the ONLY thing that decides how much of the song's restart is audible
 * before it stops: at Strudel's default 0.5 cps a cycle lasts two seconds, so
 * 50 ms is ~2.5% of a cycle. The loop body is a handful of map reads, and the
 * timer does not exist at all while nothing is playing — see the effect below.
 */
const END_OF_SONG_POLL_MS = 50;

// #457 — debounce for republishing the IR snapshot on a stopped code edit, so
// the Song timeline / IR Inspector track the source as the user types without
// thrashing analyzeSong on every keystroke. ~one comfortable typing pause.
const SNAPSHOT_REFRESH_DEBOUNCE_MS = 300;

/**
 * Parse the file's current source into IR and publish an IRSnapshot for the
 * Inspector + full-song timeline. parseStrudel is pure and cheap on the source
 * string, so this is safe to call outside the eval lifecycle — both the
 * eval-success path AND on-demand (#394: the full-song view needs a snapshot
 * the instant it opens, but a cold eval's `onEvaluateSuccess` lags ~2.5s behind
 * the keypress, leaving the view empty in the meantime).
 *
 * The snapshot's `events` come from the runtime's EVALUATED haps
 * (`getTimelineEvents`, queryArc) — eval-truth, the same source the Song
 * timeline's display marks read — NOT the collect interpreter (#982). They are
 * `[]` until an evaluate populates the runtime's song patterns (PK57: empty
 * pre-eval, matching the timeline baseline); the IR tree (`ir`/`passes`) stays
 * source-fresh regardless. A null runtime (non-Strudel / not yet created)
 * yields empty events.
 *
 * Strudel-only, total: no-op for non-Strudel runtimes / missing files, and
 * swallows parse errors (parseStrudel guarantees a graceful Code-node
 * fallback). `source` is the workspace fileId — NOT the human-visible path —
 * because the Inspector's click-to-source keys by id.
 */
function captureAndPublishSnapshot(
  fileId: string,
  cycleCount: number | null,
  runtime: LiveCodingRuntime | null,
): void {
  const fileNow = getFile(fileId);
  if (!fileNow) return;
  const runtimeId: RuntimeId =
    fileNow.language === "sonicpi" ? "sonicpi" : "strudel";
  if (runtimeId !== "strudel") return;
  try {
    // Phase 19-07 (#79) — pre-pass-0 seed: wrap raw source as a Code node so
    // pass 0 (RAW) reads input.code and runs extractTracks. finalIR is the `ir`
    // alias — the Inspector's IR tree, source-fresh (PV27).
    const passes = buildStrudelPasses(fileNow.content, STRUDEL_PASS_DEPS);
    // #1558 — the FINAL tree is the PARSER's, not the staged pipeline's, so a
    // bug in the (unreachable) Inspector's data source cannot silence a track.
    // The rule, the measurements and why the deps are injected: strudelPasses.ts.
    // `finalIR` stays the `ir` alias that IRSnapshot requires.
    const finalIR = passes[passes.length - 1].ir;
    // #982 — events = the runtime's evaluated haps (queryArc), not collect, so
    // the Inspector's event table shows eval-truth. `[]` until eval populates
    // song patterns; trackId stays the raw engine key ($N / d{N}) — the table
    // is a flat raw view, not lane-grouped, so no lane-key remap is needed.
    const events = runtime?.getTimelineEvents(TIMELINE_WINDOW_CYCLES) ?? [];
    publishIRSnapshot(
      {
        ts: Date.now(),
        source: fileNow.id,
        runtime: "strudel",
        code: fileNow.content,
        passes,
        ir: finalIR, // alias of passes[last].ir per IRSnapshot contract
        events,
      },
      { cycleCount },
    );
  } catch {
    // parseStrudel guarantees graceful fallback to Code node; collect is
    // total. Anything thrown here is unexpected — stay quiet.
  }
}

/**
 * Intrinsic drawing aspect for bundled vizzes, keyed by preset name. The single
 * source of truth: the seed presets AND `registerAllVizFiles` both read it, so
 * a bundled viz keeps its aspect even though `flushToPreset` rebuilds the IDB
 * preset from the (metadata-less) workspace file and would otherwise strip
 * `nativeSize`. The pianoroll uses a wide/short 6:1 to match @strudel/draw's
 * inline pianoroll (#214): a short value axis keeps fold lanes thin so notes
 * read as landscape bars, not tall blocks. Without an entry a viz falls back to
 * the generic 2:1 `DEFAULT_NATIVE`.
 */
const BUNDLED_VIZ_NATIVE_SIZE: Record<string, { w: number; h: number }> = {
  "Piano Roll": { w: 1200, h: 200 },
  "Piano Roll (Hydra)": { w: 1400, h: 400 },
  // Pitchwheel — a centred wheel. Without a declared native it falls to
  // DEFAULT_NATIVE (1200x600 -> a ~530px-tall strip), which paired with the
  // createCanvas(stave.width,stave.height) behaviour would fill that whole box
  // with a giant wheel. A wide-ish 5:1 strip keeps it a comfortable inline
  // height. Key is the PRESET NAME, which is lowercase for this one.
  pitchwheel: { w: 1200, h: 240 },
};


// ---------------------------------------------------------------------------
// Provider registration (idempotent — safe to call on every mount)
// ---------------------------------------------------------------------------

let providersRegistered = false;
function ensureProviders() {
  if (providersRegistered) return;
  providersRegistered = true;
  registerRuntimeProvider(STRUDEL_RUNTIME);
  registerRuntimeProvider(SONICPI_RUNTIME);
  registerPreviewProvider(HYDRA_VIZ);
  registerPreviewProvider(P5_VIZ);
  registerPreviewProvider(GLSL_VIZ);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * #1346 — the app-facing contract for bouncing the live mix to a WAV.
 *
 * `LiveRecorder` taps the master analyser, so a bounce records whatever the
 * graph is playing — including nothing. `bounce` therefore guarantees playback
 * for the take and restores the transport afterwards; callers do not sequence
 * that themselves, and must still treat a returned Blob as audio to verify
 * rather than audio to trust.
 */
export interface BounceHandle {
  /** True when the active tab has a runtime whose engine can capture audio. */
  canBounce(): boolean;
  /**
   * Capture `seconds` of the active file's live output. Resolves to null when
   * there is no active recordable runtime. Pass `signal` to stop early and
   * keep what was captured.
   *
   * `onCaptureStart` fires once the graph has settled and playback is running,
   * i.e. at the first captured sample — so a progress display measures the
   * capture and not the preparation before it (#1356).
   */
  bounce(
    seconds: number,
    signal?: AbortSignal,
    onCaptureStart?: () => void,
  ): Promise<Blob | null>;
  /**
   * How long the active document is, and at what tempo — so the bounce modal can
   * offer a real length instead of a list of guessed durations (#1365).
   *
   * Answered HERE rather than read off the Song timeline, which computes the same
   * analysis but may not be mounted when someone bounces. Resolves to a
   * `{kind:'unknown'}` length rather than rejecting: not knowing how long a
   * document is must never be the reason a bounce cannot happen.
   */
  songSizing(signal?: { aborted: boolean }): Promise<BounceSizing>;
}

interface StrudelEditorClientProps {
  /**
   * Active project id — used to scope the workspace-shell state
   * persistence (issue #175). StaveApp already keys this component by
   * `activeProject.id`, so within a single mount the id is stable; on
   * project switch the component remounts and reads the new project's
   * persisted tabs.
   */
  projectId: string;
  shellRef?: React.RefObject<WorkspaceShellHandle | null>;
  /**
   * #1346 — populated with a handle onto the ACTIVE file's live audio graph so
   * StaveApp can offer "Bounce to WAV" from the File menu.
   *
   * StaveApp owns the File commands and every modal, but has no engine of its
   * own; the runtimes live here in `runtimesRef`. This is the narrowest seam
   * that closes that gap — the same shape as `shellRef`: StaveApp creates the
   * ref, this component attaches to it.
   */
  bounceRef?: React.RefObject<BounceHandle | null>;
  onActiveFileChange?: (fileId: string | null) => void;
  /**
   * Reports the runtime state (playing / bpm / error) for the currently
   * active editor tab, or null when the active tab has no runtime (viz
   * editor, markdown, unknown). StaveApp uses this to drive the status bar.
   */
  onActiveRuntimeStateChange?: (state: {
    fileId: string;
    isPlaying: boolean;
    bpm?: number;
    error: string | null;
    /**
     * Phase 20-01 PR-B (DB-01) — live runtime accessors carried alongside
     * the status payload so subscribers (notably MusicalTimeline) can
     * sample `getCurrentCycle()` / cps on a hot loop without coupling to
     * the runtime map. Both return `null` when the engine isn't running.
     */
    getCycle: () => number | null;
    getCps: () => number | null;
    /**
     * Phase 20-06 (PV38, PK13 step 7+8) — accessor onto the engine's
     * HapStream so the MusicalTimeline subscriber can resolve to a live
     * stream through the same closure-bound pattern. Returns null when
     * the engine isn't running or the runtime is non-Strudel.
     */
    getHapStream: () => HapStream | null;
    /**
     * #861 — evaluated per-track note events over `[0, ceil(cycles))` for the
     * full-song timeline's DISPLAY marks. Mirrors `getHapStream`'s closure-bound
     * shape; `[]` when the engine isn't running or the runtime is non-Strudel.
     */
    getTimelineEvents: (cycles: number) => IREvent[];
    /**
     * #1197 — the same events over a BAND `[startCycle, endCycle)` rather than a
     * prefix from zero, so the song analysis stops re-querying (and discarding)
     * the whole prefix on every slice of its progressive horizon.
     */
    getTimelineEventsBand: (startCycle: number, endCycle: number) => IREvent[];
    /**
     * #1107 — the capture keys of every registered track, so the song analysis
     * can tell "this track has not played yet" from "there is no such track".
     * Same closure-bound shape; `[]` for a non-Strudel runtime, which correctly
     * makes no claim about the document's tracks.
     */
    getSongTrackIds: () => string[];
    /**
     * #384/#385 — transport seek accessors for the full-song timeline.
     * `getSongPosition` is the transport-offset-aware clock; `onSeek`
     * seeks to an absolute song cycle. Closure-bound through `runtimesRef`
     * like the others; non-Strudel runtimes return null / no-op.
     */
    getSongPosition: () => number | null;
    onSeek: (cycle: number) => void;
    /**
     * #394 — on-demand IR snapshot capture for the full-song view. The view
     * needs a snapshot the instant it opens, but a cold eval's
     * `onEvaluateSuccess` lags ~2.5s; MusicalTimeline calls this when it
     * enters song mode with no snapshot yet. No-op for non-Strudel runtimes.
     */
    onRequestSnapshot: () => void;
    /**
     * Phase 20-07 wave γ (R-2) — debugger accessors. Mirror the
     * `getHapStream` shape: closure-bound reads through `runtimesRef`
     * so the closures stay valid across active-tab swaps. Non-Strudel
     * runtimes return null/false/no-op disposers (LiveCodingRuntime
     * delegates with optional chaining).
     */
    getBreakpointStore: () => BreakpointStore | null;
    getIsPaused: () => boolean;
    onResume: () => void;
    onPauseChanged: (cb: (paused: boolean) => void) => () => void;
  } | null) => void;
  onTabContextMenu?: (tab: WorkspaceTab, x: number, y: number) => void;
  /** Navigate to a viz file when the user clicks the edit icon on an inline viz. */
  onEditViz?: (vizId: string) => void;
  /** Open crop popup when the user clicks the crop icon on an inline viz. */
  onCropViz?: (vizId: string, presetId: string | null, trackKey: string) => void;
  /** Pass-through of the shell's backdrop change callback — fires on any
   *  group's backgroundFileId transition. StaveApp uses this to mirror
   *  the pinned backdrop into its own React state for the FileTree
   *  context-menu label. */
  onBackgroundFileChange?: (groupId: string, fileId: string | null) => void;
  /** #350a — fires when the active group's RESOLVED backdrop (code override ??
   *  manual sticky) changes, so UI mirrors what's showing. Forwarded to the shell. */
  onActiveBackdropChange?: (fileId: string | null) => void;
  /** Crop region applied to the pinned backdrop. `null` = full rect. */
  backgroundCrop?: { x: number; y: number; w: number; h: number } | null;
  /**
   * Fires after EVERY successful Strudel evaluate with the code's current
   * backdrop viz — the resolved renderer id of a non-underscore viz method
   * (`.scope()`, `.pianoroll()`, …), or `null` when the code has none. Code
   * is the source of truth: StaveApp pins the resolved viz file as the
   * backdrop, or clears the backdrop when `null` (so removing the method
   * un-pins it). Fires on every eval so the backdrop tracks code edits.
   */
  onCodeBackdropChange?: (vizId: string | null) => void;
  /** #347 — open the crop modal for the active pane's backdrop (same handler
   *  the menubar bg-popover uses). Invoked from the pattern-bar set-bg popover. */
  onCropBackdrop?: () => void;
  /** #347 — reveal (open) the active pane's backdrop viz file in the editor. */
  onRevealBackdrop?: () => void;
}

/**
 * #347 — per-TAB backdrop persistence. The backdrop a user pins is stored
 * against the file (tab) it was set from, not the pane — so switching tabs
 * swaps/clears the pane's backdrop to match the active tab. Persisted per
 * project in localStorage as a plain `{ fileId: vizFileId }` map; best-effort.
 */
function perTabBackdropKey(projectId: string): string {
  return `stave:perTabBackdrop:${projectId}`;
}
function loadPerTabBackdrop(projectId: string): Map<string, string> {
  if (typeof window === "undefined") return new Map();
  try {
    const raw = window.localStorage.getItem(perTabBackdropKey(projectId));
    if (!raw) return new Map();
    return new Map(Object.entries(JSON.parse(raw) as Record<string, string>));
  } catch {
    return new Map();
  }
}
function savePerTabBackdrop(
  projectId: string,
  map: ReadonlyMap<string, string>,
): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      perTabBackdropKey(projectId),
      JSON.stringify(Object.fromEntries(map)),
    );
  } catch {
    /* best-effort persistence */
  }
}

/**
 * #347 — "set bg" dropdown injected into the pattern (Strudel) chrome bar via
 * `chromeExtras`, sitting next to the live toggle. Mirrors the menubar
 * bg-indicator: a click opens the SAME `BackdropPopover` (viz-file picker when
 * unpinned; swap + opacity/quality + crop/reveal/clear when pinned), anchored
 * to this button and scoped to THIS pane. A `.strudel` file can't itself be a
 * backdrop (the backdrop renders viz files only), so the picker lists viz files
 * and selecting one pins it as this pane's manual sticky (#350a). `pinned`
 * reflects the pane's resolved backdrop (code override ?? sticky).
 */
function SetBackdropButton({
  pinned,
  fileName,
  onOpen,
}: {
  pinned: boolean;
  fileName: string | null;
  onOpen: (rect: DOMRect) => void;
}): React.ReactElement {
  return (
    <button
      data-testid="strudel-chrome-bg-toggle"
      data-pinned={pinned ? "true" : "false"}
      onClick={(e) => onOpen(e.currentTarget.getBoundingClientRect())}
      title={
        pinned
          ? `Backdrop: ${fileName ?? ""} — click for controls`
          : "Set a viz as this pane's backdrop"
      }
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: "3px 8px",
        borderRadius: 3,
        fontSize: 10,
        fontFamily: "inherit",
        cursor: "pointer",
        userSelect: "none",
        background: pinned ? "var(--accent-dim)" : "none",
        color: pinned
          ? "var(--accent-strong, var(--accent))"
          : "var(--foreground-muted)",
        border: `1px solid ${pinned ? "var(--accent-dim)" : "var(--border)"}`,
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 7,
          height: 7,
          borderRadius: "50%",
          background: pinned
            ? "var(--accent-strong, var(--accent))"
            : "var(--foreground-muted)",
          flexShrink: 0,
        }}
      />
      <span>{pinned && fileName ? `bg: ${fileName}` : "set bg"}</span>
      <span style={{ fontSize: 9, opacity: 0.8 }}>▾</span>
    </button>
  );
}

export default function StrudelEditorClient({
  projectId,
  shellRef,
  bounceRef,
  onActiveFileChange,
  onActiveRuntimeStateChange,
  onTabContextMenu,
  onEditViz,
  onCropViz,
  onBackgroundFileChange,
  onActiveBackdropChange,
  backgroundCrop,
  onCodeBackdropChange,
  onCropBackdrop,
  onRevealBackdrop,
}: StrudelEditorClientProps) {
  // Register providers once
  ensureProviders();

  // Mirror the resolved editor theme so the WorkspaceShell + Monaco
  // re-render when the user flips Dark / Light / System. Initial state
  // pulls from localStorage via getResolvedTheme.
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() =>
    typeof window === "undefined" ? "dark" : getResolvedTheme(),
  );
  useEffect(() => onThemeChange(setResolvedTheme), []);

  // #347 — per-TAB backdrop. `tabBackdrops` maps a file (tab) id → the viz file
  // pinned as ITS backdrop. The pane's rendered backdrop follows the active
  // tab (see the active-tab sync + onBackgroundFileChange recorder below), so
  // switching tabs swaps/clears the backdrop instead of bleeding it across the
  // whole pane. `bgPopover` carries the anchor rect AND the file id the popover
  // was opened from, so it edits THAT tab's backdrop.
  const [tabBackdrops, setTabBackdrops] = useState<ReadonlyMap<string, string>>(
    () => loadPerTabBackdrop(projectId),
  );
  const [bgPopover, setBgPopover] = useState<{
    rect: DOMRect;
    fileId: string;
  } | null>(null);

  // #240 — viz pop-out (Cmd+K W). The compiled descriptor for the file being
  // popped out; non-null while a pop-out window is open. Driven by
  // `handleOpenPopout` (wired to the shell's openPopoutPreview action).
  const [popout, setPopout] = useState<{
    fileId: string;
    descriptor: VizDescriptor;
  } | null>(null);

  const handleOpenPopout = useCallback((fileId: string) => {
    const file = getFile(fileId);
    if (!file || !isVizLanguage(file.language)) return;
    const renderer = rendererForLanguage(file.language);
    if (!renderer) return;
    // Compile a fresh descriptor from the file's current content. The popup
    // mounts a MAIN-THREAD renderer (a separate window can't share the
    // OffscreenCanvas worker transfer); compilePreset's factory downgrades to
    // the main-thread path automatically there.
    const preset: VizPreset = {
      id: file.id,
      name: file.path,
      renderer,
      code: file.content,
      requires: [],
      createdAt: 0,
      updatedAt: 0,
    };
    setPopout({ fileId, descriptor: compilePreset(preset) });
  }, []);

  // Persist the per-tab map (best-effort). Re-runs only when the map changes.
  useEffect(() => {
    savePerTabBackdrop(projectId, tabBackdrops);
  }, [projectId, tabBackdrops]);

  // Record a tab's backdrop choice. Pure state update; the persist effect above
  // flushes it. The pane render is driven separately via setBackgroundFile.
  const recordTabBackdrop = useCallback(
    (fileId: string, vizId: string | null) => {
      setTabBackdrops((prev) => {
        if ((prev.get(fileId) ?? null) === vizId) return prev; // no churn
        const next = new Map(prev);
        if (vizId) next.set(fileId, vizId);
        else next.delete(fileId);
        return next;
      });
    },
    [],
  );

  // Pass-through that ALSO captures every manual sticky against the ACTIVE tab,
  // so backdrops set from any surface (pattern-bar popover, VizEditorChrome
  // toggle, file-tree, Cmd+K B) become per-tab and travel with the tab.
  const handleBackgroundFileChange = useCallback(
    (groupId: string, fileId: string | null) => {
      const activeId = activeFileIdRef.current;
      if (activeId) recordTabBackdrop(activeId, fileId);
      onBackgroundFileChange?.(groupId, fileId);
    },
    [recordTabBackdrop, onBackgroundFileChange],
  );

  // Resolve a backdrop fileId → its display basename (no extension).
  const backdropName = useCallback(
    (fileId: string | null): string | null => {
      if (!fileId) return null;
      const f = getFile(fileId);
      if (!f) return null;
      return f.path.split("/").pop()!.replace(/\.[^.]+$/, "");
    },
    [],
  );

  // #792 — the "set backdrop" gesture ALSO writes the global backdrop into the
  // document as `all(x=>x.viz("name",{backdrop:true}))` (or removes it), so it
  // round-trips to code — the master analog of a channel's inline `.viz()`. The
  // viz FILE's basename is the name the code carries and the existing code→backdrop
  // read path resolves back (`StaveApp.handleCodeBackdropChange`). Surgical + tagged
  // 'mixer' (one undo step; the live re-eval picks it up) — the same seam the Mixer
  // faders use. This is additive: the per-tab sticky still drives the indicator and
  // the render, so all existing backdrop behavior is unchanged; the code just gains
  // a durable, portable representation of the choice.
  const writeBackdropToCode = useCallback(
    (vizId: string | null) => {
      const fileId = activeFileIdRef.current;
      if (!fileId) return;
      const doc = getActiveEditor()?.getModel?.()?.getValue?.();
      if (doc == null) return;
      const edit = masterVizEdit(doc, vizId ? backdropName(vizId) : null);
      if (!edit) return;
      // ⚠ THE OUTCOME IS READ, NOT THE EDIT (#1414). The `if` above guards whether
      // there is anything to write; it says nothing about whether the write landed.
      // This was the fourteenth call site discarding the writer's answer — and the
      // one most likely to be miscounted as safe, because it has an `if` in front
      // of it. `applyOffsetEditsToFile` names five refusals; report the one we got.
      const outcome = applyOffsetEditsToFile(fileId, [edit], "mixer", doc);
      if (outcome !== "applied") reportWriteRefusal(fileId, "Mixer: the backdrop", outcome);
    },
    [backdropName],
  );

  // #795 — resolve a viz NAME (as written in `all(x=>x.viz("name",…))`) back to a
  // viz FILE id, by NORMALIZED basename — the inverse of the code→backdrop read
  // path, so a code backdrop projects onto the sticky the indicator/render read.
  const resolveVizNameToFileId = useCallback((name: string | null): string | null => {
    if (!name) return null;
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
    const target = norm(name);
    const matches = listWorkspaceFiles().filter(
      (f) =>
        isVizLanguage(f.language) &&
        norm(f.path.split("/").pop()!.replace(/\.[^.]+$/, "")) === target,
    );
    if (matches.length === 0) return null;
    return matches.find((f) => f.language === "p5js")?.id ?? matches[0].id;
  }, []);

  // #795 — keep the per-tab backdrop STICKY a reactive PROJECTION of the active
  // pattern file's CODE. The sticky is what drives BOTH the [bg]/[set bg] indicator
  // and the render (via override ?? sticky); syncing it from the code means editing
  // or DELETING the `all(x=>x.viz(name,{backdrop:true}))` line flips the indicator
  // and clears the backdrop with no manual re-pick — the code→UI half of the #792
  // round-trip. Guard: only act when the CODE's backdrop actually CHANGES (tracked
  // in prevCodeBackdropRef), so a keystroke elsewhere never disturbs a backdrop set
  // from another surface (file-tree / Cmd+K B) that isn't in the code.
  const prevCodeBackdropRef = useRef<string | null>(null);
  useEffect(() => {
    let sub: { dispose?: () => void } | undefined;
    const codeBackdropOf = (): string | null => {
      const model = getActiveEditor()?.getModel?.();
      // master all() is a pattern-file concept — only sync for the Strudel editor
      // (the monaco languageId is the reliable signal; the bg-toggle lives here).
      if (model?.getLanguageId?.() !== "strudel") return null;
      const name = readMasterViz(model.getValue?.() ?? "")?.name ?? null;
      return name ? resolveVizNameToFileId(name) : null;
    };
    const sync = () => {
      const fileId = activeFileIdRef.current;
      if (!fileId) return;
      const code = codeBackdropOf();
      if (code === prevCodeBackdropRef.current) return; // code backdrop unchanged → leave the sticky alone
      prevCodeBackdropRef.current = code;
      recordTabBackdrop(fileId, code);
      shellRef?.current?.setBackgroundFile?.(code);
    };
    const wire = () => {
      sub?.dispose?.();
      // reset per active file so its code backdrop is (re)projected on entry
      prevCodeBackdropRef.current = null;
      const model = getActiveEditor()?.getModel?.();
      sub = model?.onDidChangeContent?.(sync);
      sync();
    };
    wire();
    const un = onActiveEditorChange(wire);
    return () => {
      sub?.dispose?.();
      un?.();
    };
  }, [recordTabBackdrop, resolveVizNameToFileId]);

  // Track active file for the viz-ref watcher hook.
  const [watchedFileId, setWatchedFileId] = useState<string | null>(null);
  useVizRefWatcher(watchedFileId);

  // Bundled preset IDs (used for the preset-seeding effect + named-viz
  // registration). Files themselves are seeded by templates.ts at
  // project-creation time — NOT here.
  const [seedState] = useState(() => ({
    p5PresetId: bundledPresetId("Piano Roll", "p5"),
    hydraPresetId: bundledPresetId("Piano Roll Hydra", "hydra"),
  }));

  // Seed any missing viz preset files into the project so older
  // projects get the full set of built-in viz workspace files.
  useEffect(() => { seedMissingPresetFiles(); }, []);

  // #794 — one-time purge of the retired per-file master-gain store. The master
  // trim now lives in the document (`all(x => x.gain())`); any old
  // `stave:mixer.master:*` value is dead and must not linger as a second source.
  useEffect(() => { purgeLegacyMasterGain(); }, []);

  // Phase B / B-3 (#245) — register the Next-bundled viz-worker constructor with
  // the editor's DI seam so `WorkerVizRenderer` can spawn it (gated behind the
  // `workerRenderer` flag, OFF by default — this only wires the seam).
  useEffect(() => { registerVizWorker(); }, []);

  // Register ALL .p5/.hydra workspace files as named viz presets so
  // `.viz("name")` works for user-created files, not just bundled ones.
  //
  // #204 time-travel: when a commit is checked out, viz files register from
  // their SNAPSHOT code (via getViewedContent) so inline `.viz()` shows the
  // historical viz — but we skip flushToPreset while viewing so the override
  // never persists historical code to IndexedDB (same non-destructive rule as
  // Y.Text). Re-run on enter/exit restores live (round-trip is total).
  const registerAllVizFiles = useCallback(async () => {
    const viewing = isViewing();
    const allFiles = listWorkspaceFiles();
    const vizFiles = allFiles.filter((f) => isVizLanguage(f.language));
    // Basename (sans extension) of every p5 viz file. When a hydra file
    // shares a basename with a p5 file (e.g. scope.p5 + scope.hydra), the
    // bare mode name belongs to the p5 default renderer — register the
    // hydra one as "<name>:hydra" so inline `.viz("scope")` deterministically
    // resolves to the p5 preset instead of last-write-wins (#181). This
    // also keeps inline `.viz("scope")` in lockstep with the `.scope()`
    // backdrop, which always prefers the p5 file.
    const baseOf = (p: string) =>
      p.split("/").pop()!.replace(/\.[^.]+$/, "");
    const p5Basenames = new Set(
      vizFiles.filter((f) => f.language === "p5js").map((f) => baseOf(f.path)),
    );
    for (const f of vizFiles) {
      let presetId = getPresetIdForFile(f);
      if (!presetId) {
        const baseName = f.path.replace(/\.[^.]+$/, "");
        presetId = `user_${baseName.replace(/[^a-zA-Z0-9]/g, "_")}`;
      }
      // Persist live code to the preset store — but NEVER while viewing
      // (the override is read-only; persisting historical code would corrupt
      // the live preset, the viz analogue of writing Y.Text).
      if (!viewing) await flushToPreset(f.id, presetId);
      const preset = await VizPresetStore.get(presetId);
      if (!preset) continue;
      // While viewing, override the registered code with this file's snapshot
      // content (null = file absent at the commit → fall back to live preset).
      const viewedCode = getViewedContent(f.id);
      const effective0 =
        viewedCode !== null ? { ...preset, code: viewedCode } : preset;
      // Re-apply the bundled native aspect — `flushToPreset` rebuilds the
      // preset from the metadata-less workspace file and strips `nativeSize`,
      // so without this the pianoroll registers at the generic 2:1 and its
      // pitch lanes get squashed (the "stretched" look). For bundled vizzes the
      // map is authoritative (there's no user-facing nativeSize control), so it
      // also overrides any stale value persisted before this fix.
      const bundledNative = BUNDLED_VIZ_NATIVE_SIZE[effective0.name];
      const effective = bundledNative
        ? { ...effective0, nativeSize: bundledNative }
        : effective0;
      const base = baseOf(f.path);
      // A non-p5 file sharing a basename with a p5 file registers under a
      // renderer-qualified name (`<name>:hydra` / `<name>:glsl`) so bare
      // `.viz("<name>")` deterministically resolves to the p5 preset (#181).
      const name =
        f.language !== "p5js" && p5Basenames.has(base)
          ? `${base}:${f.language === "hydra" ? "hydra" : "glsl"}`
          : preset.name;
      registerPresetAsNamedViz(effective, name);
    }
  }, []);

  useEffect(() => { void registerAllVizFiles(); }, [registerAllVizFiles]);

  // #204 time-travel: re-register viz from the snapshot on checkout
  // enter/exit/swap so inline `.viz()` follows the viewed commit, then
  // restores live on exit.
  useEffect(
    () => subscribeToRuntimeView(() => { void registerAllVizFiles(); }),
    [registerAllVizFiles],
  );

  // #834 — a viz file added at RUNTIME (the Viz library's "Add to workspace",
  // or the New File dialog) must register as a named viz too. The mount-time
  // run above fires once, so re-run whenever the workspace file LIST changes
  // (add / remove / rename — subscribeToFileList ignores content edits, so this
  // is not per-keystroke). Without this, inline `.viz("<name>")` on a
  // just-added file silently resolves to nothing until reload (P118).
  useEffect(
    () => subscribeToFileList(() => { void registerAllVizFiles(); }),
    [registerAllVizFiles],
  );

  // Register bundled presets as named viz (for `.viz("Piano Roll")` lookup).
  useEffect(() => {
    const p5Preset: VizPreset = {
      id: seedState.p5PresetId,
      name: "Piano Roll",
      renderer: "p5",
      code: PIANOROLL_P5_CODE,
      requires: ["streaming"],
      // Wide/short 6:1 aspect to match @strudel/draw's inline pianoroll (#214).
      // Block aspect = (dur·lanes/CYCLES)·(W/H); fold packs distinct pitches into
      // contiguous lanes (no gaps), so a short H keeps those lanes thin and notes
      // render as landscape bars (the strudel.cc look). The earlier 1.6:1 came
      // from a mis-diagnosis: a taller surface fattens lanes → MORE stretch.
      nativeSize: BUNDLED_VIZ_NATIVE_SIZE["Piano Roll"],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const hydraPreset: VizPreset = {
      id: seedState.hydraPresetId,
      name: "Piano Roll (Hydra)",
      renderer: "hydra",
      code: PIANOROLL_HYDRA_CODE,
      requires: ["audio"],
      nativeSize: BUNDLED_VIZ_NATIVE_SIZE["Piano Roll (Hydra)"],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    registerPresetAsNamedViz(p5Preset);
    registerPresetAsNamedViz(hydraPreset);
  }, [seedState.p5PresetId, seedState.hydraPresetId]);

  // E2E-only hook (Phase 21 T5 observation): expose the named-viz registrar so
  // Playwright can register a one-off custom p5/hydra sketch by name and then
  // reference it via `.viz("name")` / `.color()`. This exercises the EXACT
  // production renderer→SignalBus→scheduler path the spine relies on; only the
  // preset-authoring UI step (Viz Editor + Ctrl+S) is shortcut — that flow is
  // not what T5 proves (reactivity + PV64 backdrop threading is). Guarded on
  // `__STAVE_E2E__` so it never attaches in normal use; it calls the same
  // `registerPresetAsNamedViz` the app itself uses for bundled presets.
  useEffect(() => {
    if (typeof window === "undefined") return;
    // Defense-in-depth: never install the E2E hook in a production build —
    // `process.env.NODE_ENV` is statically replaced so the body dead-code-
    // eliminates. The `__STAVE_E2E__` flag is the runtime gate for dev/test.
    if (process.env.NODE_ENV === "production") return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (!(window as any).__STAVE_E2E__) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__staveRegisterViz = (preset: VizPreset): boolean =>
      registerPresetAsNamedViz(preset);
    // #269 — drive the real quality-setting path from E2E so the density-LOD
    // proof exercises setVizQuality (→ resolution + density marshal), not a
    // test-only config poke. Same E2E gate as above.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__staveSetVizQuality = (level: VizQualityLevel): void =>
      setVizQuality(level);
  }, []);

  // Persist bundled presets to IndexedDB on FIRST seed only — never
  // overwrite an existing entry. Earlier the bundled `code` was put
  // back every mount, which silently erased user edits to the bundled
  // Piano Roll preset on every reload (#189). Workspace files follow
  // the same seed-when-missing rule via `seedWorkspaceFile`; bringing
  // VizPresetStore in line removes the "bundled preset is privileged"
  // duality at the data layer.
  useEffect(() => {
    async function seedPresets() {
      const LEGACY_IDS = ["pianoroll-p5-custom", "pianoroll-hydra-custom"];
      for (const legacy of LEGACY_IDS) {
        const stale = await VizPresetStore.get(legacy);
        if (stale) await VizPresetStore.delete(legacy);
      }
      const now = Date.now();
      const existingP5 = await VizPresetStore.get(seedState.p5PresetId);
      if (!existingP5) {
        await VizPresetStore.put({
          id: seedState.p5PresetId, name: "Piano Roll", renderer: "p5",
          code: PIANOROLL_P5_CODE, requires: ["streaming"],
          nativeSize: BUNDLED_VIZ_NATIVE_SIZE["Piano Roll"],
          createdAt: now, updatedAt: now,
        });
      }
      const existingHydra = await VizPresetStore.get(seedState.hydraPresetId);
      if (!existingHydra) {
        await VizPresetStore.put({
          id: seedState.hydraPresetId, name: "Piano Roll (Hydra)", renderer: "hydra",
          code: PIANOROLL_HYDRA_CODE, requires: ["audio"],
          nativeSize: BUNDLED_VIZ_NATIVE_SIZE["Piano Roll (Hydra)"],
          createdAt: now, updatedAt: now,
        });
      }
    }
    seedPresets();
  }, [seedState.p5PresetId, seedState.hydraPresetId]);

  // Project commit store (file-history Phase F, #196). Seeds commit c0 from
  // the live workspace on first run (the workspace files are already present
  // at mount — registerAllVizFiles above relies on the same), then starts the
  // idle + unload auto-commit driver. Per-eval commits are fired from
  // onEvaluateSuccess below. Runs alongside the legacy snapshotStore-backed
  // Version History panel; Phase G (#197) unifies the UI and retires the old.
  useEffect(() => {
    let cancelled = false;
    let teardown = () => {};
    (async () => {
      await initHistory(projectId);
      if (cancelled) return;
      teardown = startHistoryDriver();
    })();
    return () => {
      cancelled = true;
      teardown();
      resetHistoryState();
    };
  }, [projectId]);

  // ── Runtime management ──────────────────────────────────────────────
  // One LiveCodingRuntime per pattern-file tab, keyed by fileId. Per-file
  // runtime state (isPlaying/error/bpm/autoRefresh) mirrors runtime events
  // into React state so chromeForTab can read it cheaply.
  const runtimesRef = useRef<Map<string, LiveCodingRuntime>>(new Map());
  // Latest-value ref: each runtime's onEvaluateSuccess handler is registered
  // ONCE (runtimes are cached in runtimesRef), so reading the prop directly in
  // that closure would capture the first-render value. The ref keeps the call
  // fresh across re-renders without re-creating runtimes.
  const onCodeBackdropChangeRef = useRef(onCodeBackdropChange);
  onCodeBackdropChangeRef.current = onCodeBackdropChange;
  const [runtimeStates, setRuntimeStates] = useState<Map<string, {
    isPlaying: boolean; error: Error | null; bpm?: number; autoRefresh: boolean;
    // #1388 — the document's own answer to "does this end?", refreshed on every
    // successful evaluate. Kept HERE rather than in a ref beside it because two
    // consumers read it and they must not disagree: the chrome (which shows the
    // Loop toggle only for a document that would otherwise stop) and the
    // end-of-song watcher (which stops it). A ref would not re-render the
    // chrome, so the toggle would appear a beat late — or not at all.
    songExtent?: SongExtent | null;
    // Cycle/Loop, user-set, default OFF. Only consulted for a document with a
    // definite end; everything else already loops.
    stopAtEnd?: boolean;
  }>>(new Map());
  // Latest-value ref so the content-change subscription (#457, below) can read
  // the active file's play/live state without re-binding the subscription on
  // every state change.
  const runtimeStatesRef = useRef(runtimeStates);
  runtimeStatesRef.current = runtimeStates;

  // #977 — eval-on-load. Populate the runtime's song patterns from a REAL
  // evaluate before republishing the timeline snapshot, so the Song timeline's
  // pre-play marks come from eval haps (display-faithful) instead of the collect
  // interpreter. Gated LAZY: only when the timeline is visible AND the runtime
  // is stopped — play() keeps song patterns fresh itself, and evaluating for an
  // off-screen timeline is wasted work. evaluateForTimeline is itself
  // stopped-gated and serialized with play(), so a Play pressed mid-refresh is
  // race-safe. The snapshot publish is UNCONDITIONAL: it drives both the
  // timeline re-query and the IR inspector, which want it regardless of eval.
  // ⚠ That sentence used to be a claim only — the publish sat after an
  // unbounded await, so a hung evaluate silently cancelled it (#1193). It is
  // now enforced by the helper below rather than asserted here.
  const refreshTimelineMarks = useCallback(async (fid: string) => {
    const rt = runtimesRef.current.get(fid);
    const st = runtimeStatesRef.current.get(fid);
    // #1193/#1221 — the wait-then-publish ORDERING lives in one tested unit
    // (`publishSnapshotAfterBoundedEval`), because that ordering is what broke
    // and inline here nothing could reach it. What is decided here is only
    // WHETHER an eval is wanted; the publish is the helper's to sequence, and
    // it runs on every path including a hung one.
    const evalRuntime =
      rt && !st?.isPlaying && isSongTimelineVisible() ? rt : null;
    await publishSnapshotAfterBoundedEval({
      evaluate: evalRuntime ? () => evalRuntime.evaluateForTimeline() : null,
      publish: () =>
        captureAndPublishSnapshot(
          fid,
          runtimesRef.current.get(fid)?.getCurrentCycle?.() ?? null,
          rt ?? null,
        ),
      waitMs: TIMELINE_EVAL_WAIT_MS,
    });
  }, []);

  // #457 — keep the Song timeline + IR Inspector snapshot in sync with the
  // SOURCE while the runtime isn't live-evaluating. The snapshot is otherwise
  // republished only on a successful eval (onEvaluateSuccess) or on song-view
  // entry (#394), so a code edit with no re-eval — every edit while stopped,
  // since nothing auto-evaluates — left the timeline frozen at the last eval.
  // subscribeToWorkspaceFile fires on BOTH typing and Pattern-panel write-backs
  // (both mutate the workspace file); captureAndPublishSnapshot is pure on the
  // source string (and a no-op for non-Strudel files), so it's safe off the
  // eval lifecycle. Skipped while live-coding (playing && autoRefresh): there
  // the runtime's own debounced re-eval owns the snapshot, so republishing here
  // would double-publish and flash a mid-keystroke broken parse.
  useEffect(() => {
    const fid = watchedFileId;
    if (!fid) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    // #611 — publish a SOURCE snapshot the moment a Strudel file becomes active,
    // so the Song timeline renders from the source even before the first eval.
    // The subscription below only fires on a CHANGE; eval (onEvaluateSuccess) and
    // song-view entry (#394) are the only other triggers — so a freshly-opened,
    // never-evaluated file showed "press play" (the on-mount #394 request races
    // the active-file/file-store hydration and no-ops). Capture is pure on the
    // source string, so it's safe off the eval lifecycle; the same eval-owns-it
    // guard skips it while live-coding (the runtime's re-eval owns the snapshot).
    const st0 = runtimeStatesRef.current.get(fid);
    if (!(st0?.isPlaying && st0.autoRefresh)) {
      void refreshTimelineMarks(fid);
    }
    const unsub = subscribeToWorkspaceFile(fid, () => {
      const st = runtimeStatesRef.current.get(fid);
      if (st?.isPlaying && st.autoRefresh) return; // eval-path owns it
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        void refreshTimelineMarks(fid);
      }, SNAPSHOT_REFRESH_DEBOUNCE_MS);
    });
    return () => {
      if (timer) clearTimeout(timer);
      unsub();
    };
  }, [watchedFileId, refreshTimelineMarks]);

  const getOrCreateRuntime = useCallback((fileId: string): LiveCodingRuntime | null => {
    if (runtimesRef.current.has(fileId)) return runtimesRef.current.get(fileId)!;
    const file = getFile(fileId);
    if (!file) return null;
    const provider = getRuntimeProviderForLanguage(file.language);
    if (!provider) return null;

    const engine = provider.createEngine();
    // Pass the workspace-file subscriber so the runtime's live mode can
    // hook into content changes for debounced re-evaluate. The subscription
    // is installed lazily inside the runtime — no cost until live mode is
    // toggled on.
    const runtime = new LiveCodingRuntime(
      fileId,
      engine,
      // #204 time-travel: when a commit is checked out, the runtime evaluates
      // its snapshot content; falls back to live Y.Text when not viewing.
      // S5 solo: the Mixer's eval-source transform (solo overlay) is applied
      // here — identity unless a strip is soloed, so the file is never touched
      // (D3) and normal playback is byte-for-byte unchanged.
      () =>
        applyEvalSourceTransform(
          fileId,
          getViewedContent(fileId) ?? getFile(fileId)?.content ?? "",
        ),
      (cb) => subscribeToWorkspaceFile(fileId, cb),
    );

    runtime.onPlayingChanged((playing: boolean) => {
      setRuntimeStates(prev => {
        const next = new Map(prev);
        const cur = next.get(fileId) ?? { isPlaying: false, error: null, autoRefresh: false };
        next.set(fileId, { ...cur, isPlaying: playing, bpm: runtime.getBpm() });
        return next;
      });
    });
    runtime.onError((err: Error) => {
      // A required boot step failed — the engine cannot start, and nothing the
      // user does in the editor will change that (#1218). The console row and
      // toast below still happen, because they are where a developer looks;
      // this adds the one surface that carries the only action that works.
      reportBootFailure(err);
      setRuntimeStates(prev => {
        const next = new Map(prev);
        const cur = next.get(fileId) ?? { isPlaying: false, error: null, autoRefresh: false };
        next.set(fileId, { ...cur, error: err });
        return next;
      });
      // Pipe into the shared event store so toast / status-bar / console
      // panel / Monaco markers can all react. Runtime identity comes from
      // the workspace file's language (strudel | sonicpi — no other
      // languages are wired to LiveCodingRuntime today).
      const fileNow = getFile(fileId);
      const runtimeId: RuntimeId = fileNow?.language === "sonicpi" ? "sonicpi" : "strudel";
      const index: DocsIndex = runtimeId === "sonicpi" ? SONICPI_DOCS_INDEX : STRUDEL_DOCS_INDEX;
      // Phase 20-14 β-5 — pull the per-eval alias resolutions off the
      // engine instance (StrudelEngine-only — duck-typed so non-Strudel
      // engines harmlessly pass `undefined`). The friendly-error builder
      // appends "tried alias `kick` → `bd`" on the resolved path and
      // "alias map: no entry for `xyz`" on the miss path.
      const engineWithAlias = engine as unknown as {
        getLastAliasResolutions?: () => ReadonlyArray<{ from: string; to: string }>;
      };
      const aliasResolutions = engineWithAlias.getLastAliasResolutions?.();
      const parts = formatFriendlyError(err, runtimeId, {
        index,
        aliasContext: runtimeId === "strudel"
          ? { resolutions: aliasResolutions, lookupAlias: resolveAlias }
          : undefined,
      });
      // Strudel routes user code through `@strudel/transpiler`, which
      // rewrites `$:` sugar into method calls and wraps everything in
      // an async IIFE. The resulting wrapper offset is NOT constant —
      // it depends on how many `$:` lines the user has and which
      // transpiler rules fire — so a naive offset constant (like p5's
      // or Hydra's) would drift per sketch. We deliberately drop
      // `parts.line` here: the Console row + toast still surface the
      // error, and the engineLogMarkers bridge's out-of-range guard
      // keeps a bogus stack line from painting the whole file.
      // Sonic Pi's Ruby errors carry user-file lines natively, so the
      // same treatment isn't needed there — but the runtime dispatch
      // here doesn't distinguish, and dropping the line for Sonic Pi
      // is the conservative default until we wire a Ruby-aware
      // line extractor.
      //
      // #567 — per-hap runtime errors (soundfont out-of-range) have a
      // bundle-only stack, so `parts.line` is absent anyway. The engine tags
      // them with the offending INSTRUMENT; locate the owning track's statement
      // (`statementOffsetForSource`) and convert its char offset → 1-based
      // line/column by counting newlines in the file content. This location is
      // RELIABLE (a real source offset), so unlike the dropped transpiler-wrapper
      // line it's safe to feed the marker bridge → squiggle on the right line.
      let locatedLine: number | undefined;
      let locatedColumn: number | undefined;
      const locateSource = (err as Error & { staveLocateSource?: string })
        .staveLocateSource;
      const src = fileNow?.content;
      if (typeof locateSource === "string" && typeof src === "string") {
        const offset = statementOffsetForSource(src, locateSource);
        if (offset != null) {
          const before = src.slice(0, offset);
          locatedLine = before.split("\n").length; // 1-based
          locatedColumn = offset - before.lastIndexOf("\n"); // 1-based
        }
      }
      // Parser SYNTAX errors embed an offset-free "(line:col)" in the message
      // (acorn reports the USER's original coordinates — verified line-accurate,
      // e.g. line 5 → "(5:11)"). This is safe to feed the marker bridge + toast,
      // unlike the transpiler-wrapper stack line dropped above. Range-check
      // against the file so a stray trailing "(n:n)" in some other message can't
      // point at a nonexistent line.
      if (locatedLine == null && typeof src === "string") {
        const msgLoc = parseMessageLocation(parts.message);
        if (msgLoc && msgLoc.line >= 1 && msgLoc.line <= src.split("\n").length) {
          locatedLine = msgLoc.line;
          locatedColumn = msgLoc.column;
        }
      }
      emitLog({
        level: "error",
        runtime: runtimeId,
        source: fileNow?.path ?? fileId,
        message: parts.message,
        suggestion: parts.suggestion,
        stack: parts.stack,
        line: locatedLine,
        column: locatedLine != null ? locatedColumn : parts.column,
      });
    });
    // Live-mode re-eval has no user-driven play() to clear the error state,
    // so a transient syntax error stays visible until stop+play. Clearing on
    // every successful evaluate gives the "fix-and-continue" flow its natural
    // feedback: marker appears while broken, disappears the moment it parses.
    runtime.onEvaluateSuccess((evaluatedCode: string) => {
      // #1388 — does this document END? Measured off the EXACT code that was
      // just evaluated, not a fresh `getFile()` read: that content is a lagging
      // snapshot racing the next eval, and an extent measured from the wrong
      // revision would stop the song at the previous arrangement's length.
      // Language-gated exactly like the bounce's structural parse — `parseStrudel`
      // reads its input as JS, so pointing it at a Sonic Pi buffer could in
      // principle find an `arrange(...)` that means nothing there.
      // Cheap enough to do per eval (pure, on a source string) and NOT done in
      // the watcher's poll loop, which runs ~20x a second.
      const evalLanguage = getFile(fileId)?.language;
      const nextExtent: SongExtent | null =
        evalLanguage !== "sonicpi" ? songExtent(parseStrudel(evaluatedCode)) : null;

      setRuntimeStates(prev => {
        const next = new Map(prev);
        const cur = next.get(fileId) ?? { isPlaying: false, error: null, autoRefresh: false };
        // Refresh BPM on every successful eval (#599): the chrome's tempo was
        // only set on play/stop transitions (onPlayingChanged), so a live
        // `setcps` edit never updated the readout until stop+play. getBpm()
        // reflects the just-evaluated code. Keep the no-op fast path when
        // nothing the chrome renders (error / bpm) actually changed.
        const nextBpm = runtime.getBpm();
        // The extent joins the no-op fast path (#1388): without it a live edit
        // that only changed the ARRANGEMENT would keep the previous length,
        // because neither the error nor the BPM moved — and the song would then
        // stop at the length it used to have.
        if (
          cur.error === null &&
          cur.bpm === nextBpm &&
          sameExtent(cur.songExtent, nextExtent)
        ) {
          return prev;
        }
        next.set(fileId, { ...cur, error: null, bpm: nextBpm, songExtent: nextExtent });
        return next;
      });
      // Record a fix marker so the Console panel's Live mode can hide
      // any log entry emitted before this clean eval. Non-destructive —
      // history stays intact for users who want the full trail.
      const fileNow = getFile(fileId);
      const runtimeId: RuntimeId = fileNow?.language === "sonicpi" ? "sonicpi" : "strudel";
      emitFixed({ runtime: runtimeId, source: fileNow?.path ?? fileId });
      // Per-eval commit (file-history Phase F, #196 / RESEARCH Q1): an eval is
      // an intentional checkpoint, so capture the state that produced this
      // sound — bypassing the significance floor. No-op if nothing changed
      // since HEAD, so frequent live-mode re-evals stay cheap.
      // Paused while time-travelling (#204 Decision D): the re-eval that
      // enters/exits a view fires onEvaluateSuccess, but the view must never
      // drive a commit (it would just capture live state at a confusing time).
      if (!isViewing()) {
        void commitWorkspace("auto", { gate: false }).catch((err) =>
          console.warn("[stave] eval commit failed:", err),
        );
      }

      // IR Inspector snapshot — only meaningful for Strudel today.
      // parseStrudel + collect are pure and cheap on the user's source
      // string; published via the irInspector store so the panel can
      // re-render without coupling to the editor lifecycle. `source`
      // is the workspace fileId (NOT the human-visible path) because
      // revealLineInFile keys by id; the Inspector's click-to-source
      // handler depends on this lookup matching.
      if (runtimeId === "strudel" && fileNow) {
        // IR Inspector + full-song timeline snapshot. Factored into
        // captureAndPublishSnapshot (module scope) so the on-demand
        // song-view path (#394) publishes the identical shape — no drift.
        // Phase 19-08: cycleCount lands on the timeline capture entry (not on
        // IRSnapshot) so PV27's per-snapshot alias contract stays untouched.
        captureAndPublishSnapshot(fileId, runtime.getCurrentCycle(), runtime);

        // Prune orphaned per-track colour overrides (#583): drop TrackMeta
        // records whose track no longer exists in the evaluated code, so a
        // deleted track's custom colour can't leak in the per-file Y.Map or
        // resurrect onto a shifted positional d{N}. Uses the EXACT code the
        // runtime just evaluated (passed to the callback) — NOT a fresh
        // getFile() read, which lags the live Y.Text and races the next eval.
        // Skipped while time-travelling — the viewed historical code has a
        // different track set (mirrors the commit guard above); the helper also
        // no-ops on an empty track set so a transient eval can never wipe colours.
        if (!isViewing()) {
          pruneTrackMetaForCode(fileId, evaluatedCode);
        }

        // Code-driven backdrop — a non-underscore viz method (`.scope()`,
        // `.pianoroll()`, …) maps to Stave's backdrop; its absence clears it.
        // Code is the source of truth, so we forward on EVERY eval (null
        // included) — removing the method un-pins the backdrop on next eval.
        // StaveApp resolves the id to a viz file (or clears) and the "set bg"
        // UI auto-updates. Idempotent on StaveApp's side (no churn in live mode).
        onCodeBackdropChangeRef.current?.(runtime.getBackdropVizRequest());
      }
    });
    runtime.onAutoRefreshChanged((enabled: boolean) => {
      setRuntimeStates(prev => {
        const next = new Map(prev);
        const cur = next.get(fileId) ?? { isPlaying: false, error: null, autoRefresh: false };
        next.set(fileId, { ...cur, autoRefresh: enabled });
        return next;
      });
    });

    runtimesRef.current.set(fileId, runtime);
    // #977 — seed a default (stopped) state entry the moment the runtime exists.
    // The runtime otherwise gains a `runtimeStates` entry only lazily, on its
    // first play/eval/error event — so pre-play the active-runtime accessor
    // builder saw `runtimeStates.get(fid)` undefined and wired NULL accessors,
    // leaving the Song timeline unable to read the eval haps eval-on-load had
    // populated. Seeding here keeps runtimeStates consistent with runtimesRef,
    // AND the state change re-triggers the accessor builder when the runtime is
    // created after the active file is already set.
    //
    // #979 — but getOrCreateRuntime is invoked DURING render (`chromeForTab`, in
    // WorkspaceShell's render) as well as from handlers/effects, so seeding
    // synchronously would call setState during another component's render (React
    // cross-component update warning). Defer it to a microtask — a post-render
    // side effect — guarded on the ref so the per-render call from chromeForTab
    // neither loops nor schedules repeatedly, and idempotent so a race is a no-op.
    if (!runtimeStatesRef.current.has(fileId)) {
      queueMicrotask(() => {
        setRuntimeStates((prev) => {
          if (prev.has(fileId)) return prev;
          const next = new Map(prev);
          next.set(fileId, { isPlaying: false, error: null, autoRefresh: false });
          return next;
        });
      });
    }
    return runtime;
  }, []);

  // Cleanup all runtimes on unmount
  useEffect(() => () => {
    runtimesRef.current.forEach(rt => rt.dispose());
    runtimesRef.current.clear();
  }, []);

  // #204 time-travel: on checkout enter/exit/swap, re-evaluate every PLAYING
  // runtime so audio + inline viz reflect the swapped content. The content
  // source now reads getViewedContent first, so play() re-evals the snapshot
  // (or live, on exit). Non-playing runtimes are left alone — checkout must
  // never auto-start audio.
  useEffect(
    () =>
      subscribeToRuntimeView(() => {
        runtimesRef.current.forEach((rt) => {
          if (rt.getIsPlaying()) void rt.play();
        });
      }),
    [],
  );

  // Live visual editing (Mixer S3 → all Pattern-tab surfaces): a visual mutation
  // (mixer fader/pan/mute, sequencer step, piano-roll note, knob, …) writes the
  // file via `Writeback`, which asks here to make it audible immediately. We
  // re-eval ONLY if the file is already playing (so a control never auto-starts
  // audio) AND only when live mode isn't already re-evaluating on its own (no
  // double eval). `rt.play()` while playing re-evals (same as the checkout path).
  // `rt.play()` is async and does NOT serialise — firing it for each of a burst
  // of edits lets an earlier eval resolve last and clobber the final state. So
  // we serialise per file: while a re-eval is in flight, mark the file pending;
  // when it settles, if still pending, re-eval ONCE more reading the now-current
  // content. The final state always wins, with no long debounce.
  const reevalState = useRef<Map<string, { inFlight: boolean; pending: boolean }>>(new Map());
  useEffect(
    () =>
      registerReevalHandler((fileId: string) => {
        const rt = runtimesRef.current.get(fileId);
        if (!(rt && rt.getIsPlaying() && !rt.isAutoRefreshEnabled())) return;
        const st = reevalState.current.get(fileId) ?? { inFlight: false, pending: false };
        reevalState.current.set(fileId, st);
        if (st.inFlight) { st.pending = true; return; }
        const run = (): void => {
          // Re-check the play gate on every (re)entry, not just at the handler
          // top. A Stop can land while a re-eval is in flight; the pending loop
          // below would otherwise call rt.play() again and restart playback
          // right after Stop (#811). rt.play() has no "still playing?" guard of
          // its own — this is the only place that gate belongs.
          if (!(rt.getIsPlaying() && !rt.isAutoRefreshEnabled())) {
            st.pending = false;
            st.inFlight = false;
            return;
          }
          st.pending = false;
          st.inFlight = true;
          Promise.resolve(rt.play()).finally(() => {
            st.inFlight = false;
            if (st.pending) run();
          });
        };
        run();
      }),
    [],
  );

  // ── Shell callbacks ─────────────────────────────────────────────────

  const handlePlay = useCallback((fileId: string) => {
    const rt = getOrCreateRuntime(fileId);
    if (!rt) return;
    setRuntimeStates(prev => {
      const next = new Map(prev);
      const cur = prev.get(fileId) ?? { isPlaying: false, error: null, autoRefresh: false };
      next.set(fileId, { ...cur, error: null });
      return next;
    });
    rt.play();
  }, [getOrCreateRuntime]);

  const handleStop = useCallback((fileId: string) => {
    const rt = runtimesRef.current.get(fileId);
    if (rt) rt.stop();
  }, []);

  // #1388, inverted by #1396 — Cycle/Loop. Per file, user-set, default OFF,
  // and OFF now means LOOPING: an arranged song repeats unless the user asks it
  // to stop. Only reachable from the chrome for a document that HAS a definite
  // end, so a stray toggle cannot put an endless document into a state that
  // means nothing.
  const handleToggleStopAtEnd = useCallback((fileId: string) => {
    setRuntimeStates(prev => {
      const next = new Map(prev);
      const cur = prev.get(fileId) ?? { isPlaying: false, error: null, autoRefresh: false };
      next.set(fileId, { ...cur, stopAtEnd: !cur.stopAtEnd });
      return next;
    });
  }, []);

  // #1388 — PLAYBACK THAT ENDS. Before this, nothing in the app compared the
  // song's length against the clock, so an arranged song wrapped and restarted
  // forever; the gap was found by listening to a bounce, not by reading code.
  //
  // Every ingredient already existed and was simply never brought together —
  // the extent (measured on eval, above), the transport-offset-aware position
  // (the same clock the playhead is drawn from) and Stop. The decision itself
  // lives in `songTermination` so it can be driven by a test without a
  // scheduler; this effect is only the sampler.
  //
  // ⚠ A TIMER, NOT `requestAnimationFrame`. The playhead's rAF loop is the
  // obvious host and it is the wrong one twice over: rAF is suspended in a
  // background tab (a song left playing in another tab would never end) and it
  // is gated on the timeline drawer being open, which has nothing to do with
  // whether a song should stop.
  //
  // ⚠ AND IT ONLY EXISTS WHILE SOMETHING IS PLAYING. An unconditional 50ms
  // interval is the tightest timer in the app (the timeline's polls are 250ms
  // and 500ms) and it would wake twenty times a second forever, on a stopped
  // editor, to discover there is nothing to stop. Gating on `anyPlaying` costs
  // one re-created watcher per transport transition — and a fresh watcher is
  // what a new run wants anyway, since its first sample must re-baseline.
  const anyPlaying = [...runtimeStates.values()].some((st) => st.isPlaying);
  useEffect(() => {
    if (!anyPlaying) return;
    const watcher = createEndOfSongWatcher({
      playingFileIds: () => {
        const ids: string[] = [];
        for (const [fid, st] of runtimeStatesRef.current) {
          if (st.isPlaying) ids.push(fid);
        }
        return ids;
      },
      extentOf: (fid) => runtimeStatesRef.current.get(fid)?.songExtent ?? null,
      positionOf: (fid) =>
        runtimesRef.current.get(fid)?.getSongPosition?.() ?? null,
      isStopAtEnd: (fid) =>
        runtimeStatesRef.current.get(fid)?.stopAtEnd ?? false,
      // The same Stop the transport button issues — one path stops a file, so
      // the runtime teardown, the bus unpublish and the playing-state edge all
      // happen exactly as they do when the user presses the button.
      stop: handleStop,
    });
    const id = setInterval(() => watcher.tick(), END_OF_SONG_POLL_MS);
    return () => clearInterval(id);
  }, [anyPlaying, handleStop]);

  // Live-mode toggle. The runtime owns the subscription + debounce; we
  // just flip the flag and let runtime.onAutoRefreshChanged drive the
  // React state update (handled by the listener registered in
  // getOrCreateRuntime). Creating the runtime lazily here covers the
  // case where the user toggles live mode before pressing Play — the
  // runtime exists, the flag is set, and the first play() wires the
  // subscription.
  const handleToggleAutoRefresh = useCallback((fileId: string) => {
    const rt = getOrCreateRuntime(fileId);
    if (!rt) return;
    rt.setAutoRefresh(!rt.isAutoRefreshEnabled());
  }, [getOrCreateRuntime]);

  // chromeForTab: runtime chrome for pattern files only. Viz editor chrome
  // (Preview / Background / Save) is resolved by WorkspaceShell's internal
  // fallback via `previewProviderFor` — that path already wires Cmd+K V / B
  // through `executeCommand`, and the Save button is wired via the
  // `onSaveFile` prop below. Handling it here too would duplicate the
  // command plumbing and lose the shell's active-group context.
  const chromeForTab = useCallback((tab: WorkspaceTab) => {
    if (tab.kind !== "editor") return undefined;
    const file = getFile(tab.fileId);
    if (!file) return undefined;

    const runtimeProvider = getRuntimeProviderForLanguage(file.language);
    if (!runtimeProvider) return undefined;

    const rt = getOrCreateRuntime(tab.fileId);
    if (!rt) return undefined;
    const state = runtimeStates.get(tab.fileId) ?? {
      isPlaying: false, error: null, autoRefresh: false,
    };
    // #347 — per-tab "set bg" dropdown. Pinned state + filename come from THIS
    // tab's backdrop (tabBackdrops), so other tabs read their own. The button
    // opens the BackdropPopover (rendered at the component root) anchored to
    // itself and scoped to this tab's file id.
    const tabBg = tabBackdrops.get(tab.fileId) ?? null;
    const ctx: ChromeContext = {
      runtime: rt,
      file,
      isPlaying: state.isPlaying,
      error: state.error,
      bpm: state.bpm,
      onPlay: () => handlePlay(tab.fileId),
      onStop: () => handleStop(tab.fileId),
      autoRefresh: state.autoRefresh,
      onToggleAutoRefresh: () => handleToggleAutoRefresh(tab.fileId),
      // #1388 — the toggle is offered ONLY for a document that HAS an end to
      // stop at. `hasDefiniteEnd` is the same predicate the watcher stops on,
      // so the set of documents showing the button and the set of documents
      // that CAN end are the same set by construction — they cannot drift into
      // a button that does nothing, or a song that ends with no way to ask it
      // not to. #1396 inverted which way the button starts, not which
      // documents it appears on.
      stopAtEnd: state.stopAtEnd ?? false,
      onToggleStopAtEnd: hasDefiniteEnd(state.songExtent)
        ? () => handleToggleStopAtEnd(tab.fileId)
        : undefined,
      chromeExtras: (
        <>
          {/* #755 — ruler units moved into Settings › Pattern & Timeline. */}
          <SetBackdropButton
            pinned={tabBg != null}
            fileName={backdropName(tabBg)}
            onOpen={(rect) => setBgPopover({ rect, fileId: tab.fileId })}
          />
        </>
      ),
    };
    return runtimeProvider.renderChrome(ctx);
  }, [getOrCreateRuntime, runtimeStates, handlePlay, handleStop, handleToggleAutoRefresh, handleToggleStopAtEnd, tabBackdrops, backdropName]);

  // onSaveFile: Cmd+S / Save button handler. For viz files, flush the
  // current in-memory content back to VizPresetStore via the bridge,
  // then re-register the named viz so pattern files referencing it by
  // name pick up the new code on their next evaluate.
  //
  // For pattern files, no-op for now (pattern files aren't persisted
  // to IndexedDB in 10.2 — that's Phase 10.3's VirtualFileSystem job).
  const handleSaveFile = useCallback(
    (tab: WorkspaceTab & { kind: "editor" }) => {
      const file = getFile(tab.fileId);
      if (!file) return;

      // Only viz files (.p5 / .hydra / .glsl) get flushed to a preset.
      if (!isVizLanguage(file.language)) return;

      // Use existing presetId, or auto-generate one for manually created
      // viz files so they become available to `.viz("name")`.
      let presetId = getPresetIdForFile(file);
      if (!presetId) {
        const baseName = file.path.replace(/\.[^.]+$/, "");
        presetId = `user_${baseName.replace(/[^a-zA-Z0-9]/g, "_")}`;
      }

      flushToPreset(file.id, presetId)
        .then(() => VizPresetStore.get(presetId))
        .then((preset) => {
          if (preset) registerPresetAsNamedViz(preset);
        })
        .catch((err) => {
          console.warn("[stave] flushToPreset failed:", err);
        });
    },
    [],
  );

  // E2E hook (dev/test only) — fire the REAL save for a viz file by id WITHOUT a
  // tab switch, so the inline-viz hot-reload gate (viz-hot-reload.spec.ts) can
  // exercise the save→repaint path with the pattern editor MOUNTED throughout
  // (PV89). Mirrors the WorkspaceShell Cmd+S → onSaveFile(tab) path. Same
  // dead-code-eliminated gate as the other `__stave*` hooks.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (process.env.NODE_ENV === "production") return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (!(window as any).__STAVE_E2E__) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__staveSaveVizFileById = (fileId: string): boolean => {
      if (!getFile(fileId)) return false;
      handleSaveFile({ kind: "editor", fileId } as WorkspaceTab & {
        kind: "editor";
      });
      return true;
    };
  }, [handleSaveFile]);

  // E2E-only handle onto the three audio-bounce paths (#1344/#1345/#1346).
  // Same dead-code-eliminated gate as the other `__stave*` hooks — both checks
  // live inside installBounceProbe, which returns its own teardown.
  useEffect(() => installBounceProbe(), []);

  // #1502 — a project's own audio is addressable before the user does anything.
  //
  // Records live in the project Y.Doc, bytes live content-addressed in IDB, and
  // neither is any use to `s("my_take")` until the pair has been handed to
  // superdough. This is where that happens: keyed on `projectId`, so switching
  // projects registers the new project's takes rather than leaving the previous
  // one's names resolving.
  //
  // Safe to run at mount without checking `isDocReady`: EditorWrapper awaits
  // `initProjectDoc` before this component is rendered at all, so the doc has
  // already synced and a read here cannot race the persisted state.
  //
  // Best-effort by design — `registerAssets` skips any record whose bytes the
  // browser has evicted rather than registering a URL that 404s on the first
  // note, and returns the names that did resolve.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const records = listAssetRecords();
      if (records.length === 0 || cancelled) return;
      try {
        const names = await registerAssets(records);
        // #1506 — decode what registered so each take can DRAW its waveform
        // before anything has played it. Local bytes only (these are `blob:`
        // URLs out of IndexedDB), and after the cancellation check, so closing a
        // project mid-load does not warm audio nobody is looking at.
        if (!cancelled) await warmWaveforms(names);
      } catch {
        /* a project whose assets cannot register still opens */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  // E2E-only handle onto the binary asset store (#1500). Phase 1 ships no UI
  // on purpose, so there is no gesture that could drive the store — this is
  // the only instrument the "survives a reload and plays" claim has.
  useEffect(() => installAssetProbe(), []);

  // editorExtrasForTab: play/stop keybindings + error squiggles
  const editorExtrasForTab = useCallback((tab: WorkspaceTab & { kind: "editor" }) => {
    const file = getFile(tab.fileId);
    if (!file) return undefined;
    const provider = getRuntimeProviderForLanguage(file.language);
    if (!provider) return undefined;

    const state = runtimeStates.get(tab.fileId) ?? {
      isPlaying: false, error: null, autoRefresh: false,
    };
    return {
      // Ctrl+Enter EVALUATES, including while playing — it must not toggle
      // (#180). `runtime.play()` re-evaluates the current file on every call,
      // applying the edit at the next cycle boundary. Stop stays on Ctrl+.;
      // the transport BUTTON is unaffected because it selects onStop itself
      // when playing.
      onPlay: () => handlePlay(tab.fileId),
      onStop: () => handleStop(tab.fileId),
      error: state.error,
    };
  }, [runtimeStates, handlePlay, handleStop]);

  // previewProviderFor: preview provider resolution for viz tabs
  const previewProviderFor = useCallback((tab: WorkspaceTab & { kind: "preview" }): PreviewProvider | undefined => {
    const file = getFile(tab.fileId);
    if (!file) return undefined;
    return getPreviewProviderForLanguage(file.language) ?? undefined;
  }, []);

  // onTabClose: dispose runtime when pattern tab is closed (U3)
  const handleTabClose = useCallback((closingTab: WorkspaceTab) => {
    if (closingTab.kind !== "editor") return;
    const rt = runtimesRef.current.get(closingTab.fileId);
    if (rt) {
      rt.dispose();
      runtimesRef.current.delete(closingTab.fileId);
      setRuntimeStates(prev => {
        const next = new Map(prev);
        next.delete(closingTab.fileId);
        return next;
      });
    }
  }, []);

  // Seed the shell's initial state from persistence (issue #175). The
  // shell reads these props exactly once on mount; after that we drive
  // add/remove imperatively so create/delete in the sidebar doesn't blow
  // away the whole tab layout.
  //
  // Strategy:
  //   1. Read the project's persisted shell state, validated against
  //      the live workspace files. Stale fileIds are pruned; if
  //      nothing usable remains, the loader returns null.
  //   2. On null, build a SANE DEFAULT — one group with a single tab
  //      pointing at the project's Strudel file (if any), else an
  //      empty group. This replaces the previous "open ALL 11 files"
  //      behavior that overwhelmed new visitors.
  //
  // Reading happens inside a `useRef` initializer so it runs exactly
  // once per mount and survives every re-render without re-seeding.
  const initialSnapshot = useRef<ShellSnapshot>(
    (() => {
      const files = listWorkspaceFiles();
      const validIds = new Set(files.map((f) => f.id));
      const persisted = loadShellState(projectId, validIds);
      if (persisted) return hydrateSnapshot(persisted);
      // First load (or wiped persistence) → single Strudel tab.
      const strudelFile = files.find((f) => f.language === "strudel") ?? files[0];
      return buildDefaultSnapshot("g-main", strudelFile?.id ?? null);
    })(),
  ).current;

  // Incremental sync: watch the file list and route adds to
  // openOrFocusFile, deletes to closeTabsForFile. The shell mounts once
  // and mutates in place — no flash, no tab-set churn.
  //
  // Critical: seed prevFileIdsRef from the LIVE workspace, NOT from the
  // initial tab set. If we seeded from tabs, the very first subscribe
  // fire would see every workspace file that isn't yet a tab as "added"
  // and auto-open them all — re-creating the 11-tab problem under a
  // different code path. Files added AFTER mount (user-created in the
  // sidebar) still flow through openOrFocusFile as intended.
  const prevFileIdsRef = useRef<Set<string>>(
    new Set(listWorkspaceFiles().map((f) => f.id)),
  );
  useEffect(() => {
    return subscribeToFileList(() => {
      const current = new Set(listWorkspaceFiles().map((f) => f.id));
      const prev = prevFileIdsRef.current;
      const added: string[] = [];
      const removed: string[] = [];
      for (const id of current) if (!prev.has(id)) added.push(id);
      for (const id of prev) if (!current.has(id)) removed.push(id);
      prevFileIdsRef.current = current;
      const handle = shellRef?.current;
      if (!handle) return;
      for (const id of removed) handle.closeTabsForFile(id);
      for (const id of added) handle.openOrFocusFile(id);
    });
  }, [shellRef]);

  // Whenever runtimeStates change for the currently-active fileId, push
  // the fresh state up to the status bar. Tracked separately from tab
  // switches because `play` / `stop` / error events mutate runtimeStates
  // without changing the active tab.
  const activeFileIdRef = useRef<string | null>(null);

  // #1346 — publish the bounce handle to StaveApp. Both reads go through refs
  // (`activeFileIdRef`, `runtimesRef`) rather than state, so the handle stays
  // correct across tab switches without re-running this effect and without
  // StaveApp ever holding an engine. Deliberately resolves the active file at
  // CALL time: a bounce started from the menu should record the tab that is
  // active when the user confirms, not the one that was active at mount.
  useEffect(() => {
    if (!bounceRef) return;
    const activeRuntime = (): LiveCodingRuntime | null => {
      const fid = activeFileIdRef.current;
      if (!fid) return null;
      return runtimesRef.current.get(fid) ?? null;
    };
    const handle: BounceHandle = {
      canBounce: () => activeRuntime()?.canRecord() ?? false,
      bounce: async (seconds, signal, onCaptureStart) => {
        const rt = activeRuntime();
        if (!rt) return null;
        return rt.record(seconds, signal, onCaptureStart);
      },
      songSizing: async (signal) => {
        const fid = activeFileIdRef.current;
        const rt = fid ? (runtimesRef.current.get(fid) ?? null) : null;
        // ⚠ TWO IRs, TWO QUESTIONS (#1373). "Does this document END?" and
        // "what does it REPEAT at?" come from different pipelines, and only one
        // of them can answer each. See `SongIRs` for the measured divergence.

        // STRUCTURE, from this file's own text. The published snapshot cannot
        // answer it: its final pass leaves a top-level `arrange(...)` as an
        // opaque `Code`, so it returned `loop` for every document ever bounced
        // and the `arranged` branch never fired in the running app.
        // `parseStrudel` is pure and cheap on the source, and falls back to a
        // Code node rather than throwing.
        // Language-gated like `publishIRSnapshot` does: `parseStrudel` reads
        // its input as JS, so pointing it at a Sonic Pi buffer could in
        // principle find an `arrange(...)` that means nothing there.
        const fileNow = fid ? getFile(fid) : null;
        const structuralIr =
          fileNow && fileNow.language !== "sonicpi"
            ? parseStrudel(fileNow.content)
            : null;

        // MEASUREMENT, from the snapshot — its lane keys match the runtime
        // accessors the collector below is threaded with.
        // ⚠ ONE snapshot store, one snapshot. `source` is the fileId that
        // published it, and the bounce deliberately resolves its file at CALL
        // time — so without this equality the modal could size a bounce of THIS
        // tab by the IR of whichever tab last evaluated. A mismatch is treated
        // as no document rather than as a length, because a wrong length is
        // silent: the WAV is still valid, just not the song.
        const snap = getIRSnapshot();
        const analysisIr = snap && fid && snap.source === fid ? snap.ir : null;
        const length = await measureSongLength(
          { structural: structuralIr, analysis: analysisIr },
          {
            songExtent,
            analyzeSong,
            // #1465 — read off the IR here because only a caller holds one.
            signalDimensionsOf,
            // The SHARED factory the timeline uses, threaded with this file's
            // accessors — not a second collector, whose key space would drift.
            createCollector: (nodeIr) =>
              createSongCollector(nodeIr, {
                getTimelineEvents: (cycles: number) =>
                  runtimesRef.current.get(fid!)?.getTimelineEvents?.(cycles) ?? [],
                getTimelineEventsBand: (startCycle: number, endCycle: number) =>
                  runtimesRef.current
                    .get(fid!)
                    ?.getTimelineEventsBand?.(startCycle, endCycle) ?? [],
                getSongTrackIds: () =>
                  runtimesRef.current.get(fid!)?.getSongTrackIds?.() ?? [],
              }),
          },
          signal,
        );
        return { length, cps: rt?.getCps() ?? null };
      },
    };
    bounceRef.current = handle;
    return () => {
      if (bounceRef.current === handle) bounceRef.current = null;
    };
  }, [bounceRef]);

  // #977 — visibility poll for eval-on-load. The snapshot cadence effect covers
  // file switches + edits, and onRequestSnapshot covers a cold song-view entry —
  // but opening the timeline on an already-active, unedited, stopped file whose
  // collect snapshot already exists fires none of those, AND on boot the cadence
  // effect runs BEFORE the idle warm-up has created the runtime (so it skips the
  // eval). Visibility is polled localStorage (no change event). One interval per
  // active file (re-created on switch via the `watchedFileId` dep); the `evaled`
  // latch fires it exactly ONCE — the moment the file is visible + stopped + its
  // runtime exists — then stops. Edits re-eval through the cadence effect.
  useEffect(() => {
    const fid = watchedFileId;
    if (!fid) return;
    const id = setInterval(() => {
      if (!isSongTimelineVisible()) return;
      const rt = runtimesRef.current.get(fid);
      const st = runtimeStatesRef.current.get(fid);
      if (!rt || st?.isPlaying) return; // wait for the runtime; play owns it
      clearInterval(id); // fire exactly once, then stop the timer
      void refreshTimelineMarks(fid);
    }, TIMELINE_VISIBILITY_POLL_MS);
    return () => clearInterval(id);
  }, [refreshTimelineMarks, watchedFileId]);

  useEffect(() => {
    if (!onActiveRuntimeStateChange) return;
    const fid = activeFileIdRef.current;
    if (!fid) return;
    const st = runtimeStates.get(fid);
    if (!st) {
      onActiveRuntimeStateChange(null);
      return;
    }
    // Phase 20-01 PR-B (DB-01) — pass live accessors that read through
    // runtimesRef so the closures stay valid across active-tab swaps
    // without re-registering the bottom-panel content.
    const accessorFid = fid;
    onActiveRuntimeStateChange({
      fileId: fid,
      isPlaying: st.isPlaying,
      bpm: st.bpm,
      error: st.error ? st.error.message : null,
      getCycle: () =>
        runtimesRef.current.get(accessorFid)?.getCurrentCycle?.() ?? null,
      getCps: () => {
        const bpm = runtimesRef.current.get(accessorFid)?.getBpm?.();
        // cps = bpm / (60 sec/min * 4 beats/cycle).
        return bpm != null && Number.isFinite(bpm) ? bpm / 240 : null;
      },
      getHapStream: () =>
        runtimesRef.current.get(accessorFid)?.getHapStream?.() ?? null,
      // #861 — evaluated timeline events for the full-song DISPLAY marks.
      // Closure-bound through runtimesRef like getHapStream.
      getTimelineEvents: (cycles: number) =>
        runtimesRef.current.get(accessorFid)?.getTimelineEvents?.(cycles) ?? [],
      // #1197 — the banded form, from the SAME runtime as the prefix form above
      // so a caller can never mix frames between the two.
      getTimelineEventsBand: (startCycle: number, endCycle: number) =>
        runtimesRef.current.get(accessorFid)?.getTimelineEventsBand?.(startCycle, endCycle) ?? [],
      // #1107 — the registered track ids, read from the same runtime as the
      // events above so the two can never describe different track sets.
      getSongTrackIds: () =>
        runtimesRef.current.get(accessorFid)?.getSongTrackIds?.() ?? [],
      // #384/#385 — transport seek accessors. Closure-bound through
      // runtimesRef like getHapStream; seekTo is fire-and-forget here (the
      // full-song ruler doesn't await the re-eval — clock + playhead reflect
      // it on the next rAF tick).
      getSongPosition: () =>
        runtimesRef.current.get(accessorFid)?.getSongPosition?.() ?? null,
      onSeek: (cycle: number) => {
        void runtimesRef.current.get(accessorFid)?.seekTo?.(cycle);
      },
      // #394 — publish the active file's IR for the full-song view on demand.
      // #977 — routed through refreshTimelineMarks so a cold song-view entry (or
      // a page that loads with the timeline already open) also populates eval
      // haps before the snapshot publish. The timeline is visible when it makes
      // this request, so the lazy-visibility gate inside passes.
      onRequestSnapshot: () => {
        void refreshTimelineMarks(accessorFid);
      },
      // Phase 20-07 wave γ (R-2) — Inspector accessors. Mirror getHapStream's
      // closure shape so they read through runtimesRef on every invocation.
      getBreakpointStore: () =>
        runtimesRef.current.get(accessorFid)?.getBreakpointStore?.() ?? null,
      getIsPaused: () =>
        runtimesRef.current.get(accessorFid)?.getPaused?.() ?? false,
      onResume: () => {
        runtimesRef.current.get(accessorFid)?.resume?.();
      },
      onPauseChanged: (cb) =>
        runtimesRef.current.get(accessorFid)?.onPausedChanged?.(cb) ??
        (() => {}),
    });
    // #977 — also re-run when the active file is set (watchedFileId), not only
    // on runtimeStates changes. On boot the runtime registers (runtimeStates
    // changes) BEFORE the active tab activates, so this builder ran with a null
    // active fid and returned early, leaving the timeline-events accessor unwired
    // until the first Play. Keying on watchedFileId rewires the accessor the
    // moment there's an active file — so pre-play eval marks can be read.
  }, [runtimeStates, onActiveRuntimeStateChange, refreshTimelineMarks, watchedFileId]);

  // #813 — Eager engine warm-up so the instrument picker is fully populated
  // before the user presses Play. The picker reads superdough's global
  // `soundMap`, which is published only when an engine initializes — and init
  // is lazy (first Play). Without this, opening the picker on a fresh page
  // shows only the ~27-item curated fallback. We create the active (or first)
  // Strudel file's runtime and `init()` it on idle: init only registers sounds
  // and fetches sample manifests — no scheduler.start(), and it creates the
  // AudioContext suspended, so no user gesture is needed and no audio plays.
  // The runtime + init are idempotent, so a later Play reuses this same warmed
  // runtime (soundMap is a superdough module singleton — warming any one
  // Strudel engine fills every picker). Runs once; retries via the file-list
  // subscription because files load async (IDB) and may be absent at mount.
  const warmedRef = useRef(false);
  useEffect(() => {
    const tryWarm = () => {
      if (warmedRef.current) return;
      const active = activeFileIdRef.current;
      const fid =
        active && getFile(active)?.language === "strudel"
          ? active
          : listWorkspaceFiles().find((f) => f.language === "strudel")?.id ??
            null;
      if (!fid) return; // no Strudel file yet — the subscription retries
      warmedRef.current = true;
      const warm = () => {
        void getOrCreateRuntime(fid)
          ?.init()
          // Warm-up is best-effort for everything EXCEPT a required boot step
          // (#1218): that one means the engine cannot start at all, and this is
          // usually the first place on the page to learn it — a bare swallow
          // here is why a dead engine used to reach the user as silence. The
          // notice fires once per document; anything else stays best-effort.
          .catch((err: unknown) => {
            reportBootFailure(err);
          });
      };
      const w = window as unknown as {
        requestIdleCallback?: (cb: () => void) => number;
      };
      if (typeof w.requestIdleCallback === "function") w.requestIdleCallback(warm);
      else window.setTimeout(warm, 0);
    };
    tryWarm(); // files already present at mount (warm start / cached project)
    return subscribeToFileList(tryWarm); // or when they finish loading
  }, [getOrCreateRuntime]);

  // Persist on every shell mutation (#175). Fires reactively from the
  // shell's single onGroupsChange sink; no debounce — localStorage
  // writes are O(1) and the snapshot is small.
  const handleGroupsChange = useCallback(
    (snapshot: ShellSnapshot) => {
      saveShellState(projectId, snapshot);
    },
    [projectId],
  );

  return (
    <>
    <WorkspaceShell
      ref={shellRef}
      initialGroups={initialSnapshot.groups}
      initialLayout={initialSnapshot.layout}
      initialActiveGroupId={initialSnapshot.activeGroupId}
      onGroupsChange={handleGroupsChange}
      theme={resolvedTheme}
      height="100%"
      onNewFile={() => void promptAndCreateFile("")}
      chromeForTab={chromeForTab}
      editorExtrasForTab={editorExtrasForTab}
      previewProviderFor={previewProviderFor}
      onTabClose={handleTabClose}
      onSaveFile={handleSaveFile}
      onTabContextMenu={onTabContextMenu}
      onEditViz={onEditViz}
      onCropViz={onCropViz}
      onCropBackdrop={() => onCropBackdrop?.()}
      onRevealBackdrop={() => onRevealBackdrop?.()}
      onBackgroundFileChange={handleBackgroundFileChange}
      onActiveBackdropChange={onActiveBackdropChange}
      onOpenPopoutPreview={handleOpenPopout}
      backgroundCrop={backgroundCrop}
      onActiveTabChange={(tab) => {
        const fid =
          tab && (tab.kind === "editor" || tab.kind === "preview")
            ? tab.fileId
            : null;
        // #977 — this event-time ref latch is now read by the eval-on-load
        // visibility/accessor hooks, which makes the React-Compiler immutability
        // rule flag this (pre-existing, safe) assignment. The write happens in a
        // user-event callback, never during render, so it cannot break memoization.
        // eslint-disable-next-line react-hooks/immutability
        activeFileIdRef.current = fid;
        // #347 — per-tab backdrop: swap the active group's backdrop to the new
        // active tab's stored choice (or clear when it has none). This is what
        // makes the backdrop follow the tab instead of bleeding across the pane.
        shellRef?.current?.setBackgroundFile?.(
          fid ? tabBackdrops.get(fid) ?? null : null,
        );
        setWatchedFileId(fid);
        onActiveFileChange?.(fid);
        if (!onActiveRuntimeStateChange) return;
        if (!fid) {
          onActiveRuntimeStateChange(null);
          return;
        }
        const st = runtimeStates.get(fid);
        if (!st) {
          onActiveRuntimeStateChange(null);
          return;
        }
        // Phase 20-01 PR-B (DB-01) — same accessor wiring as the
        // useEffect above; both sites push state to the parent so any
        // call must include the cycle/cps closures.
        const accessorFid = fid;
        onActiveRuntimeStateChange({
          fileId: fid,
          isPlaying: st.isPlaying,
          bpm: st.bpm,
          error: st.error ? st.error.message : null,
          getCycle: () =>
            runtimesRef.current
              .get(accessorFid)
              ?.getCurrentCycle?.() ?? null,
          getCps: () => {
            const bpm = runtimesRef.current
              .get(accessorFid)
              ?.getBpm?.();
            return bpm != null && Number.isFinite(bpm) ? bpm / 240 : null;
          },
          getHapStream: () =>
            runtimesRef.current
              .get(accessorFid)
              ?.getHapStream?.() ?? null,
          // #861 — evaluated timeline events for the full-song DISPLAY marks
          // (same closure shape as the useEffect builder above).
          getTimelineEvents: (cycles: number) =>
            runtimesRef.current
              .get(accessorFid)
              ?.getTimelineEvents?.(cycles) ?? [],
          // #1197 — the banded form (same shape as the builder above).
          getTimelineEventsBand: (startCycle: number, endCycle: number) =>
            runtimesRef.current
              .get(accessorFid)
              ?.getTimelineEventsBand?.(startCycle, endCycle) ?? [],
          // #1107 — registered track ids (same shape as the builder above).
          getSongTrackIds: () =>
            runtimesRef.current.get(accessorFid)?.getSongTrackIds?.() ?? [],
          // #384/#385 — transport seek accessors (same shape as the
          // useEffect builder above).
          getSongPosition: () =>
            runtimesRef.current
              .get(accessorFid)
              ?.getSongPosition?.() ?? null,
          onSeek: (cycle: number) => {
            void runtimesRef.current.get(accessorFid)?.seekTo?.(cycle);
          },
          // #394 — on-demand snapshot capture (same shape as the useEffect
          // builder above). #977 — via refreshTimelineMarks so a cold entry
          // populates eval haps before the publish (visibility gate passes).
          onRequestSnapshot: () => {
            void refreshTimelineMarks(accessorFid);
          },
          // Phase 20-07 wave γ (R-2) — Inspector accessors. Mirrors the
          // useEffect closure builder above; both push the same shape to
          // the parent on every active-tab transition.
          getBreakpointStore: () =>
            runtimesRef.current
              .get(accessorFid)
              ?.getBreakpointStore?.() ?? null,
          getIsPaused: () =>
            runtimesRef.current
              .get(accessorFid)
              ?.getPaused?.() ?? false,
          onResume: () => {
            runtimesRef.current
              .get(accessorFid)
              ?.resume?.();
          },
          onPauseChanged: (cb) =>
            runtimesRef.current
              .get(accessorFid)
              ?.onPausedChanged?.(cb) ?? (() => {}),
        });
      }}
    />
    {bgPopover &&
      (
        <BackdropPopover
          anchorRect={bgPopover.rect}
          onClose={() => setBgPopover(null)}
          vizFiles={listWorkspaceFiles()
            .filter((f) => isVizLanguage(f.language))
            .map((f) => ({
              id: f.id,
              name: f.path.split("/").pop()!.replace(/\.[^.]+$/, ""),
            }))}
          backgroundFileId={tabBackdrops.get(bgPopover.fileId) ?? null}
          backgroundFileName={backdropName(
            tabBackdrops.get(bgPopover.fileId) ?? null,
          )}
          onSetBackdrop={(id) => {
            // Record against the tab the popover was opened from, and (since
            // that tab is the active one) drive the active group's backdrop.
            recordTabBackdrop(bgPopover.fileId, id);
            shellRef?.current?.setBackgroundFile?.(id);
            // #792 — ALSO write the choice into the document as
            // all(x=>x.viz("name",{backdrop:true})), so the global backdrop
            // round-trips to code (portable with the file, editable as text).
            writeBackdropToCode(id);
          }}
          onCropBackground={() => onCropBackdrop?.()}
          onRevealBackground={() => onRevealBackdrop?.()}
          initialOpacity={shellRef?.current?.getBackdropSettings?.().opacity ?? 1}
          initialQuality={
            shellRef?.current?.getBackdropSettings?.().quality ?? "half"
          }
          onSetOpacity={(v) => shellRef?.current?.setBackdropOpacity?.(v)}
          onSetQuality={(v) => shellRef?.current?.setBackdropQuality?.(v)}
          vizSpan={getBackdropVizSpan()}
          onSetVizSpan={(v) => setBackdropVizSpan(v)}
        />
      )}
    {/* #240 — viz pop-out window. Mounted only while open; unmount/onClose
        closes the window via the hook's cleanup. */}
    {popout && (
      <PopoutPreviewController
        key={popout.fileId}
        descriptor={popout.descriptor}
        theme={resolvedTheme}
        onClose={() => setPopout(null)}
      />
    )}
    </>
  );
}
