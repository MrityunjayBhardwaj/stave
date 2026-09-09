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
 * The tempo assumed while the transport has never run.
 *
 * A waveform's width is its duration measured against the slot it plays in, so
 * it needs a tempo — and the runtime cannot supply one yet. `getBpm()` is
 * documented as returning `undefined` before the first successful play
 * (`workspace/types.ts:695`) and is asserted to do exactly that
 * (`LiveCodingRuntime.test.ts:620`), because the number is parsed out of the
 * code the engine last evaluated.
 *
 * Refusing to draw until then was the first implementation, and it made the
 * feature useless for the thing it exists for: you had to press play to look at
 * what you had recorded. So an unknown tempo falls back to the one Strudel's own
 * scheduler starts at — `this.cps = 0.5` in `@strudel/core/cyclist.mjs:24` and
 * `neocyclist.mjs:13`, and the default argument of `setCps` at `cyclist.mjs:129`.
 *
 * ⚠ It is an ASSUMPTION, and it is wrong for a song that calls `setcps` with
 * something else: those waveforms draw at the wrong width until the transport
 * reports a real tempo, at which point they correct themselves, because the
 * getter below is read on every draw rather than captured. That is a visible
 * self-correction rather than a silent error, and it is the price of the
 * feature working at all before playback. A tempo parsed from the source
 * instead would be a second, divergent reading of the code, which this codebase
 * has paid for before.
 */
export const ASSUMED_CPS = 0.5;

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
      return getCps() ?? ASSUMED_CPS;
    },
    peaksFor: (voice, pitch) => peaksForSample({ s: voice, note: pitch }),
  };
}
