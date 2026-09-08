import * as p5 from 'p5';
import { RefObject } from 'react';

/**
 * IREvent — the universal music event.
 *
 * Every engine compiles to this. Every consumer (viz, synth, highlighting) reads from this.
 * The IR event is a flat value object — no methods, no prototype, no engine references.
 *
 * Time domain: matches the producing PatternScheduler's now().
 *   - Strudel: cycle positions (0.0, 0.25, 1.0...)
 *   - BufferedScheduler: audioContext seconds (134.5, 135.0...)
 *   - Future engines: whatever their scheduler uses
 * Consumers always compare event.begin against scheduler.now() — same time domain.
 */
/** Source code location — character offset ranges in the original code. */
interface SourceLocation {
    start: number;
    end: number;
}
interface IREvent {
    /** Time position start (in scheduler's time domain) */
    begin: number;
    /** Time position end */
    end: number;
    /** Clipped end for active detection */
    endClipped: number;
    /** Note — MIDI number, note name string, or null */
    note: number | string | null;
    /** Frequency in Hz (derivable from note, pre-computed for performance) */
    freq: number | null;
    /** Instrument/sample name */
    s: string | null;
    /** Event kind */
    type?: 'synth' | 'sample';
    /** Gain 0-1 (default 1) */
    gain: number;
    /** Velocity 0-1 (default 1) */
    velocity: number;
    /** Display color */
    color: string | null;
    /** Source code ranges for highlighting */
    loc?: SourceLocation[];
    /** Stable content-addressed id of the IR node that produced this event.
     *  REQUIRED-by-convention for collect-produced events at the leaf arm
     *  (PV38 clause 1; assigned by collect.ts:assignNodeId at the Play leaf).
     *  Absent for hap-derived events with no IR-side match
     *  (PV37-aligned runtime-only path). */
    irNodeId?: string;
    /** Which track/loop produced this event. For events from a `$:`-wrapped
     *  Track that also has a `.p("name")` inner wrap, this is the INNER
     *  (`.p()`) name per collect.ts inner-wins semantics — what the user
     *  sees as the row label. Use `dollarPos` (below) when you need the
     *  STABLE slot identity that doesn't change when the user renames
     *  via `.p()`. */
    trackId?: string;
    /** Source-character offset of the OUTERMOST `$:`-wrapped Track that
     *  encloses this event. Anchored at the Track's `loc[0].start` per
     *  parseStrudel. Used as the timeline slot identity so `.p("name")`
     *  rename-in-place doesn't relocate the row (the OUTER Track's loc
     *  doesn't move when its body is restructured). Absent when no
     *  enclosing Track has a `loc` (hand-built IR fixtures, runtime-only
     *  events). Phase 20-12.1 follow-up. */
    dollarPos?: number;
    /** Index of the leaf voice (within its enclosing Track) that produced
     *  this event. Set by collect.ts when walking a voice-defining Stack
     *  (`userMethod ∈ {undefined, 'stack'}`). Sequential across nested
     *  voice-defining Stacks — nested Stack arms continue the parent's
     *  leaf counter (mirrors flattenLeafVoices' source-order traversal in
     *  irProjection.ts). Absent when the Track body is a single voice
     *  (no voice-defining Stack), or for hand-built IR that doesn't go
     *  through Track/Stack collect arms — chrome treats absence as "all
     *  events on leaf 0". Phase 20-12 sub-row partition support. */
    leafIndex?: number;
    /** Index of the time-sequence ARM (clip) that produced this event, within
     *  the OUTERMOST `Arrange` node (`arrange`/`cat`/`slowcat` combinator) of its
     *  track. Set by collect.ts's Arrange arm — mirrors `leafIndex`, but
     *  partitions a track HORIZONTALLY (which clip along the timeline) rather than
     *  vertically (which voice). For a NESTED combinator (an arm whose pattern is
     *  itself a combinator) the OUTER index wins — the inner combinator does NOT
     *  overwrite it (#451) — so the whole nested block reads as one outer clip and
     *  the song timeline binds the outer combinator. Absent for tracks with no
     *  arrangement combinator — the timeline treats a bare track as one implicit
     *  clip (design §5 option b). Together with the lane key it identifies a clip.
     *  Phase 5a (#386). */
    armIndex?: number;
    /** Engine-specific extended parameters */
    params?: Record<string, unknown>;
}

/**
 * IRPattern — the universal queryable music pattern.
 *
 * Any engine that can answer "what happens between time A and time B?"
 * implements this interface. Viz renderers, the DAW timeline, and
 * transforms all consume IRPattern.
 *
 * Time domain matches the producing engine's scheduler — consumers
 * compare query results against now() in the same domain.
 */

interface IRPattern {
    /** Current time position in the pattern's time domain. */
    now(): number;
    /** Query events overlapping the time range [begin, end). */
    query(begin: number, end: number): IREvent[];
}

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

