import { beforeEach, describe, expect, it } from 'vitest'

import {
  PEAK_COLUMNS,
  clearSamplePeaksCache,
  computePeaks,
  peaksForSample,
  resolveSampleUrl,
  warmSamplePeaks,
  type SamplePeaksDeps,
} from '../samplePeaks'

/**
 * The waveform envelope behind #1506. `computePeaks` is fully pure, so it is
 * tested against exact values on synthetic buffers — this is arithmetic, not a
 * device reading, and there is no sample rate or canvas in the way.
 *
 * The resolver half is driven through injected engine reads. What is NOT tested
 * here is that superdough hands back the buffer it says it will; that is a real
 * engine with a real decode, and it is observed in the browser instead.
 */

/** Peaks come back interleaved — read column `i` as a pair. */
function pair(data: Float32Array, i: number): [number, number] {
  return [data[i * 2], data[i * 2 + 1]]
}

describe('computePeaks', () => {
  it('reduces silence to zero-width columns', () => {
    const peaks = computePeaks([new Float32Array(64)], 4)
    expect(peaks).toHaveLength(8)
    expect(Array.from(peaks)).toEqual([0, 0, 0, 0, 0, 0, 0, 0])
  })

  it('reports the true min and max within each column', () => {
    // Four columns over eight samples: each column sees exactly two samples.
    const channel = new Float32Array([0, 1, -1, 0.5, 0.25, 0.25, -0.75, 0])
    const peaks = computePeaks([channel], 4)
    expect(pair(peaks, 0)).toEqual([0, 1])
    expect(pair(peaks, 1)).toEqual([-1, 0.5])
    expect(pair(peaks, 2)).toEqual([0.25, 0.25])
    expect(pair(peaks, 3)).toEqual([-0.75, 0])
  })

  it('takes the envelope across ALL channels, not just the first', () => {
    // A sound panned hard right: channel 0 is silent throughout. Reading only
    // channel 0 would draw this as silence.
    const left = new Float32Array([0, 0, 0, 0])
    // Eighths, so every value is exact in a Float32Array and the assertion can
    // stay exact rather than approximate.
    const right = new Float32Array([0.875, -0.75, 0.625, -0.5])
    const stereo = computePeaks([left, right], 2)
    expect(pair(stereo, 0)).toEqual([-0.75, 0.875])
    expect(pair(stereo, 1)).toEqual([-0.5, 0.625])

    const leftOnly = computePeaks([left], 2)
    expect(pair(leftOnly, 0)).toEqual([0, 0]) // the shape that would have been drawn
  })

  it('fills columns from the nearest sample when the buffer is shorter than the column count', () => {
    // 3 samples into 6 columns: every other column spans no samples at all.
    // Those columns must carry the neighbouring value, not zero — zero would
    // draw a comb of false silence through a magnified click.
    const peaks = computePeaks([new Float32Array([1, -1, 0.5])], 6)
    for (let i = 0; i < 6; i++) {
      const [min, max] = pair(peaks, i)
      expect(Number.isFinite(min)).toBe(true)
      expect(Number.isFinite(max)).toBe(true)
    }
    // Not a single column reads as silence, because the source is never silent.
    const silent = Array.from({ length: 6 }, (_, i) => pair(peaks, i)).filter(
      ([min, max]) => min === 0 && max === 0,
    )
    expect(silent).toEqual([])
  })

  it('returns nothing for a non-positive column count', () => {
    expect(computePeaks([new Float32Array([1])], 0)).toHaveLength(0)
    expect(computePeaks([new Float32Array([1])], -3)).toHaveLength(0)
  })

  it('survives an empty channel list and an empty channel', () => {
    expect(Array.from(computePeaks([], 2))).toEqual([0, 0, 0, 0])
    expect(Array.from(computePeaks([new Float32Array(0)], 2))).toEqual([0, 0, 0, 0])
  })
})

/** A bank-carrying sound, as `registerSample` stores one. */
function sampleSound(bank: Record<string, string[]> | string[]) {
  return { data: { type: 'sample', samples: bank } }
}

/** Engine reads, stubbed. `buffers` maps a URL to an already-decoded buffer. */
function deps(overrides: Partial<SamplePeaksDeps> = {}): SamplePeaksDeps {
  return {
    getSound: () => sampleSound(['take_1.webm']),
    getSampleInfo: () => ({
      transpose: 0,
      url: 'take_1.webm',
      index: 0,
      midi: 36,
      label: 'take_1:0',
      playbackRate: 1,
    }),
    getCachedBuffer: () => undefined,
    ...overrides,
  } as SamplePeaksDeps
}

