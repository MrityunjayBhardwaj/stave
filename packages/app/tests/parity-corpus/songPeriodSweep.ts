/**
 * songPeriodSweep — THE ONE definition of "what period does the Song timeline
 * give this document", measured over the 150 real tunes (#1102).
 *
 * ── WHY THIS EXISTS BEFORE ANY FIX ───────────────────────────────────────────
 * `cycleFingerprints` decides the display span, the mark window, the sections,
 * the playhead wrap and every clip extent. A stricter fingerprint can only
 * LENGTHEN detected periods or null them ([[PV255]]), and the span the view
 * shows is `SongAnalysis.displaySpan` — one value carrying both the cycles and
 * WHICH of period/horizon supplied them, cap 256. (It was `periodCycles ??
 * horizonCycles` re-derived at each consumer, with a `reachedCap` boolean
 * alongside that reached only a label; #1201 gave that idiom one home.) So a
 * document reading period 1
 * today can land on a 256-cycle-wide timeline after a fix that is locally
 * correct. That risk is not analysable from the diff; it has to be swept.
 *
 * So this module is the BASELINE instrument, committed and pinned before the
 * production code is touched, and re-run afterwards with every moved document
 * enumerated per axis.
 *
 * ── FIDELITY: WHY IT GOES THROUGH THE PER-TRACK PATTERNS ─────────────────────
 * The whole defect lives in a lane key. `laneKeyOf` is `ev.trackId ?? ev.s`, and
 * production ALWAYS supplies a `trackId` — `getTimelineEvents` stamps the
 * capture key on every hap (`StrudelEngine.ts:1366-1378`) and `MusicalTimeline`
 * then remaps it to the structural lane (`MusicalTimeline.tsx:266`). A probe
 * that queried one stacked pattern would produce haps with no `trackId`, the
 * `?? ev.s` fallback would put the sample name into the fingerprint by accident,
 * and the sweep would report a healthy corpus. Hence `evalSongTracks`, which
 * mirrors `songPatterns` rather than the repl's play pattern.
 *
 * The analysis itself is the PRODUCTION function — `analyzeSong` with an
 * injected collector, exactly as `MusicalTimeline.tsx:269` calls it, so the
 * progressive horizon, the doubling, the cap and the one-loop trim are the real
 * ones and not a re-implementation ([[PV192]]: a second oracle can only agree
 * with itself).
 *
 * ── DECLARED BOUNDS, so no figure here is quoted wider than it holds ──────────
 *  1. 142 of the 150 tunes evaluate headlessly, and the eight that do not are
 *     NAMED (`evalHarness.ts` header: 5 document-intrinsic, 2 browser-bound,
 *     1 engine-version). Report the bound with every figure; do not smooth it.
 *  2. Lanes are keyed by CAPTURE key, not by the structural lane the app remaps
 *     to. Period is invariant under relabelling; only a join that MERGED two
 *     capture keys could move one (upward). See `evalSongTracks`' own note.
 *  3. `analyzeSong` stops at the first period it can confirm, so a document
 *     reported aperiodic is aperiodic WITHIN the 256-cycle cap — a different
 *     fact from "has no period", and counted separately.
 */
// Imported from the MODULES, never from the `@stave/editor` barrel: the barrel
// drags `gifenc` (CJS) into the hermetic app test env and the suite fails to
// collect ([[feedback_editor_barrel_import_breaks_app_tests]]).
import {
  analyzeSong,
  cycleFingerprints,
  detectPeriod,
  displayPeriodRule,
  laneKeyOf,
} from '../../../editor/src/ir/songAnalysis'
import type { IREvent } from '../../../editor/src/ir/IREvent'
import { normalizeStrudelHap } from '../../../editor/src/engine/NormalizedHap'
import {
  evalSongTracks,
  hasCorpusArchive,
  loadCorpus,
  type SongTrack,
} from '../../../editor/src/visualEdit/miniSource/__tests__/evalHarness'
import { parseStrudel } from '../../../editor/src/ir/parseStrudel'
import { signalCarryingParamKeys } from '../../src/components/musicalTimeline/signalAutomation'

