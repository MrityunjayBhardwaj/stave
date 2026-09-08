/**
 * PatternIR — the free monad over musical effects.
 *
 * The universal structural representation of music patterns.
 * PatternIR is the tree — IREvent[] is the derived flattened denotation.
 * Both coexist: PatternIR for structure/editing, IREvent[] for rendering.
 *
 * Design decisions:
 * - Tagged union (not generic <A>) — no return values needed for Phase F interpreters
 * - No Bind node — Seq covers musical sequencing without data dependency
 * - Code node — opaque fallback for fragments the parser can't handle
 * - All nodes are plain objects — serializable, no methods
 */

import type { SourceLocation } from './IREvent'

/** One arm of an `Arrange` time-sequence node = one timeline clip. Phase 5a. */
export interface ArrangeArm {
  /** Cycle weight — how many WHOLE cycles this arm spans (the `n` in
   *  `arrange([n, pat])`). `1` for every `cat`/`slowcat` arm. The arm occupies
   *  the cycle range `[Σweight_before, Σweight_before + weight)`; the whole
   *  node's period is `Σ weight`. */
  weight: number
  /** The arm's pattern sub-IR. Plays at its natural rate within the arm's span
   *  (its internal cycle advances across the span — grounded). */
  pattern: PatternIR
  /** Source range. For `arrange` arms this is the `[n, pat]` TUPLE range (so
   *  write-back can edit the weight `n`); for `cat`/`slowcat` arms it is the
   *  pattern-expression range. Optional only for hand-built fixtures. */
  loc?: SourceLocation[]
}

/** One named arm of a `NamedPick` (object-form pick family). #463 Stage 1. */
export interface NamedPickEntry {
  /** The lookup key — the bare/quoted object key, normalized to its string
   *  form. The selector's per-cycle STRING value (`ev.note`) matches this. */
  key: string
  /** The section's sub-IR (the object value expression, e.g. `s("bd sd")`). */
  pattern: PatternIR
  /** Source range of the key token (`verse` in `{verse: …}`) — lets a clip
   *  gesture bind the section's content back to its definition site. */
  keyLoc?: SourceLocation
}

export interface PlayParams {
  s?: string            // instrument/sample name
  gain?: number         // 0-1
  velocity?: number     // 0-1
  sustain?: number      // seconds
  release?: number      // seconds
  pan?: number          // -1 to 1
  color?: string        // display color
  [key: string]: unknown  // extensible
}

