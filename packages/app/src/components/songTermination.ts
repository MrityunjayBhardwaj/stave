/**
 * When does playback END? (#1388, default inverted by #1396)
 *
 * ── WHICH WAY ROUND (#1396) ──────────────────────────────────────────────────
 * #1388 made stopping the default and looping the opt-in. That is backwards
 * against every reference: Ableton and Bitwig run the transport past the end of
 * the arrangement, and REAPER stops only as a PREFERENCE the user sets. It also
 * reads badly while writing, since live coding is a loop you edit inside of — a
 * document that acquires an `arrange(...)` should not silently gain the ability
 * to stop under you mid-edit.
 *
 * So the default LOOPS, and `stopAtEnd` is what the user opts into. The
 * asymmetry below already argued for this and was only applied to the ambiguous
 * extents; #1396 applies it to the unambiguous one too. Nothing else about the
 * mechanism changes — the pass counting, the `pass < 1` guard and the
 * stop-at-the-end-of-this-pass behaviour are all as #1388 built them.
 *
 * Nothing in this codebase ended playback before this module: a document was
 * started and it ran until someone pressed Stop. Measured on `b091ccc5` across
 * 691 source files, `stopAtEnd` / `playOnce` / `endOfSong` / `songEnd` were
 * zero-hit while the controls (`setcps` 34, `getSongPosition` 8, `songExtent`
 * 7) fired — so the zero meant "absent", not "differently named". It was found
 * by LISTENING, not by grepping: the first bounce of an arranged document
 * wrapped and restarted mid-capture.
 *
 * ── THE DOCUMENT DECIDES, AND IT ALREADY SAYS SO ─────────────────────────────
 * No new user-facing concept is introduced. `SongExtent` already draws exactly
 * the distinction termination needs, in its own comments:
 *
 *   { kind: 'arranged', cycles }  "A definite end. Safe to bounce whole."
 *                                 → CAN stop at `cycles` — and does, but only
 *                                   once the user asks for it (#1396)
 *   { kind: 'loop' }              "a loop has no end"  → keep looping
 *   { kind: 'opaque' }            "its length cannot be trusted" → keep looping
 *   null / not yet measured       → keep looping
 *
 * ⚠ `opaque` MUST NOT BE TREATED AS `arranged`. Its type exists to say that an
 * arrangement is present but something unparsed sits above it, so its length is
 * untrusted — and acting on an untrusted length is precisely how #1373 offered
 * a 3:28 song an 0:08 bounce. `songExtent`'s own header states the asymmetry
 * this module inherits: being wrong towards "keeps looping" costs a keypress;
 * being wrong towards "ends here" truncates someone's song. Every ambiguity
 * below therefore resolves towards looping.
 *
 * ── WHY A PASS COUNTER AND NOT `position >= cycles` ──────────────────────────
 * The obvious comparison is wrong in two directions, both of them silent:
 *
 * 1. Song position is the scheduler clock read through the transport frame —
 *    `scheduler.now() - transportOffset` with no loop armed — and `stop()` resets
 *    the scheduler cursor WITHOUT clearing an earlier seek's offset (only
 *    `record()` does that explicitly). So the first sample of a run is not
 *    guaranteed to be near zero. A bare `position >= cycles` would then fire on
 *    the very first tick and Play would appear to do nothing — the worst
 *    possible failure, because the user cannot tell it from a broken transport.
 * 2. While looping — the DEFAULT (#1396) — the position runs past `cycles` and
 *    keeps going. Turning `stopAtEnd` on afterwards would, under a bare
 *    comparison, stop instantly rather than at the end of the pass being
 *    played.
 *
 * Counting PASSES — `floor(position / cycles)` — removes both. The first sample
 * of a run only establishes a baseline, never a stop; termination is a
 * CROSSING, an increase in the pass number, which is the same event whether the
 * pass being left is the first or the fifth. A stale offset degrades to
 * stopping one pass late instead of not playing at all, which is the safe
 * direction. A backwards seek lowers the baseline and re-arms naturally.
 *
 * ⚠ WITH A LOOP RANGE ARMED (#1570) THIS MODULE NEVER TERMINATES, BY DESIGN.
 * Song position folds into the looped span, so the pass number stops rising and
 * no crossing ever happens — which is what a loop means. Worth knowing before
 * diagnosing "stopAtEnd is broken": check whether locators are set first.
 *
 * The counting starts at ONE, not zero: see the `pass < 1` guard below, which
 * exists because the first sample of a real run is slightly NEGATIVE, and the
 * song starting would otherwise read as the song ending.
 */
import type { SongExtent } from '@stave/editor'

/** An extent that names a definite end — the only kind playback CAN stop for.
 *  Whether it does is the user's `stopAtEnd` choice (#1396). */
export type DefiniteEnd = { readonly kind: 'arranged'; readonly cycles: number }

/**
 * Does this document end on its own?
 *
 * The single place that rule lives. Two consumers read it and they must not
 * drift: the watcher below (which stops playback) and the transport chrome
 * (which only offers the end-behaviour toggle for documents that HAVE an end).
 * A document the toggle appears on and a document that ends are by construction
 * the same set.
 */
