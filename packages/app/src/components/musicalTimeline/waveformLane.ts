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
 * `begin`/`end`/`speed`/reverse are not reflected either; `SceneNote` does not
 * carry them, and they become first-class with the region work in #1352's
 * Phase 4. The shape shown is the shape of the file that will play.
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
 * A mark is ~3px tall at the default row height, which is one pixel either side
 * of the centre line — an amplitude that cannot vary is not a waveform. Growing
 * the timeline's row height is what buys the detail, which is the "at the
 * fidelity the row height allows" half of the rule.
 */
export const MIN_WAVEFORM_H = 8

/** How much of a mark a sample's audio fills, and how much of the sample shows. */
export interface WaveformFit {
  /** Width in px, measured from the mark's left edge. */
  readonly extentPx: number
  /** Fraction of the SAMPLE that fits; 1 when the whole file is inside the mark. */
  readonly visibleFraction: number
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
): WaveformFit | null {
  if (cps == null || !Number.isFinite(cps) || cps <= 0) return null
  if (!Number.isFinite(sampleDuration) || sampleDuration <= 0) return null
  if (!Number.isFinite(pxPerCycle) || pxPerCycle <= 0) return null
  if (!Number.isFinite(markW) || markW <= 0) return null
  if (markH < MIN_WAVEFORM_H) return null

  const audioPx = sampleDuration * cps * pxPerCycle
  const extentPx = Math.min(markW, audioPx)
  if (extentPx < MIN_WAVEFORM_W) return null
  return { extentPx, visibleFraction: Math.min(1, markW / audioPx) }
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
 * `visibleFraction` restricts the read to the part of the sample the mark has
 * room for, so a file longer than its slot shows its BEGINNING rather than a
 * squashed version of the whole thing.
 */
export function waveformColumn(
  data: Float32Array,
  sourceColumns: number,
  index: number,
  total: number,
  visibleFraction: number,
): Column {
  if (total <= 0 || sourceColumns <= 0) return { min: 0, max: 0 }
  const usable = Math.max(1, Math.floor(sourceColumns * Math.min(1, Math.max(0, visibleFraction))))
  const start = Math.floor((index * usable) / total)
  const end = Math.max(start + 1, Math.floor(((index + 1) * usable) / total))
  let min = Infinity
  let max = -Infinity
  for (let i = start; i < end && i < sourceColumns; i++) {
    const lo = data[i * 2]
    const hi = data[i * 2 + 1]
    if (lo < min) min = lo
    if (hi > max) max = hi
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { min: 0, max: 0 }
  return { min, max }
}
