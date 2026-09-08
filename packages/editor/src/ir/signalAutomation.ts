/**
 * Continuous automation a track declares, read off the static IR (#1464 Stage 1).
 *
 * `.cutoff(saw.slow(4).range(200, 2000))` is a parameter that MOVES, and until
 * #1478/#1482 it reached the IR as an opaque `Code` — the timeline could not see
 * that anything was modulated at all. Those two landed the three legs #1464 names
 * as its prerequisite, so the shape, the rate and the range are now plain field
 * reads off a nested node:
 *
 *   Param{key:'cutoff', value: Range{lo:200, hi:2000,
 *                                body: Slow{factor:4,
 *                                       body: Signal{kind:'saw'}}}}
 *
 * This module turns that into what a lane needs to DRAW one, plus — since Stage 2
 * (#1464 option 2) — WHERE each leg is written, so a control can edit it in place.
 * It still emits no source and holds no inverse: `SignalSpans` carries source
 * COORDINATES, and the byte-verbatim round-trip #1482 established stays preserved
 * by construction here, because nothing in this file can produce text. What
 * changes is that a caller now has somewhere precise to write, which is exactly
 * the leverage Stage 2 needs and the whole of what this file lends it.
 *
 * Mirrors `trackOrder.ts`: pure and structural, no eval and no source scanning,
 * producing an IR-derived input for `buildTimelineScene` (which is documented
 * PURE — no IR walk) rather than reaching into the IR from inside the scene.
 */
import type { PatternIR } from './PatternIR'
import type { SourceLocation } from './IREvent'

type SignalNode = PatternIR & { tag: 'Signal' }
export type SignalKind = SignalNode['kind']

/**
 * A signal's NATURAL output range, when it has one — what the curve spans before
 * any `.range()` is applied.
 *
 * Grounded in `@strudel/core@1.2.6/signal.mjs` rather than inferred from the
 * names: the `2`-suffixed kinds are literally `x.toBipolar()` and the unsuffixed
 * ones are unipolar, which is a rule the source states rather than a convention
 * we are reading into it —
 *   saw     = signal((t) => t % 1)              → 0..1   (signal.mjs:35)
 *   saw2    = saw.toBipolar()                   → -1..1  (signal.mjs:42)
 *   sine2   = signal((t) => sin(2*PI*t))        → -1..1  (signal.mjs:70)
 *   sine    = sine2.fromBipolar()               → 0..1   (signal.mjs:80)
 *   square2 = square.toBipolar()                → -1..1  (signal.mjs:114)
 *   tri2    = fastcat(saw2, isaw2)              → -1..1  (signal.mjs:131)
 *   itri2   = fastcat(isaw2, saw2)              → -1..1  (signal.mjs:148)
 *   rand2   = rand.toBipolar()                  → -1..1  (signal.mjs:453)
 *   perlin  = "in the range 0..1" (its own doc) → 0..1   (signal.mjs:661)
 *
 * ⚠ `unbounded` is the load-bearing member. `time` is `signal(id)` — it returns
 * the cycle position and GROWS without limit (signal.mjs:155) — and the
 * `cyclesPer`/`per`/`perCycle`/`perx` family measure durations, so none of them
 * has a range to draw between. They are not a gap in this table: a lane that
 * guessed 0..1 for `time` would draw a confidently wrong curve, which is worse
 * than drawing nothing. Without an explicit `.range()` they ABSTAIN.
 */
type Polarity = 'unipolar' | 'bipolar' | 'unbounded'

const UNBOUNDED: ReadonlySet<string> = new Set(['time', 'cyclesPer', 'per', 'perCycle', 'perx'])

function polarityOf(kind: string): Polarity {
  if (UNBOUNDED.has(kind)) return 'unbounded'
  // Every bipolar signal in signal.mjs is the `2`-suffixed spelling of a
  // unipolar one, produced by `.toBipolar()`. `rand2`/`sine2`/`saw2`/`isaw2`/
  // `tri2`/`square2`/`cosine2`/`itri2` — the whole set, no exceptions.
  return kind.endsWith('2') ? 'bipolar' : 'unipolar'
}

/** One drawable continuous automation: which track, which parameter, and the
 *  three legs (#1464's own words) needed to plot it. */
