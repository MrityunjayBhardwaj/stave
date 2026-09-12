// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mock state
// ---------------------------------------------------------------------------

// Unique counter for Pattern instances so queryArc returns distinguishable results
let patternInstanceCounter = 0

// Controls what pattern.p() calls the mock repl.evaluate() simulates
type EvalBehavior =
  | 'two-anon'     // two anonymous $: patterns → "$0", "$1"
  | 'one-named'    // one named pattern → "d1"
  | 'mixed'        // one anonymous + one named → "$0", "d1"
  | 'error'        // fires onEvalError (no patterns captured)
  | 'muted'        // muted patterns: "_muted" and "muted_"
  | 'one-track'    // single anonymous pattern → "$0"
  | 'viz-backdrop-flag'  // `.viz('name', { backdrop: true })` → backdrop slot (#364)
  | 'viz-inline-no-flag' // `.viz('name')` no flag → inline zone (#364 control)

let evalBehavior: EvalBehavior = 'two-anon'

// Captured onEvalError callback from webaudioRepl construction
let capturedOnEvalError: ((err: Error) => void) | null = null

// ---------------------------------------------------------------------------
// Mock Pattern class
// ---------------------------------------------------------------------------

class MockPattern {
  private instanceId: number
  // Accumulated `.late()` shift (#863) — the seek wrap the engine applies to the
  // SCHEDULER-frame pattern. `0` for a pattern in the song frame.
  private shift: number
  // #1570 — the transport wraps this pattern has been through, IN ORDER.
  //
  // `ribbon` cannot be modelled on this mock's time axis: it re-bases the slice
  // it cuts, so what it changes is WHICH song cycle sounds, and these haps carry
  // time rather than song-cycle values. (The real semantics are asserted against
  // the actual @strudel/core in `__tests__/transportFrame.test.ts` — that is the
  // authority; this records the WIRING.) The ops ride out on the hap value,
  // where `normalizeStrudelHap` passes unknown fields through as `params`, so a
  // test can read back exactly which wraps the engine applied to which frame.
  private ops: string[]
  constructor(clone?: { instanceId: number; shift: number; ops: string[] }) {
    this.instanceId = clone ? clone.instanceId : ++patternInstanceCounter
    this.shift = clone ? clone.shift : 0
    this.ops = clone ? clone.ops : []
  }
  // Models `@strudel/core`'s `.late(offset)`: delays every onset by `offset`
  // cycles. Returns a NEW pattern (as Strudel does) that keeps the same
  // instanceId, so the orbit each analyser test asserts on is unaffected.
  late(offset: number) {
    return new MockPattern({
      instanceId: this.instanceId,
      shift: this.shift + offset,
      ops: [...this.ops, `late(${offset})`],
    })
  }
  // #1570 — `.ribbon(offset, cycles)`: cut a span and loop it. Recorded, not
  // simulated (see `ops` above).
  ribbon(offset: number, cycles: number) {
    return new MockPattern({
      instanceId: this.instanceId,
      shift: this.shift,
      ops: [...this.ops, `ribbon(${offset},${cycles})`],
    })
  }
  queryArc(begin: number, end: number) {
    return [{
      whole: { begin: begin + this.shift, end: end + this.shift },
      // `orbit` field is read by StrudelEngine.resolveOrbit() to decide which
      // superdough orbit to side-tap for per-track analysers. Using instanceId
      // gives each pattern a distinct orbit in tests.
      value: {
        note: `note_${this.instanceId}`,
        s: `inst_${this.instanceId}`,
        orbit: this.instanceId,
        // Omitted entirely on an unwrapped pattern, so the mock adds no
        // `params` to the haps every other test in this file reads.
        ...(this.ops.length > 0 ? { transportOps: this.ops } : {}),
      },
    }]
  }
}

// ---------------------------------------------------------------------------
// Mock @strudel/core
// ---------------------------------------------------------------------------

vi.mock('@strudel/core', () => {
  return {
    Pattern: MockPattern,
    evalScope: vi.fn().mockResolvedValue(undefined),
    // Phase 20-14 α-4: vendored piano.ts imports noteToMidi + valueToMidi
    // from @strudel/core at engine boot. Stubbed here so the test env can
    // load the side-effect module without an undefined-export crash.
    // The functions aren't exercised by these tests — any numeric return
    // is fine.
    noteToMidi: vi.fn((_note: string) => 108),
    valueToMidi: vi.fn((_value: unknown) => 60),
    // `init()` installs the bare-string parser through these (#1018). They must be
    // present even though nothing here exercises them: vitest throws on ANY access to
    // an export a mock does not define, so an optional call (`setStringParser?.()`) is
    // not enough to make the mock's omission harmless.
    setStringParser: vi.fn(),
    pure: vi.fn((v: unknown) => v),
  }
})

// ---------------------------------------------------------------------------
// Mock @strudel/webaudio
// ---------------------------------------------------------------------------

