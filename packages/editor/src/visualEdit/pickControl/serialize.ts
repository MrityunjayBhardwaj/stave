/**
 * pickControl/serialize — structural ops on a detected `pick*` control string.
 *
 * #463 Stage 2. Each op is PURE: `PickControl` (from `pickControl/parse`) + the
 * live doc → `OffsetEdit[]` addressed by pre-edit absolute offsets (the shape
 * `writeback.replaceRanges` consumes). We edit the `<…@w …>` mini-notation TEXT
 * directly — never `toStrudel`/`serialize` (PV123) — so the section patterns and
 * the `.pickRestart({…})` object stay byte-verbatim; only the control arms move.
 *
 * Arms are space-separated; the weight is `@n` digits. `setWeight` touches only
 * the digits (or inserts `@n` on an implicit-1 arm); the structural ops keep each
 * arm's head text verbatim and re-join with single spaces.
 *
 * No Monaco, no runtime IR import (P172).
 */
import type { OffsetEdit } from '../writeback'
import type { PickControl } from './parse'

/** Weights are whole cycles — coerce to a positive integer. */
function asWeight(n: number): number {
  return Math.max(1, Math.round(n))
}

/** The verbatim source of arm `i` (`verse@8`). */
function armText(doc: string, control: PickControl, i: number): string {
  return doc.slice(control.arms[i].armRange[0], control.arms[i].armRange[1])
}

/** The verbatim head of arm `i` (`verse`, without `@weight`). */
function headText(doc: string, control: PickControl, i: number): string {
  return doc.slice(control.arms[i].headRange[0], control.arms[i].headRange[1])
}

/**
 * Set arm `i`'s weight (the dwell length, in whole cycles).
 *  - Arm already has `@n` → replace ONLY the digits (byte-minimal).
 *  - Implicit-weight arm + w === 1 → no-op (already 1).
 *  - Implicit-weight arm + w ≠ 1 → insert `@w` right after the head.
 */
export function setWeight(doc: string, control: PickControl, i: number, weight: number): OffsetEdit[] {
  const w = asWeight(weight)
  const arm = control.arms[i]
  if (!arm) return []
  if (arm.weightRange) return [{ range: arm.weightRange, text: String(w) }]
  if (w === 1) return []
  return [{ range: [arm.headRange[1], arm.headRange[1]], text: `@${w}` }]
}

/**
 * Split arm `i` into two equal-headed arms: `verse@8` → `verse@4 verse@4`
 * (`n₁ = firstWeight`, `n₂ = n − firstWeight`, both ≥ 1). Only an arm with
 * weight ≥ 2 is divisible; a weight-1 (one-cycle) arm returns no edits.
 */
export function splitArm(doc: string, control: PickControl, i: number, firstWeight: number): OffsetEdit[] {
  const arm = control.arms[i]
  if (!arm) return []
  const n = asWeight(arm.weight)
  if (n < 2) return []
  const n1 = Math.max(1, Math.min(Math.round(firstWeight), n - 1))
  const n2 = n - n1
  const head = headText(doc, control, i)
  return [{ range: arm.armRange, text: `${head}@${n1} ${head}@${n2}` }]
}

/**
 * #1462 — GAP delete, the pick spelling of `arrange/silenceArm` (#491).
 *
 * Replace ONLY the arm's HEAD with `~` (a mini rest), keeping its `@weight`:
 *   `verse@8`  →  `~@8`      (width 8 kept)
 *   `verse`    →  `~`        (implicit width 1 kept)
 *
 * ⚠ WHY THIS EXISTS AT ALL: the same Delete key on the same canvas used to mean
 * two different things depending on how the arrangement was SPELLED. `arrange()`
 * left a gap (#491, the DAW convention — the timeline is absolute, so later clips
 * do not slide left); the pick spelling called `removeArm` and rippled the section
 * out, shortening the song. The arrange side carried an explicit justification and
 * the pick side carried none, which is what marked it as an unconsidered
 * divergence rather than a design choice. Gap is the default on both now.
 *
 * GROUNDED against the real evaluator, not assumed: `<intro@4 ~@8 outro@4>` over
 * the same three sections queries 1,1,1,1 · 0×8 · 1,1,1,1 haps per cycle, against
 * 1,1,1,1 · 4×8 · 1,1,1,1 for the un-gapped control — the gap is silent, is
 * exactly 8 cycles wide, and the outro does NOT move.
 *
 * Already-silent arm → no edits (mirrors arrange). Silencing EVERY arm is allowed
 * — `<~@4 ~@8>` is a valid muted track — so unlike `removeArm` there is no
 * sole-arm guard here: this op can never empty the control.
 */
