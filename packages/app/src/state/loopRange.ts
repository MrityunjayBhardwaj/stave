"use client";

import { useSyncExternalStore } from "react";

/**
 * Shared loop-locator state (#1570).
 *
 * The span the transport repeats, set by dragging the loop strip along the top
 * of the song ruler. The engine applies it as a `.ribbon(start, cycles)` wrap
 * paired with a compensating transport offset; everything about how that stays
 * song-absolute lives in `@stave/editor`'s `transportFrame`. This store holds
 * only what the user set.
 *
 * ⚠ THE RANGE AND "IS IT ON" ARE TWO PIECES OF STATE, NOT ONE, and the obvious
 * single-field store loses something silently. Both DAWs this is grounded
 * against let you switch looping off WITHOUT losing where the locators are —
 * Logic's Cycle button (or C), Ableton's Arrangement Loop switch. The engine
 * API is `setLoopRange(range | null)`, which is right for the engine: it only
 * needs to know what to wrap. So the collapse happens at the boundary, in
 * `effectiveLoopRange()`, and not before. A store that kept only the range
 * would still work perfectly for arming and clearing, and nothing would ever
 * fail — you would simply never be able to toggle a loop off and back on
 * without drawing it again.
 *
 * Same shape and lifetime as the ruler-units store next door: in-session only,
 * surviving Timeline remounts and resetting on reload. The control that writes
 * it (the ruler strip) and any chrome that reads it sit in different subtrees
 * whose only common ancestor is StaveApp, which is why this is a store rather
 * than a prop.
 */

/** A loop span in SONG cycles. `cycles` is a LENGTH, never an end cycle. */
export interface LoopRange {
  readonly startCycle: number;
  readonly cycles: number;
}

export interface LoopState {
  /** Where the locators are, or `null` when none have been set. */
  readonly range: LoopRange | null;
  /**
   * Whether the transport should repeat that span. Kept separate from `range`
   * so switching looping off leaves the locators where the user put them.
   */
  readonly enabled: boolean;
}

const EMPTY: LoopState = { range: null, enabled: false };

let current: LoopState = EMPTY;
const listeners = new Set<() => void>();

export function getLoopState(): LoopState {
  return current;
}

/**
 * The range to hand the runtime: the collapse of the two fields into the one
 * question the engine asks. Disabled, or never set, means "run straight
 * through" — which is the same `null` in both cases, and the only place the
 * distinction is allowed to disappear.
 */
export function effectiveLoopRange(state: LoopState = current): LoopRange | null {
  return state.enabled ? state.range : null;
}

function commit(next: LoopState): void {
  if (
    next.enabled === current.enabled &&
    next.range?.startCycle === current.range?.startCycle &&
    next.range?.cycles === current.range?.cycles
  ) {
    return;
  }
  current = next;
  for (const l of listeners) l();
}

/**
 * Set the locators. Arming is immediate — "Cycle mode is automatically turned
 * on" is Logic's own wording, and drawing a loop you then have to switch on
 * would be a step nobody expects.
 *
 * A span with no length is a drag that ended where it started: it clears the
 * locators rather than arming something inaudible.
 */
export function setLoopRange(range: LoopRange | null): void {
  if (!range || !Number.isFinite(range.startCycle) || !Number.isFinite(range.cycles) || range.cycles <= 0) {
    commit(EMPTY);
    return;
  }
  commit({ range: { startCycle: Math.max(0, range.startCycle), cycles: range.cycles }, enabled: true });
}

/** Switch looping off (or back on) while leaving the locators alone. */
export function setLoopEnabled(enabled: boolean): void {
  if (!current.range) return;
  commit({ range: current.range, enabled });
}

/** Toggle — the Cycle button / C key of both grounded DAWs. */
export function toggleLoopEnabled(): void {
  setLoopEnabled(!current.enabled);
}

/** Remove the locators entirely. */
export function clearLoopRange(): void {
  commit(EMPTY);
}

export function subscribeLoopState(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** React binding — re-renders the caller whenever the locators or the flag change. */
export function useLoopState(): LoopState {
  return useSyncExternalStore(subscribeLoopState, getLoopState, getLoopState);
}

/** Test-only reset, so one spec's locators cannot leak into the next. */
export function __resetLoopStateForTests(): void {
  current = EMPTY;
  for (const l of listeners) l();
}
