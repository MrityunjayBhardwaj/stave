/**
 * waveformLane — the geometry of drawing a sample's shape inside its mark (#1506).
 *
 * Pure. It answers two questions and draws nothing: how much of a mark the
 * audio actually occupies, and which slice of a cached envelope belongs in each
 * pixel column. Keeping that separate from the canvas is what makes the display
 * rule assertable without a device — see `drawTimeline` for the painting.
 *
 * ## The rule this encodes
 *
 * One lane type at varying fidelity, never a toggle. The discriminator is the
 * sample's duration divided by the slot it is triggered into, and it falls out
 * of comparing two widths that are already in pixels:
 *
 *     audioPx   = sampleDuration × cps × pxPerCycle     ← what the sound is worth
 *     extentPx  = min(markW, audioPx)                   ← what the mark can hold
 *
 * `extentPx / markW` is exactly `min(1, sampleDuration / slotDuration)`, because
 * the pixels-per-cycle cancel. So a three-second take in a slot that lasts four
 * seconds fills three quarters of its mark, and a kick in a bar-long slot draws
 * a short transient at the left edge with the rest of the mark left as the bar
 * it already was. Both are the truth about where the sound is.
 *
 * ## Two gates, and why they are not one
 *
 * Width and height fail independently. A wide mark on a two-pixel-tall row has
 * plenty of columns and nowhere to put an amplitude; a tall row at low zoom has
 * amplitude and three columns to spend it on. Either way the honest fallback is
 * the mark that renders today, so both are checked and either one declines.
 *
 * ## What this deliberately does not model
 *
 * A sample longer than its slot is CUT at the mark's right edge rather than
 * spilling past it. In Strudel that is a display choice and not what the audio
 * does — a sample overruns its slot unless something clips it — so a take drawn
 * this way shows the part of itself that lives inside its own mark. The
 * alternative, drawing over whatever comes next, would misreport the timeline's
 * structure to fix the rendering of one voice.
 *
 * ## What it DOES model, and what it still does not (#1512)
 *
 * The region a mark plays — `begin`, `end`, `speed` and `unit` — IS reflected,
 * because the runtime resolves all four to concrete numbers per event before a
 * mark is ever built. A chopped take draws four different quarters, and a
 * reversed one draws backwards. `regionPlayback` below is the arithmetic, cited
 * line by line to the engine that performs it.
 *
 * Still not modelled, and named rather than left to be discovered:
 *
 * - **`transpose`.** `superdough/util.mjs:89-90` derives it from the hap's note
 *   against the bank, and for an object-format bank it is measured against
 *   whichever key is nearest — a question about the bank, which a `SceneNote`
 *   cannot answer. A repitched sample draws at its untransposed width.
 * - **`unit: 's'`.** `@strudel/core/controls.mjs:2398` documents it; superdough
 *   1.3.0 acts on `'c'` and on nothing else, anywhere. Modelling `'s'` would
 *   model a behaviour the installed engine does not have.
 * - **A backwards region** (`end <= begin`). superdough computes a negative
 *   slice duration for it and plays nothing coherent; this declines and the
 *   plain bar draws, rather than inventing a reading the audio does not have.
 */

/**
 * Narrowest waveform worth drawing, in px.
 *
 * Below this there are too few columns for a shape to read as anything but
 * noise, and a smear that suggests detail is worse than a bar that admits it has
 * none.
 */
export const MIN_WAVEFORM_W = 6

/**
 * Shortest mark height worth drawing a waveform into, in px.
 *
 * Set from the DEFAULT row height, deliberately. A collapsed lane's mark is
 * `rowHeight - 18` tall, and the row height defaults to 25, so a mark is 7px —
 * three pixels either side of its centre line. That is coarse, and it is still
 * enough to see that a take is loud here and silent there, which is the whole
 * claim. A threshold above 7 would mean the feature never appeared until the
 * user went looking for a size setting, and a take you have to configure the
 * timeline to see is not one that can be seen.
 *
 * Below this there is genuinely nothing to vary: at 4px a column is the centre
 * line plus one pixel, and every sound draws the same rectangle. Raising the
 * row height (up to 48, so 30px marks) is what buys real detail — the "at the
 * fidelity the row height allows" half of the rule.
 */