/** A decoded buffer stand-in — only the three members the module reads. */
function fakeBuffer(channels: Float32Array[], duration: number) {
  return {
    numberOfChannels: channels.length,
    duration,
    getChannelData: (i: number) => channels[i],
  } as unknown as AudioBuffer
}

describe('resolveSampleUrl', () => {
  beforeEach(clearSamplePeaksCache)

  it('resolves a registered sample to the url playback would use', () => {
    expect(resolveSampleUrl({ s: 'take_1' }, deps())).toBe('take_1.webm')
  })

  it('returns null for a sound that carries no bank', () => {
    // Synths, wavetables and the audio-in bus. Most lanes are not samples, and
    // that is not a failure — it must not throw or log.
    const synth = deps({ getSound: () => ({ data: { type: 'synth' } }) })
    expect(resolveSampleUrl({ s: 'sawtooth' }, synth)).toBeNull()
  })

  it('returns null for a name nothing registered', () => {
    expect(resolveSampleUrl({ s: 'nope' }, deps({ getSound: () => undefined }))).toBeNull()
  })

  it('passes note and n through, because they choose the FILE and not only the pitch', () => {
    const seen: Record<string, unknown>[] = []
    const spying = deps({
      getSound: () => sampleSound({ c3: ['low.wav'], c5: ['high.wav'] }),
      getSampleInfo: (hapValue) => {
        seen.push(hapValue)
        return { transpose: 0, url: 'low.wav', index: 0, midi: 48, label: 'p:0', playbackRate: 1 }
      },
    })
    resolveSampleUrl({ s: 'piano', note: 72, n: 2 }, spying)
    expect(seen).toEqual([{ s: 'piano', note: 72, n: 2 }])
  })

  it('omits note and n when the mark has none, so superdough applies its own defaults', () => {
    const seen: Record<string, unknown>[] = []
    const spying = deps({
      getSampleInfo: (hapValue) => {
        seen.push(hapValue)
        return { transpose: 0, url: 'u', index: 0, midi: 36, label: 'l', playbackRate: 1 }
      },
    })
    resolveSampleUrl({ s: 'bd', note: null, n: null }, spying)
    expect(seen).toEqual([{ s: 'bd' }])
  })

  it('treats a malformed bank as "nothing to draw" rather than an error', () => {
    const throwing = deps({
      getSampleInfo: () => {
        throw new TypeError('bank is not iterable')
      },
    })
    expect(() => resolveSampleUrl({ s: 'take_1' }, throwing)).not.toThrow()
    expect(resolveSampleUrl({ s: 'take_1' }, throwing)).toBeNull()
  })
})

describe('peaksForSample', () => {
  beforeEach(clearSamplePeaksCache)

  it('returns null while the sample is still un-decoded, and reads no audio', () => {
    let channelReads = 0
    const cold = deps({
      getCachedBuffer: () => undefined,
      // If the module ever fetched or decoded, this would be the only way it
      // could get channel data — so a zero here is the "no I/O" claim.
    })
    const peaks = peaksForSample({ s: 'take_1' }, cold)
    expect(peaks).toBeNull()
    expect(channelReads).toBe(0)
  })

  it('computes peaks and carries the decoded duration once the buffer is warm', () => {
    const buffer = fakeBuffer([new Float32Array([0, 1, -1, 0])], 2.75)
    const warm = deps({ getCachedBuffer: () => buffer })
    const peaks = peaksForSample({ s: 'take_1' }, warm)
    expect(peaks).not.toBeNull()
    expect(peaks!.columns).toBe(PEAK_COLUMNS)
    expect(peaks!.data).toHaveLength(PEAK_COLUMNS * 2)
    expect(peaks!.duration).toBe(2.75)
    // The envelope reaches the extremes the source actually has.
    const all = Array.from(peaks!.data)
    expect(Math.min(...all)).toBe(-1)
    expect(Math.max(...all)).toBe(1)
  })

  /**
   * The memo is asserted by the WORK IT AVOIDS, not by comparing what came back.
   * Two calls returning an equal-looking result is something the un-memoised
   * version does just as well, so that assertion could not fail; counting reads
   * of the buffer can.
   */
  it('computes a given url only once — the second call reads no buffer at all', () => {
    let bufferReads = 0
    const counting = deps({
      getCachedBuffer: () => {
        bufferReads++
        return fakeBuffer([new Float32Array([0.5, -0.5])], 1)
      },
    })
    peaksForSample({ s: 'take_1' }, counting)
    expect(bufferReads).toBe(1)
    peaksForSample({ s: 'take_1' }, counting)
    peaksForSample({ s: 'take_1' }, counting)
    expect(bufferReads).toBe(1) // 1, not 3 — the recompute never happened
  })

  it('clearing the cache makes the next call do the work again', () => {
    // Guards the re-import case: new bytes under a name that already drew.
    let bufferReads = 0
    const counting = deps({
      getCachedBuffer: () => {
        bufferReads++
        return fakeBuffer([new Float32Array([1])], 1)
      },
    })
    peaksForSample({ s: 'take_1' }, counting)
    clearSamplePeaksCache()
    peaksForSample({ s: 'take_1' }, counting)
    expect(bufferReads).toBe(2)
  })

  it('returns null for a lane that is not a sample, without touching the buffer cache', () => {
    let bufferReads = 0
    const synth = deps({
      getSound: () => ({ data: { type: 'synth' } }),
      getCachedBuffer: () => {
        bufferReads++
        return undefined
      },
    })
    expect(peaksForSample({ s: 'sawtooth' }, synth)).toBeNull()
    expect(bufferReads).toBe(0)
  })
})

