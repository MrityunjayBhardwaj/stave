/**
 * #1463 — the AUTHORITY arm for `steppedAutomation.ts`.
 *
 * The unit file proves the reader agrees with the PARSER. This one proves both
 * agree with what PLAYS: the same document is read statically and evaluated
 * through the real transpiler with the engine's own string-parser rule, and the
 * value the reader says step `stepIndexAtCycle(c)` holds must be the value every
 * event in cycle `c` carries. Then an edit is applied and the check is repeated —
 * so "the edit changes exactly the cycles that step owns" is observed in the
 * engine rather than inferred from offsets.
 *
 * Setup mirrors `engine/__tests__/stringParser.test.ts`, the file that grounds the
 * string rule: evalScope + `installMiniStringParser` + the transpiler.
 */
import { describe, it, expect } from 'vitest'
import { parseStrudel } from '../parseStrudel'
import { steppedAutomations, stepIndexAtCycle, stepValueEdit, type SteppedAutomation } from '../steppedAutomation'
import { clearStringParser, installMiniStringParser } from '../../engine/stringParser'

/* eslint-disable @typescript-eslint/no-explicit-any */

/** The value of `key` on every onset event in each cycle [0, cycles), via the real engine. */
async function valuesPerCycle(code: string, key: string, cycles: number): Promise<unknown[][]> {
  const core: any = await import('@strudel/core')
  const mini: any = await import('@strudel/mini')
  await core.evalScope(core, mini)
  installMiniStringParser({ core, mini })
  try {
    const { transpiler }: any = await import('@strudel/transpiler')
    const out = await core.evaluate(code, transpiler)
    const pat = out.pattern ?? out
    const rows: unknown[][] = []
    for (let c = 0; c < cycles; c++) {
      const haps = pat.queryArc(c, c + 1).filter((h: any) => h.hasOnset?.() ?? true)
      rows.push(haps.map((h: any) => h.value?.[key]))
    }
    return rows
  } finally {
    clearStringParser({ core })
  }
}

/** What the READER says each cycle plays, in the same row shape. */
function predicted(a: SteppedAutomation, eventsPerCycle: number, cycles: number): unknown[][] {
  return Array.from({ length: cycles }, (_, c) =>
    Array.from({ length: eventsPerCycle }, () => a.steps[stepIndexAtCycle(a, c)].value),
  )
}

const apply = (src: string, e: { range: [number, number]; text: string }) =>
  src.slice(0, e.range[0]) + e.text + src.slice(e.range[1])

describe('#1463 — the reader agrees with what the engine plays', () => {
  it.each([
    ['double quotes', 's("bd*2").gain("<0.2 0.8>")'],
    ['single quotes', "s(\"bd*2\").gain('<0.2 0.8>')"],
    ['backticks', 's("bd*2").gain(`<0.2 0.8>`)'],
    ['a weighted step', 's("bd*2").gain("<0.2@2 0.8 0.5>")'],
    ['an aliased control', 's("bd*2").lpf("<200 2000 800>")'],
  ])('%s', async (_label, code) => {
    const [a] = steppedAutomations(parseStrudel(code) as never)
    expect(a, 'the reader found no stepped parameter').toBeDefined()
    // `lpf` arrives on the event as the canonical `cutoff` — the reader's paramKey.
    const cycles = a.periodCycles * 2
    expect(await valuesPerCycle(code, a.paramKey, cycles)).toEqual(predicted(a, 2, cycles))
  }, 60_000)

  it('a declined shape really does NOT hold one value per cycle — the control', async () => {
    // The reader declines `<0.2 [0.4 0.8]>`; the engine confirms cycle 1 carries
    // two different values, so there was no single step to draw.
    const code = 's("bd*2").gain("<0.2 [0.4 0.8]>")'
    expect(steppedAutomations(parseStrudel(code) as never)).toEqual([])
    expect(await valuesPerCycle(code, 'gain', 2)).toEqual([[0.2, 0.2], [0.4, 0.8]])
  }, 60_000)

  it('a concatenated literal the parser reads as steps does NOT play them — why the reader checks the whole argument', async () => {
    const code = 's("bd*2").gain("<0.2 0.8>" + "")'
    expect(steppedAutomations(parseStrudel(code) as never)).toEqual([])
    // The transpiler turns each double-quoted string into a pattern BEFORE the
    // `+` runs, so the argument is no longer the alternation. Whatever it does
    // play, it is not 0.2 then 0.8 — which is the only claim this arm makes.
    const rows = await valuesPerCycle(code, 'gain', 2).catch(() => null)
    expect(rows).not.toEqual([[0.2, 0.2], [0.8, 0.8]])
  }, 60_000)

  it('an override the reader declines really does silence the steps', async () => {
    const code = 's("bd*2").gain("<0.2 0.8>").gain(0.5)'
    expect(steppedAutomations(parseStrudel(code) as never)).toEqual([])
    expect(await valuesPerCycle(code, 'gain', 2)).toEqual([[0.5, 0.5], [0.5, 0.5]])
  }, 60_000)
})

describe('#1463 — an override through structure', () => {
  it('a call on the whole stack overrides the steps inside it', async () => {
    const code = 'stack(s("bd*2").gain("<0.2 0.8>"), s("hh*2")).gain(0.5)'
    expect(steppedAutomations(parseStrudel(code) as never)).toEqual([])
    // Every event — bd and hh alike — carries the outer 0.5 in both cycles.
    const rows = await valuesPerCycle(code, 'gain', 2)
    expect(rows.flat().every((v) => v === 0.5)).toBe(true)
    expect(rows.flat().length).toBe(8)
  }, 60_000)
})

describe('#1463 — an edit changes exactly the cycles its step owns', () => {
  it('editing the weighted step moves every cycle it plays, and no other', async () => {
    const code = 's("bd*2").gain("<0.2@2 0.8>")'
    const [a] = steppedAutomations(parseStrudel(code) as never)
    const next = apply(code, stepValueEdit(a, 0, 0.6)!)
    expect(next).toBe('s("bd*2").gain("<0.6@2 0.8>")')

    const before = await valuesPerCycle(code, 'gain', 6)
    const after = await valuesPerCycle(next, 'gain', 6)
    expect(before).toEqual([[0.2, 0.2], [0.2, 0.2], [0.8, 0.8], [0.2, 0.2], [0.2, 0.2], [0.8, 0.8]])
    // Cycles 0,1,3,4 belong to step 0 and moved; cycles 2,5 belong to step 1 and did not.
    expect(after).toEqual([[0.6, 0.6], [0.6, 0.6], [0.8, 0.8], [0.6, 0.6], [0.6, 0.6], [0.8, 0.8]])

    // And the reader, re-run on the edited document, predicts the engine again.
    const [b] = steppedAutomations(parseStrudel(next) as never)
    expect(after).toEqual(predicted(b, 2, 6))
  }, 60_000)
})