export interface SignalAutomation {
  /** The lane this belongs to — the same `trackId` `declaredTracks` keys on. */
  readonly trackId: string
  /** The automated control: `cutoff`, `gain`, `pan`, … (the `Param`'s key). */
  readonly paramKey: string
  /** The signal's SHAPE. */
  readonly kind: SignalKind
  /** The signal's RATE, as the cycles one full period spans. `sine` is 1;
   *  `.slow(4)` makes it 4; `.fast(2)` makes it 0.5. Always finite and > 0. */
  readonly periodCycles: number
  /** The signal's RANGE — its output floor and ceiling. */
  readonly lo: number
  readonly hi: number
  /** True when `lo`/`hi` came from an explicit `.range(lo, hi)`; false when they
   *  are the signal's natural polarity. Kept because it is the difference between
   *  a number the user wrote and one this module supplied, and a lane that ever
   *  labels the axis must not present the second as the first. */
  readonly ranged: boolean
  /** Source offset of the `Param` call site, or null. The same coordinate the
   *  lanes already carry, so a later stage can bind this to the editor without a
   *  second provenance channel invented for it. */
  readonly offset: number | null
  /** WHERE each leg is written (#1464 Stage 2). Read the type's own doc. */
  readonly spans: SignalSpans
}

/**
 * Where each of the three legs is SPELLED in the source (#1464 Stage 2).
 *
 * ⚠ THIS IS THE ONLY WAY A CONTROL CAN WRITE, and the reason is structural, not
 * stylistic. `Range` regenerates from `rawArgs` and `Param` from its own
 * `rawArgs` (`toStrudel.ts:226`, `:196`) — that is what buys the byte-verbatim
 * round-trip #1482 established. The consequence is that setting `lo`/`hi` on an
 * IR node and re-emitting writes NOTHING: the raw text wins. So every Stage 2
 * edit is a source-offset replacement over these spans, on the same path every
 * other edit surface in this codebase uses.
 *
 * A span is `null` when the leg is not spelled — `sine` with no `.range()` names
 * no numbers to replace. That is not a gap to paper over: it is a DIFFERENT edit
 * (insert a call at `chainEnd`), and the two must not be confused, because one
 * preserves every other byte and the other lengthens the document.
 *
 * Measured over the sweep corpus (`loadCorpus`, 150 documents, 200 drawable
 * automations): range spelled 180 (90%), rate spelled 128 (64%), NEITHER 16 (8%).
 */
export interface SignalSpans {
  /** The signal identifier itself — `sine`, `perlin`. Replacing this text is the
   *  whole of a shape change. */
  readonly shape: SourceLocation | null
  /** The single `.slow(n)` / `.fast(n)` call site.
   *
   *  ⚠ NULL when the chain carries MORE THAN ONE rate arm, not only when it
   *  carries none. `sine.slow(2).fast(4)` has a well-defined rate (the product)
   *  and no well-defined place to write a new one — editing either arm produces
   *  the asked-for rate while silently changing what the user wrote elsewhere.
   *  Abstaining is the same discipline `readChain` already applies to shapes it
   *  cannot account for. */
  readonly rate: SourceLocation | null
  /** The `.range(lo,hi)` call site whose bounds WON — the outermost one, which
   *  is the one `readChain` adopted. An inner `.range()` it supersedes is dead
   *  in the document already and is not what a control should edit. */
  readonly range: SourceLocation | null
  /** Offset just past the whole signal expression, where an ABSENT leg's call
   *  would be inserted: `sine` + `.range(0,1)` at `chainEnd`. Null when the
   *  outermost node carries no source range, in which case no edit is possible
   *  and a control must be offered as disabled rather than as broken. */
  readonly chainEnd: number | null
}

/** The transform arms this module understands between a `Param` and its
 *  `Signal`. ANYTHING else ends the descent without an automation — see
 *  `readChain`. Deliberately tiny: `Range` is the range leg, `Slow`/`Fast` are
 *  the rate leg, and those are exactly the three #1464 asks for. */
const CHAIN_TAGS: ReadonlySet<string> = new Set(['Range', 'Slow', 'Fast'])

/** Source-coordinate keys — arrays of `{start,end}`, never IR. Skipped so the
 *  reflective walk does not wade through them on every node. */
const SKIP_KEYS: ReadonlySet<string> = new Set(['loc', 'keyLoc', 'callSiteRange'])