export const MIN_WAVEFORM_H = 6

/**
 * The slice of its source file a sample mark actually plays (#1512).
 *
 * These are superdough's own four controls, carried verbatim rather than
 * pre-combined, because two of them cannot be resolved without the buffer's
 * duration — `unit: 'c'` scales the playback rate BY that duration — and the
 * duration is not known until the peaks are in hand at draw time. Combining
 * early would mean guessing it.
 *
 * Absent on a mark with no region controls at all, so the common case allocates
 * nothing and draws exactly the bytes it drew before.
 */
export interface SampleRegion {
  /** Where the slice starts in the file, 0..1 (`sampler.mjs:67`, default 0). */
  readonly begin: number
  /** Where it ends, 0..1 (`sampler.mjs:67`, default 1). */
  readonly end: number
  /** The `speed` control. Negative plays the buffer REVERSED (`sampler.mjs:62-64`). */
  readonly speed: number
  /** superdough's `unit`; only `'c'` has any effect (`sampler.mjs:49-51`). */
  readonly unit: string | null
}

/** The region a mark with no region controls plays: all of it, once, forwards. */
export const WHOLE_SAMPLE: SampleRegion = { begin: 0, end: 1, speed: 1, unit: null }

/** What a region is worth in seconds, and which part of the file it reads. */
export interface RegionPlayback {
  /** Audible length of the slice, in seconds. */
  readonly seconds: number
  /** Start of the slice as a fraction of the file, 0..1. */
  readonly from: number
  /** End of the slice as a fraction of the file, 0..1. */
  readonly to: number
  /** True when playback runs from `to` back to `from`. */
  readonly reversed: boolean
}

/**
 * Resolve a region against a real buffer duration.
 *
 * Every line here is superdough's, from the function that turns a hap into a
 * buffer source (`superdough@1.3.0/sampler.mjs`):
 *
 *     :36     playbackRate = |speed| * 2^(transpose/12)
 *     :49-51  unit === 'c'  ->  playbackRate *= buffer.duration
 *     :67     begin defaults to 0, end to 1
 *     :81-82  playbackDuration = bufferDuration / playbackRate
 *             sliceDuration    = (end - begin) * playbackDuration
 *     :62-64  speed < 0  ->  the buffer is reversed, at the SAME rate
 *
 * `null` whenever the result would not be a slice anyone can hear: a rate of
 * zero, a region outside the file, or an end at or before its begin.
 */
export function regionPlayback(
  region: SampleRegion,
  sampleDuration: number,
): RegionPlayback | null {
  if (!Number.isFinite(sampleDuration) || sampleDuration <= 0) return null
  const from = Math.min(1, Math.max(0, region.begin))
  const to = Math.min(1, Math.max(0, region.end))
  if (!(to > from)) return null
  // `Math.abs` per :36 — the sign chooses the direction, never the rate.
  let rate = Math.abs(region.speed)
  if (region.unit === 'c') rate *= sampleDuration
  if (!Number.isFinite(rate) || rate <= 0) return null
  const seconds = ((to - from) * sampleDuration) / rate
  if (!Number.isFinite(seconds) || seconds <= 0) return null
  return { seconds, from, to, reversed: region.speed < 0 }
}

/** How much of a mark a sample's audio fills, and how much of the sample shows. */
export interface WaveformFit {
  /** Width in px, measured from the mark's left edge. */
  readonly extentPx: number
  /** Fraction of the REGION that fits; 1 when the whole slice is inside the mark.
   *  For a mark with no region controls the region IS the file, so this keeps
   *  the meaning it has always had. */
  readonly visibleFraction: number
  /** Start of the played slice as a fraction of the file, 0..1 (#1512). */
  readonly from: number
  /** End of the played slice as a fraction of the file, 0..1 (#1512). */
  readonly to: number
  /** True when the slice plays backwards, from `to` to `from` (#1512). */
  readonly reversed: boolean
}

