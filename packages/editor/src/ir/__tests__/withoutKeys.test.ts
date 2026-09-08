/**
 * `withoutKeys` — the heart of #1465's rule, tested directly.
 *
 * The sweep exercises this over 142 documents, but only through its effect on a
 * period, so a subtle mis-strip would show up there as "the rule recovered fewer
 * documents" and be read as the RULE being weak rather than the stripping being
 * wrong. These pin the mechanism itself.
 *
 * Moved here with the function when the rule shipped: it was a candidate living
 * in the sweep harness, and it is now production (`songAnalysis`).
 */
import { describe, it, expect } from 'vitest'
import type { IREvent } from '../IREvent'
import { eventValueKey } from '../eventValueKey'
import { withoutKeys } from '../songAnalysis'

const ev = (over: Partial<IREvent> = {}): IREvent =>
  ({ begin: 0, end: 1, note: 60, s: 'bd', gain: 1, params: { cutoff: 400, room: 0.2 }, ...over }) as unknown as IREvent

const K = (...k: string[]) => new Set(k)

describe('withoutKeys', () => {
  it('clears a DEDICATED slot so it reads as a constant, not as a value', () => {
    const out = withoutKeys(ev(), K('gain'))
    expect((out as unknown as Record<string, unknown>).gain).toBeUndefined()
    // The slot is still POSITIONALLY present in the key — that is what makes it
    // a constant across cycles rather than a shifted partition.
    expect(eventValueKey(out)).toContain('gain=')
  })

  it('removes a PARAMS entry outright', () => {
    const out = withoutKeys(ev(), K('cutoff'))
    expect(out.params).toEqual({ room: 0.2 })
    expect(eventValueKey(out)).not.toContain('cutoff')
  })

  it('strips from BOTH halves in one pass', () => {
    const out = withoutKeys(ev(), K('gain', 'cutoff'))
    expect((out as unknown as Record<string, unknown>).gain).toBeUndefined()
    expect(out.params).toEqual({ room: 0.2 })
  })

  it('makes two events differing ONLY on a stripped dimension compare equal', () => {
    // This is the whole mechanism: the fingerprint stops seeing the swept axis.
    const a = withoutKeys(ev({ gain: 0.2 }), K('gain'))
    const b = withoutKeys(ev({ gain: 0.9 }), K('gain'))
    expect(eventValueKey(a)).toBe(eventValueKey(b))
  })

  it('leaves events differing on an UNSTRIPPED dimension distinguishable', () => {
    // The control: stripping must not flatten everything, or every document
    // would "recover" a 1-cycle period and the rule would be worthless.
    const a = withoutKeys(ev({ gain: 0.2, note: 60 }), K('gain'))
    const b = withoutKeys(ev({ gain: 0.9, note: 67 }), K('gain'))
    expect(eventValueKey(a)).not.toBe(eventValueKey(b))
  })

  it('does not mutate the event it was given', () => {
    const original = ev()
    const before = eventValueKey(original)
    withoutKeys(original, K('gain', 'cutoff'))
    expect(eventValueKey(original)).toBe(before)
    expect(original.params).toEqual({ cutoff: 400, room: 0.2 })
  })

  it('returns the SAME object when nothing matches, so a sweep allocates nothing', () => {
    const original = ev()
    expect(withoutKeys(original, K('nosuchkey'))).toBe(original)
    expect(withoutKeys(original, K())).toBe(original)
  })

  it('tolerates an event with no params at all', () => {
    const bare = ev({ params: undefined })
    expect(() => withoutKeys(bare, K('cutoff', 'gain'))).not.toThrow()
  })
})