// Re-exported so the two sweep tests can guard themselves without reaching
// across packages for a rule this file already depends on (#1307). One copy,
// two import paths — not a second copy.
export { loadCorpus, hasCorpusArchive }

/** One document's Song-timeline verdict. */
export interface PeriodVerdict {
  name: string
  /** false when the document did not evaluate — see bound 1. */
  ok: boolean
  error?: string
  /** `analyzeSong`'s detected display period, or null when none within the cap. */
  period: number | null
  /** the span the timeline actually draws: `period ?? horizon`. */
  span: number
  /** true when the progressive horizon hit the cap without confirming a period. */
  reachedCap: boolean
  /** distinct lane keys the analysis produced. */
  lanes: number
  /**
   * Declared tracks that SOUNDED within the analysed horizon and are still
   * absent from `analysis.lanes` — the [[P405]] loss, counted at the boundary it
   * happens at rather than inferred from the rule that now prevents it (#1107).
   * An invariant, always 0; never pinned in the baseline, because a re-baseline
   * must not be able to accept it.
   */
  lostLanes: number
  /** total events collected over the analysed horizon. */
  events: number
}

/**
 * The collector production injects, reproduced against per-track patterns.
 *
 * Mirrors `MusicalTimeline.tsx:260-266` including its onset filter: a hap whose
 * `whole.begin` precedes the band is a FRAGMENT of an earlier cycle's note and
 * must not be counted as an onset in this one.
 */
function trackCollector(tracks: readonly SongTrack[]) {
  return (startCycle: number, endCycle: number): IREvent[] => {
    const out: IREvent[] = []
    for (const { trackId, pattern } of tracks) {
      let haps: unknown[]
      try {
        haps = pattern.queryArc(startCycle, endCycle) as unknown[]
      } catch {
        continue // per-track query failure — skipped, as the engine skips it
      }
      for (const hap of haps) {
        const ev = normalizeStrudelHap(hap, trackId)
        const c = Math.floor(ev.begin)
        if (c >= startCycle && c < endCycle) out.push(ev)
      }
    }
    return out
  }
}

/**
 * CANDIDATE FAMILY for #1104: a lane with no period of its own ABSTAINS from
 * the span instead of vetoing it.
 *
 * ── WHERE THE HYPOTHESIS COMES FROM ──────────────────────────────────────────
 * `detectDisplayPeriod` holds two rules that do not agree with each other. The
 * grounded one (#488, from real DAW manuals) is that lanes of differing lengths
 * PHASE: show the MAX, never the lcm, because "a 5-cycle track beside a 4-cycle
 * track shows a 5-cycle view (the 4-cycle loop repeats/phases inside it)". The
 * other is `if (p === null) return null` — one lane without a period discards
 * every OTHER lane's measured period and sends the whole document to the cap.
 *
 * If a 4-cycle lane can phase inside a 5-cycle view, a lane with no period can
 * phase inside a view sized by the lanes that have one. That is the first
 * direction #1104 lists ("show the structural loop, treat modulation as a
 * continuous field over it") — but arrived at as the existing rule extended one
 * case further rather than as a new philosophy, which makes it a MEASURABLE
 * hypothesis instead of a preference.
 *
 * ── WHAT THE FIRST MEASUREMENT REFUTED, and what it taught ───────────────────
 * Unconditional abstention (`atCapOnly: false`) was priced first and FAILED its
 * own disqualifier: 32 documents left the 256-cycle cap but 14 landed on period
 * 1 — the single stretched clip #1102 was filed for — and 5 of those had a
 * CORRECT bounded period before (12→1, 10→1, 8→1, 7→1, 6→1). Nine documents
 * appear in both the win and the cost list (cap → 1), so the honest recovery
 * was 23, not 32.
 *
 * The mechanism is NOT variant E's. Variant E failed because its probe window
 * could not see far enough. This failed at the combine step, and specifically at
 * the HORIZON: below the cap a `null` is what DOUBLES the horizon, so the veto
 * is not a defect there — it is the thing that gives a slow lane room to
 * resolve. Abstaining below the cap answers early with whatever short lane
 * happens to have resolved (a 1-cycle hi-hat), and the document never grows to
 * the horizon where its 12-cycle pad would have been found.
 *
 * ── THE FLOOR IS ON *WHEN* ABSTENTION MAY SPEAK ──────────────────────────────
 * So the refinement is not a bound on the period's size, it is a bound on the
 * horizon: keep the veto while the horizon can still grow, and abstain only
 * once growth is exhausted (`atCapOnly: true`). That is PV255's "a derived
 * exclusion rule must share the horizon of the detection it feeds", applied to
 * the combine step. Its production home is exactly `songAnalysis.ts:390`, the
 * `if (horizon >= cap)` branch that currently falls straight back to the cap —
 * where `horizon >= cap` is already in scope, so nothing needs re-deriving.
 *
 * Two further clauses are priced SEPARATELY so each is attributable rather than
 * bundled: `minPeriod` (refuse a period of 1 at the cap — a direct guard on the
 * #1102 shape) and `minLaneShare` (the abstaining lanes must be a minority, so
 * a span is never claimed on the strength of one lane out of seven).
 *
 * ── WHAT IS AND IS NOT VARIED ────────────────────────────────────────────────
 * Detection is production: this calls `cycleFingerprints` and `detectPeriod`
 * per lane exactly as `detectDisplayPeriod` does, and keys lanes with the
 * production `laneKeyOf`. ONLY the combine step differs. So a moved document is
 * attributable to that one rule and no second detector exists to agree with
 * itself ([[PV192]]).
 *
 * Injected into the real `analyzeSong` loop rather than applied to a finished
 * analysis, because — as the refutation above shows — the rule CHANGES WHICH
 * HORIZON the document resolves at, and that is most of the effect. Post-
 * processing a fixed-horizon snapshot would measure a different rule than the
 * one that would ship.
 */