/** One arm of an `Arrange` time-sequence node = one timeline clip. Phase 5a. */
interface ArrangeArm {
    /** Cycle weight — how many WHOLE cycles this arm spans (the `n` in
     *  `arrange([n, pat])`). `1` for every `cat`/`slowcat` arm. The arm occupies
     *  the cycle range `[Σweight_before, Σweight_before + weight)`; the whole
     *  node's period is `Σ weight`. */
    weight: number;
    /** The arm's pattern sub-IR. Plays at its natural rate within the arm's span
     *  (its internal cycle advances across the span — grounded). */
    pattern: PatternIR;
    /** Source range. For `arrange` arms this is the `[n, pat]` TUPLE range (so
     *  write-back can edit the weight `n`); for `cat`/`slowcat` arms it is the
     *  pattern-expression range. Optional only for hand-built fixtures. */
    loc?: SourceLocation[];
}
/** One named arm of a `NamedPick` (object-form pick family). #463 Stage 1. */
interface NamedPickEntry {
    /** The lookup key — the bare/quoted object key, normalized to its string
     *  form. The selector's per-cycle STRING value (`ev.note`) matches this. */
    key: string;
    /** The section's sub-IR (the object value expression, e.g. `s("bd sd")`). */
    pattern: PatternIR;
    /** Source range of the key token (`verse` in `{verse: …}`) — lets a clip
     *  gesture bind the section's content back to its definition site. */
    keyLoc?: SourceLocation;
}
interface PlayParams {
    s?: string;
    gain?: number;
    velocity?: number;
    sustain?: number;
    release?: number;
    pan?: number;
    color?: string;
    [key: string]: unknown;
}
type PatternIR = {
    tag: 'Pure';
    loc?: SourceLocation[];
    userMethod?: string;
    unresolvedChain?: string;
    chainOffset?: number;
} | {
    tag: 'Seq';
    children: PatternIR[];
    loc?: SourceLocation[];
    userMethod?: string;
    unresolvedChain?: string;
    chainOffset?: number;
} | {
    tag: 'Stack';
    tracks: PatternIR[];
    loc?: SourceLocation[];
    userMethod?: string;
    unresolvedChain?: string;
    chainOffset?: number;
} | {
    tag: 'Play';
    note: string | number;
    duration: number;
    params: PlayParams;
    loc?: SourceLocation[];
    unresolvedChain?: string;
    chainOffset?: number;
} | {
    tag: 'Sleep';
    duration: number;
    loc?: SourceLocation[];
    userMethod?: string;
} | {
    tag: 'Choice';
    p: number;
    then: PatternIR;
    else_: PatternIR;
    loc?: SourceLocation[];
    userMethod?: string;
} | {
    tag: 'Every';
    n: number;
    body: PatternIR;
    default_?: PatternIR;
    loc?: SourceLocation[];
    userMethod?: string;
} | {
    tag: 'Cycle';
    items: PatternIR[];
    loc?: SourceLocation[];
    userMethod?: string;
    unresolvedChain?: string;
    chainOffset?: number;
} | {
    tag: 'When';
    gate: string;
    body: PatternIR;
    loc?: SourceLocation[];
    userMethod?: string;
} | {
    tag: 'Ramp';
    param: string;
    from: number;
    to: number;
    cycles: number;
    body: PatternIR;
    loc?: SourceLocation[];
    userMethod?: string;
} | {
    tag: 'Fast';
    factor: number;
    body: PatternIR;
    loc?: SourceLocation[];
    userMethod?: string;
} | {
    tag: 'Slow';
    factor: number;
    body: PatternIR;
    loc?: SourceLocation[];
    userMethod?: string;
} | {
    tag: 'Range';
    lo: number;
    hi: number;
    rawArgs: string;
    body: PatternIR;
    loc?: SourceLocation[];
    userMethod?: string;
} | {
    tag: 'Elongate';
    factor: number;
    body: PatternIR;
    loc?: SourceLocation[];
    userMethod?: string;
} | {
    tag: 'Late';
    offset: number;
    body: PatternIR;
    loc?: SourceLocation[];
    userMethod?: string;
} | {
    tag: 'Degrade';
    p: number;
    body: PatternIR;
    loc?: SourceLocation[];
    userMethod?: string;
} | {
    tag: 'Chunk';
    n: number;
    transform: PatternIR;
    body: PatternIR;
    loc?: SourceLocation[];
    userMethod?: string;
} | {
    tag: 'Ply';
    n: number;
    body: PatternIR;
    loc?: SourceLocation[];
    userMethod?: string;
} | {
    tag: 'Pick';
    selector: PatternIR;
    lookup: PatternIR[];
    loc?: SourceLocation[];
    userMethod?: string;
} | {
    tag: 'NamedPick';
    selector: PatternIR;
    entries: NamedPickEntry[];
    method: string;
    rawArgs: string;
    loc?: SourceLocation[];
    userMethod?: string;
} | {
    tag: 'Struct';
    mask: string;
    body: PatternIR;
    loc?: SourceLocation[];
    userMethod?: string;
} | {
    tag: 'Swing';
    n: number;
    body: PatternIR;
    loc?: SourceLocation[];
    userMethod?: string;
} | {
    tag: 'Shuffle';
    n: number;
    body: PatternIR;
    loc?: SourceLocation[];
    userMethod?: string;
} | {
    tag: 'Scramble';
    n: number;
    body: PatternIR;
    loc?: SourceLocation[];
    userMethod?: string;
} | {
    tag: 'Chop';
    n: number;
    body: PatternIR;
    loc?: SourceLocation[];
    userMethod?: string;
} | {
    tag: 'Slice';
    n: number | readonly number[];
    index: string | PatternIR;
    body: PatternIR;
    loc?: SourceLocation[];
    userMethod?: string;
} | {
    tag: 'Param';
    key: string;
    value: string | number | PatternIR;
    rawArgs: string;
    body: PatternIR;
    loc?: SourceLocation[];
    userMethod?: string;
} | {
    tag: 'Track';
    trackId: string;
    body: PatternIR;
    loc?: SourceLocation[];
    userMethod?: string;
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
    muted?: boolean;
} | {
    tag: 'Loop';
    body: PatternIR;
    loc?: SourceLocation[];
    userMethod?: string;
} | {
    tag: 'Code';
    code: string;
    lang: 'strudel';
    loc?: SourceLocation[];
    userMethod?: string;
    unresolvedChain?: string;
    chainOffset?: number;
    via?: {
        method: string;
        args: string;
        callSiteRange: [number, number];
        inner: PatternIR;
    } | {
        literal: true;
        raw: string;
    };
} | {
    tag: 'Signal';
    kind: 'sine' | 'cosine' | 'saw' | 'isaw' | 'tri' | 'square' | 'perlin' | 'berlin' | 'time' | 'rand' | 'rand2' | 'brand' | 'sine2' | 'cosine2' | 'saw2' | 'isaw2' | 'tri2' | 'square2' | 'mousex' | 'mousey' | 'mouseX' | 'mouseY' | 'itri' | 'itri2' | 'cyclesPer' | 'per' | 'perCycle' | 'perx';
    args?: string;
    loc?: SourceLocation[];
    userMethod?: string;
    unresolvedChain?: string;
    chainOffset?: number;
} | {
    tag: 'Builder';
    kind: 'run' | 'irand' | 'binary' | 'binaryN' | 'binaryL' | 'binaryNL' | 'brandBy' | 'chooseCycles' | 'chooseIn' | 'chooseOut' | 'randL' | 'randcat' | 'randrun' | 'signal' | 'steady' | 'chord' | 'arrange';
    args: string;
    body?: PatternIR;
    loc?: SourceLocation[];
    userMethod?: string;
    unresolvedChain?: string;
    chainOffset?: number;
} | {
    tag: 'Arrange';
    mode: 'arrange' | 'cat' | 'slowcat';
    arms: ArrangeArm[];
    loc?: SourceLocation[];
    userMethod?: string;
    unresolvedChain?: string;
    chainOffset?: number;
};
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
type TagMeta = {
    loc?: SourceLocation[];
    userMethod?: string;
};
/** Smart constructors — reduce boilerplate when building trees by hand. */
declare const IR: {
    readonly pure: (meta?: TagMeta) => PatternIR;
    readonly play: (note: string | number, duration?: number, params?: Partial<PlayParams>, loc?: SourceLocation[]) => PatternIR;
    readonly sleep: (duration: number, meta?: TagMeta) => PatternIR;
    readonly seq: (...children: PatternIR[]) => PatternIR;
    readonly stack: (...tracks: PatternIR[]) => PatternIR;
    readonly choice: (p: number, then: PatternIR, else_?: PatternIR, meta?: TagMeta) => PatternIR;
    readonly every: (n: number, body: PatternIR, default_?: PatternIR, meta?: TagMeta) => PatternIR;
    readonly cycle: (...items: PatternIR[]) => PatternIR;
    readonly when: (gate: string, body: PatternIR, meta?: TagMeta) => PatternIR;
    readonly param: (key: string, value: string | number | PatternIR, rawArgs: string, body: PatternIR, meta?: TagMeta) => PatternIR;
    readonly track: (trackId: string, body: PatternIR, meta?: TagMeta, muted?: boolean) => PatternIR;
    readonly ramp: (param: string, from: number, to: number, cycles: number, body: PatternIR, meta?: TagMeta) => PatternIR;
    readonly fast: (factor: number, body: PatternIR, meta?: TagMeta) => PatternIR;
    readonly slow: (factor: number, body: PatternIR, meta?: TagMeta) => PatternIR;
    readonly range: (lo: number, hi: number, rawArgs: string, body: PatternIR, meta?: TagMeta) => PatternIR;
    readonly elongate: (factor: number, body: PatternIR, meta?: TagMeta) => PatternIR;
    readonly late: (offset: number, body: PatternIR, meta?: TagMeta) => PatternIR;
    readonly degrade: (p: number, body: PatternIR, meta?: TagMeta) => PatternIR;
    readonly chunk: (n: number, transform: PatternIR, body: PatternIR, meta?: TagMeta) => PatternIR;
    readonly ply: (n: number, body: PatternIR, meta?: TagMeta) => PatternIR;
    readonly pick: (selector: PatternIR, lookup: PatternIR[], meta?: TagMeta) => PatternIR;
    readonly namedPick: (selector: PatternIR, entries: NamedPickEntry[], method: string, rawArgs: string, meta?: TagMeta) => PatternIR;
    readonly struct: (mask: string, body: PatternIR, meta?: TagMeta) => PatternIR;
    readonly swing: (n: number, body: PatternIR, meta?: TagMeta) => PatternIR;
    readonly shuffle: (n: number, body: PatternIR, meta?: TagMeta) => PatternIR;
    readonly scramble: (n: number, body: PatternIR, meta?: TagMeta) => PatternIR;
    readonly chop: (n: number, body: PatternIR, meta?: TagMeta) => PatternIR;
    readonly slice: (n: number | readonly number[], index: string | PatternIR, body: PatternIR, meta?: TagMeta) => PatternIR;
    readonly loop: (body: PatternIR, meta?: TagMeta) => PatternIR;
    readonly arrange: (mode: "arrange" | "cat" | "slowcat", arms: ArrangeArm[], meta?: TagMeta) => PatternIR;
    readonly code: (code: string, meta?: TagMeta) => PatternIR;
    readonly signal: (kind: (PatternIR & {
        tag: "Signal";
    })["kind"], args?: string, meta?: TagMeta) => PatternIR;
    readonly builder: (kind: (PatternIR & {
        tag: "Builder";
    })["kind"], args: string, body?: PatternIR, meta?: TagMeta) => PatternIR;
};

