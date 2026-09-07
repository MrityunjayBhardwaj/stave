/**
 * A pick-spelled song's sections carry the name the musician wrote (#1467).
 *
 * `arrange([4, intro], …)` sections have been named since #1391 — the walk hands
 * the display the arm's `[n, pat]` range and the layer holding the user's code
 * reads the identifier out of it. The other spelling of an arrangement,
 * `"<intro@4 …>".pickRestart({intro, …})`, named its sections just as plainly and
 * drew `§1`, `§2`, because the `NamedPick` branch set the arm INDEX and never the
 * arm RANGE. `NamedPickEntry.keyLoc` had pointed at the key token since #463 with
 * no reader.
 *
 * ⚠ THE ARM THAT MATTERS IS `selector order differs from object order`. The
 * selector's slots and the object's keys are independent orderings, so resolving
 * the range by slot POSITION yields a real name belonging to a DIFFERENT section
 * — a wrong caption rather than a missing one, and every other arm here passes
 * while it does. The join has to be the key string.
 */
import { describe, it, expect } from 'vitest'
import { parseStrudel } from '../parseStrudel'
import { structuralWalk } from '../structuralWalk'

/** `armIndex → the source text its range covers`, over a window long enough to
 *  reach every slot of the songs below. */
function armNames(code: string, spanCycles = 32): Map<number, string> {
  const lanes = structuralWalk(parseStrudel(code), { originCycle: 0, spanCycles })
  const out = new Map<number, string>()
  for (const lane of lanes) {
    for (const [i, r] of lane.armRanges ?? []) out.set(i, code.slice(r[0], r[1]))
  }
  return out
}

const HEAD = ['let verse = s("bd*4")', 'let chorus = s("hh*8")'].join('\n')

describe('a NamedPick section knows its own name', () => {
  it('names each section after the object key it was written as', () => {
    const code = `${HEAD}\n$: "<verse@8 chorus@4>".pickRestart({verse, chorus})`
    expect(armNames(code)).toEqual(new Map([[0, 'verse'], [1, 'chorus']]))
  })

  it('resolves by key, not by slot position, when the two orders differ', () => {
    // Slot 0 is `chorus`, but `chorus` is the SECOND object key. Indexing
    // `entries[0]` here returns `verse` — a name that belongs to another section.
    const code = `${HEAD}\n$: "<chorus@4 verse@8>".pickRestart({verse, chorus})`
    expect(armNames(code)).toEqual(new Map([[0, 'chorus'], [1, 'verse']]))
  })

  it('gives a returning section the same name in every slot it occupies', () => {
    const code = `${HEAD}\n$: "<verse@8 chorus@4 verse@8>".pickRestart({verse, chorus})`
    const names = armNames(code)
    expect(names.get(0)).toBe('verse')
    expect(names.get(2)).toBe('verse')
    expect(names.get(1)).toBe('chorus')
  })

  it('reads object shorthand and the long form identically', () => {
    const short = `${HEAD}\n$: "<verse@8 chorus@4>".pickRestart({verse, chorus})`
    const long = `${HEAD}\n$: "<verse@8 chorus@4>".pickRestart({verse: verse, chorus: chorus})`
    expect([...armNames(short).values()]).toEqual([...armNames(long).values()])
  })

  it('leaves the arrange spelling exactly as it was', () => {
    const code = ['let intro = s("bd*4")', 'let verse = s("hh*8")', '$: arrange([4, intro], [8, verse])'].join('\n')
    expect(armNames(code)).toEqual(new Map([[0, '[4, intro]'], [1, '[8, verse]']]))
  })

  it('claims no name when the selector names a section the object does not define', () => {
    const code = `${HEAD}\n$: "<verse@8 missing@4>".pickRestart({verse, chorus})`
    const names = armNames(code)
    expect(names.get(0)).toBe('verse')
    expect(names.has(1)).toBe(false) // → the positional `§2`, as before
  })
})