export interface AbstentionRule {
  /**
   * Abstain only once the progressive horizon is exhausted. `cap` must match
   * the cap `analyzeSong` is running with — this models the `horizon >= cap`
   * branch, which is where the rule would actually live.
   */
  atCapOnly: boolean
  cap?: number
  /** Refuse a combined period below this, falling back to aperiodic. */
  minPeriod?: number
  /** Require this share of lanes (0..1) to have answered before accepting. */
  minLaneShare?: number
  /**
   * Require the document's DENSEST lane (most events) to be among those that
   * answered — the intuition being that an ostinato should not set the span
   * while the lane carrying the song's content abstains.
   *
   * Priced because it was proposed, and it is measured rather than assumed:
   * the per-lane probe of the six 2-cycle recoveries shows the densest lanes
   * are the ostinatos themselves (`elArpegio`/`elAcorde` at 2048 events each)
   * and the melody is LIGHTER (`laMelodia`, 1640), so this clause cannot see
   * four of the six documents it was proposed to fix.
   */
  requireDensestLane?: boolean
  /** Require the answering lanes to hold this share (0..1) of all events. */
  minAnsweredEventShare?: number
  /**
   * Refuse when any SINGLE abstaining lane holds at least this share of the
   * document's events. States the thing the six bad recoveries have in common
   * without routing it through "which lane is biggest": a lane heavy enough to
   * be the song's content, with no period of its own, contradicts a 2-cycle
   * span no matter how many light ostinatos agree on one.
   */
  maxAbstainingLaneShare?: number
}