interface HapEvent {
    /** Full Strudel Hap object (optional for non-Strudel engines) */
    hap?: any;
    /** AudioContext.currentTime when note fires */
    audioTime: number;
    /** Duration in AudioContext seconds */
    audioDuration: number;
    /** Lookahead offset in ms (use for display timing delays) */
    scheduledAheadMs: number;
    /** Computed MIDI note number (null for unpitched percussion) */
    midiNote: number | null;
    /** Instrument/sample name from hap.value.s */
    s: string | null;
    /** From .color() in pattern */
    color: string | null;
    /** Source character ranges in the original code string */
    loc: Array<{
        start: number;
        end: number;
    }> | null;
    /**
     * Set when the hap's structural loc matches an IR-published node
     * (PV38 clause 2). Absent for runtime-only haps — same semantics as
     * IREvent.irNodeId. Populated by HapStream.emit when a lookup is
     * supplied (Phase 20-06).
     */
    irNodeId?: string;
    /**
     * Monotonic evaluate() generation this hap belongs to (#339). Stamped by
     * `emit` from the engine-supplied epoch (see {@link HapStream.setEpoch}).
     * `loc` offsets are only valid against the text of THIS epoch's eval —
     * consumers (useHighlighting) use the change to know when the loc
     * coordinate system reset and stale position anchors must be rebuilt.
     * Absent for engines that don't track eval generations.
     */
    epoch?: number;
}
type HapHandler = (event: HapEvent) => void;
/**
 * Lightweight event bus fed by StrudelEngine's scheduler onTrigger.
 * All visualizers and the highlight system subscribe here.
 */