export function hasDefiniteEnd(
  extent: SongExtent | null | undefined,
): extent is DefiniteEnd {
  return (
    extent != null &&
    extent.kind === 'arranged' &&
    Number.isFinite(extent.cycles) &&
    extent.cycles > 0
  )
}

/**
 * Do two extents say the same thing?
 *
 * Used to keep an extent refresh off the render path when nothing changed. It
 * compares the LENGTH as well as the kind, because the case that matters is an
 * edit that moves an arrangement from 16 cycles to 24 — same kind, different
 * song. Comparing kinds alone would leave the old length in place and stop the
 * song where it used to end.
 */
export function sameExtent(
  a: SongExtent | null | undefined,
  b: SongExtent | null | undefined,
): boolean {
  if (a == null || b == null) return a == null && b == null
  if (a.kind !== b.kind) return false
  return a.kind !== 'arranged' || a.cycles === (b as DefiniteEnd).cycles
}

/** Everything the watcher reads from the running app, injected so it can be
 *  driven by a test without a runtime, a scheduler or a React tree. */
export interface EndOfSongDeps {
  /** File ids whose runtime currently reports playing. */
  readonly playingFileIds: () => readonly string[]
  /** The document's structural extent, or `null`/`undefined` when unmeasured. */
  readonly extentOf: (fileId: string) => SongExtent | null | undefined
  /** Transport-offset-aware song position in cycles — the same clock the
   *  playhead is drawn from — or `null` when unavailable. */
  readonly positionOf: (fileId: string) => number | null
  /** Has the user asked this document to stop at its end instead of looping?
   *  Default is `false` — an unanswered document loops (#1396). */
  readonly isStopAtEnd: (fileId: string) => boolean
  /** Stop this file's transport. */
  readonly stop: (fileId: string) => void
}

export interface EndOfSongWatcher {
  /** Sample every playing file once and stop any that just crossed its end. */
  tick(): void
}

/** Per-file baseline. `cycles` is stored alongside the pass so a live edit that
 *  changes the arrangement's length re-baselines rather than comparing a pass
 *  counted in one divisor against a pass counted in another. */
interface Baseline {
  readonly cycles: number
  readonly pass: number
}

export function createEndOfSongWatcher(deps: EndOfSongDeps): EndOfSongWatcher {
  const baselines = new Map<string, Baseline>()

  return {
    tick(): void {
      const playing = deps.playingFileIds()

      // Forget files that are no longer playing, so the NEXT run re-baselines
      // from its own first sample instead of inheriting the last run's pass.
      if (baselines.size > 0) {
        const live = new Set(playing)
        for (const id of [...baselines.keys()]) {
          if (!live.has(id)) baselines.delete(id)
        }
      }

      for (const fileId of playing) {
        const extent = deps.extentOf(fileId)
        if (!hasDefiniteEnd(extent)) {
          // Looping, opaque, or not measured yet — nothing to end. Drop any
          // baseline so a document that BECOMES arranged (a live edit adding
          // `arrange(...)`) starts counting from where it is now.
          baselines.delete(fileId)
          continue
        }

        const position = deps.positionOf(fileId)
        // A momentary `null` (the scheduler between states) is not evidence of
        // anything. Hold the baseline rather than resetting it — resetting on
        // every blip would push the end further away each time.
        if (position == null || !Number.isFinite(position)) continue

        const pass = Math.floor(position / extent.cycles)
        const prev = baselines.get(fileId)
        baselines.set(fileId, { cycles: extent.cycles, pass })

        // First sample of this run, or the arrangement's length changed under
        // us: establish the baseline, never stop on it.
        if (!prev || prev.cycles !== extent.cycles) continue

        // Not a crossing (still inside the pass, or seeked backwards).
        if (pass <= prev.pass) continue

        // ⚠ THE CROSSING MUST BE INTO A POSITIVE PASS. Crossing cycle 0 is the
        // song STARTING, not a pass ending — and it really happens: measured in
        // the running app, the first sample of a run reads `pos=-0.017` (the
        // scheduler's clock sits a hair behind the transport origin at the
        // instant playback begins), which floors to pass -1. The very next
        // sample at `pos=+0.007` is pass 0, and without this line that reads as
        // a completed song: the arranged document stopped ~50ms after Play and
        // the transport went straight back to "Play". Every unit arm stayed
        // green, because none of them had sampled a negative pre-roll.
        //
        // The end of a song is a POSITIVE multiple of `cycles`. Nothing below
        // pass 1 is an ending.
        if (pass < 1) continue

        // A crossing. While the document is looping — which is the DEFAULT
        // (#1396) — we swallow it and carry the new baseline forward, so
        // turning `stopAtEnd` on later stops at the end of the pass being
        // played rather than immediately.
        if (!deps.isStopAtEnd(fileId)) continue

        baselines.delete(fileId)
        deps.stop(fileId)
      }
    },
  }
}
