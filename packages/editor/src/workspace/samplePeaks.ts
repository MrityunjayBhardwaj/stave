/**
 * samplePeaks — the min/max envelope of a decoded sample, so the Song timeline
 * can draw what a sound actually looks like (#1506, the mechanism #900 describes).
 *
 * ## Why this lives in the editor
 *
 * The app cannot reach any of the audio it draws. It depends on `@strudel/mini`
 * and nothing else from the Strudel family, while `superdough` — which owns both
 * the sample registry and the decoded-buffer cache — arrives only through
 * `@strudel/webaudio`, an editor dependency (`@strudel/webaudio/index.mjs:11`
 * re-exports superdough wholesale). This is the same route `assetStore.ts` takes
 * for `samples`.
 *
 * That constraint happens to point the same way the design does. The side that
 * owns playback is the side that can answer "which bytes are these?", and a
 * waveform resolved anywhere else would be a second opinion about what plays —
 * exactly the drift #900 warns about when it asks for the drawn shape to reflect
 * the sound rather than the file.
 *
 * ## The cache is cold until something plays
 *
 * `getCachedBuffer` reads a map that `loadBuffer` fills only once a fetch and a
 * decode have both completed (`superdough/sampler.mjs:86-101`). A page that has
 * not played yet has none of it. So every read here is allowed to return null,
 * and callers are expected to treat a missing waveform as "not yet" rather than
 * as an error — the timeline simply draws the mark it drew before.
 *
 * One thing worth writing down because the library says otherwise: superdough
 * labels that cache `string: Promise<ArrayBuffer>` (`sampler.mjs:14`). It is
 * neither a promise nor an ArrayBuffer. `sampler.mjs:100` stores the *decoded*
 * buffer, and the accessor at `:17` is synchronous. Reading the comment instead
 * of the code costs an `await` on a value that never settles.
 */

import { getAudioContext, getCachedBuffer, getSampleInfo, getSound, loadBuffer } from '@strudel/webaudio'

/**
 * Envelope resolution held per sample, independent of zoom.
 *
 * Peaks are cached ONCE at this width and downsampled to whatever a mark is
 * worth at draw time, rather than cached per (sample, pixel width). The
 * alternative thrashes: a mark's width changes on every zoom step and on every
 * window resize, so a width-keyed cache would recompute the whole envelope for
 * a scroll gesture and hold an entry per width it ever saw.
 *
 * 1024 is well past what any single mark can show — a mark that wide is most of
 * the viewport — so downsampling is always a reduction and never an
 * interpolation that would invent detail the sample does not have.
 */
export const PEAK_COLUMNS = 1024

/**
 * A sample's drawable shape.
 *
 * `data` is interleaved `[min0, max0, min1, max1, …]` rather than two arrays:
 * the draw loop reads a column's pair together, so keeping them adjacent is one
 * allocation and one cache line instead of two of each.
 */
export interface SamplePeaks {
  /** Interleaved min/max pairs; length is always `2 * columns`. */
  readonly data: Float32Array
  /** Number of min/max pairs in `data`. */
  readonly columns: number
  /**
   * Decoded length in SECONDS.
   *
   * Carried with the peaks because it is the numerator of the timeline's
   * fidelity rule (sample duration ÷ the slot it is triggered into), and the
   * only other way to get it is a second trip through the buffer cache.
   */
  readonly duration: number
}

/**
 * Reduce decoded channel data to `columns` min/max pairs.
 *
 * Pure, and deliberately takes CHANNELS rather than one channel: the envelope of
 * a stereo sample is the envelope of both sides, and drawing only channel 0
 * would under-report anything panned right. Taking the min and max across all
 * channels costs one linear pass either way and cannot understate the sound.
 *
 * When a column spans no samples — which happens whenever the buffer is shorter
 * than `columns`, e.g. a 300-sample click drawn into 1024 slots — the column
 * takes the nearest sample's value rather than zero. Zero would draw silence
 * that is not there, breaking a short sample into a comb of gaps; nearest-value
 * draws the same shape at lower information, which is what a magnified waveform
 * genuinely is.
 */
export function computePeaks(channels: readonly Float32Array[], columns: number): Float32Array {
  if (columns <= 0) return new Float32Array(0)
  const out = new Float32Array(columns * 2)
  const length = channels.length > 0 ? channels[0].length : 0
  if (length === 0 || channels.length === 0) return out // silence: every pair stays 0/0

  for (let col = 0; col < columns; col++) {
    const start = Math.floor((col * length) / columns)
    const end = Math.floor(((col + 1) * length) / columns)
    let min = Infinity
    let max = -Infinity
    if (end > start) {
      for (const channel of channels) {
        for (let i = start; i < end; i++) {
          const v = channel[i]
          if (v < min) min = v
          if (v > max) max = v
        }
      }
    } else {
      // Column spans no samples — read the nearest one instead of drawing a gap.
      const at = Math.min(start, length - 1)
      for (const channel of channels) {
        const v = channel[at]
        if (v < min) min = v
        if (v > max) max = v
      }
    }
    out[col * 2] = min
    out[col * 2 + 1] = max
  }
  return out
}

/** Every channel of a decoded buffer, as the arrays `computePeaks` reduces. */
function channelsOf(buffer: AudioBuffer): Float32Array[] {
  const channels: Float32Array[] = []
  for (let c = 0; c < buffer.numberOfChannels; c++) channels.push(buffer.getChannelData(c))
  return channels
}