export function abstainingDetector(
  rule: AbstentionRule,
): (events: readonly IREvent[], horizon: number) => number | null {
  const cap = rule.cap ?? 256
  return (events, horizon) => {
    const byLane = new Map<string, IREvent[]>()
    for (const ev of events) {
      const key = laneKeyOf(ev)
      let bucket = byLane.get(key)
      if (!bucket) {
        bucket = []
        byLane.set(key, bucket)
      }
      bucket.push(ev)
    }
    // Same degenerate case the production rule has: no lanes at all → ask the
    // whole-event fingerprint rather than inventing an answer.
    if (byLane.size === 0) return detectPeriod(cycleFingerprints(events, horizon))

    let maxPeriod = 0
    let answered = 0
    let vetoed = false
    let answeredEvents = 0
    let totalEvents = 0
    let densestCount = -1
    let densestAnswered = false
    let heaviestAbstaining = 0
    for (const laneEvents of byLane.values()) {
      const p = detectPeriod(cycleFingerprints(laneEvents, horizon))
      const n = laneEvents.length
      totalEvents += n
      // Ties go to "answered" only if an answering lane holds the maximum, so a
      // tie between an answering and an abstaining lane does not refuse.
      if (n > densestCount) {
        densestCount = n
        densestAnswered = p !== null
      } else if (n === densestCount && p !== null) {
        densestAnswered = true
      }
      if (p === null) {
        vetoed = true
        if (n > heaviestAbstaining) heaviestAbstaining = n
        continue
      }
      answered++
      answeredEvents += n
      if (p > maxPeriod) maxPeriod = p
    }

    // BELOW THE CAP under `atCapOnly`, this IS the production rule — a null
    // here is the signal that doubles the horizon, and suppressing it is what
    // cost the first candidate 5 correct periods.
    if (vetoed && rule.atCapOnly && horizon < cap) return null

    if (answered === 0 || maxPeriod <= 0) return null

    // THE EXTRA CLAUSES GUARD ABSTENTION'S ANSWER, so they apply only when a
    // lane actually abstained. If every lane answered, this rule agreed with
    // production and has no standing to overrule it.
    //
    // Measured, and it is why this gate exists: ungated, `minPeriod: 2` also
    // refused the honest period-1 answer on documents where nothing abstained.
    // Because a `null` here means "grow the horizon", those documents did not
    // merely lose a guard — they were pushed to the 256-cycle cap. All 19
    // period-1 documents changed state, 3 becoming fully aperiodic and 16
    // keeping period 1 while flipping to at-cap. A clause meant to PREVENT the
    // #1102 shape was manufacturing the #1104 one.
    if (vetoed) {
      if (rule.minPeriod !== undefined && maxPeriod < rule.minPeriod) return null
      if (rule.minLaneShare !== undefined && answered / byLane.size < rule.minLaneShare) return null
      if (rule.requireDensestLane && !densestAnswered) return null
      if (
        rule.minAnsweredEventShare !== undefined &&
        totalEvents > 0 &&
        answeredEvents / totalEvents < rule.minAnsweredEventShare
      ) {
        return null
      }
      if (
        rule.maxAbstainingLaneShare !== undefined &&
        totalEvents > 0 &&
        heaviestAbstaining / totalEvents >= rule.maxAbstainingLaneShare
      ) {
        return null
      }
    }
    return maxPeriod
  }
}


/** The detector shape the production path takes: events + the horizon reached. */
export type DetectPeriodFn = (events: readonly IREvent[], horizon: number) => number | null

/**
 * What a candidate rule may know about the DOCUMENT it is judging (#1465).
 *
 * ⚠ THE SEAM EXISTED BUT THE CHANNEL DID NOT. `detectPeriodFn` receives events
 * and a horizon and nothing else, so a rule could not be told which controls the
 * SOURCE says are modulated — only what it could infer by watching the events go
 * by. That inference is exactly what sank the earlier attempt at this exclusion:
 * a probe window can only see periods shorter than itself, so a slow field read
 * as unstable and got dropped (`song-period-sweep.test.ts` header — it discarded
 * `note` and `s` in ~75 documents).
 *
 * `periodOfDocument` has held the document's source all along, so the channel is
 * one signature wide. `signalKeys` is read STRUCTURALLY from the IR and is
 * therefore horizon-free: the same fact at horizon 4 and at horizon 256, which is
 * the property `songAnalysis.ts` requires when it says a derived exclusion rule
 * has to share the horizon of the detection it feeds.
 */
