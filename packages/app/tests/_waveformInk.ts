/**
 * Shared canvas readers for the waveform specs (#1506, #1509).
 *
 * Extracted rather than copied: two specs asking "is a shape drawn here" must
 * ask it the same way, or a change to one threshold silently makes them
 * disagree about the same pixels. Not a `.spec.ts`, so Playwright never
 * collects it.
 */
import type { Page } from '@playwright/test'

/** Per-column height of FULLY saturated lane ink, read off the real canvas. */
export interface InkProfile {
  readonly columns: number[]
  readonly width: number
}

/**
 * Count, for each canvas column, the pixels drawn in the lane's own colour at
 * full strength.
 *
 * Saturation separates lane ink from every piece of theme furniture — the
 * background, the row stripes, the section bands and the gridlines are all
 * greys. Brightness then separates the waveform (drawn at full opacity) from the
 * bar beneath it, which the bed has washed toward the background. Both
 * thresholds are relative to the brightest lane pixel found in this same
 * snapshot, so nothing here depends on knowing the track's colour in advance.
 */
export async function readInk(page: Page): Promise<InkProfile> {
  return page.evaluate(() => {
    const canvas = document.querySelector('[data-full-song-canvas]') as HTMLCanvasElement | null
    if (!canvas) throw new Error('no song canvas')
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('no 2d context')
    const { width, height } = canvas
    const { data } = ctx.getImageData(0, 0, width, height)

    const saturation = (i: number) => {
      const r = data[i]
      const g = data[i + 1]
      const b = data[i + 2]
      return Math.max(r, g, b) - Math.min(r, g, b)
    }
    const brightness = (i: number) => data[i] + data[i + 1] + data[i + 2]

    let peak = 0
    for (let i = 0; i < data.length; i += 4) {
      if (saturation(i) > 40 && brightness(i) > peak) peak = brightness(i)
    }
    if (peak === 0) return { columns: new Array(width).fill(0), width }

    const columns: number[] = new Array(width).fill(0)
    for (let x = 0; x < width; x++) {
      let n = 0
      for (let y = 0; y < height; y++) {
        const i = (y * width + x) * 4
        if (saturation(i) > 40 && brightness(i) >= peak * 0.9) n++
      }
      columns[x] = n
    }
    return { columns, width }
  })
}

/**
 * The first contiguous run of inked columns — one mark.
 *
 * Located rather than assumed. An earlier version measured fixed fractions of
 * the whole inked span on the belief that one cycle was on screen; two are, so
 * it sampled the wrong places and read a working waveform as a flat bar.
 */
export function firstMark(profile: InkProfile): number[] {
  const run: number[] = []
  let started = false
  for (const n of profile.columns) {
    if (n > 0) {
      started = true
      run.push(n)
    } else if (started) {
      break
    }
  }
  return run
}

/**
 * How much a drawn mark VARIES across its columns.
 *
 * A bar-only rendering is flat, so every column is the full height and this is
 * 1. A waveform of audio that is loud in places and silent in others must reach
 * both. This is the discriminator between "the mark is drawn" and "the mark's
 * shape is drawn", stated as a ratio of two readings inside ONE snapshot.
 */
export function markVariation(mark: number[]): number {
  const inked = mark.filter((n) => n > 0)
  if (inked.length === 0) return 0
  return Math.max(...inked) / Math.min(...inked)
}

/**
 * A 16-bit mono PCM WAV alternating `halfSeconds` of a loud 220 Hz tone with the
 * same length of silence.
 *
 * Used as Chromium's fake capture source, so the RECORDING path carries audio
 * whose shape is known in advance. The default fake device is a sparse beep that
 * peaks around 0.23 and is otherwise silent (measured), which cannot be told
 * apart from the flat bar a waveform must differ from.
 */
export function alternatingWav(sampleRate = 48000, seconds = 8, halfSeconds = 0.5): Buffer {
  const frames = Math.floor(sampleRate * seconds)
  const period = Math.max(1, Math.floor(sampleRate * halfSeconds))
  const data = Buffer.alloc(frames * 2)
  for (let i = 0; i < frames; i++) {
    const loud = Math.floor(i / period) % 2 === 0
    const v = loud ? Math.sin((2 * Math.PI * 220 * i) / sampleRate) * 0.9 : 0
    data.writeInt16LE(Math.round(v * 32767), i * 2)
  }
  const h = Buffer.alloc(44)
  h.write('RIFF', 0)
  h.writeUInt32LE(36 + data.length, 4)
  h.write('WAVE', 8)
  h.write('fmt ', 12)
  h.writeUInt32LE(16, 16)
  h.writeUInt16LE(1, 20) // PCM
  h.writeUInt16LE(1, 22) // mono
  h.writeUInt32LE(sampleRate, 24)
  h.writeUInt32LE(sampleRate * 2, 28)
  h.writeUInt16LE(2, 32)
  h.writeUInt16LE(16, 34)
  h.write('data', 36)
  h.writeUInt32LE(data.length, 40)
  return Buffer.concat([h, data])
}
