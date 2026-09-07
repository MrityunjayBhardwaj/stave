/**
 * A continuous signal passed as a parameter argument reaches the IR (#1464).
 *
 * `.gain(sine.range(0.2, 0.8))`, `.lpf(sine.slow(8).range(300, 3000))`,
 * `.pan(perlin.range(0, 1))` — the class the phrase "automation lane" means in a
 * DAW — used to opaque the whole `.method(args)` call, so no surface that reads
 * the IR could see the automation at all.
 *
 * ⚠ IT WAS NEVER ABOUT SIGNAL EXPRESSIONS BEING COMPLICATED, and that is the
 * pin that matters most here. A BARE `.gain(sine)` opaqued too, while `sine` on
 * its own already parsed to a `Signal`. `parseParamArg` recognised a numeric
 * literal, a quoted identifier and a quoted mini-string; an argument that was an
 * EXPRESSION at all simply had no arm. So the fix adds the arm rather than
 * special-casing signals, which would answer one question in two places.
 *
 * MEASURED over 329 distinct documents (`ref/bakery-runs-inputs`, by content
 * hash): a signal is passed as a chain-method argument at **481 call sites
 * across 123 documents** — about a third of all real code — and before this arm
 * exactly **2** reached a `Param`.
 *
 * ⚠ CORRECTED — the figures first written here compared against the WRONG
 * commit. They took their "before" from #1475's readings, which predate the
 * `.slice()` commit this branch actually sits on. Re-measured with both parsers
 * loaded in ONE pass over the same documents, so neither half is remembered:
 * `Param` carrying a `Signal` **0 -> 541**, corpus `Code` **2662 -> 2616**,
 * `Play` leaves **26982 -> 27154**. Opacity down, structure up, nothing lost.
 *
 * ⚠ And `Code` falls only slightly, because this arm relocates opacity inward
 * rather than removing it — `.range(...)` stays unmodelled underneath. #1481
 * finishes that, and takes `Code` 2616 -> 2147.
 *
 * ⚠ AND THE NUMBER THAT NEARLY WENT THE OTHER WAY. Counting `Param` nodes by
 * class through the parser alone said "2 continuous against ~600 stepped", which
 * reads as *continuous automation is written by almost nobody* and would have
 * argued for deprioritising the whole class. That was measuring the IR's
 * blindness, not the corpus. Only counting the SOURCE too, and comparing, caught
 * it. A census taken through the thing you are about to change cannot tell you
 * how much there is to change.
 */
import { describe, it, expect } from 'vitest'
import { parseStrudel } from '../parseStrudel'
import { toStrudel } from '../toStrudel'
import type { PatternIR } from '../PatternIR'

function tags(n: unknown, acc: string[] = []): string[] {
  if (Array.isArray(n)) { n.forEach((x) => tags(x, acc)); return acc }
  if (!n || typeof n !== 'object') return acc
  const o = n as Record<string, unknown>
  if (typeof o.tag === 'string') acc.push(String(o.tag))
  for (const [k, v] of Object.entries(o)) {
    if (k === 'loc' || k === 'keyLoc' || k === 'callSiteRange') continue
    tags(v, acc)
  }
  return acc
}
const has = (code: string, tag: string) => tags(parseStrudel(code)).includes(tag)

describe('#1464 — a signal argument reaches a Param', () => {
  it('a bare signal argument is modelled, not opaqued', () => {
    // The row that located the boundary: no `.range()`, and still lost.
    expect(has('s("bd").gain(sine)', 'Param')).toBe(true)
    expect(has('s("bd").gain(sine)', 'Signal')).toBe(true)
    expect(has('s("bd").pan(rand)', 'Param')).toBe(true)
  })

  it('the idioms real documents write', () => {
    for (const code of [
      's("bd").gain(sine.range(0.3,0.8))',
      's("bd").gain(perlin.range(0.3,0.8))',
      's("bd").gain(rand.range(0.5,0.9))',
      's("bd").lpf(sine.range(400,1200).slow(8))',
      's("bd").delay(sine.range(0,0.5).slow(18))',
    ]) {
      expect(has(code, 'Param'), code).toBe(true)
      expect(has(code, 'Signal'), code).toBe(true)
    }
  })

  it("the signal's RATE is structural, which is what a parameterised editor needs", () => {
    // #1464 option 2 edits shape / rate / range as controls. Rate arrives here.
    expect(has('s("bd").gain(sine.slow(4))', 'Slow')).toBe(true)
    expect(has('s("bd").gain(sine.fast(4))', 'Fast')).toBe(true)
    expect(has('s("bd").lpf(sine.range(400,1200).slow(8))', 'Slow')).toBe(true)
  })

  it('round-trips verbatim — Param regenerates from rawArgs', () => {
    for (const code of [
      's("bd").gain(sine)',
      's("bd").gain(sine.range(0.3,0.8))',
      's("bd").lpf(sine.range(400,1200).slow(8))',
      's("bd").gain(saw.range(0,1).fast(4).pow(2))',
      's("bd").gain(sine.mul(0.5))',
    ]) {
      expect(toStrudel(parseStrudel(code)), code).toBe(code)
    }
  })

  it('an argument that still resolves to bare Code keeps the old fallback', () => {
    // P67 — wrapping an opaque value in a Param would claim a reading we do not
    // have. The whole-call fallback is still the honest answer there.
    const ir = parseStrudel('s("bd").gain(someUnknownThing(1,2,3))')
    expect(tags(ir).includes('Param')).toBe(false)
    expect(toStrudel(ir)).toBe('s("bd").gain(someUnknownThing(1,2,3))')
  })

  it('leaves the shapes that already worked exactly as they were', () => {
    expect(tags(parseStrudel('s("bd").gain(0.5)'))).toEqual(['Track', 'Param', 'Play'])
    expect(has('s("bd").gain("<0.2 0.8>")', 'Cycle')).toBe(true)
    for (const code of ['s("bd").gain(0.5)', 's("bd").gain("<0.2 0.8>")', 's("bd").s("hh")']) {
      expect(toStrudel(parseStrudel(code)), code).toBe(code)
    }
  })
})
