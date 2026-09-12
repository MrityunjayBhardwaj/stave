/**
 * LiveCodingRuntime — Phase 10.2 Task 05.
 *
 * Per-file runtime that wraps a `LiveCodingEngine` with the workspace audio
 * bus publish/unpublish lifecycle. One runtime per workspace file id; the
 * runtime owns the engine, owns any elevated `BufferedScheduler`, and is
 * responsible for keeping the bus's view of "this file is playing" in sync
 * with the engine's actual state.
 *
 * @remarks
 * ## Why this lives in `workspace/runtime/` and not `engine/`
 *
 * The engine layer (`packages/editor/src/engine/`) defines the
 * `LiveCodingEngine` interface and ships concrete engines (`StrudelEngine`,
 * `SonicPiEngine`, `DemoEngine`). It knows nothing about the workspace,
 * the audio bus, or react. The runtime is the bridge: it lives in the
 * workspace layer because it depends on `workspaceAudioBus`, `WorkspaceFile`
 * snapshot identity, and the workspace concept of a "file id" — but it
 * never reaches into engine internals. The boundary is one-way: workspace
 * imports from engine, never the other way.
 *
 * ## What this file MUST NOT do (PV1, PV2, P1, P2)
 *
 * - It MUST NOT touch `Pattern.prototype`. All Strudel Pattern method
 *   wrappers are installed inside `StrudelEngine.evaluate()`'s `.p` setter
 *   trap. Re-installing them here would either no-op (if installed before
 *   `injectPatternMethods`, which the engine calls during `evaluate`) or
 *   silently break the engine's own wrappers (if installed after, which
 *   would race the engine's restoration in its `finally` block).
 *
 *   This restriction is enforced by a source-grep test in
 *   `__tests__/strudelRuntime.test.tsx` — the assertion fails if any of
 *   `Pattern.prototype` shows up in any runtime/ source file.
 *
 * - It MUST NOT mutate `file.content` before passing to `engine.evaluate`.
 *   Strudel's transpiler reifies string arguments (P1) — the EXACT string
 *   the engine sees is load-bearing. Any "preview validation" or
 *   "sanitization" in this layer breaks `.viz()` reification, mini-notation
 *   parsing, and `setcps()` extraction in unpredictable ways.
 *
 * - It MUST NOT install its own `.viz()` interceptor. The engine already
 *   captures viz requests in `engine.components.inlineViz.vizRequests` after
 *   `evaluate()` resolves; the runtime forwards the captured map through
 *   the bus payload's `inlineViz` slot. Task 07's EditorView reads from
 *   there to materialize Monaco view zones.
 *
 * ## Lifecycle (PK1)
 *
 * The `play()` method is the only nontrivial sequence in this file. The
 * nine-step lifecycle is documented in `LiveCodingRuntime` interface
 * JSDoc in `types.ts`. The two ordering constraints worth restating here:
 *
 *   - **`evaluate` MUST resolve before `engine.components` is read.** The
 *     engine populates `inlineViz.vizRequests` and `queryable.scheduler`
 *     during `evaluate`. Reading `components` mid-`evaluate` returns a
 *     half-baked bag.
 *   - **`bus.publish` MUST happen before `engine.play`.** Subscribers (viz
 *     consumers, the EditorView's inline-zone effect) need the payload in
 *     hand BEFORE the first hap event fires. If we published after
 *     `engine.play()`, the first cycle of audio events would land in a
 *     subscriber that hasn't been wired to a HapStream yet.
 *
 * Between step 4 (`evaluate` resolves) and step 7 (`bus.publish`), there
 * must be no `await`. A microtask boundary at that point would let another
 * `play()` invocation interleave its own evaluate and corrupt the
 * components view we're about to publish. Steps 5 and 6 are pure object
 * construction and synchronous BufferedScheduler instantiation; both are
 * safe.
 *
 * ## BufferedScheduler elevation (S8)
 *
 * Sonic Pi (and any future engine that ships streaming + audio without a
 * native queryable) does not provide a `PatternScheduler` in
 * `engine.components.queryable`. The runtime detects this on every play
 * and lazily constructs a `BufferedScheduler` wrapping the engine's
 * `HapStream` and `AudioContext`. The elevated scheduler is held on
 * `bufferedSchedulerRef` so `dispose()` can release it. On engines that
 * DO ship a native queryable, the elevated ref stays `null` and the
 * native scheduler is forwarded directly through the payload.
 *
 * ## Error semantics (S7)
 *
 * Two error sources flow through the runtime:
 *
 *   1. **Evaluate errors** — `engine.evaluate(code)` returns
 *      `{ error: Error }`. The runtime fires `onError` listeners and
 *      returns the error from `play()`. The bus is NOT touched (no
 *      publish, no unpublish-on-error).
 *   2. **Runtime audio errors** — the engine's
 *      `setRuntimeErrorHandler(cb)` fires AFTER `play()` succeeded, when
 *      a scheduled event hits a sound-not-found or similar runtime
 *      condition. The runtime forwards these to its own `onError`
 *      listeners as well. Audio keeps playing — these are not fatal,
 *      just visible diagnostics.
 *
 * The chrome subscribes to `onError` for the toolbar error badge; Task 07's
 * EditorView subscribes for Monaco squiggle markers via `setEvalError`.
 * Both consume the same event source, no two-way coupling.
 */

import type { LiveCodingEngine } from '../../engine/LiveCodingEngine'
import type { HapStream } from '../../engine/HapStream'
import type { IREvent } from '../../ir/IREvent'
import type { BreakpointStore } from '../../engine/BreakpointStore'
import { BufferedScheduler } from '../../engine/BufferedScheduler'
// #1570 — the transport frame's arithmetic only. The WRAPS it describes are
// applied engine-side at the `.p` seam; nothing here touches Pattern.prototype
// (PV2 / P2 source-grep guard).
import {
  songPositionAt,
  transportOffsetForSeek,
  normalizeLoopRange,
  isInsideLoop,
  type LoopRange,
} from '../../engine/transportFrame'
import { workspaceAudioBus } from '../WorkspaceAudioBus'
import type {
  AudioPayload,
  LiveCodingRuntime as LiveCodingRuntimeInterface,
} from '../types'
import {
  notifyPlaybackStarted,
  notifyPlaybackStopped,
  registerPlaybackSource,
} from '../playbackCoordinator'

/**
 * Debounce window for live-mode re-evaluate. Matches the legacy
 * `LiveCodingEditor.tsx:293-300` timing so the feel is byte-identical to
 * pre-refactor Strudel live coding. 500ms is short enough to feel
 * responsive while absorbing multi-keystroke bursts that would otherwise
 * cause re-play storms on every character.
 */
const LIVE_MODE_DEBOUNCE_MS = 500

/**
 * Subscribe-to-file function shape. Callers supply one if they want the
 * runtime's live mode (`setAutoRefresh(true)`) to actually do anything —
 * otherwise live mode is a no-op (useful in tests that don't want to
 * stand up a full `WorkspaceFile` store).
 *
 * The callback fires on EVERY content change for the runtime's file id,
 * including changes that originate from `play()`'s own `evaluate` call
 * (which does not write back, so this is fine in practice). The returned
 * disposer is called by the runtime when it tears down the subscription.
 */
