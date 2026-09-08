/**
 * `measureSongLength` — the branch that decides what a bounce can offer (#1365).
 *
 * ── WHY THESE ARMS AND NOT A MOCK OF `analyzeSong` ───────────────────────────
 * The whole value of this module is that it distinguishes a MEASURED period from
 * a horizon the analysis gave up at, and that distinction is made by
 * `analyzeSong`. Stubbing it would leave these arms asserting that a switch
 * statement routes three literals — green with the real decision entirely
 * absent. So the real `songExtent` and the real `analyzeSong` are imported by
 * SOURCE PATH (the barrel pulls `gifenc` and breaks the app's vitest loader —
 * the same route the corpus tests take) and driven with synthetic onsets.
 *
 * The collector is the one injected stub. Its correctness is already pinned next
 * door by `songCollector.test.ts`; re-testing the band rule here would duplicate
 * that, and what these arms need is control over the ONSETS analysis sees.
 */
import { describe, it, expect } from 'vitest'
import { IR, type PatternIR } from '../../../../editor/src/ir/PatternIR'
import { songExtent } from '../../../../editor/src/ir/songExtent'
import { analyzeSong, signalDimensionsOf } from '../../../../editor/src/ir/songAnalysis'
import type { IREvent } from '../../../../editor/src/ir/IREvent'
import {
  measureSongLength,
  cyclesToSeconds,
  bounceOffers,
  formatDuration,
  MAX_BOUNCE_SECONDS,
  type SongLengthDeps,
  type BounceSizing,
  type SongIRs,
} from '../songLength'

const bd = IR.play('bd')
const arm = (weight: number, pattern: PatternIR = bd) => ({ weight, pattern })

function ev(begin: number, s: string): IREvent {
  return {
    begin,
    end: begin + 0.25,
    endClipped: begin + 0.25,
    note: null,
    freq: null,
    s,
    trackId: 'd1',
  } as unknown as IREvent
}

/**
 * Deps wired to the REAL editor functions, with a collector yielding `onsets`
 * clipped to the requested band. `analyzeSong` walks adjacent bands as its
 * horizon grows, so the band filter matters: without it every onset would be
 * returned for every band and the fingerprints would be meaningless.
 */
function depsWith(onsets: IREvent[]): SongLengthDeps {
  return {
    songExtent,
    analyzeSong,
    signalDimensionsOf,
    createCollector: () => ({
      collectFn: (startCycle, endCycle) =>
        onsets.filter((e) => e.begin >= startCycle && e.begin < endCycle),
      hasUnheardTrack: undefined,
    }),
  }
}

/**
 * The same IR for both views — the shape every pre-#1373 caller assumed.
 * Only tests about the STRUCTURE/MEASUREMENT split pass the two apart.
 */
function both(ir: PatternIR): SongIRs {
  return { structural: ir, analysis: ir }
}

/** `n` cycles of the SAME sound — fingerprints repeat, so a period is findable. */
function repeating(cycles: number): IREvent[] {
  return Array.from({ length: cycles }, (_, c) => ev(c, 'bd'))
}

/** Every cycle different, so no fingerprint ever repeats and analysis gives up. */
function everChanging(cycles: number): IREvent[] {
  return Array.from({ length: cycles }, (_, c) => ev(c, `s${c}`))
}

