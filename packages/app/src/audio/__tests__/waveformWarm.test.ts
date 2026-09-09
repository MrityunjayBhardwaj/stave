import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const warmSamplePeaks = vi.fn<(names: readonly string[]) => Promise<string[]>>()

vi.mock('@stave/editor', () => ({
  warmSamplePeaks: (names: readonly string[]) => warmSamplePeaks(names),
}))

const { notifyWaveformsReady, subscribeWaveformsReady, warmWaveforms } = await import(
  '../waveformWarm'
)

/**
 * The bridge between "audio finished decoding" and "the timeline repaints"
 * (#1506).
 *
 * The notification is the whole point of the module: the canvas is dirty-flagged
 * on scene, transform and size, and a decode completing is none of those. So
 * these arms assert that the notify path RUNS, not merely that it exists — an
 * unsubscribed listener would look identical to a working one in any test that
 * only checked the returned names.
 */

let unsubscribes: Array<() => void> = []

beforeEach(() => {
  warmSamplePeaks.mockReset()
  unsubscribes = []
})
afterEach(() => {
  for (const off of unsubscribes) off()
})

function listen(fn: () => void) {
  const off = subscribeWaveformsReady(fn)
  unsubscribes.push(off)
  return off
}

describe('warmWaveforms', () => {
  it('announces once after warming, not once per name', async () => {
    warmSamplePeaks.mockResolvedValue(['take_1', 'take_2'])
    const heard = vi.fn()
    listen(heard)

    await expect(warmWaveforms(['take_1', 'take_2'])).resolves.toEqual(['take_1', 'take_2'])
    expect(heard).toHaveBeenCalledTimes(1)
  })

  it('says nothing when nothing warmed, so an assetless project costs no repaint', async () => {
    warmSamplePeaks.mockResolvedValue([])
    const heard = vi.fn()
    listen(heard)

    await warmWaveforms(['gone'])
    expect(heard).not.toHaveBeenCalled()
  })

  it('does not even ask when there are no names', async () => {
    const heard = vi.fn()
    listen(heard)
    await expect(warmWaveforms([])).resolves.toEqual([])
    expect(warmSamplePeaks).not.toHaveBeenCalled()
    expect(heard).not.toHaveBeenCalled()
  })

  it('leaves the timeline alone when warming throws', async () => {
    warmSamplePeaks.mockRejectedValue(new Error('storage is gone'))
    const heard = vi.fn()
    listen(heard)

    await expect(warmWaveforms(['take_1'])).resolves.toEqual([])
    expect(heard).not.toHaveBeenCalled()
  })
})

describe('subscribeWaveformsReady', () => {
  it('stops delivering after unsubscribe', () => {
    const heard = vi.fn()
    const off = listen(heard)
    notifyWaveformsReady()
    expect(heard).toHaveBeenCalledTimes(1)
    off()
    notifyWaveformsReady()
    expect(heard).toHaveBeenCalledTimes(1)
  })

  it('tells every listener even when one throws', () => {
    // A timeline unmounting mid-notification must not silence the others.
    const broken = vi.fn(() => {
      throw new Error('unmounted')
    })
    const healthy = vi.fn()
    listen(broken)
    listen(healthy)
    expect(() => notifyWaveformsReady()).not.toThrow()
    expect(broken).toHaveBeenCalledTimes(1)
    expect(healthy).toHaveBeenCalledTimes(1)
  })
})
