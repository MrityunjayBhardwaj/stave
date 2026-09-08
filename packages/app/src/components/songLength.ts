/**
 * How long should a bounce be — the document's own answer, typed so the modal
 * cannot mistake one kind of answer for another (#1365).
 *
 * ── WHY A TYPE AND NOT A NUMBER ──────────────────────────────────────────────
 * There are three genuinely different answers and they demand different UI:
 * a document with an arrangement has a definite end; a looping document has no
 * end but may have a measurable period, so the user picks how many repeats; and
 * a document with neither can only be bounced by naming a wall-clock duration.
 * A bare number cannot tell the second from the third — and guessing wrong there
 * is silent, because a bounce of the wrong length still produces a valid WAV.
 *
 * ── THE TRAP THIS MODULE EXISTS TO AVOID ─────────────────────────────────────
 * Two different things in this codebase are called "loop", and they disagree:
 *
 *   songExtent(ir).kind === 'loop'          145 of 150 real documents
 *       "no arrangement bounds this document" — a fact about STRUCTURE.
 *   analysis.displaySpan.kind === 'loop'     101 of 142 evaluated documents
 *       "a period was measured"              — a LENGTH.
 *
 * Only the second can size a render. Reading the first as coverage for a
 * length-based feature would promise a length for 63 documents that have none.
 * `displaySpan` is a discriminated union precisely so a consumer cannot read a
 * give-up horizon as a measurement; a bounce is the most literal possible
 * consumer of "repeats every N", so it branches on `kind` and never reaches for
 * `periodCycles ?? horizonCycles`.
 *
 * Figures measured by `song-period-sweep` over the saved corpus, restated when
 * #1465 moved them: 142 of 150 documents evaluate headlessly; of those, 101
 * carry a measured period, 37 are aperiodic at the 256-cycle cap, and 4 are
 * silent. The 19 that moved are documents whose only aperiodicity was a
 * continuously modulated control — which is the defect this file's own dialog
 * was filed for.
 *
 * ── WHY THE EDITOR FUNCTIONS ARE INJECTED RATHER THAN IMPORTED ───────────────
 * Importing the `@stave/editor` BARREL into an app module breaks that module's
 * vitest run: the barrel re-exports viz code pulling `gifenc`, a CJS module the
 * ESM loader cannot import as named exports. Production is unaffected (Next
 * interops it) so the failure appears only under test. Verified here rather than
 * assumed — a probe importing `analyzeSong` from the barrel fails with exactly
 * `Named export 'GIFEncoder' not found`. `createSongCollector` is injected for
 * the same reason: it is app-local but reaches the barrel through
 * `timelineMarks`. Type-only imports below are erased at runtime and are safe.
 */
import type {
  PatternIR,
  IREvent,
  SongAnalysis,
  SongExtent,
  AnalyzeSongOptions,
  SignalDimensions,
} from '@stave/editor'

/** What the document says about its own length. Never a bare number. */
export type SongLength =
  /** A definite end: an arrangement of `cycles`. Bounce the whole thing. */
  | { readonly kind: 'arranged'; readonly cycles: number }
  /** No end, but a measured period. Offer repeats of `periodCycles`. */
  | { readonly kind: 'loop'; readonly periodCycles: number }
  /**
   * No length can be offered, and `why` says which of the three reasons — the
   * modal tells the user rather than silently falling back, because "we could
   * not measure this" and "this document is empty" are different situations.
   */
  | {
      readonly kind: 'unknown'
      readonly why: 'no-period' | 'silent' | 'no-document'
    }

/**
 * The document's length and the engine's tempo, kept as SEPARATE fields.
 *
 * They have different epistemic status and different failure modes: the length
 * comes from the IR and the analysis, the tempo from the running scheduler, and
 * either can be absent while the other is known. Flattening them into one struct
 * is how a consumer ends up treating "no tempo yet" as "no length".
 */
export interface BounceSizing {
  readonly length: SongLength
  /** Cycles per second from the live scheduler, or `null` if unavailable. */
  readonly cps: number | null
}

/**
 * The two views of a document a bounce needs, kept apart because they answer
 * DIFFERENT questions from DIFFERENT sources (#1373).
 *
 * ⚠ THEY ARE NOT INTERCHANGEABLE, and treating them as one is the bug this
 * type exists to prevent. Two pipelines build a `PatternIR` from the same
 * source and they disagree about arrangements:
 *
 *   parseStrudel(code)                    ->  Track → Arrange(arms)   measurable
 *   runPasses(IR.code(code), PASSES)      ->  Track → Code            opaque
 *
 * The published IR snapshot is the SECOND. Its final pass leaves a top-level
 * `arrange(...)` as an opaque `Code` node, so a caller that asks it "does this
 * document have an arrangement" is asking something it structurally cannot
 * answer — and gets `loop` every time. That is how `measureSongLength`'s
 * `arranged` branch went its whole life without firing in the running app.
 *
 * It stayed hidden because for a simple arrangement the loop branch lands on
 * the right number anyway: `arrange([4, a], [8, b], [4, c])` has a measured
 * period of 16 cycles, which is also Σ weights. The two only part company when
 * something inside repeats faster than the arrangement does — a song whose bass
 * alternates over 4 cycles reports 4, and a 3:28 song offers an 8-second bounce.
 */