declare class HapStream {
    private handlers;
    private epoch;
    on(handler: HapHandler): void;
    off(handler: HapHandler): void;
    /**
     * Set the evaluate() generation stamped onto subsequently-emitted events
     * (#339). Called by the engine at the start of each `evaluate()`.
     */
    setEpoch(epoch: number): void;
    /**
     * Called by the engine scheduler for each scheduled Hap.
     * Enriches the raw data and fans it out to all subscribers.
     *
     * Parameters match Strudel's onTrigger signature:
     *   (hap, deadline, duration, cps, t)
     *
     * Optional 6th positional `lookup` (Phase 20-06) — when supplied AND the
     * hap carries a structural loc, the published IR-side match is resolved
     * via `findMatchedEvent` and the matched event's `irNodeId` is populated
     * onto the fan-out HapEvent. PV38 clause 2 onTrigger half. Single-
     * strategy match (P50) — same helper as the queryArc-side enrichment in
     * `normalizeStrudelHap`.
     *
     * Phase 20-07 (T-α-2) — returns the enriched HapEvent so the engine's
     * wrappedOutput hit-check can read `event.irNodeId` in O(1) without
     * re-running findMatchedEvent (P50 — single-strategy match preserved).
     * Additive: 8 existing test callers + 1 production caller currently
     * ignore the void return; widening void → HapEvent does not break them.
     */
    emit(hap: any, deadline: number, duration: number, cps: number, audioCtxCurrentTime: number, lookup?: ReadonlyMap<string, IREvent[]>): HapEvent;
    /**
     * Emit a pre-constructed HapEvent directly.
     * Preferred API for non-Strudel engines that don't have raw hap objects.
     */
    emitEvent(event: HapEvent): void;
    dispose(): void;
}

/**
 * p5 viz compiler — pure compilation logic with no renderer dependencies.
 *
 * Kept separate from `vizCompiler.ts` so that tests and tooling can
 * import the compile functions without pulling the full p5 /
 * gifenc / renderer stack through the module graph. (The same
 * isolation trick used by `namedVizBridge.ts` vs. `vizPresetBridge.ts`.)
 *
 * The descriptor wiring layer lives in `vizCompiler.ts` and calls
 * into here for the actual source-to-factory conversion.
 */

/** A per-sound or per-track reading as live NUMBERS (p5 D-01 shape — getters,
 *  NOT thunks; the renderer reads them directly inside `draw`). DSP scalars
 *  (`rms`/`bass`/`mid`/`treble`) are live numbers; DSP arrays (`fft`/`wave`)
 *  are live `number[]` indexed directly (`sig('bd').fft[i]`). All read fresh per
 *  access — the reading object is produced by a getter through `with`. */
interface P5SignalReading {
    env: number;
    velocity: number;
    note: number | string | null;
    color: string | null;
    /** Time-domain RMS, 0..1. */
    rms: number;
    /** Low-band magnitude, 0..1. */
    bass: number;
    /** Mid-band magnitude, 0..1. */
    mid: number;
    /** High-band magnitude, 0..1. */
    treble: number;
    /** Normalized magnitude spectrum, `number[]`. */
    fft: number[];
    /** Time-domain waveform -1..1, `number[]`. */
    wave: number[];
}
/** The single `sig` namespace (#351) — a callable carrying every Stave-injected
 *  viz signal. p5 shape (D-01): `sig('bd').env` is a NUMBER (live each read), not
 *  a thunk; the per-drum scalars (`sig.kick`…) and master DSP (`sig.rms`/`sig.fft`)
 *  are live getters on the SAME object. */