export type SubscribeToRuntimeFile = (cb: () => void) => () => void

/**
 * Parse `setcps(numerator/denominator)` (or `setcps(value)`) out of the
 * given source code and convert to BPM. Returns `undefined` if no
 * `setcps` line is present or the expression is unparseable.
 *
 * Strudel's `setcps` takes cycles-per-second; the conventional Strudel
 * preset uses `setcps(BPM/240)` to mean "BPM at 4 beats per cycle"
 * (240 = 60 seconds × 4 beats). The recovery is therefore
 * BPM = cps × 60 × beatsPerCycle = cps × 240, so for the canonical
 * `setcps(num/denom)` form BPM = (numerator / denominator) × 240 — which,
 * for the standard `/240` preset, reads the numerator straight back as the
 * BPM (`setcps(92/240)` → 92). The earlier code multiplied by 60 only,
 * dropping the ×4 beats-per-cycle factor, so every tempo displayed at ¼ of
 * its true value (92 → 23). This matches the canonical `cpsToBpm`
 * (`app/.../musicalTimeline/timeAxis.ts`: `round(cps * 60 * 4)`) (#599).
 *
 * Lives at module scope (not as a method) so the function is pure +
 * trivially testable + has zero `this`-binding gotchas.
 */
export function extractBpmFromCode(code: string): number | undefined {
  // Match setcps(num/denom) — the canonical Strudel form. Allows whitespace
  // around tokens. Numerator and denominator are decimal numbers.
  const fractionMatch = code.match(
    /setcps\s*\(\s*([\d.]+)\s*\/\s*([\d.]+)\s*\)/,
  )
  if (fractionMatch) {
    const numerator = parseFloat(fractionMatch[1])
    const denominator = parseFloat(fractionMatch[2])
    if (denominator > 0 && Number.isFinite(numerator)) {
      return Math.round((numerator / denominator) * 60 * 4) // cps × 60 × beats/cycle
    }
  }
  // Fall back to setcps(N) — interpret as cps × 60 × 4 beats/cycle.
  const scalarMatch = code.match(/setcps\s*\(\s*([\d.]+)\s*\)/)
  if (scalarMatch) {
    const cps = parseFloat(scalarMatch[1])
    if (Number.isFinite(cps)) {
      return Math.round(cps * 60 * 4)
    }
  }
  return undefined
}

/**
 * Constructor argument shape. Kept as a positional triple rather than an
 * options object because the contract is small and stable: a runtime is
 * defined entirely by its file id, the engine it wraps, and the function
 * that returns the file's current content at evaluate time.
 *
 * @param fileId - The workspace file id this runtime publishes under.
 *   Used both as the bus key and as the address for `dispose()` cleanup.
 * @param engine - The engine instance this runtime wraps. The runtime
 *   takes ownership; the caller MUST NOT dispose this engine independently.
 * @param getFileContent - Closure that returns the current file content
 *   at the moment `play()` is called. Passing a closure (rather than a
 *   string) lets the runtime stay decoupled from `useWorkspaceFile` /
 *   the workspace store — tests can pass a static string, the live
 *   compat shim can pass `() => getFile(fileId)?.content ?? ''`. This
 *   keeps the runtime testable in a plain Node environment.
 */
export class LiveCodingRuntime implements LiveCodingRuntimeInterface {
  readonly engine: LiveCodingEngine
  readonly fileId: string

  private readonly getFileContent: () => string
  private readonly subscribeToFile: SubscribeToRuntimeFile | null
  private bufferedSchedulerRef: BufferedScheduler | null = null
  private isInitialized = false
  private isDisposed = false
  private currentBpm: number | undefined = undefined
  private isPlayingState = false

  /**
   * Monotonic play generation. `play()` is async and yields across `await`
   * init/evaluate before it starts the scheduler. If a `stop()` (or a newer
   * `play()`) lands during those awaits, the in-flight `play()` must abort
   * BEFORE step 7/8 — otherwise it publishes stale state and restarts the
   * scheduler right after Stop already stopped it, leaving audio running while
   * `isPlayingState` reads `false` (Stop then becomes a permanent no-op). Each
   * `play()` captures this counter at entry; `stop()` and each new `play()`
   * bump it; after every await, `play()` bails if its token is stale (#811).
   */
  private playGeneration = 0

  /**
   * Serializes every `engine.evaluate()` call this runtime makes — `play()`'s
   * eval and `evaluateForTimeline()`'s eval share it (#977). The engine
   * installs its `.p` capture wrappers on the shared Pattern prototype and
   * closes them over the CURRENT evaluate's capture maps; two overlapping
   * evaluates would cross-wire captured patterns (the same audio-boundary
   * race class as the double-init in #815). A user can edit — firing a
   * debounced eval-on-load — and press Play a beat later, so the overlap is
   * real. Chaining through this promise guarantees one evaluate at a time;
   * `play()`'s supersession gate (#811) still runs after the wait, so a Stop
   * landing during the queue is honored.
   */
  private evalGate: Promise<unknown> = Promise.resolve()

  /**
   * Diagnostics from the last SPECULATIVE evaluate (#1172) — the one run to
   * refresh timeline marks from a document the user is still typing. Kept
   * rather than discarded, because `console.error` is muted for that call and
   * information that is silenced without being recorded is information lost.
   * Read via {@link getTimelineEvalDiagnostics}.
   */
  private lastTimelineEvalError: Error | null = null
  private suppressedConsoleErrors: readonly string[] = []

  private readonly errorListeners = new Set<(err: Error) => void>()
  private readonly playingChangedListeners = new Set<(playing: boolean) => void>()
  private readonly evaluateSuccessListeners = new Set<(code: string) => void>()

  /**
   * Unregister callback from the playback coordinator. Called in
   * `dispose()` to remove this runtime from the registry so its
   * stop callback can't be invoked after the runtime has been torn
   * down. Set in the constructor so every instance participates in
   * single-source playback coordination from birth.
   */
  private unregisterFromPlaybackCoordinator: () => void = () => {}

  // Live mode (autoRefresh) state.
  //
  // The subscription is lazily installed the first time `setAutoRefresh(true)`
  // is called AND the runtime is playing. Every subsequent reconcile
  // (play/stop/setAutoRefresh/dispose) maintains the invariant
  //
  //     (autoRefreshEnabled && isPlayingState && subscribeToFile) <=>
  //     (autoRefreshUnsub !== null)
  //
  // so the subscription lifetime is driven by three independent signals
  // without leaking between sessions or firing after dispose. The debounce
  // timeout is tracked separately so setAutoRefresh(false) / stop() can
  // cancel an in-flight pending re-play.
  private autoRefreshEnabled = false
  private autoRefreshUnsub: (() => void) | null = null
  private autoRefreshTimeout: ReturnType<typeof setTimeout> | null = null
  private readonly autoRefreshChangedListeners = new Set<(enabled: boolean) => void>()

