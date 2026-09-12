/**
 * meter — the display meter, and the guard that keeps it singular (#1565).
 *
 * The behaviour tests below are ordinary. The last block is the point of the
 * module: "four beats to the bar" was written down four times, in four files,
 * with no import between any of them, and they agreed only because every one of
 * them was 4. Nothing about a passing test suite would have told you that — so
 * the suite now reads the source and says it.
 */
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

import {
  BEATS_PER_BAR,
  TICKS_PER_BEAT,
  DEFAULT_METER,
  barNumber,
  barBeatTick,
  cpsToBpm,
  quartersPerBar,
  normalizeMeter,
  formatMeter,
  type DisplayMeter,
} from '../meter'

/** The two meters every consumer is checked against: the default, and one that
 *  is NOT 4 — the only thing that tells a wired consumer from an unwired one. */
const FOUR_FOUR = DEFAULT_METER
const THREE_FOUR: DisplayMeter = { beatsPerBar: 3, beatUnit: 4 }
const SIX_EIGHT: DisplayMeter = { beatsPerBar: 6, beatUnit: 8 }

describe('barNumber', () => {
  it('is 1-indexed — cycle 0 is bar 1 (DAW convention over Strudel numbering)', () => {
    expect(barNumber(0)).toBe(1)
    expect(barNumber(0.99)).toBe(1)
    expect(barNumber(1)).toBe(2)
    expect(barNumber(41)).toBe(42)
  })

  it('is total: a negative or non-finite cycle reads as bar 1, never NaN', () => {
    expect(barNumber(-0.25)).toBe(1)
    expect(barNumber(Number.NaN)).toBe(1)
    expect(barNumber(Number.POSITIVE_INFINITY)).toBe(1)
  })
})

describe('barBeatTick', () => {
  it('reads cycle 0 as 1.1.1', () => {
    expect(barBeatTick(0, FOUR_FOUR)).toEqual({ bar: 1, beat: 1, tick: 1 })
  })

  it('puts the half-cycle on the third beat in 4/4', () => {
    // 0.5 cycles = 2 whole beats in → 1-indexed beat 3.
    expect(barBeatTick(0.5, FOUR_FOUR)).toEqual({ bar: 1, beat: 3, tick: 1 })
  })

  it('puts the SAME half-cycle on the second beat in 3/4', () => {
    // The music has not moved; the count has. 0.5 × 3 = 1.5 beats in → beat 2,
    // half way through it → tick 3 of 4.
    expect(barBeatTick(0.5, THREE_FOUR)).toEqual({ bar: 1, beat: 2, tick: 3 })
  })

  it('counts six beats to the bar in 6/8', () => {
    expect(barBeatTick(0.5, SIX_EIGHT).beat).toBe(4)
    expect(barBeatTick(5 / 6, SIX_EIGHT).beat).toBe(6)
  })

  it('never exceeds the meter it was given', () => {
    for (const meter of [FOUR_FOUR, THREE_FOUR, SIX_EIGHT]) {
      for (let i = 0; i < 64; i++) {
        const beat = barBeatTick(i / 64, meter).beat
        expect(beat).toBeGreaterThanOrEqual(1)
        expect(beat).toBeLessThanOrEqual(meter.beatsPerBar)
      }
    }
  })

  it('subdivides the beat into ticks', () => {
    // One tick past the downbeat of bar 2.
    const oneTick = 1 / BEATS_PER_BAR / TICKS_PER_BEAT
    expect(barBeatTick(1 + oneTick, FOUR_FOUR)).toEqual({ bar: 2, beat: 1, tick: 2 })
  })

  it('reaches the last beat and the last tick of a bar', () => {
    const lastTick = 1 - 1 / BEATS_PER_BAR / TICKS_PER_BEAT
    expect(barBeatTick(lastTick, FOUR_FOUR)).toEqual({
      bar: 1,
      beat: BEATS_PER_BAR,
      tick: TICKS_PER_BEAT,
    })
  })

  it('is total: a negative or non-finite cycle reads as 1.1.1', () => {
    expect(barBeatTick(-1, FOUR_FOUR)).toEqual({ bar: 1, beat: 1, tick: 1 })
    expect(barBeatTick(Number.NaN, FOUR_FOUR)).toEqual({ bar: 1, beat: 1, tick: 1 })
  })

  it('the bar number does not move with the meter — a bar is a cycle', () => {
    for (const meter of [FOUR_FOUR, THREE_FOUR, SIX_EIGHT]) {
      expect(barBeatTick(2.4, meter).bar).toBe(3)
    }
  })
})

