// Ambient declarations for Strudel packages that ship without TypeScript types.
// These are intentionally loose — the strudel API uses dynamic JS patterns.

declare module '@strudel/transpiler' {
  export function transpiler(code: string, options?: Record<string, unknown>): { output: string; [key: string]: unknown }
}

declare module '@strudel/core' {
  export function evaluate(
    code: string,
    options?: Record<string, unknown>
  ): Promise<{ pattern: unknown; error?: Error }>

  export class Pattern {
    [key: string]: unknown
  }

  export function register(name: string, fn: unknown): void
}

declare module '@strudel/webaudio' {
  export function initAudio(): Promise<void>
  export function getAudioContext(): AudioContext

  /**
   * Play a single hap value once (the engine's audio path bottoms out here).
   * Signature: (value, when, durationSec, cps, cycle). `value` is a hap value
   * like `{ s, note, gain }`. Used to audition a pitch from the piano roll (#633).
   */
  export function superdough(
    value: Record<string, unknown>,
    when: number,
    durationSec: number,
    cps?: number,
    cycle?: number
  ): Promise<void>

  /**
   * Trigger function — NOT a factory. Signature: (hap, time, cps, endTime, s) => void
   * Pass as `defaultOutput` to webaudioRepl, or wrap it.
   */
  export const webaudioOutput: (
    hap: unknown,
    time: number,
    cps: number,
    endTime: number,
    s?: number
  ) => Promise<void>

  /**
   * Connect an AudioNode into superdough's master output chain.
   */
  export function connectToDestination(node: AudioNode, channels?: number[]): void

  /**
   * Register sounds so `s("name")` can address them (re-exported from
   * superdough — `sampler.mjs:249`). A map value may be one URL or a list of
   * them; `baseUrl` is concatenated onto each, so pass `''` for absolute or
   * `blob:` URLs. Resolves once the map is registered — the samples themselves
   * are fetched lazily at playback (#1500).
   */
  export function samples(
    sampleMap: Record<string, string | string[]>,
    baseUrl?: string,
    options?: { prebake?: boolean; tag?: string }
  ): Promise<void>

  /**
   * A registered sound, or `undefined` for a name nothing has registered.
   *
   * `data.samples` is the BANK — the same object `registerSample` stored and the
   * same one it hands to the trigger (`superdough/sampler.mjs:354-359`), so
   * reading it asks exactly the question playback will ask. Synths and wavetables
   * register with no bank, which is why `samples` is optional here rather than
   * a promise that every sound is a sample (#1506).
   */
  export function getSound(name: string):
    | { data?: { type?: string; samples?: Record<string, string[]> | string[] } }
    | undefined

  /**
   * Which file (and at what playback rate) a hap value resolves to within a bank
   * (`superdough/sampler.mjs:33`). The bank comes from `getSound(s).data.samples`.
   *
   * For a LIST bank the file is picked by `n`; for an OBJECT bank it is picked by
   * nearest note (`superdough/util.mjs:97-107`), so the note matters to WHICH
   * file, not only to its pitch.
   */
  export function getSampleInfo(
    hapValue: Record<string, unknown>,
    bank: Record<string, string[]> | string[]
  ): { transpose: number; url: string; index: number; midi: number; label: string; playbackRate: number }

  /**
   * The DECODED buffer for an already-loaded URL, or `undefined` (`sampler.mjs:17`).
   *
   * Synchronous and non-fetching: it reads a map that `loadBuffer` fills only
   * after a fetch AND a decode have both completed (`sampler.mjs:86-101`), so a
   * miss means "not loaded yet", never "no such sample".
   *
   * ⚠ superdough's own comment calls this cache `string: Promise<ArrayBuffer>`
   * (`sampler.mjs:14`). It is neither — `:100` stores the decoded `AudioBuffer`.
   * Typed here from the code rather than from the comment.
   */
  export function getCachedBuffer(url: string): AudioBuffer | undefined

  /**
   * Fetch + decode a sample URL, resolving to the decoded buffer
   * (`superdough/sampler.mjs:86`). Deduplicated internally by URL, and it is
   * what populates the cache `getCachedBuffer` reads, so calling it is how a
   * sample becomes drawable without waiting for it to be played (#1506).
   *
   * `label` only shapes the log line. Decoding does not require a RUNNING audio
   * context — a suspended one decodes — so this does not need a user gesture.
   */
  export function loadBuffer(url: string, ac: BaseAudioContext, label?: string): Promise<AudioBuffer>