  constructor(
    fileId: string,
    engine: LiveCodingEngine,
    getFileContent: () => string,
    subscribeToFile: SubscribeToRuntimeFile | null = null,
  ) {
    this.fileId = fileId
    this.engine = engine
    this.getFileContent = getFileContent
    this.subscribeToFile = subscribeToFile

    // Wire the engine's runtime error handler into our own error listeners
    // so audio scheduling errors (sound-not-found etc.) surface through the
    // same channel as evaluate errors. The engine fires this from inside
    // its scheduler callback, so the listener may run on a non-React tick.
    engine.setRuntimeErrorHandler((err) => {
      this.fireOnError(err)
    })

    // Register with the playback coordinator so other sources can
    // stop this runtime when they start. The stop callback is
    // `this.stop` bound to the instance — it's idempotent (checks
    // `isPlayingState`), so the coordinator can call it even when
    // we're already stopped. The returned unregister function is
    // called from `dispose()` to cleanly remove our entry when the
    // runtime is torn down.
    this.unregisterFromPlaybackCoordinator = registerPlaybackSource(
      fileId,
      () => this.stop(),
      `LiveCodingRuntime:${fileId}`,
    )
  }

  async init(): Promise<void> {
    if (this.isInitialized) return
    if (this.isDisposed) {
      throw new Error('LiveCodingRuntime: cannot init after dispose')
    }
    await this.engine.init()
    this.isInitialized = true
  }

  /**
   * Run `fn` (an `engine.evaluate()` call) exclusively, chained behind any
   * evaluate already in flight. See `evalGate` for why serialization is
   * mandatory. Errors are swallowed on the gate chain so one failed evaluate
   * doesn't poison the queue; the caller still sees `fn`'s own resolution.
   */
  private runExclusiveEval<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.evalGate.then(fn, fn)
    this.evalGate = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  /**
   * Populate the engine's timeline haps (`songPatterns`) WITHOUT starting
   * playback, so the Song timeline draws eval-faithful marks BEFORE the user
   * presses Play (#977). Runs init (idempotent) + `engine.evaluate` and stops
   * there: no bus publish, no `scheduler.start()`, no playing-state flip.
   *
   * ⚠ THE SCHEDULER-FREE CLAIM IS ENFORCED NOW, NOT ASSUMED (#1186). It used to
   * be false. `engine.evaluate` called Strudel's `repl.evaluate(code)` with a
   * single argument, and that function's `autostart` parameter DEFAULTS TO TRUE
   * (@strudel/core/repl.mjs:222 → setPattern :272/:105-107 →
   * cyclist.mjs:123-126) — so this path started the transport, and merely
   * mounting the Song view made the app emit notes with no user gesture. The
   * engine now passes `autostart = false`, which leaves the start to `play()`
   * step 8 alone. `evaluate()` captures patterns via the `.p` setter and
   * queryArcs them offline. Reusing the real `engine.evaluate` means pre-play
   * marks come from the SAME eval oracle as playback — there is no second
   * interpreter to drift.
   *
   * ⚠ AND WHAT THIS DOCBLOCK NO LONGER CLAIMS. It used to open with "the
   * AudioContext stays suspended". That was never measured, and it is not what
   * the fix establishes — Chrome grants user activation for a BROWSER-INITIATED
   * navigation, so a freshly loaded page can already hold a running context
   * before anything is clicked. The verified claim is narrower, and it is the
   * one that matters: no scheduler start, and no note events emitted. Measured
   * 45 → 0 in `packages/app/tests/pre-gesture-transport.spec.ts`. If you need
   * the context's state, measure it; do not read it out of this comment.
   *
   * Silent by design: does NOT fire `onError` / `evaluateSuccess`. A failed
   * evaluate (mid-edit invalid code) simply leaves `songPatterns` empty and the
   * timeline falls back to the structural walk + collect marks (the resilience
   * path). The only observable change is that pre-play marks for VALID code
   * become eval-computed instead of collect-computed.
   *
   * No-op while playing or disposed: `play()` already keeps `songPatterns`
   * fresh, so re-evaluating mid-play would be redundant churn.
   */
  async evaluateForTimeline(): Promise<void> {
    if (this.isDisposed || this.isPlayingState) return
    try {
      if (!this.isInitialized) {
        await this.engine.init()
        this.isInitialized = true
      }
      // Re-check after the init await — a play()/dispose may have landed.
      if (this.isDisposed || this.isPlayingState) return
      const code = this.getFileContent()
      // ⚠ THE SILENCING GOES INSIDE THE GATE, NOT AROUND IT (#1172).
      // `runExclusiveEval` first AWAITS any in-flight evaluate. Wrapping the
      // whole call would leave `console.error` stubbed while play()'s evaluate
      // is still running, and swallow ITS errors — which are real, and the
      // user's. Inside the callback the gate has already granted exclusivity,
      // so the quiet window covers exactly our own speculative evaluate.
      const result = await this.runExclusiveEval(() =>
        this.evaluateQuietly(() => this.engine.evaluate(code)),
      )
      this.lastTimelineEvalError = result?.error ?? null
    } catch {
      // Best-effort: on any failure the timeline keeps its collect fallback.
    }
  }

  /**
   * Run the speculative evaluate with `console.error` muted (#1172).
   *
   * WHY THIS IS NOT SUPPRESSING A SYMPTOM. This path is handed whatever the
   * document says WHILE THE USER IS STILL TYPING IT, so a failure here is the
   * expected case, not news: `s("bd` is a parse error on the way to
   * `s("bd sd")`, and `arrang` is a ReferenceError on the way to `arrange`.
   * Reporting those through the same channel as a real error is what makes the
   * console useless — a console where an error means nothing cannot warn anyone
   * about anything.
   *
   * WHY IT HAS TO BE DONE HERE RATHER THAN BY CATCHING. The write is not ours.
   * Strudel's repl logs the failure itself and does not rethrow
   * (`@strudel/core/repl.mjs`, the `evaluate` catch: `logger(…, 'error')` then
   * an unconditional `console.error(err)`), so no try/catch on our side can
   * reach it. Note it is NOT dev-gated the way `errorLogger` is, so this floods
   * production users' consoles too, not just ours.
   *
   * WHY NOTHING IS LOST. The same error arrives structurally through the repl's
   * `onEvalError` and comes back as `{ error }`, which the caller now records on
   * `lastTimelineEvalError` instead of discarding. Anything else that printed
   * during the window is kept verbatim on `suppressedConsoleErrors` rather than
   * dropped — see `getTimelineEvalDiagnostics()`.
   *
   * THE WINDOW IS AS NARROW AS IT CAN BE, AND ITS ONE RESIDUAL RISK IS STATED.
   * It spans a single `engine.evaluate` under the eval gate, so no other
   * evaluate of ours can run inside it. An unrelated subsystem logging
   * asynchronously in that window is still captured rather than printed —
   * which is why it is captured rather than dropped.
   */
  private async evaluateQuietly<T>(fn: () => Promise<T>): Promise<T> {
    const captured: string[] = []
    const original = console.error
    const stub = (...args: unknown[]): void => {
      captured.push(
        args.map((a) => (a instanceof Error ? `${a.name}: ${a.message}` : String(a))).join(' '),
      )
    }
    console.error = stub as unknown as typeof console.error
    try {
      return await fn()
    } finally {
      // Restore ONLY if ours is still the installed one. If something nested
      // swapped it after us, putting `original` back would clobber that wrapper
      // and leak this one — better to leave the newer chain intact.
      if ((console.error as unknown) === stub) console.error = original
      this.suppressedConsoleErrors = captured
    }
  }