describe('quartersPerBar', () => {
  it('counts the quarter notes the user is declaring the bar to hold', () => {
    expect(quartersPerBar(FOUR_FOUR)).toBe(4)
    expect(quartersPerBar(THREE_FOUR)).toBe(3)
    expect(quartersPerBar(SIX_EIGHT)).toBe(3)
    expect(quartersPerBar({ beatsPerBar: 6, beatUnit: 4 })).toBe(6)
  })

  it('6/8 and 3/4 hold the same quarters — and so read the same tempo', () => {
    expect(quartersPerBar(SIX_EIGHT)).toBe(quartersPerBar(THREE_FOUR))
  })
})

describe('cpsToBpm', () => {
  it('returns null for null / undefined / NaN', () => {
    expect(cpsToBpm(null, FOUR_FOUR)).toBeNull()
    expect(cpsToBpm(undefined, FOUR_FOUR)).toBeNull()
    expect(cpsToBpm(Number.NaN, FOUR_FOUR)).toBeNull()
  })

  it('cps 0.5 → 120 BPM in 4/4 (Strudel default, unchanged)', () => {
    expect(cpsToBpm(0.5, FOUR_FOUR)).toBe(120)
  })

  it('cps 1.0 → 240 BPM in 4/4', () => {
    expect(cpsToBpm(1.0, FOUR_FOUR)).toBe(240)
  })

  it('cps 0 → 0 BPM', () => {
    expect(cpsToBpm(0, FOUR_FOUR)).toBe(0)
  })

  it('the same music reads slower in 3/4 — three longer quarters, not four', () => {
    // The bar is still 2s. Declaring three quarters in it makes each 666ms,
    // which IS 90 quarter-note BPM. Nothing about the audio changed.
    expect(cpsToBpm(0.5, THREE_FOUR)).toBe(90)
  })

  it('6/8 reads the same tempo as 3/4, not double it', () => {
    // The denominator is why: six EIGHTHS are three quarters.
    expect(cpsToBpm(0.5, SIX_EIGHT)).toBe(cpsToBpm(0.5, THREE_FOUR))
    expect(cpsToBpm(0.5, { beatsPerBar: 6, beatUnit: 4 })).toBe(180)
  })

  it('is the quarter count times a minute, not a magic number', () => {
    expect(cpsToBpm(0.75, FOUR_FOUR)).toBe(Math.round(0.75 * 60 * quartersPerBar(FOUR_FOUR)))
  })
})

describe('normalizeMeter', () => {
  it('keeps a meter Stave can draw', () => {
    expect(normalizeMeter(3, 4)).toEqual(THREE_FOUR)
    expect(normalizeMeter(6, 8)).toEqual(SIX_EIGHT)
  })

  it('falls back rather than throwing — this sits behind a numeric input', () => {
    // A half-typed value must not take the ruler down with it.
    expect(normalizeMeter(0, 4)).toEqual(FOUR_FOUR)
    expect(normalizeMeter(Number.NaN, 4)).toEqual(FOUR_FOUR)
    expect(normalizeMeter(2.5, 4)).toEqual(FOUR_FOUR)
    expect(normalizeMeter(999, 4)).toEqual(FOUR_FOUR)
    expect(normalizeMeter(3, 5)).toEqual(THREE_FOUR) // unit falls back, count survives
  })
})

describe('formatMeter', () => {
  it('writes the meter the way a musician does', () => {
    expect(formatMeter(FOUR_FOUR)).toBe('4/4')
    expect(formatMeter(SIX_EIGHT)).toBe('6/8')
  })
})

describe('exported constants', () => {
  it('BEATS_PER_BAR is 4 (D-05)', () => {
    expect(BEATS_PER_BAR).toBe(4)
  })

  it('TICKS_PER_BEAT is 4', () => {
    expect(TICKS_PER_BEAT).toBe(4)
  })
})

/**
 * ── THE GUARD ────────────────────────────────────────────────────────────────
 *
 * Two spellings of the meter, in two files, agreeing by coincidence, are what
 * this module exists to end. A behavioural test cannot see that: every one of
 * the four old spellings passed its own tests. So this reads the tree.
 *
 * Two exclusions, both deliberate:
 *
 *  - `lib/meter.ts` — the owner. It is the one file allowed to spell the meter,
 *    and the control arm below proves the scan can see it there.
 *  - `templates.ts` — Strudel DOCUMENT text, not app code. Its `setcps(130/240)`
 *    is the community idiom for writing a tempo in a pattern, a fact about what
 *    source text means rather than a choice about how Stave draws bars. The same
 *    reasoning keeps `extractBpmFromCode` out of this module: if Stave ever
 *    displays 3/4, that decoder must not move with the display meter.
 *  - `__tests__` — tests assert ABOUT the meter (this file quotes both patterns
 *    in its own control arms); they never define one.
 */
