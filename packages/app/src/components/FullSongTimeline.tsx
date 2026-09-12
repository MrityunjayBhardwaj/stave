/**
 * FullSongTimeline — the navigable whole-song view (#385, design §7.5).
 *
 * Audience: MUSICIAN (PV35). Vocabulary discipline (PV32 / D-06) applies to
 * every visible string — "SONG", "CYCLES", section numbers only.
 *
 * Distinct concern from the live 2-cycle monitor in MusicalTimeline: this is a
 * zoomed-out map of the ENTIRE song (one detected loop period, or the analyzed
 * horizon when no period exists). It renders a per-lane onset heatmap across
 * `[0, displayCycles)`, section chips on the ruler, and a SCRUBBABLE playhead.
 *
 * Seek (relaxes DV-10 — the read-only-playhead veto): clicking the ruler or
 * grid inverts the song axis to a target cycle and calls `onSeek`, which the
 * runtime turns into a transport seek (`seekTo` → `.late` wrap re-eval, #384).
 * The playhead reads `getSongPosition` (transport-offset-aware), NOT the raw
 * window clock, so it tracks the sought position. This is a deliberate, scoped
 * revision of DV-10 (live window stays read-only; full-song view is drivable).
 *
 * Data: consumes a `SongAnalysis` computed by MusicalTimeline from the IR
 * snapshot via `analyzeSong`. Lanes key on `trackId ?? s ?? '$default'` — the
 * same identity the live view's rows use — so the two views line up.
 */
'use client'

import * as React from 'react'


import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { SongAnalysis, PatternIR, HapStream, IREvent, OffsetEdit } from '@stave/editor'
import {
  captionRows,
  captionHit,
  captionEdit,
  AUTOMATION_LABEL_FONT,
  type CaptionHit,
} from './musicalTimeline/automationCaption'
import { automationColorOnLane } from './musicalTimeline/colors'
import { DEFAULT_THEME } from './SongTimelineCanvas'
import type { WaveformSource } from './musicalTimeline/drawTimeline'

/**
 * Measure caption text in the caption's own face (#1464 Stage 2).
 *
 * The hit-test needs the same widths the canvas drew with, and it runs outside
 * the draw. One offscreen context, created once and kept, gives exactly that:
 * the same font string measured by the same engine. `captionHit` takes this as
 * an argument rather than owning it, so the geometry stays pure and testable
 * with an arithmetic-legible stand-in.
 *
 * Returns 0 if a 2D context is unavailable (jsdom without a canvas shim), which
 * collapses every field box to zero width — a hit-test that finds nothing rather
 * than one that finds the wrong thing.
 */
let captionMeasureCtx: CanvasRenderingContext2D | null | undefined
function measureCaption(text: string): number {
  if (captionMeasureCtx === undefined) {
    const c = typeof document === 'undefined' ? null : document.createElement('canvas')
    captionMeasureCtx = c?.getContext('2d') ?? null
    if (captionMeasureCtx) captionMeasureCtx.font = AUTOMATION_LABEL_FONT
  }
  if (!captionMeasureCtx) return 0
  return captionMeasureCtx.measureText(text).width
}

import {
  structuralWalk,
  wholeWalkWindow,
  getMusicalTimelineSubRowHeight,
  onMusicalTimelineSubRowHeightChange,
} from '@stave/editor'
import { SongTimelineLiveOverlay } from './SongTimelineLiveOverlay'
import { paletteForTrack, trackIndexOf } from './musicalTimeline/colors'
import { buildTimelineScene, clipAtCycle, type SceneActivity } from './musicalTimeline/timelineScene'
import {
  nextWindowOriginFor,
  clampSeekToWindow,
  isBeyondWindow,
  windowNotice,
} from './musicalTimeline/windowPaging'
import { TrackSwatchPopover } from './TrackSwatchPopover'
import { useRulerUnits } from '../state/rulerUnits'
import { useDisplayMeter } from '../state/displayMeter'
import {
  applyStableVoiceOrder,
  EMPTY_VOICE_ORDER,
  type VoiceOrderByLane,
} from './musicalTimeline/stableVoiceOrder'
import { collectNoteMarks, readEventsInBand } from './musicalTimeline/timelineMarks'
import { declaredTracks } from './musicalTimeline/trackOrder'
import { signalAutomations, type SignalAutomation } from '@stave/editor'
import { computeLaneLayout, laneAtY, type LaneLayout } from './musicalTimeline/laneLayout'
import {
  markRegionValue,
  regionEdgeAt,
  regionValueAtDrag,
  type RegionEdgeHit,
  type RegionSide,
} from './musicalTimeline/regionEdge'
import {
  loadTimelineCamera,
  saveTimelineCamera,
} from './musicalTimeline/timelineCameraPersistence'
import { SongTimelineCanvas } from './SongTimelineCanvas'
import {
  songCycleToX,
  // The UNCLAMPED map, because the region hit test has to agree with the
  // renderer pixel-for-pixel and `drawTimeline` uses this one — the clamped
  // variant would pile every off-screen mark onto the viewport edge and make
  // marks grabbable where none is drawn.
  songCycleToXUnclamped,
  xToSongCycle,
  trimExtent,
  wrapSongPosition,
  clampZoom,
  clampRestoreZoom,
  contentWidthFor,
  scrollLeftForZoom,
  followScrollLeft,
  rulerTicks,
  MIN_ZOOM,
  ZOOM_STEP,
  type SongWindow,
} from './musicalTimeline/songAxis'

const TAB_ID = 'musical-timeline'
/** How long a manual scroll/seek suspends follow (#415), so auto-scroll never
 *  fights the user mid-gesture, then resumes once they've settled. */
const USER_SCROLL_GUARD_MS = 1200
const CONTROLS_HEIGHT = 26
const TOPBAR_HEIGHT = 28
const GUTTER_WIDTH = 90
/** Height of an expanded ("accordion") lane — tall enough for the read-only
 *  note detail (pitch spread + per-beat grid) to be legible (#422, design §4.5). */
const EXPANDED_ROW_HEIGHT = 96
/** Content-px grip zone around a clip's right edge that arms a trim drag (#437). */
const CLIP_EDGE_GRIP_PX = 6
/** Pointer travel (px) before a clip-body press becomes a MOVE drag rather than a
 *  click (select/seek). Below this it stays a click so seek-anywhere is intact. */
const CLIP_MOVE_THRESHOLD_PX = 4
const FONT_MONO = 'var(--font-mono), ui-monospace, monospace'

export interface FullSongTimelineProps {
  /** Whole-song analysis, or null before the first analysis completes. */
  readonly analysis: SongAnalysis | null
  /**
   * The activity of the PAGED window, or null while showing the song's own
   * first span (#1201).
   *
   * Deliberately narrower than the analysis: only the scene follows the
   * window. The view's SPAN, whether that span loops, and the readout are
   * properties of the SONG and keep reading `analysis` — a window has no
   * period to answer them with, and must never invent one.
   */
  readonly windowActivity?: SceneActivity | null
  /** First song cycle currently on screen. 0 until something pages. */
  readonly windowOriginCycles?: number
  /**
   * Ask the owner to page to `[originCycle, originCycle + spanCycles)`.
   *
   * Travels UPWARD, the same direction as `onSeek`, because the analysis and
   * its collector live with the owner. Called on a frame condition that stays
   * true for many frames, so it must be idempotent by origin on the far side.
   */
  readonly onRequestWindow?: (originCycle: number, spanCycles: number) => void
  /** The evaluated IR snapshot — source of the mini-note marks the canvas draws
   *  (collected app-side over the display span). Null before the first eval. */
  readonly ir?: PatternIR | null
  /** The raw user source (`snapshot.code`) — read at each lane's `dollarPos` to
   *  resolve a NAMED track's display LABEL (#579 STEP 2). Null/absent → every
   *  lane keeps its positional `d{N}` name (pre-STEP-2 behaviour). */
  readonly source?: string | null
  /** Live hap stream accessor — drives the per-note LIVE overlay (#500/U3): the
   *  hap stream lights scene marks under the following playhead. Optional — the
   *  overlay simply never lights when unset (the static scene still renders). */
  readonly getHapStream?: () => HapStream | null
  /** #861 — evaluated per-track note events over `[0, ceil(cycles))` for the
   *  eval-backed DISPLAY marks. When present, the canvas note marks come from
   *  these haps (Strudel has already resolved pitch/scale — `n("0 2 4").scale(…)`
   *  → `note:"C3"…`), attributed to IR lanes by source containment; the IR still
   *  owns lanes/clips (structure). Absent / returns `[]` (pre-eval, non-Strudel)
   *  → the static-IR marks fallback (source-lossy for degree/scale — PV174). */
  readonly getTimelineEvents?: (cycles: number) => IREvent[]
  /**
   * #1197 — the BANDED form of the accessor above: haps over
   * `[startCycle, endCycle)` rather than a prefix from zero.
   *
   * This is the one the marks want (#1209). A paged view asking the prefix form
   * for `[256, 512)` has to request `[0, 512)` and throw half of it away, which
   * is exactly the cost the band accessor was introduced to remove. Optional —
   * without it the marks fall back to the prefix form, which returns the right
   * events after querying every cycle to the window's left: slow when paged,
   * never wrong.
   */
  readonly getTimelineEventsBand?: (startCycle: number, endCycle: number) => IREvent[]
  /** Transport-offset-aware song position (cycles), or null when stopped. */
  /** Decoded-audio lookup for the waveform tier (#1506). Passed straight through
   *  to the canvas: this component owns no audio, and injecting it rather than
   *  importing keeps the engine out of a module the renderer tests mock. */
  readonly waveforms?: WaveformSource
  /** Bumped when new audio becomes drawable, so the dirty-flagged canvas redraws
   *  for a reason it could not otherwise see (#1506). */
  readonly waveformsEpoch?: number
  readonly getSongPosition: () => number | null
  /** Seek the transport to an absolute song cycle. */
  readonly onSeek: (cycle: number) => void
  /** Drawer open state — gates the rAF playhead loop (Trap NEW-1 parity). */
  readonly getDrawerOpen: () => boolean
  /** Active tab id — must equal the timeline tab for the rAF loop to run. */
  readonly getActiveTabId: () => string | null
  /** Bind a clicked lane into the Pattern panel (#422, design §3.1). Receives the
   *  lane's representative source-character offset (or null when the IR has no
   *  source provenance). The parent maps it to a line and moves the editor
   *  cursor, which re-detects the active chunk and rebinds the Sequencer/Piano
   *  Roll. Optional — the view degrades to display-only when unset. */
  readonly onBindLane?: (sourceOffset: number | null) => void
  /** Rename a lane's track (#580, Phase C). Receives the lane's STATEMENT offset
   *  (`labelOffset` = `dollarPos`), the new label, and the lane's OLD display name
   *  (Phase D, #581 — so the parent can MIGRATE a custom-colour override keyed by
   *  the old name to the new one). The parent detects the chunk at the offset and
   *  writes the `name:` label into the code. Optional — the lane name is read-only
   *  when unset, or when a lane has no `labelOffset`. */
  readonly onRenameLane?: (
    labelOffset: number,
    newLabel: string,
    oldDisplayName: string,
  ) => void
  /** Select a lane → jump the editor to that track's code (#610, twin of the
   *  Mixer's strip cursor-follow #595/#596). Receives the lane's STATEMENT offset
   *  (`labelOffset` = the `$:`/`name:` head, the same anchor the Mixer reveals to);
   *  the parent maps it to a line and reveals it. Unlike `onBindLane` this does NOT
   *  toggle expansion or rebind the Pattern panel — it is a pure "go to this track".
   *  Optional — the header is not a jump target when unset. */
  readonly onSelectLane?: (statementOffset: number) => void
  /** Caret-driven lane selection (#641). The statement head offset of the track
   *  the editor caret currently sits in (the Mixer's selection bus, V-mixer-18);
   *  the lane whose `labelOffset` matches is highlighted. `null` → no lane
   *  selected (caret outside any track, or in another file). */
  readonly selectedStatementOffset?: number | null
  /** Per-track custom colour overrides (Phase D, #581), keyed by lane DISPLAY
   *  NAME. Resolved through the shared `trackIdentity` into `lane.color`, so it
   *  drives the lane dot AND the canvas density bars. Absent → deterministic
   *  palette. */
  readonly customColorByName?: ReadonlyMap<string, string>
  /** Set a track's custom colour (Phase D, #581). Receives the lane's DISPLAY
   *  NAME (the override key) + the chosen hex. The parent writes it to the
   *  per-file `TrackMeta` store. Optional — without it the lane dot is not a
   *  colour-picker trigger (display-only). */
  readonly onSetTrackColor?: (displayName: string, color: string) => void
  /** Clear a track's custom colour → fall back to the palette (Phase D, #581).
   *  Receives the lane's DISPLAY NAME. */
  readonly onResetTrackColor?: (displayName: string) => void
  /** Display names of tracks that read as silenced — muted, or dimmed by a solo
   *  elsewhere (#731). Their lane (gutter row + canvas band) draws FADED, keyed by
   *  the same display name the Mixer dims by, so a solo/mute shows identically in
   *  both views (PV155). Absent → nothing faded. */
  readonly silencedNames?: ReadonlySet<string>
  /** Edit an automation's bounds from its lane caption (#1464 Stage 2 — the
   *  range control). Receives a source edit the caption module built and a
   *  gesture name for the write seam's refusal reporting. Optional — without it
   *  the captions stay read-only, exactly as Stage 1 left them, and no caption
   *  claims a pointer. */
  readonly onEditAutomation?: (edit: OffsetEdit, gesture: string) => void
  /** Trim a clip by dragging its right edge (Phase 5b, #437). Receives the
   *  clip's lane source anchor (an offset inside the combinator call), its arm
   *  index, and the new whole-cycle weight. The parent parses the arrangement at
   *  the anchor and writes a surgical set-weight edit. Optional — without it the
   *  clips stay read-only (no trim grips). Only real `arrange`/`cat` arms
   *  (`armIndex ≥ 0`) are trimmable; a bare track's implicit clip is not. */
  readonly onTrimClip?: (req: {
    sourceOffset: number | null
    armIndex: number
    weight: number
  }) => void
  /** Trim the SLICE OF THE FILE a sample mark plays, by dragging the mark's own
   *  edge on an expanded lane (#1527). The left edge moves `begin`, the right
   *  edge moves `end`; the parent resolves the lane anchor to a chunk and writes
   *  `.begin(0.25)`, appending the call when the document does not have one.
   *
   *  ⚠ A DIFFERENT GESTURE FROM `onTrimClip`, ON DELIBERATELY DIFFERENT PIXELS.
   *  That one drags a CLIP's edge and changes how many bars an arrangement arm
   *  lasts; this one drags a MARK's edge and changes which part of a sample file
   *  is heard. Clip edges keep precedence where the two are within a few pixels
   *  of each other — the arrangement gesture is the established one, and a mark
   *  landing exactly on an arm boundary is rare.
   *
   *  `playing` is what the ENGINE resolved this mark to play, and the parent
   *  must check it against what the chunk's text says before writing: a lane's
   *  source anchor can resolve to an expression that does not own the region
   *  (`const vox = s("take")` / `$: vox.begin(0.1)` resolves to the const),
   *  where an append would edit a shared binding the outer call then overrides.
   *  Optional — without it, mark edges are inert. */
  readonly onTrimRegion?: (req: {
    /** Lane anchors to try IN ORDER, until one resolves to a chunk that agrees
     *  with `playing`. The statement anchor comes first and the innermost
     *  content anchor second, which is measured rather than guessed: for
     *  `const vox = s("take")` / `$: vox.begin(0.1)` the content anchor lands on
     *  the const (no region on it) and the statement anchor lands on the track
     *  that owns the region; for an unlabelled bare expression there is no
     *  statement anchor at all and only the content one exists. */
    anchors: readonly number[]
    side: RegionSide
    value: number
    playing: { begin: number; end: number }
  }) => void
  /** Delete a clip (Phase 5c, #386). Fired when a selected clip is removed
   *  (click a clip to select, then Delete/Backspace). Receives the clip's lane
   *  source anchor + arm index; the parent parses the arrangement at the anchor
   *  and writes a surgical remove-arm edit. Optional — without it clips can't be
   *  selected/deleted. A combinator's SOLE remaining arm is not deletable
   *  (a lane keeps ≥1 clip, PV122 #5); the serializer no-ops that case.
   *  #489 — for a bare track's implicit clip (`armIndex < 0`) Delete carves a
   *  GAP at the SELECTED bar: `barIndex` is the clicked whole-cycle and `span`
   *  the loop's floored display width, so the parent materializes
   *  `arrange([…, pat], [1, silence], […, pat])`. Real arms ignore both. */
  readonly onDeleteClip?: (req: {
    sourceOffset: number | null
    armIndex: number
    barIndex?: number
    span?: number
  }) => void
  /** Move a clip by dragging its body horizontally (Phase 5c, #386). Only a REAL
   *  arrange/cat arm is movable: `reorder` swaps it to a new slot in the
   *  combinator (`reorderArm(fromIndex → toIndex)`). Clip time-order = arm order
   *  (PV122 #1). A bare track's implicit clip (`armIndex < 0`) is NOT movable —
   *  a uniform pattern tiles every cycle identically, so dragging it would swap
   *  identical content (an identity); injecting a leading `silence` to "place" it
   *  invents a gap the source never had (#488). Starting an arrangement from a
   *  bare pattern is an explicit action (type `arrange(...)`), not a drag. The
   *  parent resolves the anchor and writes the surgical edit. Optional — without
   *  it clips can't be dragged (trim/select/delete still work). */
  readonly onMoveClip?: (
    req: { kind: 'reorder'; sourceOffset: number | null; fromIndex: number; toIndex: number },
  ) => void
  /** Duplicate a clip (Phase 5c, #386). Fired on ⌘/Ctrl-D with a clip selected:
   *  insert a verbatim clone of the arm right after it (`insertArm`). Receives the
   *  clip's lane source anchor + arm index. Real arms only — a bare track's
   *  implicit clip has no arm to clone. Optional. */
  readonly onDuplicateClip?: (req: {
    sourceOffset: number | null
    armIndex: number
  }) => void
  /** Split a clip (Phase 5c, #386). Fired on `S` with a clip selected: slice the
   *  arm at a whole-cycle boundary into two (`splitArm`). `firstWeight` is the
   *  first half's cycle count (the gesture uses the clip midpoint). Only a clip
   *  spanning ≥ 2 cycles is splittable. For a bare track's implicit clip
   *  (`armIndex < 0`) `span` is the clip's whole-song length, so the parent can
   *  MATERIALIZE the loop into `arrange([firstWeight, pat], [span−firstWeight, pat])`
   *  (#489). Real arms ignore `span` (the parser supplies the arm weight). Optional. */
  readonly onSplitClip?: (req: {
    sourceOffset: number | null
    armIndex: number
    firstWeight: number
    span: number
  }) => void
  /** RIPPLE-delete a clip (#1460). Fired on Cmd/Ctrl+Shift+Delete with a clip
   *  selected: remove the arm outright and close the gap after it, so the song
   *  gets SHORTER. The second of two delete gestures, and the distinction is the
   *  whole feature — plain Delete clears a clip and leaves the hole, because an
   *  arrangement timeline is absolute and later clips are pinned to their own
   *  positions in time. Every DAW checked separates the two the same way and
   *  gives the ripple its own name and its own chord; none of them puts it on
   *  the bare Delete key.
   *
   *  Real arms only. A bare track's implicit clip (`armIndex < 0`) has no arm to
   *  remove and rippling it out would empty the track, so the gesture is not
   *  offered there. A combinator's SOLE remaining arm is likewise refused by the
   *  serializer — a lane keeps at least one clip.
   *
   *  Optional. Without it the chord does nothing at all, which is deliberate:
   *  falling through to plain Delete would make an unbound chord silently edit
   *  the arrangement, which is the defect the duplicate binding already had. */
  readonly onRippleDeleteClip?: (req: {
    sourceOffset: number | null
    armIndex: number
  }) => void
  /** INSERT SILENCE after a clip (#1461). Fired on Cmd/Ctrl+I with a clip
   *  selected: add a new, EMPTY section directly after it, exactly as wide.
   *
   *  ⚠ THIS WRITES TIME, NOT CONTENT, which is what makes it a different gesture
   *  from duplicate rather than a worse one. Duplicate hands you a copy of
   *  something that plays; this makes room in the song for something that does
   *  not exist yet. The DAW command it mirrors is called Insert Silence for the
   *  same reason, and sits on this same chord.
   *
   *  Real arms only — a bare track has no arm to take a width from. Optional. */
  readonly onInsertSilenceClip?: (req: {
    sourceOffset: number | null
    armIndex: number
  }) => void
  /** Rename a SECTION (#1417 Stage 3). Fired on F2 or Enter with a clip
   *  selected, committed from an input drawn over the clip's own rect.
   *
   *  ⚠ THE TWO SPELLINGS RENAME DIFFERENT THINGS, and the parent routes to the
   *  right primitive. In `arrange(...)` the section name IS a top-level binding,
   *  so the rename moves its declaration and every reference. In the pick family
   *  it is an object KEY and no binding is touched. Same gesture, opposite edit.
   *
   *  Real arms only — a bare clip has no section to name. Optional. */
  readonly onRenameSection?: (req: {
    sourceOffset: number | null
    armIndex: number
    newName: string
  }) => void
  /** How many sections a rename of this clip would move (#1417).
   *
   *  ⚠ ASKED BEFORE THE WRITE, WHICH IS THE POINT. A returning chorus is ONE
   *  pattern arranged twice, so renaming it moves every arm that names it — the
   *  honest edit, and one the user has to be told about while they can still
   *  change their mind. Returns 0 when the rename would decline, so the hint and
   *  the write can never disagree. Optional; without it no count is shown. */
  readonly sectionArmCount?: (req: {
    sourceOffset: number | null
    armIndex: number
  }) => number
}