export interface DocumentContext {
  readonly name: string
  readonly code: string
  /**
   * Parameter keys the document's IR says carry a signal — `cutoff`, `gain`,
   * `pan`… Addressed by KEY because that is how the cycle fingerprint names a
   * dimension (`eventValueKey.ts`: `{note, freq, s, gain, velocity, color}` plus
   * `params`). Empty when the document parses but automates nothing, and also
   * empty when it fails to parse — see `parsed`, which tells the two apart.
   */
  readonly signalKeys: ReadonlySet<string>
  /** False when the source could not be parsed, so an empty `signalKeys` is not
   *  mistaken for "this document automates nothing". A rule that cannot tell
   *  those apart reports its own blind spot as a clean result. */
  readonly parsed: boolean
  /**
   * The LIVE `hasUnheardTrack` predicate — the same closure `analyzeSong` is
   * given, not a snapshot.
   *
   * ⚠ A CANDIDATE THAT CANNOT SEE THIS CANNOT DELEGATE TO PRODUCTION, and a
   * candidate that does not delegate is not measuring what would ship. The
   * production rule is `displayPeriodRule(events, horizon, cap, hasUnheardTrack)`
   * and that fourth argument changes its answer (#1107). An injected detector is
   * called with only `(events, horizon)`, so without this channel a candidate has
   * to re-implement the rule it means to extend — and a re-implementation that is
   * subtly cruder reports its OWN differences as the candidate's effect. Measured
   * the hard way: approximating production as
   * `detectPeriod(cycleFingerprints(events, horizon))` — a global fingerprint
   * where production is per-lane — moved 8 documents that resolve below the cap,
   * including two periods LENGTHENED (28→56, 23→92), which the candidate rule is
   * mathematically incapable of doing. Every one of those was the approximation
   * showing through, not the rule.
   *
   * Asked at decision time rather than passed as a value because its answer moves
   * with the horizon — the same reason `analyzeSong` asks it that way.
   */
  readonly hasUnheardTrack: () => boolean
}

/** A rule that needs to know about the document, built fresh per document.
 *  Returning `undefined` means "use the production rule for this one". */
export type DetectorFactory = (ctx: DocumentContext) => DetectPeriodFn | undefined

/**
 * Either a document-INDEPENDENT detector (what every existing caller passes) or
 * a document-dependent one. Wrapped in an object rather than offered as a bare
 * second function type because both are functions at runtime and a union of two
 * function types cannot be told apart — the wrapper makes the choice explicit at
 * the call site and impossible to get wrong by accident.
 */
export type SweepDetector = DetectPeriodFn | { readonly perDocument: DetectorFactory }

/** The half of the context that comes from the SOURCE. Never throws: a document
 *  that will not parse yields `parsed: false` rather than aborting a
 *  150-document sweep. */
export type StructuralContext = Omit<DocumentContext, 'hasUnheardTrack'>

export function documentContext(name: string, code: string): StructuralContext {
  try {
    return { name, code, signalKeys: signalCarryingParamKeys(parseStrudel(code) as never), parsed: true }
  } catch {
    return { name, code, signalKeys: new Set<string>(), parsed: false }
  }
}