export function silenceArm(doc: string, control: PickControl, i: number): OffsetEdit[] {
  const arm = control.arms[i]
  if (!arm) return []
  if (headText(doc, control, i) === '~') return []
  return [{ range: arm.headRange, text: '~' }]
}

/**
 * A section name safe to write into the selector string. The head sits inside a
 * JS string literal AND inside mini-notation, so anything outside this shape
 * either breaks the literal (a quote) or means something else to the mini parser
 * (a digit, `@`, `!`, brackets). The object may legally hold such a key —
 * `{"my part": …}` parses fine as JS — and this is exactly the case where the
 * section is unreachable from the selector and the op must decline.
 */
const SELECTOR_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/

/**
 * #1560 — point section `i` at a different PART: rewrite the arm's head to name
 * another section of this call's own object, keeping its `@weight` and every
 * other arm verbatim.
 *
 *   `"<verse@8 chorus@4>"`  →  `"<verse@8 verse@4>"`
 *
 * ⚠ ONLY THE CLICKED ARM MOVES, which is what makes this the counterpart of the
 * arrange op and not of the rename. A section that returns later in the selector
 * keeps naming what it named — the rename pair is the one where touching a name
 * necessarily moves every arm that uses it.
 *
 * ⚠ MEMBERSHIP IS VERIFIED HERE, and the arrange side deliberately does not do
 * the same. A pick head is a NAME that has to resolve against the call's section
 * object; a head naming no key is not an error the user can see — it is a
 * section that silently plays nothing. An arrange arm is an expression slot with
 * no vocabulary to check against, so there the check would be a guess.
 *
 * Declines, each returning no edits: no such arm; the call passes no object
 * literal (the array form `pick([a, b])` names nothing); the key is not one of
 * this call's sections; the key cannot be spelled in the selector; the section
 * already plays it.
 */
export function setArmHead(
  doc: string,
  control: PickControl,
  i: number,
  key: string,
): OffsetEdit[] {
  const arm = control.arms[i]
  if (!arm) return []
  const next = key.trim()
  if (!SELECTOR_NAME.test(next)) return []
  if (!control.entries.some((e) => e.key === next)) return []
  if (headText(doc, control, i) === next) return []
  return [{ range: arm.headRange, text: next }]
}

/**
 * The sections of this call that an arm may be pointed at (#1560) — the pick
 * spelling's answer to `arrange/parts.listSectionParts`.
 *
 * ⚠ IT LIVES BESIDE `setArmHead` ON PURPOSE. The list and the op share one
 * predicate, so what a chooser offers and what the write accepts cannot drift
 * apart — the failure that would put a name in front of a user and then decline
 * it silently when they picked it.
 *
 * Object order, not selector order: the object is where a section is defined,
 * and the selector is only where it is used (#1467). A key the selector cannot
 * spell is dropped rather than shown, for the reason `SELECTOR_NAME` gives.
 */
export function listSectionParts(control: PickControl): string[] {
  const names: string[] = []
  for (const entry of control.entries) {
    if (!SELECTOR_NAME.test(entry.key)) continue
    if (!names.includes(entry.key)) names.push(entry.key)
  }
  return names
}


/**
 * #1461 — INSERT SILENCE: a new, empty section after arm `i`, as wide as it is.
 *
 * The pick spelling of `arrange/insertSilenceArm`, and the two must stay
 * equivalent — a keypress means one thing whichever way the song is written
 * (#1462). Here an empty section is `~`, the rest this control family already
 * uses, exactly as `silenceArm` writes `~@8` for a gap.
 *
 * The weight is copied as TEXT for the same reason as the arrange side: an arm
 * with no `@` has an implicit width of 1 and no literal to copy, so the new arm
 * is a bare `~` rather than an invented `~@1`, which keeps it looking like its
 * siblings and round-trips to the same music.
 *
 * ⚠ NO OBJECT ENTRY IS ADDED, and that is not an omission. `~` is a rest in the
 * selector's own grammar rather than a name that has to resolve, so the section
 * object stays exactly as the user wrote it. Adding a key would invent a pattern
 * nobody asked for and change what the document means.
 */