/**
 * Peaks already computed for a resolved sample URL.
 *
 * Keyed by URL rather than by sound name because that is the identity the audio
 * actually has: two names can register the same file, and one name can resolve
 * to different files depending on `n` and on the note it is played at. The URL
 * is what `loadBuffer` keys its own cache on (`sampler.mjs:86-101`), so this
 * cache and superdough's fill and miss together.
 */
const peakCache = new Map<string, SamplePeaks>()

/** The shape `getSampleInfo` needs — the subset of a hap the timeline can supply. */
export interface SampleRef {
  /** Sound name, i.e. the `s` of the event. */
  readonly s: string
  /**
   * MIDI note, when the mark carries one.
   *
   * Load-bearing for multi-sample instruments: an object-format bank picks its
   * file by nearest note (`superdough/util.mjs:97-107`), so a piano's low C and
   * high C are different files with different shapes. Percussive marks have no
   * pitch and pass nothing.
   */
  readonly note?: number | null
  /** Sample index within the bank (`n`); defaults to superdough's own 0. */
  readonly n?: number | null
}

/** The engine reads this module performs, isolated so tests can drive it. */
export interface SamplePeaksDeps {
  readonly getSound: typeof getSound
  readonly getSampleInfo: typeof getSampleInfo
  readonly getCachedBuffer: typeof getCachedBuffer
}

const liveDeps: SamplePeaksDeps = { getSound, getSampleInfo, getCachedBuffer }

/**
 * Which file would this event play? `null` when the name is not a sample.
 *
 * Mirrors the registration path exactly: `registerSample` stores the bank as
 * `data.samples` on the sound (`sampler.mjs:354-359`) and hands that same bank
 * to `onTriggerSample`, so reading `data.samples` here asks the question the
 * trigger will ask. Synths, wavetables and the audio-in bus have no bank and
 * fall out as null rather than as an error — most lanes on a timeline are not
 * samples, and that is not a failure.
 */
export function resolveSampleUrl(ref: SampleRef, deps: SamplePeaksDeps = liveDeps): string | null {
  const sound = deps.getSound(ref.s)
  const bank = (sound as { data?: { samples?: unknown } } | undefined)?.data?.samples
  if (bank == null || typeof bank !== 'object') return null
  try {
    const hapValue: Record<string, unknown> = { s: ref.s }
    if (ref.note != null) hapValue.note = ref.note
    if (ref.n != null) hapValue.n = ref.n
    const { url } = deps.getSampleInfo(hapValue, bank as never)
    return typeof url === 'string' && url.length > 0 ? url : null
  } catch {
    // A malformed bank is a registration problem, not a drawing one. The lane
    // keeps the marks it already had.
    return null
  }
}

/**
 * Peaks for an event, or `null` when they cannot be had YET.
 *
 * Never performs I/O. A miss means the sample has not been fetched and decoded,
 * which on a freshly loaded page is every sample that has not played. Triggering
 * a load from here would make scrolling a timeline pull a drum kit off a CDN,
 * which is a surprising thing for a view to do; the local assets that matter for
 * seeing a take are warmed deliberately elsewhere instead.
 */
export function peaksForSample(ref: SampleRef, deps: SamplePeaksDeps = liveDeps): SamplePeaks | null {
  const url = resolveSampleUrl(ref, deps)
  if (url == null) return null
  const cached = peakCache.get(url)
  if (cached) return cached
  const buffer = deps.getCachedBuffer(url)
  if (buffer == null) return null
  const peaks: SamplePeaks = {
    data: computePeaks(channelsOf(buffer), PEAK_COLUMNS),
    columns: PEAK_COLUMNS,
    duration: buffer.duration,
  }
  peakCache.set(url, peaks)
  return peaks
}

/**
 * Drop memoised peaks.
 *
 * Exists for tests and for the case where an asset's bytes are replaced under a
 * name it already had. Without it a re-imported take would keep drawing the
 * shape of the recording it replaced, and the stale picture would outlive the
 * session that made it.
 */
export function clearSamplePeaksCache(): void {
  peakCache.clear()
}

/** The two I/O edges warming needs, isolated so a test can drive it dry. */
export interface SampleWarmDeps {
  readonly loadBuffer: typeof loadBuffer
  readonly getAudioContext: typeof getAudioContext
}

const liveWarmDeps: SampleWarmDeps = { loadBuffer, getAudioContext }

/**
 * Fetch, decode and reduce the named sounds so their shapes can be drawn before
 * anything has played them (#1506).
 *
 * Called for LOCAL assets only — takes and imported files, whose bytes are
 * already in IndexedDB and whose URLs are `blob:`, so "fetching" is a read from
 * memory and there is no network. Doing this for the CDN sample banks would mean
 * a page load quietly pulling megabytes of drums to draw pictures of them, which
 * is why the draw path itself never loads anything and this is the deliberate,
 * bounded exception.
 *
 * Resolves to the names actually warmed. Individual failures are skipped rather
 * than thrown: a take whose bytes went missing should cost its own waveform and
 * nothing else, and the timeline already renders correctly without it.
 */
export async function warmSamplePeaks(
  names: readonly string[],
  deps: SamplePeaksDeps = liveDeps,
  io: SampleWarmDeps = liveWarmDeps,
): Promise<string[]> {
  const warmed: string[] = []
  for (const name of names) {
    try {
      const url = resolveSampleUrl({ s: name }, deps)
      if (url == null) continue
      if (deps.getCachedBuffer(url) == null) {
        await io.loadBuffer(url, io.getAudioContext(), name)
      }
      if (peaksForSample({ s: name }, deps) != null) warmed.push(name)
    } catch {
      // A take that cannot be decoded simply has no waveform.
    }
  }
  return warmed
}
