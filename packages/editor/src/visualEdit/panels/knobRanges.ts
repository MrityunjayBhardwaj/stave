/**
 * Per-method knob ranges for the Mixer (S4).
 *
 * Each numeric chain argument becomes a knob; the method name picks a sensible
 * range and step (gain 0..1, speed −2..2, lpf log 20..20k, …). Unknown methods
 * fall back to a range derived from the current value so any numeric literal is
 * still draggable — the user can always type an exact value in code.
 *
 * Pure — no Monaco, no React.
 */
import { STRUDEL_CONTROLS } from './strudelControls'

export interface KnobRange {
  min: number
  max: number
  step: number
  /** 'log' methods (filter cutoffs) map the slider position logarithmically */
  scale: 'linear' | 'log'
}

const lin = (min: number, max: number, step: number): KnobRange => ({
  min,
  max,
  step,
  scale: 'linear',
})
const log = (min: number, max: number): KnobRange => ({ min, max, step: 1, scale: 'log' })

/**
 * Method → range overrides. Names cover the common Strudel effect/envelope
 * chain. Anything absent uses the value-derived fallback below.
 */
const RANGES: Record<string, KnobRange> = {
  // levels
  gain: lin(0, 1, 0.01),
  velocity: lin(0, 1, 0.01),
  pan: lin(0, 1, 0.01),
  // reverb
  room: lin(0, 1, 0.01),
  size: lin(0, 1, 0.01),
  roomsize: lin(0, 1, 0.01),
  // delay
  delay: lin(0, 1, 0.01),
  delaytime: lin(0, 1, 0.01),
  delayfeedback: lin(0, 1, 0.01),
  // filters (logarithmic frequency)
  lpf: log(20, 20000),
  cutoff: log(20, 20000),
  hpf: log(20, 20000),
  hcutoff: log(20, 20000),
  bandf: log(20, 20000),
  resonance: lin(0, 40, 0.5),
  lpq: lin(0, 40, 0.5),
  // tone / drive
  shape: lin(0, 1, 0.01),
  distort: lin(0, 1, 0.01),
  crush: lin(1, 16, 1),
  coarse: lin(1, 16, 1),
  // envelope
  attack: lin(0, 2, 0.01),
  decay: lin(0, 2, 0.01),
  sustain: lin(0, 1, 0.01),
  release: lin(0, 4, 0.01),
  // playback
  /**
   * A PITCH SHIFT, despite the name, and the range is the engine's own
   * arithmetic rather than a guess (#1530).
   *
   * `.stretch(v)` reaches superdough's `phase-vocoder-processor` as
   * `pitchFactor`, and the worklet computes
   * `pitchFactor = max(0, (v < 0 ? v * 0.25 : v) + 1)` (worklets.mjs:624-631).
   * So `-2` is an octave down, `0` is UNISON, `+1` is an octave up — and
   * duration is untouched, because the vocoder advances its time cursor by the
   * overlap-add hop whatever the factor. Time-align is `.speed`, not this.
   *
   * ⚠ Without an entry here the value-derived fallback gives a `.stretch(0.5)`
   * a 0..1 knob, which is wrong twice: it presents the IDENTITY value as the
   * dial's minimum, and it puts every downward shift out of reach.
   *
   * The knob is asymmetric in cents per unit — 600 below unison, 1200 above —
   * because the control is (that `* 0.25` on negatives). The range does not
   * invent that, it stops hiding it.
   */
  stretch: lin(-2, 1, 0.01),
  speed: lin(-2, 2, 0.01),
  accelerate: lin(-2, 2, 0.01),
  begin: lin(0, 1, 0.01),
  end: lin(0, 1, 0.01),
  legato: lin(0, 2, 0.01),
  // time
  slow: lin(0.25, 8, 0.25),
  fast: lin(0.25, 8, 0.25),
  cps: lin(0.1, 4, 0.05),
  // probability
  degradeBy: lin(0, 1, 0.01),
  sometimesBy: lin(0, 1, 0.01),
  // discrete index
  n: lin(0, 16, 1),
}

