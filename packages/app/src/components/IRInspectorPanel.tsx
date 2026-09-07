/**
 * IR Inspector — observation-only view of the parsed PatternIR + the
 * collected IREvents from the most recent successful Strudel eval.
 *
 * v0 scope: tree (HTML <details>/<summary> nesting) + sortable events
 * table + click-to-source provenance from event.loc. No graph layout,
 * no diff between cycles, no edit-IR-to-recompile.
 *
 * Data source: subscribeIRSnapshot from @stave/editor. The snapshot
 * is republished on every onEvaluateSuccess in StrudelEditorClient.
 */
"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  type IRSnapshot,
  type IREvent,
  type PatternIR,
  type SourceLocation,
  type HapStream,
  type HapEvent,
  type BreakpointStore,
  getIRSnapshot,
  subscribeIRSnapshot,
  revealLineInFile,
  setCaptureCapacity,
} from "@stave/editor";
import {
  LOCALSTORAGE_KEY,
  projectedLabel,
  projectedChildren,
} from "./irProjection";
import { summarize, children } from "./IRInspectorChrome";
export { summarize, children } from "./IRInspectorChrome";   // re-export for callers
import { IRInspectorTimeline } from "./IRInspectorTimeline";
import { collectLeafIrNodeIds } from "./collectLeafIrNodeIds";

// Phase 19-08 PR-B — localStorage keys for the timeline UI.
// Convention matches `stave:inspector.irMode` at irProjection.ts:37.
const TIMELINE_COLLAPSED_KEY = "stave:inspector.timeline.collapsed";
const TIMELINE_CAPACITY_KEY = "stave:inspector.timeline.capacity";
const TIMELINE_CAPACITY_DEFAULT = 30;
const TIMELINE_CAPACITY_MIN = 1;
const TIMELINE_CAPACITY_MAX = 500;

// Phase 20-07 wave γ — stable empty set reference. State subscribers default
// to this when no store is attached so React's identity check on the
// previous-vs-next state value short-circuits and avoids spurious renders.
const EMPTY_SET: ReadonlySet<string> = Object.freeze(new Set<string>()) as ReadonlySet<string>;

// Phase 20-07 wave γ — module-level CSS injection guard for breakpoint +
// pulse decoration classes. Mirrors `injectHighlightStyles` at
// StrudelMonaco.tsx:253-268. Idempotent across multiple panel mounts.
let inspectorBreakpointStylesInjected = false;
function ensureInspectorBreakpointStyles(): void {
  if (inspectorBreakpointStylesInjected || typeof document === "undefined") return;
  inspectorBreakpointStylesInjected = true;
  const style = document.createElement("style");
  style.textContent = `
    [data-irinspector-pulsed="true"] {
      background: rgba(74, 158, 255, 0.25) !important;
      outline: 1px solid rgba(74, 158, 255, 0.6);
      border-radius: 2px;
      transition: background 80ms ease-out;
    }
    [data-breakpoint-active="true"] {
      border-left: 3px solid #ef4444;
      padding-left: 9px;
    }
    .stave-debugger-resume {
      background: #ef4444;
      color: #fff;
      border: 0;
      padding: 4px 12px;
      border-radius: 4px;
      font-size: 12px;
      cursor: pointer;
      font-weight: 600;
    }
    .stave-debugger-resume:hover {
      background: #dc2626;
    }
  `;
  document.head.appendChild(style);
}

// ----- Color tokens by IR tag — keep close to the design system -----------

