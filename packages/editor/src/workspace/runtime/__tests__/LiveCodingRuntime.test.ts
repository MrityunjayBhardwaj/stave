/**
 * LiveCodingRuntime — unit tests (Phase 10.2 Task 05).
 *
 * Covers the play lifecycle (PK1), BufferedScheduler elevation (S8), error
 * pathways (S7), bus publish/unpublish, dispose ordering, and the
 * `Pattern.prototype` source-grep guard (PV2 / P2 mitigation from PLAN.md
 * §10.2-05 pre-mortem).
 *
 * The engine is mocked with a controllable shape so the runtime's wiring
 * is tested in isolation. Real engines (Strudel, SonicPi) carry too much
 * environment-specific setup (audio context, web workers, CDN imports) to
 * exercise inside a unit test — they're observed end-to-end in Task 10's
 * Lokayata pass.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { LiveCodingRuntime, extractBpmFromCode } from '../LiveCodingRuntime'
import {
  workspaceAudioBus,
  __resetWorkspaceAudioBusForTests,
} from '../../WorkspaceAudioBus'
import { HapStream } from '../../../engine/HapStream'
import type {
  EngineComponents,
  LiveCodingEngine,
} from '../../../engine/LiveCodingEngine'
import type { AudioPayload } from '../../types'

// ---------------------------------------------------------------------------
// Mock engine factory — returns a LiveCodingEngine implementation backed by
// vi.fn() spies. The components getter returns whatever the test installs
// via `setComponents`. The engine's lifecycle methods record their call
// order so the test can assert publish-before-play AND evaluate-before-read.
// ---------------------------------------------------------------------------

// Spies are typed loosely so the strict generic on `vi.fn<Params, Return>`
// doesn't fight the LiveCodingEngine signature; the test only ever inspects
// `mock.calls` and `mock.calls.length`, neither of which depends on the
// generic.
type AnySpy = ReturnType<typeof vi.fn>

interface MockEngine extends LiveCodingEngine {
  callLog: string[]
  setComponents(c: Partial<EngineComponents>): void
  setEvalResult(r: { error?: Error }): void
  triggerRuntimeError(err: Error): void
  evaluateCalls: string[]
  initFn: AnySpy
  evaluateFn: AnySpy
  playFn: AnySpy
  stopFn: AnySpy
  disposeFn: AnySpy
}

function createMockEngine(): MockEngine {
  let components: Partial<EngineComponents> = {}
  let evalResult: { error?: Error } = {}
  let runtimeErrorHandler: ((err: Error) => void) | null = null
  const callLog: string[] = []
  const evaluateCalls: string[] = []

  const initFn = vi.fn(async () => {
    callLog.push('init')
  })
  const evaluateFn = vi.fn(async (code: string) => {
    callLog.push('evaluate')
    evaluateCalls.push(code)
    return evalResult
  })
  const playFn = vi.fn(() => {
    callLog.push('play')
  })
  const stopFn = vi.fn(() => {
    callLog.push('stop')
  })
  const disposeFn = vi.fn(() => {
    callLog.push('dispose')
  })

  const engine: MockEngine = {
    callLog,
    evaluateCalls,
    initFn: initFn as unknown as AnySpy,
    evaluateFn: evaluateFn as unknown as AnySpy,
    playFn: playFn as unknown as AnySpy,
    stopFn: stopFn as unknown as AnySpy,
    disposeFn: disposeFn as unknown as AnySpy,
    init: initFn,
    evaluate: evaluateFn,
    play: playFn,
    stop: stopFn,
    dispose: disposeFn,
    get components() {
      return components
    },
    setComponents(c) {
      components = c
    },
    setEvalResult(r) {
      evalResult = r
    },
    triggerRuntimeError(err) {
      runtimeErrorHandler?.(err)
    },
    setRuntimeErrorHandler(handler) {
      runtimeErrorHandler = handler
    },
  }
  return engine
}

// Real HapStream for streaming — the runtime's BufferedScheduler elevation
// path subscribes to `hapStream.on(handler)`, so a sentinel object without
// the `on` method would crash the elevation. HapStream is a plain
// in-memory event bus with no audio dependencies; instantiating one is safe
// in any environment.
function makeStreamingComponent(): EngineComponents['streaming'] {
  return {
    hapStream: new HapStream(),
  }
}
// Stub AudioContext — BufferedScheduler reads `audioCtx.currentTime` for
// its rolling-buffer eviction logic. A plain object with a numeric
// `currentTime` getter is enough; no real Web Audio nodes needed.
function makeAudioComponent(): EngineComponents['audio'] {
  return {
    analyser: { __tag: 'analyser' } as unknown as AnalyserNode,
    audioCtx: { currentTime: 0 } as unknown as AudioContext,
  }
}
function makeQueryableComponent(): EngineComponents['queryable'] {
  return {
    scheduler: {
      now: () => 0,
      query: () => [],
    },
    trackSchedulers: new Map(),
  }
}
function makeInlineVizComponent(): EngineComponents['inlineViz'] {
  return {
    vizRequests: new Map([
      ['$0', { vizId: 'pianoroll', afterLine: 3 }],
    ]),
  }
}

describe('LiveCodingRuntime', () => {
  beforeEach(() => {
    __resetWorkspaceAudioBusForTests()
  })

  // -------------------------------------------------------------------------
  // play() lifecycle (PK1)
  // -------------------------------------------------------------------------

  describe('play() lifecycle', () => {
    it('init → evaluate → publish → play in order, with publish BEFORE play', async () => {
      const engine = createMockEngine()
      engine.setComponents({
        streaming: makeStreamingComponent(),
        audio: makeAudioComponent(),
        queryable: makeQueryableComponent(),
      })
      const runtime = new LiveCodingRuntime(
        'file-1',
        engine,
        () => 'note("c3").s("sine")',
      )

      let publishObservedAt: number | null = null
      const offBus = workspaceAudioBus.subscribe(
        { kind: 'file', fileId: 'file-1' },
        (payload) => {
          if (payload) {
            publishObservedAt = engine.callLog.length
          }
        },
      )

      const result = await runtime.play()
      expect(result.error).toBeNull()

      // The lifecycle the runtime ran:
      expect(engine.callLog).toEqual(['init', 'evaluate', 'play'])

      // The bus saw the publish AFTER evaluate but BEFORE play. The
      // call log was 2 entries deep (init, evaluate) at publish time —
      // play() is appended to the log after publish returns.
      expect(publishObservedAt).toBe(2)
      offBus()
    })

    it('passes the file content unchanged into engine.evaluate (P1)', async () => {
      const engine = createMockEngine()
      engine.setComponents({
        streaming: makeStreamingComponent(),
        audio: makeAudioComponent(),
      })
      const code = '$: note("c3 e3 g3").s("sine") // .viz("pianoroll")'
      const runtime = new LiveCodingRuntime('file-1', engine, () => code)
      await runtime.play()
      expect(engine.evaluateCalls).toEqual([code])
    })

    it('publishes the engine component bag onto the bus under the file id', async () => {
      const engine = createMockEngine()
      const streaming = makeStreamingComponent()
      const audio = makeAudioComponent()
      const queryable = makeQueryableComponent()
      const inlineViz = makeInlineVizComponent()
      engine.setComponents({ streaming, audio, queryable, inlineViz })
      const runtime = new LiveCodingRuntime('file-1', engine, () => 'code')

      let received: AudioPayload | null = null
      workspaceAudioBus.subscribe(
        { kind: 'file', fileId: 'file-1' },
        (p) => {
          if (p) received = p
        },
      )

      await runtime.play()
      expect(received).not.toBeNull()
      expect(received!.hapStream).toBe(streaming.hapStream)
      expect(received!.analyser).toBe(audio.analyser)
      expect(received!.scheduler).toBe(queryable.scheduler)
      expect(received!.inlineViz).toBe(inlineViz)
      expect(received!.audio).toBe(audio)
    })

    it('listSources contains the file id while playing', async () => {
      const engine = createMockEngine()
      engine.setComponents({
        streaming: makeStreamingComponent(),
        audio: makeAudioComponent(),
      })
      const runtime = new LiveCodingRuntime('file-1', engine, () => 'code')
      await runtime.play()
      const sources = workspaceAudioBus.listSources()
      expect(sources).toHaveLength(1)
      expect(sources[0].sourceId).toBe('file-1')
      expect(sources[0].playing).toBe(true)
    })

    it('skips init() on a second play if already initialized', async () => {
      const engine = createMockEngine()
      engine.setComponents({
        streaming: makeStreamingComponent(),
        audio: makeAudioComponent(),
      })
      const runtime = new LiveCodingRuntime('file-1', engine, () => 'code')
      await runtime.play()
      runtime.stop()
      await runtime.play()
      // init only fired once, evaluate fired twice
      const initCount = engine.callLog.filter((c) => c === 'init').length
      const evalCount = engine.callLog.filter((c) => c === 'evaluate').length
      expect(initCount).toBe(1)
      expect(evalCount).toBe(2)
    })
  })

  // -------------------------------------------------------------------------
  // BufferedScheduler elevation (S8)
  // -------------------------------------------------------------------------

  describe('BufferedScheduler elevation (S8)', () => {
    it('elevates a BufferedScheduler when streaming + audio exist but queryable does not', async () => {
      const engine = createMockEngine()
      engine.setComponents({
        streaming: makeStreamingComponent(),
        audio: makeAudioComponent(),
        // no queryable
      })
      const runtime = new LiveCodingRuntime('file-1', engine, () => 'code')

      let received: AudioPayload | null = null
      workspaceAudioBus.subscribe(
        { kind: 'file', fileId: 'file-1' },
        (p) => {
          if (p) received = p
        },
      )

      await runtime.play()
      expect(received).not.toBeNull()
      // Elevated scheduler is present...
      expect(received!.scheduler).toBeDefined()
      // ...and it has the IRPattern shape (now/query) — the BufferedScheduler.
      expect(typeof received!.scheduler!.now).toBe('function')
      expect(typeof received!.scheduler!.query).toBe('function')
    })

    it('uses the native scheduler directly when queryable is present', async () => {
      const engine = createMockEngine()
      const queryable = makeQueryableComponent()
      engine.setComponents({
        streaming: makeStreamingComponent(),
        audio: makeAudioComponent(),
        queryable,
      })
      const runtime = new LiveCodingRuntime('file-1', engine, () => 'code')

      let received: AudioPayload | null = null
      workspaceAudioBus.subscribe(
        { kind: 'file', fileId: 'file-1' },
        (p) => {
          if (p) received = p
        },
      )

      await runtime.play()
      // The forwarded scheduler IS the native one — reference identity.
      expect(received!.scheduler).toBe(queryable.scheduler)
    })

    it('does not elevate when audio is missing (no audioCtx for BufferedScheduler)', async () => {
      const engine = createMockEngine()
      engine.setComponents({
        streaming: makeStreamingComponent(),
        // no audio, no queryable
      })
      const runtime = new LiveCodingRuntime('file-1', engine, () => 'code')

      let received: AudioPayload | null = null
      workspaceAudioBus.subscribe(
        { kind: 'file', fileId: 'file-1' },
        (p) => {
          if (p) received = p
        },
      )

      await runtime.play()
      expect(received).not.toBeNull()
      expect(received!.scheduler).toBeUndefined()
    })
  })

  // -------------------------------------------------------------------------
  // Error pathways (S7)
  // -------------------------------------------------------------------------

  describe('error pathways (S7)', () => {
    it('does NOT publish, does NOT call play, fires onError on evaluate failure', async () => {
      const engine = createMockEngine()
      engine.setComponents({
        streaming: makeStreamingComponent(),
        audio: makeAudioComponent(),
      })
      const evalError = new Error('parse error: unexpected token')
      engine.setEvalResult({ error: evalError })

      const runtime = new LiveCodingRuntime('file-1', engine, () => 'bad code')
      const errorListener = vi.fn()
      runtime.onError(errorListener)

      const result = await runtime.play()
      expect(result.error).toBe(evalError)
      expect(errorListener).toHaveBeenCalledTimes(1)
      expect(errorListener).toHaveBeenCalledWith(evalError)
      // engine.play was never called
      expect(engine.playFn).not.toHaveBeenCalled()
      // bus has no publisher for this file
      expect(workspaceAudioBus.consume({ kind: 'file', fileId: 'file-1' })).toBeNull()
    })

    it('forwards engine runtime errors (sound-not-found etc.) through onError', async () => {
      const engine = createMockEngine()
      engine.setComponents({
        streaming: makeStreamingComponent(),
        audio: makeAudioComponent(),
      })
      const runtime = new LiveCodingRuntime('file-1', engine, () => 'code')
      const errorListener = vi.fn()
      runtime.onError(errorListener)

      await runtime.play()
      const audioErr = new Error('sound dx7 not found')
      engine.triggerRuntimeError(audioErr)
      expect(errorListener).toHaveBeenCalledWith(audioErr)
    })

    it('onError unsubscribe is idempotent and removes the listener', async () => {
      const engine = createMockEngine()
      engine.setComponents({
        streaming: makeStreamingComponent(),
        audio: makeAudioComponent(),
      })
      const runtime = new LiveCodingRuntime('file-1', engine, () => 'code')
      const errorListener = vi.fn()
      const off = runtime.onError(errorListener)
      off()
      off() // double-unsubscribe is safe
      engine.triggerRuntimeError(new Error('boom'))
      expect(errorListener).not.toHaveBeenCalled()
    })

    // Regression for #26 — live-mode clears error after a fix.
    it('fires onEvaluateSuccess when play() evaluates cleanly so clients can clear stale error state', async () => {
      const engine = createMockEngine()
      engine.setComponents({
        streaming: makeStreamingComponent(),
        audio: makeAudioComponent(),
      })
      const runtime = new LiveCodingRuntime('file-1', engine, () => 'code')
      const successListener = vi.fn()
      runtime.onEvaluateSuccess(successListener)

      // First play: clean eval → fires success.
      const r1 = await runtime.play()
      expect(r1.error).toBeNull()
      expect(successListener).toHaveBeenCalledTimes(1)

      // Simulate live-mode re-eval with a syntax error.
      engine.setEvalResult({ error: new Error('parse error') })
      const r2 = await runtime.play()
      expect(r2.error).not.toBeNull()
      expect(successListener).toHaveBeenCalledTimes(1) // not re-fired on failure

      // User fixes the syntax — next re-eval succeeds → fires again.
      engine.setEvalResult({ error: undefined })
      const r3 = await runtime.play()
      expect(r3.error).toBeNull()
      expect(successListener).toHaveBeenCalledTimes(2)
    })

    it('onEvaluateSuccess unsubscribe is idempotent', async () => {
      const engine = createMockEngine()
      engine.setComponents({
        streaming: makeStreamingComponent(),
        audio: makeAudioComponent(),
      })
      const runtime = new LiveCodingRuntime('file-1', engine, () => 'code')
      const listener = vi.fn()
      const off = runtime.onEvaluateSuccess(listener)
      off()
      off()
      await runtime.play()
      expect(listener).not.toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  // stop() / dispose()
  // -------------------------------------------------------------------------

  describe('stop() and dispose()', () => {
    it('stop() calls engine.stop and unpublishes from the bus', async () => {
      const engine = createMockEngine()
      engine.setComponents({
        streaming: makeStreamingComponent(),
        audio: makeAudioComponent(),
      })
      const runtime = new LiveCodingRuntime('file-1', engine, () => 'code')
      await runtime.play()
      expect(workspaceAudioBus.listSources()).toHaveLength(1)

      runtime.stop()
      expect(engine.stopFn).toHaveBeenCalled()
      expect(workspaceAudioBus.listSources()).toHaveLength(0)
    })

    it('stop() fires onPlayingChanged(false) after a successful play()', async () => {
      const engine = createMockEngine()
      engine.setComponents({
        streaming: makeStreamingComponent(),
        audio: makeAudioComponent(),
      })
      const runtime = new LiveCodingRuntime('file-1', engine, () => 'code')
      const playingListener = vi.fn()
      runtime.onPlayingChanged(playingListener)
      await runtime.play()
      expect(playingListener).toHaveBeenLastCalledWith(true)
      runtime.stop()
      expect(playingListener).toHaveBeenLastCalledWith(false)
    })

    it('stop() is idempotent — second call does not throw or re-fire listeners', async () => {
      const engine = createMockEngine()
      engine.setComponents({
        streaming: makeStreamingComponent(),
        audio: makeAudioComponent(),
      })
      const runtime = new LiveCodingRuntime('file-1', engine, () => 'code')
      const playingListener = vi.fn()
      runtime.onPlayingChanged(playingListener)
      await runtime.play()
      runtime.stop()
      const callCountAfterFirstStop = playingListener.mock.calls.length
      runtime.stop()
      expect(playingListener.mock.calls.length).toBe(callCountAfterFirstStop)
    })

    // -----------------------------------------------------------------------
    // #811 — Stop during an in-flight play(). A live re-eval (mixer/knob edit)
    // fires play(), which parks on `await engine.evaluate()`. The user presses
    // Stop mid-await. Before the fix, the in-flight play() resumed and started
    // the scheduler AFTER Stop, leaving audio running while isPlayingState read
    // false — the transport button (bound to isPlayingState) could never issue
    // another stop, so audio played forever.
    // -----------------------------------------------------------------------
    it('stop() during an in-flight play() aborts the start — scheduler is NOT restarted (#811)', async () => {
      const engine = createMockEngine()
      engine.setComponents({
        streaming: makeStreamingComponent(),
        audio: makeAudioComponent(),
      })
      // Gate evaluate on an external deferred so Stop can land while play() is
      // parked on `await engine.evaluate(...)`.
      let releaseEvaluate!: () => void
      const evaluateGate = new Promise<void>((res) => {
        releaseEvaluate = res
      })
      const originalEvaluate = engine.evaluate
      engine.evaluate = vi.fn(async (code: string) => {
        await evaluateGate
        return originalEvaluate(code)
      }) as typeof engine.evaluate

      const runtime = new LiveCodingRuntime('file-1', engine, () => 'code')

      // 1. Start play() without awaiting — it parks on the evaluate gate.
      const playPromise = runtime.play()
      // Flush microtasks so play() reaches and parks on the gate.
      await new Promise((r) => setTimeout(r, 0))

      // 2. Stop lands while play() is mid-evaluate.
      runtime.stop()

      // 3. Release evaluate; the in-flight play() resumes and hits the gate.
      releaseEvaluate()
      await playPromise

      // The scheduler was NEVER started after Stop — play() bailed at the
      // supersession gate before step 8.
      expect(engine.callLog).not.toContain('play')
      // Runtime reads stopped and the bus holds no phantom source.
      expect(runtime.getIsPlaying()).toBe(false)
      expect(workspaceAudioBus.listSources()).toHaveLength(0)
    })

    it('stop() always reaches engine.stop() even when isPlayingState is false (authoritative stop, #811)', () => {
      const engine = createMockEngine()
      const runtime = new LiveCodingRuntime('file-1', engine, () => 'code')
      // Never played → isPlayingState is false. The old code early-returned
      // here WITHOUT calling engine.stop(); the fix always reaches it so a
      // desynced-but-running scheduler can always be halted.
      runtime.stop()
      expect(engine.stopFn).toHaveBeenCalled()
    })

    it('dispose() calls stop() AND engine.dispose()', async () => {
      const engine = createMockEngine()
      engine.setComponents({
        streaming: makeStreamingComponent(),
        audio: makeAudioComponent(),
      })
      const runtime = new LiveCodingRuntime('file-1', engine, () => 'code')
      await runtime.play()
      runtime.dispose()
      expect(engine.stopFn).toHaveBeenCalled()
      expect(engine.disposeFn).toHaveBeenCalled()
      expect(workspaceAudioBus.listSources()).toHaveLength(0)
    })

    it('dispose() leaves the bus with zero entries for this file id', async () => {
      const engine = createMockEngine()
      engine.setComponents({
        streaming: makeStreamingComponent(),
        audio: makeAudioComponent(),
      })
      const runtime = new LiveCodingRuntime('file-1', engine, () => 'code')
      await runtime.play()
      runtime.dispose()
      expect(workspaceAudioBus.consume({ kind: 'file', fileId: 'file-1' })).toBeNull()
    })

    it('dispose() is idempotent', async () => {
      const engine = createMockEngine()
      engine.setComponents({
        streaming: makeStreamingComponent(),
        audio: makeAudioComponent(),
      })
      const runtime = new LiveCodingRuntime('file-1', engine, () => 'code')
      await runtime.play()
      runtime.dispose()
      runtime.dispose() // safe
      // engine.dispose only called once
      expect(engine.disposeFn).toHaveBeenCalledTimes(1)
    })
  })

  // -------------------------------------------------------------------------
  // BPM extraction (U8)
  // -------------------------------------------------------------------------

  describe('BPM extraction (U8)', () => {
    it('extractBpmFromCode parses setcps(num/denom) correctly', () => {
      // BPM = cps × 60 × 4 beats/cycle = cps × 240 (#599). For the canonical
      // `/240` preset the numerator reads straight back as the BPM.
      expect(extractBpmFromCode('setcps(120/240)\n$: note("c3")')).toBe(120)
      expect(extractBpmFromCode('setcps(92/240)')).toBe(92) // the reported "23" case
      expect(extractBpmFromCode('setcps(140/60)')).toBe(560) // 2.333 cps × 240
      expect(extractBpmFromCode('setcps(0.5)')).toBe(120) // scalar cps × 240
      expect(extractBpmFromCode('// no setcps here')).toBeUndefined()
    })

    it('runtime.getBpm() returns undefined before play and a number after', async () => {
      const engine = createMockEngine()
      engine.setComponents({
        streaming: makeStreamingComponent(),
        audio: makeAudioComponent(),
      })
      const runtime = new LiveCodingRuntime(
        'file-1',
        engine,
        () => 'setcps(140/60)\n$: note("c3")',
      )
      expect(runtime.getBpm()).toBeUndefined()
      await runtime.play()
      expect(runtime.getBpm()).toBe(560) // setcps(140/60) = 2.333 cps × 240
    })
  })

  // -------------------------------------------------------------------------
  // Live mode (autoRefresh)
  //
  // Covers the reconcile-on-lifecycle-event invariant:
  //
  //   (autoRefreshEnabled && isPlayingState && subscribeToFile) <=>
  //   (subscription is installed)
  //
  // The subscription is observed via a fake `subscribeToFile` callback
  // that records how many subscribers are currently installed. Reconciles
  // happen in setAutoRefresh, play, stop, and dispose — every transition
  // is exercised here so a regression in ONE of the callers can't silently
  // leak a listener.
  // -------------------------------------------------------------------------

  describe('Live mode (autoRefresh)', () => {
    /**
     * Create a subscriber harness that mimics WorkspaceFile.subscribe.
     * Returns both the runtime-facing `subscribeToFile` function and a
     * `fire()` trigger the test can use to simulate a content change.
     */
    function makeSubscribeHarness() {
      const listeners = new Set<() => void>()
      const subscribeToFile = (cb: () => void): (() => void) => {
        listeners.add(cb)
        return () => {
          listeners.delete(cb)
        }
      }
      return {
        subscribeToFile,
        size: () => listeners.size,
        fire: () => {
          for (const cb of Array.from(listeners)) cb()
        },
      }
    }

    function makeRuntimeWithHarness() {
      const engine = createMockEngine()
      engine.setComponents({
        streaming: makeStreamingComponent(),
        audio: makeAudioComponent(),
      })
      const harness = makeSubscribeHarness()
      const runtime = new LiveCodingRuntime(
        'file-1',
        engine,
        () => '$: note("c3")',
        harness.subscribeToFile,
      )
      return { runtime, engine, harness }
    }

    it('defaults to disabled and installs no subscription', () => {
      const { runtime, harness } = makeRuntimeWithHarness()
      expect(runtime.isAutoRefreshEnabled()).toBe(false)
      expect(harness.size()).toBe(0)
    })

    it('setAutoRefresh(true) without play does NOT install a subscription', () => {
      const { runtime, harness } = makeRuntimeWithHarness()
      runtime.setAutoRefresh(true)
      expect(runtime.isAutoRefreshEnabled()).toBe(true)
      // Invariant: subscription is only active when playing.
      expect(harness.size()).toBe(0)
    })

    it('play + setAutoRefresh(true) installs exactly one subscription', async () => {
      const { runtime, harness } = makeRuntimeWithHarness()
      await runtime.play()
      runtime.setAutoRefresh(true)
      expect(harness.size()).toBe(1)
    })

    it('setAutoRefresh(true) + play installs the subscription on play', async () => {
      const { runtime, harness } = makeRuntimeWithHarness()
      runtime.setAutoRefresh(true)
      expect(harness.size()).toBe(0) // not yet
      await runtime.play()
      expect(harness.size()).toBe(1)
    })

    it('stop() tears down the subscription but keeps the enabled flag', async () => {
      const { runtime, harness } = makeRuntimeWithHarness()
      await runtime.play()
      runtime.setAutoRefresh(true)
      expect(harness.size()).toBe(1)
      runtime.stop()
      expect(harness.size()).toBe(0)
      // The LED stays on so a subsequent play() re-arms automatically.
      expect(runtime.isAutoRefreshEnabled()).toBe(true)
    })

    it('re-play after stop re-installs the subscription', async () => {
      const { runtime, harness } = makeRuntimeWithHarness()
      await runtime.play()
      runtime.setAutoRefresh(true)
      runtime.stop()
      await runtime.play()
      expect(harness.size()).toBe(1)
    })

    it('setAutoRefresh(false) mid-play tears down immediately', async () => {
      const { runtime, harness } = makeRuntimeWithHarness()
      await runtime.play()
      runtime.setAutoRefresh(true)
      expect(harness.size()).toBe(1)
      runtime.setAutoRefresh(false)
      expect(harness.size()).toBe(0)
    })

    it('setAutoRefresh is idempotent and does not re-subscribe', async () => {
      const { runtime, harness } = makeRuntimeWithHarness()
      await runtime.play()
      runtime.setAutoRefresh(true)
      runtime.setAutoRefresh(true)
      runtime.setAutoRefresh(true)
      expect(harness.size()).toBe(1)
    })

    it('dispose() clears the subscription even if autoRefresh was on', async () => {
      const { runtime, harness } = makeRuntimeWithHarness()
      await runtime.play()
      runtime.setAutoRefresh(true)
      expect(harness.size()).toBe(1)
      runtime.dispose()
      expect(harness.size()).toBe(0)
    })

    it('onAutoRefreshChanged fires on every transition', () => {
      const { runtime } = makeRuntimeWithHarness()
      const calls: boolean[] = []
      runtime.onAutoRefreshChanged((v) => calls.push(v))
      runtime.setAutoRefresh(true)
      runtime.setAutoRefresh(true) // idempotent — no fire
      runtime.setAutoRefresh(false)
      expect(calls).toEqual([true, false])
    })

    it('file-content change triggers debounced re-play after 500ms', async () => {
      vi.useFakeTimers()
      try {
        const { runtime, engine, harness } = makeRuntimeWithHarness()
        await runtime.play()
        runtime.setAutoRefresh(true)
        const evalCountBefore = engine.evaluateFn.mock.calls.length

        // Simulate a content change.
        harness.fire()

        // Before the debounce fires, no re-evaluate yet.
        expect(engine.evaluateFn.mock.calls.length).toBe(evalCountBefore)

        // Advance past the debounce window.
        await vi.advanceTimersByTimeAsync(600)

        // One more evaluate call should have landed.
        expect(engine.evaluateFn.mock.calls.length).toBe(evalCountBefore + 1)
      } finally {
        vi.useRealTimers()
      }
    })

    it('debounce coalesces rapid content changes into a single re-play', async () => {
      vi.useFakeTimers()
      try {
        const { runtime, engine, harness } = makeRuntimeWithHarness()
        await runtime.play()
        runtime.setAutoRefresh(true)
        const evalCountBefore = engine.evaluateFn.mock.calls.length

        // Five fires within 100ms — all should collapse into one re-play.
        harness.fire()
        await vi.advanceTimersByTimeAsync(100)
        harness.fire()
        await vi.advanceTimersByTimeAsync(100)
        harness.fire()
        await vi.advanceTimersByTimeAsync(100)
        harness.fire()
        await vi.advanceTimersByTimeAsync(100)
        harness.fire()
        await vi.advanceTimersByTimeAsync(600)

        expect(engine.evaluateFn.mock.calls.length).toBe(evalCountBefore + 1)
      } finally {
        vi.useRealTimers()
      }
    })

    it('runtime without subscribeToFile is a no-op for live mode', async () => {
      const engine = createMockEngine()
      engine.setComponents({
        streaming: makeStreamingComponent(),
        audio: makeAudioComponent(),
      })
      // No fourth arg — tests that want auto-refresh dormant.
      const runtime = new LiveCodingRuntime('file-1', engine, () => 'code')
      await runtime.play()
      runtime.setAutoRefresh(true)
      // Flag set, but no way to observe file changes, so no re-plays ever.
      expect(runtime.isAutoRefreshEnabled()).toBe(true)
      runtime.dispose() // must not throw
    })
  })

  // -------------------------------------------------------------------------
  // Playback coordinator integration — single-source-at-a-time playback
  //
  // When a new runtime's play() fires, every OTHER registered source
  // (including other LiveCodingRuntime instances) should have its stop
  // callback invoked. This is the cross-tab exclusive-playback behavior
  // users expect from a DAW-style editor.
  // -------------------------------------------------------------------------

  describe('playback coordinator integration', () => {
    it('play() on one runtime stops another running runtime', async () => {
      const engineA = createMockEngine()
      engineA.setComponents({
        streaming: makeStreamingComponent(),
        audio: makeAudioComponent(),
      })
      const runtimeA = new LiveCodingRuntime(
        'file-coord-a',
        engineA,
        () => 'note("c3")',
      )
      const engineB = createMockEngine()
      engineB.setComponents({
        streaming: makeStreamingComponent(),
        audio: makeAudioComponent(),
      })
      const runtimeB = new LiveCodingRuntime(
        'file-coord-b',
        engineB,
        () => 'note("g3")',
      )

      // Track A's playing state via the onPlayingChanged listener
      // — the public observable interface.
      const playingA: boolean[] = []
      runtimeA.onPlayingChanged((p) => playingA.push(p))
      const playingB: boolean[] = []
      runtimeB.onPlayingChanged((p) => playingB.push(p))

      // A plays first. Coordinator marks A as currently playing.
      await runtimeA.play()
      expect(playingA[playingA.length - 1]).toBe(true)
      expect(engineA.stopFn.mock.calls.length).toBe(0)

      // B plays. Coordinator fires A's stop callback, which runs
      // engineA.stop() synchronously inside the coordinator call.
      await runtimeB.play()
      expect(playingB[playingB.length - 1]).toBe(true)
      // A should have been stopped via the coordinator's cross-stop.
      expect(playingA[playingA.length - 1]).toBe(false)
      expect(engineA.stopFn.mock.calls.length).toBeGreaterThan(0)

      runtimeA.dispose()
      runtimeB.dispose()
    })

    it('dispose unregisters the runtime from the coordinator', async () => {
      const engineA = createMockEngine()
      engineA.setComponents({
        streaming: makeStreamingComponent(),
        audio: makeAudioComponent(),
      })
      const runtimeA = new LiveCodingRuntime(
        'file-coord-dispose',
        engineA,
        () => 'code',
      )
      await runtimeA.play()
      runtimeA.dispose()
      // After dispose, A's stop callback should no longer fire on
      // new plays. We verify by checking stopFn's call count
      // doesn't increase beyond what dispose() itself did.
      const stopsAfterDispose = engineA.stopFn.mock.calls.length

      // Create an unrelated runtime and start it.
      const engineB = createMockEngine()
      engineB.setComponents({
        streaming: makeStreamingComponent(),
        audio: makeAudioComponent(),
      })
      const runtimeB = new LiveCodingRuntime(
        'file-coord-dispose-other',
        engineB,
        () => 'code',
      )
      await runtimeB.play()
      // A's engine.stop should NOT have been called again — A was
      // unregistered from the coordinator on dispose.
      expect(engineA.stopFn.mock.calls.length).toBe(stopsAfterDispose)
      runtimeB.dispose()
    })
  })

  // -------------------------------------------------------------------------
  // #384 — transport seek (seekTo / getSongPosition). The engine owns the
  // `.late()` wrap; the runtime owns the seek arithmetic (offset = now -
  // target), the isPlayingState gate, and the optional-delegate convention
  // (non-Strudel engines no-op). We mock the engine with a controllable
  // scheduler clock + transport-offset methods to test the wiring in
  // isolation — the audible jump is observed end-to-end (design §10), not here.
  // -------------------------------------------------------------------------
  describe('transport seek (#384)', () => {
    // Build a mock engine whose scheduler.now() is controllable and that
    // carries the optional setTransportOffset/getTransportOffset methods the
    // runtime delegates to. Returns helpers to drive the clock + read offset.
    function makeSeekEngine() {
      const engine = createMockEngine()
      let nowVal = 0
      let offset = 0
      engine.setComponents({
        streaming: makeStreamingComponent(),
        audio: makeAudioComponent(),
        queryable: {
          scheduler: {
            now: () => nowVal,
            query: () => [],
          },
        } as unknown as EngineComponents['queryable'],
      })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(engine as any).setTransportOffset = (o: number) => {
        offset = Number.isFinite(o) ? o : 0
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(engine as any).getTransportOffset = () => offset
      return {
        engine,
        setNow: (n: number) => {
          nowVal = n
        },
        getOffset: () => offset,
      }
    }

    it('seekTo sets offset = now - target and re-evals via play()', async () => {
      const { engine, setNow, getOffset } = makeSeekEngine()
      const runtime = new LiveCodingRuntime('seek-1', engine, () => 'code')
      await runtime.play()
      const playsBefore = engine.playFn.mock.calls.length

      setNow(10) // wall-clock cycle 10
      const res = await runtime.seekTo(3) // want songPosition = 3
      expect(res.error).toBeNull()
      // offset = now(10) - target(3) = 7
      expect(getOffset()).toBe(7)
      // seekTo re-evals through play() (the hot-swap path)
      expect(engine.playFn.mock.calls.length).toBe(playsBefore + 1)
      runtime.dispose()
    })

    it('getSongPosition = now - offset after a seek', async () => {
      const { engine, setNow } = makeSeekEngine()
      const runtime = new LiveCodingRuntime('seek-2', engine, () => 'code')
      await runtime.play()

      setNow(10)
      await runtime.seekTo(3) // offset becomes 7
      // clock advances two cycles past the seek instant
      setNow(12)
      // songPosition = now(12) - offset(7) = 5 (= target 3 + 2 elapsed)
      expect(runtime.getSongPosition()).toBe(5)
      runtime.dispose()
    })

    it('seeking forward yields a negative offset (.early)', async () => {
      const { engine, setNow, getOffset } = makeSeekEngine()
      const runtime = new LiveCodingRuntime('seek-3', engine, () => 'code')
      await runtime.play()

      setNow(4)
      await runtime.seekTo(9) // seek FORWARD past now
      expect(getOffset()).toBe(-5) // now(4) - target(9)
      runtime.dispose()
    })

    it('getSongPosition is null when stopped (gated on isPlayingState)', async () => {
      const { engine, setNow } = makeSeekEngine()
      const runtime = new LiveCodingRuntime('seek-4', engine, () => 'code')
      await runtime.play()
      setNow(8)
      await runtime.seekTo(2)
      expect(runtime.getSongPosition()).not.toBeNull()
      runtime.stop()
      expect(runtime.getSongPosition()).toBeNull()
      runtime.dispose()
    })

    it('seekTo ignores a non-finite target (no offset change, no re-eval)', async () => {
      const { engine, setNow, getOffset } = makeSeekEngine()
      const runtime = new LiveCodingRuntime('seek-5', engine, () => 'code')
      await runtime.play()
      setNow(10)
      await runtime.seekTo(3)
      const offsetAfterValid = getOffset()
      const playsBefore = engine.playFn.mock.calls.length

      const res = await runtime.seekTo(Number.NaN)
      expect(res.error).toBeNull()
      expect(getOffset()).toBe(offsetAfterValid) // unchanged
      expect(engine.playFn.mock.calls.length).toBe(playsBefore) // no re-eval
      runtime.dispose()
    })

    it('seekTo no-ops on an engine without setTransportOffset (non-Strudel)', async () => {
      // Plain mock engine — no transport methods attached.
      const engine = createMockEngine()
      engine.setComponents({
        streaming: makeStreamingComponent(),
        audio: makeAudioComponent(),
        queryable: makeQueryableComponent(),
      })
      const runtime = new LiveCodingRuntime('seek-6', engine, () => 'code')
      await runtime.play()
      const playsBefore = engine.playFn.mock.calls.length

      const res = await runtime.seekTo(5)
      expect(res.error).toBeNull()
      // No transport method → no re-eval, no throw. getSongPosition falls
      // back to raw now (offset defaults to 0).
      expect(engine.playFn.mock.calls.length).toBe(playsBefore)
      expect(runtime.getSongPosition()).toBe(0) // makeQueryableComponent now() = 0
      runtime.dispose()
    })
  })

  // -------------------------------------------------------------------------
  // Loop locators (#1570) — a user-set span the transport repeats.
  //
  // ⚠ THE TWO OBVIOUS IMPLEMENTATIONS FAIL IN OPPOSITE DIRECTIONS, and each one
  // passes any arm written in the layer it fails outside of:
  //   · looping by SEEKING back at the boundary sounds wrong (seekTo ends in
  //     play() — a hot-swap of the whole document every lap) while satisfying
  //     every assertion over the clock;
  //   · looping by RIBBON sounds right while the clock lies, because ribbon
  //     re-bases the span to cycle 0 and `now - offset` then counts
  //     loop-relative cycles.
  // So these arms assert both halves: the position folds into the span AND the
  // re-eval count stays flat across laps. Neither alone is worth anything.
  // -------------------------------------------------------------------------
  describe('loop locators (#1570)', () => {
    function makeLoopEngine() {
      const engine = createMockEngine()
      let nowVal = 0
      let offset = 0
      let loop: { startCycle: number; cycles: number } | null = null
      engine.setComponents({
        streaming: makeStreamingComponent(),
        audio: makeAudioComponent(),
        queryable: {
          scheduler: {
            now: () => nowVal,
            query: () => [],
          },
        } as unknown as EngineComponents['queryable'],
      })
      /* eslint-disable @typescript-eslint/no-explicit-any */
      ;(engine as any).setTransportOffset = (o: number) => {
        offset = Number.isFinite(o) ? o : 0
      }
      ;(engine as any).getTransportOffset = () => offset
      // The engine normalises; the mock stores what it is handed, so a test can
      // see whether the runtime passed a range through or dropped it.
      ;(engine as any).setLoopRange = (r: { startCycle: number; cycles: number } | null) => {
        loop = r
      }
      ;(engine as any).getLoopRange = () => loop
      /* eslint-enable @typescript-eslint/no-explicit-any */
      return {
        engine,
        setNow: (n: number) => {
          nowVal = n
        },
        getOffset: () => offset,
        getLoop: () => loop,
      }
    }

    it('arming from outside the span starts playback at the loop start', async () => {
      const { engine, setNow, getLoop } = makeLoopEngine()
      const runtime = new LiveCodingRuntime('loop-1', engine, () => 'code')
      await runtime.play()
      setNow(10) // song cycle 10, well past the span
      await runtime.setLoopRange({ startCycle: 3, cycles: 2 })
      expect(getLoop()).toEqual({ startCycle: 3, cycles: 2 })
      expect(runtime.getSongPosition()).toBe(3)
      runtime.dispose()
    })

    it('arming around the music already playing leaves it where it is', async () => {
      const { engine, setNow } = makeLoopEngine()
      const runtime = new LiveCodingRuntime('loop-2', engine, () => 'code')
      await runtime.play()
      setNow(3.5) // inside the span we are about to arm
      await runtime.setLoopRange({ startCycle: 3, cycles: 2 })
      // No jump: the loop closes around what is sounding.
      expect(runtime.getSongPosition()).toBe(3.5)
      runtime.dispose()
    })

    // THE assertion the playhead depends on. Under a ribbon the raw clock keeps
    // counting up; the reported song position must not.
    it('the song position folds into the span, lap after lap', async () => {
      const { engine, setNow } = makeLoopEngine()
      const runtime = new LiveCodingRuntime('loop-3', engine, () => 'code')
      await runtime.play()
      setNow(0)
      await runtime.setLoopRange({ startCycle: 3, cycles: 2 })
      expect(runtime.getSongPosition()).toBe(3)
      setNow(1) // one cycle in
      expect(runtime.getSongPosition()).toBe(4)
      setNow(2) // second lap begins
      expect(runtime.getSongPosition()).toBe(3)
      setNow(9.5) // many laps later
      expect(runtime.getSongPosition()).toBe(4.5)
      // And never outside it, at any clock value.
      for (let t = 0; t < 40; t += 0.5) {
        setNow(t)
        const p = runtime.getSongPosition()!
        expect(p).toBeGreaterThanOrEqual(3)
        expect(p).toBeLessThan(5)
      }
      runtime.dispose()
    })

    // CONTROL for the arm above: with no loop armed the same clock walks
    // straight past the span, so "folds" and "runs on" are told apart rather
    // than agreeing by accident. ("Plays straight through" and "loops
    // correctly" are indistinguishable for exactly one lap.)
    it('without a loop the position walks straight past the same span', async () => {
      const { engine, setNow } = makeLoopEngine()
      const runtime = new LiveCodingRuntime('loop-4', engine, () => 'code')
      await runtime.play()
      setNow(9.5)
      expect(runtime.getSongPosition()).toBe(9.5)
      runtime.dispose()
    })

    // The other half of P841: a loop must not cost a re-eval per lap. This is
    // what rules out the seek-back implementation, and the clock running for
    // twenty laps with a flat play count is the only thing that proves it.
    it('costs ONE re-eval to arm, and none per lap', async () => {
      const { engine, setNow } = makeLoopEngine()
      const runtime = new LiveCodingRuntime('loop-5', engine, () => 'code')
      await runtime.play()
      const playsBefore = engine.playFn.mock.calls.length
      setNow(0)
      await runtime.setLoopRange({ startCycle: 3, cycles: 2 })
      expect(engine.playFn.mock.calls.length).toBe(playsBefore + 1)
      for (let t = 0; t < 40; t += 0.5) {
        setNow(t)
        runtime.getSongPosition()
      }
      expect(engine.playFn.mock.calls.length).toBe(playsBefore + 1)
      runtime.dispose()
    })

    it('a seek inside the loop lands on the cycle asked for', async () => {
      const { engine, setNow } = makeLoopEngine()
      const runtime = new LiveCodingRuntime('loop-6', engine, () => 'code')
      await runtime.play()
      setNow(10)
      await runtime.setLoopRange({ startCycle: 3, cycles: 2 })
      await runtime.seekTo(4.5)
      expect(runtime.getSongPosition()).toBe(4.5)
      runtime.dispose()
    })

    it('a seek OUTSIDE the loop resolves to the loop start, not a fold', async () => {
      const { engine, setNow } = makeLoopEngine()
      const runtime = new LiveCodingRuntime('loop-7', engine, () => 'code')
      await runtime.play()
      setNow(10)
      await runtime.setLoopRange({ startCycle: 3, cycles: 2 })
      await runtime.seekTo(12)
      expect(runtime.getSongPosition()).toBe(3)
      // A fold would have landed on 4 — inside the span, plausible, and not
      // what anyone asked for. This is the arm that separates the two.
      expect(runtime.getSongPosition()).not.toBe(4)
      runtime.dispose()
    })

    it('clearing the loop continues from where the ears are, then runs on', async () => {
      const { engine, setNow, getLoop } = makeLoopEngine()
      const runtime = new LiveCodingRuntime('loop-8', engine, () => 'code')
      await runtime.play()
      setNow(0)
      await runtime.setLoopRange({ startCycle: 3, cycles: 2 })
      setNow(1) // song cycle 4 — mid-span
      expect(runtime.getSongPosition()).toBe(4)

      await runtime.setLoopRange(null)
      expect(getLoop()).toBeNull()
      expect(runtime.getSongPosition()).toBe(4) // continuous across the clear
      // …and now it walks past the old span end instead of wrapping: the
      // control that the loop is really gone, not merely reported as gone.
      setNow(4)
      expect(runtime.getSongPosition()).toBe(7)
      runtime.dispose()
    })

    it('drops an unusable range (a drag that ended where it started)', async () => {
      const { engine, setNow, getLoop } = makeLoopEngine()
      const runtime = new LiveCodingRuntime('loop-9', engine, () => 'code')
      await runtime.play()
      setNow(5)
      await runtime.setLoopRange({ startCycle: 3, cycles: 0 })
      expect(getLoop()).toBeNull()
      expect(runtime.getSongPosition()).toBe(5) // unlooped, unmoved
      runtime.dispose()
    })

    it('no-ops on an engine without setLoopRange (non-Strudel)', async () => {
      const engine = createMockEngine()
      engine.setComponents({
        streaming: makeStreamingComponent(),
        audio: makeAudioComponent(),
        queryable: makeQueryableComponent(),
      })
      const runtime = new LiveCodingRuntime('loop-10', engine, () => 'code')
      await runtime.play()
      const playsBefore = engine.playFn.mock.calls.length
      const res = await runtime.setLoopRange({ startCycle: 3, cycles: 2 })
      expect(res.error).toBeNull()
      expect(engine.playFn.mock.calls.length).toBe(playsBefore) // no re-eval
      expect(runtime.getSongPosition()).toBe(0)
      runtime.dispose()
    })

    it('arming while stopped stores the pair without starting playback', async () => {
      const { engine, setNow, getLoop } = makeLoopEngine()
      const runtime = new LiveCodingRuntime('loop-11', engine, () => 'code')
      await runtime.play()
      runtime.stop()
      const playsBefore = engine.playFn.mock.calls.length
      setNow(10)
      await runtime.setLoopRange({ startCycle: 3, cycles: 2 })
      expect(getLoop()).toEqual({ startCycle: 3, cycles: 2 })
      expect(engine.playFn.mock.calls.length).toBe(playsBefore) // no play() while stopped
      runtime.dispose()
    })
  })

  // -------------------------------------------------------------------------
  // evaluateForTimeline (#977) — populate song patterns pre-play WITHOUT
  // starting playback, so the Song timeline draws eval-faithful marks before
  // Play. Must reuse the real evaluate (single oracle), never publish/play,
  // and serialize its evaluate with play()'s (the shared `.p` capture race).
  // -------------------------------------------------------------------------
  describe('evaluateForTimeline (#977) — eval-on-load for pre-play marks', () => {
    it('runs init + evaluate but never play or publish; isPlaying stays false', async () => {
      const engine = createMockEngine()
      engine.setComponents({
        streaming: makeStreamingComponent(),
        audio: makeAudioComponent(),
      })
      const runtime = new LiveCodingRuntime('tl-1', engine, () => 'note("c3")')
      let published = false
      workspaceAudioBus.subscribe({ kind: 'file', fileId: 'tl-1' }, (p) => {
        if (p) published = true
      })

      await runtime.evaluateForTimeline()

      expect(engine.callLog).toEqual(['init', 'evaluate'])
      expect(engine.playFn.mock.calls.length).toBe(0)
      expect(published).toBe(false)
      expect(runtime.getIsPlaying()).toBe(false)
      expect(workspaceAudioBus.listSources()).toHaveLength(0)
      runtime.dispose()
    })

    it('evaluates the CURRENT file content on each call', async () => {
      const engine = createMockEngine()
      let content = 'note("c3")'
      const runtime = new LiveCodingRuntime('tl-2', engine, () => content)
      await runtime.evaluateForTimeline()
      content = 'note("e3")'
      await runtime.evaluateForTimeline()
      expect(engine.evaluateCalls).toEqual(['note("c3")', 'note("e3")'])
      runtime.dispose()
    })

    it('is a no-op while playing (play() already keeps song patterns fresh)', async () => {
      const engine = createMockEngine()
      engine.setComponents({
        streaming: makeStreamingComponent(),
        audio: makeAudioComponent(),
      })
      const runtime = new LiveCodingRuntime('tl-3', engine, () => 'code')
      await runtime.play()
      const evalsAfterPlay = engine.evaluateCalls.length
      await runtime.evaluateForTimeline()
      expect(engine.evaluateCalls.length).toBe(evalsAfterPlay) // no extra evaluate
      runtime.dispose()
    })

    it('is a no-op after dispose (never inits or evaluates)', async () => {
      const engine = createMockEngine()
      const runtime = new LiveCodingRuntime('tl-4', engine, () => 'code')
      runtime.dispose()
      const afterDispose = [...engine.callLog]
      await runtime.evaluateForTimeline()
      // evaluateForTimeline added nothing — no init, no evaluate.
      expect(engine.callLog).toEqual(afterDispose)
      expect(engine.evaluateCalls).toEqual([])
    })

    it('serializes its evaluate with play() — the two never overlap', async () => {
      const engine = createMockEngine()
      engine.setComponents({
        streaming: makeStreamingComponent(),
        audio: makeAudioComponent(),
      })
      // Controllable evaluate: each call blocks until its deferred is released,
      // so we can observe whether a second evaluate begins before the first
      // ends. Without the gate the two evaluates would interleave here — that
      // is exactly the shared `.p`-capture cross-wire the gate prevents.
      const releases: Array<() => void> = []
      const evalOrder: string[] = []
      engine.evaluate = vi.fn(async (code: string) => {
        evalOrder.push(code)
        await new Promise<void>((res) => releases.push(res))
        return {}
      })
      const runtime = new LiveCodingRuntime('tl-5', engine, () => 'code')

      const pTimeline = runtime.evaluateForTimeline()
      const pPlay = runtime.play()
      const flush = async () => {
        for (let i = 0; i < 10; i++) await Promise.resolve()
      }
      await flush()

      // Gate holds: only ONE evaluate has begun though both callers are live.
      expect(evalOrder.length).toBe(1)

      releases.shift()!() // release the first evaluate
      await flush()
      // Now — and only now — the second evaluate begins.
      expect(evalOrder.length).toBe(2)

      releases.shift()!() // release the second so play() can finish
      await Promise.all([pTimeline, pPlay])
      runtime.dispose()
    })
  })
})