  /**
   * What the last speculative timeline evaluate hit, if anything (#1172).
   *
   * `error` is the repl's own eval error, which used to be discarded here.
   * `suppressedConsoleErrors` is everything that tried to reach `console.error`
   * during that evaluate — normally the same failure, phrased by Strudel. Both
   * are diagnostics, not control flow: a failed speculative evaluate is a
   * routine consequence of evaluating a half-typed document, and the timeline
   * simply keeps its previous marks.
   */
  getTimelineEvalDiagnostics(): {
    readonly error: Error | null
    readonly suppressedConsoleErrors: readonly string[]
  } {
    return { error: this.lastTimelineEvalError, suppressedConsoleErrors: this.suppressedConsoleErrors }
  }

  /**
   * The nine-step play lifecycle (PK1). See class JSDoc above.
   *
   * Returns the evaluate error if any (also fires `onError` listeners).
   * The bus is left untouched on error — no publish, no unpublish.
   */
  async play(): Promise<{ error: Error | null }> {
    if (this.isDisposed) {
      const err = new Error('LiveCodingRuntime: cannot play after dispose')
      this.fireOnError(err)
      return { error: err }
    }

    // Supersede any earlier in-flight play() and record our generation. After
    // each await below we compare against this — if a stop() or a newer play()
    // bumped the counter in the meantime, we abort before starting the
    // scheduler so we never restart audio that Stop just stopped (#811).
    const myGen = ++this.playGeneration
    const superseded = (): boolean => this.isDisposed || myGen !== this.playGeneration

    // Step 1 — init if needed.
    try {
      if (!this.isInitialized) {
        await this.engine.init()
        this.isInitialized = true
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err))
      this.fireOnError(error)
      return { error }
    }