interface ChainRead {
  readonly signal: SignalNode
  readonly periodCycles: number
  readonly lo: number | null
  readonly hi: number | null
  /** #1464 Stage 2 — see `SignalSpans`. Collected on the same descent that
   *  reads the values, because the node carrying a value and the node carrying
   *  its source range are the same node; a second walk to find them again could
   *  disagree with this one about which `Range` won. */
  readonly spans: SignalSpans
}

/**
 * Descend a `Param`'s value looking for a signal underneath a chain of
 * transforms this module can account for.
 *
 * ⚠ ABSTAINS RATHER THAN GUESSES. The descent only walks `Range`/`Slow`/`Fast`;
 * meeting any other tag returns null and the parameter simply draws nothing. That
 * is the conservative direction here: this is a VIEW, so a missing curve is a
 * lane that shows less than it could, while a wrong curve is the editor lying
 * about what the document does. `.gain(sine.add(saw))` is real, has no closed
 * form this module can plot, and must therefore fall out rather than be
 * approximated by whichever leg the walk happened to reach first.
 *
 * The OUTERMOST `Range` wins, which is also the last-applied one: in
 * `saw.range(0,1).slow(4)` the `Slow` is outermost and the range is the inner
 * `0..1`, while in `saw.slow(4).range(200,2000)` the range is the outer pair.
 * Taking the first `Range` met on the way DOWN gets both right without a special
 * case, because descent order is application order reversed.
 */
function readChain(node: PatternIR): ChainRead | null {
  let cur: PatternIR = node
  let periodCycles = 1
  let lo: number | null = null
  let hi: number | null = null
  let rangeSpan: SourceLocation | null = null
  // Every rate arm met, not the first — the count is what decides whether a
  // control may write one at all. See `SignalSpans.rate`.
  const rateSpans: SourceLocation[] = []
  // The OUTERMOST node's end: the insertion point for a leg the source omits.
  // Taken on the first iteration, before any descent, because that node is the
  // whole expression as written — `sine.slow(4).range(200,2000)` ends where
  // `.range(200,2000)`'s own call site ends.
  const chainEnd = spanOf(node)?.end ?? null

  // Bounded by the IR's own depth; the guard is against a malformed cyclic node
  // rather than against legal input.
  for (let depth = 0; depth < 64; depth++) {
    if (!cur || typeof cur !== 'object' || typeof cur.tag !== 'string') return null

    if (cur.tag === 'Signal') {
      return {
        signal: cur as SignalNode,
        periodCycles,
        lo,
        hi,
        spans: {
          shape: spanOf(cur),
          rate: rateSpans.length === 1 ? rateSpans[0] : null,
          range: rangeSpan,
          chainEnd,
        },
      }
    }
    if (!CHAIN_TAGS.has(cur.tag)) return null

    if (cur.tag === 'Range') {
      // First one met is the outermost; an inner one is already superseded.
      if (lo === null && Number.isFinite(cur.lo) && Number.isFinite(cur.hi)) {
        lo = cur.lo
        hi = cur.hi
        // The span follows the VALUES it belongs to, in the same branch, so the
        // two can never end up describing different `.range()` calls.
        rangeSpan = spanOf(cur)
      }
    } else if (cur.tag === 'Slow') {
      if (!Number.isFinite(cur.factor) || cur.factor <= 0) return null
      periodCycles *= cur.factor
      const span = spanOf(cur)
      if (span) rateSpans.push(span)
    } else if (cur.tag === 'Fast') {
      if (!Number.isFinite(cur.factor) || cur.factor <= 0) return null
      periodCycles /= cur.factor
      const span = spanOf(cur)
      if (span) rateSpans.push(span)
    }

    const body: unknown = (cur as { body?: unknown }).body
    if (!body || typeof body !== 'object') return null
    cur = body as PatternIR
  }
  return null
}

/** A node's own source range, or null. `loc` is an ARRAY because some nodes are
 *  assembled from several source sites; the chain arms this module walks are
 *  each one call, so the first entry is the whole of it. */
function spanOf(node: PatternIR): SourceLocation | null {
  const loc = (node as { loc?: SourceLocation[] }).loc
  const first = loc?.[0]
  if (!first) return null
  return Number.isFinite(first.start) && Number.isFinite(first.end) ? first : null
}

