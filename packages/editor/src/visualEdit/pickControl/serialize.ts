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

export { armText, headText }