// 19-05 (#74): every non-Play tag carries optional source-correspondence
// metadata — `loc?: SourceLocation[]` (the source range the parser saw)
// and `userMethod?: string` (the literal method name the user typed at
// the call site, per D-08 exact-token taxonomy). Both are optional because
// non-parser code paths (test fixtures, IR transforms) construct nodes
// without metadata. CONTEXT D-03, D-07, D-12.
//
// 19-07 (#79) — the 6 root-eligible union members (Pure, Seq, Stack, Play,
// Cycle, Code) carry two optional stage-transition metadata fields:
// `unresolvedChain?: string` and `chainOffset?: number`. These are SET by
// `runMiniExpandedStage` on each track root, READ + DROPPED by
// `runChainAppliedStage`, and IRRELEVANT for engine consumption (collect,
// toStrudel, irProjection ignore them per CONTEXT D-03). The other 16
// union members (Fast, Slow, Every, ...) are constructed only inside
// applyChain and never sit at a track root post-parseRoot, so they do
// NOT carry these fields. Narrow-union additive change preserves PV32
// (implicit-IR principle). RESEARCH §3.1 fallback option.
export type PatternIR =
  | { tag: 'Pure'; loc?: SourceLocation[]; userMethod?: string; unresolvedChain?: string; chainOffset?: number }
  | { tag: 'Seq';    children: PatternIR[]; loc?: SourceLocation[]; userMethod?: string; unresolvedChain?: string; chainOffset?: number }
  | { tag: 'Stack';  tracks: PatternIR[]; loc?: SourceLocation[]; userMethod?: string; unresolvedChain?: string; chainOffset?: number }
  | { tag: 'Play';   note: string | number; duration: number; params: PlayParams; loc?: SourceLocation[]; unresolvedChain?: string; chainOffset?: number }
  | { tag: 'Sleep';  duration: number; loc?: SourceLocation[]; userMethod?: string }
  | { tag: 'Choice'; p: number; then: PatternIR; else_: PatternIR; loc?: SourceLocation[]; userMethod?: string }
  | { tag: 'Every';  n: number; body: PatternIR; default_?: PatternIR; loc?: SourceLocation[]; userMethod?: string }
  | { tag: 'Cycle';  items: PatternIR[]; loc?: SourceLocation[]; userMethod?: string; unresolvedChain?: string; chainOffset?: number }
  | { tag: 'When';   gate: string; body: PatternIR; loc?: SourceLocation[]; userMethod?: string }
  | { tag: 'Ramp';   param: string; from: number; to: number; cycles: number; body: PatternIR; loc?: SourceLocation[]; userMethod?: string }
  | { tag: 'Fast';   factor: number; body: PatternIR; loc?: SourceLocation[]; userMethod?: string }
  | { tag: 'Slow';   factor: number; body: PatternIR; loc?: SourceLocation[]; userMethod?: string }
  | { tag: 'Range';
      lo: number;                               // #1481 — `.range(lo, hi)` maps a signal's OUTPUT
      hi: number;                               //   range. It is a VALUE transform, not a time one.
      rawArgs: string;                          // RAW (untrimmed) — byte-fidelity, the Param contract
      body: PatternIR;                          //   (the corpus writes `.range(0.3,0.8)` unspaced, and
      loc?: SourceLocation[];                   //   the opaque node it replaces preserved that for free)
      userMethod?: string;
    }
  | { tag: 'Elongate'; factor: number; body: PatternIR; loc?: SourceLocation[]; userMethod?: string }  // Mini-notation `a@N` — weights this slot inside a parent Seq
  | { tag: 'Late';   offset: number; body: PatternIR; loc?: SourceLocation[]; userMethod?: string }  // Tier 4 — shifts events forward by `offset` cycles, preserving cycle length
  | { tag: 'Degrade'; p: number; body: PatternIR; loc?: SourceLocation[]; userMethod?: string }  // Tier 4 — `p` is the per-event RETENTION probability; .degrade() ⇒ p=0.5; .degradeBy(x) ⇒ p=1-x
  | { tag: 'Chunk';  n: number; transform: PatternIR; body: PatternIR; loc?: SourceLocation[]; userMethod?: string }  // Tier 4 — per-cycle slot rotation; `transform` is the body with the user transform pre-applied
  | { tag: 'Ply';    n: number; body: PatternIR; loc?: SourceLocation[]; userMethod?: string }  // Tier 4 — repeats each event of body n times within its own slot (pattern.mjs:1905-1911)
  | { tag: 'Pick';   selector: PatternIR; lookup: PatternIR[]; loc?: SourceLocation[]; userMethod?: string }  // Tier 4 — for each event of selector, pick lookup[clamp(round(value), 0, len-1)] and play at the selector event's slot (pick.mjs:44-54). First list-of-sub-IRs shape.
  | { tag: 'NamedPick'; selector: PatternIR; entries: NamedPickEntry[]; method: string; rawArgs: string; loc?: SourceLocation[]; userMethod?: string }  // #463 Stage 1 — object/named-key pick family (`sel.pickRestart({verse:…, chorus:…})`). selector's STRING value keys `entries`; `method` ∈ pick(innerJoin)/pickRestart(restartJoin)/pickReset(resetJoin) drives inner-cycle timing. `rawArgs` = verbatim object-literal source for byte-faithful toStrudel (matches the opaque-Code precedent it replaces).
  | { tag: 'Struct'; mask: string; body: PatternIR; loc?: SourceLocation[]; userMethod?: string }  // Tier 4 — re-times body's value-stream to mask onsets (pattern.mjs:1161, this.keepif.out). Distinct from When/mask which only gates.
  | { tag: 'Swing';  n: number; body: PatternIR; loc?: SourceLocation[]; userMethod?: string }  // Tier 4 — narrow tag per D-03; pattern.mjs:2193 swing(n) = pat.swingBy(1/3, n) = pat.inside(n, late(seq(0, 1/6))). Inside primitive deferred.
  | { tag: 'Shuffle';  n: number; body: PatternIR; loc?: SourceLocation[]; userMethod?: string }  // Tier 4 (Phase 19-04 T-05) — signal.mjs:392 shuffle(n) = _rearrangeWith(randrun(n), n, pat); per-cycle permutation of n slices, each played exactly once per cycle.
  | { tag: 'Scramble'; n: number; body: PatternIR; loc?: SourceLocation[]; userMethod?: string }  // Tier 4 (Phase 19-04 T-05) — signal.mjs:405 scramble(n) = _rearrangeWith(_irand(n)._segment(n), n, pat); per-slot independent samples (with replacement) of n slices.
  | { tag: 'Chop';   n: number; body: PatternIR; loc?: SourceLocation[]; userMethod?: string }  // Tier 4 (Phase 19-04 T-08) — pattern.mjs:3291-3306 chop(n) = pat.squeezeBind(o => sequence(slice_objects.map(s => merge(o, s)))). Per-event sample-range slicing — each source event becomes n sub-events with progressive begin/end controls. D-04: pattern-level only; audio-buffer slicing deferred to phase 22 (axis 5).
  | { tag: 'Slice';
      n: number | readonly number[];            // slice COUNT, or explicit split points in [0,1]
      index: string | PatternIR;                // which slice plays when — the ORDER the user controls.
                                                // A quoted mini-notation string is carried RAW (the `Struct.mask`
                                                // precedent), because parsing it as a sub-IR types it as NOTES and
                                                // `slice`'s second argument is slice INDICES: measured,
                                                // `.slice(4, "0 1 2 3")` round-tripped to `.slice(4, note("0 1 2 3"))`.
                                                // An expression index is a sub-IR, which round-trips exactly.
      body: PatternIR;
      loc?: SourceLocation[];
      userMethod?: string }  // Tier 4 (#1352 / E2E-5) — pattern.mjs:3356-3373 slice(npat, ipat, opat) yields `{begin, end, _slices: n}` where begin = Array.isArray(n) ? n[i] : i/n. Chop's sibling: chop fixes the ORDER and slice lets the user pattern it, which is what makes it the vocal comping primitive (reordering slices = reordering a take). Registered with auto-patternification OFF upstream. Measured: 19 of 329 corpus documents call it, and every one reached the IR as an opaque Code before this node existed.
  | { tag: 'Param';
      key: string;                              // 's' | 'n' | 'note' | 'gain' | 'velocity' | 'color' | 'pan' | 'speed' | 'bank' | 'scale'
      value: string | number | PatternIR;       // literal OR pattern-arg sub-IR (D-03)
      rawArgs: string;                          // RAW (untrimmed) — round-trip byte-fidelity per CONTEXT D-03 / 20-04 D-02
      body: PatternIR;                          // receiver
      loc?: SourceLocation[];                   // call-site range (.method(args))
      userMethod?: string;                      // user-typed token (PV32 — projection short-circuits on this; redundant w/ key for v1 but kept stable for future aliases)
    }   // Phase 20-10 — Param tag (semantics-completeness pair-of PV37)
  | { tag: 'Track';
      trackId: string                            // 'd1' | 'd2' | ... | <user-typed via .p()>
      body: PatternIR
      loc?: SourceLocation[]                     // $: line range OR .p() call-site range OR undefined (synthetic d1)
      userMethod?: string                        // 'p' if from .p(); undefined if synthetic from $: or single-expression
      /**
       * The `_` mute prefix on the statement's label (`_$:`, `_drums:`), #1488.
       *
       * ⚠ NOT identity, and it must never become identity — `trackId.ts` strips
       * the marker before deriving `trackId` precisely so a muted track keeps
       * its lane, and that stays true. This records the fact SEPARATELY, for
       * consumers that legitimately need to know whether a track sounds.
       *
       * It exists because the fact was otherwise recoverable only from the
       * SOURCE, by reading the character at `loc[0].start` — so every consumer
       * needing it had to be handed the document text as well as its IR. The
       * period rule (`signalDimensionsOf`) is the one that made that untenable:
       * it folds a modulating signal's rate into the song's length, which is
       * arithmetic on the IR alone, so a silent track's LFO was lengthening
       * audible songs.
       *
       * ⚠ ABSENT rather than `false` when a track is not muted, deliberately:
       * an unmuted `Track` serialises byte-identically to before this field
       * existed. Read it as `=== true`, never as a required boolean.
       */
      muted?: boolean
    }   // Phase 20-11 — Track tag (musician-track-identity wrapper; PV35 + PV37 model extension)
  | { tag: 'Loop';   body: PatternIR; loc?: SourceLocation[]; userMethod?: string }
  | {
      tag: 'Code'
      code: string
      lang: 'strudel'
      loc?: SourceLocation[]
      userMethod?: string
      unresolvedChain?: string
      chainOffset?: number
      // Phase 20-04 (PV37 / PK13 step 2 / D-01..D-03). When set, this Code
      // node is an OPAQUE-FRAGMENT WRAPPER constructed by `wrapAsOpaque`
      // (parseStrudel.ts) at `applyMethod`'s default arm or any typed
      // arm's parse-failure branch. The wrapper preserves the typed
      // `.method(args)` source verbatim while keeping the receiver IR
      // walkable via `via.inner`. When unset, the Code node is a
      // parse-failure fallback (DV-08; pre-20-04 semantics unchanged).
      via?:
        | {
            method: string                    // raw method name e.g. 'release'
            args: string                      // RAW (untrimmed) per D-02 — round-trip byte-fidelity
            callSiteRange: [number, number]   // entire .method(args) source range
            inner: PatternIR                  // back-pointer to receiver; REQUIRED in wrapper case (D-01 walks it)
          }
        // Phase 20-17 G3 (D-02 CORRECTION) — literal-RHS marker. The original
        // D-02 ("store as Code-with-via, no ripple") was unconstructible:
        // `Code.via` was specifically the `wrapAsOpaque` shape; a literal `4`
        // has no method/args/inner. Per LOCKED user decision (CONTEXT
        // "D-02 CORRECTION (2026-05-19)"), `Code.via` is widened with this
        // ADDITIVE arm. The existing `wrapAsOpaque` arm above stays
        // byte-unchanged (no `kind` discriminant — discriminate at consumer
        // sites by `'literal' in via` / `via.inner === undefined`). The
        // opaque fence (`tag === 'Code' && via === undefined`) is
        // byte-IDENTICAL because a literal sets `via` to a defined object
        // → `via !== undefined` → already on the "structured, don't bail"
        // side. P67 tri-state is preserved exactly. A literal `via` node is
        // a LEAF — deep walkers must NOT recurse into `via.inner` on it.
        | { literal: true; raw: string }
    }  // Opaque fallback for unparseable fragments OR opaque-fragment wrapper for unrecognised chain methods
  // Phase 20-18 Wave A (PV53 / 20-17 G3 additive idiom). ADDITIVE union
  // members for the curated signal/builder chain-ROOT family. Wave-0
  // Lokāyata verdict (a): root-recognition-suffices — the existing
  // `applyChain` carries any chain off a recognised root, so these tags
  // model ONLY the ROOT token (no signal-expression-as-ARG recogniser).
  // `kind` is the FROZEN Wave-0 curated-set membership (20-18-OBSERVATIONS
  // ACTION 6) — no later wave widens it without provenance + a re-pose.
  // The producer (`recogniseChainRoot`) is Wave B; the consumer audit
  // (PV53) is CREATED here, DISCHARGED in Wave D. The `tag === 'Code' &&
  // via === undefined` opaque fence above is byte-IDENTICAL (these are
  // NEW members — zero edit to any existing member or the fence).
  | { tag: 'Signal'
      // #953 — every kind here is an export of @strudel/core/signal.mjs that is
      // a `Pattern` INSTANCE, verified by `chainRootDrift.test.ts` rather than
      // transcribed. `pulse` was removed: it is not a Strudel identifier at all
      // (it is a superdough oscillator waveform, reachable only as `s("pulse")`),
      // so recognising it drew a structured lane for code that would throw.
      kind: 'sine' | 'cosine' | 'saw' | 'isaw' | 'tri' | 'square'
          | 'perlin' | 'berlin' | 'time'
          | 'rand' | 'rand2' | 'brand'
          | 'sine2' | 'cosine2' | 'saw2' | 'isaw2' | 'tri2' | 'square2'
          | 'mousex' | 'mousey'
          // #953 — Strudel exports BOTH spellings of the mouse signals; we had
          // only the lowercase pair, so `mouseX` opaqued.
          | 'mouseX' | 'mouseY'
          | 'itri' | 'itri2'
          | 'cyclesPer' | 'per' | 'perCycle' | 'perx'
      args?: string                                // RAW source slice for arg-taking signals — round-trip byte-fidelity; absent for 0-arity signals
      loc?: SourceLocation[]; userMethod?: string; unresolvedChain?: string; chainOffset?: number }
  | { tag: 'Builder'
      // #953 — each kind below (except the two Wave-C entries noted) is a
      // signal.mjs export that is root-capable (`fn(1) instanceof Pattern`) AND
      // absent from `Pattern.prototype`. That second condition is load-bearing:
      // `choose`, `degrade`, `keyDown` and `undegrade` are ALSO root-capable but
      // are chain METHODS, and admitting them as roots would be a new bug. The
      // export list over-approximates; the prototype check is the filter.
      kind: 'run' | 'irand' | 'binary' | 'binaryN' | 'binaryL' | 'binaryNL'
          | 'brandBy' | 'chooseCycles' | 'chooseIn' | 'chooseOut'
          | 'randL' | 'randcat' | 'randrun' | 'signal' | 'steady'
          | 'chord' | 'arrange'                  // 20-18 Wave C — `chord`/`arrange` GROUNDED at @strudel/core@1.2.6 controls.mjs:2130 + pattern.mjs:1469-1473 (ref/GROUND_TRUTH_SIGNAL_MJS.md §2/§3). args-RAW-only; `body` ABSENT (OPAQUE sublanguage / JS-tuple-array; recursion outside matcher competence — never inferred).
      args: string                                 // RAW (untrimmed) arg slice — code-invariance (the Code.via.args convention)
      body?: PatternIR                             // OPTIONAL — only for builders whose arg is a recursable pattern (no current kind populates this — `chord`/`arrange` are grounded args-RAW-only per Ground Truth §5)
      loc?: SourceLocation[]; userMethod?: string; unresolvedChain?: string; chainOffset?: number }
  // Phase 5a (#386) — UNIFIED TIME-SEQUENCE node: the structured form of the
  // `arrange`/`cat`/`slowcat` combinators (the timeline-clip family). GROUNDED
  // 2026-06-17 against real haps (@strudel/core@1.2.6 pattern.mjs:1469-1473):
  //   `arrange([n, pat], …)` — arm i spans `n` WHOLE cycles at the pattern's
  //      natural rate (internal cycle advances across the span); period = Σn.
  //   `cat`/`slowcat`(p, …) — each arm spans 1 cycle; period = N. PROVEN
  //      EQUAL to `arrange` with all weights 1 (locked decision 2026-06-16).
  // `fastcat` is DELIBERATELY EXCLUDED — it is one-cycle weight-slicing, which
  // IS the existing `Seq` node (fastcat ≡ Seq, grounded); the parser routes
  // fastcat → Seq, not here. The opaque `Builder{kind:'arrange'}` above stays
  // a valid hand-built/round-trip shape (byte-unchanged); the PARSER now emits
  // this structured node for real `arrange(…)` source instead.
  // `mode` preserves the literal combinator the user wrote (write-back
  // fidelity for P5b/c). Each arm carries its OWN source `loc` (the `[n, pat]`
  // tuple range for arrange; the pattern-expression range for cat) — mandatory
  // so the reserved `arrange.weights`/`arrange.structure` write-back sources
  // can target individual arms. Distinct from `Cycle` (mini-notation `<a b>`
  // alternation — CONTENT layer, inside one pattern) per design §3 layering.
  | { tag: 'Arrange'
      mode: 'arrange' | 'cat' | 'slowcat'          // literal combinator name (round-trip fidelity)
      arms: ArrangeArm[]                           // ordered clips; ≥1
      loc?: SourceLocation[]; userMethod?: string; unresolvedChain?: string; chainOffset?: number }