/**
 * Every child IR node of `node`, found by REFLECTION rather than by a tag switch.
 *
 * ⚠ This is the deliberate choice in this file. An exhaustive `switch` over tags
 * is the house style for the semantic paths, but it carries a known cost: a new
 * IR tag inherits whatever the `default` arm does, silently, from every consumer
 * that was written before it existed. This consumer only needs to FIND `Param`
 * nodes — it makes no claim about what any tag means — so reading children
 * structurally makes it correct for tags that do not exist yet, and there is no
 * `default` arm to forget to update. The semantic judgement is confined to
 * `readChain`, which allowlists and abstains.
 */
function childNodes(node: PatternIR): PatternIR[] {
  const out: PatternIR[] = []
  const visit = (value: unknown, depth: number): void => {
    if (!value || typeof value !== 'object' || depth > 12) return
    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1)
      return
    }
    if (typeof (value as PatternIR).tag === 'string') {
      // A node. Yield it; its own children are found when IT is walked.
      out.push(value as PatternIR)
      return
    }
    // An UNTAGGED container — pass straight through it. `Code.via` and
    // `NamedPick.entries` both hold real sub-IR behind a plain object, so a
    // reflection that only stepped into tagged values stopped dead at them and
    // silently lost everything underneath. Measured: walking only tagged values
    // reached 142 of the corpus's 362 distinct signal-carrying Params.
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (SKIP_KEYS.has(key)) continue
      visit(child, depth + 1)
    }
  }
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (SKIP_KEYS.has(key)) continue
    visit(value, 0)
  }
  return out
}

/** Collect this track's automations, depth-first. Stops at a nested `Track` so a
 *  parameter is attributed to the track that actually declares it. */
function collectFromTrack(trackId: string, root: PatternIR, out: SignalAutomation[]): void {
  const stack: PatternIR[] = [root]
  const seen = new Set<PatternIR>()

  while (stack.length > 0) {
    const node = stack.pop() as PatternIR
    if (!node || typeof node !== 'object' || seen.has(node)) continue
    seen.add(node)

    if (node.tag === 'Param') {
      const value: unknown = node.value
      if (value && typeof value === 'object' && typeof (value as PatternIR).tag === 'string') {
        const read = readChain(value as PatternIR)
        if (read) {
          const polarity = polarityOf(read.signal.kind)
          const ranged = read.lo !== null && read.hi !== null
          // An unbounded signal with no explicit range has nothing to plot
          // BETWEEN, so it abstains rather than borrowing a plausible 0..1.
          if (ranged || polarity !== 'unbounded') {
            const lo = ranged ? (read.lo as number) : polarity === 'bipolar' ? -1 : 0
            const hi = ranged ? (read.hi as number) : 1
            const start = node.loc?.[0]?.start
            out.push({
              trackId,
              paramKey: node.key,
              kind: read.signal.kind,
              periodCycles: read.periodCycles,
              lo,
              hi,
              ranged,
              offset: typeof start === 'number' && Number.isFinite(start) ? start : null,
              spans: read.spans,
            })
          }
        }
      }
    }

    for (const child of childNodes(node)) {
      // A nested Track declares its own lane; its parameters are not this one's.
      if (child.tag === 'Track') continue
      stack.push(child)
    }
  }
}

/**
 * Every continuous automation the document declares, keyed by the track that
 * declares it, in source order. Empty for a document with none — which is most
 * of them, and is why the drawing side must treat absence as ordinary.
 */
export function signalAutomations(ir: PatternIR | null | undefined): readonly SignalAutomation[] {
  if (!ir) return []
  const roots: readonly PatternIR[] = ir.tag === 'Stack' ? ir.tracks : [ir]
  const out: SignalAutomation[] = []
  for (const node of roots) {
    if (node?.tag !== 'Track') continue
    const id = node.trackId
    if (typeof id !== 'string' || id.length === 0) continue
    collectFromTrack(id, node, out)
  }
  return out
}