    // Step 2 — evaluate the current file content (P1: pass through unchanged).
    const code = this.getFileContent()
    let evalResult: { error?: Error }
    try {
      // Chained behind any in-flight evaluate-for-timeline (#977) so the
      // engine's shared `.p` capture never runs two evaluates at once.
      evalResult = await this.runExclusiveEval(() => this.engine.evaluate(code))
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err))
      this.fireOnError(error)
      return { error }
    }

    // Step 3 — error gate. Don't publish, don't play.
    if (evalResult.error) {
      this.fireOnError(evalResult.error)
      return { error: evalResult.error }
    }

    // Step 3b — supersession gate. A stop() (or a newer play()) landed during
    // the init/evaluate awaits above. Abort BEFORE publishing to the bus and
    // BEFORE step 8's scheduler.start(): restarting here is exactly the race
    // that leaves audio playing after Stop with isPlayingState === false (#811).
    // Placed here so the step 4→7 window stays await-free (PK1).
    if (superseded()) {
      return { error: null }
    }

    // Steps 4–6 — read components, elevate scheduler if needed, build payload.
    // SYNCHRONOUS section: no awaits between here and step 7.
    const components = this.engine.components
    const streaming = components.streaming
    const audio = components.audio
    const queryable = components.queryable
    const inlineViz = components.inlineViz

    // Step 5 — scheduler elevation (S8). If the engine ships a native
    // queryable, use it. Otherwise wrap streaming + audio in a
    // BufferedScheduler so consumers can query for inline zones / panel viz.
    let scheduler = queryable?.scheduler ?? null
    if (!scheduler && streaming && audio) {
      // Lazily construct (or reuse if a previous play already created one).
      // Reuse keeps the scheduler's rolling event buffer alive across
      // re-evaluate so inline zones don't lose their backlog mid-play.
      if (!this.bufferedSchedulerRef) {
        this.bufferedSchedulerRef = new BufferedScheduler(
          streaming.hapStream,
          audio.audioCtx,
        )
      }
      scheduler = this.bufferedSchedulerRef
    }

    // Step 6 — build the payload. Every slot is optional; consumers guard.
    // The `audio` slot is forwarded whole (not just the analyser) so the
    // EditorView can reach `audioCtx` for highlighting timing math.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const breakpointStore = (this.engine as any).getBreakpointStore?.() ?? undefined
    const payload: AudioPayload = {
      hapStream: streaming?.hapStream,
      analyser: audio?.analyser,
      scheduler: scheduler ?? undefined,
      inlineViz,
      audio,
      // Pass through the full engine components in their original nested
      // shape. addInlineViewZones reads queryable.trackSchedulers,
      // audio.trackAnalysers, inlineViz.trackStreams — the flat fields
      // above don't carry per-track data.
      engineComponents: this.engine.components,
      // Phase 20-07 — Monaco gutter breakpoint UI consumes via the bus.
      breakpointStore,
      onResume: breakpointStore ? () => { this.resume() } : undefined,
    }

    // Step 7 — publish to the bus BEFORE play. Subscribers fire SYNC.
    workspaceAudioBus.publish(this.fileId, payload)

    // Step 8 — start the engine.
    try {
      this.engine.play()
    } catch (err) {
      // If play itself throws, unpublish so the bus doesn't show a phantom
      // running source. Then surface the error.
      workspaceAudioBus.unpublish(this.fileId)
      const error = err instanceof Error ? err : new Error(String(err))
      this.fireOnError(error)
      return { error }
    }

    // Step 9 — extract BPM, mark playing, fire listeners.
    this.currentBpm = extractBpmFromCode(code)
    this.isPlayingState = true
    this.firePlayingChanged(true)

    // Single-source playback coordination — notify AFTER marking
    // ourselves playing so if one of our listeners queries the
    // coordinator, it sees a consistent state. Any other
    // registered source (a different pattern runtime, or one of
    // the built-in example sources) gets its stop callback
    // invoked, so the user only hears one source at a time.
    notifyPlaybackStarted(this.fileId)

    // Live mode: the playing-state flip is one of the reconcile triggers.
    // If setAutoRefresh(true) was called before play(), the subscription
    // installs now; if not, this is a no-op.
    this.reconcileAutoRefresh()

    // Signal successful evaluate so clients can clear any lingering error
    // state from a previous failed attempt — especially during live-mode
    // re-evals where the client otherwise has no signal that the syntax
    // error is gone.
    this.fireEvaluateSuccess(code)

    return { error: null }
  }

  /** Whether this runtime is currently playing (for the time-travel re-eval, #204). */
  getIsPlaying(): boolean {
    return this.isPlayingState
  }

  /**
   * Whether this runtime's engine can capture live audio (#1346).
   *
   * Duck-typed, matching how the app reads `getLastAliasResolutions` off the
   * engine: only `StrudelEngine` implements `record`, and a runtime whose
   * engine doesn't simply reports false rather than the caller casting.
   */
  canRecord(): boolean {
    if (this.isDisposed) return false
    return typeof (this.engine as { record?: unknown }).record === 'function'
  }

  /**
   * Capture `seconds` of this runtime's LIVE output as a WAV Blob (#1346).
   * Returns null when the engine cannot record — see `canRecord`.
   *
   * Playback is guaranteed for the duration of the take, because the capture
   * taps the master analyser: with the transport stopped it would return a
   * valid WAV of pure silence and no error.
   *
   * ⚠ THE CAPTURE ALWAYS BEGINS AT THE TOP OF THE SONG (#1371). The recorder
   * taps the master analyser in real time, so it records whatever the transport
   * is playing AT THAT MOMENT — and the transport is wherever the listening
   * left it. Measured on a three-section arrangement: bouncing after 4s of
   * listening rotated the exported song by 4s, and after 12s by 12s, so the
   * verse arrived early and the file opened mid-chorus. Nothing surfaced it,
   * because a rotated take is still valid, still full-length and still not
   * silent. So a bounce rewinds first and the export is reproducible: the same
   * document bounces to the same audio however long you had been playing it.
   *
   * The rewind is four steps and each is load-bearing:
   *   1. `stop()` — resets the scheduler's query cursor (`cyclist.stop()` sets
   *      `lastEnd = 0`, and each tick queries from `lastEnd`). `pause()` does
   *      NOT, which is exactly why this cannot be a pause.
   *   2. `setTransportOffset(0)` — clears any earlier seek. Song position is
   *      the scheduler clock read through the transport frame, applied as a
   *      `.late()` wrap, so resetting the clock WITHOUT resetting the offset
   *      would rewind the scheduler and leave the pattern shifted — a subtler
   *      version of the same bug. Optional-chained: non-Strudel engines have
   *      no seek.
   *   3. `setLoopRange(null)` — clears any armed loop (#1572), which is the
   *      OTHER half of that frame and fails in exactly the same shape: a
   *      bounce with a loop over bars 3–5 would capture those two bars
   *      repeating for the whole duration. Restored afterwards, unlike the
   *      offset: rewinding is what the user asked for, disarming the locators
   *      they set is not.
   *   4. `play()` — re-evaluates and starts from cycle 0.
   *
   * ⚠ The old comment here warned against calling `play()` when already
   * playing, because `play()` re-evaluates and would restart the audio
   * mid-take. That hazard is real and still respected: the restart happens
   * BEFORE the capture opens, never during it.
   *
   * The transport is stopped afterwards in every case, which is what the
   * modal has always told the user ("playback starts automatically and stops
   * again when the bounce finishes") and was previously true only when the
   * bounce had started it.
   */
  async record(
    seconds: number,
    signal?: AbortSignal,
    onCaptureStart?: () => void
  ): Promise<Blob | null> {
    const engine = this.engine as {
      record?: (s: number, sig?: AbortSignal) => Promise<Blob>
      waitUntilQuiet?: () => Promise<boolean>
      setTransportOffset?: (offset: number) => void
      getLoopRange?: () => LoopRange | null
      setLoopRange?: (range: LoopRange | null) => void
    }
    if (this.isDisposed || typeof engine.record !== 'function') return null

    // Rewind to the top of the song. Stopping an already-running transport is
    // what makes the take reproducible; stopping an already-stopped one is a
    // no-op, so both entry states converge on the same path.
    this.stop()

    // #1356 — the graph may still be RINGING: stopping halts the scheduler but
    // does not cancel Web Audio nodes already scheduled, and that tail survives
    // into the capture, summing the previous take under the opening of the new
    // one. Wait for the analyser to actually read silent rather than assuming
    // it does. Costs one hold window when the graph is already quiet. This now
    // also covers the bounce-while-playing case, which previously skipped the
    // settle entirely.
    await engine.waitUntilQuiet?.()

    // Clear any earlier seek, so song cycle 0 is scheduler cycle 0.
    engine.setTransportOffset?.(0)

    // #1572 — and clear the LOOP, which is the second thing that decides what
    // the take contains. The recorder taps the master analyser in real time, so
    // a bounce with a loop armed over bars 3–5 would capture those two bars
    // repeating for the whole duration instead of the song — the same silent
    // failure the offset reset above was written to end (#1371), one field
    // later: the file is valid, full-length and not silent.
    //
    // Restored in the `finally` below, not left cleared: rewinding is what the
    // user asked for, disarming their locators is not.
    const loopBeforeBounce = engine.getLoopRange?.() ?? null
    if (loopBeforeBounce) engine.setLoopRange?.(null)

    const { error } = await this.play()
    if (error) throw error

    try {
      // Signalled AFTER the settle and the play, so a progress display measures
      // the capture rather than the preparation.
      onCaptureStart?.()
      return await engine.record(seconds, signal)
    } finally {
      this.stop()
      // Give the locators back — including when the capture threw or was
      // aborted, which is why this sits with the stop rather than after it.
      if (loopBeforeBounce) engine.setLoopRange?.(loopBeforeBounce)
    }
  }

  stop(): void {
    // Invalidate any in-flight play() so it aborts after its await instead of
    // restarting the scheduler we're about to stop (#811). Bump first, before
    // any early-return, so the guard can't be skipped.
    this.playGeneration++
    if (this.isDisposed) return

    const wasPlaying = this.isPlayingState

    // Stop the engine UNCONDITIONALLY — do NOT gate on isPlayingState. A
    // play()/stop() race can leave the scheduler running while isPlayingState
    // reads `false` (#811); the old `if (!isPlayingState) return` made Stop a
    // permanent no-op in exactly that state, so audio played forever and the
    // transport button (bound to isPlayingState) never issued another stop.
    // scheduler.stop() is idempotent and repl is optional-chained, so calling
    // it when already stopped / never initialized is safe.
    try {
      this.engine.stop()
    } finally {
      // Always unpublish, even if engine.stop throws — leaving a phantom
      // entry on the bus is worse than swallowing a stop error.
      workspaceAudioBus.unpublish(this.fileId)
      // Fire the transition listeners only on a real playing→stopped edge so
      // idempotent double-stops don't spam a redundant `false`. In the race
      // case wasPlaying is already false and the UI already reads stopped —
      // the load-bearing recovery is engine.stop() above, not the event.
      if (wasPlaying) {
        this.isPlayingState = false
        this.firePlayingChanged(false)
        // Notify the coordinator AFTER we've marked ourselves stopped
        // so any listeners see a consistent state.
        notifyPlaybackStopped(this.fileId)
      }
      // Live mode: tear down the subscription but keep autoRefreshEnabled
      // as-is so a subsequent play() re-installs it. Matches the legacy
      // LiveCodingEditor behavior where toggling Stop doesn't flip the
      // live mode LED.
      this.reconcileAutoRefresh()
    }
  }

  dispose(): void {
    if (this.isDisposed) return
    // Order matters: stop first (which unpublishes), then release the
    // elevated scheduler, then dispose the engine. Reversing would leak
    // a HapStream subscription on the BufferedScheduler if the engine
    // disposes its HapStream first.
    try {
      this.stop()
    } catch {
      // Swallow stop errors during dispose — we're tearing down anyway.
    }
    // Live mode teardown — stop() already reconciled, but if the subscriber
    // survives (e.g., autoRefreshEnabled=false but timeout pending), we
    // clear it unconditionally here. Setting autoRefreshEnabled=false
    // BEFORE reconcile guarantees the reconcile tears down any leftover.
    this.autoRefreshEnabled = false
    this.reconcileAutoRefresh()
    this.bufferedSchedulerRef?.dispose()
    this.bufferedSchedulerRef = null
    try {
      this.engine.dispose()
    } catch {
      // Same reason — best effort.
    }
    this.isDisposed = true
    this.errorListeners.clear()
    this.playingChangedListeners.clear()
    this.evaluateSuccessListeners.clear()
    this.autoRefreshChangedListeners.clear()
    // Remove from the playback coordinator so a future
    // `notifyPlaybackStarted` from another source doesn't try to
    // call our stop() on a disposed runtime.
    try {
      this.unregisterFromPlaybackCoordinator()
    } catch {
      // Non-fatal.
    }
  }

  // -------------------------------------------------------------------------
  // Live mode (autoRefresh) — setters, getters, listener, reconciliation.
  // -------------------------------------------------------------------------

  /**
   * Enable or disable live mode for this runtime.
   *
   * When enabled AND the runtime is currently playing AND a
   * `subscribeToFile` function was provided at construction time, the
   * runtime installs a subscription on the workspace file that
   * debounce-triggers `play()` (which re-evaluates the current content)
   * on every content change.
   *
   * When disabled or stopped, the subscription is torn down and any
   * pending debounce timeout is cleared — so toggling OFF mid-burst is
   * immediate, not "finish the pending re-play first."
   *
   * Idempotent — calling with the already-set value is a no-op and does
   * not fire the `onAutoRefreshChanged` listeners. Never throws; disposed
   * runtimes silently ignore the call.
   */
  setAutoRefresh(enabled: boolean): void {
    if (this.isDisposed) return
    if (this.autoRefreshEnabled === enabled) return
    this.autoRefreshEnabled = enabled
    this.reconcileAutoRefresh()
    this.fireAutoRefreshChanged(enabled)
  }

  /** Current live-mode state. */
  isAutoRefreshEnabled(): boolean {
    return this.autoRefreshEnabled
  }

  /**
   * Subscribe to live-mode state changes. Fires after `setAutoRefresh`
   * mutations, with the new enabled value. Returns an idempotent
   * unsubscribe. Used by the chrome to re-render the live-mode toggle
   * without having to poll.
   */
  onAutoRefreshChanged(cb: (enabled: boolean) => void): () => void {
    this.autoRefreshChangedListeners.add(cb)
    let unsubscribed = false
    return () => {
      if (unsubscribed) return
      unsubscribed = true
      this.autoRefreshChangedListeners.delete(cb)
    }
  }

  /**
   * Install or tear down the file-content subscription so that its
   * presence matches `(autoRefreshEnabled && isPlayingState &&
   * subscribeToFile !== null)`. Called from `setAutoRefresh`, `play`,
   * `stop`, and `dispose`.
   *
   * Installing the subscription is idempotent — calling reconcile while
   * already subscribed is a no-op. Tearing down is likewise idempotent.
   */
  private reconcileAutoRefresh(): void {
    const shouldBeActive =
      this.autoRefreshEnabled &&
      this.isPlayingState &&
      this.subscribeToFile !== null &&
      !this.isDisposed

    if (shouldBeActive && !this.autoRefreshUnsub) {
      this.autoRefreshUnsub = (this.subscribeToFile as SubscribeToRuntimeFile)(
        () => this.onLiveModeContentChanged(),
      )
      return
    }

    if (!shouldBeActive && this.autoRefreshUnsub) {
      const unsub = this.autoRefreshUnsub
      this.autoRefreshUnsub = null
      try {
        unsub()
      } catch {
        // Best-effort — a broken unsubscribe shouldn't crash stop/dispose.
      }
      if (this.autoRefreshTimeout) {
        clearTimeout(this.autoRefreshTimeout)
        this.autoRefreshTimeout = null
      }
    }
  }

  /**
   * Debounced re-evaluate trigger. Called by the file subscription
   * callback on every content change. Cancels any pending timeout and
   * schedules a new one; when it fires, checks the invariants once more
   * (dispose/stop/toggle-off may have happened mid-debounce) and calls
   * `play()` to re-evaluate and re-schedule.
   */
  private onLiveModeContentChanged(): void {
    if (this.autoRefreshTimeout) clearTimeout(this.autoRefreshTimeout)
    this.autoRefreshTimeout = setTimeout(() => {
      this.autoRefreshTimeout = null
      if (this.isDisposed) return
      if (!this.autoRefreshEnabled) return
      if (!this.isPlayingState) return
      // play() resolves on its own tick — we don't need to await it
      // because any error will surface via the onError listeners the
      // chrome/editor already subscribe to. This keeps the timeout
      // callback synchronous and cheap.
      void this.play()
    }, LIVE_MODE_DEBOUNCE_MS)
  }

  private fireAutoRefreshChanged(enabled: boolean): void {
    if (this.autoRefreshChangedListeners.size === 0) return
    const snapshot = Array.from(this.autoRefreshChangedListeners)
    for (const cb of snapshot) {
      try {
        cb(enabled)
      } catch {
        // Listener exceptions never break the dispatch loop.
      }
    }
  }

  onError(cb: (err: Error) => void): () => void {
    this.errorListeners.add(cb)
    let unsubscribed = false
    return () => {
      if (unsubscribed) return
      unsubscribed = true
      this.errorListeners.delete(cb)
    }
  }

  onPlayingChanged(cb: (playing: boolean) => void): () => void {
    this.playingChangedListeners.add(cb)
    let unsubscribed = false
    return () => {
      if (unsubscribed) return
      unsubscribed = true
      this.playingChangedListeners.delete(cb)
    }
  }

  /** Fires after each clean evaluate. The callback receives the EXACT source
   *  string that was evaluated (post eval-source transform), captured at eval
   *  time — so consumers don't have to re-read a lagging file snapshot (#583). */
  onEvaluateSuccess(cb: (code: string) => void): () => void {
    this.evaluateSuccessListeners.add(cb)
    let unsubscribed = false
    return () => {
      if (unsubscribed) return
      unsubscribed = true
      this.evaluateSuccessListeners.delete(cb)
    }
  }

  getBpm(): number | undefined {
    return this.currentBpm
  }

  /**
   * The tempo the engine is actually running at, in cycles per second, or
   * `null` when the engine cannot report one (not initialised, or not a
   * Strudel engine).
   *
   * ⚠ THIS IS NOT `getBpm()` IN OTHER UNITS. `getBpm()` returns
   * `extractBpmFromCode`, a regex over the source that matches only a literal
   * `setcps(...)`; it is `undefined` for a document that sets no tempo, that
   * uses `setcpm(...)`, or that changes cps mid-pattern — none of which mean
   * the music has no tempo. Anything converting CYCLES to SECONDS must use
   * this and not the readout, or it will size a document by a number the
   * source text happened to spell. See `StrudelEngine.getCps`.
   *
   * Duck-typed on the engine for the same reason `record`/`canRecord` are
   * (#1346): the capability is Strudel-specific and the engine interface is
   * shared with runtimes that have no scheduler at all.
   */
  getCps(): number | null {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fn = (this.engine as any)?.getCps
    if (typeof fn !== 'function') return null
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const v = fn.call(this.engine)
    return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null
  }

  /**
   * Current cycle position from the engine's pattern scheduler, or `null`
   * when the scheduler is unavailable (engine not initialized, transport
   * stopped, non-Strudel runtime). The IR Inspector timeline strip's
   * per-tick tooltip falls back to wall-clock when this returns `null`.
   *
   * Phase 19-08 (#85). RESEARCH §2.
   */
  getCurrentCycle(): number | null {
    // Phase 20-12.1 follow-up — gate on isPlayingState. Strudel's
    // scheduler keeps returning the last cycle value after stop, so
    // without this gate `getCycle()` never goes null and MusicalTimeline's
    // stop-edge slot-map reset never fires.
    if (!this.isPlayingState) return null
    const v = this.engine.components.queryable?.scheduler?.now()
    return Number.isFinite(v) ? (v as number) : null
  }

  /**
   * #384 — raw scheduler clock, ungated by `isPlayingState`. The seek math
   * needs the live wall-clock cycle at the instant the user clicks. Returns
   * `null` only when the engine exposes no scheduler. Used by
   * `seekTo`/`getSongPosition`.
   */
  private rawSchedulerNow(): number | null {
    const v = this.engine.components.queryable?.scheduler?.now()
    return Number.isFinite(v) ? (v as number) : null
  }

  /**
   * #384 — seek the transport to song-cycle `targetCycle`. Sets the engine's
   * transport offset to `now - targetCycle` (so `songPosition` becomes
   * `targetCycle`) and re-evaluates via `play()` — the existing hot-swap
   * path — which re-applies the `.late(offset)` wrap at the engine's `.p`
   * seam. No-op on engines without `setTransportOffset` (non-Strudel) or
   * before the scheduler exists.
   *
   * AUDIO NOTE: the audible jump is not observable in the test harness — the
   * clock + no-error are; the audio half needs a manual check (design §10).
   */
  async seekTo(targetCycle: number): Promise<{ error: Error | null }> {
    if (!Number.isFinite(targetCycle)) return { error: null }
    const now = this.rawSchedulerNow()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const setOffset = (this.engine as any).setTransportOffset as
      | ((offset: number) => void)
      | undefined
    if (now === null || typeof setOffset !== 'function') return { error: null }
    // #1570 — the offset is decided against the loop frame in force, not by
    // bare subtraction: under a ribbon the scheduler's cycle 0 is the loop's
    // start, so `now - targetCycle` would seek to a cycle nobody asked for.
    // With no loop armed this is `now - targetCycle`, unchanged.
    setOffset.call(this.engine, transportOffsetForSeek(now, targetCycle, this.currentLoopRange()))
    // Re-eval through the normal hot-swap so the wrap takes effect. If we're
    // not playing yet, play() also starts the transport at the sought cycle.
    return this.play()
  }

  /** #1570 — the loop range the engine currently holds (`null` on non-Strudel engines). */
  private currentLoopRange(): LoopRange | null {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const get = (this.engine as any).getLoopRange as (() => LoopRange | null) | undefined
    return typeof get === 'function' ? (get.call(this.engine) ?? null) : null
  }

  /**
   * #1570 — arm a loop over `[startCycle, startCycle + cycles)` song cycles, or
   * clear it with `null`. One re-eval (the existing hot-swap), not one per lap.
   *
   * ⚠ THE RANGE AND THE OFFSET ARE ONE DECISION, MADE HERE. `ribbon` re-bases
   * the looped span to cycle 0, so arming a range alone would leave the playhead
   * reading loop-relative cycles while the ears hear the middle of the song.
   * This sets both, in one place, so `getSongPosition` stays song-absolute —
   * the same pairing `seekTo` already makes for `.late()`, for the same reason.
   *
   * Where playback lands:
   *   · arming while the ears are already INSIDE the new span — stays put, so
   *     the loop closes around the music that is playing rather than jumping;
   *   · arming from outside it — starts at the loop's start, the only other
   *     answer that is predictable;
   *   · clearing — continues from wherever the ears are, now running straight on.
   */
  async setLoopRange(
    range: { startCycle: number; cycles: number } | null,
  ): Promise<{ error: Error | null }> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const engine = this.engine as any
    const setRange = engine.setLoopRange as ((r: LoopRange | null) => void) | undefined
    const setOffset = engine.setTransportOffset as ((offset: number) => void) | undefined
    // Non-Strudel engines have neither — no-op, like `seekTo`.
    if (typeof setRange !== 'function') return { error: null }

    const next = normalizeLoopRange(range)
    const now = this.rawSchedulerNow()
    // Where the ears are under the frame still in force. Read BEFORE the range
    // changes — afterwards the old frame is gone and this number is unrecoverable.
    const before =
      now === null
        ? null
        : songPositionAt(now, engine.getTransportOffset?.() ?? 0, this.currentLoopRange())

    setRange.call(this.engine, next)

    if (now !== null && typeof setOffset === 'function') {
      const target = next
        ? before !== null && isInsideLoop(before, next)
          ? before
          : next.startCycle
        : (before ?? 0)
      setOffset.call(this.engine, transportOffsetForSeek(now, target, next))
    }

    // Stopped: the pair is stored and takes effect at the next play(), exactly
    // as a seek does. Playing: re-eval through the normal hot-swap.
    if (!this.isPlayingState) return { error: null }
    return this.play()
  }

  /**
   * #384 — current SONG position in cycles: the scheduler clock read through
   * the transport frame. `scheduler.now() - transportOffset` with no loop
   * armed; folded into the looped span when one is (#1570), because a ribboned
   * pattern re-bases its slice to cycle 0 and the raw difference would count
   * loop-relative cycles.
   *
   * The full-song timeline playhead reads this (vs `getCurrentCycle`'s raw
   * window clock). Gated on `isPlayingState` like `getCurrentCycle` so the
   * playhead clears on stop. `null` on non-Strudel engines / when stopped.
   */
  getSongPosition(): number | null {
    if (!this.isPlayingState) return null
    const now = this.rawSchedulerNow()
    if (now === null) return null
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const offset = (this.engine as any).getTransportOffset?.() ?? 0
    // #1570 — read back through the transport frame, not by bare subtraction.
    // With a loop armed the engine's pattern is ribboned, so `now - offset`
    // counts LOOP-relative cycles: the playhead would sit at the top of the song
    // while the ears hear the middle of it. `songPositionAt` folds it back into
    // the span the audio is actually sounding. With no loop this is unchanged.
    return songPositionAt(now, offset, this.currentLoopRange())
  }

  /**
   * Engine-owned HapStream, or `null` when the engine doesn't expose one
   * (non-Strudel runtimes / not yet initialized). Mirrors `getCurrentCycle`'s
   * shape — read-through accessor over the engine's components.
   *
   * Phase 20-06 — consumed by MusicalTimeline (closure-bound accessor pattern
   * via StrudelEditorClient → StaveApp's `getHapStreamRef`) so the timeline
   * can subscribe to live hap dispatch and glow rows on real fires
   * (PV38 / PK13 step 8 — musician half).
   */
  getHapStream(): HapStream | null {
    return this.engine.components.streaming?.hapStream ?? null
  }

  /**
   * Evaluated note events over `[0, ceil(cycles))` for the Song timeline's
   * DISPLAY marks (#861) — read-through accessor over the engine's per-track
   * schedulers, mirroring `getHapStream`'s shape. Returns `[]` for non-Strudel
   * runtimes / not-yet-evaluated engines (optional-chained delegate). The IR
   * (structure) stays the timeline's source of truth; only note pitch/scale
   * comes from here, where Strudel has already resolved it (PV174).
   */
  getTimelineEvents(cycles: number): IREvent[] {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (this.engine as any).getTimelineEvents?.(cycles) ?? []
  }

  /**
   * The same events over a BAND `[startCycle, endCycle)` rather than a prefix
   * from zero (#1197) — read-through in the same shape, from the same engine, so
   * the two can never describe different frames. `[]` for a non-Strudel runtime.
   *
   * Consumed by the Song analysis collector, which walks adjacent bands as the
   * progressive horizon grows. ⚠ That caller must keep dropping haps whose
   * `floor(begin)` precedes its band — `queryArc` returns overlaps, and analysis
   * buckets by `floor(begin)`, so an onset straddling a band boundary would
   * otherwise be counted in both. The engine's own doc carries the full argument.
   */
  getTimelineEventsBand(startCycle: number, endCycle: number): IREvent[] {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const engine = this.engine as any
    if (typeof engine.getTimelineEventsBand === 'function') {
      return engine.getTimelineEventsBand(startCycle, endCycle)
    }
    // ⚠ FALL BACK TO THE PREFIX ACCESSOR, never to `[]`. An engine that
    // implements `getTimelineEvents` but not the band form is the one case where
    // optional-chaining to `[]` would be actively WRONG rather than merely
    // uninformative: the caller asked an engine that HAS the events and got
    // silence, so the analysis sees no onsets and the Song view draws blank —
    // no error, no warning. `[]` is the right answer only for a runtime with no
    // event source at all, and the prefix accessor already returns exactly that
    // for one. The caller filters to its band regardless, so this is correct,
    // just as expensive as before the band existed.
    return engine.getTimelineEvents?.(endCycle) ?? []
  }

  /**
   * The capture keys behind those events (#1107) — read-through in the same
   * shape, from the same engine, so the two can never describe different track
   * sets. Lets the Song analysis tell "this track has not played yet" from
   * "there is no such track", which is the difference between a period that
   * describes the whole song and one that erases the tracks it has not heard.
   * `[]` for a non-Strudel runtime, which correctly claims nothing.
   */
  getSongTrackIds(): string[] {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (this.engine as any).getSongTrackIds?.() ?? []
  }

  /**
   * Backdrop viz requested by a non-underscore Strudel viz method
   * (e.g. `.scope()`, `.pianoroll()`) during the last evaluate, or `null`.
   * Read-through accessor over the engine's components, mirroring
   * `getHapStream`. Consumed by StrudelEditorClient → StaveApp, which maps
   * the resolved renderer id to a project viz file and pins it as the
   * backdrop (the "set bg" UI then auto-updates from `backgroundFileId`).
   */
  getBackdropVizRequest(): string | null {
    return this.engine.components.inlineViz?.backdropRequest?.vizId ?? null
  }

  // -------------------------------------------------------------------------
  // Phase 20-07 — debugger pause/resume + BreakpointStore accessor.
  //
  // Mirror of the 20-06 `getHapStream` accessor pattern: the engine owns
  // the state, the runtime is a thin pass-through. Optional-chained
  // delegates via `?.()` so non-Strudel runtimes (DemoEngine, SonicPi)
  // that don't implement these methods are no-ops, not exceptions
  // (LiveCodingEngine interface keeps them unrequired in v1).
  // -------------------------------------------------------------------------

  /** Phase 20-07 — explicit user-driven pause. Engine pauses scheduler. */
  pause(): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(this.engine as any).pause?.()
  }

  /** Phase 20-07 — resume after pause (or breakpoint hit). */
  resume(): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(this.engine as any).resume?.()
  }

  /** Phase 20-07 — current debugger pause state (false on engines without pause). */
  getPaused(): boolean {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (this.engine as any).getPaused?.() ?? false
  }

  /**
   * Phase 20-07 — subscribe to engine pause-state transitions. Returns a
   * disposer. No-op disposer when the engine doesn't implement
   * onPausedChanged (non-Strudel runtimes).
   */
  onPausedChanged(listener: (paused: boolean) => void): () => void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (this.engine as any).onPausedChanged?.(listener) ?? (() => {})
  }

  /**
   * Phase 20-07 — accessor onto the engine's BreakpointStore. Returns
   * null when the engine doesn't expose one (non-Strudel runtimes / not
   * yet initialized). Mirrors `getHapStream`'s shape.
   */
  getBreakpointStore(): BreakpointStore | null {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (this.engine as any).getBreakpointStore?.() ?? null
  }

  // -------------------------------------------------------------------------
  // Internal listener dispatchers — snapshot-then-iterate so a listener
  // that unsubscribes itself during the callback doesn't break the loop.
  // -------------------------------------------------------------------------

  private fireOnError(err: Error): void {
    if (this.errorListeners.size === 0) return
    const snapshot = Array.from(this.errorListeners)
    for (const cb of snapshot) {
      try {
        cb(err)
      } catch {
        // Listener exceptions never break the dispatch loop.
      }
    }
  }

  private firePlayingChanged(playing: boolean): void {
    if (this.playingChangedListeners.size === 0) return
    const snapshot = Array.from(this.playingChangedListeners)
    for (const cb of snapshot) {
      try {
        cb(playing)
      } catch {
        // Listener exceptions never break the dispatch loop.
      }
    }
  }

  private fireEvaluateSuccess(code: string): void {
    if (this.evaluateSuccessListeners.size === 0) return
    const snapshot = Array.from(this.evaluateSuccessListeners)
    for (const cb of snapshot) {
      try {
        cb(code)
      } catch {
        // Listener exceptions never break the dispatch loop.
      }
    }
  }
}
