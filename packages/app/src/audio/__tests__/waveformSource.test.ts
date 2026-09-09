import { describe, expect, it, vi } from 'vitest'

const peaksForSample = vi.fn()

vi.mock('@stave/editor', () => ({
  peaksForSample: (ref: unknown) => peaksForSample(ref),
}))

const { ASSUMED_CPS, createWaveformSource } = await import('../waveformSource')

/**
 * The adapter between the renderer and the decoded audio (#1506).
 *
 * The tempo arm is the one that matters. Refusing to draw without a tempo was
 * the first implementation, and it made the feature unreachable: `getBpm()` is
 * documented and asserted to return `undefined` until the first successful play
 * (`workspace/types.ts:695`, `LiveCodingRuntime.test.ts:620`), so a take could
 * not be SEEN until it had been HEARD — which is the opposite of the point. It
 * was caught by reading pixels off a real canvas, not here.
 */

describe('createWaveformSource', () => {
  it('assumes Strudel’s own default tempo when the transport has never run', () => {
    const source = createWaveformSource(() => null)
    expect(source.cps).toBe(ASSUMED_CPS)
    expect(ASSUMED_CPS).toBe(0.5) // @strudel/core/cyclist.mjs:24
  })

  it('prefers the real tempo the moment there is one', () => {
    let live: number | null = null
    const source = createWaveformSource(() => live)
    expect(source.cps).toBe(ASSUMED_CPS)
    live = 2.3333
    expect(source.cps).toBe(2.3333)
  })

  it('re-reads the tempo on every access, so a change corrects itself', () => {
    // The getter is read once per draw. Capturing the value instead would leave
    // every waveform at the width of whatever the tempo was when the timeline
    // mounted, and nothing would ever put it right.
    const seen: number[] = []
    let live = 0.5
    const source = createWaveformSource(() => {
      seen.push(live)
      return live
    })
    void source.cps
    live = 1.5
    expect(source.cps).toBe(1.5)
    expect(seen).toHaveLength(2)
  })

  it('asks for the sample by voice AND note, because that picks the file', () => {
    peaksForSample.mockReturnValue(null)
    const source = createWaveformSource(() => 0.5)
    source.peaksFor('piano', 72)
    expect(peaksForSample).toHaveBeenCalledWith({ s: 'piano', note: 72 })
  })

  it('passes a missing pitch straight through rather than inventing one', () => {
    peaksForSample.mockReturnValue(null)
    const source = createWaveformSource(() => 0.5)
    source.peaksFor('take_1', null)
    expect(peaksForSample).toHaveBeenCalledWith({ s: 'take_1', note: null })
  })
})