// ---------------------------------------------------------------------------
// #1172 — the SPECULATIVE evaluate must not report through the error channel.
//
// `evaluateForTimeline()` is handed the document WHILE THE USER IS TYPING IT,
// so a failure is the expected case: `s("bd` is a parse error on the way to
// `s("bd sd")`. Strudel's repl logs those itself — `logger(…, 'error')` then an
// unconditional `console.error(err)` — and does NOT rethrow, so no try/catch of
// ours can reach them. The mock below therefore prints the way the real repl
// does; a mock that merely returned `{ error }` would pass these tests without
// exercising the thing they exist to pin.
// ---------------------------------------------------------------------------
describe('speculative timeline evaluate is quiet (#1172)', () => {
  /** An engine whose evaluate fails the way Strudel's does: prints, then reports. */
  function engineThatPrintsOnEvalError(): MockEngine {
    const engine = createMockEngine()
    engine.evaluate = vi.fn(async (_code: string) => {
      console.error(new SyntaxError('Unexpected end of input'))
      return { error: new SyntaxError('Unexpected end of input') }
    })
    return engine
  }

  it('mutes console.error for the speculative evaluate and records what it silenced', async () => {
    const engine = engineThatPrintsOnEvalError()
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const runtime = new LiveCodingRuntime('quiet-1', engine, () => 's("bd')

    await runtime.evaluateForTimeline()

    expect(spy, 'a half-typed document reported through the error channel').not.toHaveBeenCalled()

    // Silenced is not the same as lost.
    const diag = runtime.getTimelineEvalDiagnostics()
    expect(diag.error?.message).toBe('Unexpected end of input')
    expect(diag.suppressedConsoleErrors.join(' ')).toContain('Unexpected end of input')

    spy.mockRestore()
    runtime.dispose()
  })

  it('CONTROL: the identical failure from play() still reaches console.error', async () => {
    // Without this arm, the test above passes just as well if the mute were
    // global — which would swallow the errors a user actually needs.
    const engine = engineThatPrintsOnEvalError()
    engine.setComponents({
      streaming: makeStreamingComponent(),
      audio: makeAudioComponent(),
    })
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const runtime = new LiveCodingRuntime('quiet-2', engine, () => 's("bd')

    await runtime.play()

    expect(spy, 'play() is the user asking — its errors must stay visible').toHaveBeenCalled()
    spy.mockRestore()
    runtime.dispose()
  })

  it('restores console.error afterwards, including when the evaluate throws', async () => {
    const engine = createMockEngine()
    engine.evaluate = vi.fn(async (_code: string) => {
      throw new Error('evaluate blew up')
    })
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const runtime = new LiveCodingRuntime('quiet-3', engine, () => 'code')

    await runtime.evaluateForTimeline()

    expect(console.error, 'console.error was left stubbed after a throwing evaluate').toBe(spy)
    spy.mockRestore()
    runtime.dispose()
  })

  it('a SUCCEEDING speculative evaluate leaves no error behind', async () => {
    const engine = createMockEngine()
    const runtime = new LiveCodingRuntime('quiet-4', engine, () => 'note("c3")')
    await runtime.evaluateForTimeline()
    expect(runtime.getTimelineEvalDiagnostics().error).toBeNull()
    runtime.dispose()
  })

  it('CONTROL: play()\'s error survives a speculative evaluate QUEUED BEHIND it', async () => {
    // This is the arm that pins WHERE the mute goes. `runExclusiveEval` first
    // AWAITS any in-flight evaluate, so a mute wrapped around the whole call
    // stays installed while PLAY'S evaluate is still running — and swallows an
    // error the user needs. Wrapped inside the callback, the gate has already
    // granted exclusivity and the quiet window covers only our own evaluate.
    // Without this arm both placements pass.
    const engine = createMockEngine()
    engine.setComponents({
      streaming: makeStreamingComponent(),
      audio: makeAudioComponent(),
    })
    const releases: Array<() => void> = []
    engine.evaluate = vi.fn(async (_code: string) => {
      await new Promise<void>((res) => releases.push(res))
      console.error(new SyntaxError('play-path failure'))
      return { error: new SyntaxError('play-path failure') }
    })
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const runtime = new LiveCodingRuntime('quiet-5', engine, () => 's("bd')
    const flush = async () => {
      for (let i = 0; i < 10; i++) await Promise.resolve()
    }

    const pPlay = runtime.play()
    await flush()
    // Queued behind play's evaluate, which is still in flight.
    const pSpec = runtime.evaluateForTimeline()
    await flush()

    // Drain as each evaluate reaches its deferred.
    for (let round = 0; round < 6; round++) {
      releases.splice(0).forEach((r) => r())
      await flush()
    }
    await pPlay
    await pSpec

    expect(
      spy,
      "the speculative mute leaked outside its gate and swallowed play()'s error",
    ).toHaveBeenCalled()
    spy.mockRestore()
    runtime.dispose()
  })
})