/**
 * Whether `method` is a known single-value Strudel control (reverb send, filter
 * cutoff, envelope stage, …). Grounded in `@strudel/core` `controls.mjs`: every
 * control created by `createParam` is exposed as a UNARY prototype method
 * (`Pattern.prototype[name] = function (value) { … }`, controls.mjs:50), so it
 * reads only its FIRST argument — any extra positional numbers are silently
 * ignored at runtime. The Mixer uses this to cap such a call to a single knob:
 * a `.room(0.25, 0, 100)` plays exactly like `.room(0.25)`, so surfacing dials
 * for the ignored `0`/`100` would be a false projection. Genuinely multi-arg
 * functions (`euclid`, `range`, …) are NOT controls, aren't in this table, and
 * keep one knob per argument.
 */
export function isKnownControl(method: string): boolean {
  // "Effectively unary" = either a real Strudel control (createParam → unary,
  // full vocabulary in STRUDEL_CONTROLS) OR one of the unary range-table methods
  // (slow/fast/degradeBy/…). Either way the call's extra numeric args are not
  // independent dials, so the drawer caps it to one. Using the full control
  // vocabulary (not just RANGES) closes the phantom-dial gap for controls we
  // don't catalogue, e.g. `.chorus(0.5, 0, 100)` (#847).
  return STRUDEL_CONTROLS.has(method) || Object.prototype.hasOwnProperty.call(RANGES, method)
}

/**
 * Whether `method` is a genuine Strudel CONTROL (createParam). Only these carry
 * the #844 range metadata in their extra args — grounded that a control ignores
 * everything past its first argument (controls.mjs:50), so `.room(v, min, max)`
 * plays as `.room(v)`. A unary range-table method that is NOT a control
 * (slow/fast/…) is one-dial but NOT range-editable — we can't prove its extra
 * args are ignored, so the popup stays off (never write args we don't model).
 */
export function isStrudelControl(method: string): boolean {
  return STRUDEL_CONTROLS.has(method)
}

/** A nice round step ~1/100 of the span (e.g. 0.01, 0.1, 1, 10). */
function niceStep(span: number): number {
  const raw = span / 100
  const pow = Math.pow(10, Math.floor(Math.log10(raw || 1)))
  return pow || 0.01
}

/**
 * A user-authored knob range from the custom-range feature (#844): the `min`/`max`
 * a dial carries as `.control(value, min, max)`. Always linear — the user gave
 * explicit bounds, so a log mapping (which the method's default might use) would
 * fight their intent. Guards a degenerate span (min === max) so the knob stays
 * usable, and orders the bounds so `(100, 0)` reads the same as `(0, 100)`.
 */
export function customRange(min: number, max: number, value?: number): KnobRange {
  let lo = Math.min(min, max)
  let hi = Math.max(min, max)
  // Keep the authored value representable — an out-of-bounds literal (e.g. a hand
  // -typed `.room(150, 0, 100)`) widens the range rather than pinning the dial.
  if (value !== undefined && Number.isFinite(value)) {
    if (value < lo) lo = value
    if (value > hi) hi = value
  }
  const span = hi - lo || 1
  return { min: lo, max: hi, step: niceStep(span), scale: 'linear' }
}

/**
 * The knob range for a method given the literal's current value. Known methods
 * use the override table; unknown methods get a range that comfortably
 * contains the current value so the knob is still usable.
 */
export function knobRangeFor(method: string, value: number): KnobRange {
  const known = RANGES[method]
  if (known) {
    // Widen the max if the authored value already exceeds the default ceiling
    // (e.g. a hand-written gain of 1.4) so the knob can represent it.
    if (value > known.max) return { ...known, max: value }
    if (value < known.min) return { ...known, min: value }
    return known
  }
  if (value >= 0 && value <= 1) return lin(0, 1, 0.01)
  const min = value < 0 ? value * 2 : 0
  const max = Math.max(1, value * 2)
  return lin(min, max, niceStep(max - min))
}
