/**
 * `.slice(n, ipat)` reaches the IR as structure (#1352 / E2E-5).
 *
 * GROUNDED — `@strudel/core@1.2.6/pattern.mjs:3356-3373`:
 *
 *   slice(npat, ipat, opat) -> pure({ begin, end, _slices: n, ...o })
 *     begin = Array.isArray(n) ? n[i]     : i / n
 *     end   = Array.isArray(n) ? n[i + 1] : (i + 1) / n
 *
 * `chop`'s sibling, and the difference is why this node earns its place: `chop`
 * fixes the order of the slices, `slice` lets the user PATTERN it. That makes it
 * the comping primitive — reordering slices is reordering a take — which is what
 * the audio-and-vocals phase needs structural rather than opaque.
 *
 * MEASURED over 329 distinct corpus documents (`ref/bakery-runs-inputs`, by
 * content hash): 19 call `.slice(`, across 26 call sites, and every one of them
 * reached the IR as an opaque `Code` before this node existed. 16 of the 19 now
 * carry a `Slice` node (31 nodes); the other 3 are documents opaque for
 * unrelated reasons, plus the one `.slice(2)` below.
 *
 * ⚠ THE COUNT IS REFUSED STRICTLY, THE INDEX IS NOT — and they are not the same
 * kind of argument. `n` decides where every slice BOUNDARY falls, so a count we
 * cannot read leaves every slice's extent unknown and the call has to stay
 * opaque. The index pattern only says which slice plays when; an unreadable one
 * degrades to an opaque leaf inside a structured tree, which is strictly better
 * than losing the call.
 *
 * ⚠ A QUOTED MINI INDEX IS CARRIED RAW, the `Struct.mask` precedent, and this is
 * a correctness point rather than a shortcut. `parseExpression` reads a bare mini
 * string as a NOTE pattern, and these are slice INDICES. Measured before that
 * branch existed: `.slice(4, "0 1 2 3")` round-tripped to
 * `.slice(4, note("0 1 2 3"))`, and a nested index to eight levels of
 * `fastcat(note(…))`. An expression index has no such ambiguity, so it is parsed.
 */
import { describe, it, expect } from 'vitest'
import { parseStrudel } from '../parseStrudel'
import { toStrudel } from '../toStrudel'
import type { PatternIR } from '../PatternIR'

function find(ir: PatternIR, tag: string): PatternIR | null {
  let hit: PatternIR | null = null
  const walk = (n: unknown): void => {
    if (hit || !n) return
    if (Array.isArray(n)) { n.forEach(walk); return }
    if (typeof n !== 'object') return
    const o = n as Record<string, unknown>
    if (o.tag === tag) { hit = o as unknown as PatternIR; return }
    for (const [k, v] of Object.entries(o)) {
      if (k === 'loc' || k === 'keyLoc' || k === 'callSiteRange') continue
      walk(v)
    }
  }
  walk(ir)
  return hit
}
const slice = (code: string) => find(parseStrudel(code), 'Slice') as
  | (PatternIR & { n: number | readonly number[]; index: string | PatternIR })
  | null

describe('#1352 — .slice() is structural', () => {
  it('reads the slice count and the index pattern', () => {
    const s = slice('s("vox").slice(4, "0 1 2 3")')
    expect(s).not.toBeNull()
    expect(s!.n).toBe(4)
    expect(s!.index).toBe('0 1 2 3')
  })

  it('reads an explicit split-point array — upstream\'s Array.isArray branch', () => {
    const s = slice('s("x").slice([0, 0.25, 0.5, 0.75], "0 1 1 2")')
    expect(s!.n).toEqual([0, 0.25, 0.5, 0.75])
  })

  it('parses an EXPRESSION index rather than carrying it raw', () => {
    const s = slice('s("x").slice(16, irand(16).struct("x*16"))')
    expect(typeof s!.index).toBe('object')
    expect(find(s!.index as PatternIR, 'Struct')).not.toBeNull()
  })

  it('refuses a count it cannot read, and says so by staying opaque', () => {
    // A count sets every slice boundary, so guessing one draws regions that are
    // not in the sample. These keep the existing opaque fallback.
    expect(slice('s("x").slice(2)')).toBeNull()          // no index pattern at all
    expect(slice('s("x").slice(0, "0")')).toBeNull()     // zero slices
    expect(slice('s("x").slice(1.5, "0")')).toBeNull()   // not a whole number of slices
    expect(slice('s("x").slice(n, "0")')).toBeNull()     // an unresolved identifier
    expect(slice('s("x").slice([0.5, 0.2], "0")')).toBeNull() // split points out of order
  })

  it('round-trips every accepted shape byte-for-byte', () => {
    for (const code of [
      's("vox").slice(4, "0 1 2 3")',
      's("breaks165").slice(8, "0 1 <2 2*2> 3 [4 0] 5 6 7")',
      's("x").slice([0, 0.25, 0.5, 0.75], "0 1 1 2")',
      's("x").slice(16, irand(16).struct("x*16"))',
    ]) {
      expect(toStrudel(parseStrudel(code)).replace(/\s+/g, ''), code).toBe(
        code.replace(/\s+/g, ''),
      )
    }
  })

  it('round-trips the REFUSED shapes too — the fallback must not lose source', () => {
    for (const code of ['s("x").slice(2)', 's("x").slice(0, "0")', 's("x").slice(1.5, "0")']) {
      expect(toStrudel(parseStrudel(code)).replace(/\s+/g, ''), code).toBe(
        code.replace(/\s+/g, ''),
      )
    }
  })

  it('leaves its sibling chop untouched', () => {
    expect(toStrudel(parseStrudel('s("x").chop(8)'))).toBe('s("x").chop(8)')
  })
})