export function insertSilenceArm(doc: string, control: PickControl, i: number): OffsetEdit[] {
  const arm = control.arms[i]
  if (!arm) return []
  const armSource = arm.weightRange
    ? `~@${doc.slice(arm.weightRange[0], arm.weightRange[1])}`
    : '~'
  return insertArm(doc, control, i + 1, armSource)
}

/**
 * Remove arm `i`, taking one adjacent space with it. Refuses to empty the
 * control — a lane keeps ≥ 1 section (mirrors arrange/removeArm).
 */
export function removeArm(doc: string, control: PickControl, i: number): OffsetEdit[] {
  const n = control.arms.length
  if (i < 0 || i >= n || n <= 1) return []
  if (i < n - 1) {
    // drop this arm + the single space before the next arm
    return [{ range: [control.arms[i].armRange[0], control.arms[i + 1].armRange[0]], text: '' }]
  }
  // last arm: drop the space after the previous arm + this arm
  return [{ range: [control.arms[i - 1].armRange[1], control.arms[i].armRange[1]], text: '' }]
}

/**
 * Move arm `from` to index `to`. Rebuilds the `<…>` content in the new order,
 * each arm's text verbatim, single-space-joined (clip order = arm order).
 */
export function reorderArm(doc: string, control: PickControl, from: number, to: number): OffsetEdit[] {
  const n = control.arms.length
  if (from < 0 || from >= n || to < 0 || to >= n || from === to) return []
  const order = Array.from({ length: n }, (_, k) => k)
  order.splice(to, 0, order.splice(from, 1)[0])
  const text = order.map((k) => armText(doc, control, k)).join(' ')
  return [{ range: control.innerRange, text }]
}

/**
 * Insert `armSource` (a bare control arm like `verse@4`) at index `at`
 * (clamped to `[0, arms.length]`), single-space-separated.
 */
export function insertArm(doc: string, control: PickControl, at: number, armSource: string): OffsetEdit[] {
  const n = control.arms.length
  const idx = Math.max(0, Math.min(at, n))
  if (n === 0) return [{ range: control.innerRange, text: armSource }]
  if (idx === n) {
    const end = control.arms[n - 1].armRange[1]
    return [{ range: [end, end], text: ` ${armSource}` }]
  }
  const start = control.arms[idx].armRange[0]
  return [{ range: [start, start], text: `${armSource} ` }]
}

/**
 * Duplicate arm `i`: insert a verbatim copy right after it. (The clone keeps the
 * same head + weight; clip order = arm order, so the copy plays next.)
 */
export function duplicateArm(doc: string, control: PickControl, i: number): OffsetEdit[] {
  const arm = control.arms[i]
  if (!arm) return []
  return insertArm(doc, control, i + 1, armText(doc, control, i))
}

/**
 * A legal section name: a bare identifier, which is both a valid object key
 * (needs no quoting) and a valid mini-notation word (no `@`, no space, no
 * bracket). Anything else is declined rather than escaped — a name the user
 * can't also type into the selector isn't a name this feature can honour.
 */
const SECTION_NAME = /^[A-Za-z_$][A-Za-z0-9_$]*$/

/**
 * `{__proto__: p}` in an object literal sets the object's PROTOTYPE — it does
 * not create a key — so a section renamed to it would vanish from the lookup
 * while the selector still asked for it. The one identifier that isn't a key.
 */
const NOT_A_KEY = '__proto__'