interface SigAccessor {
    (sound: string): P5SignalReading;
    /** Per-track reading, keyed on the scheduler key space (`$0`/`drums`). */
    track: (id: string) => P5SignalReading;
    /** Enumerate published track keys (scheduler key space). */
    tracks: string[];
    /** Enumerate distinct sounds seen through the envelope feed. */
    sounds: string[];
    kick: number;
    snare: number;
    hat: number;
    openHat: number;
    clap: number;
    rim: number;
    tom: number;
    /** Loudest active hit 0..1, global (was `uKeyVelocity`). */
    keyVelocity: number;
    /** Master-mix time-domain RMS, 0..1 (live getter). */
    rms: number;
    /** Master-mix low-band magnitude, 0..1 (live getter). */
    bass: number;
    /** Master-mix mid-band magnitude, 0..1 (live getter). */
    mid: number;
    /** Master-mix high-band magnitude, 0..1 (live getter). */
    treble: number;
    /** Live master-mix magnitude spectrum, `number[]`. */
    fft: number[];
    /** Live master-mix waveform -1..1, `number[]`. */
    wave: number[];
    /**
     * Quality / level-of-detail multiplier in `(0, 1]`, live (#269). `1` = full
     * detail (default); "performance mode" lowers it. A CPU-tessellation-bound
     * sketch (line meshes — the class a resolution drop does NOT help, #232)
     * should scale its segment / history COUNT by this, e.g.
     * `Math.max(2, Math.round(BASE_SEGMENTS * sig.density))`. Fill/fragment-bound
     * sketches gain nothing here and instead ride the render-resolution knob the
     * renderer applies composite-side. Reads `vizConfig.density` fresh each access
     * (worker: its marshalled singleton — the config-marshal channel feeds it). */
    density: number;
}
/**
 * Phase 21 / #351 — the live signal object handed to a p5 sketch as the THIRD
 * `new Function` arg. It exposes the single `sig` namespace (mirrored onto
 * `stave.sig`, D-02), resolved bare per-frame through the inner
 * `with (staveUniforms)`. The per-drum scalars / master DSP are getters ON `sig`
 * itself (`sig.kick`, `sig.fft`) — p5 D-01: live numbers, NOT thunks.
 *
 * `__tick` is a NON-enumerable hook the draw wrapper calls ONCE per frame
 * (`bus.tick(); bus.refreshActive(bus.now())`) — the decay tick fires exactly
 * once per draw (U2), NEVER inside a getter (a getter-tick double-ticks when a
 * sketch reads N signals → decay collapses to 0). Built by `P5VizRenderer`,
 * which owns the (pure) SignalBus; the compiler stays renderer-agnostic and
 * only consumes the shape.
 */
interface StaveUniforms {
    readonly sig: SigAccessor;
    /** Per-frame tick hook (non-enumerable). Optional so a sketch compiled
     *  without a bus (tests, demo mode) still runs — the wrapper null-checks. */
    __tick?: () => void;
    /**
     * Custom alias getters (Phase 21 aliases). A user-defined alias (e.g.
     * `kick → bd`) is injected at mount by `P5VizRenderer` as a live getter
     * (`Object.defineProperty(uniforms, name, { get: () => bus.envValue(name) })`)
     * for every merged-map name NOT already a built-in signal. The index
     * signature lets `uniforms[name]` typecheck under strict TS; reads resolve
     * per-frame through the inner `with (staveUniforms)` (full-lifecycle) and the
     * legacy `with (staveUniforms)` wrap (legacy draw-body). `__tick` is read via
     * the optional field above, never via this index (it's non-enumerable). */
    [customAlias: string]: any;
}

/** Real-time hap event stream for visualizers and highlighting. */
interface StreamingComponent {
    hapStream: HapStream;
}
/** Pattern query access -- scheduler for the combined pattern, per-track schedulers. */
interface QueryableComponent {
    scheduler: PatternScheduler | null;
    trackSchedulers: Map<string, PatternScheduler>;
}
/** Web Audio nodes for analysis-based visualizers (scope, spectrum). */
interface AudioComponent {
    analyser: AnalyserNode;
    audioCtx: AudioContext;
    /** Per-track AnalyserNodes for isolated inline viz. Keyed by track ID (e.g. "drums", "$0"). */
    trackAnalysers?: Map<string, AnalyserNode>;
}
/**
 * Free-form per-render viz options bag, sourced from a Strudel viz call's
 * argument — e.g. `.pianoroll({ labels: 1, vertical: 1 })`. Flows engine →
 * component bag → renderer → `stave.options` so sketches can honour the
 * official `@strudel/draw` option vocabulary. Structurally a
 * `VizOptions` (visualizers/types) — kept as a local record alias here to
 * avoid an engine→visualizers import cycle.
 */
type VizOptionsBag = Record<string, unknown>;
/** Per-track inline visualization requests with line placement info. */
interface InlineVizComponent {
    /**
     * Maps track ID (e.g. "$0", "d1") to viz placement info.
     * - vizId: descriptor ID (e.g. "pianoroll", "scope")
     * - afterLine: 1-indexed line number after which to place the view zone
     * - options: the viz call's argument (e.g. `{ labels: 1 }`), if any
     */
    vizRequests: Map<string, {
        vizId: string;
        afterLine: number;
        options?: VizOptionsBag;
    }>;
    /**
     * Optional per-track HapStreams for scoped inline viz.
     * When present, each inline zone subscribes to its track's stream only.
     * When absent, falls back to the global streaming component.
     */
    trackStreams?: Map<string, HapStream>;
    /**
     * Backdrop viz requested via a non-underscore Strudel viz method
     * (e.g. `.scope()`, `.pianoroll()`) during the last evaluate. The
     * non-underscore form is Strudel's "big"/fullscreen viz; Stave maps it
     * to the project backdrop. `vizId` is the resolved Stave renderer id
     * (e.g. "scope", "pianoroll"). Absent when no such method was called.
     */
    backdropRequest?: {
        vizId: string;
        options?: VizOptionsBag;
    };
}
/** Pattern IR derived from the last successful evaluate(). */
interface IRComponent {
    /** Algebraic structure of the pattern (free monad tree). */
    patternIR: PatternIR | null;
    /** Flattened event list derived from patternIR (for rendering). */
    irEvents: IREvent[];
}
/**
 * Component bag exposing engine capabilities.
 * Each slot is independently optional -- consumers MUST check existence before access.
 */