/**
 * A candidate for #1465: at the cap, ask the identity question WITHOUT the
 * dimensions the document's own source says are continuously modulated.
 *
 * ── THE ARGUMENT ─────────────────────────────────────────────────────────────
 * `cycleFingerprints` summarises a cycle from the event's whole value partition,
 * which is right — that is what fixed #1102. But a control driven by an LFO makes
 * every cycle genuinely differ on that one axis, so the LANE goes aperiodic and
 * the document falls to the 256-cycle cap. The structure did not change; one
 * dimension is sweeping over it. Excluding exactly that dimension asks "does the
 * rest of this repeat?", which is the question the display span actually needs.
 *
 * ── WHY THIS IS NOT THE RULE THAT WAS ALREADY REJECTED ───────────────────────
 * "Drop dimensions with no period of their own" was prototyped and set aside
 * because its stability question could only see as far as its probe window, so a
 * field whose period exceeded that window read as unstable and was dropped —
 * it discarded `note` and `s` in ~75 documents. This takes the exclusion from the
 * IR instead: `Param{value: …Signal}` is a fact about the SOURCE, identical at
 * every horizon, so it cannot drift with the horizon it feeds. Same intent,
 * different evidence, and the objection was entirely about the evidence.
 *
 * ── WHERE THE SAFETY ACTUALLY COMES FROM, which is not where I argued ────────
 * The plan for this claimed `atCapOnly` was structurally REQUIRED: dropping a
 * dimension can only shorten or preserve a period, shortening is the #1102
 * defect, and below the cap a `null` is what buys the next doubling — so
 * narrowing the question early would answer with whatever short period survived.
 *
 * ⚠ MEASURED, THAT IS WRONG. The unconditional arm scores IDENTICALLY on this
 * corpus: 19 recovered, 0 below-cap documents changed, 0 periods destroyed, 0
 * collapsed to 1. The safety comes from `if (production !== null) return
 * production` — this rule only ever ADDS a period where production found none
 * and never replaces one production already answered, so a document that
 * resolves below the cap is untouchable regardless of the horizon gate.
 *
 * The gate is kept anyway, and the measurement is the reason it can be: it costs
 * exactly ZERO recoveries, and it converts "no below-cap document changed" from
 * something true of these 142 documents into something a reader can see is true
 * of any document. Free insurance is worth keeping; a required guarantee is what
 * it is not, and the difference matters to whoever reads this next.
 */
export interface SignalExclusionRule {
  /** Only ask the narrowed question once the progressive horizon is exhausted. */
  atCapOnly: boolean
  cap?: number
  /** Refuse a period below this, falling back to aperiodic — the guard against
   *  trading a 256-cycle sliver for a meaningless 1-cycle one. */
  minPeriod?: number
}

/** Strip one dimension from an event, in whichever half of the partition holds
 *  it. A `VALUE_SLOTS` member becomes `undefined` (a constant in every cycle);
 *  anything else is a `params` entry and is removed outright. */
function withoutKeys(ev: IREvent, keys: ReadonlySet<string>): IREvent {
  const copy = { ...ev } as unknown as Record<string, unknown>
  let touched = false
  for (const k of keys) {
    if (k in copy && !(copy.params && typeof copy.params === 'object' && k in (copy.params as object))) {
      if (copy[k] !== undefined) { copy[k] = undefined; touched = true }
    }
  }
  const params = ev.params
  if (params) {
    let dropped = false
    const next: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(params)) {
      if (keys.has(k)) { dropped = true; continue }
      next[k] = v
    }
    if (dropped) { copy.params = next; touched = true }
  }
  return (touched ? copy : ev) as unknown as IREvent
}

export function signalExcludingDetector(
  ctx: DocumentContext,
  rule: SignalExclusionRule,
): DetectPeriodFn {
  const cap = rule.cap ?? 256
  return (events, horizon) => {
    // DELEGATE, never re-implement: this is the production rule, called exactly
    // as `analyzeSong` calls it. The candidate's whole content is WHICH EVENTS it
    // is asked about, so anything else that differs is a bug in the harness.
    const unheard = ctx.hasUnheardTrack()
    const production = displayPeriodRule(events, horizon, cap, unheard)

    // Below the cap this IS production, returned untouched. Not a tuning choice:
    // dropping a dimension can only shorten or preserve a period, and below the
    // cap a `null` is what buys the next doubling, so narrowing the question
    // early answers with whatever short period happened to survive.
    if (rule.atCapOnly && horizon < cap) return production
    // Already answered — nothing to recover.
    if (production !== null) return production
    if (ctx.signalKeys.size === 0) return null

    const stripped = events.map((ev) => withoutKeys(ev, ctx.signalKeys))
    const p = displayPeriodRule(stripped, horizon, cap, unheard)
    if (p === null) return null
    if (rule.minPeriod !== undefined && p < rule.minPeriod) return null
    return p
  }
}