vi.mock('@strudel/webaudio', () => {
  const mockScheduler = {
    now: () => 0,
    pattern: new MockPattern(),
    start: vi.fn(),
    stop: vi.fn(),
  }

  const webaudioRepl = vi.fn((options: { onEvalError?: (err: Error) => void }) => {
    capturedOnEvalError = options.onEvalError ?? null

    return {
      scheduler: mockScheduler,
      evaluate: vi.fn(async (code: string) => {
        // Simulate Strudel's internal sequence:
        // (1) injectPatternMethods: sets Pattern.prototype.p = function(id) { ... }
        // (2) hush() would run (reset counters) — simulated by starting fresh
        // (3) user code runs — calls pattern.p(id)

        // Step 1: Simulate injectPatternMethods assigning Pattern.prototype.p
        const strudelsOwnP = function(this: MockPattern, id: string) {
          // Strudel's own implementation: returns this (simplified)
          return this
        }
        // This is the critical line: Strudel's injectPatternMethods does:
        //   Pattern.prototype.p = function(id) { pPatterns[id] = this; return this; }
        ;(MockPattern.prototype as any).p = strudelsOwnP

        // Step 2: Simulate user code calling .p(id) based on eval behavior
        if (code === 'error-code') {
          // Trigger eval error instead of running user code
          capturedOnEvalError?.(new Error('Simulated eval error'))
          return
        }

        // #1193 — the case the engine's own comment said could not happen:
        // repl.evaluate REJECTS instead of routing the failure through
        // onEvalError. Nothing in Strudel promises it never does, and when it
        // did, the engine's bridge promise never settled.
        if (code === 'reject-code') {
          throw new Error('Simulated repl.evaluate rejection')
        }

        if (code === 'two-anon' || evalBehavior === 'two-anon') {
          const p0 = new MockPattern()
          const p1 = new MockPattern()
          ;(p0 as any).p('$')
          ;(p1 as any).p('$')
        } else if (code === 'one-named' || evalBehavior === 'one-named') {
          const p = new MockPattern()
          ;(p as any).p('d1')
        } else if (code === 'mixed' || evalBehavior === 'mixed') {
          const p0 = new MockPattern()
          const p1 = new MockPattern()
          ;(p0 as any).p('$')
          ;(p1 as any).p('d1')
        } else if (code === 'muted-code' || evalBehavior === 'muted') {
          const p1 = new MockPattern()
          const p2 = new MockPattern()
          ;(p1 as any).p('_muted')
          ;(p2 as any).p('muted_')
        } else if (code === 'one-track' || evalBehavior === 'one-track') {
          const p = new MockPattern()
          ;(p as any).p('$')
        } else if (evalBehavior === 'viz-backdrop-flag') {
          // #364: `.viz('pianoroll', { backdrop: true })` promotes the viz to
          // the BACKDROP slot. The flag fires BEFORE .p(); .p() must then NOT
          // register an inline viz request (no `_pendingViz` was tagged).
          const p = new MockPattern()
          ;(p as any).viz('pianoroll', { backdrop: true, opacity: 0.5 })
          ;(p as any).p('$')
        } else if (evalBehavior === 'viz-inline-no-flag') {
          // #364 control: `.viz('spectrum')` with no flag stays inline — it
          // tags `_pendingViz`, so .p() registers an inline request and the
          // backdrop slot stays empty.
          const p = new MockPattern()
          ;(p as any).viz('spectrum')
          ;(p as any).p('$')
        }
      }),
    }
  })

  return {
    webaudioRepl,
    initAudio: vi.fn().mockResolvedValue(undefined),
    getAudioContext: vi.fn(() => ({
      createAnalyser: vi.fn(() => ({
        fftSize: 2048,
        smoothingTimeConstant: 0.8,
        connect: vi.fn(),
        disconnect: vi.fn(),
      })),
      currentTime: 0,
      sampleRate: 44100,
    })),
    webaudioOutput: vi.fn(),
    registerSynthSounds: vi.fn(),
    registerZZFXSounds: vi.fn(),
    // Real superdough returns the SAME SuperdoughAudioController singleton on
    // every call. The mock memoizes so tests can inspect the same getOrbit spy
    // the engine itself used during init().
    getSuperdoughAudioController: (() => {
      const orbits = new Map<number, { output: { connect: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> } }>()
      const controller = {
        output: { destinationGain: { connect: vi.fn() } },
        getOrbit: vi.fn((n: number) => {
          let orbit = orbits.get(n)
          if (!orbit) {
            orbit = { output: { connect: vi.fn(), disconnect: vi.fn() } }
            orbits.set(n, orbit)
          }
          return orbit
        }),
      }
      return vi.fn(() => controller)
    })(),
    samples: vi.fn().mockResolvedValue(undefined),
    soundMap: { get: vi.fn(() => ({})) },
  }
})

// ---------------------------------------------------------------------------
// Mock remaining strudel modules
// ---------------------------------------------------------------------------

vi.mock('@strudel/mini', () => ({
  miniAllStrings: vi.fn(),
}))

vi.mock('@strudel/tonal', () => ({}))

vi.mock('@strudel/soundfonts', () => ({
  registerSoundfonts: vi.fn(),
}))

vi.mock('@strudel/xen', () => ({}))

vi.mock('@strudel/midi', () => ({}))

// Phase 20-14 α-1: audio-pure addition to evalScope; tests don't exercise
// mondo notation so an empty mock is sufficient (matches the @strudel/tonal,
// @strudel/xen, @strudel/midi pattern above).
vi.mock('@strudel/mondo', () => ({}))