interface EngineComponents {
    streaming: StreamingComponent;
    queryable: QueryableComponent;
    audio: AudioComponent;
    inlineViz: InlineVizComponent;
    /** Pattern IR — present after successful evaluate() on engines that support parsing. */
    ir: IRComponent;
    /**
     * Per-render viz options for THIS zone's renderer — set by `viewZones` from
     * the inline request's `options` (or the backdrop request's), and read by
     * `P5VizRenderer` into `stave.options`. Per-zone, not a global engine slot.
     */
    options?: VizOptionsBag;
}
/**
 * Engine-agnostic interface for live-coding audio engines.
 *
 * Lifecycle contract: init() -> evaluate() -> play() -> stop() -> dispose()
 * - init() must complete before evaluate()
 * - evaluate() may be called multiple times (re-evaluation)
 * - play()/stop() toggle scheduling
 * - dispose() releases all resources
 *
 * The `components` getter returns a partial bag -- which slots are present
 * depends on the engine's state (e.g. audio only after init, queryable after evaluate).
 */
interface LiveCodingEngine {
    /** Initialize the engine (load modules, set up audio context). Must complete before evaluate(). */
    init(): Promise<void>;
    /** Evaluate user code. Returns error info if evaluation fails. */
    evaluate(code: string): Promise<{
        error?: Error;
    }>;
    /** Start the scheduler / begin playback. */
    play(): void;
    /** Stop the scheduler / pause playback. */
    stop(): void;
    /** Release all resources. Engine is unusable after this call. */
    dispose(): void;
    /** Current engine capabilities. Slots appear as data becomes available. */
    readonly components: Partial<EngineComponents>;
    /** Register a handler for runtime errors (fires during scheduling, not evaluation). */
    setRuntimeErrorHandler(handler: (err: Error) => void): void;
}

/**
 * PatternScheduler — backward-compatible alias for IRPattern.
 * New code should import IRPattern from '../ir' directly.
 */
type PatternScheduler = IRPattern;
/**
 * Bundled refs passed to every VizRenderer on mount.
 * @deprecated Use {@link EngineComponents} instead. VizRenderer.mount() now accepts
 * `Partial<EngineComponents>`. This type is retained for backward compatibility.
 */
interface VizRefs {
    hapStreamRef: RefObject<HapStream | null>;
    analyserRef: RefObject<AnalyserNode | null>;
    schedulerRef: RefObject<PatternScheduler | null>;
}
/** Renderer-agnostic visualization lifecycle. */
interface VizRenderer {
    mount(container: HTMLDivElement, components: Partial<EngineComponents>, size: {
        w: number;
        h: number;
    }, onError: (e: Error) => void): void;
    /** Refresh engine data refs (called each React render for live updates). */
    update(components: Partial<EngineComponents>): void;
    resize(w: number, h: number): void;
    pause(): void;
    resume(): void;
    destroy(): void;
}
/** A factory function returning a VizRenderer, or a VizRenderer instance directly. */
type VizRendererSource = (() => VizRenderer) | VizRenderer;
/**
 * Descriptor for a visualization mode in the VizPicker.
 *
 * `requires` lists the engine component slots this viz needs. Used by VizPicker
 * to disable unavailable visualizations. This is about engine data requirements,
 * NOT renderer capabilities (e.g. WebGL) — renderer caps are a separate concern.
 *
 * IDs follow the `"mode:renderer"` convention when multiple renderers offer the
 * same visual concept (e.g. `"pianoroll"` vs `"pianoroll:hydra"`). The bare
 * `"mode"` form is the default renderer for that concept.
 */
interface VizDescriptor {
    id: string;
    label: string;
    requires?: (keyof EngineComponents)[];
    /** Renderer technology name (e.g. 'p5', 'hydra', 'canvas2d'). Used for VizPicker grouping. */
    renderer?: string;
    /**
     * Intrinsic drawing-surface size (the aspect the sketch is authored for).
     * `viewZones` mounts the renderer at this size, so it sets the inline zone's
     * aspect ratio. Omitted → the generic `DEFAULT_NATIVE` (2:1). The pianoroll
     * sets a taller aspect so pitch lanes aren't squashed vs the time axis.
     */
    nativeSize?: {
        w: number;
        h: number;
    };
    factory: () => VizRenderer;
}
/**
 * Live container size handed to user sketches via `stave.width` /
 * `stave.height`. The ref is maintained by `P5VizRenderer` — its
 * `current` field is updated on mount (from the container's initial
 * clientRect) and on every `resize(w, h)` call. User sketches read
 * these values inside `setup()` so `createCanvas(stave.width,
 * stave.height)` always matches the preview pane, regardless of the
 * browser window size or p5's internal `windowWidth` / `windowHeight`
 * globals.
 */
interface ContainerSize {
    w: number;
    h: number;
}
/**
 * Free-form per-render options bag handed to a sketch via `stave.options`.
 * Populated from a Strudel viz call's argument, e.g. `.pianoroll({ labels: 1,
 * vertical: 1 })` — so a sketch can honour the official `@strudel/draw`
 * vocabulary. Empty `{}` when the viz was called with no argument.
 */