/** Analyse one already-evaluated document through the production path. */
export async function periodOfTracks(
  tracks: readonly SongTrack[],
  detector?: SweepDetector,
  structural?: StructuralContext,
): Promise<Omit<PeriodVerdict, 'name' | 'ok' | 'error'>> {
  let events = 0
  const collect = trackCollector(tracks)
  // #1107 — the presence clause's two sides, both in the CAPTURE key space, which
  // is the space production asks it in too. Here `tracks` IS `songPatterns`
  // mirrored (`evalSongTracks`), and this collector does not remap, so expected
  // and heard share one vocabulary by construction — the same arrangement
  // `MusicalTimeline` reaches by recording raw keys before its remap.
  const declared = tracks.map((t) => t.trackId)
  const heard = new Set<string>()
  const hasUnheardTrack = (): boolean => declared.some((id) => !heard.has(id))
  // A per-document rule is BUILT HERE, because this is the only scope that holds
  // both halves of its context: the structural read (from the source, passed in)
  // and the live `hasUnheardTrack` closure (from this collection).
  const detectPeriodFn =
    typeof detector === 'function' || detector === undefined
      ? detector
      : detector.perDocument({
          name: structural?.name ?? '',
          code: structural?.code ?? '',
          signalKeys: structural?.signalKeys ?? new Set<string>(),
          parsed: structural?.parsed ?? false,
          hasUnheardTrack,
        })
  const analysis = await analyzeSong(null, {
    // no yield: this is a batch sweep, not a frame budget. The yield primitive is
    // injectable precisely so the slicing logic stays deterministic under test.
    yieldFn: async () => {},
    collectFn: (a, b) => {
      const evs = collect(a, b)
      events += evs.length
      for (const ev of evs) if (ev.trackId !== undefined) heard.add(ev.trackId)
      return evs
    },
    detectPeriodFn,
    hasUnheardTrack,
  })
  const shipped = new Set(analysis.lanes.map((l) => l.laneKey))
  return {
    // The raw MEASUREMENTS stay measurements here — this instrument's job is to
    // record what the analysis found. `span` and `reachedCap` are the view's
    // reading of them, so both now come from the analysis's own answer rather
    // than being re-derived; the recorded row shape is unchanged.
    period: analysis.periodCycles,
    span: analysis.displaySpan.cycles,
    reachedCap: analysis.displaySpan.kind === 'capped',
    lanes: analysis.lanes.length,
    lostLanes: [...heard].filter((id) => !shipped.has(id)).length,
    events,
  }
}

/** Evaluate + analyse one document. */
export async function periodOfDocument(
  code: string,
  name: string,
  detector?: SweepDetector,
): Promise<PeriodVerdict> {
  const r = await evalSongTracks(code)
  if (!r.ok) {
    return {
      name,
      ok: false,
      error: r.error,
      period: null,
      span: 0,
      reachedCap: false,
      lanes: 0,
      lostLanes: 0,
      events: 0,
    }
  }
  try {
    return {
      name,
      ok: true,
      ...(await periodOfTracks(r.tracks, detector, documentContext(name, code))),
    }
  } catch (e: unknown) {
    return {
      name,
      ok: false,
      error: 'analyze: ' + String((e as Error)?.message ?? e),
      period: null,
      span: 0,
      reachedCap: false,
      lanes: 0,
      lostLanes: 0,
      events: 0,
    }
  }
}

/**
 * Sweep the whole corpus, in corpus order.
 *
 * With no `detectPeriodFn` this is the production rule — the pinned baseline.
 * Pass one to price a CANDIDATE rule over the same documents through the same
 * loop, so the two sweeps differ in exactly one function.
 */
export async function sweepCorpus(detector?: SweepDetector): Promise<PeriodVerdict[]> {
  const corpus = await loadCorpus()
  const out: PeriodVerdict[] = []
  for (const { name, code } of corpus) out.push(await periodOfDocument(code, name, detector))
  return out
}

/** `period → how many documents` — the distribution the risk is read from. */
export function periodHistogram(verdicts: readonly PeriodVerdict[]): Map<string, number> {
  const h = new Map<string, number>()
  for (const v of verdicts) {
    if (!v.ok) continue
    const k = v.period === null ? `aperiodic(span ${v.span})` : String(v.period)
    h.set(k, (h.get(k) ?? 0) + 1)
  }
  return h
}