/**
 * Optional metadata accepted by every non-rest-spread smart constructor
 * below. The smart constructor mirrors `IR.play`'s convention — only sets
 * each field when truthy, so test fixtures that build nodes without
 * metadata and assert via `toEqual({ tag: 'Fast', factor: 2, body: ... })`
 * keep working unchanged. CONTEXT D-07.
 *
 * Rest-spread constructors (`seq`, `stack`, `cycle`) CANNOT take a trailing
 * positional `meta?` parameter (TypeScript rejects positional-after-rest);
 * desugar / root sites that need metadata on those tags use literal
 * construction `{ tag: 'Stack', tracks, loc, userMethod }` directly.
 * RESEARCH §2 / §11 Q1.
 */
type TagMeta = { loc?: SourceLocation[]; userMethod?: string }

function attachMeta<T extends object>(node: T, meta?: TagMeta): T {
  if (meta?.loc && meta.loc.length > 0) (node as { loc?: SourceLocation[] }).loc = meta.loc
  if (meta?.userMethod) (node as { userMethod?: string }).userMethod = meta.userMethod
  return node
}

/** Smart constructors — reduce boilerplate when building trees by hand. */
export const IR = {
  pure: (meta?: TagMeta): PatternIR => attachMeta({ tag: 'Pure' }, meta),
  play: (
    note: string | number,
    duration = 0.25,
    params: Partial<PlayParams> = {},
    loc?: SourceLocation[],
  ): PatternIR => {
    const node: PatternIR = {
      tag: 'Play',
      note,
      duration,
      params: { gain: 1, velocity: 1, ...params },
    }
    if (loc && loc.length > 0) (node as { loc?: SourceLocation[] }).loc = loc
    return node
  },
  sleep: (duration: number, meta?: TagMeta): PatternIR =>
    attachMeta({ tag: 'Sleep', duration }, meta),
  // Rest-spread: cannot accept trailing meta?. Desugar / root sites that need
  // metadata use literal construction `{ tag: 'Seq', children, loc, userMethod }`.
  seq: (...children: PatternIR[]): PatternIR => ({ tag: 'Seq', children }),
  // Rest-spread: cannot accept trailing meta?. Desugar / root sites that need
  // metadata use literal construction `{ tag: 'Stack', tracks, loc, userMethod }`.
  stack: (...tracks: PatternIR[]): PatternIR => ({ tag: 'Stack', tracks }),
  choice: (p: number, then: PatternIR, else_: PatternIR = { tag: 'Pure' }, meta?: TagMeta): PatternIR =>
    attachMeta({ tag: 'Choice', p, then, else_ }, meta),
  every: (n: number, body: PatternIR, default_?: PatternIR, meta?: TagMeta): PatternIR =>
    attachMeta({ tag: 'Every', n, body, default_ }, meta),
  // Rest-spread: cannot accept trailing meta?. Sites needing metadata use
  // literal construction `{ tag: 'Cycle', items, loc, userMethod }`.
  cycle: (...items: PatternIR[]): PatternIR => ({ tag: 'Cycle', items }),
  when: (gate: string, body: PatternIR, meta?: TagMeta): PatternIR =>
    attachMeta({ tag: 'When', gate, body }, meta),
  param: (
    key: string,
    value: string | number | PatternIR,
    rawArgs: string,
    body: PatternIR,
    meta?: TagMeta,
  ): PatternIR =>
    attachMeta({ tag: 'Param', key, value, rawArgs, body }, meta),
  track: (
    trackId: string,
    body: PatternIR,
    meta?: TagMeta,
    /** `_$:` / `_name:` — see the `muted` field on the Track node (#1488).
     *  Spread in only when true, so an unmuted track is byte-identical to
     *  what this builder produced before the field existed. */
    muted?: boolean,
  ): PatternIR =>
    attachMeta({ tag: 'Track', trackId, body, ...(muted === true ? { muted: true } : {}) }, meta),
  ramp: (param: string, from: number, to: number, cycles: number, body: PatternIR, meta?: TagMeta): PatternIR =>
    attachMeta({ tag: 'Ramp', param, from, to, cycles, body }, meta),
  fast: (factor: number, body: PatternIR, meta?: TagMeta): PatternIR =>
    attachMeta({ tag: 'Fast', factor, body }, meta),
  slow: (factor: number, body: PatternIR, meta?: TagMeta): PatternIR =>
    attachMeta({ tag: 'Slow', factor, body }, meta),
  range: (lo: number, hi: number, rawArgs: string, body: PatternIR, meta?: TagMeta): PatternIR =>
    attachMeta({ tag: 'Range', lo, hi, rawArgs, body }, meta),
  elongate: (factor: number, body: PatternIR, meta?: TagMeta): PatternIR =>
    attachMeta({ tag: 'Elongate', factor, body }, meta),
  late: (offset: number, body: PatternIR, meta?: TagMeta): PatternIR =>
    attachMeta({ tag: 'Late', offset, body }, meta),
  degrade: (p: number, body: PatternIR, meta?: TagMeta): PatternIR =>
    attachMeta({ tag: 'Degrade', p, body }, meta),
  chunk: (n: number, transform: PatternIR, body: PatternIR, meta?: TagMeta): PatternIR =>
    attachMeta({ tag: 'Chunk', n, transform, body }, meta),
  ply: (n: number, body: PatternIR, meta?: TagMeta): PatternIR =>
    attachMeta({ tag: 'Ply', n, body }, meta),
  pick: (selector: PatternIR, lookup: PatternIR[], meta?: TagMeta): PatternIR =>
    attachMeta({ tag: 'Pick', selector, lookup }, meta),
  namedPick: (selector: PatternIR, entries: NamedPickEntry[], method: string, rawArgs: string, meta?: TagMeta): PatternIR =>
    attachMeta({ tag: 'NamedPick', selector, entries, method, rawArgs }, meta),
  struct: (mask: string, body: PatternIR, meta?: TagMeta): PatternIR =>
    attachMeta({ tag: 'Struct', mask, body }, meta),
  swing: (n: number, body: PatternIR, meta?: TagMeta): PatternIR =>
    attachMeta({ tag: 'Swing', n, body }, meta),
  shuffle: (n: number, body: PatternIR, meta?: TagMeta): PatternIR =>
    attachMeta({ tag: 'Shuffle', n, body }, meta),
  scramble: (n: number, body: PatternIR, meta?: TagMeta): PatternIR =>
    attachMeta({ tag: 'Scramble', n, body }, meta),
  chop: (n: number, body: PatternIR, meta?: TagMeta): PatternIR =>
    attachMeta({ tag: 'Chop', n, body }, meta),
  slice: (
    n: number | readonly number[],
    index: string | PatternIR,
    body: PatternIR,
    meta?: TagMeta,
  ): PatternIR => attachMeta({ tag: 'Slice', n, index, body }, meta),
  loop: (body: PatternIR, meta?: TagMeta): PatternIR =>
    attachMeta({ tag: 'Loop', body }, meta),
  // Phase 5a (#386) — unified time-sequence constructor. `mode` is the literal
  // combinator name; `cat`/`slowcat` callers pass arms with weight 1.
  arrange: (
    mode: 'arrange' | 'cat' | 'slowcat',
    arms: ArrangeArm[],
    meta?: TagMeta,
  ): PatternIR => attachMeta({ tag: 'Arrange', mode, arms }, meta),
  code: (code: string, meta?: TagMeta): PatternIR =>
    attachMeta({ tag: 'Code', code, lang: 'strudel' }, meta),
  // Phase 20-18 Wave A — signal/builder chain-ROOT smart constructors.
  // Mirror the `attachMeta` convention: only set each field when truthy
  // (the existing smart-constructor invariant — test fixtures that build
  // bare `{ tag: 'Signal', kind }` and assert via `toEqual` keep working).
  signal: (
    kind: (PatternIR & { tag: 'Signal' })['kind'],
    args?: string,
    meta?: TagMeta,
  ): PatternIR => {
    const node: PatternIR = { tag: 'Signal', kind }
    if (args) (node as { args?: string }).args = args
    return attachMeta(node, meta)
  },
  builder: (
    kind: (PatternIR & { tag: 'Builder' })['kind'],
    args: string,
    body?: PatternIR,
    meta?: TagMeta,
  ): PatternIR => {
    const node: PatternIR = { tag: 'Builder', kind, args }
    if (body) (node as { body?: PatternIR }).body = body
    return attachMeta(node, meta)
  },
} as const
