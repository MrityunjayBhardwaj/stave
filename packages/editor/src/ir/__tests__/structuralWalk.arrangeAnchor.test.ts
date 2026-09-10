/**
 * The lane's arrange anchor points INTO the arrangement (#1517).
 *
 * Every clip gesture resolves its `arrange`/`cat` call from this one number:
 * `detectArrangeAt(code, arrangeOffset)`. Get it wrong and the gesture finds no
 * combinator and declines — silently, and correctly, because it was handed an
 * anchor that resolves to nothing. There is no error to catch and nothing to
 * report, which is why this went unnoticed for the whole life of clip gestures.
 *
 * The anchor used to be the SMALLEST location on the leaf, which reads "the
 * outer call begins earliest". True for nesting and for suffix wrappers. False
 * the moment an arm names a binding declared above the call — and that is the
 * majority spelling of a real arranged song.
 *
 * ⚠ THE ASSERTION IS DELIBERATELY NOT "the anchor equals N". A byte offset is an
 * implementation detail and an arm pinned to one teaches nothing when it breaks.
 * What the anchor OWES is that the call resolves from it, so that is what is
 * asked — of the real detector the real gestures use.
 */
import { describe, it, expect } from 'vitest'

import { detectArrangeAt } from '../../visualEdit/arrange/parse'
import { parseStrudel } from '../parseStrudel'
import { structuralWalk } from '../structuralWalk'

/** Every lane's anchor, and what an `arrange`/`cat` detector makes of it. */
function anchors(code: string, spanCycles = 16): Array<{ anchor: number | null; resolves: boolean }> {
  const lanes = structuralWalk(parseStrudel(code), { originCycle: 0, spanCycles })
  return lanes.map((lane) => {
    const anchor = lane.arrangeOffset ?? null
    return { anchor, resolves: anchor != null && detectArrangeAt(code, anchor) != null }
  })
}

describe('the arrange anchor resolves the arrangement', () => {
  it('resolves for a section written INLINE — the case that always worked', () => {
    const code = 'arrange([2, s("bd")], [2, s("hh")])'
    expect(anchors(code).every((a) => a.resolves)).toBe(true)
  })

  it('resolves for a section NAMED by a binding declared above the call', () => {
    // The defect. `introduction` is declared at the top of the file, so its own
    // location is EARLIER than the `arrange(` token — and the old minimum picked
    // it, landing the anchor inside a `const` where no combinator exists.
    const code = [
      'const introduction = s("bd")',
      'const development = s("hh")',
      'arrange([2, introduction], [2, development])',
    ].join('\n')
    expect(anchors(code).every((a) => a.resolves)).toBe(true)
  })

  it('resolves under a `$:` label as well as bare', () => {
    const code = [
      'const introduction = s("bd")',
      '$: arrange([2, introduction], [2, s("hh")])',
    ].join('\n')
    expect(anchors(code).every((a) => a.resolves)).toBe(true)
  })

  it('resolves the OUTER call for a nested combinator', () => {
    // ⚠ THE CONTROL THAT MATTERS. #451 established that a nested combinator must
    // read as ONE outer clip, and the minimum is what delivered that. A fix that
    // resolved named sections by breaking nesting would trade one silent defect
    // for another.
    const code = 'arrange([2, cat(s("bd"), s("sd"))], [2, s("hh")])'
    for (const a of anchors(code)) {
      expect(a.resolves).toBe(true)
      // …and it is the OUTER `arrange`, not the inner `cat`.
      expect(detectArrangeAt(code, a.anchor as number)!.mode).toBe('arrange')
    }
  })

  it('resolves a `cat` arrangement, whose arms carry no weight literal', () => {
    const code = 'const a = s("bd")\ncat(a, s("hh"))'
    expect(anchors(code).every((a) => a.resolves)).toBe(true)
  })

  it('leaves a document with no arrangement alone', () => {
    // A bare loop has no arm to anchor to, and nothing here should invent one.
    // The anchor may be absent or may point at the pattern; what it must NOT do
    // is claim to resolve a combinator that is not there.
    const code = 'const a = s("bd")\n$: a'
    for (const a of anchors(code)) expect(a.resolves).toBe(false)
  })
})