const TAG_COLOR: Record<PatternIR["tag"], string> = {
  Pure:     "var(--ir-pure, #6b7280)",
  Seq:      "var(--ir-seq, #3b82f6)",
  Stack:    "var(--ir-stack, #a855f7)",
  Play:     "var(--ir-play, #10b981)",
  Sleep:    "var(--ir-sleep, #6b7280)",
  Choice:   "var(--ir-choice, #eab308)",
  Every:    "var(--ir-every, #f97316)",
  Cycle:    "var(--ir-cycle, #06b6d4)",
  When:     "var(--ir-when, #14b8a6)",
  Ramp:     "var(--ir-ramp, #f97316)",
  Fast:     "var(--ir-fast, #f97316)",
  Slow:     "var(--ir-slow, #f97316)",
  Range:    "var(--ir-range, #22d3ee)",
  Elongate: "var(--ir-elongate, #d946ef)",
  // Tier 4 (Phase 19-03) — late/degrade/chunk/ply each get a distinct
  // hue so a debugging user can see at a glance which transform shaped
  // a sub-tree without having to read the tag string.
  Late:     "var(--ir-late, #f59e0b)",
  Degrade:  "var(--ir-degrade, #84cc16)",
  Chunk:    "var(--ir-chunk, #fb7185)",
  Ply:      "var(--ir-ply, #22d3ee)",
  // Tier 4 (Phase 19-04) — Struct/Swing/Pick/Shuffle/Scramble/Chop. Each
  // gets a distinct hue from the existing palette. Struct uses a lighter
  // magenta than Elongate (#d946ef) to avoid color collision; the other
  // five take the planner-suggested hues from RESEARCH §5.
  Struct:   "var(--ir-struct, #e879f9)",
  Swing:    "var(--ir-swing, #a3e635)",
  Pick:     "var(--ir-pick, #34d399)",
  Shuffle:  "var(--ir-shuffle, #fbbf24)",
  Scramble: "var(--ir-scramble, #f87171)",
  Chop:     "var(--ir-chop, #c084fc)",
  // #1352 — `slice` is `chop`'s sibling (both carve a sample into ranges),
  // so it shares the family colour rather than claiming a new one.
  Slice:    "var(--ir-slice, #c084fc)",
  Loop:     "var(--ir-loop, #6366f1)",
  Code:     "var(--ir-code, #ef4444)",
  // Phase 20-10 wave β-2 — Param tag (sample-bucket / track-defining
  // params: s/n/note/gain/velocity/color/pan/speed/bank/scale). Distinct
  // orange-400 hue (#fb923c) — separates from FX's pink (#ec4899) at the
  // musician chrome so audio-effect chips and track-defining-param chips
  // are visually distinguished at a glance. RESEARCH G5.3 design pick;
  // PLAN §4 β-2 PART E.
  Param:    "var(--ir-param, #fb923c)",
  // Phase 20-11 wave γ-3 — Track tag (musician-track-identity wrapper).
  // Slate-400 (#94a3b8) placeholder; the per-track 32-palette
  // (paletteForTrack/trackIndexOf in musicalTimeline/colors.ts) is the
  // identity color in MusicalTimeline. TAG_COLOR is the Inspector-tag chip
  // colour only — a structural neutral that doesn't compete with FX's
  // pink (#ec4899) or Param's orange (#fb923c). 20-12 design-system pass
  // lands the final swatch token.
  Track:    "var(--ir-track, #94a3b8)",
  // Phase 20-18 — Signal/Builder Layer-1/2 IR substrate tags. Signal =
  // continuous signals (sine/perlin/irand/…); Builder = chord/arrange/
  // cat/transpose construction roots. Distinct placeholder hues (indigo-400
  // / green-400) that don't collide with neighbours (Cycle #06b6d4,
  // Play #10b981); the final swatch tokens (--ir-signal / --ir-builder)
  // land in the design-system pass, same as Track's placeholder.
  Signal:   "var(--ir-signal, #818cf8)",
  Builder:  "var(--ir-builder, #4ade80)",
  // Phase 5a (#386) — Arrange tag (arrange/cat/slowcat time-sequence /
  // timeline-clip combinator). Teal-300 placeholder, distinct from Cycle's
  // cyan (#06b6d4) and Builder's green; final token lands in the design pass.
  Arrange:  "var(--ir-arrange, #2dd4bf)",
  // #463 / #475 — NamedPick tag (object/named-key pick family:
  // pickRestart/pickReset/pick). Same pick family as Pick (#34d399) so it
  // shares the emerald hue, but a darker emerald-600 keeps the two chips
  // distinguishable; final token lands in the design pass.
  NamedPick: "var(--ir-named-pick, #059669)",
};

// summarize / children moved to IRInspectorChrome.ts (Phase 20-04 wave δ)
// — pure helpers extracted so unit tests can import without pulling the
// full panel + transitive `gifenc` (CommonJS) dependency chain. Imported
// at the top of this file and re-exported alongside the import.

function round(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(3);
}

// ----- Components ---------------------------------------------------------

/**
 * D-02 hide rule, splicing form. Given a list of children for a parent
 * in projected mode, replace any hidden child (projectedLabel ===
 * undefined) with that child's projected children. Recursive — keeps
 * splicing until the list contains only renderable rows. Mini-notation
 * symbol tags and Code are NOT hidden (their projectedLabel returns a
 * value).
 */
function spliceHiddenChildren(
  kids: readonly PatternIR[],
): readonly PatternIR[] {
  const out: PatternIR[] = [];
  for (const k of kids) {
    if (projectedLabel(k) === undefined) {
      // Recurse on its projected children (transitive hide).
      out.push(...spliceHiddenChildren(projectedChildren(k)));
    } else {
      out.push(k);
    }
  }
  return out;
}

