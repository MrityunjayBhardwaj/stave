/**
 * effectCatalog.ts — the Mixer's "add effect" registry (#575).
 *
 * Supersedes the 6 fixed `quickTransforms`. Each entry is a per-track *effect*
 * the drawer can add as a scalar `.method(default)` and toggle off again. The
 * default is chosen to be an audible change on add (a no-op like `speed(1)` is
 * useless) and tracks the ranges in `knobRanges.ts`.
 *
 * Deliberately NOT here (division of labor — see MIXER-ADD-EFFECT-DESIGN.md):
 *  - `gain`, `pan`        → the strip fader / pan row own these (not effects).
 *  - `cps`               → global tempo, not per-track.
 *  - `n`, `velocity`     → content, not an effect.
 *  - `begin`/`end`       → sample trim (a sample/region concern).
 *  - `legato`            → note length / gate (a piano-roll concern).
 *  - `sometimesBy`, …    → take a function, not a scalar number.
 *
 * Aliases (`cutoff`→`lpf`, …) list one menu entry but detect all spellings, so a
 * hand-typed `.cutoff(800)` still shows the "Low-pass" entry as active.
 *
 * Pure data — no React, no Monaco.
 */
export interface Effect {
  /** the chain method written on add */
  method: string
  /** musician-facing label */
  label: string
  /** menu section */
  group: string
  /** value inserted on add — audible, derived from knobRanges */
  def: number
  /** alternate spellings that mean the same effect (active-state detection) */
  aliases?: readonly string[]
  /** surfaced as a one-click favorite button outside the menu */
  favorite?: boolean
}

export const EFFECTS: readonly Effect[] = [
  // Reverb
  { method: 'room', label: 'Reverb', group: 'Reverb', def: 0.4, favorite: true },
  { method: 'size', label: 'Room size', group: 'Reverb', def: 0.5, aliases: ['roomsize'] },
  // Delay
  { method: 'delay', label: 'Delay', group: 'Delay', def: 0.4, favorite: true },
  { method: 'delaytime', label: 'Delay time', group: 'Delay', def: 0.25 },
  { method: 'delayfeedback', label: 'Delay feedback', group: 'Delay', def: 0.5 },
  // Filters
  { method: 'lpf', label: 'Low-pass', group: 'Filters', def: 800, aliases: ['cutoff'], favorite: true },
  { method: 'hpf', label: 'High-pass', group: 'Filters', def: 2000, aliases: ['hcutoff'] },
  { method: 'bandf', label: 'Band-pass', group: 'Filters', def: 1000 },
  { method: 'resonance', label: 'Resonance', group: 'Filters', def: 10, aliases: ['lpq'] },
  // Tone / drive
  { method: 'distort', label: 'Distortion', group: 'Tone', def: 0.3 },
  { method: 'shape', label: 'Waveshape', group: 'Tone', def: 0.3 },
  { method: 'crush', label: 'Bitcrush', group: 'Tone', def: 8 },
  { method: 'coarse', label: 'Coarse', group: 'Tone', def: 4 },
  // Envelope
  { method: 'attack', label: 'Attack', group: 'Envelope', def: 0.1 },
  { method: 'decay', label: 'Decay', group: 'Envelope', def: 0.2 },
  { method: 'sustain', label: 'Sustain', group: 'Envelope', def: 0.6 },
  { method: 'release', label: 'Release', group: 'Envelope', def: 0.5 },
  // Playback
  { method: 'speed', label: 'Speed', group: 'Playback', def: 1.5 },
  /**
   * A CREATIVE pitch shifter, and never a corrective one (#1530, measured in
   * #1529). `.stretch` moves pitch and leaves duration alone — which is what
   * makes it worth having on a take, and is also the opposite of what its name
   * and its upstream doc block say.
   *
   * ⚠ The label matters more than usual here. Its shift is quantised to the
   * vocoder's 2048-bin FFT, so the pitch it lands on misses the one asked for
   * by 34 to 246 cents; the error changes SIGN with the note, and it moves with
   * the device's sample rate. One value therefore detunes different notes of the
   * same phrase in different directions. So: "Pitch shift", never "Tune",
   * "Correct" or "Align" — `take-pitch-and-time.spec.ts` holds the numbers.
   *
   * ⚠ Unison here is `0`, not `1`, and the default is a FIFTH rather than the
   * octave a first draft used. An octave is `1`, which is exactly the top of
   * this method's knob range — so adding the effect would have handed the user a
   * dial already on its rail with half its travel dead. Measured across the
   * catalog, every one of the other 22 entries lands strictly inside its own
   * range; `assertDefaultsInsideTheirRange` in `knobRanges.test.ts` now holds
   * that for all of them.
   */
  { method: 'stretch', label: 'Pitch shift', group: 'Playback', def: 0.5 },
  { method: 'accelerate', label: 'Accelerate', group: 'Playback', def: 0.5 },
  // Time
  { method: 'slow', label: 'Slow', group: 'Time', def: 2 },
  { method: 'fast', label: 'Fast', group: 'Time', def: 2 },
  // Random
  { method: 'degradeBy', label: 'Degrade', group: 'Random', def: 0.3 },
]

/** the one-click favorites shown outside the menu (Filter / Reverb / Delay). */
export const FAVORITES: readonly Effect[] = EFFECTS.filter((e) => e.favorite)

/** every spelling that means this effect (canonical + aliases). */
export function effectNames(e: Effect): string[] {
  return [e.method, ...(e.aliases ?? [])]
}

/** is this effect present in the chain under ANY of its spellings? */
export function isEffectActive(present: ReadonlySet<string>, e: Effect): boolean {
  return effectNames(e).some((n) => present.has(n))
}

/** ordered [group, effects[]] for the menu — preserves catalog order. */
export const EFFECT_GROUPS: ReadonlyArray<readonly [string, readonly Effect[]]> = (() => {
  const order: string[] = []
  const byGroup = new Map<string, Effect[]>()
  for (const e of EFFECTS) {
    if (!byGroup.has(e.group)) {
      byGroup.set(e.group, [])
      order.push(e.group)
    }
    byGroup.get(e.group)!.push(e)
  }
  return order.map((g) => [g, byGroup.get(g)!] as const)
})()

/** methods the drawer must NOT auto-knob — the strip fader / pan row own them. */
export const STRIP_OWNED = new Set<string>(['gain', 'pan'])