  /**
   * Creates a full repl (scheduler + evaluate) wired to webaudio output.
   */
  export function webaudioRepl(options?: {
    audioContext?: AudioContext
    defaultOutput?: unknown
    getTime?: () => number
    [key: string]: unknown
  }): {
    scheduler: {
      start(): void
      stop(): void
      pause(): void
      setCps(cps: number): void
      cps: number
    }
    evaluate(code: string, autostart?: boolean): Promise<void>
  }

  export class Scheduler {
    constructor(options: {
      audioContext: AudioContext
      onTrigger: (
        hap: unknown,
        time: number,
        cps: number,
        endTime: number
      ) => void
      [key: string]: unknown
    })
    setPattern(pattern: unknown): void
    start(): void
    stop(): void
  }
}

declare module '@strudel/mini' {
  // Side-effect only — registers mini() on import
}

// Source-level submodule paths — used by the parity harness to exercise
// the documented Strudel evaluator path under vitest. Loose any-typed:
// the parity test casts what it needs at use sites.
declare module '@strudel/core/evaluate.mjs' {
  export function evalScope(...args: unknown[]): Promise<unknown[]>
  export function evaluate(
    code: string,
    transpiler?: unknown,
    transpilerOptions?: unknown,
  ): Promise<{ pattern: unknown; mode: string; meta: unknown }>
  export const strudelScope: Record<string, unknown>
}

declare module '@strudel/core/pattern.mjs'
declare module '@strudel/core/signal.mjs'
declare module '@strudel/core/controls.mjs'
declare module '@strudel/core/euclid.mjs' {
  /**
   * Bjørklund's algorithm — the euclidean onset distribution Strudel itself
   * plays. `bjorklund(3, 8)` → `[1,0,0,1,0,0,1,0]`. Imported rather than
   * re-implemented: the notation view must show the cells the audio triggers,
   * and a copy of this is only correct until upstream changes it.
   */
  export function bjorklund(ons: number, steps: number): number[]
}
/**
 * The krill parser — the mini-notation grammar Strudel actually runs (the
 * transpiler calls this same parser). Self-contained: it deep-imports without
 * dragging `@strudel/core`'s barrel (which pulls `@kabelsalat/web`) in.
 * `parse` wants the mini string QUOTED — `parse('"' + mini + '"')` — which is
 * the transpiler's own call shape. Returns the krill AST; the notation parser
 * declares the node shapes it consumes and casts at the use site (the loose
 * convention above).
 */
declare module '@strudel/mini/krill-parser.js' {
  export function parse(src: string): unknown
}
declare module '@strudel/mini/mini.mjs' {
  export const mini: (...args: unknown[]) => unknown
  export function miniAllStrings(): void
  /** krill's whitespace-corrected leaf spans `[from,to]` for a QUOTED mini string */
  export function getLeafLocations(code: string, start?: number, userCode?: string): Array<[number, number]>
}

declare module '@strudel/tonal' {
  // Side-effect only — registers note(), s(), gain() etc. on import
}

declare module '@strudel/soundfonts' {
  export function registerSoundfonts(): void
  export function loadSoundfont(name: string): Promise<unknown>
  export function setSoundfontUrl(url: string): void
  export const soundfontList: string[]
}

declare module '@strudel/xen' {
  // Side-effect only — registers edo(), xen(), tuning() on Pattern prototype
}

declare module '@strudel/draw' {
  // Side-effect only — registers pianoroll(), scope(), tscope(), fscope() on Pattern prototype
}

declare module '@strudel/midi' {
  export function enableWebMidi(options?: Record<string, unknown>): Promise<void>
  export const WebMidi: unknown
}

declare module '@strudel/mondo' {
  // Side-effect only — registers mondo()/mondolang()/getLocations() via
  // evalScope on import. Added Phase 20-14 α; dynamic-imported in
  // StrudelEngine as Promise<any>. Untyped: upstream ships no .d.ts (#145).
}