function IRNodeRow({
  node,
  depth,
  irMode,
  highlightedLoc,
  snap,
  pulsedIds,
  breakpointIds,
  onRowClick,
}: {
  node: PatternIR;
  depth: number;
  irMode: boolean;
  /**
   * Phase 19-08 PR-B T-12 — when the user steps J/K through a pinned
   * snapshot's events, the panel resolves `events[playheadIndex].loc[0]`
   * and drills it down through this prop. A node whose own
   * `loc[0].start` matches gets the .ir-node-highlight class.
   * `null` means no highlight (live mode or synthetic event without loc
   * — graceful fallback per PV24).
   */
  highlightedLoc?: SourceLocation | null;
  /**
   * Phase 20-07 wave γ — current snapshot used for the leaf-id resolution
   * walker (collectLeafIrNodeIds). Optional for backward compat — when null
   * the row renders without breakpoint / pulse decoration.
   */
  snap?: IRSnapshot | null;
  /**
   * Phase 20-07 wave γ — set of irNodeIds currently firing (transient
   * audioDuration-bounded glow). The row matches when any of its leaf
   * descendants' irNodeIds is in this set.
   */
  pulsedIds?: ReadonlySet<string>;
  /**
   * Phase 20-07 wave γ — set of irNodeIds currently registered as
   * breakpoints. The row marks `data-breakpoint-active="true"` when ANY
   * leaf descendant's irNodeId is in this set (per DEC-AMENDED-2 / R-A
   * inner-row aggregation).
   */
  breakpointIds?: ReadonlySet<string>;
  /**
   * Phase 20-07 wave γ — invoked on row click with the row's PatternIR
   * node. Panel resolves the leaf-id set + lineHint and calls
   * BreakpointStore.toggleSet. Optional — null disables the click path
   * entirely (test harness / no-store mount).
   */
  onRowClick?: (node: PatternIR) => void;
}): React.ReactElement | null {
  let label: string;
  let kids: readonly PatternIR[];

  if (irMode) {
    label = node.tag;
    kids = children(node);
  } else {
    const projLabel = projectedLabel(node);
    if (projLabel === undefined) {
      // D-02 hide rule: this node would normally be folded into the parent.
      // The parent's spliceHiddenChildren removes it upstream; if a hidden
      // node DOES reach here (e.g., the root has projectedLabel undefined —
      // possible if a future parser path forgets to set userMethod on a
      // root tag), fall back to the raw tag for visibility.
      label = node.tag;
      kids = spliceHiddenChildren(projectedChildren(node));
    } else {
      label = projLabel;
      kids = spliceHiddenChildren(projectedChildren(node));
    }
  }

  // TAG_COLOR keying remains node.tag — color follows structural identity
  // (a Stack-from-layer is still Stack-purple even when labeled "layer").
  // Label follows projection. RESEARCH Q9 / NEW pre-mortem #9.
  const tagColor = TAG_COLOR[node.tag];
  const summary = summarize(node);

  // Phase 19-08 PR-B T-12 — highlight when the J/K-driven event loc
  // matches this node's primary loc start. PV24 fallback: missing loc
  // on either side is a no-op (no crash; just no highlight).
  const isHighlighted =
    highlightedLoc != null &&
    node.loc != null &&
    node.loc.length > 0 &&
    node.loc[0].start === highlightedLoc.start;
  const highlightClass = isHighlighted ? "ir-node-highlight" : undefined;

  // Phase 20-07 wave γ — pulse + breakpoint state. Leaf rows resolve their
  // own irNodeId via the snap loc lookup (mirrors the engine's join). Inner
  // rows aggregate over their descendant leaf-set per DEC-AMENDED-2 / R-A.
  // Both flags are silent no-ops when snap is null (initial mount before
  // first eval) or when the leaf-set is empty (graceful PV24 fallback).
  const leafIrNodeIds: readonly string[] = snap ? collectLeafIrNodeIds(node, snap) : [];
  const isPulsed: boolean =
    pulsedIds != null &&
    pulsedIds.size > 0 &&
    leafIrNodeIds.some((id) => pulsedIds.has(id));
  const hasBreakpoint: boolean =
    breakpointIds != null &&
    breakpointIds.size > 0 &&
    leafIrNodeIds.some((id) => breakpointIds.has(id));

  // Click handler — only attach when both onRowClick and a non-empty
  // leaf-set exist. PV37 alignment: if leafIrNodeIds is empty we render no
  // cursor + no handler (the row is not registrable).
  const handleClick: React.MouseEventHandler<HTMLElement> | undefined =
    onRowClick && leafIrNodeIds.length > 0
      ? (ev) => {
          ev.stopPropagation();
          onRowClick(node);
        }
      : undefined;

  if (kids.length === 0) {
    return (
      <div
        className={highlightClass}
        data-ir-node-highlight={isHighlighted ? "true" : undefined}
        data-irinspector-pulsed={isPulsed ? "true" : undefined}
        data-breakpoint-active={hasBreakpoint ? "true" : undefined}
        data-irinspector-row={leafIrNodeIds.length > 0 ? "true" : undefined}
        onClick={handleClick}
        style={{
          display: "flex",
          gap: 6,
          alignItems: "baseline",
          paddingLeft: depth * 12,
          paddingTop: 2,
          paddingBottom: 2,
          cursor: handleClick ? "pointer" : "default",
          ...(isHighlighted
            ? {
                outline: "2px solid var(--accent, #4a9eff)",
                background: "rgba(74, 158, 255, 0.12)",
                borderRadius: 2,
              }
            : null),
        }}
      >
        <span
          style={{
            color: tagColor,
            fontWeight: 600,
            fontSize: "0.85em",
            minWidth: 60,
          }}
        >
          {label}
        </span>
        <span style={{ opacity: 0.75, fontFamily: "var(--font-mono, monospace)", fontSize: "0.85em" }}>
          {summary}
        </span>
      </div>
    );
  }

  return (
    <details
      open={depth < 2}
      className={highlightClass}
      data-ir-node-highlight={isHighlighted ? "true" : undefined}
      data-irinspector-pulsed={isPulsed ? "true" : undefined}
      data-breakpoint-active={hasBreakpoint ? "true" : undefined}
      data-irinspector-row={leafIrNodeIds.length > 0 ? "true" : undefined}
      style={{
        paddingLeft: depth * 12,
        ...(isHighlighted
          ? {
              outline: "2px solid var(--accent, #4a9eff)",
              background: "rgba(74, 158, 255, 0.12)",
              borderRadius: 2,
            }
          : null),
      }}
    >
      <summary
        onClick={handleClick}
        style={{ cursor: handleClick ? "pointer" : "pointer", padding: "2px 0", listStyle: "none" }}
      >
        <span style={{ color: tagColor, fontWeight: 600, fontSize: "0.85em" }}>
          {label}
        </span>
        {summary && (
          <span style={{ opacity: 0.75, fontFamily: "var(--font-mono, monospace)", fontSize: "0.85em", marginLeft: 6 }}>
            {summary}
          </span>
        )}
      </summary>
      {kids.map((c, i) => (
        <IRNodeRow
          key={i}
          node={c}
          depth={depth + 1}
          irMode={irMode}
          highlightedLoc={highlightedLoc}
          snap={snap}
          pulsedIds={pulsedIds}
          breakpointIds={breakpointIds}
          onRowClick={onRowClick}
        />
      ))}
    </details>
  );
}