describe('#1565 — the meter is spelled in exactly one place', () => {
  const SRC = join(__dirname, '..', '..')
  const OWNER = join('lib', 'meter.ts')
  const DOCUMENT_TEXT = 'templates.ts'

  /** A second meter constant, under any name: `const BEATS_PER_ANYTHING =`. */
  const DECLARATION = /(?:export\s+)?const\s+BEATS_PER[A-Z_]*\s*=/
  /** The pre-multiplied cps↔BPM factor — 60 sec/min × 4 beats/bar, inlined. */
  const PREMULTIPLIED = /[*/]\s*240\b/

  const sourceFiles = (): string[] => {
    const out: string[] = []
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name)
        if (statSync(full).isDirectory()) {
          if (name !== '__tests__' && name !== 'node_modules') walk(full)
        } else if (name.endsWith('.ts') || name.endsWith('.tsx')) {
          out.push(full)
        }
      }
    }
    walk(SRC)
    return out
  }

  const scanned = sourceFiles().filter((f) => {
    const rel = relative(SRC, f)
    return rel !== OWNER && rel !== DOCUMENT_TEXT
  })

  it('control arm: the scan actually reaches the tree', () => {
    // A zero-hit scan and a scan that never ran look identical from the result.
    expect(scanned.length).toBeGreaterThan(100)
  })

  it('control arm: the scan SEES the meter where it is allowed to be', () => {
    const owner = readFileSync(join(SRC, OWNER), 'utf8')
    expect(DECLARATION.test(owner)).toBe(true)
  })

  it('control arm: both patterns match the spellings they describe', () => {
    expect(DECLARATION.test('export const BEATS_PER_CYCLE = 4')).toBe(true)
    expect(DECLARATION.test('const BEATS_PER_BAR = 3')).toBe(true)
    expect(PREMULTIPLIED.test('String(Math.round(cps ' + '* 240))')).toBe(true)
    expect(PREMULTIPLIED.test('bpm ' + '/ 240')).toBe(true)
    // …and do not fire on unrelated numbers.
    expect(PREMULTIPLIED.test('width: 240px')).toBe(false)
    expect(DECLARATION.test('const BEAT_MIN_PX = 14')).toBe(false)
  })

  it('no file outside lib/meter.ts declares its own beats-per-bar', () => {
    const offenders = scanned
      .filter((f) => DECLARATION.test(readFileSync(f, 'utf8')))
      .map((f) => relative(SRC, f))
    expect(
      offenders,
      `these files declare a second display meter: ${offenders.join(', ')}. ` +
        'Import BEATS_PER_BAR from lib/meter instead — two spellings agree only ' +
        'until the first time signature that is not 4/4.',
    ).toEqual([])
  })

  it('only the store reads the DEFAULT meter — everyone else reads the live one', () => {
    // The #1568 hazard, one level down from the #1565 one: a consumer that
    // imports the default instead of subscribing to the store looks perfectly
    // correct until somebody changes the setting, and then draws 4/4 beside a
    // ruler that moved. The store is the one place allowed to name the default.
    const STORE = join('state', 'displayMeter.ts')
    // Matched on the IMPORT, not on the name: a consumer can only read the
    // default by importing it, and matching the bare name would redden the arm
    // for a doc comment that merely mentions it.
    const IMPORTS_DEFAULT = /import[^;\n]*\bDEFAULT_METER\b/
    const offenders = scanned
      .filter((f) => IMPORTS_DEFAULT.test(readFileSync(f, 'utf8')))
      .map((f) => relative(SRC, f))
      .filter((rel) => rel !== STORE)
    expect(
      offenders,
      `these files read the default meter directly: ${offenders.join(', ')}. ` +
        'Subscribe to the display-meter store (or take the meter as an argument) ' +
        'so the setting reaches them.',
    ).toEqual([])
  })

  it('no file inlines the pre-multiplied cps↔BPM factor', () => {
    const offenders = scanned
      .filter((f) => PREMULTIPLIED.test(readFileSync(f, 'utf8')))
      .map((f) => relative(SRC, f))
    expect(
      offenders,
      `these files inline 60 × beats-per-bar: ${offenders.join(', ')}. ` +
        'Use cpsToBpm from lib/meter, which derives the factor from the meter.',
    ).toEqual([])
  })
})