describe('warmSamplePeaks', () => {
  beforeEach(clearSamplePeaksCache)

  /** Warm deps that record what they were asked to load. */
  function warmIo(loaded: string[], fail = false) {
    return {
      loadBuffer: async (url: string) => {
        loaded.push(url)
        if (fail) throw new Error('404')
        return fakeBuffer([new Float32Array([1, -1])], 1) as AudioBuffer
      },
      getAudioContext: () => ({}) as AudioContext,
    }
  }

  it('loads a not-yet-decoded sample and reports it warmed', async () => {
    const loaded: string[] = []
    let decoded: AudioBuffer | undefined
    const engine = deps({ getCachedBuffer: () => decoded })
    const io = {
      loadBuffer: async (url: string) => {
        loaded.push(url)
        decoded = fakeBuffer([new Float32Array([1, -1])], 1.5)
        return decoded
      },
      getAudioContext: () => ({}) as AudioContext,
    }
    await expect(warmSamplePeaks(['take_1'], engine, io)).resolves.toEqual(['take_1'])
    expect(loaded).toEqual(['take_1.webm'])
    // And it is now drawable with NO further I/O.
    expect(peaksForSample({ s: 'take_1' }, engine)!.duration).toBe(1.5)
  })

  it('does not re-load a sample the engine has already decoded', async () => {
    const loaded: string[] = []
    const engine = deps({ getCachedBuffer: () => fakeBuffer([new Float32Array([0.5])], 1) })
    await warmSamplePeaks(['take_1'], engine, warmIo(loaded))
    expect(loaded).toEqual([]) // the whole point: it was already there
  })

  it('skips a name that resolves to nothing, without loading', async () => {
    const loaded: string[] = []
    const notASample = deps({ getSound: () => ({ data: { type: 'synth' } }) })
    await expect(warmSamplePeaks(['sawtooth'], notASample, warmIo(loaded))).resolves.toEqual([])
    expect(loaded).toEqual([])
  })

  it('lets one unreadable take cost only its own waveform', async () => {
    const loaded: string[] = []
    let decoded: AudioBuffer | undefined
    const engine = deps({
      getSound: () => sampleSound(['a.webm']),
      getSampleInfo: (hapValue) => ({
        transpose: 0,
        url: `${String(hapValue.s)}.webm`,
        index: 0,
        midi: 36,
        label: 'l',
        playbackRate: 1,
      }),
      getCachedBuffer: () => decoded,
    })
    const io = {
      loadBuffer: async (url: string) => {
        loaded.push(url)
        if (url === 'bad.webm') throw new Error('bytes are gone')
        decoded = fakeBuffer([new Float32Array([1])], 1)
        return decoded
      },
      getAudioContext: () => ({}) as AudioContext,
    }
    const warmed = await warmSamplePeaks(['bad', 'good'], engine, io)
    expect(loaded).toEqual(['bad.webm', 'good.webm']) // it kept going
    expect(warmed).toEqual(['good'])
  })
})
