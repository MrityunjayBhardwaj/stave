/**
 * The automation lane's BOUNDS CAPTION — its text, its geometry, and what a
 * pointer landing on it has hit (#1464 Stage 2).
 *
 * A caption reads `cutoff 200→2000`, drawn in its own curve's colour at the
 * top-left of an expanded lane's band. It exists because the range leg is
 * INVISIBLE in the curve: every curve is normalised to its own range, so
 * `.range(0.4,0.6)` and `.range(0,1)` draw an identical wave. A DAW labels the
 * lane's axis instead of rescaling the curve, and this is that label.
 *
 * Stage 2 makes those numbers editable, which is why the layout moved out of
 * `drawTimeline` and into here. ⚠ THE DRAW PATH AND THE HIT-TEST MUST SHARE ONE
 * GEOMETRY — the same rule `laneMarkBands` already holds the live overlay to
 * (PV120), and for the same reason: two copies of "where is the `lo` number"
 * drift apart under any change to the text, and the drift is silent. A click
 * lands one glyph off and edits the wrong bound.
 *
 * This module is pure. It measures nothing itself: callers pass a `measure`
 * function, so the draw path can use its own canvas context and a hit-test can
 * use another, while the field arithmetic stays in one place.
 */
import type { SignalAutomation } from '@stave/editor'

/** 9px monospace, matching the rest of the lane's small type. */
export const AUTOMATION_LABEL_FONT = '9px ui-monospace, SFMono-Regular, Menlo, monospace'

/** Below this band height a caption costs more legibility than it returns, so
 *  the lane draws the curve alone. */
export const AUTOMATION_LABEL_MIN_H = 22

/** Line advance between stacked captions. */
export const AUTOMATION_LABEL_LINE_H = 11

/** Cap height of the 9px face — the clickable height of one caption line. */
export const AUTOMATION_LABEL_TEXT_H = 10

/** Which leg of the automation a caption field names, and therefore which edit
 *  a click on it begins. `param` is the SHAPE control's anchor: the parameter
 *  name is where a signal-kind menu hangs, because the kind has no glyph of its
 *  own in the caption. */
export type CaptionFieldKind = 'param' | 'lo' | 'hi'

export interface CaptionField {
  readonly kind: CaptionFieldKind
  /** The text of this field alone — what an editor opens with. */
  readonly text: string
  /** Character offsets within the caption line. Positions come from measuring
   *  `line.slice(0, from)` and `line.slice(0, to)`, never from a per-glyph
   *  width, so a proportional fallback face still lands correctly. */
  readonly from: number
  readonly to: number
}

export interface CaptionRow {
  readonly automation: SignalAutomation
  /** The whole line as drawn. */
  readonly text: string
  /** Top of this line in canvas Y. */
  readonly y: number
  readonly fields: readonly CaptionField[]
}

export interface CaptionHit {
  readonly row: CaptionRow
  readonly field: CaptionField
  /** The field's screen box, so a caller can place an input exactly over it. */
  readonly box: { readonly x: number; readonly y: number; readonly w: number; readonly h: number }
}

/** Inset from the lane's left edge to the caption's first glyph — the same
 *  inset a clip caption uses, so the two read as one column. */
export const CAPTION_PAD_X = 4

/** The automation band's inset from the lane's top and bottom edge — and so
 *  also the first caption line's top inset. ONE constant rather than two that
 *  must agree: `drawTimeline` imports this for the band it paints, because a
 *  band and a caption that disagreed about the padding would put the text
 *  outside the thing it labels. */
export const AUTOMATION_PAD_Y = 3

/**
 * Format a bound for display.
 *
 * ⚠ LOSSY, DELIBERATELY: `0.30001` shows as `0.3`. Committing a displayed
 * string back to the document would therefore silently rewrite the user's
 * number — which is why no caller is asked not to. `captionEdit` is the only
 * way to turn a caption into an edit, it composes from the automation's own
 * NUMBERS rather than from any displayed text, and it returns null when nothing
 * changed. The rounding cannot reach the document through it.
 */
export function formatBound(v: number): string {
  if (!Number.isFinite(v)) return '?'
  if (Number.isInteger(v)) return String(v)
  return String(Math.round(v * 1000) / 1000)
}

/** The `~` that marks a bound this code SUPPLIED from the signal's natural
 *  polarity rather than one the user wrote. Editing such a bound is a different
 *  edit — it inserts a `.range()` call — and the mark is the only warning the
 *  reader gets that the numbers beside it are not in the document. */
export function suppliedMark(a: SignalAutomation): string {
  return a.ranged ? '' : '~'
}

/** The caption line for one automation, exactly as drawn. */
export function captionText(a: SignalAutomation): string {
  return `${a.paramKey} ${suppliedMark(a)}${formatBound(a.lo)}→${formatBound(a.hi)}`
}

/**
 * Lay out one lane's captions: which lines are drawn, where, and which spans of
 * each line name which leg.
 *
 * Returns empty for a collapsed lane, a band too short to label, or a lane with
 * no automation — the same three abstentions the draw path already made, kept
 * here so the hit-test cannot believe in a caption that was never painted.
 */