/**
 * Can this mark show a waveform, and how much of one?
 *
 * `null` means "draw the mark exactly as before" — an unknown tempo, a sample
 * with no length, or a mark too small in either direction. Every one of those is
 * a normal state rather than an error: tempo is unknown before the runtime
 * reports it, and most marks at most zooms are too small.
 */
export function waveformFit(
  sampleDuration: number,
  cps: number | null | undefined,
  markW: number,
  markH: number,
  pxPerCycle: number,
  /** What the mark plays. Omitted or absent means the whole file, once,
   *  forwards — the reading every caller had before #1512. */
  region?: SampleRegion | null,
): WaveformFit | null {
  if (cps == null || !Number.isFinite(cps) || cps <= 0) return null
  if (!Number.isFinite(sampleDuration) || sampleDuration <= 0) return null
  if (!Number.isFinite(pxPerCycle) || pxPerCycle <= 0) return null
  if (!Number.isFinite(markW) || markW <= 0) return null
  if (markH < MIN_WAVEFORM_H) return null

  // The audible slice, not the file (#1512). With no region this resolves to
  // the file's own duration at rate 1, so the arithmetic below is unchanged.
  const played = regionPlayback(region ?? WHOLE_SAMPLE, sampleDuration)
  if (played == null) return null

  const audioPx = played.seconds * cps * pxPerCycle
  const extentPx = Math.min(markW, audioPx)
  if (extentPx < MIN_WAVEFORM_W) return null
  return {
    extentPx,
    visibleFraction: Math.min(1, markW / audioPx),
    from: played.from,
    to: played.to,
    reversed: played.reversed,
  }
}

/** The min/max envelope of one drawn column. */
export interface Column {
  readonly min: number
  readonly max: number
}

/**
 * Reduce a cached envelope to the column at `index` of `total` drawn columns.
 *
 * The cache holds a fixed, zoom-independent number of source columns, so this is
 * always a reduction: each drawn column takes the extremes of every source
 * column that lands inside it. Averaging instead would shrink transients as you
 * zoomed out, which is the one thing a waveform exists to show.
 *
 * The read is confined to the slice the mark PLAYS — `fit.from` to `fit.to`
 * (#1512) — so a chopped take's third mark reads the file's third quarter and
 * not the file. `visibleFraction` then restricts it further to the part the mark
 * has room for, so a slice longer than its slot shows its start rather than a
 * squashed version of the whole slice.
 *
 * ⚠ THE TRUNCATION FOLLOWS PLAYBACK ORDER, WHICH IS NOT ALWAYS LEFT TO RIGHT.
 * A reversed slice starts at `to` and runs back toward `from`, so what a short
 * mark can show is the region's TAIL, read backwards. Truncating from `from` in
 * both directions would draw the half that never sounds.
 */
export function waveformColumn(
  data: Float32Array,
  sourceColumns: number,
  index: number,
  total: number,
  fit: Pick<WaveformFit, 'visibleFraction' | 'from' | 'to' | 'reversed'>,
): Column {
  if (total <= 0 || sourceColumns <= 0) return { min: 0, max: 0 }
  const fromCol = fit.from * sourceColumns
  const toCol = fit.to * sourceColumns
  const span = toCol - fromCol
  if (!(span > 0)) return { min: 0, max: 0 }
  // How many source columns the mark has room for, measured along the region.
  const usable = Math.max(1, Math.floor(span * Math.min(1, Math.max(0, fit.visibleFraction))))
  // Offsets into the region, in PLAYBACK order.
  const o0 = Math.floor((index * usable) / total)
  const o1 = Math.max(o0 + 1, Math.floor(((index + 1) * usable) / total))
  // …mapped back to file order. Forwards reads out from the region's start;
  // reversed reads back from its end.
  const start = fit.reversed ? Math.ceil(toCol) - o1 : Math.floor(fromCol) + o0
  const end = fit.reversed ? Math.ceil(toCol) - o0 : Math.floor(fromCol) + o1
  let min = Infinity
  let max = -Infinity
  for (let i = Math.max(0, start); i < end && i < sourceColumns; i++) {
    const lo = data[i * 2]
    const hi = data[i * 2 + 1]
    if (lo < min) min = lo
    if (hi > max) max = hi
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { min: 0, max: 0 }
  return { min, max }
}
