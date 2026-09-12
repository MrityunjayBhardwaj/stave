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
import { join, relative, sep } from 'node:path'

import { BEATS_PER_BAR, TICKS_PER_BEAT, barNumber, barBeatTick, cpsToBpm } from '../meter'

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
    expect(barBeatTick(0)).toEqual({ bar: 1, beat: 1, tick: 1 })
  })

  it('puts the half-cycle on the third beat', () => {
    // 0.5 cycles = 2 whole beats in → 1-indexed beat 3.
    expect(barBeatTick(0.5)).toEqual({ bar: 1, beat: 3, tick: 1 })
  })

  it('subdivides the beat into ticks', () => {
    // One tick past the downbeat of bar 2.
    const oneTick = 1 / BEATS_PER_BAR / TICKS_PER_BEAT
    expect(barBeatTick(1 + oneTick)).toEqual({ bar: 2, beat: 1, tick: 2 })
  })

  it('reaches the last beat and the last tick of a bar', () => {
    const lastTick = 1 - 1 / BEATS_PER_BAR / TICKS_PER_BEAT
    expect(barBeatTick(lastTick)).toEqual({
      bar: 1,
      beat: BEATS_PER_BAR,
      tick: TICKS_PER_BEAT,
    })
  })

  it('is total: a negative or non-finite cycle reads as 1.1.1', () => {
    expect(barBeatTick(-1)).toEqual({ bar: 1, beat: 1, tick: 1 })
    expect(barBeatTick(Number.NaN)).toEqual({ bar: 1, beat: 1, tick: 1 })
  })
})

describe('cpsToBpm', () => {
  it('returns null for null / undefined / NaN', () => {
    expect(cpsToBpm(null)).toBeNull()
    expect(cpsToBpm(undefined)).toBeNull()
    expect(cpsToBpm(Number.NaN)).toBeNull()
  })

  it('cps 0.5 → 120 BPM (Strudel default)', () => {
    expect(cpsToBpm(0.5)).toBe(120)
  })

  it('cps 1.0 → 240 BPM', () => {
    expect(cpsToBpm(1.0)).toBe(240)
  })

  it('cps 0 → 0 BPM', () => {
    expect(cpsToBpm(0)).toBe(0)
  })

  it('is the meter times a minute, not a magic number', () => {
    expect(cpsToBpm(0.75)).toBe(Math.round(0.75 * 60 * BEATS_PER_BAR))
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
    return rel !== OWNER.split('/').join(sep) && rel !== DOCUMENT_TEXT
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