/** A bare loop's single implicit clip spans the SONG, not just its one-cycle
 *  period — so it has room to be split into addressable bars (#489 D3). A pure
 *  bare song (no `arrange`/`cat` combinator) is floored to this many cycles;
 *  extensible later via #487. A real arrangement already defines its own span. */
const MIN_BARE_SPAN = 4

/** The smallest span a user may SHRINK a bare loop to by dragging its edge
 *  (#662). Two cycles keeps Split possible (a split needs ≥ 2 to yield two
 *  non-empty arms). Once the user has resized, this clamp — not `MIN_BARE_SPAN`
 *  — is the floor, so a tight 2-bar working area is reachable. */
const MIN_BARE_SPLIT_SPAN = 2

/** The natural display span: one loop period, or the analyzed horizon. ≥ 1.
 *  The choice between those two is the ANALYSIS's to make and it already made
 *  it — this only applies the floor. */
function naturalSpan(analysis: SongAnalysis | null): number {
  if (!analysis) return 1
  return Math.max(1, analysis.displaySpan.cycles)
}

/** Display span in cycles. The natural span, but a pure bare loop is floored to
 *  `MIN_BARE_SPAN` so its single implicit clip is splittable (#489 D3). A real
 *  arrangement keeps its own length — flooring a period-2 arrange to 4 would paint
 *  empty bars past the last arm. ≥ 1.
 *
 *  `bareSpanOverride` is the user's resized span (#662, option B): a view-only
 *  preference that grows/shrinks the displayed bars with NO code write-back. When
 *  set it REPLACES the `MIN_BARE_SPAN` floor with the shrinkable `MIN_BARE_SPLIT_SPAN`
 *  clamp (so a 2-bar working area is reachable), but never drops below the true
 *  content period (`natural`) — you can't show fewer bars than one full loop. */
function displaySpan(
  analysis: SongAnalysis | null,
  bareSong: boolean,
  bareSpanOverride?: number | null,
): number {
  const natural = naturalSpan(analysis)
  if (!bareSong) return natural
  if (bareSpanOverride != null) {
    return Math.max(MIN_BARE_SPLIT_SPAN, natural, Math.round(bareSpanOverride))
  }
  return Math.max(MIN_BARE_SPAN, natural)
}

/** Cycles of empty timeline kept PAST the dragged edge while EXTENDING the last
 *  clip, so there's always room to drag into (#487). Transient — present only
 *  mid-drag; at rest the span is exactly the song (no permanent blank). */
const EXTEND_MARGIN_CYCLES = 2
/** Viewport-right band (px) where a live extend drag auto-scrolls more empty
 *  timeline into view (classic drag-edge autoscroll). */
const EXTEND_AUTOSCROLL_BAND_PX = 48
/** Max px the autoscroll advances per frame while the cursor is held in the band
 *  — a deliberate, controllable pace (~7px/frame ≈ 420px/s at 60fps), not a rush. */
const EXTEND_AUTOSCROLL_STEP_PX = 7