export interface SongIRs {
  /**
   * STRUCTURE — "does this document have a definite end?" Must come from
   * `parseStrudel`, the parser that models `arrange`/`cat`/`slowcat`. Needs no
   * evaluation and no playback, so an arrangement can be sized before a note
   * has sounded.
   */
  readonly structural: PatternIR | null
  /**
   * MEASUREMENT — "what period does this document repeat at?" Must come from
   * the published snapshot, whose lane keys match the runtime accessors the
   * collector is threaded with. Substituting the structural IR here would
   * re-key the collector and silently change what the period path measures.
   */
  readonly analysis: PatternIR | null
}

/** One analysis run's onset source, as `createSongCollector` returns it. */
export interface SongCollectorParts {
  readonly collectFn: ((startCycle: number, endCycle: number) => IREvent[]) | undefined
  readonly hasUnheardTrack: (() => boolean) | undefined
}

/** The editor capabilities this module needs, injected — see the header. */
export interface SongLengthDeps {
  readonly songExtent: (ir: PatternIR | null) => SongExtent
  readonly analyzeSong: (
    ir: PatternIR | null,
    opts: AnalyzeSongOptions,
  ) => Promise<SongAnalysis>
  readonly createCollector: (ir: PatternIR) => SongCollectorParts
  /** #1465 — the source-informed facts the period rule needs. Injected for the
   *  same barrel reason as the rest, and REQUIRED rather than optional: omitting
   *  it is silently the old behaviour, and a bounce dialog quietly back to
   *  "pick a length" is precisely the defect the issue was filed against. */
  readonly signalDimensionsOf: (ir: PatternIR | null) => SignalDimensions
}

/**
 * Measure `ir`'s length.
 *
 * ⚠ THE COLLECTOR IS NOT OPTIONAL IN SPIRIT. `analyzeSong` with no `collectFn`
 * "sees no onsets and returns the empty shape" — it still resolves, still hands
 * back a well-formed `SongAnalysis`, and every document reads as silent. That is
 * an answer that looks like a measurement, which is why the collector is a
 * required dep rather than something a caller can forget: the shared factory the
 * timeline uses is passed in, so a second collector cannot drift from the one
 * whose header explains the key space.
 */
export async function measureSongLength(
  irs: SongIRs,
  deps: SongLengthDeps,
  signal?: { aborted: boolean },
): Promise<SongLength> {
  if (irs.structural == null && irs.analysis == null) {
    return { kind: 'unknown', why: 'no-document' }
  }

  // Structure first, off the PARSED source: an arrangement is a definite end,
  // and it does not depend on anything having been evaluated or heard — so this
  // branch can answer before a note has sounded, and it is asked of the one IR
  // that can actually contain an `Arrange` (see `SongIRs`).
  const extent = deps.songExtent(irs.structural)
  if (extent.kind === 'arranged' && extent.cycles > 0) {
    return { kind: 'arranged', cycles: extent.cycles }
  }

  // `opaque` means an arrangement IS present but something unparsed sits above
  // it. Falling through to the period would quietly present an arrangement as a
  // loop, which is exactly the distinction `songExtent` kept the kind for.
  if (extent.kind === 'opaque') return { kind: 'unknown', why: 'no-period' }

  // Everything below measures the EVALUATED document, so it needs the snapshot.
  // A document that has never been evaluated has no period to find — which is a
  // different answer from "we measured it and there was none".
  if (irs.analysis == null) return { kind: 'unknown', why: 'no-document' }

  const { collectFn, hasUnheardTrack } = deps.createCollector(irs.analysis)

  let analysis: SongAnalysis
  try {
    analysis = await deps.analyzeSong(irs.analysis, {
      signal,
      collectFn,
      hasUnheardTrack,
      // #1465 — this is the dialog the issue was filed against: automating a
      // control with a continuous signal dropped the document to "pick a length".
      signals: deps.signalDimensionsOf(irs.analysis),
    })
  } catch {
    return { kind: 'unknown', why: 'no-period' }
  }

  if (analysis.displaySpan.kind === 'loop' && analysis.displaySpan.cycles > 0) {
    return { kind: 'loop', periodCycles: analysis.displaySpan.cycles }
  }

  // `capped` and `horizon` are both places the analysis STOPPED, not lengths.
  // Distinguish an empty document from an unmeasurable one so the modal can say
  // which; a document with no onsets at all has nothing to bounce.
  const heardAnything = analysis.lanes.some((l) =>
    l.onsetsByCycle.some((n) => n > 0),
  )
  return { kind: 'unknown', why: heardAnything ? 'no-period' : 'silent' }
}