/** Escape a name for use inside a RegExp (a quoted key may hold anything). */
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Is every occurrence of `name` inside the control string one of the arm heads
 * we are about to rename?
 *
 * A name can also appear NESTED inside another arm's head — `<verse@8 [verse
 * chorus]@4>` — where it is a real reference to the same key that this op does
 * not rewrite. Renaming the key would leave that occurrence pointing at a key
 * that no longer exists, and the section would go silent. So the op declines
 * instead. (This is a REFUSAL scan, not an interpretation of the notation: it
 * can only narrow what the op will do, never decide what the notation means.)
 */
function everyOccurrenceIsAnArmHead(doc: string, control: PickControl, name: string): boolean {
  const [from, to] = control.innerRange
  const inner = doc.slice(from, to)
  const re = new RegExp(`(^|[^A-Za-z0-9_$])(${escapeRe(name)})(?![A-Za-z0-9_$])`, 'g')
  let m: RegExpExecArray | null
  while ((m = re.exec(inner)) !== null) {
    const at = from + m.index + m[1].length
    const covered = control.arms.some(
      (a) => a.headRange[0] === at && a.headRange[1] === at + name.length,
    )
    if (!covered) return false
    re.lastIndex = m.index + m[1].length + name.length
  }
  return true
}

/**
 * How many selector arms carry section `i`'s name — 1 normally, more when the
 * section RETURNS (`<verse@8 chorus@4 verse@8>`). A rename moves all of them,
 * so the caller can say "this renames 2 sections" BEFORE writing (#1417).
 *
 * Returns 0 whenever `renameSection` would decline on the OLD name's side, so a
 * caller that shows the count and then writes can't be told "2 sections" and
 * handed no edits.
 */
export function countSectionArms(doc: string, control: PickControl, i: number): number {
  const arm = control.arms[i]
  if (!arm) return 0
  const name = headText(doc, control, i)
  if (control.entries.filter((e) => e.key === name).length !== 1) return 0
  if (!everyOccurrenceIsAnArmHead(doc, control, name)) return 0
  return control.arms.filter((_, k) => headText(doc, control, k) === name).length
}

/**
 * Rename section `i` — the object KEY plus every selector arm that names it.
 *
 * `{verse: bassLine}` + `<verse@8>` → `{intro: bassLine}` + `<intro@8>`: the
 * section is renamed and the pattern keeps its own name, because in this
 * spelling the section name is the key, not a binding reference. ES shorthand
 * `{verse}` is the majority spelling and the one case where the two coincide,
 * so it EXPANDS — `{intro: verse}` — which renames the section and leaves the
 * binding `verse` exactly where the user put it.
 *
 * A returning section is renamed in every arm it occupies: they aren't two
 * sections sharing a name, they're one pattern arranged twice.
 *
 * Declines (no edits) when the name is not UNIQUELY AND COMPLETELY ADDRESSABLE,
 * because every one of those cases writes a document that means something other
 * than what the user asked for:
 *  - the new name isn't a bare identifier, is `__proto__`, or is already the
 *    current name;
 *  - the arm isn't a named section — `~`, an inline `[bd,sd]`, or a key this
 *    parser couldn't name (computed, spread);
 *  - the new name collides with another key in the same object;
 *  - the OLD name is written twice in the object (`{glitch: a, glitch: b}` —
 *    real, and in the corpus). JS keeps the last; renaming the first would move
 *    the selector onto the pattern that was being shadowed, silently changing
 *    the music;
 *  - the old name also occurs nested inside another arm's head, where this op
 *    would not rewrite it and the reference would break.
 */
export function renameSection(
  doc: string,
  control: PickControl,
  i: number,
  newName: string,
): OffsetEdit[] {
  const arm = control.arms[i]
  if (!arm) return []
  if (!SECTION_NAME.test(newName) || newName === NOT_A_KEY) return []
  const oldName = headText(doc, control, i)
  if (newName === oldName) return []
  const entry = control.entries.find((e) => e.key === oldName)
  if (!entry) return []
  if (control.entries.filter((e) => e.key === oldName).length !== 1) return []
  if (control.entries.some((e) => e.key === newName)) return []
  if (!everyOccurrenceIsAnArmHead(doc, control, oldName)) return []

  const keyText = entry.shorthand
    ? `${newName}: ${oldName}`
    : quoteLike(doc.slice(entry.keyRange[0], entry.keyRange[1]), newName)
  const edits: OffsetEdit[] = [{ range: entry.keyRange, text: keyText }]
  for (const a of control.arms) {
    if (doc.slice(a.headRange[0], a.headRange[1]) === oldName) {
      edits.push({ range: a.headRange, text: newName })
    }
  }
  return edits
}

/** Re-quote `name` the way the old key token was written (`"verse"` → `"intro"`). */
function quoteLike(oldToken: string, name: string): string {
  const q = oldToken[0]
  return q === '"' || q === "'" ? `${q}${name}${q}` : name
}

export { armText, headText }
