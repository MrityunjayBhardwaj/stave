/**
 * The bounds caption's geometry and the edits it produces (#1464 Stage 2).
 *
 * Two things are being pinned here, and they fail in opposite ways.
 *
 * The GEOMETRY half is shared with the draw path on purpose, so the risk is
 * drift: a click that lands one glyph off edits the wrong bound, and nothing
 * visible goes wrong. Those tests use a measure function with a known constant
 * advance, so a field's box is arithmetic anyone can check by hand.
 *
 * The EDIT half is where a wrong answer reaches the user's document. Those tests
 * are written as the three properties `captionEdit` exists to enforce — the
 * rounding cannot escape, an unchanged field writes nothing, an unspelled leg
 * inserts rather than replaces — because each is a silent corruption if it
 * regresses, not a visible one.
 */
import { describe, it, expect } from 'vitest'
import type { SignalAutomation } from '@stave/editor'
import {
  captionRows,
  captionHit,
  captionText,
  captionEdit,
  CAPTION_PAD_X,
  AUTOMATION_PAD_Y,
  AUTOMATION_LABEL_LINE_H,
} from '../automationCaption'

/** One character = 5px. Not the real face — a face whose arithmetic is legible,
 *  so `x=CAPTION_PAD_X + 5*n` names character n without a screenshot. */
const CHAR_W = 5
const measure = (s: string): number => s.length * CHAR_W

const NO_SPANS = { shape: null, rate: null, range: null, chainEnd: null } as const

const auto = (over: Partial<SignalAutomation> = {}): SignalAutomation => ({
  trackId: 'd1', paramKey: 'cutoff', kind: 'sine', periodCycles: 1,
  lo: 200, hi: 2000, ranged: true, offset: 0, spans: NO_SPANS, ...over,
})

/** The x of character `n`'s left edge, under `measure`. */
const xOf = (n: number): number => CAPTION_PAD_X + n * CHAR_W

describe('captionText — what the lane actually says', () => {
  it('names the parameter and its two bounds', () => {
    expect(captionText(auto())).toBe('cutoff 200→2000')
  })

  it('marks a bound this code SUPPLIED with ~, so it is never read as the user\'s', () => {
    expect(captionText(auto({ paramKey: 'pan', lo: 0, hi: 1, ranged: false })))
      .toBe('pan ~0→1')
  })

  it('rounds for display only', () => {
    expect(captionText(auto({ lo: 0.30001, hi: 1 }))).toBe('cutoff 0.3→1')
  })
})

describe('captionRows — the three abstentions the draw path already made', () => {
  it('a collapsed lane has no captions to click', () => {
    expect(captionRows([auto()], 0, 40, false)).toEqual([])
  })

  it('a band too short to DRAW has none either', () => {
    // 15px row = 9px band, under the curve's own floor: nothing is painted here,
    // so there is nothing to label.
    expect(captionRows([auto()], 0, 15, true)).toEqual([])
  })

  it('LABELS THE LANE A DRUM TRACK ACTUALLY GETS (#1495)', () => {
    // A single-voice PERCUSSIVE lane is one sub-row tall, and the sub-row height
    // is the density setting — 25px by default. Not the 22px constant the issue
    // reasoned from: `FullSongTimeline` passes `rowH` for BOTH the row and the
    // sub-row, so the lane is 1 x 25 and expanding it changes nothing.
    //
    // 25px row = 19px band. That sat between the caption's old 22px floor and
    // the curve's 10px one, which is the whole of the bug: the sweep was drawn
    // and the numbers it swept between were not. Asserting the row is PRESENT
    // and carries all three fields, because an empty array was the old answer.
    const rows = captionRows([auto()], 0, 25, true)
    expect(rows).toHaveLength(1)
    expect(rows[0].text).toBe('cutoff 200→2000')
    expect(rows[0].fields.map((f) => f.kind)).toEqual(['param', 'lo', 'hi'])
  })

  it('a drum lane at the SMALLEST density still declines, and the largest still labels', () => {
    // The setting is clamped to 12..48 (`setMusicalTimelineSubRowHeight`), so
    // these are the real ends of the range, not hypotheticals. The floor has to
    // land inside it or it is not a floor at all.
    expect(captionRows([auto()], 0, 12, true)).toEqual([]) // 6px band
    expect(captionRows([auto()], 0, 48, true)).toHaveLength(1) // 42px band
  })

  it('stops before overflowing the row rather than laying out invisible lines', () => {
    // Room for two lines at 11px each inside a 30px row (pad 3 top).
    const many = [auto({ paramKey: 'a' }), auto({ paramKey: 'b' }), auto({ paramKey: 'c' })]
    const rows = captionRows(many, 0, 30, true)
    expect(rows.map((r) => r.automation.paramKey)).toEqual(['a', 'b'])
  })

  it('stacks lines from the band inset, one line height apart', () => {
    const rows = captionRows([auto({ paramKey: 'a' }), auto({ paramKey: 'b' })], 100, 60, true)
    expect(rows.map((r) => r.y)).toEqual([
      100 + AUTOMATION_PAD_Y,
      100 + AUTOMATION_PAD_Y + AUTOMATION_LABEL_LINE_H,
    ])
  })
})