/**
 * Every parameter KEY whose argument carries a signal anywhere (#1465).
 *
 * ⚠ THIS IS A DIFFERENT QUESTION FROM `signalAutomations`, ON THE SAME IR, and
 * the difference is the point rather than an oversight. That reader asks "can I
 * PLOT this?" and abstains on anything without a closed form. This one asks "does
 * this control MOVE?" — and `.gain(sine.add(saw))` has no closed form, cannot be
 * drawn, and absolutely does make every cycle differ.
 *
 * Measured over the sweep's own corpus (`loadCorpus`, 142 documents that
 * evaluate): the closed-form reader sees 199 signal-carrying `Param` nodes and
 * this one sees 239. Answering the period question with the drawing reader would
 * silently under-report by those 40.
 *
 * Returns KEYS rather than nodes because that is what the consumer needs: the
 * cycle fingerprint reads an event's whole value partition (`eventValueKey.ts` —
 * `{note, freq, s, gain, velocity, color} ∪ params`), and a key is how a
 * dimension is named there. `cutoff`/`resonance`/`pan`/`room` arrive via
 * `params`; `gain` has a dedicated slot. Both are addressed by key.
 *
 * Structural and horizon-FREE, which is the property that matters. An earlier
 * attempt at this exclusion derived it by watching a probe window, so a field
 * whose period exceeded that window read as unstable and got dropped — it
 * discarded `note` and `s` in ~75 documents. `Param{value: …Signal}` is the same
 * fact at horizon 4 and at horizon 256, so it cannot drift with the horizon it
 * feeds.
 */
export function signalCarryingParamKeys(ir: PatternIR | null | undefined): ReadonlySet<string> {
  const keys = new Set<string>()
  if (!ir) return keys
  const stack: PatternIR[] = [ir]
  const seen = new Set<PatternIR>()
  while (stack.length > 0) {
    const node = stack.pop() as PatternIR
    if (!node || typeof node !== 'object' || seen.has(node)) continue
    seen.add(node)
    if (node.tag === 'Param' && typeof node.key === 'string' && node.key.length > 0) {
      const value: unknown = node.value
      if (value && typeof value === 'object' && carriesSignal(value)) keys.add(node.key)
    }
    for (const child of childNodes(node)) stack.push(child)
  }
  return keys
}

/** Does this subtree contain a `Signal` anywhere? Deliberately unconditional —
 *  no allowlist, no closed-form requirement — because ANY signal underneath a
 *  control means that control moves. */
function carriesSignal(value: unknown, depth = 0): boolean {
  if (!value || typeof value !== 'object' || depth > 24) return false
  if (Array.isArray(value)) return value.some((v) => carriesSignal(v, depth + 1))
  const o = value as Record<string, unknown>
  if (o.tag === 'Signal') return true
  for (const [key, child] of Object.entries(o)) {
    if (SKIP_KEYS.has(key)) continue
    if (carriesSignal(child, depth + 1)) return true
  }
  return false
}

/**
 * Signals whose output actually REPEATS, listed rather than derived (#1465).
 *
 * The song period rule folds a signal's rate into the song's period, and that is
 * only meaningful for a signal that comes back to where it started. `sine.slow(4)`
 * repeats every 4 cycles; `rand` and `perlin` sample new values forever, `time`
 * grows without bound, and `mouseX` is live input. Sampling any of those longer
 * never yields a repeat, so there is no rate to fold — a document automated only
 * by those has no true period at all, and the analysis must say so rather than
 * invent one.
 *
 * ⚠ AN ALLOWLIST, DELIBERATELY, and the direction of the default is the reason.
 * A kind added to `PatternIR` later and forgotten here is treated as NOT
 * periodic, which costs a fold the analysis could have made — the period stays
 * the structural one, which is the answer production already gives. The denylist
 * spelling fails the other way: a new noise source would be folded as though it
 * repeated, and the song would be handed a definite length its audio does not
 * have. One direction under-promises, the other lies.
 *
 * The membership is `@strudel/core@1.2.6/signal.mjs` read directly, the same
 * source `polarityOf` above is grounded in: the periodic set is the waveform
 * family (`sine`/`cosine`/`saw`/`isaw`/`tri`/`itri`/`square`) in both its
 * unipolar and `2`-suffixed bipolar spellings, and nothing else.
 */
const PERIODIC_KINDS: ReadonlySet<string> = new Set([
  'sine', 'cosine', 'saw', 'isaw', 'tri', 'itri', 'square',
  'sine2', 'cosine2', 'saw2', 'isaw2', 'tri2', 'itri2', 'square2',
])

/** Does this signal's output repeat, so that `periodCycles` names a real period
 *  rather than just a rate? See `PERIODIC_KINDS` for why this is an allowlist. */
export function hasTruePeriod(kind: SignalKind): boolean {
  return PERIODIC_KINDS.has(kind)
}