/**
 * #1197 — the band accessor's degradation path.
 *
 * `getTimelineEventsBand` is optional on the engine. The obvious wiring —
 * `engine.getTimelineEventsBand?.(a, b) ?? []` — is WRONG for the one engine
 * shape that matters: one that has the events but not the band form. There the
 * caller asks an engine that HAS onsets and receives silence, so the Song
 * analysis sees an empty song and the view draws blank, with nothing thrown.
 *
 * No engine in this repo is that shape today (StrudelEngine implements both), so
 * this path is unreachable from any other test and would ship unexercised.
 */
describe('LiveCodingRuntime.getTimelineEventsBand degradation (#1197)', () => {
  beforeEach(() => {
    __resetWorkspaceAudioBusForTests()
  })

  const EVENTS = [
    { begin: 0, end: 0.5, trackId: '$0', s: 'bd' },
    { begin: 5, end: 5.5, trackId: '$0', s: 'sd' },
  ]

  it('uses the engine band accessor when the engine has one', () => {
    const engine = createMockEngine()
    const bandFn = vi.fn(() => EVENTS)
    Object.assign(engine, { getTimelineEventsBand: bandFn, getTimelineEvents: () => [] })
    const runtime = new LiveCodingRuntime('f1', engine, () => '')

    expect(runtime.getTimelineEventsBand(4, 8)).toEqual(EVENTS)
    // Passed through verbatim — not silently re-based to a prefix.
    expect(bandFn).toHaveBeenCalledWith(4, 8)
    runtime.dispose()
  })

  it('FALLS BACK to the prefix accessor when the engine lacks the band form, rather than reporting silence', () => {
    const engine = createMockEngine()
    const prefixFn = vi.fn(() => EVENTS)
    // Deliberately NO getTimelineEventsBand — the shape the naive wiring breaks on.
    Object.assign(engine, { getTimelineEvents: prefixFn })
    const runtime = new LiveCodingRuntime('f2', engine, () => '')

    const got = runtime.getTimelineEventsBand(4, 8)
    // The events are returned, NOT []. This is the assertion that separates the
    // fallback from the optional-chain-to-empty version; every other assertion
    // in this file passes under both.
    expect(got).toEqual(EVENTS)
    expect(got.length).toBeGreaterThan(0)
    // Asked for the band's END as the prefix length, so nothing in the band is
    // missing; the caller filters the prefix down to its own band as before.
    expect(prefixFn).toHaveBeenCalledWith(8)
    runtime.dispose()
  })

  it('reports silence only when the engine has NO event source at all', () => {
    const engine = createMockEngine()
    // Neither accessor — a non-Strudel runtime. Here [] is the honest answer.
    const runtime = new LiveCodingRuntime('f3', engine, () => '')
    expect(runtime.getTimelineEventsBand(4, 8)).toEqual([])
    runtime.dispose()
  })
})

