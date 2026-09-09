/**
 * waveformSource — the timeline's line to decoded audio (#1506).
 *
 * One small adapter, and its whole reason to exist is that the renderer must not
 * import the engine. `drawTimeline` is pure and unit-tested against plain
 * arrays; the decoded audio lives behind `@stave/editor` because the app has no
 * superdough of its own. This is the single place those two facts meet.
 *
 * It is a LOOKUP, never a load. `peaksForSample` reads an already-decoded buffer
 * and returns null for anything else, so a draw can call it per mark without
 * waiting on audio or provoking a fetch. What puts audio there is
 * `warmWaveforms`, and only for local assets.
 */

import { peaksForSample } from "@stave/editor";

import type { WaveformSource } from "../components/musicalTimeline/drawTimeline";

/**
 * A source bound to a tempo reader.
 *
 * `cps` is read on each draw rather than captured, because the tempo can change
 * under a timeline that is not otherwise redrawing, and a stale tempo would put
 * every waveform at the wrong width — visibly wrong, and wrong in a way that
 * looks like the waveform code rather than like a stale number.
 */
export function createWaveformSource(getCps: () => number | null): WaveformSource {
  return {
    get cps() {
      return getCps();
    },
    peaksFor: (voice, pitch) => peaksForSample({ s: voice, note: pitch }),
  };
}