type VizOptions = Record<string, unknown>;
/**
 * Internal type alias for the existing p5 sketch factory signature.
 * Used only by P5VizRenderer — NOT exported from the package.
 *
 * `optionsRef` (5th, optional for back-compat) exposes the live per-render
 * options bag as `stave.options`; callers that don't wire it get `{}`.
 *
 * `staveUniformsRef` (6th, optional for back-compat — Phase 21) carries the
 * live named-signal uniform object (`uKick…`, `u(...)`) built by
 * `P5VizRenderer` from its per-renderer SignalBus. Callers that don't wire it
 * get an inert object (all signals 0). Type-only import to avoid a runtime
 * cycle with `p5Compiler`.
 */
type P5SketchFactory = (hapStreamRef: RefObject<HapStream | null>, analyserRef: RefObject<AnalyserNode | null>, schedulerRef: RefObject<PatternScheduler | null>, containerSizeRef: RefObject<ContainerSize>, optionsRef?: RefObject<VizOptions>, staveUniformsRef?: RefObject<StaveUniforms>) => (p: p5.default) => void;

/**
 * Central configuration for the Stave visualization system.
 *
 * All tunable hyperparameters live here instead of being scattered across
 * renderers, sketches, and layout code. Import `VIZ_CONFIG` (or call
 * `createVizConfig()` with overrides) to read values at runtime.
 */
interface VizConfig {
    /**
     * Renderer used when `.viz("mode")` has no explicit `:renderer` suffix.
     *
     * When a user writes `.viz("pianoroll")` and both `"pianoroll"` (p5) and
     * `"pianoroll:hydra"` exist, the resolver tries an exact match first.
     * If the exact bare id isn't registered, it appends `":${defaultRenderer}"`
     * and retries before falling back to the first prefix match.
     *
     * Set to `'p5'` for lightweight 2D canvas visuals (lower GPU),
     * or `'hydra'` for WebGL shader-based visuals (richer but heavier).
     */
    defaultRenderer: string;
    /**
     * Phase B / B-3 feature flag (epic #228). When `true` AND the browser is
     * worker-capable (OffscreenCanvas + transferControlToOffscreen + a registered
     * worker factory), p5 vizzes render in an OffscreenCanvas Web Worker
     * (`WorkerVizRenderer`), moving `draw()` off the main thread so it stops
     * starving the audio scheduler. When `false` (DEFAULT until the matrix gate is
     * green), every p5 viz renders on the main thread (`P5VizRenderer`) — today's
     * behaviour, unchanged. The main-thread renderer is ALWAYS the fallback when a
     * browser can't offload, regardless of this flag.
     */
    workerRenderer: boolean;
    /**
     * Frame-rate cap for worker-rendered viz (frames/sec). The main sampler rAF
     * fires at the display rate (e.g. 120fps on ProMotion); a music viz gains
     * nothing above ~60fps, so producing every display frame just doubles the
     * blit/composite/sample work for no perceptual benefit. The `WorkerVizRenderer`
     * production loop skips frames to hold at most this rate (composed with the
     * #261 in-flight backpressure). 0 / non-positive = uncapped (display rate).
     */
    maxFps: number;
    /**
     * Cap on the device-pixel-ratio worker viz render + present at. The presenting
     * canvas backing store is `cssSize × dpr` and is composited every frame — cost
     * scales with dpr². The worker p5 sketch already renders at 1× (the worker DOM
     * shim reports `devicePixelRatio = 1`), so presenting into a 2× canvas upscales
     * a 1× image for nothing. Capping at 1 makes present match render (quality-
     * neutral, ~4× cheaper composite on a 2× display); raise toward 2 for crisper
     * viz at higher composite cost. Effective dpr = `min(devicePixelRatio, maxDpr)`.
     */
    maxDpr: number;
    /**
     * Sketch-facing level-of-detail multiplier in `(0, 1]`. `1` = full detail
     * (default). Lower values ask the SKETCH to DECIMATE its per-frame work —
     * primarily segment / history COUNT for CPU-tessellation-bound line meshes,
     * the class a resolution drop does NOT help (#232: canvas 600→150px at
     * constant segments = no change). Exposed to sketches as `sig.density`
     * (staveUniforms) so a heavy sketch can scale its geometry, and marshalled
     * into the worker via the config channel (the worker reads its OWN vizConfig
     * singleton — P105 / #253). Fill/fragment-bound sketches (hydra, shaders,
     * large filled regions) gain nothing from `density` and instead ride the
     * resolution/dpr knobs the renderer applies composite-side; that is how a
     * single "performance mode" helps both sketch classes (#232).
     */
    density: number;
    /** Height in pixels of each inline viz zone rendered below a pattern block. */
    inlineZoneHeight: number;
    /**
     * FFT window size for the Web Audio AnalyserNode.
     * Must be a power of 2 between 32 and 32768.
     * Larger = better frequency resolution, worse time resolution.
     * 2048 is a good balance for music visualization.
     */
    fftSize: number;
    /**
     * Smoothing factor for the AnalyserNode (0.0–1.0).
     * 0 = no smoothing (jittery), 1 = fully smoothed (sluggish).
     * 0.8 gives responsive-but-stable frequency data.
     */
    smoothingTimeConstant: number;
    /**
     * Number of frequency bins Hydra's audio object uses.
     * Hydra's `a.fft[]` array will have this many entries, each
     * representing average energy in an equal-width frequency band.
     * 4 bins = bass / low-mid / high-mid / treble.
     */
    hydraAudioBins: number;
    /**
     * Whether hydra-synth runs its own requestAnimationFrame loop.
     * true  = Hydra renders every frame (default, smoothest).
     * false = caller must tick Hydra manually (advanced use).
     */
    hydraAutoLoop: boolean;
    /** Total seconds visible in the pianoroll rolling window. */
    pianorollWindowSeconds: number;
    /** Number of pattern cycles visible in the pianoroll. */
    pianorollCycles: number;
    /** Playhead position as a 0..1 fraction of the canvas width. */
    pianorollPlayhead: number;
    /** Lowest MIDI note shown on the pianoroll Y-axis. */
    pianorollMidiMin: number;
    /** Highest MIDI note shown on the pianoroll Y-axis. */
    pianorollMidiMax: number;
    /** Seconds visible in the event-driven scope fallback mode. */
    scopeWindowSeconds: number;
    /** Vertical amplitude scale for scope/fscope waveforms (0..1). */
    scopeAmplitudeScale: number;
    /** Waveform baseline position as a fraction of canvas height (0=top, 1=bottom). */
    scopeBaseline: number;
    /** Minimum dB floor for spectrum normalization. */
    spectrumMinDb: number;
    /** Maximum dB ceiling for spectrum normalization. */
    spectrumMaxDb: number;
    /** Scroll speed in pixels per frame for waterfall spectrum. */
    spectrumScrollSpeed: number;
    /** Shared background color for all p5 sketch canvases. */
    backgroundColor: string;
    /** Primary accent color for waveforms, bars, and inactive notes. */
    accentColor: string;
    /** Color for actively playing notes / highlights. */
    activeColor: string;
    /** Playhead line color (semi-transparent works best). */
    playheadColor: string;
}
declare const DEFAULT_VIZ_CONFIG: Readonly<VizConfig>;
/**
 * Creates a VizConfig by merging overrides onto defaults.
 *
 * ```ts
 * const config = createVizConfig({ defaultRenderer: 'hydra', hydraAudioBins: 8 })
 * ```
 */