export function captionRows(
  automations: readonly SignalAutomation[],
  top: number,
  rowHeight: number,
  expanded: boolean,
): readonly CaptionRow[] {
  if (!expanded || automations.length === 0) return []
  const bandH = rowHeight - AUTOMATION_PAD_Y * 2
  if (bandH < AUTOMATION_LABEL_MIN_H) return []

  const rows: CaptionRow[] = []
  let y = top + AUTOMATION_PAD_Y
  for (const a of automations) {
    // The draw loop stops when the next line would overflow the row; stopping on
    // the same condition is what keeps the two in step.
    if (y + AUTOMATION_LABEL_TEXT_H > top + rowHeight) break

    const name = a.paramKey
    const mark = suppliedMark(a)
    const lo = formatBound(a.lo)
    const hi = formatBound(a.hi)
    const text = `${name} ${mark}${lo}→${hi}`

    const loFrom = name.length + 1 + mark.length
    const loTo = loFrom + lo.length
    const hiFrom = loTo + 1 // the arrow is one character
    const hiTo = hiFrom + hi.length

    rows.push({
      automation: a,
      text,
      y,
      fields: [
        { kind: 'param', text: name, from: 0, to: name.length },
        { kind: 'lo', text: lo, from: loFrom, to: loTo },
        { kind: 'hi', text: hi, from: hiFrom, to: hiTo },
      ],
    })
    y += AUTOMATION_LABEL_LINE_H
  }
  return rows
}

/**
 * Which caption field, if any, is under a point.
 *
 * `measure` is the caller's text measurer for `AUTOMATION_LABEL_FONT`. Passing
 * it in rather than measuring here is what lets the draw path and the hit-test
 * share this arithmetic without this module owning a canvas.
 */
export function captionHit(
  rows: readonly CaptionRow[],
  x: number,
  y: number,
  measure: (text: string) => number,
): CaptionHit | null {
  for (const row of rows) {
    if (y < row.y || y >= row.y + AUTOMATION_LABEL_TEXT_H) continue
    for (const field of row.fields) {
      const left = CAPTION_PAD_X + measure(row.text.slice(0, field.from))
      const right = CAPTION_PAD_X + measure(row.text.slice(0, field.to))
      if (x >= left && x < right) {
        return {
          row,
          field,
          box: { x: left, y: row.y, w: right - left, h: AUTOMATION_LABEL_TEXT_H },
        }
      }
    }
  }
  return null
}

/** A replacement over a half-open source range. The shape `applyOffsetEditsToFile`
 *  already takes, so a caption edit travels the path every other edit surface
 *  in this codebase uses. An INSERT is `start === end`. */
export interface SourceEdit {
  readonly start: number
  readonly end: number
  readonly text: string
}

/**
 * Turn "the user typed `nextText` into this caption field" into a source edit,
 * or into NOTHING.
 *
 * ⚠ THIS FUNCTION IS THE ENFORCEMENT, not a comment asking callers to be
 * careful. Three things can only go right because they happen here:
 *
 *  1. THE ROUNDING CANNOT ESCAPE. The untouched bound is written from the
 *     automation's own `lo`/`hi` number, never from the string beside it on
 *     screen — so editing `hi` on a caption reading `0.3→1` cannot quietly
 *     rewrite a `lo` of `0.30001`.
 *  2. AN UNCHANGED FIELD WRITES NOTHING. Re-committing the same value would
 *     otherwise reformat the user's `.range(0.30001,1)` into `.range(0.3,1)`
 *     for free, which is a document edit nobody asked for.
 *  3. A LEG THE DOCUMENT DOES NOT SPELL INSERTS rather than replaces, at the
 *     coordinate the reader supplies. `~pan 0→1` has no `.range()` to overwrite;
 *     the edit appends one. Getting this wrong is not a wrong number, it is a
 *     corrupted expression.
 *
 * Returns null for anything it cannot do honestly: a non-numeric entry, an
 * unchanged value, an inverted or degenerate range, or an automation whose
 * spans give it nowhere to write.
 */
export function captionEdit(hit: CaptionHit, nextText: string): SourceEdit | null {
  const { field, row } = hit
  const a = row.automation
  // The parameter name is the shape menu's anchor, not a typed field.
  if (field.kind === 'param') return null

  const raw = nextText.trim()
  // ⚠ `Number('')` is 0, not NaN — and so is `Number(' ')`. Without this guard,
  // clearing the field and committing writes a bound of ZERO into the document,
  // which is a plausible number and therefore a silent corruption rather than a
  // visible error. Caught by its own test, not by reading.
  if (raw.length === 0) return null
  const next = Number(raw)
  if (!Number.isFinite(next)) return null

  const lo = field.kind === 'lo' ? next : a.lo
  const hi = field.kind === 'hi' ? next : a.hi
  // Unchanged — see (2). Compared as NUMBERS, so `0.30` typed over `0.3` is
  // correctly no edit at all rather than a rewrite.
  if (lo === a.lo && hi === a.hi) return null
  // A range must span something and must not be inverted; either would draw a
  // curve the engine does not play.
  if (!(hi > lo)) return null

  // `String`, never `formatBound` — the document gets the full number, and the
  // display's rounding stays on the display side of this function.
  const call = `.range(${String(lo)},${String(hi)})`
  const span = a.spans.range
  if (span) return { start: span.start, end: span.end, text: call }

  // See (3): nothing to replace, so append the call to the whole expression.
  const at = a.spans.chainEnd
  if (at === null) return null
  return { start: at, end: at, text: call }
}

/**
 * Turn "make this automation a `nextKind`" into a source edit, or into nothing.
 *
 * The whole of a shape change is replacing the signal identifier — `sine` for
 * `saw` — which is why this needs only the shape span and touches no argument.
 * Null when the kind is unchanged or the signal carries no source range.
 */
export function shapeEdit(a: SignalAutomation, nextKind: string): SourceEdit | null {
  if (nextKind === a.kind || nextKind.length === 0) return null
  const span = a.spans.shape
  if (!span) return null
  return { start: span.start, end: span.end, text: nextKind }
}