/** Seconds a span of `cycles` occupies at `cps`, or `null` if tempo is unknown. */
export function cyclesToSeconds(cycles: number, cps: number | null): number | null {
  if (cps == null || !Number.isFinite(cps) || cps <= 0) return null
  if (!Number.isFinite(cycles) || cycles <= 0) return null
  return cycles / cps
}

/**
 * The ceiling a bounce is allowed to reach, in seconds.
 *
 * A bounce is REAL-TIME — `LiveRecorder` captures the live graph, so ten minutes
 * of audio costs ten minutes of wall clock. The old ceiling was 60s only because
 * every option was a hand-picked number; the real constraint is the user's
 * patience, not the format. Ten minutes covers the overwhelming majority of real
 * songs while still being a length someone might actually sit through.
 */
export const MAX_BOUNCE_SECONDS = 600

/** How many repeats of a loop the modal offers. */
const REPEAT_CHOICES = [1, 2, 4, 8] as const

/** One thing the user can pick, already costed in seconds. */
export interface BounceOffer {
  readonly id: string
  /** What the user is choosing, in the document's own terms. */
  readonly label: string
  /** Wall-clock length, which for a real-time bounce is also the wait. */
  readonly seconds: number
}

/** `93` → `"1:33"`. Durations are read, not computed, by the person waiting. */
export function formatDuration(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds))
  const m = Math.floor(whole / 60)
  const s = whole % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

/**
 * Turn what we know about the document into things the user can pick.
 *
 * Returns song-aware offers when the document can size itself, and a `note`
 * saying why it cannot when it returns none. The note matters: falling back to
 * the seconds picker in silence looks identical whether we measured a document
 * and found no period, or never measured one at all — and the user can act on
 * the difference (an aperiodic sketch will not gain a period; an unevaluated one
 * will, if they press play).
 */
export function bounceOffers(sizing: BounceSizing | null): {
  readonly offers: readonly BounceOffer[]
  readonly note: string | null
} {
  if (sizing == null) return { offers: [], note: null }

  const { length, cps } = sizing
  if (length.kind === 'unknown') {
    return {
      offers: [],
      note:
        length.why === 'silent'
          ? 'This document has no sound in it yet, so there is no length to offer.'
          : length.why === 'no-document'
            ? 'Play or evaluate the file first and its length can be measured.'
            : 'This document has no repeating section the analysis could measure, so pick a length.',
    }
  }

  // Tempo is a SEPARATE fact from length, and this is the one place the
  // distinction bites: we know exactly how long the song is in cycles and still
  // cannot say how long that takes. Say so, rather than assuming Strudel's
  // default and handing back a confident number that is wrong off-tempo.
  if (cps == null) {
    return {
      offers: [],
      note: 'The tempo is not known yet — press play once and the song length can be offered.',
    }
  }

  if (length.kind === 'arranged') {
    const seconds = cyclesToSeconds(length.cycles, cps)
    if (seconds == null || seconds > MAX_BOUNCE_SECONDS) {
      return {
        offers: [],
        note:
          seconds == null
            ? null
            : `The whole arrangement runs ${formatDuration(seconds)}, longer than a bounce can record in one take.`,
      }
    }
    return {
      offers: [{ id: 'whole', label: 'Whole song', seconds }],
      note: null,
    }
  }

  const offers: BounceOffer[] = []
  for (const n of REPEAT_CHOICES) {
    const seconds = cyclesToSeconds(length.periodCycles * n, cps)
    if (seconds == null || seconds > MAX_BOUNCE_SECONDS) continue
    offers.push({
      id: `loop-${n}`,
      label: n === 1 ? '1 repeat' : `${n} repeats`,
      seconds,
    })
  }
  // Every repeat over the ceiling — a single pass of the loop is already longer
  // than a bounce will record. Say that instead of silently offering nothing.
  if (offers.length === 0) {
    const one = cyclesToSeconds(length.periodCycles, cps)
    return {
      offers: [],
      note:
        one == null
          ? null
          : `One pass of this loop runs ${formatDuration(one)}, longer than a bounce can record in one take.`,
    }
  }
  return { offers, note: null }
}