// ---------------------------------------------------------------------------
// #1371 — a bounce begins at the top of the song.
//
// The recorder taps the master analyser in real time, so it captures whatever
// the transport is playing at that instant. Before this, a bounce taken while
// listening began at the PLAYHEAD: measured on a three-section arrangement,
// 4s of listening rotated the export by 4s and 12s rotated it by 12s. The take
// was still valid, still full-length and still not silent — nothing could see
// it but a listener.
//
// These arms pin the REWIND SEQUENCE rather than the audio (the audio half is
// observed end-to-end in `_songpass-arranged-bounce`). Order is the whole
// point, so they assert the call log, not just that the calls happened: a
// rewind that lands AFTER the capture opens would satisfy every membership
// check and still export the wrong song.
// ---------------------------------------------------------------------------
describe('bounce rewinds to the top of the song (#1371)', () => {
  /** A mock engine that can record, settle and carry a transport offset. */
  function makeRecordEngine() {
    const engine = createMockEngine()
    let offset = 0
    const anyEngine = engine as unknown as Record<string, unknown>
    anyEngine.waitUntilQuiet = vi.fn(async () => {
      engine.callLog.push('waitUntilQuiet')
      return true
    })
    anyEngine.setTransportOffset = vi.fn((o: number) => {
      engine.callLog.push(`setTransportOffset(${o})`)
      offset = Number.isFinite(o) ? o : 0
    })
    anyEngine.getTransportOffset = () => offset
    // #1570 — the loop range travels the same path as the offset, and for the
    // same reason. `loopAtCapture` is snapshotted at the instant the recorder
    // opens, because that is the only moment the answer matters: what the take
    // contains is decided by the frame in force THEN, not before or after.
    let loop: { startCycle: number; cycles: number } | null = null
    anyEngine.setLoopRange = vi.fn((r: { startCycle: number; cycles: number } | null) => {
      engine.callLog.push(`setLoopRange(${r ? `${r.startCycle},${r.cycles}` : 'null'})`)
      loop = r
    })
    anyEngine.getLoopRange = () => loop
    let loopAtCapture: { startCycle: number; cycles: number } | null | undefined
    anyEngine.record = vi.fn(async () => {
      engine.callLog.push('record')
      loopAtCapture = loop
      return new Blob([new Uint8Array(8)])
    })
    return {
      engine,
      getOffset: () => offset,
      getLoop: () => loop,
      getLoopAtCapture: () => loopAtCapture,
    }
  }

  it('rewinds BEFORE the capture opens, when the transport was already playing', async () => {
    const { engine } = makeRecordEngine()
    const runtime = new LiveCodingRuntime('rec-1', engine, () => 'code')
    await runtime.play()
    engine.callLog.length = 0

    const blob = await runtime.record(1)
    expect(blob).not.toBeNull()

    // The sequence that makes the export reproducible. `record` must come last
    // of the four — that is the assertion the old behaviour fails.
    expect(engine.callLog).toEqual([
      'stop',
      'waitUntilQuiet',
      'setTransportOffset(0)',
      'evaluate',
      'play',
      'record',
      'stop',
    ])
    runtime.dispose()
  })

  it('takes the same path when the transport was stopped', async () => {
    const { engine } = makeRecordEngine()
    const runtime = new LiveCodingRuntime('rec-2', engine, () => 'code')
    engine.callLog.length = 0

    await runtime.record(1)

    // Both entry states converge: stopping an already-stopped transport is a
    // no-op, so there is one path to reason about rather than two.
    expect(engine.callLog.indexOf('play')).toBeLessThan(engine.callLog.indexOf('record'))
    expect(engine.callLog).toContain('setTransportOffset(0)')
    runtime.dispose()
  })

  it('clears an earlier seek, so song cycle 0 is scheduler cycle 0', async () => {
    const { engine, getOffset } = makeRecordEngine()
    const runtime = new LiveCodingRuntime('rec-3', engine, () => 'code')
    await runtime.play()
    // Pretend the user dragged the playhead into the second section.
    ;(engine as unknown as { setTransportOffset: (n: number) => void }).setTransportOffset(7)
    expect(getOffset()).toBe(7)

    await runtime.record(1)

    // Resetting the clock without resetting the offset would rewind the
    // scheduler and leave the PATTERN shifted by 7 cycles — the same bug wearing
    // a different hat.
    expect(getOffset()).toBe(0)
    runtime.dispose()
  })

  // #1570 — the loop range is the second thing that decides what the take
  // contains, and it fails in exactly the shape #1371 already fixed once: a
  // bounce with a loop armed captures the looped span repeating instead of the
  // song. Silent in the same way too — the file is valid, full-length and not
  // silent, so nothing surfaces it but listening.
  it('bounces the SONG, not the loop, when a loop is armed', async () => {
    const { engine, getLoopAtCapture } = makeRecordEngine()
    const runtime = new LiveCodingRuntime('rec-loop-1', engine, () => 'code')
    await runtime.play()
    await runtime.setLoopRange({ startCycle: 3, cycles: 2 })

    await runtime.record(1)

    // What the frame was at the instant the recorder opened — the only moment
    // that decides what is in the file.
    expect(getLoopAtCapture()).toBeNull()
    runtime.dispose()
  })

  it('gives the loop back afterwards, so the bounce does not disarm the user', async () => {
    const { engine, getLoop } = makeRecordEngine()
    const runtime = new LiveCodingRuntime('rec-loop-2', engine, () => 'code')
    await runtime.play()
    await runtime.setLoopRange({ startCycle: 3, cycles: 2 })

    await runtime.record(1)

    // The locators are the user's, not the recorder's. Clearing the seek is a
    // rewind the user asked for; silently clearing their loop is not.
    expect(getLoop()).toEqual({ startCycle: 3, cycles: 2 })
    runtime.dispose()
  })

  it('touches nothing when no loop was armed (the control)', async () => {
    const { engine, getLoop, getLoopAtCapture } = makeRecordEngine()
    const runtime = new LiveCodingRuntime('rec-loop-3', engine, () => 'code')
    await runtime.play()

    await runtime.record(1)

    expect(getLoopAtCapture()).toBeNull()
    expect(getLoop()).toBeNull()
    runtime.dispose()
  })

  it('leaves the transport stopped, which is what the modal has always promised', async () => {
    const { engine } = makeRecordEngine()
    const runtime = new LiveCodingRuntime('rec-4', engine, () => 'code')
    await runtime.play()
    expect(runtime.getIsPlaying()).toBe(true)

    await runtime.record(1)

    expect(runtime.getIsPlaying()).toBe(false)
    runtime.dispose()
  })

  it('stops the transport even when the capture throws', async () => {
    const { engine } = makeRecordEngine()
    const runtime = new LiveCodingRuntime('rec-5', engine, () => 'code')
    ;(engine as unknown as Record<string, unknown>).record = vi.fn(async () => {
      throw new Error('capture failed')
    })
    await runtime.play()

    await expect(runtime.record(1)).rejects.toThrow('capture failed')
    expect(runtime.getIsPlaying()).toBe(false)
    runtime.dispose()
  })

  it('an engine with no seek support still bounces (non-Strudel)', async () => {
    const { engine } = makeRecordEngine()
    delete (engine as unknown as Record<string, unknown>).setTransportOffset
    const runtime = new LiveCodingRuntime('rec-6', engine, () => 'code')
    await runtime.play()

    const blob = await runtime.record(1)
    expect(blob).not.toBeNull()
    runtime.dispose()
  })
})