describe('measureSongLength — the three answers a bounce can act on', () => {
  it('a document with no IR is `no-document`, not a zero-length song', async () => {
    // The same distinction `songExtent` is typed for, one layer up: a bounce
    // must not read "nothing to measure" as "measured zero".
    expect(await measureSongLength({ structural: null, analysis: null }, depsWith([]))).toEqual({
      kind: 'unknown',
      why: 'no-document',
    })
  })

  it('an arrangement gives a definite length, WITHOUT consulting the analysis', async () => {
    const ir = IR.arrange('arrange', [arm(4), arm(8), arm(16)])
    // Deps whose analyzeSong would throw if reached — the arrangement branch
    // must not depend on anything having been evaluated or heard.
    const deps: SongLengthDeps = {
      songExtent,
      signalDimensionsOf,
      analyzeSong: () => {
        throw new Error('analyzeSong must not be reached for an arrangement')
      },
      createCollector: () => ({ collectFn: undefined, hasUnheardTrack: undefined }),
    }
    expect(await measureSongLength({ structural: ir, analysis: null }, deps)).toEqual({
      kind: 'arranged',
      cycles: 28,
    })
  })

  it('an arrangement wins over a period that disagrees with it (#1373)', async () => {
    // THE ARM THAT WOULD HAVE CAUGHT #1373. Before it, the structural question
    // was asked of the published snapshot, whose pass pipeline leaves a
    // top-level `arrange(...)` as an opaque `Code` — so `songExtent` answered
    // `loop` for every document and this branch never fired in the running app.
    //
    // It hid because on a simple arrangement the two numbers COINCIDE:
    // `arrange([4,a],[8,b],[4,c])` has Σ weights 16 and a measured period of
    // 16. Here they are deliberately pulled apart — a 28-cycle arrangement over
    // content that repeats every cycle — so only a reader of the STRUCTURAL IR
    // can get 28. Measured live: a 104-cycle song whose bass alternates over 4
    // was offered an 8-second bounce.
    const arranged = IR.arrange('arrange', [arm(4), arm(8), arm(16)])
    const result = await measureSongLength(
      { structural: arranged, analysis: bd },
      depsWith(repeating(64)),
    )
    expect(result).toEqual({ kind: 'arranged', cycles: 28 })
  })

  it('sizes an arrangement that has never been evaluated', async () => {
    // Structure needs no playback, so a song can be sized before a note sounds.
    // The old shape could not express this: one IR meant no analysis IR was the
    // same as no document.
    const arranged = IR.arrange('arrange', [arm(2), arm(2)])
    expect(
      await measureSongLength({ structural: arranged, analysis: null }, depsWith([])),
    ).toEqual({ kind: 'arranged', cycles: 4 })
  })

  it('an unevaluated document with no arrangement is `no-document`, not `silent`', async () => {
    // The period path genuinely needs the snapshot. Absent it there is nothing
    // to measure, which is not the same as measuring and hearing nothing.
    expect(
      await measureSongLength({ structural: bd, analysis: null }, depsWith([])),
    ).toEqual({ kind: 'unknown', why: 'no-document' })
  })

  it('a repeating loop yields its MEASURED period', async () => {
    const result = await measureSongLength(both(bd), depsWith(repeating(64)))
    expect(result.kind).toBe('loop')
    if (result.kind === 'loop') expect(result.periodCycles).toBeGreaterThan(0)
  })

  it('an aperiodic document is `no-period` — NEVER the horizon it stopped at', async () => {
    // This is the arm the module exists for. The analysis still returns a span
    // for this document; that span is where it gave up, and a bounce driven off
    // it renders a length nobody asked for. `unknown` is the honest answer.
    const result = await measureSongLength(both(bd), depsWith(everChanging(300)))
    expect(result).toEqual({ kind: 'unknown', why: 'no-period' })
  })

  it('a document with no onsets at all is `silent`, distinct from unmeasurable', async () => {
    // Two different situations for the user: nothing to bounce, versus something
    // to bounce whose length we cannot name. Collapsing them loses the message.
    expect(await measureSongLength(both(bd), depsWith([]))).toEqual({
      kind: 'unknown',
      why: 'silent',
    })
  })

  it('an OPAQUE arrangement declines rather than posing as a loop', async () => {
    // `songExtent` keeps `opaque` separate precisely so a caller cannot present
    // an arrangement of unknown length as an endless loop. Pinned with a stub
    // extent because a real opaque document is rare and this is the contract.
    const deps: SongLengthDeps = {
      ...depsWith(repeating(64)),
      songExtent: () => ({ kind: 'opaque' }),
    }
    expect(await measureSongLength(both(bd), deps)).toEqual({
      kind: 'unknown',
      why: 'no-period',
    })
  })

  it('an analysis that throws degrades to `no-period` rather than rejecting', async () => {
    const deps: SongLengthDeps = {
      ...depsWith([]),
      analyzeSong: () => Promise.reject(new Error('boom')),
    }
    expect(await measureSongLength(both(bd), deps)).toEqual({
      kind: 'unknown',
      why: 'no-period',
    })
  })
})