const MAX_EVENT_ROWS = 200;

function EventsTable({ events, source }: { events: readonly IREvent[]; source?: string }): React.ReactElement {
  const truncated = events.length > MAX_EVENT_ROWS;
  const shown = truncated ? events.slice(0, MAX_EVENT_ROWS) : events;

  const onRowClick = (event: IREvent) => {
    if (!event.loc || event.loc.length === 0 || !source) return;
    // event.loc carries character offsets. revealLineInFile expects a
    // line number, so we don't use it directly — instead we go through
    // the workspace file API: convert offset → line by counting
    // newlines in the source string we cached, then reveal.
    const offset = event.loc[0].start;
    const fileSnap = getIRSnapshot();
    if (!fileSnap) return;
    const line = countLines(fileSnap.code, offset);
    revealLineInFile(source, line);
  };

  return (
    <div style={{ marginTop: 8 }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "60px 1fr 60px 60px 60px 80px 1fr",
          gap: 6,
          fontSize: "0.8em",
          opacity: 0.7,
          paddingBottom: 4,
          borderBottom: "1px solid var(--panel-border, rgba(128,128,128,0.2))",
        }}
      >
        <span>begin</span>
        <span>note / s</span>
        <span>gain</span>
        <span>vel</span>
        <span>track</span>
        <span>loc</span>
        <span>params</span>
      </div>
      {shown.map((e, i) => (
        <div
          key={i}
          role="button"
          tabIndex={e.loc && e.loc.length > 0 ? 0 : -1}
          onClick={() => onRowClick(e)}
          onKeyDown={(ev) => { if (ev.key === "Enter") onRowClick(e); }}
          style={{
            display: "grid",
            gridTemplateColumns: "60px 1fr 60px 60px 60px 80px 1fr",
            gap: 6,
            fontSize: "0.8em",
            fontFamily: "var(--font-mono, monospace)",
            padding: "2px 0",
            cursor: e.loc && e.loc.length > 0 ? "pointer" : "default",
            opacity: e.loc && e.loc.length > 0 ? 1 : 0.7,
            borderBottom: "1px dashed var(--panel-border, rgba(128,128,128,0.1))",
          }}
          title={e.loc && e.loc.length > 0 ? "Click to jump to source" : "No source location"}
        >
          <span>{round(e.begin)}</span>
          <span>{e.note ?? e.s ?? "·"}</span>
          <span>{round(e.gain)}</span>
          <span>{round(e.velocity)}</span>
          <span>{e.trackId ?? "·"}</span>
          <span>{e.loc && e.loc.length > 0 ? `${e.loc[0].start}-${e.loc[0].end}` : "·"}</span>
          <span style={{ opacity: 0.75 }}>
            {(() => {
              if (!e.params) return "·";
              // Hide keys already shown in dedicated columns — collect.ts
              // mirrors them into params for FX/Ramp overrides, but that's
              // noise in the table. Only the engine-specific extras matter.
              const KNOWN = new Set(["s", "gain", "velocity", "color", "note", "freq"]);
              const extras = Object.keys(e.params).filter(k => !KNOWN.has(k));
              return extras.length > 0 ? extras.join(",") : "·";
            })()}
          </span>
        </div>
      ))}
      {truncated && (
        <div style={{ fontSize: "0.8em", opacity: 0.6, padding: "6px 0" }}>
          (truncated to first {MAX_EVENT_ROWS} of {events.length})
        </div>
      )}
    </div>
  );
}

function countLines(src: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < src.length; i++) {
    if (src.charCodeAt(i) === 0x0a /* \n */) line++;
  }
  return line;
}

// ----- Main panel ---------------------------------------------------------