export function FullSongTimeline(props: FullSongTimelineProps): React.ReactElement {
  const { analysis, onSeek } = props
  const windowActivity = props.windowActivity ?? null
  // A pure bare loop gets a floored, splittable display span (#489 D3); a real
  // arrangement keeps its own length. "Bare" = NO collected event carries an
  // `armIndex` (no `arrange`/`cat` combinator). We probe over the natural span so
  // an arrange whose first cycles are silent still registers its later arms. This
  // reads the runtime collector (mockable, so the gesture tests stay correct) —
  // NOT the raw IR shape, which tests pass opaquely.
  const natCycles = naturalSpan(analysis)
  const bareSong = useMemo(() => {
    if (props.ir == null) return false
    // Structure-only probe (#974): "bare" = NO arrange/cat combinator. A lane carries
    // `armByCycle` iff an event under it had an `armIndex` (an arrangement arm) — the
    // structural walk sets it from the same source structure `collectCycles` did, so this is
    // the byte-identical successor to the old `evs.some(e => armIndex)` check, without needing
    // the behaviour engine and resilient on mid-edit code.
    // Deliberately the WHOLE song, at every page (#1209): "does this document
    // contain an arrangement at all" is a property of the DOCUMENT, and it
    // decides the display span — so a window in which every arm happens to rest
    // must not make a real arrangement read as a bare loop.
    const lanes = structuralWalk(props.ir, wholeWalkWindow(Math.max(1, Math.ceil(natCycles))))
    return !lanes.some((l) => l.armByCycle !== undefined)
  }, [props.ir, natCycles])
  // The user's resized display span for a pure bare loop (#662, option B). A
  // VIEW-ONLY preference — dragging the bare clip's right edge grows/shrinks the
  // bars shown with NO code write-back (the source `s("bd*4")` stays byte-identical;
  // only Split/Delete write code). Seeded from the persisted camera so a reload
  // restores it; persisted on change below. `null` = use the default floor. Ignored
  // for a non-bare song (displaySpan gates on `bareSong`).
  const [bareSpanOverride, setBareSpanOverride] = useState<number | null>(() => {
    const c = loadTimelineCamera()
    return c && typeof c.bareSpan === 'number' && Number.isFinite(c.bareSpan) ? c.bareSpan : null
  })
  // The TRUE content length — the rest span; also the playhead loop-wrap, the
  // note-mark collection window, and the bare-track implicit clip's end. The bare
  // floor (#489) and the user's resize override (#662) are folded in HERE so the
  // clip extents use the chosen span while the extend-drag (#487) layers a
  // transient viewport span on top.
  const loopCycles = displaySpan(analysis, bareSong, bareSpanOverride)
  // While EXTENDING the last clip, the visual span temporarily grows past the
  // content so there's empty timeline to drag into (#487). null at rest →
  // displayCycles == loopCycles (no permanent blank). `contentWidth` scales with
  // the span (below) so px/cycle stays constant: the grid WIDENS + auto-scrolls
  // instead of compressing, and the dragged edge tracks the cursor 1:1.
  const [dragSpanCycles, setDragSpanCycles] = useState<number | null>(null)
  const displayCycles = dragSpanCycles ?? loopCycles
  const dragSpanRef = useRef<number | null>(dragSpanCycles)
  dragSpanRef.current = dragSpanCycles
  const loopCyclesRef = useRef(loopCycles)
  loopCyclesRef.current = loopCycles
  // #1108 — the axis helpers now take a WINDOW (origin + span) rather than a
  // bare span, so a paged view can map ABSOLUTE song cycles across a stretch
  // that does not start at 0. This component still builds every window at
  // origin 0, so nothing about the view changes yet; what changes is that the
  // origin is now a value the axis reads instead of an assumption baked into it.
  //
  // TWO windows, mirroring the two spans that were already distinct: the LOOP
  // span drives the playhead wrap, the DISPLAY span drives pixels and can be
  // wider mid-drag. Collapsing them would silently re-introduce the drag bug
  // `dragSpanCycles` exists to avoid.
  // ── THE VIEW'S WINDOW ORIGIN, in one place ────────────────────────────────
  // The first song cycle this view is showing. It is 0 today because nothing
  // advances it yet: the analysis collects `[0, span)` and the view draws that.
  // The value is named and threaded rather than written as a literal at each
  // consumer because it has THREE — the loop window (playhead wrap), the display
  // window (all geometry), and the scene builder (density indexing). An origin
  // they disagree about draws marks at the right width in the wrong place.
  // Whatever eventually moves the window sets this, and all three follow.
  // #1201 — the origin is now a VALUE the owner advances, not a constant. It
  // is still 0 for every song that loops (there is nothing to the right to
  // reach) and for the first page of one that does not.
  const songOriginCycles = props.windowOriginCycles ?? 0
  // #1201 — the paging trigger runs inside the rAF loop, whose deps are `[]`
  // so it is never re-created. Everything it reads must therefore come through
  // a latest-value ref, or it would page against the origin and span that were
  // current when the drawer opened.
  const songOriginRef = useRef(songOriginCycles)
  songOriginRef.current = songOriginCycles
  const onRequestWindowRef = useRef(props.onRequestWindow)
  onRequestWindowRef.current = props.onRequestWindow
  const loopWindow = useMemo<SongWindow>(
    () => ({ originCycle: songOriginCycles, spanCycles: loopCycles }),
    [songOriginCycles, loopCycles],
  )
  const loopWindowRef = useRef(loopWindow)
  loopWindowRef.current = loopWindow
  // Is `loopCycles` an actual LOOP, or the point where period detection gave up?
  // `capped` means the analysis grew to its 256-cycle cap without confirming a
  // period, so the span is a stopping point and nothing about the song repeats
  // at it (#1105). Everything that treats the span as cyclic — the playhead wrap
  // above all — has to ask this rather than assume. Derived ONCE here so the
  // render path and the imperative rAF follow loop cannot disagree about it.
  //
  // ⚠ A `horizon` span (analysis ended early with no period) counts as looping
  // here. That is the pre-existing behaviour, preserved deliberately rather than
  // corrected in passing — it is a separate question from where the window sits.
  const looping = analysis == null || analysis.displaySpan.kind !== 'capped'
  const loopingRef = useRef(looping)
  loopingRef.current = looping

  // ── Grid width via ResizeObserver (mirrors MusicalTimeline DB-04) ────────
  const areaRef = useRef<HTMLDivElement>(null)
  const [areaWidth, setAreaWidth] = useState(0)
  useEffect(() => {
    const el = areaRef.current
    if (!el) return
    if (typeof ResizeObserver === 'undefined') {
      setAreaWidth(el.clientWidth ?? 0)
      return
    }
    const ro = new ResizeObserver((entries) => {
      setAreaWidth(Math.max(0, entries[0]?.contentRect.width ?? 0))
    })
    ro.observe(el)
    setAreaWidth(el.clientWidth ?? 0)
    return () => ro.disconnect()
  }, [])

  // ── Zoom + horizontal scroll + ruler units (#412) ────────────────────────
  // zoom=1 fits the whole loop; >1 widens `contentWidth` past the viewport and
  // the grid scrolls horizontally. The ruler tracks the grid's scrollLeft (one
  // scrollbar, on the grid). Refs mirror state so the imperative wheel/button
  // handlers and the seek math read live values without stale closures.
  // Seed zoom from the persisted camera (#501/U4) so a reload restores the
  // user's last zoom — but cap the *restored* value (#505): an extreme stored
  // zoom would land on a center-locked playhead (the song scrolls under a pinned
  // playhead) that reads as frozen on a fresh load. `clampRestoreZoom` keeps the
  // landing within a range where the playhead visibly glides; live zoom still
  // spans the full `clampZoom` range. The save effect below then re-persists the
  // capped value, so the camera converges to a restorable zoom.
  const [zoom, setZoom] = useState(() => {
    const c = loadTimelineCamera()
    return c && Number.isFinite(c.zoom) ? clampRestoreZoom(c.zoom) : MIN_ZOOM
  })
  const [scrollLeft, setScrollLeft] = useState(0)
  // Vertical camera (#655) — the SAME pattern as scrollLeft, for the other axis.
  // When the lanes overflow a short drawer, the grid scrolls Y natively
  // (`overflowY: auto`); `scrollTop` mirrors that offset so the label gutter can
  // translate in lockstep and the Y hit-tests can map client→content space.
  const [scrollTop, setScrollTop] = useState(0)
  // Ruler units (#412 → #750). The toggle now lives on the editor pattern bar
  // (StrudelEditorClient); this view just reads the shared store.
  const units = useRulerUnits()
  // The time signature the ruler's beat ticks are drawn in (#1568) — read from
  // the same store the canvas and the transport readout read, so the three
  // cannot disagree about where beat 2 is.
  const meter = useDisplayMeter()
  const zoomRef = useRef(zoom)
  zoomRef.current = zoom
  const scrollLeftRef = useRef(scrollLeft)
  scrollLeftRef.current = scrollLeft
  const scrollTopRef = useRef(scrollTop)
  scrollTopRef.current = scrollTop
  // The gutter's inner (translated) row stack — synced imperatively in the scroll
  // handler so it tracks the grid's native vertical scroll with no React-commit lag.
  const gutterInnerRef = useRef<HTMLDivElement | null>(null)
  const areaWidthRef = useRef(areaWidth)
  areaWidthRef.current = areaWidth

  // ── Follow / auto-scroll (#415) ──────────────────────────────────────────
  // When zoomed, the playhead can advance off the right edge. Follow nudges
  // scrollLeft to keep it in a centered dead-zone band (followScrollLeft). It
  // pauses briefly while the user manually scrolls/seeks so it never fights
  // their navigation. displayCyclesRef lets the rAF loop read the live span
  // without re-creating the loop per analysis change.
  const [follow, setFollow] = useState(true)
  const followRef = useRef(follow)
  followRef.current = follow
  const displayCyclesRef = useRef(displayCycles)
  displayCyclesRef.current = displayCycles
  const songWindow = useMemo<SongWindow>(
    () => ({ originCycle: songOriginCycles, spanCycles: displayCycles }),
    [songOriginCycles, displayCycles],
  )
  const songWindowRef = useRef(songWindow)
  songWindowRef.current = songWindow
  // Suspends follow until this timestamp (set on user scroll/seek).
  const userScrollUntilRef = useRef(0)
  // The last scrollLeft *we* wrote to the DOM — lets the scroll handler tell a
  // follow/zoom-driven scroll (don't suspend) from a user drag/wheel (suspend).
  const programmaticScrollRef = useRef(-1)

  const restContentWidth = contentWidthFor(areaWidth, zoom)
  // While extending, scale contentWidth with the grown span so px/cycle is the
  // SAME as at rest — the grid widens past the viewport and scrolls, instead of
  // compressing the clips (#487, constant-ppc grow + auto-scroll). At rest
  // (dragSpanCycles == null) this is just the fit-to-view width.
  const contentWidth =
    dragSpanCycles != null && loopCycles > 0
      ? (restContentWidth * dragSpanCycles) / loopCycles
      : restContentWidth
  const pxPerCycle = displayCycles > 0 ? contentWidth / displayCycles : 0
  const ticks = rulerTicks(songWindow, pxPerCycle, units, meter)

  // Content width as the pointer handlers see it: rest width (zoom-scaled),
  // scaled by the live (grown) drag span so the handler math matches the
  // rendered transform during an extend (#487). Rest width when not extending.
  const dragAwareContentWidth = React.useCallback((viewportWidth: number): number => {
    const rest = contentWidthFor(viewportWidth, zoomRef.current)
    const ds = dragSpanRef.current
    const lc = loopCyclesRef.current
    return ds != null && lc > 0 ? (rest * ds) / lc : rest
  }, [])
  // Constant px/cycle (the REST basis) — the extend drag maps the cursor at this
  // fixed scale so the dragged edge follows 1:1 with no jump as the span grows.
  const restPxPerCycle = React.useCallback((viewportWidth: number): number => {
    const lc = loopCyclesRef.current
    return lc > 0 ? contentWidthFor(viewportWidth, zoomRef.current) / lc : 0
  }, [])

  // Apply a new zoom, keeping the song point under `cursorX` (viewport-relative)
  // pinned beneath the cursor. State drives the new content width; the layout
  // effect below pushes the matching scrollLeft onto the DOM after it grows.
  const applyZoom = React.useCallback((rawZoom: number, cursorX: number): void => {
    const vw = areaWidthRef.current
    const oldZoom = zoomRef.current
    const newZoom = clampZoom(rawZoom)
    if (newZoom === oldZoom) return
    const next = Math.round(
      scrollLeftForZoom({
        oldZoom,
        newZoom,
        scrollLeft: scrollLeftRef.current,
        cursorX,
        viewportWidth: vw,
      }),
    )
    zoomRef.current = newZoom
    scrollLeftRef.current = next
    setZoom(newZoom)
    setScrollLeft(next)
  }, [])

  // Buttons zoom around the viewport centre; the gesture is identical to wheel
  // zoom with the cursor parked mid-view.
  const zoomBy = React.useCallback(
    (factor: number) => applyZoom(zoomRef.current * factor, areaWidthRef.current / 2),
    [applyZoom],
  )
  const fitZoom = React.useCallback(() => applyZoom(MIN_ZOOM, areaWidthRef.current / 2), [applyZoom])

  // Ctrl/⌘ + wheel = cursor-centred zoom. A native non-passive listener is
  // required: React's synthetic onWheel is passive, so preventDefault (which
  // suppresses the browser's page-zoom) would be ignored.
  useEffect(() => {
    const el = areaRef.current
    if (!el) return
    const onWheel = (e: WheelEvent): void => {
      if (!(e.ctrlKey || e.metaKey)) return // plain wheel → native horizontal scroll
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      const cursorX = e.clientX - rect.left
      const factor = e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP
      applyZoom(zoomRef.current * factor, cursorX)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [applyZoom])

  // Push scrollLeft onto the DOM after a zoom/resize changes the content width,
  // clamping into the (possibly shrunk) scrollable range. Keyed on zoom+width
  // only, so user scrolling (which sets scrollLeft via onScroll) never refights.
  useLayoutEffect(() => {
    const el = areaRef.current
    if (!el) return
    const maxScroll = Math.max(0, contentWidthFor(areaWidth, zoom) - areaWidth)
    const clamped = Math.max(0, Math.min(maxScroll, scrollLeftRef.current))
    scrollLeftRef.current = clamped
    // This is a programmatic (zoom/resize-driven) scroll, not a user drag —
    // mark it so the scroll handler doesn't suspend follow.
    programmaticScrollRef.current = clamped
    if (el.scrollLeft !== clamped) el.scrollLeft = clamped
    setScrollLeft((prev) => (prev === clamped ? prev : clamped))
  }, [zoom, areaWidth])

  const handleGridScroll = React.useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const sl = e.currentTarget.scrollLeft
    scrollLeftRef.current = sl
    setScrollLeft((prev) => (prev === sl ? prev : sl))
    // Vertical (#655): mirror the grid's native Y-scroll into `scrollTop` so the
    // Y hit-tests can map client→content, and translate the gutter rows in the
    // SAME frame (imperative — no React-commit lag against the native scroll).
    const st = e.currentTarget.scrollTop
    scrollTopRef.current = st
    if (gutterInnerRef.current) gutterInnerRef.current.style.transform = `translateY(${-st}px)`
    setScrollTop((prev) => (prev === st ? prev : st))
    // A scroll we didn't write (> 1px from our last programmatic value) is a
    // user drag/wheel-pan → suspend follow briefly so it doesn't fight them.
    if (Math.abs(sl - programmaticScrollRef.current) > 1) {
      userScrollUntilRef.current = Date.now() + USER_SCROLL_GUARD_MS
    }
  }, [])

  // ── rAF playhead, gated on drawer-open + active-tab (DB-02 parity) ───────
  const accessorsRef = useRef(props)
  accessorsRef.current = props
  const [songPos, setSongPos] = useState<number | null>(null)
  useEffect(() => {
    let cancelled = false
    let raf: number | null = null
    // Auto-scroll the grid so the playhead stays in a centered band, unless
    // follow is off or the user just scrolled/seeked. The DOM write is tagged
    // programmatic (via programmaticScrollRef) so the scroll handler doesn't
    // mistake it for a user drag and suspend follow. Reads live state through
    // refs; the playhead element itself stays put in content space, so the grid
    // scroll is the only motion. No-op when not zoomed (followScrollLeft → cur).
    const applyFollow = (pos: number | null): void => {
      if (!followRef.current || pos == null) return
      if (Date.now() < userScrollUntilRef.current) return
      const vw = areaWidthRef.current
      const cw = dragAwareContentWidth(vw)
      const ph = songCycleToX(
        wrapSongPosition(pos, loopWindowRef.current, loopingRef.current),
        songWindowRef.current,
        cw,
      )
      const target = followScrollLeft(ph, vw, cw, scrollLeftRef.current)
      if (Math.abs(target - scrollLeftRef.current) < 1) return
      const el = areaRef.current
      if (!el) return
      programmaticScrollRef.current = target
      scrollLeftRef.current = target
      el.scrollLeft = target
      setScrollLeft((prev) => (prev === target ? prev : target))
    }
    /**
     * PREFETCH the next window when the playhead enters the last quarter of
     * the one on screen (#1201 item 3).
     *
     * ── WHY A QUARTER AHEAD, AND WHY THAT IS GENEROUS ────────────────────────
     * A window is 128-512 seconds of playback and costs a 383ms median to
     * build, flat with depth. A quarter of it is tens of seconds of warning
     * for a sub-second job, so the page lands long before the boundary and the
     * "refresh arriving late" #1201 feared cannot occur. Asking EARLY rather
     * than AT the boundary is the whole design: nothing has to be recomputed
     * under time pressure.
     *
     * Only a song with no measured period pages. When a period was found,
     * cycle 257 genuinely IS cycle 1 — there is nothing to the right to reach,
     * and asking would re-analyse the same music forever.
     *
     * Fires on every frame the condition holds; the owner makes it idempotent
     * by origin rather than this side tracking what it already asked for,
     * because the owner is what knows whether a page is in flight.
     */
    const maybePageAhead = (pos: number | null): void => {
      if (pos == null) return
      const request = onRequestWindowRef.current
      if (!request) return
      const span = loopCyclesRef.current
      const next = nextWindowOriginFor(pos, songOriginRef.current, span, loopingRef.current)
      if (next != null) request(next, span)
    }

    const tick = (): void => {
      if (cancelled) return
      const a = accessorsRef.current
      if (!a.getDrawerOpen() || a.getActiveTabId() !== TAB_ID) {
        raf = null
        return
      }
      const pos = a.getSongPosition()
      setSongPos((prev) => (prev === pos ? prev : pos))
      applyFollow(pos)
      maybePageAhead(pos)
      raf = requestAnimationFrame(tick)
    }
    if (props.getDrawerOpen() && props.getActiveTabId() === TAB_ID) {
      raf = requestAnimationFrame(tick)
    }
    const poke = setInterval(() => {
      if (cancelled) return
      if (raf == null && accessorsRef.current.getDrawerOpen() && accessorsRef.current.getActiveTabId() === TAB_ID) {
        raf = requestAnimationFrame(tick)
      }
      const sampled = accessorsRef.current.getSongPosition()
      setSongPos((prev) => (prev === sampled ? prev : sampled))
    }, 250)
    return () => {
      cancelled = true
      clearInterval(poke)
      if (raf != null) cancelAnimationFrame(raf)
      setSongPos(null)
    }
    // Accessors read through the ref; deps would re-create the loop per render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Wrap the playhead at the TRUE period (not the padded extend span) so it
  // loops with the audio, never into the transient trailing room (#487).
  const wrappedPos = wrapSongPosition(songPos, loopWindow, looping)
  // Playhead lives in CONTENT space (inside the scrolled/translated inner div),
  // so it maps against contentWidth, not the viewport width.
  const playheadX = songCycleToX(wrappedPos, songWindow, contentWidth)
  const playheadVisible = wrappedPos != null

  // ── Click → seek (relaxes DV-10) ─────────────────────────────────────────
  // The ruler and grid share the grid's scrollLeft and the same left edge, so a
  // click anywhere resolves through the grid's rect: viewport-x + scrollLeft is
  // the content-x, inverted against contentWidth.
  const handleSeekAtClientX = React.useCallback(
    (clientX: number) => {
      const el = areaRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      const contentX = clientX - rect.left + scrollLeftRef.current
      const cycle = xToSongCycle(contentX, songWindow, dragAwareContentWidth(rect.width))
      // A manual seek is user navigation — suspend follow briefly so it doesn't
      // immediately yank the view back as the sought playhead resumes. Clamp to
      // the true song end so a click in the transient extend room (past the song)
      // seeks to the end, not into empty space (#487).
      userScrollUntilRef.current = Date.now() + USER_SCROLL_GUARD_MS
      // The end of the SONG-ABSOLUTE stretch in view. `cycle` came back absolute
      // from the axis, so clamping it against a bare span would send a click near
      // the end of a paged window back to the start of the song.
      onSeek(clampSeekToWindow(cycle, loopWindow))
    },
    [displayCycles, songOriginCycles, loopCycles, dragAwareContentWidth, onSeek],
  )

  // Canvas scene: per-lane density (from analysis) + capped mini-note marks
  // (collected app-side from the IR over the display span). Memoised so the
  // collect + build run only when the analysis or IR changes — NOT on scroll or
  // zoom (those only move the shared transform the canvas already redraws against).
  // Marks are collected over the TRUE content length (`loopCycles`, bare-floor
  // included #489) — collecting over the grown extend span (#487) would tile the
  // looping pattern into the trailing room instead of leaving it empty. The
  // scene's transform basis still uses the (possibly grown) `displayCycles` so the
  // canvas and the component agree (PV116).
  // #861 — DISPLAY marks come from the EVALUATED haps when available (Strudel
  // has resolved pitch/scale — the static IR is source-lossy for those, PV174),
  // else fall back to the IR (pre-eval). Re-query on each new snapshot: a fresh
  // eval publishes a new `props.ir` AND updates the engine's track schedulers in
  // lock-step, so keying the memo on `props.ir` refreshes the events too. The
  // `getTimelineEvents` closure is stable (StaveApp binds it once), so its
  // presence in the deps never re-fires the memo on its own.
  // #1209 — over the WINDOW, not over a span measured from zero. `loopWindow`
  // is the true content length at the origin the view is showing, which is
  // exactly the stretch the marks and the clips belong to. Before this, both
  // were derived over `[0, span)` at every origin: because `SceneNote.cycle` is
  // song-absolute, a paged window's marks landed to the left of the viewport
  // and were culled, so it drew its heatmap with no note marks and the first
  // window's clips.
  //
  // Both readers below go through ONE definition of "the haps this window
  // shows". Written out twice it is three lines of duplication that a later
  // edit only has to touch one of — and the consumer that drifts is the PROBE,
  // so the divergence would be invisible in the app and misleading in the test
  // that trusts it. Both accessors are bound once by the owner, so this closure
  // is stable and its presence in a dep list never re-fires anything on its own.
  const readWindowEvents = useCallback(
    () =>
      readEventsInBand(
        {
          getTimelineEventsBand: props.getTimelineEventsBand,
          getTimelineEvents: props.getTimelineEvents,
        },
        loopWindow.originCycle,
        loopWindow.originCycle + loopCycles,
      ),
    [props.getTimelineEventsBand, props.getTimelineEvents, loopWindow, loopCycles],
  )
  const marks = useMemo(
    () => collectNoteMarks(readWindowEvents(), props.ir ?? null, loopWindow),
    [props.ir, loopWindow, readWindowEvents],
  )
  // #977 — test-only observation of the computed marks. Marks are canvas-drawn,
  // so a browser e2e can't read them from the DOM; this publishes a per-lane
  // onset summary + whether the marks are EVAL-backed (haps present) or the
  // COLLECT fallback (pre-eval) — exactly the collect→eval verdict PR-B moves,
  // adjudicated at true browser fidelity. Gated on a localStorage flag so
  // production pays nothing (no window write unless a test opts in).
  useEffect(() => {
    if (typeof window === 'undefined') return
    let on = false
    try {
      on = !!window.localStorage.getItem('stave:debug.timelineMarks')
    } catch {
      on = false
    }
    if (!on) return
    // The SAME read the memo above made, so the probe reports the marks the
    // view actually drew rather than a differently-scoped second query.
    const events = readWindowEvents()
    const byLane: Record<
      string,
      { count: number; onsets: number[]; pitches: Array<number | null> }
    > = {}
    for (const [key, notes] of marks.marksByLane) {
      byLane[key] = {
        count: notes.length,
        onsets: notes.map((n) => n.cycle),
        pitches: notes.map((n) => n.pitch),
      }
    }
    ;(
      window as unknown as { __staveTimelineMarks?: unknown }
    ).__staveTimelineMarks = {
      evalBacked: Array.isArray(events) && events.length > 0,
      eventCount: Array.isArray(events) ? events.length : 0,
      laneCount: marks.marksByLane.size,
      byLane,
    }
  }, [marks, readWindowEvents])
  // #871 — the lane order the user WROTE, read off the IR's track list. Lane
  // order is structure, and structure is IR-owned: the IR carries a Track node
  // per statement even when that track emits no static-IR events (a signal, a
  // bare ref), which is exactly the case the eval-backed lanes cover. Without it
  // the scene can only append those lanes after the IR ones, so a signal written
  // first renders last.
  const trackOrder = useMemo(() => declaredTracks(props.ir ?? null), [props.ir])
  // Continuous automation per lane (#1464 Stage 1) — the same IR, read once and
  // grouped by the track id the lanes already key on. Memoised on `props.ir`
  // exactly like `trackOrder`: both are structural readings of the document, so
  // they refresh together and can never describe different documents.
  const automationsByTrack = useMemo(() => {
    const by = new Map<string, SignalAutomation[]>()
    for (const a of signalAutomations(props.ir ?? null)) {
      const list = by.get(a.trackId)
      if (list) list.push(a)
      else by.set(a.trackId, [a])
    }
    return by as ReadonlyMap<string, readonly SignalAutomation[]>
  }, [props.ir])
  // Per-lane voice sub-row order is pinned first-seen across re-evals (#480) so
  // reordering clips in time doesn't reshuffle the instrument rows — the SAME
  // first-seen stability `stableTrackOrder` gives the top-level lanes, one level
  // down. The previous order rides in a ref and is threaded back each rebuild
  // (mirrors MusicalTimeline's `slotMapRef`). Recomputed only when the analysis,
  // marks, or display span change (NOT on scroll/zoom), idempotent on a no-op
  // re-eval. The scene is built over the (possibly grown) `displayCycles` span so
  // clip geometry and the bare-split materialize agree on where each clip ends.
  const voiceOrderRef = useRef<VoiceOrderByLane>(EMPTY_VOICE_ORDER)
  const source = props.source ?? null
  // Per-track custom-colour overrides (Phase D, #581). The map identity is
  // ref-stable (from `useTrackMetaMap`), changing only when an override is
  // set/cleared — so adding it to the scene deps recolours lanes (dot + canvas)
  // exactly when the user picks, not on every render.
  const { customColorByName } = props
  const scene = useMemo(() => {
    const raw = buildTimelineScene(
      // `SongAnalysis` satisfies the narrower `SceneActivity` structurally — the
      // scene only ever wanted lanes and sections. The period travels separately
      // below precisely because the other shape that fits here, a windowed
      // analysis, has none to give.
      //
      // #1201 — and that is exactly what arrives once the view pages: a
      // `WindowAnalysis` drives the scene with no adapter. Only the SCENE
      // follows the window; span, `looping` and the readout stay with the song.
      windowActivity ?? analysis,
      // Origin and span as ONE value, which is the same object the axis and the
      // renderers are handed, so the view cannot tell them different stories.
      songWindow,
      analysis?.periodCycles ?? null,
      // This view shows exactly ONE window, so its own busiest cell is the right
      // full-intensity reference and there is nothing to be comparable WITH. A
      // view that pages has to revisit this — see the note at `peakDensity`.
      null,
      marks,
      source,
      customColorByName,
      trackOrder,
      automationsByTrack,
    )
    const { scene: ordered, order } = applyStableVoiceOrder(raw, voiceOrderRef.current)
    voiceOrderRef.current = order
    return ordered
  }, [analysis, windowActivity, songWindow, marks, source, customColorByName, trackOrder, automationsByTrack])

  // ── Expand + bind (#422) ─────────────────────────────────────────────────
  // Click/expand a lane → accordion it taller (read-only note detail) AND bind
  // its pattern into the Pattern panel. Multi-expand is a Set (cross-track
  // alignment). The layout is the single vertical source of truth shared by the
  // canvas draw, the canvas host height, the DOM lane labels, and the hit-test.
  const { onBindLane } = props
  // Seed expanded lanes from the persisted camera (#501/U4). Stale lane keys
  // (from another song) are harmless — computeLaneLayout only expands lanes
  // present in the current scene.
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(
    () => new Set(loadTimelineCamera()?.expanded ?? []),
  )
  // Lane + per-voice sub-row height follow the shared "timeline row height"
  // editor setting (#459) — the same source the Live monitor reads — so the
  // Song view matches it instead of a private constant. The setting governs
  // every row in the Live view (each leaf voice is one `subRowHeight`), so it
  // feeds BOTH the collapsed lane height and the expanded sub-row height here;
  // the EXPANDED single-band note-detail height stays a fixed zoom.
  const [rowH, setRowH] = useState<number>(() => getMusicalTimelineSubRowHeight())
  useEffect(() => onMusicalTimelineSubRowHeightChange(setRowH), [])
  const layout = useMemo(
    () => computeLaneLayout(scene.lanes, expanded, rowH, EXPANDED_ROW_HEIGHT, rowH),
    [scene.lanes, expanded, rowH],
  )
  // Refs so the double-click hit-test reads live scene/layout without stale
  // closures (mirrors the scrollLeftRef/zoomRef pattern above).
  const sceneRef = useRef(scene)
  sceneRef.current = scene
  // laneKey → lane, for the DOM lane labels to read the resolved display NAME +
  // colour (#579 STEP 2). The `box`es (from `computeLaneLayout`) carry only the
  // identity `laneKey`; the display fields live on the scene lane.
  const laneByKey = useMemo(
    () => new Map(scene.lanes.map((l) => [l.laneKey, l])),
    [scene],
  )
  // #642 — the laneKey the caret/selection points at, resolved ONCE from the
  // scene so the gutter row AND the full-width grid band agree on one lane.
  // Match the SENDER's vocabulary (`labelOffset ?? sourceOffset`, the exact
  // anchor the header click and #610 jump emit) so an anonymous lane with no
  // statement label still resolves — keying off raw `labelOffset` alone left
  // such lanes unmatchable (the #642 latent mismatch).
  const selectedLaneKey = useMemo(() => {
    const sel = props.selectedStatementOffset
    if (sel == null) return null
    const hit = scene.lanes.find((l) => (l.labelOffset ?? l.sourceOffset) === sel)
    return hit?.laneKey ?? null
  }, [props.selectedStatementOffset, scene])
  // #642 — the selected lane's layout box (top/height in content space), for the
  // full-width grid band drawn in the marks overlay.
  const selectedBox =
    selectedLaneKey != null
      ? layout.boxes.find((b) => b.laneKey === selectedLaneKey)
      : undefined
  // Which lane's header is being inline-renamed (#580, Phase C), by laneKey.
  const { onRenameLane } = props
  // #610 — select a lane → reveal its code in the editor (no expand/bind).
  const { onSelectLane } = props
  const [renamingLane, setRenamingLane] = useState<string | null>(null)
  // ONE write per rename gesture (#877). Enter commits and unmounts the input, and
  // the write moves focus to the editor — so the field ALSO blurs and the blur
  // handler ran a SECOND rename. The Mixer's identical pair corrupted the document
  // (the second write resolved onto a different track); here the second write is
  // a no-op only by luck of the re-anchoring. Settle the gesture exactly once:
  // whichever of Enter / blur / Escape lands first closes it, the rest no-op.
  const renameSettledRef = useRef(false)
  const openLaneRename = useCallback((laneKey: string) => {
    renameSettledRef.current = false
    setRenamingLane(laneKey)
  }, [])
  const commitLaneRename = useCallback(
    (anchor: number, raw: string, displayName: string) => {
      if (renameSettledRef.current) return
      renameSettledRef.current = true
      setRenamingLane(null)
      const v = raw.trim()
      if (v) onRenameLane?.(anchor, v, displayName)
    },
    [onRenameLane],
  )
  const cancelLaneRename = useCallback(() => {
    renameSettledRef.current = true
    setRenamingLane(null)
  }, [])
  // Which lane's colour swatch is open (Phase D, #581), by laneKey + the anchor
  // rect of its dot. Picking writes to the per-file TrackMeta store via the
  // parent; the lane recolours through the ref-stable `customColorByName` map.
  const { onSetTrackColor, onResetTrackColor } = props
  const [colorPickerLane, setColorPickerLane] = useState<
    { laneKey: string; name: string; rect: DOMRect } | null
  >(null)
  const layoutRef = useRef<LaneLayout>(layout)
  layoutRef.current = layout

  // Persist the camera (zoom + expanded lanes) so a reload restores it
  // (#501/U4). Global, best-effort; fires on each change — these are user
  // gestures (zoom button/wheel, expand toggle), not per-frame churn.
  useEffect(() => {
    saveTimelineCamera({
      zoom,
      expanded: [...expanded],
      // #662 — the bare-loop resize is camera state too: omit when unset (null)
      // so a never-resized song keeps its default floor on reload.
      ...(bareSpanOverride != null ? { bareSpan: bareSpanOverride } : {}),
    })
  }, [zoom, expanded, bareSpanOverride])

  // Toggle a lane's expansion and bind it into the Pattern panel. Binding fires
  // on every activation (expand OR collapse) — clicking a lane selects it.
  const activateLane = React.useCallback(
    (laneKey: string) => {
      const lane = sceneRef.current.lanes.find((l) => l.laneKey === laneKey)
      onBindLane?.(lane?.sourceOffset ?? null)
      setExpanded((prev) => {
        const next = new Set(prev)
        if (next.has(laneKey)) next.delete(laneKey)
        else next.add(laneKey)
        return next
      })
    },
    [onBindLane],
  )

  // Double-click in the grid body → hit-test the Y to a lane (the spatial index
  // is the layout) → activate it. Single click stays a seek (seek-anywhere).
  const handleExpandAtClientY = React.useCallback(
    (clientY: number) => {
      const el = areaRef.current
      if (!el) return
      // content-Y = client-Y minus the grid's top, PLUS the grid's vertical scroll
      // (#655) — the exact mirror of the content-X math (`+ scrollLeft`). The grid
      // scrolls Y in place (it doesn't move its own rect), so the offset is needed.
      const contentY = clientY - el.getBoundingClientRect().top + scrollTopRef.current
      const laneKey = laneAtY(layoutRef.current, contentY)
      if (laneKey != null) activateLane(laneKey)
    },
    [activateLane],
  )

  // #610 — a single click anywhere on a lane's grid ROW jumps the editor to that
  // track's code (the same "select the track" gesture as the header). Hit-test
  // the lane by Y, then reveal its STATEMENT head (`labelOffset`, the Mixer's
  // anchor), falling back to the innermost atom. Seek lives on the ruler only.
  const jumpToLaneAtClientY = React.useCallback(
    (clientY: number) => {
      if (!onSelectLane) return
      const el = areaRef.current
      if (!el) return
      const laneKey = laneAtY(layoutRef.current, clientY - el.getBoundingClientRect().top + scrollTopRef.current)
      if (laneKey == null) return
      const lane = sceneRef.current.lanes.find((l) => l.laneKey === laneKey)
      const offset = lane?.labelOffset ?? lane?.sourceOffset ?? null
      if (offset == null) return
      onSelectLane(offset)
      // revealOffsetInFile focuses the editor; take focus BACK to the grid so the
      // clip-op shortcuts (S split / ⌘D / Delete, #488) still fire after a click-
      // select. The reveal's scroll + cursor position persist — only focus moves.
      el.focus({ preventScroll: true })
    },
    [onSelectLane],
  )

  // ── Trim a clip: drag its right edge → set the arm's cycle weight (#437) ───
  // The first arrangement EDIT gesture. A clip is one arm of an arrange/cat
  // combinator, so trimming changes the arm's whole-cycle span (the weight `n`).
  // The hit-test + drag run in content space over the shared transform (PV116);
  // the commit hands the new weight up to `onTrimClip`, which writes a surgical
  // set-weight edit. The implicit clip of a bare track (`armIndex < 0`) is NOT
  // trimmable here — wrapping it in a combinator is a later op (§2.1).
  const { onTrimClip } = props
  const [trimEdgeX, setTrimEdgeX] = useState<number | null>(null)
  const trimDragRef = useRef<{
    pointerId: number
    sourceOffset: number | null
    armIndex: number
    startCycle: number
    origWeight: number
    weight: number
    /** Latest pointer clientX — the rAF auto-scroll reads it so HOLDING the edge
     *  in the right-edge band keeps scrolling empty timeline in (#487). */
    lastClientX: number
  } | null>(null)
  // rAF handle for the extend auto-scroll (runs only while the cursor is held in
  // the right-edge band during a trim drag).
  const trimRafRef = useRef<number | null>(null)

  // ── Select + delete a clip (Phase 5c, #386) ───────────────────────────────
  // Clicking a clip's BODY selects it (and still seeks — seek-anywhere is
  // preserved); Delete/Backspace then drops the arm. Only real arms
  // (`armIndex ≥ 0`) are selectable; a bare track's implicit clip has no arm to
  // remove. Selection is keyed by lane + arm; the highlight rect is re-derived
  // in render from the live scene/layout so it tracks zoom, scroll, and re-eval.
  const { onDeleteClip, onMoveClip, onDuplicateClip, onSplitClip, onRippleDeleteClip, onInsertSilenceClip } = props
  const { onRenameSection, sectionArmCount } = props
  const [selected, setSelected] = useState<{
    laneKey: string
    armIndex: number
    sourceOffset: number | null
    // #489 — for a bare implicit clip (armIndex < 0), the whole-cycle the user
    // clicked. Drives the 1-bar selection highlight + the Delete gap target.
    // Undefined for real arms (their armIndex already addresses the clip).
    barCycle?: number
  } | null>(null)

  // #1417 Stage 3 — the section-rename editor. `name` is what the input opens
  // with, `count` how many sections the rename would move, both captured when it
  // OPENS: the document can change under a half-typed name, and a hint that
  // silently re-computed would tell the user something different from what the
  // commit is about to do.
  const [editingSection, setEditingSection] = useState<{
    laneKey: string
    armIndex: number
    sourceOffset: number | null
    name: string
    count: number
  } | null>(null)
  // ⚠ ONCE PER OPENED FIELD, by a ref rather than by reasoning about React's
  // blur semantics — the same guard the caption editor needed. Enter commits and
  // unmounts the input; a blur delivered on the way out would build the SAME
  // rename again, from offsets the first write already moved.
  const sectionCommittedRef = useRef(false)
  const commitSectionName = React.useCallback(
    (value: string): void => {
      if (sectionCommittedRef.current) return
      sectionCommittedRef.current = true
      const hit = editingSection
      setEditingSection(null)
      // The selection is keyed by `sourceOffset` + `armIndex`, and a rename moves
      // offsets — so it is cleared for the same reason duplicate and split clear
      // it, whether or not the write lands.
      setSelected(null)
      if (!hit || !onRenameSection) return
      const next = value.trim()
      if (next.length === 0 || next === hit.name) return
      onRenameSection({ sourceOffset: hit.sourceOffset, armIndex: hit.armIndex, newName: next })
    },
    [editingSection, onRenameSection],
  )

  // #649 — the clip-selection (`selected`) and the caret lane-selection
  // (`selectedLaneKey`) are independent highlights. A selected clip persists when
  // the caret moves to ANOTHER lane via the editor, leaving TWO rows lit (the
  // lane band + the clip rect, which for a full-cycle clip spans the whole row).
  // When the selected lane genuinely CHANGES to a lane other than the clip's, the
  // clip-selection is stale → clear it, so only one row ever reads as selected.
  // Keyed on `selectedLaneKey` ONLY (the clip is read via a ref), so it fires on
  // a real lane change — a fresh clip click, which moves the caret TO the clip's
  // own lane, is never falsely cleared by the async caret round-trip.
  const selectedClipRef = useRef(selected)
  selectedClipRef.current = selected
  useEffect(() => {
    const clip = selectedClipRef.current
    if (clip && selectedLaneKey != null && clip.laneKey !== selectedLaneKey) {
      setSelected(null)
    }
  }, [selectedLaneKey])

  // ── Move a clip: drag its body horizontally (Phase 5c, #386) ──────────────
  // A body press starts a PENDING gesture: if the pointer travels past the
  // threshold it becomes a MOVE drag (reorder a real arm, or wrap a bare track,
  // §2.1); otherwise it stays a click (select + seek). The ghost rect previews
  // where the clip will land. Reads live refs so the handlers are closure-stable.
  const moveDragRef = useRef<{
    pointerId: number
    sourceOffset: number | null
    armIndex: number // dragged clip's arm; < 0 = bare implicit clip (→ wrap)
    laneKey: string
    startClientX: number
    startCycle: number
    endCycle: number
    dragging: boolean
    toIndex: number // reorder target (real arm)
  } | null>(null)
  const [moveGhost, setMoveGhost] = useState<{
    left: number
    width: number
    top: number
    height: number
  } | null>(null)

  // Hit-test a clip BODY (not its edge) under a client point → { lane, clip },
  // or null. Matches CONTAINMENT (`clipAtCycle`). `includeBare` keeps a bare
  // track's implicit clip (armIndex < 0): it is SELECTABLE (#489 — select then
  // split/delete) but still NOT MOVABLE (#488 — a uniform loop can't reorder/wrap;
  // the move path passes `false`).
  const clipBodyAt = React.useCallback(
    (clientX: number, clientY: number, includeBare = false) => {
      const el = areaRef.current
      if (!el) return null
      const rect = el.getBoundingClientRect()
      const cw = dragAwareContentWidth(rect.width)
      const contentX = clientX - rect.left + scrollLeftRef.current
      const laneKey = laneAtY(layoutRef.current, clientY - rect.top + scrollTopRef.current)
      if (laneKey == null) return null
      const lane = sceneRef.current.lanes.find((l) => l.laneKey === laneKey)
      if (!lane) return null
      const cyc = xToSongCycle(contentX, songWindow, cw)
      const clip = clipAtCycle(lane, cyc)
      if (!clip || (clip.armIndex < 0 && !includeBare)) return null
      return { lane, clip }
    },
    // #1210 — `songWindow`, not `displayCycles`. Paging moves the window's
    // ORIGIN and leaves its span alone, so keying on the span left this closure
    // mapping x through a window anchored at cycle 0: at origin 256 a click on
    // cycle 288 was read as 32, no clip contained it, and every clip gesture in
    // a paged window silently did nothing. The window is memoised on origin +
    // span, so naming it subsumes the span entry.
    [songWindow, dragAwareContentWidth],
  )

  // The combinator's arms as time-spans, in arm order — gathered across ALL
  // lanes (each arm is one clip, but different `s` arms land in different lanes).
  // The drop target for a reorder is the arm whose span the pointer falls in.
  const armSpansNow = React.useCallback(
    () =>
      sceneRef.current.lanes
        .flatMap((l) => l.clips)
        .filter((c) => c.armIndex >= 0)
        .sort((a, b) => a.armIndex - b.armIndex),
    [],
  )

  // Hit-test a clip's right edge under a client point → the draggable clip, or
  // null. We scan the lane's clips and match proximity to each clip's RIGHT EDGE
  // directly (not `clipAtCycle`): that grabs the LAST clip's edge too (its end is
  // the song end, contained in no clip) and disambiguates a shared boundary to
  // the clip whose edge is nearest. Reads live refs so it's closure-stable.
  // ── The caption control (#1464 Stage 2) ───────────────────────────────────
  //
  // ⚠ THE CAPTION SITS ON PIXELS FOUR OTHER GESTURES ALREADY CLAIM. The
  // automation band spans the WHOLE lane row, and the caption is drawn at its
  // top-left — over any clip that reaches x≈4. Today a press there resolves, in
  // order, to a trim drag (`clipEdgeAt`), a clip select / move (`clipBodyAt`),
  // or a jump-to-code (#610); a double-press collapses the lane, which is the
  // one gesture that makes the caption itself disappear. All four are settled
  // the same way the existing pair already settles: by PRECEDENCE. The caption
  // is tested first and returns, so nothing downstream ever sees the press.
  //
  // The editor is a real DOM input, and that is load-bearing rather than
  // convenient. The grid takes keyboard focus on every press so its clip
  // shortcuts work — S splits, ⌘D duplicates, Delete/Backspace deletes. Typing a
  // number into a canvas-drawn field would leave those live, and BACKSPACE while
  // retyping a bound would delete the selected clip.
  //
  // ⚠ A REAL INPUT IS NECESSARY BUT NOT SUFFICIENT, and the earlier version of
  // this note got that wrong. It said focus alone meant `handleGridKeyDown`
  // "cannot fire at all". It can: the input is mounted INSIDE the grid element
  // that carries the handler, and React's `onKeyDown` bubbles, so focus governs
  // where a keystroke starts and not whether it travels. What actually stops it
  // is the `e.stopPropagation()` on the input's own handler. The input still
  // earns its place — it gives real text editing, caret and selection — but the
  // guard is that one line, and it is pinned by a browser arm rather than left
  // to be re-reasoned.
  const { onEditAutomation } = props
  const [editingCaption, setEditingCaption] = useState<CaptionHit | null>(null)

  /** The caption field under a client point, or null. X is VIEWPORT-relative and
   *  Y is CONTENT-relative, because that is how the canvas draws: it is pinned
   *  left and scrolled in Y, so the caption's x never moves with `scrollLeft`. */
  const captionAt = React.useCallback(
    (clientX: number, clientY: number): CaptionHit | null => {
      if (!onEditAutomation) return null
      const el = areaRef.current
      if (!el) return null
      const rect = el.getBoundingClientRect()
      const contentY = clientY - rect.top + scrollTopRef.current
      const laneKey = laneAtY(layoutRef.current, contentY)
      if (laneKey == null) return null
      const box = layoutRef.current.boxes.find((b) => b.laneKey === laneKey)
      const lane = sceneRef.current.lanes.find((l) => l.laneKey === laneKey)
      if (!box || !lane) return null
      const rows = captionRows(lane.automations, box.top, box.height, box.expanded)
      return captionHit(rows, clientX - rect.left, contentY, measureCaption)
    },
    [onEditAutomation],
  )

  /** The caption fields a press may actually EDIT — the two bounds.
   *
   *  ⚠ The parameter NAME is part of the caption and is reported by the
   *  hit-test, but nothing can be typed into it: `captionEdit` returns null for
   *  it, so an editor opened there would take text and silently drop it, which
   *  is worse than an inert label. Excluding it here also means a press on the
   *  name keeps reaching the gestures it always reached. Both the press and the
   *  double-press ask this, so they cannot disagree about which pixels are
   *  claimed. */
  const editableCaptionAt = React.useCallback(
    (clientX: number, clientY: number): CaptionHit | null => {
      const hit = captionAt(clientX, clientY)
      return hit && hit.field.kind !== 'param' ? hit : null
    },
    [captionAt],
  )

  /** Commit whatever is in the editor, then close it.
   *
   *  ⚠ The edit is BUILT by `captionEdit`, never here — that function is where
   *  the "unchanged writes nothing", "the rounding cannot escape" and "an
   *  unspelled leg inserts" rules live, and routing every commit through it is
   *  what makes them unavoidable rather than remembered. */
  //  ⚠ ONCE PER OPENED FIELD, enforced by a ref rather than by reasoning about
  //  React's blur semantics. Enter commits and unmounts the input; if a blur
  //  were also delivered on the way out, the same edit would be built AGAIN from
  //  the pre-edit `lo`/`hi` this hit still holds, and applied at offsets the
  //  first write already moved. That is a corrupted document, not a duplicate
  //  no-op, so it is guarded rather than argued about.
  const captionCommittedRef = useRef(false)
  const commitCaption = React.useCallback(
    (value: string): void => {
      if (captionCommittedRef.current) return
      captionCommittedRef.current = true
      const hit = editingCaption
      setEditingCaption(null)
      if (!hit || !onEditAutomation) return
      const edit = captionEdit(hit, value)
      if (!edit) return
      onEditAutomation(edit, `automation ${hit.row.automation.paramKey} ${hit.field.kind}`)
    },
    [editingCaption, onEditAutomation],
  )

  const clipEdgeAt = React.useCallback(
    (clientX: number, clientY: number): { lane: (typeof sceneRef.current.lanes)[number]; clip: NonNullable<ReturnType<typeof clipAtCycle>> } | null => {
      if (!onTrimClip) return null
      const el = areaRef.current
      if (!el) return null
      const rect = el.getBoundingClientRect()
      const cw = dragAwareContentWidth(rect.width)
      const contentX = clientX - rect.left + scrollLeftRef.current
      const laneKey = laneAtY(layoutRef.current, clientY - rect.top + scrollTopRef.current)
      if (laneKey == null) return null
      const lane = sceneRef.current.lanes.find((l) => l.laneKey === laneKey)
      if (!lane) return null
      let best: NonNullable<ReturnType<typeof clipAtCycle>> | null = null
      let bestDist = CLIP_EDGE_GRIP_PX
      for (const clip of lane.clips) {
        // The implicit/bare clip's edge is grabbable ONLY in a pure bare song
        // (#662 resize = set display span). A bare LANE inside a multitrack song
        // (bareSong === false) has its span pinned by the other tracks — that
        // harder case is deferred, so its edge stays inert.
        if (clip.armIndex < 0 && !bareSong) continue
        const dist = Math.abs(contentX - songCycleToX(clip.endCycle, songWindow, cw))
        if (dist <= bestDist) {
          best = clip
          bestDist = dist
        }
      }
      return best ? { lane, clip: best } : null
    },
    // #1210 — see `clipBodyAt`: the ORIGIN is what paging moves, and this
    // closure maps x through the window too.
    [onTrimClip, bareSong, songWindow, dragAwareContentWidth],
  )

  // ── Trim a REGION: drag a mark's own edge → set what slice it plays (#1527) ─
  // A different gesture from the clip trim above, on a different target: that
  // one changes how many BARS an arrangement arm lasts, this one changes which
  // part of a SAMPLE FILE a mark is heard playing. Only on expanded lanes, where
  // the waveform this trims is actually drawn.
  const { onTrimRegion } = props
  const [regionGhost, setRegionGhost] = useState<{
    left: number
    top: number
    height: number
    label: string
  } | null>(null)
  const regionDragRef = useRef<
    | (RegionEdgeHit & {
        pointerId: number
        startClientX: number
        /** The region as it was at pointer-down. The drag scale is derived from
         *  it once and never re-derived — see `REGION_DRAG_SPAN_PX`. */
        startValue: number
        playing: { begin: number; end: number }
        value: number
      })
    | null
  >(null)

  /**
   * The mark edge under the pointer, in the SAME coordinate frame the renderer
   * drew the marks in: x is screen-space (the canvas is sticky horizontally and
   * `toScreenX` has already taken the scroll off), y is content-space (the
   * canvas scrolls vertically with its container). Getting those two the same
   * way round is the whole reason this closure re-creates `toScreenX` rather
   * than reusing the clip helpers' content-space mapping.
   */
  const regionEdgeAtClient = React.useCallback(
    (clientX: number, clientY: number): RegionEdgeHit | null => {
      if (!onTrimRegion) return null
      const el = areaRef.current
      if (!el) return null
      const rect = el.getBoundingClientRect()
      const cw = dragAwareContentWidth(rect.width)
      const scene = sceneRef.current
      const dc = Math.max(1, scene.displayCycles)
      const ppc = cw / dc
      if (!(ppc > 0)) return null
      const toScreenX = (cycle: number): number =>
        songCycleToXUnclamped(cycle, songWindowRef.current, cw) - scrollLeftRef.current
      const firstIndex = Math.max(0, Math.floor(scrollLeftRef.current / ppc))
      const lastIndex = Math.min(dc, Math.ceil((scrollLeftRef.current + rect.width) / ppc))
      return regionEdgeAt({
        lanes: scene.lanes,
        layout: layoutRef.current,
        screenX: clientX - rect.left,
        contentY: clientY - rect.top + scrollTopRef.current,
        pxPerCycle: ppc,
        viewportWidth: rect.width,
        firstCycle: scene.windowOriginCycles + firstIndex,
        lastCycle: scene.windowOriginCycles + lastIndex,
        toScreenX,
      })
    },
    [onTrimRegion, dragAwareContentWidth],
  )

  /** Move the dragged region edge to wherever the pointer is now. */
  const applyRegionTrim = React.useCallback((clientX: number): void => {
    const drag = regionDragRef.current
    const el = areaRef.current
    if (!drag || !el) return
    // ⚠ THE ONE OWNER of this sum, not the same arithmetic written again here.
    // It carries the rule that the scale is fixed at pointer-down; a second
    // copy is how that rule comes to be true in one place and not the other.
    const raw = regionValueAtDrag(
      drag.startValue,
      clientX - drag.startClientX,
      drag.fractionPerPx,
    )
    // Clamped only to 0..1 here. The real clamp is against the OTHER edge and
    // lives in the editor's `regionTrimEdit`, which reads the document rather
    // than the drawn mark — the ghost is a preview, not the decision.
    const value = Math.min(1, Math.max(0, raw))
    drag.value = value
    const box = layoutRef.current.boxes.find((b) => b.laneKey === drag.laneKey)
    setRegionGhost({
      left: drag.rect.x + scrollLeftRef.current + (value - drag.startValue) / drag.fractionPerPx,
      top: box?.top ?? drag.rect.y,
      height: box?.height ?? drag.rect.h,
      label: `${drag.side} ${value.toFixed(2)}`,
    })
  }, [])

  // Apply an extend at a given clientX: map the cursor to a whole-cycle weight at
  // the CONSTANT rest px/cycle (edge tracks the cursor 1:1), grow the visual span
  // so there's room past the edge, and move the trim-edge ghost. Shared by the
  // pointer-move handler and the rAF auto-scroll so HOLDING at the edge keeps
  // extending against the scrolled-in room (#487).
  const applyTrim = React.useCallback(
    (clientX: number): void => {
      const drag = trimDragRef.current
      const el = areaRef.current
      if (!drag || !el) return
      const rect = el.getBoundingClientRect()
      const ppc = restPxPerCycle(rect.width)
      if (ppc <= 0) return
      const contentX = clientX - rect.left + scrollLeftRef.current
      // A bare resize (#662, armIndex < 0) clamps to MIN_BARE_SPLIT_SPAN so the
      // loop never shrinks below a splittable 2 bars; a real arm keeps its ≥ 1
      // cycle weight (startCycle + 1). Bare startCycle is 0, so newEnd === span.
      const floor = drag.armIndex < 0 ? MIN_BARE_SPLIT_SPAN : drag.startCycle + 1
      // `contentX / ppc` is cycles from the LEFT EDGE OF THE WINDOW and carries
      // no origin, while `drag.startCycle` is song-absolute (scene cycles stay
      // absolute so clip write-back lands on the bar the user dragged). The two
      // frames coincide only at origin 0, which is why this read correctly for
      // as long as there was one window — see #1203. The axis owns the
      // conversion, and returns the span alongside the end so the position and
      // the length cannot pick up the origin independently of each other.
      const { endCycle: newEnd, spanCycles: needed } = trimExtent({
        contentX,
        pxPerCycle: ppc,
        originCycle: songOriginCycles,
        floorCycle: floor,
        marginCycles: EXTEND_MARGIN_CYCLES,
        minSpanCycles: loopCyclesRef.current,
      })
      drag.weight = newEnd - drag.startCycle
      if (dragSpanRef.current == null || needed > dragSpanRef.current) {
        dragSpanRef.current = needed
        setDragSpanCycles(needed)
      }
      const gcw = dragAwareContentWidth(rect.width)
      setTrimEdgeX(songCycleToX(newEnd, { originCycle: songOriginCycles, spanCycles: dragSpanRef.current ?? loopCyclesRef.current }, gcw))
    },
    [restPxPerCycle, dragAwareContentWidth, songOriginCycles],
  )

  const stopExtendAutoScroll = React.useCallback((): void => {
    if (trimRafRef.current != null) {
      cancelAnimationFrame(trimRafRef.current)
      trimRafRef.current = null
    }
  }, [])

  // Auto-scroll loop: while a trim drag holds the cursor in the right-edge band,
  // advance scrollLeft each frame (programmatic — marked so the scroll handler
  // doesn't treat it as a user pan, PV118) and re-apply the extend so the edge
  // follows the revealed empty timeline. Self-cancels when the drag ends or the
  // cursor leaves the band.
  const extendAutoScrollTick = React.useCallback((): void => {
    const drag = trimDragRef.current
    const el = areaRef.current
    if (!drag || !el) {
      trimRafRef.current = null
      return
    }
    const rect = el.getBoundingClientRect()
    const into = drag.lastClientX - (rect.left + rect.width - EXTEND_AUTOSCROLL_BAND_PX)
    if (into > 0) {
      const gcw = dragAwareContentWidth(rect.width)
      const maxScroll = Math.max(0, gcw - rect.width)
      const step = Math.min(EXTEND_AUTOSCROLL_STEP_PX, Math.max(2, into * 0.16))
      const next = Math.min(maxScroll, scrollLeftRef.current + step)
      if (next > scrollLeftRef.current) {
        scrollLeftRef.current = next
        programmaticScrollRef.current = next
        el.scrollLeft = next
        setScrollLeft(next)
        applyTrim(drag.lastClientX)
      }
    }
    trimRafRef.current = requestAnimationFrame(extendAutoScrollTick)
  }, [applyTrim, dragAwareContentWidth])

  const handleGridPointerDown = React.useCallback(
    (e: React.PointerEvent) => {
      // Take keyboard focus on any grid press so the clip-op shortcuts (S split,
      // ⌘/Ctrl-D duplicate, Delete/Backspace) reach `handleGridKeyDown`. The
      // clip-select and trim branches below call `preventDefault()` (to suppress
      // text selection + the native drag image), which ALSO suppresses the
      // browser's default focus-on-pointerdown — so without this explicit focus
      // the grid (tabIndex=0) never becomes `document.activeElement` and the
      // keystroke leaks to Monaco / the last-focused control (#488). `preventScroll`
      // so taking focus never yanks the timeline into view mid-gesture.
      areaRef.current?.focus({ preventScroll: true })
      // #1464 Stage 2 — FIRST, before any clip test. See `captionAt`: these
      // pixels are contested, and precedence is how this component already
      // resolves that (the trim test precedes the body test for the same
      // reason). Returning here is what keeps a caption click from also
      // selecting a clip, arming the clip shortcuts, or jumping the editor.
      const caption = editableCaptionAt(e.clientX, e.clientY)
      if (caption) {
        e.preventDefault()
        captionCommittedRef.current = false
        setEditingCaption(caption)
        return
      }
      const hit = clipEdgeAt(e.clientX, e.clientY)
      if (!hit) {
        // #1527 — a MARK's edge, tested after the clip edge and before the clip
        // body. After, because the arrangement trim is the established gesture
        // and a mark landing within a few px of an arm boundary is rare; before,
        // because a mark sits ON a clip body, so testing the body first would
        // swallow every region grab into a select.
        const edge = regionEdgeAtClient(e.clientX, e.clientY)
        if (edge) {
          e.preventDefault()
          try {
            areaRef.current?.setPointerCapture?.(e.pointerId)
          } catch {
            /* capture is best-effort (jsdom / inactive pointer) — drag still works */
          }
          userScrollUntilRef.current = Date.now() + USER_SCROLL_GUARD_MS
          const playing = {
            begin: markRegionValue(edge.note, 'begin'),
            end: markRegionValue(edge.note, 'end'),
          }
          const startValue = playing[edge.side]
          regionDragRef.current = {
            ...edge,
            pointerId: e.pointerId,
            startClientX: e.clientX,
            startValue,
            playing,
            value: startValue,
          }
          applyRegionTrim(e.clientX)
          return
        }
        // Not a clip edge. A press on a clip BODY begins a PENDING gesture that
        // resolves on pointer-up: a MOVE drag if the pointer travelled, else a
        // click (select + seek). A press off any clip clears selection + seeks.
        const interactive = !!(onDeleteClip || onMoveClip || onDuplicateClip || onSplitClip)
        // Include the bare clip: it's selectable (#489). It won't move — a bare
        // press has no reorder target (armSpansNow is empty) and the move commit
        // no-ops for armIndex < 0, so the gesture resolves to a select on pointer-up.
        const body = interactive ? clipBodyAt(e.clientX, e.clientY, true) : null
        if (body) {
          e.preventDefault()
          try {
            areaRef.current?.setPointerCapture?.(e.pointerId)
          } catch {
            /* best-effort (jsdom / inactive pointer) */
          }
          userScrollUntilRef.current = Date.now() + USER_SCROLL_GUARD_MS
          moveDragRef.current = {
            pointerId: e.pointerId,
            // Clip gestures bind the OUTER combinator (#451) so a nested
            // arrange-of-cat arm edits as one outer clip; falls back to the
            // inner anchor (equal for a non-nested lane). Bind keeps `sourceOffset`.
            sourceOffset: body.lane.arrangeOffset ?? body.lane.sourceOffset,
            armIndex: body.clip.armIndex,
            laneKey: body.lane.laneKey,
            startClientX: e.clientX,
            startCycle: body.clip.startCycle,
            endCycle: body.clip.endCycle,
            dragging: false,
            toIndex: body.clip.armIndex,
          }
          return
        }
        setSelected(null)
        // #610 — a press on a lane row jumps to its code (seek moved to the
        // ruler). A press in truly empty space (no lane at this Y) is a no-op.
        jumpToLaneAtClientY(e.clientY)
        return
      }
      // Begin a trim drag: capture the pointer so the whole gesture is ours and
      // suspend follow so auto-scroll doesn't fight it mid-drag.
      e.preventDefault()
      try {
        areaRef.current?.setPointerCapture?.(e.pointerId)
      } catch {
        /* capture is best-effort (jsdom / inactive pointer) — drag still works */
      }
      userScrollUntilRef.current = Date.now() + USER_SCROLL_GUARD_MS
      const w = hit.clip.endCycle - hit.clip.startCycle
      trimDragRef.current = {
        pointerId: e.pointerId,
        // Outer-combinator anchor for the arrange op (#451); see move ref above.
        sourceOffset: hit.lane.arrangeOffset ?? hit.lane.sourceOffset,
        armIndex: hit.clip.armIndex,
        startCycle: hit.clip.startCycle,
        origWeight: w,
        weight: w,
        lastClientX: e.clientX,
      }
      const cw = dragAwareContentWidth(areaRef.current!.getBoundingClientRect().width)
      setTrimEdgeX(songCycleToX(hit.clip.endCycle, songWindow, cw))
    },
    [editableCaptionAt, clipEdgeAt, regionEdgeAtClient, applyRegionTrim, clipBodyAt, jumpToLaneAtClientY, displayCycles, dragAwareContentWidth, onDeleteClip, onMoveClip],
  )

  const handleGridPointerMove = React.useCallback(
    (e: React.PointerEvent) => {
      const el = areaRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      const cw = dragAwareContentWidth(rect.width)
      const drag = trimDragRef.current
      if (drag && e.pointerId === drag.pointerId) {
        // EXTEND: the edge tracks the cursor 1:1 at the constant rest px/cycle and
        // the span grows to make room (applyTrim). While the cursor is held in the
        // right-edge band, the rAF auto-scroll pulls more empty timeline into view
        // so the edge can keep going past the viewport (#487 — grow + auto-scroll).
        drag.lastClientX = e.clientX
        applyTrim(e.clientX)
        const into = e.clientX - (rect.left + rect.width - EXTEND_AUTOSCROLL_BAND_PX)
        if (into > 0) {
          if (trimRafRef.current == null) trimRafRef.current = requestAnimationFrame(extendAutoScrollTick)
        } else {
          stopExtendAutoScroll()
        }
        return
      }
      // Region trim (#1527): the edge follows the pointer at the scale frozen at
      // pointer-down. No auto-scroll — the value is bounded 0..1 and the whole
      // sweep is reachable inside `REGION_DRAG_SPAN_PX`, so there is nothing off
      // the edge of the viewport to scroll towards.
      const rd = regionDragRef.current
      if (rd && e.pointerId === rd.pointerId) {
        applyRegionTrim(e.clientX)
        return
      }
      // Move drag (Phase 5c): once the press travels past the threshold, preview
      // the reorder destination (the arm whose span the pointer falls in) and
      // stash it on the ref for commit. Only real arms reach here — a bare clip
      // can't start a move (clipBodyAt excludes it, #488).
      const mv = moveDragRef.current
      if (mv && e.pointerId === mv.pointerId) {
        if (!mv.dragging && Math.abs(e.clientX - mv.startClientX) < CLIP_MOVE_THRESHOLD_PX) return
        mv.dragging = true
        const contentX = e.clientX - rect.left + scrollLeftRef.current
        const cyc = xToSongCycle(contentX, songWindow, cw)
        const box = layoutRef.current.boxes.find((b) => b.laneKey === mv.laneKey)
        const spans = armSpansNow()
        let to = mv.armIndex
        if (spans.length) {
          const inSpan = spans.find((s) => cyc >= s.startCycle && cyc < s.endCycle)
          to = inSpan
            ? inSpan.armIndex
            : cyc < spans[0].startCycle
              ? spans[0].armIndex
              : spans[spans.length - 1].armIndex
        }
        mv.toIndex = to
        const tgt = spans.find((s) => s.armIndex === to)
        if (box && tgt) {
          const left = songCycleToX(tgt.startCycle, songWindow, cw)
          const right = songCycleToX(tgt.endCycle, songWindow, cw)
          setMoveGhost({ left, width: Math.max(2, right - left), top: box.top, height: box.height })
        }
        return
      }
      // Not dragging: cursor affordance — col-resize over an edge, grab over a
      // movable body. Direct style write (no React state) so hover never churns.
      // The mark edge shows the same `col-resize` as a clip edge and is tested
      // in the same order the press is, so what the cursor promises and what the
      // press does cannot come apart.
      el.style.cursor = clipEdgeAt(e.clientX, e.clientY)
        ? 'col-resize'
        : regionEdgeAtClient(e.clientX, e.clientY)
          ? 'col-resize'
          : onMoveClip && clipBodyAt(e.clientX, e.clientY)
            ? 'grab'
            : ''
    },
    // #1210 — `songWindow`, not `displayCycles`: this handler maps the pointer
    // through the window itself (the move-target highlight), so a paged origin
    // has to re-create it.
    [clipEdgeAt, regionEdgeAtClient, applyRegionTrim, clipBodyAt, armSpansNow, songWindow, dragAwareContentWidth, applyTrim, extendAutoScrollTick, stopExtendAutoScroll, onMoveClip],
  )

  const endTrimDrag = React.useCallback(
    (e: React.PointerEvent, commit: boolean) => {
      const drag = trimDragRef.current
      if (!drag || e.pointerId !== drag.pointerId) return
      trimDragRef.current = null
      setTrimEdgeX(null)
      stopExtendAutoScroll()
      // Collapse the transient extend room → refit to the song (no permanent
      // blank). The committed re-eval grows the period so the extended clip
      // fills the timeline; until then we snap back to the pre-drag fit.
      if (dragSpanRef.current != null) {
        dragSpanRef.current = null
        setDragSpanCycles(null)
        scrollLeftRef.current = 0
        programmaticScrollRef.current = 0
        if (areaRef.current) areaRef.current.scrollLeft = 0
        setScrollLeft(0)
      }
      try {
        areaRef.current?.releasePointerCapture?.(e.pointerId)
      } catch {
        /* best-effort */
      }
      if (commit && drag.weight !== drag.origWeight) {
        if (drag.armIndex < 0) {
          // #662 — a bare resize sets the DISPLAY span only (option B): persist
          // the chosen bar count, write NO code. `drag.weight` is the new span
          // (bare startCycle is 0). The override flows into `displaySpan`, and
          // thence into the bare clip's `endCycle` — so a later Split/Delete
          // operates at this granularity for free (they read the clip width).
          setBareSpanOverride(drag.weight)
        } else {
          onTrimClip?.({
            sourceOffset: drag.sourceOffset,
            armIndex: drag.armIndex,
            weight: drag.weight,
          })
        }
      }
    },
    [onTrimClip, stopExtendAutoScroll],
  )

  // Cancel any in-flight extend auto-scroll on unmount (the drag's own teardown
  // handles the normal case; this guards an unmount mid-drag).
  useEffect(() => stopExtendAutoScroll, [stopExtendAutoScroll])

  // End a body gesture (Phase 5c). A non-drag is a CLICK → select (real arm) +
  // seek. A drag commits a MOVE: reorder a real arm, or wrap a bare clip (§2.1).
  const endBodyDrag = React.useCallback(
    (e: React.PointerEvent, commit: boolean) => {
      const mv = moveDragRef.current
      if (!mv || e.pointerId !== mv.pointerId) return
      moveDragRef.current = null
      setMoveGhost(null)
      try {
        areaRef.current?.releasePointerCapture?.(e.pointerId)
      } catch {
        /* best-effort */
      }
      if (!mv.dragging) {
        // A click selects the clip — real arm OR a bare track's implicit clip
        // (armIndex < 0), which is then splittable/deletable (#489) — AND jumps
        // the editor to that track's code (#610; seek now lives on the ruler).
        // For a bare clip, record WHICH whole-cycle bar was clicked (the Delete
        // gap target / 1-bar highlight); clamped to the clip's [start, end).
        let barCycle: number | undefined
        if (mv.armIndex < 0) {
          const el = areaRef.current
          if (el) {
            const rect = el.getBoundingClientRect()
            const cw = dragAwareContentWidth(rect.width)
            const contentX = e.clientX - rect.left + scrollLeftRef.current
            // Read the LIVE span via the ref (this fires imperatively on pointer-up).
            const cyc = Math.floor(xToSongCycle(contentX, songWindowRef.current, cw))
            barCycle = Math.max(mv.startCycle, Math.min(cyc, mv.endCycle - 1))
          }
        }
        setSelected({ laneKey: mv.laneKey, armIndex: mv.armIndex, sourceOffset: mv.sourceOffset, barCycle })
        jumpToLaneAtClientY(e.clientY)
        return
      }
      if (!commit) return
      // Only real arms reach a move commit (bare clips never start one, #488).
      if (mv.toIndex !== mv.armIndex) {
        onMoveClip?.({ kind: 'reorder', sourceOffset: mv.sourceOffset, fromIndex: mv.armIndex, toIndex: mv.toIndex })
        // The arm list reindexes after a reorder, so the held armIndex would
        // now point at a different clip — clear it (matching DELETE).
        setSelected(null)
      }
    },
    [jumpToLaneAtClientY, onMoveClip, dragAwareContentWidth],
  )

  /**
   * End a region trim (#1527). A commit hands the value up; the parent decides
   * whether the document can take it, and says so if it cannot.
   *
   * A drag that never moved is NOT a commit: `regionTrimEdit` would report it as
   * no-change anyway, but stopping here means a stray click on a mark edge does
   * not travel through the whole write path to be refused at the far end.
   */
  const endRegionDrag = React.useCallback(
    (e: React.PointerEvent, commit: boolean) => {
      const drag = regionDragRef.current
      if (!drag || e.pointerId !== drag.pointerId) return
      regionDragRef.current = null
      setRegionGhost(null)
      try {
        areaRef.current?.releasePointerCapture?.(e.pointerId)
      } catch {
        /* best-effort */
      }
      if (commit && drag.value !== drag.startValue) {
        const lane = sceneRef.current.lanes.find((l) => l.laneKey === drag.laneKey)
        // Statement anchor first, content anchor second. `playing` travels with
        // them so the parent can check that the chunk an anchor resolves to
        // really owns this mark's region before writing through it — no single
        // anchor is right for every spelling a take can be written in.
        const anchors = [lane?.labelOffset, lane?.sourceOffset].filter(
          (o, i, all): o is number => typeof o === 'number' && all.indexOf(o) === i,
        )
        onTrimRegion?.({
          anchors,
          side: drag.side,
          value: drag.value,
          playing: drag.playing,
        })
      }
    },
    [onTrimRegion],
  )

  // Unified pointer end: a live trim drag wins; otherwise resolve the body
  // gesture. Cancel discards (no commit).
  const handleGridPointerUp = React.useCallback(
    (e: React.PointerEvent) => {
      if (regionDragRef.current) {
        endRegionDrag(e, true)
        return
      }
      if (trimDragRef.current) {
        endTrimDrag(e, true)
        return
      }
      endBodyDrag(e, true)
    },
    [endRegionDrag, endTrimDrag, endBodyDrag],
  )
  const handleGridPointerCancel = React.useCallback(
    (e: React.PointerEvent) => {
      if (regionDragRef.current) {
        endRegionDrag(e, false)
        return
      }
      if (trimDragRef.current) {
        endTrimDrag(e, false)
        return
      }
      endBodyDrag(e, false)
    },
    [endRegionDrag, endTrimDrag, endBodyDrag],
  )

  // Delete/Backspace on the focused grid removes the selected clip. The grid is
  // focusable (tabIndex) so a click-to-select leaves it ready for the keystroke.
  const handleGridKeyDown = React.useCallback(
    (e: React.KeyboardEvent) => {
      if (!selected) return
      // A bare track's implicit clip (armIndex < 0) supports SPLIT and DELETE,
      // both of which materialize the combinator (#489). DUPLICATE stays out of
      // scope (cloning a uniform bar into arrange is audibly identical — a
      // no-op the user can reach by split-then-edit).
      const bareClip = selected.armIndex < 0
      // ⌘/Ctrl-D duplicates the selected clip (insert a clone arm after it).
      // ⚠ `!e.shiftKey` is load-bearing. `e.key` is the PRODUCED CHARACTER, so
      // Shift+d is literally `'D'` — without the guard, ⌘⇧D fell through to
      // here and duplicated (observed, #1421). Harmless in itself, but it was
      // an undocumented binding that quietly edits the arrangement, and it sat
      // on the chord an "add section" gesture would naturally want (#1347).
      // ⚠ The bare-letter `S` check below deliberately does NOT get this guard:
      // there, accepting `'S'` is capslock tolerance on an unmodified key,
      // which is a different situation from widening a modifier chord.
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && (e.key === 'd' || e.key === 'D')) {
        if (!onDuplicateClip || bareClip) return
        e.preventDefault()
        onDuplicateClip({ sourceOffset: selected.sourceOffset, armIndex: selected.armIndex })
        // A clone arm is inserted after the selection, shifting later indices —
        // clear the held armIndex so a follow-up keystroke can't hit the wrong clip.
        setSelected(null)
        return
      }
      // ⚠ RIPPLE MUST BE TESTED BEFORE PLAIN DELETE, AND THIS ORDERING IS THE
      // GUARD (#1460). The branch below matches `Delete`/`Backspace` with no
      // modifier check at all, so Cmd+Shift+Delete would reach it and clear the
      // clip in place — the same shape as the ⌘⇧D fall-through that duplicated
      // silently (#1421), and worse here, because the two gestures differ in
      // whether the SONG GETS SHORTER.
      //
      // Returning when the handler is absent is deliberate rather than lazy:
      // falling through would leave the chord quietly bound to the other
      // gesture, which is exactly the undocumented binding #1421 was about.
      // F2 (and Enter) opens the section-rename editor over the selected clip
      // (#1417 Stage 3). F2 is the platform's rename key and Enter is what people
      // reach for on a selected thing; both are offered because neither alone is
      // discoverable on a canvas that has no double-clickable node.
      //
      // ⚠ THIS IS WHAT MAKES THE SHIPPED PRIMITIVES REACHABLE AT ALL. The pick
      // rename landed on trunk with zero callers, so a musician could not rename
      // anything; a second primitive without a gesture would just have doubled
      // the unreachable code.
      if ((e.key === 'F2' || e.key === 'Enter') && !e.metaKey && !e.ctrlKey && !e.altKey) {
        if (!onRenameSection || bareClip) return
        const lane = sceneRef.current.lanes.find((l) => l.laneKey === selected.laneKey)
        const clip = lane?.clips.find((c) => c.armIndex === selected.armIndex)
        if (!clip) return
        e.preventDefault()
        sectionCommittedRef.current = false
        setEditingSection({
          laneKey: selected.laneKey,
          armIndex: selected.armIndex,
          sourceOffset: selected.sourceOffset,
          name: clip.sectionName,
          count:
            sectionArmCount?.({ sourceOffset: selected.sourceOffset, armIndex: selected.armIndex }) ??
            0,
        })
        return
      }
      // Cmd/Ctrl+I inserts an empty section after the selection (#1461) — the
      // chord Ableton gives Insert Silence. Nothing else on this grid claims it:
      // the worry recorded on the duplicate branch, that an add gesture would
      // want ⌘D's chord, was retired by reading the manuals rather than guessing.
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && (e.key === 'i' || e.key === 'I')) {
        if (!onInsertSilenceClip || bareClip) return
        e.preventDefault()
        onInsertSilenceClip({ sourceOffset: selected.sourceOffset, armIndex: selected.armIndex })
        // A new arm lands after the selection and shifts every later index — the
        // held armIndex would address the wrong clip on the next keystroke.
        setSelected(null)
        return
      }
      if (
        (e.metaKey || e.ctrlKey) &&
        e.shiftKey &&
        (e.key === 'Delete' || e.key === 'Backspace')
      ) {
        if (!onRippleDeleteClip || bareClip) return
        e.preventDefault()
        onRippleDeleteClip({ sourceOffset: selected.sourceOffset, armIndex: selected.armIndex })
        // The arm is gone and every later index shifts down by one — the held
        // armIndex now addresses a different clip, so a follow-up keystroke must
        // not reach it. Same reason duplicate and split clear it.
        setSelected(null)
        return
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (!onDeleteClip) return
        e.preventDefault()
        if (bareClip) {
          // #489 — silence the SELECTED bar of the bare loop (gap). Needs the
          // clicked bar index + the loop's whole display span; the parent
          // materializes arrange([…,pat],[1,silence],[…,pat]). Derive span from
          // the live scene clip (its floored width, #489 D3).
          const lane = sceneRef.current.lanes.find((l) => l.laneKey === selected.laneKey)
          const clip = lane?.clips.find((c) => c.armIndex < 0)
          if (!clip) return
          onDeleteClip({
            sourceOffset: selected.sourceOffset,
            armIndex: selected.armIndex,
            barIndex: selected.barCycle ?? clip.startCycle,
            span: clip.endCycle - clip.startCycle,
          })
        } else {
          onDeleteClip({ sourceOffset: selected.sourceOffset, armIndex: selected.armIndex })
        }
        setSelected(null)
        return
      }
      // `S` splits the selected clip at its midpoint (whole-cycle boundary). Only
      // a clip ≥ 2 cycles is splittable — derive the span from the live scene.
      if ((e.key === 's' || e.key === 'S') && !e.metaKey && !e.ctrlKey && !e.altKey) {
        if (!onSplitClip) return
        const lane = sceneRef.current.lanes.find((l) => l.laneKey === selected.laneKey)
        const clip = lane?.clips.find((c) => c.armIndex === selected.armIndex)
        if (!clip) return
        const weight = clip.endCycle - clip.startCycle
        if (weight < 2) return
        e.preventDefault()
        onSplitClip({
          sourceOffset: selected.sourceOffset,
          armIndex: selected.armIndex,
          firstWeight: Math.floor(weight / 2),
          // For a bare clip the span IS the whole-song width — the parent
          // materializes `arrange([k, pat], [span−k, pat])` (#489).
          span: weight,
        })
        // Split inserts a second arm, reindexing the list — clear the selection.
        setSelected(null)
      }
    },
    [selected, onDeleteClip, onDuplicateClip, onSplitClip, onRippleDeleteClip, onInsertSilenceClip, onRenameSection, sectionArmCount],
  )

  // The selection highlight rect, derived from the LIVE scene + layout so it
  // follows zoom/scroll and vanishes if the arm disappears after a re-eval.
  const selectionRect = useMemo(() => {
    if (!selected) return null
    const lane = scene.lanes.find((l) => l.laneKey === selected.laneKey)
    const clip = lane?.clips.find((c) => c.armIndex === selected.armIndex)
    const box = layout.boxes.find((b) => b.laneKey === selected.laneKey)
    if (!lane || !clip || !box) return null
    // #489 — a bare clip highlights only the SELECTED 1-cycle bar (what Delete
    // silences), not the whole tiled loop; real arms highlight their full span.
    const isBareBar = clip.armIndex < 0 && selected.barCycle != null
    const startCycle = isBareBar ? (selected.barCycle as number) : clip.startCycle
    const endCycle = isBareBar ? (selected.barCycle as number) + 1 : clip.endCycle
    const left = songCycleToX(startCycle, songWindow, contentWidth)
    const right = songCycleToX(endCycle, songWindow, contentWidth)
    return { left, width: Math.max(1, right - left), top: box.top, height: box.height }
  }, [selected, scene, layout, displayCycles, contentWidth])

  // The three readouts are the three span kinds — one branch each, so a new
  // kind is a compile error here rather than a silently reused label.
  const periodLabel =
    analysis == null
      ? '—'
      : analysis.displaySpan.kind === 'loop'
        ? `loop ${analysis.displaySpan.cycles}`
        : analysis.displaySpan.kind === 'capped'
          ? `${analysis.displaySpan.cycles}+ cycles`
          : `${analysis.displaySpan.cycles} cycles`

  // The span is where the analysis STOPPED LOOKING, not the song's length, and
  // until now nothing said so: `periodLabel` above is written to a `display:none`
  // attribute for Playwright and rendered nowhere (#1105). A song that never
  // repeats got a 256-cycle timeline that reads exactly like a measured 256-cycle
  // loop. Shown only for a `capped` span, because that is the only case where the
  // number means something other than what it appears to mean.
  //
  // The second clause is the complement of not wrapping the playhead: once the
  // transport passes the span the playhead is withheld (`wrapSongPosition`), so
  // without a word here the view would look stopped. Read from the SAME `looping`
  // and `songPos` the playhead uses, so the two cannot contradict each other.
  // Absolute position against the absolute end of the window, not against its width.
  const beyondSpan = !looping && isBeyondWindow(songPos, loopWindow)
  const fallbackNotice = !looping ? windowNotice(loopWindow, beyondSpan) : null

  const zoomPercent = Math.round(zoom * 100)

  return (
    <div data-full-song="root" role="region" aria-label="Song" style={styles.root}>
      {/* Status lives in the parent's unified bar (with the view toggle); this
          view renders the controls + ruler + heatmap only. `periodLabel` is
          surfaced via the data attribute below for Playwright observation. */}
      <div data-full-song-period={periodLabel} style={{ display: 'none' }} />

      {/* Controls: zoom cluster (left). The CYCLES/BARS units toggle moved to
          the editor pattern bar (#750). ⌘/Ctrl+wheel also zooms. */}
      <div data-full-song="controls" style={styles.controls}>
        <div style={styles.zoomCluster} data-full-song-zoom={zoomPercent}>
          <button
            type="button"
            data-full-song-follow-toggle
            data-follow={follow ? 'on' : 'off'}
            aria-pressed={follow}
            onClick={() => setFollow((f) => !f)}
            style={{
              ...styles.unitsToggle,
              ...(follow ? styles.followOn : null),
            }}
            title={follow ? 'Following the playhead — click to stop' : 'Follow the playhead while playing'}
          >
            FOLLOW
          </button>
          <button
            type="button"
            data-full-song-zoom-fit
            onClick={fitZoom}
            disabled={zoom <= MIN_ZOOM}
            style={styles.zoomButton}
            title="Fit the whole song"
          >
            Fit
          </button>
          <button
            type="button"
            data-full-song-zoom-out
            onClick={() => zoomBy(1 / ZOOM_STEP)}
            disabled={zoom <= MIN_ZOOM}
            style={styles.zoomButton}
            title="Zoom out"
          >
            −
          </button>
          <span style={styles.zoomReadout}>{zoomPercent}%</span>
          <button
            type="button"
            data-full-song-zoom-in
            onClick={() => zoomBy(ZOOM_STEP)}
            style={styles.zoomButton}
            title="Zoom in"
          >
            +
          </button>
        </div>
        {/* The span is a stopping point, not a measurement — say so (#1105).
            `role="status"` so a screen reader announces the change from
            "showing first N" to "playing past N" without stealing focus. */}
        {fallbackNotice != null && (
          <span
            data-full-song-fallback-notice={fallbackNotice}
            role="status"
            style={styles.fallbackNotice}
            title="This song never repeats, so the timeline shows the opening stretch rather than a loop. Zoom in to read it."
          >
            {fallbackNotice}
          </span>
        )}
      </div>

      {/* Ruler: cycle/bar ticks + clickable seek surface + playhead */}
      <div data-full-song="ruler" style={styles.topbar}>
        <div style={styles.gutter}>
          <span style={styles.caption}>SONG</span>
        </div>
        <div
          data-full-song="ruler-area"
          style={styles.rulerArea}
          onPointerDown={(e) => handleSeekAtClientX(e.clientX)}
        >
          {/* Inner content tracks the grid's horizontal scroll via translateX */}
          <div
            data-full-song="ruler-content"
            style={{ ...styles.scrollContent, width: contentWidth, transform: `translateX(${-scrollLeft}px)` }}
          >
            {areaWidth > 0 &&
              ticks.map((t) => (
                <div
                  key={`tick-${t.cycle}`}
                  data-full-song-tick={t.major ? 'major' : 'beat'}
                  style={{
                    ...(t.major ? styles.tickMajor : styles.tickBeat),
                    left: songCycleToX(t.cycle, songWindow, contentWidth),
                  }}
                >
                  {t.label != null && <span style={styles.tickLabel}>{t.label}</span>}
                </div>
              ))}
            {playheadVisible && (
              <div
                data-full-song="ruler-playhead-arrow"
                style={{ ...styles.playheadArrow, left: playheadX }}
              />
            )}
          </div>
        </div>
      </div>

      {/* Body: lane labels + onset heatmap grid */}
      <div style={styles.body}>
        <div data-full-song="lane-labels" style={styles.labels}>
          {layout.boxes.length === 0 ? (
            <div style={styles.emptyLabel}>No song to map yet — press play.</div>
          ) : (
            <div
              ref={gutterInnerRef}
              data-full-song="lane-labels-inner"
              style={{
                display: 'flex',
                flexDirection: 'column' as const,
                // Keep the true total height (don't let the flex gutter squish the
                // stack to its own height — the #645 squish, one level up).
                flexShrink: 0,
                // #655 — the gutter rows ride the grid's native vertical scroll. The
                // transform is set imperatively in handleGridScroll (lag-free); this
                // style keeps it correct across unrelated re-renders.
                transform: `translateY(${-scrollTop}px)`,
                willChange: 'transform',
              }}
            >
            {layout.boxes.map((box) => {
              // An expanded multi-voice lane (#424) shows its identity on sub-row
              // 0 (`laneKey · voice0`, like the live monitor) and an indented
              // label per remaining voice, positioned from the SAME layout so
              // they line up with the canvas sub-rows exactly (PV120). A
              // collapsed / single-voice lane renders the plain header.
              const subRows = box.subRows
              const headerHeight = subRows ? subRows[0].height : box.height
              // Display NAME + dot colour resolve to the track LABEL for a named
              // track (#579 STEP 2); fall back to the positional `laneKey` when
              // the lane has no scene entry (defensive — should always match).
              const lane = laneByKey.get(box.laneKey)
              const displayName = lane?.displayName ?? box.laneKey
              const dotColor = lane?.color ?? paletteForTrack(trackIndexOf(box.laneKey), box.laneKey)
              const headerName = subRows ? `${displayName} · ${subRows[0].label}` : displayName
              // Inline rename (#580, Phase C): renameable when a write handler is
              // wired AND the lane has a statement anchor. The seed is the current
              // label for a named track, EMPTY for an anonymous `d{N}` (its
              // display isn't real code) — a name comes from an explicit edit.
              const renameAnchor = lane?.labelOffset ?? null
              const renameEnabled = onRenameLane !== undefined && renameAnchor != null
              // #610 — clicking anywhere on the header reveals the track's code.
              // Prefer the STATEMENT head (`labelOffset`, the Mixer's anchor); fall
              // back to the innermost atom (`sourceOffset`) for a lane with no
              // statement label, so the jump still lands inside the track.
              const selectOffset = lane?.labelOffset ?? lane?.sourceOffset ?? null
              const selectEnabled = onSelectLane !== undefined && selectOffset != null
              const renameSeed = displayName === box.laneKey ? '' : displayName
              const isRenaming = renamingLane === box.laneKey
              // Colour picker (Phase D, #581): the dot opens a swatch popover when
              // a write handler is wired. The override is keyed by the lane's
              // DISPLAY NAME (the same key the Mixer uses), so a colour set here
              // shows on the matching strip too.
              const colorPickerEnabled = onSetTrackColor !== undefined
              // #641/#642 — the lane the editor caret currently sits in is
              // selected. Keyed off the once-resolved `selectedLaneKey` so the
              // gutter row and the full-width grid band (below) light the SAME
              // lane, including anonymous lanes with no statement label.
              const isSelected = selectedLaneKey != null && box.laneKey === selectedLaneKey
              // #731 — a silenced track (muted / soloed-out) fades its whole gutter
              // row, mirroring the canvas band and the Mixer's dimmed strip. Keyed
              // by DISPLAY NAME (the Mixer's dim key), so the same track fades in
              // both views (PV155).
              const isSilenced = props.silencedNames?.has(displayName) ?? false
              return (
                <div
                  key={box.laneKey}
                  data-full-song-lane={box.laneKey}
                  data-full-song-lane-selected={isSelected ? box.laneKey : undefined}
                  data-full-song-lane-silenced={isSilenced ? displayName : undefined}
                  data-expanded={box.expanded ? 'true' : 'false'}
                  data-full-song-voices={subRows ? subRows.length : undefined}
                  style={{
                    ...styles.laneRow,
                    height: box.height,
                    ...(isSelected ? styles.laneRowSelected : null),
                    ...(isSilenced ? styles.laneRowSilenced : null),
                  }}
                  title={displayName}
                >
                  <div
                    data-full-song-lane-select={selectEnabled ? box.laneKey : undefined}
                    style={{
                      ...styles.laneHeader,
                      height: headerHeight,
                      cursor: selectEnabled ? 'pointer' : undefined,
                    }}
                    title={selectEnabled ? `${displayName} — click to jump to its code` : undefined}
                    onClick={
                      selectEnabled ? () => onSelectLane!(selectOffset!) : undefined
                    }
                  >
                    <button
                      type="button"
                      data-full-song-lane-expand={box.laneKey}
                      aria-pressed={box.expanded}
                      aria-label={box.expanded ? `Collapse ${displayName}` : `Expand ${displayName} to view its notes`}
                      onClick={(e) => {
                        // Caret keeps its own meaning (expand + bind); don't also
                        // fire the header's jump (#610).
                        e.stopPropagation()
                        activateLane(box.laneKey)
                      }}
                      style={styles.laneCaret}
                    >
                      {box.expanded ? '▾' : '▸'}
                    </button>
                    {colorPickerEnabled ? (
                      <button
                        type="button"
                        data-full-song-lane-dot={box.laneKey}
                        data-full-song-lane-swatch={box.laneKey}
                        aria-label={`Change colour of ${displayName}`}
                        title={`${displayName} — click to change colour`}
                        onClick={(e) => {
                          // Dot opens the colour picker only — not the #610 jump.
                          e.stopPropagation()
                          setColorPickerLane({
                            laneKey: box.laneKey,
                            name: displayName,
                            rect: e.currentTarget.getBoundingClientRect(),
                          })
                        }}
                        style={{
                          ...styles.laneDot,
                          background: dotColor,
                          padding: 0,
                          border: 'none',
                          cursor: 'pointer',
                        }}
                      />
                    ) : (
                      <span
                        data-full-song-lane-dot={box.laneKey}
                        style={{
                          ...styles.laneDot,
                          background: dotColor,
                        }}
                      />
                    )}
                    {isRenaming && renameAnchor != null ? (
                      <input
                        data-full-song-lane-rename={box.laneKey}
                        autoFocus
                        defaultValue={renameSeed}
                        placeholder="name this track"
                        spellCheck={false}
                        onFocus={(e) => e.currentTarget.select()}
                        // A click inside the rename input must NOT bubble to the
                        // header's #610 jump — that would reveal+focus the editor,
                        // blurring the input and committing the half-typed name.
                        onClick={(e) => e.stopPropagation()}
                        onKeyDown={(e) => {
                          // preventDefault BEFORE committing (#877): the commit
                          // unmounts this input, so the browser delivers the
                          // keystroke's default action to whatever takes focus
                          // next — the editor — typing it into the user's code.
                          if (e.key === 'Enter') {
                            e.preventDefault()
                            commitLaneRename(renameAnchor, e.currentTarget.value, displayName)
                          } else if (e.key === 'Escape') {
                            e.preventDefault()
                            cancelLaneRename()
                          }
                          e.stopPropagation() // keep the grid's key handlers out
                        }}
                        onBlur={(e) =>
                          commitLaneRename(renameAnchor, e.currentTarget.value, displayName)
                        }
                        style={styles.laneRenameInput}
                      />
                    ) : (
                      <span
                        style={{ ...styles.laneName, cursor: renameEnabled ? 'text' : 'default' }}
                        title={renameEnabled ? `${displayName} — double-click to rename` : undefined}
                        onDoubleClick={renameEnabled ? () => openLaneRename(box.laneKey) : undefined}
                      >
                        {headerName}
                      </span>
                    )}
                  </div>
                  {subRows?.slice(1).map((sr) => (
                    <div
                      key={sr.voiceKey}
                      data-full-song-voice={sr.voiceKey}
                      style={{ ...styles.voiceLabel, top: sr.top - box.top, height: sr.height }}
                      title={sr.label}
                    >
                      {sr.label}
                    </div>
                  ))}
                </div>
              )
            })}
            </div>
          )}
        </div>
        {colorPickerLane && onSetTrackColor && (
          <TrackSwatchPopover
            anchorRect={colorPickerLane.rect}
            currentColor={laneByKey.get(colorPickerLane.laneKey)?.color}
            onPick={(color) => onSetTrackColor(colorPickerLane.name, color)}
            onReset={
              onResetTrackColor
                ? () => onResetTrackColor(colorPickerLane.name)
                : undefined
            }
            onClose={() => setColorPickerLane(null)}
          />
        )}
        <div
          data-full-song="grid"
          ref={areaRef}
          style={styles.grid}
          tabIndex={0}
          onScroll={handleGridScroll}
          onPointerDown={handleGridPointerDown}
          onPointerMove={handleGridPointerMove}
          onPointerUp={handleGridPointerUp}
          onPointerCancel={handleGridPointerCancel}
          onKeyDown={handleGridKeyDown}
          onDoubleClick={(e) => {
            // A double-click is the natural gesture for "select this number to
            // retype it", and expanding/collapsing here would remove the very
            // caption being aimed at — captions are drawn on EXPANDED lanes only.
            if (editableCaptionAt(e.clientX, e.clientY)) return
            handleExpandAtClientY(e.clientY)
          }}
        >
          {/* Inner content is contentWidth wide (the scroll spacer for the native
              scrollbar); the canvas sits sticky inside and redraws the visible
              slice, while the playhead stays a DOM element in content space. */}
          <div
            data-full-song="grid-content"
            style={{ ...styles.scrollContent, width: contentWidth }}
          >
            {/* Canvas draws lanes (density + mini-note marks), sections, gridlines
                — all the high-volume mass — over the shared transform (PV116). */}
            {areaWidth > 0 && (
              <SongTimelineCanvas
                scene={scene}
                scrollLeft={scrollLeft}
                contentWidth={contentWidth}
                viewportWidth={areaWidth}
                layout={layout}
                silencedNames={props.silencedNames}
                waveforms={props.waveforms}
                waveformsEpoch={props.waveformsEpoch}
              />
            )}
            {/* Live overlay (#500/U3): lights the scene marks that are sounding
                now, over the static base canvas, under the playhead. Sits ABOVE
                the base canvas, BELOW the playhead/selection (DOM order). */}
            {areaWidth > 0 && props.getHapStream && (
              <SongTimelineLiveOverlay
                scene={scene}
                layout={layout}
                scrollLeft={scrollLeft}
                contentWidth={contentWidth}
                viewportWidth={areaWidth}
                playheadCycle={playheadVisible ? wrappedPos : null}
                getHapStream={props.getHapStream}
                waveforms={props.waveforms}
              />
            )}
            {/* Marks overlay (#506): playhead, trim edge, clip selection and move
                ghost live here, pinned to the viewport EXACTLY like the base
                canvas + live overlay (sticky left:0, pulled back over them with a
                negative margin) and offset by the SAME React-state `scrollLeft`
                the canvas draws against. Keeping every mark on the canvas's scroll
                clock — not the natively-scrolled content's integer `el.scrollLeft`
                — stops the playhead jittering against the lanes: the old
                content-space `left: playheadX` differenced the native, integer-
                quantized, current-frame scroll against the canvas's float,
                one-frame-lagged React scroll, a ~2px per-frame sawtooth. */}
            <div
              data-full-song="marks"
              style={{
                ...styles.marksOverlay,
                marginTop: -layout.totalHeight,
                width: areaWidth,
                height: layout.totalHeight,
              }}
            >
              {/* #642 — full-width selected-lane band across the grid, at the
                  selected lane's box. Pairs with the gutter row highlight so the
                  selection reads as one continuous band where the user is
                  actually looking (the marks, not the 88px label gutter).
                  Painted FIRST → under the playhead and clip-selection. */}
              {selectedBox && (
                <div
                  data-full-song="lane-selection"
                  data-full-song-lane-selection={selectedLaneKey ?? undefined}
                  style={{
                    ...styles.laneSelectionBand,
                    top: selectedBox.top,
                    height: selectedBox.height,
                    width: areaWidth,
                  }}
                />
              )}
              {playheadVisible && (
                <div data-full-song="playhead" style={{ ...styles.playhead, left: playheadX - scrollLeft }} />
              )}
              {/* #1464 Stage 2 — the bounds editor, sitting exactly over the
                  caption field it replaces. This overlay is the right home for
                  it: pinned left and scrolled in Y, which is the SAME frame the
                  caption is drawn and hit-tested in, so `box.x` and `box.y` need
                  no correction. The overlay is `pointerEvents: none`, so the
                  input re-enables them for itself alone. */}
              {editingCaption && (
                <input
                  data-full-song="automation-bound"
                  autoFocus
                  defaultValue={editingCaption.field.text}
                  aria-label={`${editingCaption.row.automation.paramKey} ${editingCaption.field.kind === 'lo' ? 'low' : 'high'} bound`}
                  style={{
                    ...styles.captionInput,
                    left: editingCaption.box.x,
                    top: editingCaption.box.y,
                    // Room to type a longer number than the one being replaced;
                    // a field sized to the old text cannot hold `2000` over `20`.
                    width: Math.max(editingCaption.box.w + 28, 44),
                    // The SAME rule the canvas painted the caption with, read
                    // from one place — see `automationColorOnLane`.
                    color: automationColorOnLane(
                      editingCaption.row.automation.paramKey,
                      sceneRef.current.lanes.find(
                        (l) => l.laneKey === editingCaption.row.automation.trackId,
                      )?.automations.length ?? 1,
                      DEFAULT_THEME.automationLine,
                    ),
                  }}
                  onPointerDown={(e) => e.stopPropagation()}
                  onDoubleClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => {
                    // ⚠ THIS LINE IS THE GUARD, not a belt over a brace. This
                    // input is a DOM DESCENDANT of the element carrying
                    // `handleGridKeyDown`, and React's `onKeyDown` bubbles —
                    // focus decides where a keystroke ORIGINATES, not whether it
                    // travels. So without this, BACKSPACE typed into a bound
                    // would reach the clip-delete branch and destroy the
                    // selected clip while the user was editing a number.
                    // An earlier comment here credited focus for the protection;
                    // it does not provide it. Pinned by the browser arm named
                    // "typing in a bound editor cannot delete the selected clip".
                    e.stopPropagation()
                    if (e.key === 'Escape') {
                      // Disarm as well as close: abandoning is a decision, and a
                      // blur arriving behind it must not commit what was typed.
                      captionCommittedRef.current = true
                      setEditingCaption(null)
                      return
                    }
                    if (e.key !== 'Enter') return
                    commitCaption(e.currentTarget.value)
                  }}
                  // Committing on blur as well as on Enter: clicking away from a
                  // half-typed number is the ordinary way people leave a field,
                  // and `captionEdit` returns null for anything it cannot do
                  // honestly, so a stray blur writes nothing on its own.
                  onBlur={(e) => commitCaption(e.currentTarget.value)}
                />
              )}
              {editingSection && selectionRect && (
                <>
                  <input
                    data-full-song="section-name"
                    autoFocus
                    defaultValue={editingSection.name}
                    aria-label="Section name"
                    style={{
                      ...styles.sectionInput,
                      left: selectionRect.left - scrollLeft + 2,
                      top: selectionRect.top + 2,
                      width: Math.max(selectionRect.width - 4, 56),
                    }}
                    onPointerDown={(e) => e.stopPropagation()}
                    onDoubleClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => {
                      // ⚠ THE GUARD, not a belt over a brace. This input is a DOM
                      // DESCENDANT of the element carrying `handleGridKeyDown`,
                      // and React's onKeyDown BUBBLES — focus decides where a
                      // keystroke originates, never whether it travels. Without
                      // this, Backspace typed into a name would reach the
                      // clip-delete branch and destroy the clip being renamed,
                      // and Enter would re-open the editor on top of itself.
                      e.stopPropagation()
                      if (e.key === 'Escape') {
                        // Disarm as well as close: abandoning is a decision, and
                        // a blur arriving behind it must not commit what was
                        // typed.
                        sectionCommittedRef.current = true
                        setEditingSection(null)
                        setSelected(null)
                        return
                      }
                      if (e.key !== 'Enter') return
                      commitSectionName(e.currentTarget.value)
                    }}
                    // Committing on blur as well as on Enter: clicking away from
                    // a half-typed name is the ordinary way people leave a field,
                    // and the primitive returns no edits for anything it cannot
                    // do honestly, so a stray blur writes nothing on its own.
                    onBlur={(e) => commitSectionName(e.currentTarget.value)}
                  />
                  {editingSection.count > 1 && (
                    // ⚠ SHOWN BEFORE THE WRITE, WHICH IS THE WHOLE SAFETY OF THIS
                    // GESTURE. A returning chorus is one pattern arranged twice,
                    // so renaming it moves every arm that names it. That is the
                    // honest edit; discovering it afterwards is what would not be.
                    <div
                      data-full-song="section-name-count"
                      style={{
                        ...styles.sectionCount,
                        left: selectionRect.left - scrollLeft + 2,
                        top: selectionRect.top + 18,
                      }}
                    >
                      {`renames ${editingSection.count} sections`}
                    </div>
                  )}
                </>
              )}
              {trimEdgeX != null && (
                <div data-full-song="trim-edge" style={{ ...styles.trimEdge, left: trimEdgeX - scrollLeft }} />
              )}
              {selectionRect && (
                <div
                  data-full-song="clip-selection"
                  style={{
                    ...styles.clipSelection,
                    left: selectionRect.left - scrollLeft,
                    width: selectionRect.width,
                    top: selectionRect.top,
                    height: selectionRect.height,
                  }}
                />
              )}
              {regionGhost && (
                <>
                  <div
                    data-full-song="region-edge"
                    style={{
                      ...styles.regionEdge,
                      left: regionGhost.left - scrollLeft,
                      top: regionGhost.top,
                      height: regionGhost.height,
                    }}
                  />
                  {/* The number, next to the edge. A region is a fraction of a
                      file — there is no ruler on screen that reads it off, so
                      without this the gesture is a guess until the code changes. */}
                  <div
                    data-full-song="region-edge-value"
                    style={{
                      ...styles.regionEdgeValue,
                      left: regionGhost.left - scrollLeft + 4,
                      top: regionGhost.top + 2,
                    }}
                  >
                    {regionGhost.label}
                  </div>
                </>
              )}
              {moveGhost && (
                <div
                  data-full-song="clip-move-ghost"
                  style={{
                    ...styles.moveGhost,
                    left: moveGhost.left - scrollLeft,
                    width: moveGhost.width,
                    top: moveGhost.top,
                    height: moveGhost.height,
                  }}
                />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

const styles = {
  root: {
    display: 'flex',
    flexDirection: 'column' as const,
    height: '100%',
    width: '100%',
    overflow: 'hidden',
    fontFamily: FONT_MONO,
    fontSize: 11,
    color: 'var(--text-body, #e2e8f0)',
    background: 'var(--bg-app, #090912)',
  },
  controls: {
    height: CONTROLS_HEIGHT,
    minHeight: CONTROLS_HEIGHT,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: 8,
    padding: '0 8px',
    background: 'var(--bg-app, #090912)',
    borderBottom: '1px solid var(--border-subtle, rgba(255,255,255,0.06))',
  },
  unitsToggle: {
    fontFamily: FONT_MONO,
    fontSize: 9,
    letterSpacing: '0.08em',
    padding: '2px 8px',
    borderRadius: 3,
    border: '1px solid var(--border-subtle, rgba(255,255,255,0.14))',
    background: 'var(--bg-input, rgba(255,255,255,0.04))',
    color: 'var(--text-tertiary, rgba(255,255,255,0.55))',
    cursor: 'pointer' as const,
  },
  followOn: {
    // Use the `border` shorthand (the base unitsToggle also sets `border`) —
    // mixing it with the `borderColor` longhand warns on rerender in React.
    border: '1px solid var(--accent, #6ea8fe)',
    color: 'var(--accent, #6ea8fe)',
    background: 'var(--accent-faint, rgba(110,168,254,0.12))',
  },
  zoomCluster: { display: 'flex', alignItems: 'center', gap: 4 },
  fallbackNotice: {
    fontFamily: FONT_MONO,
    fontSize: 11,
    lineHeight: 1,
    // Tertiary, not a warning colour: nothing is broken — the song genuinely
    // does not repeat, and the view is stating what it is showing.
    color: 'var(--text-tertiary, rgba(255,255,255,0.55))',
    whiteSpace: 'nowrap' as const,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  zoomButton: {
    fontFamily: FONT_MONO,
    fontSize: 11,
    lineHeight: 1,
    minWidth: 22,
    padding: '3px 6px',
    borderRadius: 3,
    border: '1px solid var(--border-subtle, rgba(255,255,255,0.14))',
    background: 'var(--bg-input, rgba(255,255,255,0.04))',
    color: 'var(--text-tertiary, rgba(255,255,255,0.55))',
    cursor: 'pointer' as const,
  },
  zoomReadout: {
    fontSize: 9,
    minWidth: 36,
    textAlign: 'center' as const,
    color: 'var(--text-tertiary, rgba(255,255,255,0.4))',
  },
  scrollContent: {
    position: 'relative' as const,
    height: '100%',
    minHeight: '100%',
  },
  topbar: {
    height: TOPBAR_HEIGHT,
    minHeight: TOPBAR_HEIGHT,
    background: 'var(--bg-panel, #14141f)',
    borderBottom: '1px solid var(--border-subtle, rgba(255,255,255,0.08))',
    display: 'flex',
    alignItems: 'stretch',
    fontSize: 10,
    color: 'var(--text-tertiary, rgba(255,255,255,0.4))',
  },
  gutter: {
    width: GUTTER_WIDTH,
    flexShrink: 0,
    borderRight: '1px solid var(--border-subtle, rgba(255,255,255,0.08))',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'flex-end',
    padding: '0 8px',
  },
  caption: { letterSpacing: '0.1em', textTransform: 'uppercase' as const },
  rulerArea: {
    flex: 1,
    position: 'relative' as const,
    overflow: 'hidden',
    cursor: 'pointer' as const,
  },
  tickMajor: {
    position: 'absolute' as const,
    bottom: 0,
    top: 0,
    width: 1,
    borderLeft: '1px solid var(--border-subtle, rgba(255,255,255,0.18))',
    pointerEvents: 'none' as const,
    display: 'flex',
    alignItems: 'flex-end',
  },
  tickBeat: {
    position: 'absolute' as const,
    bottom: 0,
    height: 5,
    width: 1,
    borderLeft: '1px solid var(--border-subtle, rgba(255,255,255,0.1))',
    pointerEvents: 'none' as const,
  },
  tickLabel: {
    fontSize: 9,
    lineHeight: 1,
    paddingLeft: 3,
    paddingBottom: 2,
    color: 'var(--text-tertiary, rgba(255,255,255,0.5))',
  },
  playheadArrow: {
    position: 'absolute' as const,
    top: 4,
    width: 0,
    height: 0,
    borderLeft: '5px solid transparent',
    borderRight: '5px solid transparent',
    borderTop: '7px solid var(--text-primary, rgba(255,255,255,0.7))',
    transform: 'translateX(-5px)',
    pointerEvents: 'none' as const,
  },
  body: {
    flex: 1,
    minHeight: 0,
    display: 'flex',
    overflow: 'auto',
    background: 'var(--bg-app, #090912)',
  },
  labels: {
    width: GUTTER_WIDTH,
    flexShrink: 0,
    borderRight: '1px solid var(--border-subtle, rgba(255,255,255,0.08))',
    display: 'flex',
    flexDirection: 'column' as const,
    // #645 — clip the stacked label rows at the column box so they collapse
    // exactly like the track rows on the right (which keep true heights and clip
    // via the grid's `overflowY: hidden`). Use `clip`, NOT `hidden`: `hidden` is
    // still a scroll CONTAINER, so focusing an expand button inside the gutter
    // let the browser scroll it independently of the grid (gutter drifted ~111px
    // out of alignment). `clip` is not a scrollport — the gutter can never gain
    // its own scroll offset, so it stays pinned to the canvas rows.
    overflow: 'clip' as const,
  },
  // Outer lane label box (relative so the per-voice sub-labels can absolutely
  // position against the lane top, lining up with the canvas sub-rows — #424).
  laneRow: {
    position: 'relative' as const,
    borderBottom: '1px solid var(--border-subtle, rgba(255,255,255,0.08))',
    overflow: 'hidden',
    // #645 — keep each row at its `box.height`. As a flex-column child the row
    // would otherwise SHRINK to fit a short gutter (default flex-shrink:1),
    // squishing every lane while the grid clips — the mismatched collapse. With
    // shrink off, the gutter honors the SAME lane heights the canvas draws, so
    // both sides collapse and reveal identically.
    flexShrink: 0,
  },
  // #641/#642 — caret-selected lane GUTTER: an accent fill + a 3px left accent
  // bar (inset box-shadow → no layout shift). Pairs with the full-width grid
  // band (`laneSelectionBand`) so the gutter label and the marks read as one
  // continuous selection. Tuned up from the original near-invisible 0.12/2px,
  // which was perceptible only in the 88px gutter and missed entirely against
  // the canvas where the user actually looks (#642).
  laneRowSelected: {
    background: 'var(--accent-faint, rgba(110,168,254,0.20))',
    boxShadow: 'inset 3px 0 0 var(--accent, #6ea8fe)',
  },
  // #731 — a silenced track (muted / soloed-out) fades its gutter row to the
  // SAME `opacity: 0.45` (+ 120ms ease) the Mixer dims a strip by (ChannelStrip
  // §6.5), so the label, dot and caret read "inactive" identically in both views
  // (PV155). The canvas band is faded in parallel by `drawTimeline`'s scrim.
  laneRowSilenced: {
    opacity: 0.45,
    transition: 'opacity 120ms ease',
  },
  // #642 — full-width selected-lane band over the grid marks. A translucent
  // accent fill + a top/bottom hairline + a left accent bar, bright enough to
  // read over the dark canvas and its coloured density bars without burying
  // them. pointerEvents:none so clicks fall through to the grid.
  laneSelectionBand: {
    position: 'absolute' as const,
    left: 0,
    background: 'var(--accent-faint, rgba(110,168,254,0.16))',
    boxShadow:
      'inset 3px 0 0 var(--accent, #6ea8fe), inset 0 1px 0 rgba(110,168,254,0.45), inset 0 -1px 0 rgba(110,168,254,0.45)',
    pointerEvents: 'none' as const,
  },
  // The lane identity row (caret + dot + name). Sits on sub-row 0 when the lane
  // is expanded into voices; fills the box otherwise.
  laneHeader: {
    padding: '5px 8px 0',
    display: 'flex',
    // Top-align so the dot/name sit at the lane's TOP edge — when a lane is
    // expanded (taller) the label still lines up with the canvas row top.
    alignItems: 'flex-start',
    gap: 5,
    overflow: 'hidden',
    boxSizing: 'border-box' as const,
  },
  // A per-voice sub-row label, indented past the caret/dot column so the
  // hierarchy reads "lane → voices" (mirrors the live monitor's leaf rail).
  voiceLabel: {
    position: 'absolute' as const,
    left: 0,
    right: 0,
    paddingLeft: 29, // caret(11) + gap(5) + dot(7) + gap(5) + leftpad(8) − fudge
    paddingRight: 8,
    display: 'flex',
    alignItems: 'center',
    fontSize: 10,
    color: 'var(--text-secondary, rgba(255,255,255,0.5))',
    overflow: 'hidden',
    textOverflow: 'ellipsis' as const,
    whiteSpace: 'nowrap' as const,
    pointerEvents: 'none' as const,
    boxSizing: 'border-box' as const,
  },
  laneCaret: {
    fontFamily: FONT_MONO,
    fontSize: 9,
    lineHeight: 1,
    padding: 0,
    marginTop: 1,
    width: 11,
    flexShrink: 0,
    border: 'none',
    background: 'transparent',
    color: 'var(--text-tertiary, rgba(255,255,255,0.45))',
    cursor: 'pointer' as const,
  },
  laneDot: { width: 7, height: 7, borderRadius: '50%', flexShrink: 0, display: 'inline-block', marginTop: 2 },
  laneName: {
    color: 'var(--text-tertiary, rgba(255,255,255,0.4))',
    fontSize: 10,
    overflow: 'hidden',
    textOverflow: 'ellipsis' as const,
    whiteSpace: 'nowrap' as const,
  },
  laneRenameInput: {
    minWidth: 0,
    flex: '1 1 auto' as const,
    color: 'var(--text-body, #e2e8f0)',
    fontSize: 10,
    fontFamily: 'inherit',
    background: 'rgba(255,255,255,0.08)',
    border: '1px solid rgba(255,255,255,0.25)',
    borderRadius: 3,
    padding: '0 2px',
    outline: 'none',
  },
  emptyLabel: {
    padding: 8,
    fontStyle: 'italic' as const,
    color: 'var(--text-tertiary, rgba(255,255,255,0.4))',
    fontSize: 11,
    lineHeight: 1.4,
  },
  grid: {
    flex: 1,
    minWidth: 200,
    position: 'relative' as const,
    overflowX: 'auto' as const,
    // #655 — the grid is the vertical scrollport too (it already is the horizontal
    // one). Its content is the full-`totalHeight` canvas, so `scrollHeight` already
    // exceeds the viewport when lanes overflow a short drawer; `auto` surfaces a
    // native Y-scrollbar that scrolls the canvas + marks. The label gutter is
    // translated in lockstep from `handleGridScroll` (it keeps `overflow: clip`, so
    // no #645 focus-drift). Both scrollbars stay pinned at the visible grid edges.
    overflowY: 'auto' as const,
    background: 'var(--bg-input, #0f0f1a)',
    cursor: 'pointer' as const,
    // #651 — the grid is focusable (`tabIndex=0`) so it can route the clip-op
    // keys (S / ⌘D / Delete) to the selected clip, and selecting a row focuses it
    // programmatically. Suppress the browser's default focus ring: it draws a
    // border around the WHOLE bars area (a stray "selected box") that competes
    // with the real lane band. Focus here is mouse-driven, not keyboard
    // navigation, and the selection band / clip rect already indicate state.
    outline: 'none' as const,
  },
  // Sticky viewport pin for the interactive marks (#506) — mirrors the base
  // canvas + live overlay (sticky left:0, marginTop:-height set inline). Children
  // are positioned in viewport space (`contentX - scrollLeft`) so they ride the
  // canvas's React-state scroll clock, never the natively-scrolled content.
  sectionInput: {
    position: 'absolute' as const,
    pointerEvents: 'auto' as const,
    zIndex: 6,
    font: '10px ui-monospace, SFMono-Regular, Menlo, monospace',
    padding: '0 2px',
    margin: 0,
    height: 14,
    lineHeight: '14px',
    border: '1px solid var(--accent, #4a9eff)',
    borderRadius: 2,
    color: 'var(--text-primary, #fff)',
    background: 'var(--bg-primary, rgba(0,0,0,0.92))',
    outline: 'none',
  },
  sectionCount: {
    position: 'absolute' as const,
    pointerEvents: 'none' as const,
    zIndex: 6,
    font: '9px ui-monospace, SFMono-Regular, Menlo, monospace',
    padding: '1px 3px',
    borderRadius: 2,
    color: 'var(--text-secondary, #bbb)',
    background: 'var(--bg-primary, rgba(0,0,0,0.92))',
    whiteSpace: 'nowrap' as const,
  },
  captionInput: {
    position: 'absolute' as const,
    pointerEvents: 'auto' as const,
    font: '9px ui-monospace, SFMono-Regular, Menlo, monospace',
    padding: 0,
    margin: 0,
    height: 12,
    lineHeight: '12px',
    border: 'none',
    borderBottom: '1px solid currentColor',
    background: 'var(--bg-primary, rgba(0,0,0,0.85))',
    outline: 'none',
  },
  marksOverlay: {
    position: 'sticky' as const,
    left: 0,
    pointerEvents: 'none' as const,
  },
  playhead: {
    position: 'absolute' as const,
    top: 0,
    bottom: 0,
    width: 1,
    background: 'var(--text-primary, rgba(255,255,255,0.7))',
    opacity: 0.7,
    boxShadow: '0 0 4px var(--text-primary, rgba(255,255,255,0.4))',
    pointerEvents: 'none' as const,
  },
  // The live edge ghost while trimming a clip (#437): a brighter accent line at
  // the snapped new boundary, distinct from the playhead.
  trimEdge: {
    position: 'absolute' as const,
    top: 0,
    bottom: 0,
    width: 2,
    background: 'var(--accent, #6ea8fe)',
    opacity: 0.9,
    boxShadow: '0 0 6px var(--accent, rgba(110,168,254,0.6))',
    pointerEvents: 'none' as const,
  },
  // Selected-clip highlight (Phase 5c): an accent outline + faint fill over the
  // arm's [start,end) × lane box, in content space (tracks zoom/scroll).
  clipSelection: {
    position: 'absolute' as const,
    border: '1.5px solid var(--accent, #6ea8fe)',
    borderRadius: 2,
    background: 'var(--accent-faint, rgba(110,168,254,0.14))',
    boxShadow: '0 0 6px var(--accent, rgba(110,168,254,0.5))',
    pointerEvents: 'none' as const,
    boxSizing: 'border-box' as const,
  },
  // Move-drag destination preview (Phase 5c): a dashed accent outline marking
  // where the dragged clip will land (a reorder slot, or the wrap lead span).
  moveGhost: {
    position: 'absolute' as const,
    border: '1.5px dashed var(--accent, #6ea8fe)',
    borderRadius: 2,
    background: 'var(--accent-faint, rgba(110,168,254,0.10))',
    pointerEvents: 'none' as const,
    boxSizing: 'border-box' as const,
  },
  // Region-trim edge (#1527): the LANE-height line the dragged slice boundary
  // is at. Lane-height rather than mark-height on purpose — the edit lands on
  // the track's expression, so every mark in the lane moves with it, and a line
  // drawn only across the grabbed mark would say otherwise.
  regionEdge: {
    position: 'absolute' as const,
    width: 2,
    background: 'var(--accent, #6ea8fe)',
    boxShadow: '0 0 5px var(--accent, rgba(110,168,254,0.6))',
    pointerEvents: 'none' as const,
  },
  regionEdgeValue: {
    position: 'absolute' as const,
    font: '10px ui-monospace, SFMono-Regular, Menlo, monospace',
    color: 'var(--accent, #6ea8fe)',
    background: 'var(--panel-bg, rgba(0,0,0,0.72))',
    padding: '1px 3px',
    borderRadius: 2,
    whiteSpace: 'nowrap' as const,
    pointerEvents: 'none' as const,
  },
} satisfies Record<string, React.CSSProperties>