describe('cyclesToSeconds — the conversion refuses rather than guessing', () => {
  it('converts at the given tempo', () => {
    expect(cyclesToSeconds(8, 0.5)).toBe(16) // 8 cycles at 0.5 cps
    expect(cyclesToSeconds(4, 2)).toBe(2)
  })

  it('returns null when the tempo is unknown, instead of assuming a default', () => {
    // Strudel's own default is 0.5, and substituting it here would hand back a
    // confident duration for a document whose tempo was never read. The caller
    // has to decide what to do about not knowing; this function will not decide
    // for it by picking a number that is right most of the time.
    expect(cyclesToSeconds(8, null)).toBeNull()
    expect(cyclesToSeconds(8, 0)).toBeNull()
    expect(cyclesToSeconds(8, Number.NaN)).toBeNull()
  })

  it('refuses a non-positive span', () => {
    expect(cyclesToSeconds(0, 0.5)).toBeNull()
    expect(cyclesToSeconds(-4, 0.5)).toBeNull()
  })
})

describe('bounceOffers — what the user is actually shown', () => {
  const loop = (periodCycles: number, cps: number | null): BounceSizing => ({
    length: { kind: 'loop', periodCycles },
    cps,
  })

  it('offers repeats of a measured loop, each costed in wall clock', () => {
    // 8 cycles at 0.5 cps = 16s per pass.
    const { offers, note } = bounceOffers(loop(8, 0.5))
    expect(note).toBeNull()
    expect(offers.map((o) => [o.label, o.seconds])).toEqual([
      ['1 repeat', 16],
      ['2 repeats', 32],
      ['4 repeats', 64],
      ['8 repeats', 128],
    ])
  })

  it('offers the whole arrangement when the document has a definite end', () => {
    const { offers } = bounceOffers({
      length: { kind: 'arranged', cycles: 28 },
      cps: 0.5,
    })
    expect(offers).toEqual([{ id: 'whole', label: 'Whole song', seconds: 56 }])
  })

  it('declines with a REASON when no period was measured', () => {
    // The 56-of-142 case. The seconds picker still works; what the note buys is
    // the user knowing this document will not gain a length by waiting.
    const { offers, note } = bounceOffers({
      length: { kind: 'unknown', why: 'no-period' },
      cps: 0.5,
    })
    expect(offers).toEqual([])
    expect(note).toMatch(/no repeating section/i)
  })

  it('distinguishes a silent document from an unmeasurable one', () => {
    const silent = bounceOffers({ length: { kind: 'unknown', why: 'silent' }, cps: 0.5 })
    const unmeasured = bounceOffers({
      length: { kind: 'unknown', why: 'no-period' },
      cps: 0.5,
    })
    expect(silent.note).not.toEqual(unmeasured.note)
    expect(silent.note).toMatch(/no sound/i)
  })

  it('knows the length and STILL declines when the tempo is unknown', () => {
    // The reason length and cps are separate fields. Assuming Strudel's 0.5
    // default here would hand back a confident duration that is wrong for every
    // document running at any other tempo — and wrong silently.
    const { offers, note } = bounceOffers(loop(8, null))
    expect(offers).toEqual([])
    expect(note).toMatch(/tempo is not known/i)
  })

  it('drops repeats past the ceiling instead of offering an hour-long bounce', () => {
    // 300 cycles at 0.5 cps = 600s per pass — exactly the ceiling, so one fits
    // and nothing beyond it does. A bounce is real time; 8 repeats here would be
    // an 80-minute wait behind a progress bar.
    const { offers } = bounceOffers(loop(300, 0.5))
    expect(offers.map((o) => o.label)).toEqual(['1 repeat'])
    expect(offers[0].seconds).toBe(MAX_BOUNCE_SECONDS)
  })

  it('says so when even a single pass is longer than a bounce can record', () => {
    const { offers, note } = bounceOffers(loop(1000, 0.5))
    expect(offers).toEqual([])
    expect(note).toMatch(/one pass of this loop runs 33:20/i)
  })

  it('offers nothing and says nothing while the measurement is still in flight', () => {
    // `null` is "not measured yet", which must not render as a refusal.
    expect(bounceOffers(null)).toEqual({ offers: [], note: null })
  })
})

describe('formatDuration', () => {
  it('reads as minutes and seconds', () => {
    expect(formatDuration(93)).toBe('1:33')
    expect(formatDuration(8)).toBe('0:08')
    expect(formatDuration(600)).toBe('10:00')
  })
})