describe('captionHit — a click resolves to one leg', () => {
  const rows = captionRows([auto()], 0, 60, true) // 'cutoff 200→2000'
  //                                                 0123456789...

  it('lands on the parameter name', () => {
    const hit = captionHit(rows, xOf(2), AUTOMATION_PAD_Y + 1, measure)
    expect(hit?.field.kind).toBe('param')
    expect(hit?.field.text).toBe('cutoff')
  })

  it('lands on the low bound', () => {
    // 'cutoff ' is 7 chars, so '200' occupies characters 7..9.
    const hit = captionHit(rows, xOf(8), AUTOMATION_PAD_Y + 1, measure)
    expect(hit?.field.kind).toBe('lo')
    expect(hit?.field.text).toBe('200')
  })

  it('lands on the high bound, past the arrow', () => {
    // '200' ends at 10, the arrow is character 10, '2000' is 11..14.
    const hit = captionHit(rows, xOf(12), AUTOMATION_PAD_Y + 1, measure)
    expect(hit?.field.kind).toBe('hi')
    expect(hit?.field.text).toBe('2000')
  })

  it('the ARROW itself is not a field — a click between the bounds hits neither', () => {
    expect(captionHit(rows, xOf(10), AUTOMATION_PAD_Y + 1, measure)).toBeNull()
  })

  it('misses above the line, below it, and past its end', () => {
    expect(captionHit(rows, xOf(8), AUTOMATION_PAD_Y - 2, measure)).toBeNull()
    expect(captionHit(rows, xOf(8), AUTOMATION_PAD_Y + 40, measure)).toBeNull()
    expect(captionHit(rows, xOf(40), AUTOMATION_PAD_Y + 1, measure)).toBeNull()
  })

  it('reports the field\'s own box, so an input can sit exactly over it', () => {
    const hit = captionHit(rows, xOf(8), AUTOMATION_PAD_Y + 1, measure)
    expect(hit?.box).toEqual({ x: xOf(7), y: AUTOMATION_PAD_Y, w: 3 * CHAR_W, h: 10 })
  })
})

describe('captionEdit — the three things it exists to enforce', () => {
  const RANGED = { shape: null, rate: null, range: { start: 30, end: 46 }, chainEnd: 46 }
  const hitOn = (a: SignalAutomation, kind: 'lo' | 'hi' | 'param') => {
    const rows = captionRows([a], 0, 60, true)
    const field = rows[0].fields.find((f) => f.kind === kind)
    return { row: rows[0], field: field!, box: { x: 0, y: 0, w: 0, h: 0 } }
  }

  it('(1) the display\'s rounding cannot reach the document', () => {
    // The caption reads `0.3→1`; the document holds 0.30001. Editing the HIGH
    // bound must not rewrite the low one to the rounded string beside it.
    const a = auto({ lo: 0.30001, hi: 1, spans: RANGED })
    expect(captionText(a)).toBe('cutoff 0.3→1')
    expect(captionEdit(hitOn(a, 'hi'), '2')).toEqual({
      range: [30, 46], text: '.range(0.30001,2)',
    })
  })

  it('(2) an unchanged field writes nothing — including a differently spelled same number', () => {
    const a = auto({ lo: 200, hi: 2000, spans: RANGED })
    expect(captionEdit(hitOn(a, 'lo'), '200')).toBeNull()
    expect(captionEdit(hitOn(a, 'lo'), '200.0')).toBeNull()
    expect(captionEdit(hitOn(a, 'lo'), ' 200 ')).toBeNull()
  })

  it('(3) a leg the document does not spell INSERTS at chainEnd rather than replacing', () => {
    // `pan ~0→1` — the bounds are this code's, not the document's, so there is
    // no `.range()` to overwrite.
    const a = auto({ paramKey: 'pan', lo: 0, hi: 1, ranged: false,
      spans: { shape: null, rate: null, range: null, chainEnd: 21 } })
    expect(captionEdit(hitOn(a, 'hi'), '0.8')).toEqual({
      range: [21, 21], text: '.range(0,0.8)',
    })
  })

  it('refuses a non-numeric entry', () => {
    const a = auto({ spans: RANGED })
    expect(captionEdit(hitOn(a, 'lo'), 'loud')).toBeNull()
    expect(captionEdit(hitOn(a, 'lo'), '')).toBeNull()
  })

  it('refuses an inverted or degenerate range — a curve the engine would not play', () => {
    const a = auto({ lo: 200, hi: 2000, spans: RANGED })
    expect(captionEdit(hitOn(a, 'hi'), '100')).toBeNull()   // hi below lo
    expect(captionEdit(hitOn(a, 'hi'), '200')).toBeNull()   // hi equal to lo
  })

  it('refuses when the automation has nowhere to write at all', () => {
    const a = auto({ ranged: false, spans: NO_SPANS })
    expect(captionEdit(hitOn(a, 'hi'), '0.5')).toBeNull()
  })

  it('the parameter name is a menu anchor, not a typed field', () => {
    const a = auto({ spans: RANGED })
    expect(captionEdit(hitOn(a, 'param'), 'gain')).toBeNull()
  })
})
