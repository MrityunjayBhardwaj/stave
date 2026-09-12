"use client";

import { useSyncExternalStore } from "react";

import { DEFAULT_METER, normalizeMeter, type DisplayMeter } from "../lib/meter";

/**
 * Shared display-meter state (#1568) — the time signature every readout counts
 * in: the song ruler's beat ticks, the lane beat grid, the live-window ruler,
 * and the transport readout's bar·beat·tick and BPM digits.
 *
 * Same shape as the ruler-units store next door, and for the same reason: the
 * control that sets it and the surfaces that draw it live in different subtrees
 * whose only common ancestor is StaveApp, and threading a value through two
 * large prop surfaces to keep them in agreement is how they come to disagree.
 * One store, every reader subscribed, no copy to go stale.
 *
 * ⚠ It is a VIEW setting. Nothing here reaches the engine: changing the meter
 * changes how the same music is counted and drawn, never what is played, and
 * never how long a bar is — a bar is one cycle whatever the numerator says.
 *
 * In-session only (survives remounts, resets on reload), matching the ruler
 * units. Persistence, if wanted, is a later one-liner here.
 */

let current: DisplayMeter = DEFAULT_METER;
const listeners = new Set<() => void>();

export function getDisplayMeter(): DisplayMeter {
  return current;
}

/**
 * Set the meter, coercing anything unusable back to the default — this sits
 * behind a numeric input, and a half-typed value must not take the ruler down
 * with it.
 *
 * A no-op when nothing actually changed, INCLUDING when the normalized result
 * matches: without that, every keystroke inside an invalid range would notify
 * every subscriber and redraw the timeline to look exactly the same.
 */
export function setDisplayMeter(beatsPerBar: number, beatUnit: number): void {
  const next = normalizeMeter(beatsPerBar, beatUnit);
  if (next.beatsPerBar === current.beatsPerBar && next.beatUnit === current.beatUnit) return;
  current = next;
  for (const l of listeners) l();
}

export function subscribeDisplayMeter(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** React binding — re-renders the caller whenever the meter changes. */
export function useDisplayMeter(): DisplayMeter {
  return useSyncExternalStore(subscribeDisplayMeter, getDisplayMeter, getDisplayMeter);
}