declare function createVizConfig(overrides?: Partial<VizConfig>): VizConfig;
/**
 * Discrete viz quality level. The user picks one ("performance mode"); it maps
 * to the two knobs that scale per sketch class (`deriveVizQuality`).
 */
type VizQualityLevel = 'high' | 'balanced' | 'performance';
/** The default quality level — `balanced` reproduces today's behaviour exactly. */
declare const DEFAULT_VIZ_QUALITY: VizQualityLevel;
/** The two knobs a quality level scales. */
interface VizQualitySettings {
    /** Inline-viz render backing-store HEIGHT (px) — composite/fill cost (main-side). */
    resolution: number;
    /** Sketch LOD multiplier in `(0, 1]` — segment/history count (worker-side, `sig.density`). */
    density: number;
}
/**
 * Map a quality level to the two knobs it scales.
 *
 * A single "performance mode" drops BOTH resolution AND density because the
 * WINNING lever differs by sketch class (#232): resolution helps fill/fragment/
 * hydra; density helps CPU-tessellation line meshes. Each sketch benefits from
 * whichever applies, and both move together with the level.
 *
 * `balanced` is the default and maps to today's values (resolution 512, density
 * 1) so existing projects render identically until the user opts into a level.
 * `resolution` mirrors the editorRegistry inline-viz-resolution presets.
 */
declare function deriveVizQuality(level: VizQualityLevel): VizQualitySettings;
/** Returns the active viz configuration. */
declare function getVizConfig(): Readonly<VizConfig>;
/**
 * Replaces the active viz configuration.
 * Call early (before any engine.init / editor mount) for consistent behavior.
 * Unspecified fields RESET to defaults (see `updateVizConfig` to merge instead).
 */
declare function setVizConfig(config: Partial<VizConfig>): void;
/**
 * MERGES a partial patch onto the ACTIVE config — unlike `setVizConfig`, which
 * resets unspecified fields to defaults. Used by the worker config-marshal
 * channel (#269): an incremental `{ density }` patch must NOT wipe a prior
 * `hydraAudioBins`. Notifies listeners so the marshal channel can re-ship.
 */
declare function updateVizConfig(patch: Partial<VizConfig>): void;
/**
 * The ONLY vizConfig fields the WORKER bundle reads. The worker has its own
 * `vizConfig` singleton (it's a separate bundle — P105) that otherwise stays at
 * `DEFAULT_VIZ_CONFIG`; these are marshalled across the thread boundary so the
 * worker sketch sees the user's effective settings:
 *   - `hydraAudioBins` — hydra fft bin count (hostP5Worker; closes #253)
 *   - `density`        — the `sig.density` LOD multiplier (staveUniforms)
 * `maxFps`/`maxDpr` are deliberately EXCLUDED: the main `WorkerVizRenderer` paces
 * frame production and sizes the presenting canvas, so the worker never reads
 * them. Adding a key here is the one place to extend what crosses the boundary.
 */
declare const WORKER_VIZ_CONFIG_KEYS: readonly ["hydraAudioBins", "density"];
type WorkerVizConfig = Pick<VizConfig, (typeof WORKER_VIZ_CONFIG_KEYS)[number]>;

export { type AudioComponent as A, DEFAULT_VIZ_CONFIG as D, type EngineComponents as E, type HapEvent as H, type IREvent as I, type LiveCodingEngine as L, type PatternIR as P, type QueryableComponent as Q, type SourceLocation as S, type VizDescriptor as V, type WorkerVizConfig as W, type IRPattern as a, HapStream as b, type PatternScheduler as c, type VizRenderer as d, type VizOptions as e, type P5SketchFactory as f, type VizQualityLevel as g, type StreamingComponent as h, type InlineVizComponent as i, type VizRendererSource as j, DEFAULT_VIZ_QUALITY as k, IR as l, type IRComponent as m, type PlayParams as n, type VizConfig as o, type VizQualitySettings as p, type VizRefs as q, createVizConfig as r, deriveVizQuality as s, getVizConfig as t, setVizConfig as u, updateVizConfig as v };