/**
 * Phase 20-07 wave γ — Inspector accessors threaded from StaveApp via the
 * `getHapStreamRef` / `getBreakpointStoreRef` / `getIsPausedRef` /
 * `onResumeRef` / `onPauseChangedRef` ref pattern (mirrors 20-06's
 * established shape at StaveApp.tsx:491-526).
 *
 * All props are optional — back-compat with existing callers and tests
 * that mount the panel without a runtime context. When absent, the panel
 * renders without breakpoint / pulse / Resume affordances (the legacy
 * 20-04 + 19-08 surface stays exactly identical).
 */
export interface IRInspectorPanelProps {
  readonly getHapStream?: () => HapStream | null;
  readonly getBreakpointStore?: () => BreakpointStore | null;
  readonly getIsPaused?: () => boolean;
  readonly onResume?: () => void;
  readonly onPauseChanged?: (cb: (paused: boolean) => void) => () => void;
}

export function IRInspectorPanel(
  props: IRInspectorPanelProps = {},
): React.ReactElement {
  const [snap, setSnap] = useState<IRSnapshot | null>(getIRSnapshot);

  // Phase 20-07 wave γ — pulse + breakpoint + pause state. EMPTY_SET is the
  // module-level frozen reference so the initial state value carries a
  // stable identity across renders (avoids the "every render is a new
  // empty Set" trap that breaks identity comparisons in subscribers).
  const [pulsedIds, setPulsedIds] = useState<ReadonlySet<string>>(EMPTY_SET);
  const [breakpointIds, setBreakpointIds] = useState<ReadonlySet<string>>(EMPTY_SET);
  const [isPaused, setIsPaused] = useState<boolean>(false);
  const pulseTimeoutsRef = useRef<number[]>([]);
  // Inject the breakpoint + pulse + Resume CSS once per page load. Idempotent.
  ensureInspectorBreakpointStyles();
  // Persisted by name so the selection survives re-evals when the new
  // snapshot still has that pass. Falls back to the last pass otherwise.
  const [selectedTabName, setSelectedTabName] = useState<string | null>(null);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const panelRef = useRef<HTMLDivElement | null>(null);

  // Phase 19-08 PR-B — pinning state. When pinnedSnapshot is non-null,
  // the four pass-tabs render that snapshot's tree (frozen) while the
  // live publisher continues to feed setSnap(s) in the background.
  // playheadIndex is the J/K event-step cursor (T-12).
  const [pinnedSnapshot, setPinnedSnapshot] = useState<IRSnapshot | null>(null);
  const [playheadIndex, setPlayheadIndex] = useState<number>(0);

  // Phase 19-08 PR-B T-14 — collapsed state for the timeline strip.
  const [timelineCollapsed, setTimelineCollapsed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try {
      return window.localStorage.getItem(TIMELINE_COLLAPSED_KEY) === "1";
    } catch {
      return false;
    }
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(
        TIMELINE_COLLAPSED_KEY,
        timelineCollapsed ? "1" : "0",
      );
    } catch {
      // Storage quota / private browsing — skip silently.
    }
  }, [timelineCollapsed]);

  // Phase 19-08 PR-B T-13 — trace-length (capture buffer capacity). The
  // user-configured value persists in localStorage (UI preference per
  // RESEARCH §8 question #2); the buffer entries themselves remain
  // in-memory per CONTEXT D-06.
  const [traceLength, setTraceLength] = useState<number>(() => {
    if (typeof window === "undefined") return TIMELINE_CAPACITY_DEFAULT;
    try {
      const v = window.localStorage.getItem(TIMELINE_CAPACITY_KEY);
      const n = v == null ? TIMELINE_CAPACITY_DEFAULT : Number(v);
      if (!Number.isFinite(n) || n < TIMELINE_CAPACITY_MIN) {
        return TIMELINE_CAPACITY_DEFAULT;
      }
      return Math.min(Math.floor(n), TIMELINE_CAPACITY_MAX);
    } catch {
      return TIMELINE_CAPACITY_DEFAULT;
    }
  });
  useEffect(() => {
    setCaptureCapacity(traceLength);
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(TIMELINE_CAPACITY_KEY, String(traceLength));
    } catch {
      // Storage quota / private browsing — skip silently.
    }
  }, [traceLength]);

  // 19-06 (#76) — IR-mode toggle. Default false (projected mode); true
  // shows the raw IR shape for IR developers / power users. Persisted
  // via localStorage (RESEARCH §5.2 colon-prefix convention).
  const [irMode, setIrMode] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try {
      return window.localStorage.getItem(LOCALSTORAGE_KEY) === "true";
    } catch {
      // Private browsing / disabled storage — default to projected.
      return false;
    }
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(LOCALSTORAGE_KEY, String(irMode));
    } catch {
      // Storage quota / private browsing — skip silently.
    }
  }, [irMode]);

  useEffect(() => {
    // The publisher fires every successful eval REGARDLESS of pin state
    // (CONTEXT D-02 publisher-vs-consumer). The pin gate is purely
    // render-side via `displaySnapshot` below.
    return subscribeIRSnapshot((s) => setSnap(s));
  }, []);

  // Phase 20-07 wave γ — HapStream subscription drives the transient
  // row-pulse decoration. Mirrors useHighlighting.ts:174-195 timing:
  //   showDelay  = max(0, scheduledAheadMs)
  //   clearDelay = showDelay + audioDuration*1000
  // and MusicalTimeline.tsx:332's disambig-via-irNodeId pattern (PV37).
  // Re-resolves the HapStream on every snapshot publish per 20-06
  // DEC-NEW-1 (snapshot-driven re-resolution) — when the active runtime
  // swaps, the next eval republishes the snapshot and the effect
  // re-attaches to the new stream.
  const getHapStream = props.getHapStream;
  useEffect(() => {
    if (!getHapStream) return;
    const stream = getHapStream();
    if (!stream) return;
    const handler = (event: HapEvent): void => {
      if (!event.irNodeId) return; // PV37 — no fallback ladder
      const id = event.irNodeId;
      const showDelay = Math.max(0, event.scheduledAheadMs);
      const clearDelay = showDelay + event.audioDuration * 1000;
      const showTimer = window.setTimeout(() => {
        setPulsedIds((prev) => {
          if (prev.has(id)) return prev;
          const next = new Set(prev);
          next.add(id);
          return next;
        });
      }, showDelay);
      const clearTimer = window.setTimeout(() => {
        setPulsedIds((prev) => {
          if (!prev.has(id)) return prev;
          const next = new Set(prev);
          next.delete(id);
          return next.size === 0 ? EMPTY_SET : next;
        });
      }, clearDelay);
      pulseTimeoutsRef.current.push(showTimer, clearTimer);
    };
    stream.on(handler);
    return () => {
      stream.off(handler);
      for (const t of pulseTimeoutsRef.current) window.clearTimeout(t);
      pulseTimeoutsRef.current = [];
      setPulsedIds(EMPTY_SET);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- snapshot-driven re-resolution per 20-06 DEC-NEW-1
  }, [snap, getHapStream]);

  // Phase 20-07 wave γ — BreakpointStore subscription. The store fires its
  // listener on every add/remove/toggle; we mirror the id set into React
  // state so the row render reads through a stable React-managed value.
  // Snapshot-driven re-resolution mirrors HapStream above.
  const getBreakpointStore = props.getBreakpointStore;
  useEffect(() => {
    if (!getBreakpointStore) return;
    const store = getBreakpointStore();
    if (!store) return;
    const sync = (): void => {
      const ids = store.idSet();
      setBreakpointIds(ids.size === 0 ? EMPTY_SET : ids);
    };
    sync();
    return store.subscribe(sync);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- snapshot-driven re-resolution per 20-06 DEC-NEW-1
  }, [snap, getBreakpointStore]);

  // Phase 20-07 wave γ — pause-state subscription. Mirrors LiveCodingRuntime's
  // `onPlayingChanged` listener-bus shape (RESEARCH §1 Q3). The disposer
  // returned from onPauseChanged is the useEffect cleanup. Initial value
  // read is critical so a panel mounting AFTER a breakpoint hit shows the
  // Resume button immediately (T17 / R-1).
  const getIsPaused = props.getIsPaused;
  const onPauseChanged = props.onPauseChanged;
  useEffect(() => {
    if (getIsPaused) setIsPaused(getIsPaused());
    if (!onPauseChanged) return;
    return onPauseChanged((paused) => setIsPaused(paused));
  }, [getIsPaused, onPauseChanged]);

  // Phase 19-08 — display gating. When pinnedSnapshot is set, the four
  // pass-tabs derive from it. Live `snap` continues to update in the
  // background; we just don't read it. PV27 alias contract holds against
  // the captured snapshot's `passes[last].ir` per per-snapshot semantics.
  const displaySnapshot = pinnedSnapshot ?? snap;

  const ageLabel = useMemo(() => {
    if (pinnedSnapshot) {
      const ms = Date.now() - pinnedSnapshot.ts;
      if (ms < 1000) return "pinned · just now";
      if (ms < 60_000) return `pinned · ${Math.round(ms / 1000)}s old`;
      return `pinned · ${Math.round(ms / 60_000)}m old`;
    }
    if (!snap) return "";
    const ms = Date.now() - snap.ts;
    if (ms < 1000) return "just now";
    if (ms < 60_000) return `${Math.round(ms / 1000)}s ago`;
    return `${Math.round(ms / 60_000)}m ago`;
  }, [snap, pinnedSnapshot]);

  const selectedIndex = useMemo<number>(() => {
    if (!displaySnapshot || displaySnapshot.passes.length === 0) return -1;
    const i = selectedTabName
      ? displaySnapshot.passes.findIndex((p) => p.name === selectedTabName)
      : -1;
    return i >= 0 ? i : displaySnapshot.passes.length - 1;
  }, [displaySnapshot, selectedTabName]);

  // Phase 19-08 PR-B T-11 — ESC unpins. Scoped to the panel ref
  // (RESEARCH §3 step 6 — avoids global keybinding pollution and
  // does not collide with the tab strip's ←/→ at lines 472-480).
  useEffect(() => {
    if (!pinnedSnapshot) return;
    const node = panelRef.current;
    if (!node) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setPinnedSnapshot(null);
        setPlayheadIndex(0);
      }
    };
    node.addEventListener("keydown", onKey);
    return () => node.removeEventListener("keydown", onKey);
  }, [pinnedSnapshot]);

  // Phase 19-08 PR-B T-12 — J/K event step-through (only when pinned).
  // Walks displaySnapshot.events[] (audible-time order, not tree order
  // per CONTEXT D-03 + PV28). Vim-style J=forward, K=back. Scoped to
  // panelRef so it does NOT collide with the tab strip's ←/→ at
  // lines 472-480 (handled separately on the tablist's onKeyDown).
  // PV18 dep array: explicit list of every value the closure reads
  // — pinnedSnapshot, the event array length (used for clamping),
  // and setPlayheadIndex. P29 stale-closure trap mitigated.
  const eventCount = displaySnapshot?.events.length ?? 0;
  useEffect(() => {
    if (!pinnedSnapshot) return;
    if (eventCount === 0) return;
    const node = panelRef.current;
    if (!node) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "j" && e.key !== "J" && e.key !== "k" && e.key !== "K") return;
      // Don't fight typing in form fields.
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      e.preventDefault();
      setPlayheadIndex((i) => {
        if (e.key === "j" || e.key === "J") {
          return Math.min(i + 1, eventCount - 1);
        }
        return Math.max(i - 1, 0);
      });
    };
    node.addEventListener("keydown", onKey);
    return () => node.removeEventListener("keydown", onKey);
  }, [pinnedSnapshot, eventCount]);

  // Phase 19-08 PR-B T-12 — derive the highlighted source location
  // from the current playhead index. Null when not pinned, when the
  // playhead is past the events array, or when the indexed event has
  // no `loc` (synthetic event — PV24 fallback).
  const highlightedLoc = useMemo<SourceLocation | null>(() => {
    if (!pinnedSnapshot || !displaySnapshot) return null;
    const evt = displaySnapshot.events[playheadIndex];
    if (!evt || !evt.loc || evt.loc.length === 0) return null;
    return evt.loc[0];
  }, [pinnedSnapshot, displaySnapshot, playheadIndex]);

  // Phase 20-07 wave γ — chain-row click → BreakpointStore.toggleSet.
  // R-3 lineHint: derive from snap.irNodeIdsByLine reverse lookup so an
  // Inspector-registered breakpoint can still render a muted glyph on the
  // gutter when the id later orphans (user edits the s-string). When no
  // line resolves, pass `{}` — orphan becomes Inspector-side-only
  // (documented v1 limit; cleared via Inspector right-click in
  // 20-07-follow-up). PV37 alignment: empty leaf-set → silent skip.
  const handleRowClick = React.useCallback(
    (node: PatternIR): void => {
      if (!getBreakpointStore) return;
      const store = getBreakpointStore();
      if (!store) return;
      const live = displaySnapshot;
      if (!live) return;
      const ids = collectLeafIrNodeIds(node, live);
      if (ids.length === 0) return;
      let lineHint: number | undefined;
      for (const id of ids) {
        for (const [line, idsOnLine] of live.irNodeIdsByLine) {
          if (idsOnLine.includes(id)) {
            lineHint = line;
            break;
          }
        }
        if (lineHint != null) break;
      }
      store.toggleSet(ids, lineHint != null ? { lineHint } : {});
    },
    [getBreakpointStore, displaySnapshot],
  );

  if (!displaySnapshot) {
    return (
      <div
        role="region"
        aria-label="IR Inspector"
        style={{
          padding: 16,
          fontSize: "0.9em",
          opacity: 0.7,
          height: "100%",
        }}
      >
        <div style={{ fontWeight: 600, marginBottom: 8 }}>IR INSPECTOR</div>
        <div>Run a Strudel pattern to see its IR.</div>
      </div>
    );
  }

  return (
    <div
      ref={panelRef}
      role="region"
      aria-label="IR Inspector"
      tabIndex={-1}
      style={{
        padding: 12,
        fontSize: "0.9em",
        height: "100%",
        overflow: "auto",
        outline: "none",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          marginBottom: 8,
        }}
      >
        <div style={{ fontWeight: 600 }}>IR INSPECTOR</div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {/* Phase 20-07 wave γ — Resume affordance. Visible only when
              the active runtime reports paused. Clicking calls onResume
              which threads to runtime.resume() in StaveApp; idempotent
              on the runtime side (T17). The same onResume closure is
              wired into Monaco via `useBreakpoints` (T-γ-6) so the user
              can resume from the command palette when the Inspector is
              collapsed (R-1). */}
          {isPaused && props.onResume && (
            <button
              type="button"
              className="stave-debugger-resume"
              onClick={props.onResume}
              aria-label="Resume from breakpoint"
              data-testid="stave-debugger-resume"
            >
              ▶ Resume
            </button>
          )}
          <div style={{ fontSize: "0.8em", opacity: 0.6 }}>
            {displaySnapshot.runtime} · {displaySnapshot.events.length} events · {ageLabel}
          </div>
          <label
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              fontSize: "0.75em",
              opacity: 0.85,
            }}
            title="Capture buffer length (trace) — how many past evals to keep"
          >
            <span style={{ opacity: 0.7 }}>trace</span>
            <input
              type="number"
              min={TIMELINE_CAPACITY_MIN}
              max={TIMELINE_CAPACITY_MAX}
              value={traceLength}
              onChange={(e) => {
                const raw = Number(e.target.value);
                if (!Number.isFinite(raw)) return;
                const clamped = Math.min(
                  Math.max(Math.floor(raw), TIMELINE_CAPACITY_MIN),
                  TIMELINE_CAPACITY_MAX,
                );
                setTraceLength(clamped);
              }}
              data-testid="ir-timeline-capacity-input"
              aria-label="Timeline capacity"
              style={{
                width: "3.5rem",
                padding: "1px 4px",
                fontSize: "0.85em",
                background: "transparent",
                color: "inherit",
                border:
                  "1px solid var(--border-subtle, rgba(128,128,128,0.3))",
                borderRadius: 3,
              }}
            />
          </label>
          <button
            type="button"
            onClick={() => setIrMode((v) => !v)}
            title={
              irMode
                ? "Show projected user-method view"
                : "Show raw IR shape (developer view)"
            }
            aria-label={irMode ? "Show projected view" : "Show raw IR view"}
            aria-pressed={irMode}
            data-testid="ir-mode-toggle"
            style={{
              padding: "2px 8px",
              fontSize: "0.75em",
              fontWeight: 600,
              letterSpacing: "0.04em",
              color: irMode ? "#86efac" : "var(--text-tertiary, #888)",
              background: irMode ? "rgba(134,239,172,0.08)" : "transparent",
              border: `1px solid ${
                irMode ? "#86efac" : "var(--border-subtle, rgba(128,128,128,0.3))"
              }`,
              borderRadius: 3,
              cursor: "pointer",
              flexShrink: 0,
            }}
          >
            {irMode ? "raw IR" : "IR"}
          </button>
        </div>
      </div>

      <div
        role="tablist"
        aria-label="IR passes"
        data-testid="ir-passes-tablist"
        style={{
          display: "flex",
          gap: 4,
          borderBottom: "1px solid var(--panel-border, rgba(128,128,128,0.2))",
          marginBottom: 6,
        }}
        onKeyDown={(e) => {
          if (displaySnapshot == null || displaySnapshot.passes.length === 0) return;
          if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
          const dir = e.key === "ArrowRight" ? 1 : -1;
          const next =
            (selectedIndex + dir + displaySnapshot.passes.length) %
            displaySnapshot.passes.length;
          setSelectedTabName(displaySnapshot.passes[next].name);
          tabRefs.current[next]?.focus();
          e.preventDefault();
        }}
      >
        {displaySnapshot.passes.map((p, i) => (
          <button
            key={p.name}
            ref={(el) => { tabRefs.current[i] = el; }}
            role="tab"
            aria-selected={i === selectedIndex}
            aria-controls="ir-tree-panel"
            tabIndex={i === selectedIndex ? 0 : -1}
            onClick={() => setSelectedTabName(p.name)}
            data-testid={`ir-pass-tab-${p.name}`}
            style={{
              padding: "4px 10px",
              fontSize: "0.85em",
              fontWeight: i === selectedIndex ? 600 : 400,
              background: i === selectedIndex ? "var(--panel-active, rgba(128,128,128,0.15))" : "transparent",
              border: "none",
              borderBottom: i === selectedIndex ? "2px solid var(--accent, #3b82f6)" : "2px solid transparent",
              cursor: "pointer",
              color: "inherit",
            }}
          >
            {p.name}
          </button>
        ))}
      </div>

      <div role="tabpanel" id="ir-tree-panel" data-testid="ir-tree-section">
        <details open>
          <summary style={{ cursor: "pointer", fontWeight: 600, padding: "4px 0", opacity: 0.85, listStyle: "none" }}>
            IR tree{displaySnapshot.passes.length > 1 && selectedIndex >= 0 ? ` · ${displaySnapshot.passes[selectedIndex].name}` : null}
          </summary>
          <div style={{ paddingLeft: 4 }}>
            {selectedIndex >= 0 && (
              <IRNodeRow
                node={displaySnapshot.passes[selectedIndex].ir}
                depth={0}
                irMode={irMode}
                highlightedLoc={highlightedLoc}
                snap={displaySnapshot}
                pulsedIds={pulsedIds}
                breakpointIds={breakpointIds}
                onRowClick={handleRowClick}
              />
            )}
          </div>
        </details>
      </div>

      <details open data-testid="ir-events-section" style={{ marginTop: 12 }}>
        <summary style={{ cursor: "pointer", fontWeight: 600, padding: "4px 0" }}>
          Events ({displaySnapshot.events.length})
        </summary>
        <EventsTable events={displaySnapshot.events} source={displaySnapshot.source} />
      </details>

      <IRInspectorTimeline
        pinnedSnapshot={pinnedSnapshot}
        onPin={(s) => {
          setPinnedSnapshot(s);
          setPlayheadIndex(0);
        }}
        onUnpin={() => {
          setPinnedSnapshot(null);
          setPlayheadIndex(0);
        }}
        collapsed={timelineCollapsed}
        onToggleCollapsed={setTimelineCollapsed}
      />
    </div>
  );
}