vi.mock('@strudel/transpiler', () => ({
  transpiler: vi.fn((code: string) => ({ output: code })),
}))

// ---------------------------------------------------------------------------
// Import the module under test (after mocks are set up)
// ---------------------------------------------------------------------------

import { StrudelEngine, isBootStepFailure, type BootStepFailure } from './StrudelEngine'
import type { LiveCodingEngine } from './LiveCodingEngine'
import { Pattern } from '@strudel/core'

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('StrudelEngine.getTrackSchedulers', () => {
  beforeEach(() => {
    patternInstanceCounter = 0
    capturedOnEvalError = null
    evalBehavior = 'two-anon'
    vi.clearAllMocks()
  })

  afterEach(() => {
    // Ensure Pattern.prototype.p is not left as a setter after any test
    const desc = Object.getOwnPropertyDescriptor(MockPattern.prototype, 'p')
    if (desc?.set) {
      // Clean up leaked setter
      delete (MockPattern.prototype as any).p
    }
  })

  it('returns empty Map before evaluate', () => {
    const engine = new StrudelEngine()
    expect(engine.getTrackSchedulers().size).toBe(0)
  })

  it('captures anonymous $: patterns as $0, $1 (TRACK-01, TRACK-04)', async () => {
    evalBehavior = 'two-anon'
    const engine = new StrudelEngine()
    await engine.init()
    await engine.evaluate('two-anon')
    const map = engine.getTrackSchedulers()
    expect(map.size).toBe(2)
    expect(map.has('$0')).toBe(true)
    expect(map.has('$1')).toBe(true)
  })

  it('captures named patterns with literal key (TRACK-01, TRACK-04)', async () => {
    evalBehavior = 'one-named'
    const engine = new StrudelEngine()
    await engine.init()
    await engine.evaluate('one-named')
    const map = engine.getTrackSchedulers()
    expect(map.has('d1')).toBe(true)
  })

  it('each track scheduler queries its own pattern (TRACK-03)', async () => {
    evalBehavior = 'two-anon'
    const engine = new StrudelEngine()
    await engine.init()
    await engine.evaluate('two-anon')
    const map = engine.getTrackSchedulers()
    const sched0 = map.get('$0')!
    const sched1 = map.get('$1')!
    expect(sched0).toBeDefined()
    expect(sched1).toBeDefined()
    const result0 = sched0.query(0, 1)
    const result1 = sched1.query(0, 1)
    // Each returns its own Pattern's queryArc result (different note/s from instanceId)
    expect(result0).not.toEqual(result1)
    expect(result0[0].note).not.toBe(result1[0].note)
  })

  it('restores Pattern.prototype.p after successful evaluate (TRACK-02)', async () => {
    evalBehavior = 'two-anon'
    const engine = new StrudelEngine()
    await engine.init()
    await engine.evaluate('two-anon')
    const after = Object.getOwnPropertyDescriptor(MockPattern.prototype, 'p')
    // Should not be a setter (our intercept should be removed)
    expect(after?.set).toBeUndefined()
  })

  it('restores Pattern.prototype.p after eval error (TRACK-02)', async () => {
    const engine = new StrudelEngine()
    await engine.init()
    await engine.evaluate('error-code')
    const desc = Object.getOwnPropertyDescriptor(MockPattern.prototype, 'p')
    expect(desc?.set).toBeUndefined()
  })

  /**
   * #1193 — REGRESSION GUARD. `evaluate()` must SETTLE when `repl.evaluate`
   * rejects, rather than waiting forever for a success callback that will
   * never come.
   *
   * WHY THIS IS THE ARM AND NOT A TIMING ONE. The bridge promise used to have
   * exactly one settle path — the `.then` — because a comment asserted that
   * repl.evaluate never rejects. That is a claim about someone else's
   * function, and the whole failure follows from it being false ONCE: the
   * promise never settles, `runExclusiveEval` holds its gate against every
   * later caller, and the snapshot publish sequenced behind it never runs. The
   * Song view then reads "No song to map yet — press play." about a loaded
   * document, permanently, with nothing logged anywhere.
   *
   * ⚠ On the unfixed engine this test does not fail with a wrong value — it
   * HANGS, and vitest's own timeout is what reddens it. That is the honest
   * shape: the defect is a promise that never settles, so the assertion is
   * that control returns at all.
   */
  it('settles instead of hanging when repl.evaluate REJECTS (#1193)', async () => {
    const engine = new StrudelEngine()
    await engine.init()

    // Reaching the next line at all is the property under test.
    await engine.evaluate('reject-code')

    // And the gate must be free afterwards: a second evaluate has to run, or
    // the hang has merely moved from the first caller to every later one.
    evalBehavior = 'one-track'
    await engine.evaluate('one-track')
    expect(engine.getTrackSchedulers().size).toBeGreaterThan(0)
  })

  it('skips muted patterns _x and x_ (TRACK-04)', async () => {
    evalBehavior = 'muted'
    const engine = new StrudelEngine()
    await engine.init()
    await engine.evaluate('muted-code')
    const map = engine.getTrackSchedulers()
    expect(map.has('_muted')).toBe(false)
    expect(map.has('muted_')).toBe(false)
    expect(map.size).toBe(0)
  })

  it('re-evaluate replaces map entirely', async () => {
    evalBehavior = 'two-anon'
    const engine = new StrudelEngine()
    await engine.init()
    await engine.evaluate('two-anon')
    expect(engine.getTrackSchedulers().size).toBe(2)
    evalBehavior = 'one-track'
    await engine.evaluate('one-track')
    expect(engine.getTrackSchedulers().size).toBe(1)
  })

  it('mixed $: and named patterns produce correct keys (TRACK-04)', async () => {
    evalBehavior = 'mixed'
    const engine = new StrudelEngine()
    await engine.init()
    await engine.evaluate('mixed')
    const map = engine.getTrackSchedulers()
    expect(map.has('$0')).toBe(true)
    expect(map.has('d1')).toBe(true)
    expect(map.size).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// #364 (350b) — `.viz('name', { backdrop: true })` as a code-override.
// The backdrop flag routes a named inline viz to the backdrop slot
// (engine `backdropVizRequest` → `components.inlineViz.backdropRequest`),
// the same channel the non-underscore `.scope()`/`.pianoroll()` methods feed.
// Without the flag, `.viz('name')` stays an inline zone (vizRequests) and the
// backdrop stays empty.
// ---------------------------------------------------------------------------

describe('StrudelEngine .viz() backdrop flag (#364)', () => {
  beforeEach(() => {
    patternInstanceCounter = 0
    capturedOnEvalError = null
    evalBehavior = 'two-anon'
    vi.clearAllMocks()
  })

  afterEach(() => {
    const desc = Object.getOwnPropertyDescriptor(MockPattern.prototype, 'p')
    if (desc?.set) delete (MockPattern.prototype as any).p
  })

  it('`.viz(name, { backdrop: true })` sets the backdrop request, not an inline zone', async () => {
    evalBehavior = 'viz-backdrop-flag'
    const engine = new StrudelEngine()
    await engine.init()
    await engine.evaluate('viz-backdrop-flag')

    const inlineViz = engine.components.inlineViz
    expect(inlineViz?.backdropRequest).toEqual({
      vizId: 'pianoroll',
      // opacity/quality ride along in the same options bag (#365 applies them).
      options: { backdrop: true, opacity: 0.5 },
    })
    // The flagged viz must NOT also register as an inline zone request.
    expect(inlineViz?.vizRequests.size ?? 0).toBe(0)
  })

  it('`.viz(name)` with no flag stays inline — backdrop request stays undefined', async () => {
    evalBehavior = 'viz-inline-no-flag'
    const engine = new StrudelEngine()
    await engine.init()
    // Code must carry a `$:` line — the exposed vizRequests map is built by
    // line-scanning lastEvaluatedCode (buildVizRequestsWithLines).
    await engine.evaluate('$: spectrum')

    const inlineViz = engine.components.inlineViz
    // Inline request registered for the track; no backdrop promotion.
    expect(inlineViz?.vizRequests.get('$0')?.vizId).toBe('spectrum')
    expect(inlineViz?.backdropRequest).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// Per-track AnalyserNode producer (T-02, issue #19)
// ---------------------------------------------------------------------------

describe('StrudelEngine per-track analysers', () => {
  beforeEach(() => { patternInstanceCounter = 0 })

  it('populates audio.trackAnalysers after evaluate — one per captured pattern', async () => {
    evalBehavior = 'two-anon'
    const engine = new StrudelEngine()
    await engine.init()
    await engine.evaluate('two-anon')
    const { audio } = engine.components
    expect(audio?.trackAnalysers).toBeDefined()
    expect(audio!.trackAnalysers!.size).toBe(2)
    expect(audio!.trackAnalysers!.has('$0')).toBe(true)
    expect(audio!.trackAnalysers!.has('$1')).toBe(true)
    // Distinct analyser instances per track.
    const a = audio!.trackAnalysers!.get('$0')
    const b = audio!.trackAnalysers!.get('$1')
    expect(a).not.toBe(b)
  })

  it('analysers are side-taps — no destination wiring, just orbit.output.connect(analyser)', async () => {
    evalBehavior = 'one-named'
    const { getSuperdoughAudioController } = await import('@strudel/webaudio') as any
    const engine = new StrudelEngine()
    await engine.init()
    await engine.evaluate('one-named')
    const controller = getSuperdoughAudioController()
    // getOrbit was invoked to resolve each captured pattern's orbit
    expect(controller.getOrbit).toHaveBeenCalled()
    // The orbit's output GainNode received a .connect(analyser) call
    const analyser = engine.components.audio!.trackAnalysers!.get('d1')!
    // Find the orbit the engine tapped (any orbit whose output.connect was called with this analyser)
    const connectCalls = (controller.getOrbit as any).mock.results
      .flatMap((r: any) => (r.value.output.connect as any).mock.calls)
    expect(connectCalls.some((c: any[]) => c[0] === analyser)).toBe(true)
  })

  it('reuses existing analyser when re-evaluating identical code (no churn)', async () => {
    evalBehavior = 'one-named'
    const engine = new StrudelEngine()
    await engine.init()
    await engine.evaluate('one-named')
    const first = engine.components.audio!.trackAnalysers!.get('d1')!
    await engine.evaluate('one-named')
    const second = engine.components.audio!.trackAnalysers!.get('d1')!
    expect(second).toBe(first)
  })

  it('removes + disconnects analyser when its track disappears on re-evaluate', async () => {
    evalBehavior = 'two-anon'
    const engine = new StrudelEngine()
    await engine.init()
    await engine.evaluate('two-anon')
    const stale = engine.components.audio!.trackAnalysers!.get('$1')!
    expect(engine.components.audio!.trackAnalysers!.size).toBe(2)
    evalBehavior = 'one-track'
    await engine.evaluate('one-track')
    expect(engine.components.audio!.trackAnalysers!.size).toBe(1)
    expect(stale.disconnect).toHaveBeenCalled()
  })

  it('dispose() disconnects all per-track analysers and clears the map', async () => {
    evalBehavior = 'two-anon'
    const engine = new StrudelEngine()
    await engine.init()
    await engine.evaluate('two-anon')
    const a = engine.components.audio!.trackAnalysers!.get('$0')!
    const b = engine.components.audio!.trackAnalysers!.get('$1')!
    engine.dispose()
    expect(a.disconnect).toHaveBeenCalled()
    expect(b.disconnect).toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// LiveCodingEngine interface conformance
// ---------------------------------------------------------------------------

describe('StrudelEngine LiveCodingEngine conformance', () => {
  it('satisfies LiveCodingEngine interface (compile-time + runtime)', () => {
    // Compile-time check: if this file compiles, the interface is satisfied
    const engine: LiveCodingEngine = new StrudelEngine()
    expect(engine.init).toBeDefined()
    expect(engine.evaluate).toBeDefined()
    expect(engine.play).toBeDefined()
    expect(engine.stop).toBeDefined()
    expect(engine.dispose).toBeDefined()
    expect(engine.components).toBeDefined()
    expect(engine.setRuntimeErrorHandler).toBeDefined()
    engine.dispose()
  })

  it('has components getter that returns object', () => {
    const engine = new StrudelEngine()
    expect(engine.components).toBeDefined()
    expect(typeof engine.components).toBe('object')
    engine.dispose()
  })

  it('components.streaming.hapStream is defined before init', () => {
    const engine = new StrudelEngine()
    const { streaming } = engine.components
    expect(streaming).toBeDefined()
    expect(streaming!.hapStream).toBeDefined()
    expect(typeof streaming!.hapStream.on).toBe('function')
    expect(typeof streaming!.hapStream.off).toBe('function')
    engine.dispose()
  })
})

// ---------------------------------------------------------------------------
// #384 — transport seek offset. The field + getter/setter are pure (no audio
// env), so they're unit-testable on a bare engine. The `.late()` wrap they
// drive at the `.p` seam is exercised end-to-end (design §10), not here.
// ---------------------------------------------------------------------------
describe('StrudelEngine transport offset (#384)', () => {
  it('defaults to 0 before any seek', () => {
    const engine = new StrudelEngine()
    expect(engine.getTransportOffset()).toBe(0)
    engine.dispose()
  })

  it('setTransportOffset round-trips through getTransportOffset', () => {
    const engine = new StrudelEngine()
    engine.setTransportOffset(7)
    expect(engine.getTransportOffset()).toBe(7)
    engine.setTransportOffset(-2.5)
    expect(engine.getTransportOffset()).toBe(-2.5)
    engine.dispose()
  })

  it('coerces a non-finite offset to 0 (NaN/Infinity guard)', () => {
    const engine = new StrudelEngine()
    engine.setTransportOffset(5)
    engine.setTransportOffset(Number.NaN)
    expect(engine.getTransportOffset()).toBe(0)
    engine.setTransportOffset(Number.POSITIVE_INFINITY)
    expect(engine.getTransportOffset()).toBe(0)
    engine.dispose()
  })
})

// ---------------------------------------------------------------------------
// getTimelineEvents — the SONG frame (#863)
// ---------------------------------------------------------------------------
// The Song timeline draws its static marks on a song-absolute axis, inside lanes
// and clips derived from the (unshifted) static IR. A seek wraps every captured
// pattern in `.late(transportOffset)` so audio and the live playhead stay in one
// scheduler frame — so reading the marks off `trackSchedulers` slid them by the
// offset and desynced them from their own lanes. `getTimelineEvents` must read
// the pre-wrap SONG pattern instead; the live surfaces keep the shifted one.
describe('StrudelEngine.getTimelineEvents (song frame, #863)', () => {
  beforeEach(() => {
    patternInstanceCounter = 0
    capturedOnEvalError = null
    evalBehavior = 'one-track'
    vi.clearAllMocks()
  })

  it('returns no events before the first evaluate', () => {
    const engine = new StrudelEngine()
    expect(engine.getTimelineEvents(4)).toEqual([])
    engine.dispose()
  })

  // #1107 — THE BOUNDARY PAIR. The Song analysis refuses a period while a
  // declared track has produced no onset yet, and it decides that by comparing
  // `getSongTrackIds()` against the `trackId`s `getTimelineEvents` stamps. If
  // those two ever describe different track sets the failure is SILENT and
  // one-directional: a key that never appears is read as a track that has not
  // played, so every document with one would grow to the 256-cycle cap and be
  // drawn as aperiodic — no error, no warning, just a worse view. Asserted here,
  // at the one place that owns both.
  it('reports the same track ids it stamps on timeline events', async () => {
    const engine = new StrudelEngine()
    await engine.init()
    expect(engine.getSongTrackIds()).toEqual([])
    await engine.evaluate('one-track')
    const ids = engine.getSongTrackIds()
    expect(ids.length).toBeGreaterThan(0)
    const stamped = new Set(engine.getTimelineEvents(4).map((e) => e.trackId))
    // Every stamped key is declared. The converse does NOT hold and must not be
    // asserted: a registered track that is silent over the queried window stamps
    // nothing, which is exactly the state the analysis needs to be able to see.
    for (const key of stamped) expect(ids).toContain(key)
    engine.dispose()
  })

  it('is song-absolute at offset 0 (the frames coincide)', async () => {
    const engine = new StrudelEngine()
    await engine.init()
    await engine.evaluate('one-track')
    const evs = engine.getTimelineEvents(4)
    expect(evs.length).toBe(1)
    expect(evs[0].begin).toBe(0)
    engine.dispose()
  })

  it('stays song-absolute AFTER a seek, while the track schedulers shift', async () => {
    const engine = new StrudelEngine()
    await engine.init()
    // A seek: the transport offset is applied at the next evaluate (the `.late`
    // wrap lives at the engine's `.p` capture seam).
    engine.setTransportOffset(2)
    await engine.evaluate('one-track')

    // DISPLAY frame — unmoved: song cycle 0 is still song cycle 0.
    const marks = engine.getTimelineEvents(4)
    expect(marks.length).toBe(1)
    expect(marks[0].begin).toBe(0)

    // LIVE frame — still shifted by the offset, as the audio/playhead/viz need.
    const sched = engine.getTrackSchedulers().get('$0')!
    expect(sched.query(0, 4)[0].begin).toBe(2)
    engine.dispose()
  })

  // -------------------------------------------------------------------------
  // Loop locators (#1570) — the wrap, and the frame it must not reach.
  // -------------------------------------------------------------------------
  // These are WIRING assertions: which wraps were applied, in which order, to
  // which frame. What `ribbon` actually does to time is asserted against the
  // real @strudel/core in `__tests__/transportFrame.test.ts`.
  //
  // ⚠ The order and the placement are both load-bearing, and both fail SILENTLY:
  // a ribbon applied after `.late` cuts a span the user never set, and a ribbon
  // that reaches the SONG frame folds the looped bars across the whole song axis
  // — the marks repeat under the lanes, which is #863 wearing a different hat.
  it('wraps the SCHEDULER-frame pattern in .ribbon when a loop is armed', async () => {
    const engine = new StrudelEngine()
    await engine.init()
    engine.setLoopRange({ startCycle: 3, cycles: 2 })
    await engine.evaluate('one-track')

    const sched = engine.getTrackSchedulers().get('$0')!
    const hap = sched.query(0, 4)[0] as unknown as { params?: { transportOps?: string[] } }
    expect(hap.params?.transportOps).toEqual(['ribbon(3,2)'])
    engine.dispose()
  })

  it('applies the ribbon BEFORE the seek wrap, not after', async () => {
    const engine = new StrudelEngine()
    await engine.init()
    engine.setLoopRange({ startCycle: 3, cycles: 2 })
    engine.setTransportOffset(1)
    await engine.evaluate('one-track')

    const sched = engine.getTrackSchedulers().get('$0')!
    const hap = sched.query(0, 4)[0] as unknown as { params?: { transportOps?: string[] } }
    // The offset is a scheduler-frame shift of the already-cut ribbon. Reversed,
    // it would shift the cut instead and the loop would sound the wrong bars.
    expect(hap.params?.transportOps).toEqual(['ribbon(3,2)', 'late(1)'])
    engine.dispose()
  })

  it('leaves the SONG frame unlooped, so the marks stay song-absolute', async () => {
    const engine = new StrudelEngine()
    await engine.init()
    engine.setLoopRange({ startCycle: 3, cycles: 2 })
    engine.setTransportOffset(1)
    await engine.evaluate('one-track')

    const marks = engine.getTimelineEvents(4) as unknown as Array<{
      begin: number
      params?: { transportOps?: string[] }
    }>
    expect(marks.length).toBe(1)
    expect(marks[0].begin).toBe(0) // unmoved by either wrap
    expect(marks[0].params?.transportOps).toBeUndefined()
    engine.dispose()
  })

  it('applies NO ribbon with no loop armed (the control for the arms above)', async () => {
    const engine = new StrudelEngine()
    await engine.init()
    engine.setTransportOffset(1)
    await engine.evaluate('one-track')

    const sched = engine.getTrackSchedulers().get('$0')!
    const hap = sched.query(0, 4)[0] as unknown as { params?: { transportOps?: string[] } }
    expect(hap.params?.transportOps).toEqual(['late(1)'])
    engine.dispose()
  })

  it('normalises an unusable range to no loop at all', async () => {
    const engine = new StrudelEngine()
    await engine.init()
    engine.setLoopRange({ startCycle: 3, cycles: 0 }) // a drag that never moved
    expect(engine.getLoopRange()).toBeNull()
    await engine.evaluate('one-track')

    const sched = engine.getTrackSchedulers().get('$0')!
    const hap = sched.query(0, 4)[0] as unknown as { params?: { transportOps?: string[] } }
    expect(hap.params?.transportOps).toBeUndefined()
    engine.dispose()
  })

  it('clears the loop when handed null, and the next eval runs straight through', async () => {
    const engine = new StrudelEngine()
    await engine.init()
    engine.setLoopRange({ startCycle: 3, cycles: 2 })
    await engine.evaluate('one-track')
    engine.setLoopRange(null)
    expect(engine.getLoopRange()).toBeNull()
    await engine.evaluate('one-track')

    const sched = engine.getTrackSchedulers().get('$0')!
    const hap = sched.query(0, 4)[0] as unknown as { params?: { transportOps?: string[] } }
    expect(hap.params?.transportOps).toBeUndefined()
    engine.dispose()
  })

  it('re-evaluating after a seek-back returns the marks to the same place', async () => {
    const engine = new StrudelEngine()
    await engine.init()
    engine.setTransportOffset(3.5)
    await engine.evaluate('one-track')
    expect(engine.getTimelineEvents(4)[0].begin).toBe(0)
    engine.setTransportOffset(0)
    await engine.evaluate('one-track')
    expect(engine.getTimelineEvents(4)[0].begin).toBe(0)
    engine.dispose()
  })

  // #1197 — the BAND form. These assert the arc the engine actually passes to
  // `queryArc`, not a count of what came back: the mock echoes its arc into the
  // hap it returns, so `begin` IS the observed `startCycle`. That distinction is
  // the whole point — a band accessor wired to `queryArc(0, end)` returns events
  // that pass every content assertion while doing all the work the band was
  // added to avoid.
  it('queries the BAND it was given, not a prefix from zero', async () => {
    const engine = new StrudelEngine()
    await engine.init()
    await engine.evaluate('one-track')

    // The band form asks for [4, 8) — observed as the returned hap's own arc.
    const band = engine.getTimelineEventsBand(4, 8)
    expect(band.length).toBe(1)
    expect(band[0].begin).toBe(4)

    // The control: the prefix form over the same end cycle still asks from 0.
    // If the band method regressed to a prefix query these two would agree, and
    // this is the arm that separates them.
    const prefix = engine.getTimelineEvents(8)
    expect(prefix.length).toBe(1)
    expect(prefix[0].begin).toBe(0)
    expect(band[0].begin).not.toBe(prefix[0].begin)
    engine.dispose()
  })

  it('the band form stays in the SONG frame after a seek, exactly as the prefix form does', async () => {
    const engine = new StrudelEngine()
    await engine.init()
    engine.setTransportOffset(2)
    await engine.evaluate('one-track')

    // Song-absolute: band [4, 8) is still song cycles 4..8, unshifted by the
    // seek. Reading `trackSchedulers` here instead would return 6, which is the
    // #863 defect one accessor over.
    expect(engine.getTimelineEventsBand(4, 8)[0].begin).toBe(4)
    expect(engine.getTrackSchedulers().get('$0')!.query(4, 8)[0].begin).toBe(6)
    engine.dispose()
  })

  it('returns no band events before the first evaluate', () => {
    const engine = new StrudelEngine()
    expect(engine.getTimelineEventsBand(4, 8)).toEqual([])
    engine.dispose()
  })

  it('normalises a degenerate band to a non-empty arc rather than querying backwards', async () => {
    const engine = new StrudelEngine()
    await engine.init()
    await engine.evaluate('one-track')
    // end <= start, negatives and non-finite inputs must not reach queryArc as
    // an inverted or NaN arc — Strudel's behaviour there is not ours to assume.
    expect(engine.getTimelineEventsBand(5, 5)[0].begin).toBe(5)
    expect(engine.getTimelineEventsBand(-3, 2)[0].begin).toBe(0)
    expect(engine.getTimelineEventsBand(Number.NaN, 4)[0].begin).toBe(0)
    engine.dispose()
  })
})

/**
 * #815 — `init()` is guarded by a flag set at the END of a long async body, so
 * without an in-flight promise every overlapping caller passes the gate and
 * runs the whole body. That is not merely wasteful: the body assigns
 * `this.repl` near its end, so the LAST init to finish replaces whatever repl
 * the engine was holding — including one that `play()` has already started. The
 * abandoned repl keeps producing sound while every transport reader sees a
 * scheduler that was never started, which is how #1185 / #1171 present.
 *
 * ⚠ THE CONCURRENT ARM IS NOT HERE, AND THAT IS A HARNESS LIMIT, NOT A CHOICE.
 * `init()` pulls its eight strudel modules with a single `Promise.all`, and
 * vitest's mocker is not re-entrant for concurrent dynamic imports of the same
 * mocked specifier — it evaluates the REAL module instead. Driving five
 * overlapping inits here dies inside `@strudel/mondo`, then `@strudel/soundfonts`,
 * on missing exports and CJS interop, never reaching the assertion. Stubbing far
 * enough to get past that means rebuilding the ecosystem inside this file.
 * The concurrent arm therefore lives in the browser, against the real modules:
 * `packages/app/tests/engine-init-race-playhead.spec.ts`.
 *
 * What these two DO guard is the fix's own risk. Sharing an in-flight promise
 * is only safe if a rejected one is dropped; a fix that caches the promise
 * unconditionally would leave every later caller re-awaiting a failure with no
 * way back, and the retry test below is what catches that.
 */
describe('StrudelEngine.init() guard (#815)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('a second init() after one has completed does not rebuild the repl', async () => {
    // Imported here, not at module top: the `@strudel/webaudio` factory closes
    // over MockPattern, and a top-level import of a mocked module runs that
    // factory before the class declaration is initialised.
    const { webaudioRepl } = await import('@strudel/webaudio')
    const engine = new StrudelEngine()
    await engine.init()
    await engine.init()
    expect(vi.mocked(webaudioRepl)).toHaveBeenCalledTimes(1)
    engine.dispose()
  })

  it('a FAILED init does not poison the engine — a retry can still initialise', async () => {
    const { webaudioRepl } = await import('@strudel/webaudio')
    const { evalScope } = await import('@strudel/core')
    const engine = new StrudelEngine()
    vi.mocked(evalScope).mockRejectedValueOnce(new Error('init blew up'))

    await expect(engine.init()).rejects.toThrow('init blew up')
    expect(vi.mocked(webaudioRepl)).toHaveBeenCalledTimes(0)

    await expect(engine.init()).resolves.toBeUndefined()
    expect(vi.mocked(webaudioRepl)).toHaveBeenCalledTimes(1)
    engine.dispose()
  })

  /**
   * #1218 — a failed REQUIRED step arrives branded, carrying which step it was.
   *
   * The app has to tell "the engine cannot start" apart from every other
   * runtime error to decide whether to offer a reload, and the only other way
   * to do that is to match the message text — a second copy of a rule that
   * lives in `createRequiredStep`, which drifts the first time the wording is
   * improved. This arm is what makes the brand a contract rather than a detail:
   * it drives the real producer, so a rename here reddens instead of silently
   * dropping the app back to the generic error path.
   */
  it('a failed required step is branded with the step that failed (#1218)', async () => {
    // Reached through a cast rather than the destructure the test above uses:
    // that spelling carries a known `evalScope does not exist on type` error
    // (#1204's 63-error baseline), and that count is being used as a control
    // elsewhere — a new arm should not quietly add to it.
    const core = (await import('@strudel/core')) as unknown as {
      evalScope: { mockRejectedValueOnce: (e: Error) => void }
    }
    const engine = new StrudelEngine()
    core.evalScope.mockRejectedValueOnce(new Error('init blew up'))

    const err: unknown = await engine.init().then(
      () => null,
      (e: unknown) => e,
    )
    expect(isBootStepFailure(err)).toBe(true)
    expect((err as BootStepFailure).bootStep).toBe('evalScope')
    // the underlying error is annotated, never replaced — the cause survives
    expect((err as Error).message).toBe('init blew up')
    // and an ordinary failure is NOT a boot-step failure, or the app would
    // offer a reload for a typo in the user's pattern
    expect(isBootStepFailure(new Error('reference error'))).toBe(false)
    engine.dispose()
  })
})

/**
 * #1186 — evaluating must never start the transport.
 *
 * Strudel's `evaluate(code, autostart = true, …)` (@strudel/core/repl.mjs:222)
 * forwards the flag into `cyclist.setPattern(pat, autostart)`, which starts the
 * clock (cyclist.mjs:123-126). Calling it with one argument therefore meant
 * every evaluate started playback — including the one the Song view runs to
 * draw its pre-play marks, so the app emitted notes with no user gesture.
 *
 * Starting playback belongs to `play()` (step 8 of the play lifecycle) and
 * nowhere else. The argument is easy to lose in a refactor and its default is
 * the wrong one, so it is pinned here rather than left to the browser arm — the
 * browser spec proves the CONSEQUENCE, this proves the CALL.
 */
describe('StrudelEngine.evaluate() does not autostart (#1186)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('passes autostart=false to the repl, so only play() can start the clock', async () => {
    const { webaudioRepl } = await import('@strudel/webaudio')
    const engine = new StrudelEngine()
    await engine.init()
    await engine.evaluate('one-track')

    const repl = vi.mocked(webaudioRepl).mock.results[0]?.value as {
      evaluate: ReturnType<typeof vi.fn>
    }
    expect(repl.evaluate).toHaveBeenCalledWith('one-track', false)
    engine.dispose()
  })

  it('play() is what starts the scheduler', async () => {
    const { webaudioRepl } = await import('@strudel/webaudio')
    const engine = new StrudelEngine()
    await engine.init()

    const repl = vi.mocked(webaudioRepl).mock.results[0]?.value as {
      scheduler: { start: ReturnType<typeof vi.fn> }
    }
    await engine.evaluate('one-track')
    const beforePlay = repl.scheduler.start.mock.calls.length

    engine.play()
    expect(
      repl.scheduler.start.mock.calls.length,
      'play() must be the thing that starts the clock',
    ).toBe(beforePlay + 1)
    engine.dispose()
  })
})
