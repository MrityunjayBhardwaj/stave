/**
 * FullSongTimeline per-voice sub-rows (#424) —
 *   expanding a percussive multi-sample lane (one `$:` drum stack → one lane,
 *   distinct `s` per voice) splits it into a labelled sub-row per voice (bd/sd/hh),
 *   instead of one band where the voices overlap on a single baseline.
 *
 * Per-voice marks come from the EVAL path (`collectHapMarks`, which carries
 * `voice = ev.s`), so — mirroring production — the crafted drum IREvents (same
 * lane key, distinct `s`, percussive) are fed through `getTimelineEvents`, not
 * the removed pre-eval collect fallback (#975). The real path is covered by the
 * Playwright spec on a real song.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as React from 'react'
import { act, render, cleanup } from '@testing-library/react'
import type { SongAnalysis } from '@stave/editor'

// Three percussive events in ONE lane (shared trackId 'drums'), distinct `s`.
const DRUM_EVENTS = [
  { begin: 0, end: 0.25, trackId: 'drums', s: 'bd', note: null, gain: 1, loc: [{ start: 10, end: 20 }] },
  { begin: 0.5, end: 0.75, trackId: 'drums', s: 'hh', note: null, gain: 1, loc: [{ start: 10, end: 20 }] },
  { begin: 0.5, end: 0.6, trackId: 'drums', s: 'sd', note: null, gain: 1, loc: [{ start: 10, end: 20 }] },
]
vi.mock('@stave/editor', async () => {
  // #974 — lane STRUCTURE comes from `structuralWalk` now; the per-voice sub-rows still come
  // from the collect marks (DRUM_EVENTS). Reduce the SAME events through the REAL reducer (PV192).
  const { skeletonsFromEvents, wholeWalkWindow } = await import(
    '../musicalTimeline/__tests__/structuralWalkTestStub'
  )
  // #1489 moved this reader into the editor, so the barrel mock has to carry it
  // or the component gets `undefined` and every case here dies in a useMemo —
  // the exact trap the `wholeWalkWindow` note below already describes. Real
  // function, from source: it is a pure IR walk, so there is nothing to stub.
  const { signalAutomations } = await import('../../../../editor/src/ir/signalAutomation')
  // #1463 Stage 2 — the component also reads stepped automation and its axis.
  const { steppedAutomations } = await import('../../../../editor/src/ir/steppedAutomation')
  const { knobRangeFor } = await import('../../../../editor/src/visualEdit/panels/knobRanges')
  return {
    signalAutomations,
    steppedAutomations,
    knobRangeFor,
    structuralWalk: (_ir: unknown, window: { originCycle: number; spanCycles: number }) =>
      skeletonsFromEvents(DRUM_EVENTS, window),
    wholeWalkWindow,
    laneKeyOf: (ev: { trackId?: string; s?: string }) => ev?.trackId ?? ev?.s ?? '$default',
    // #459 — Song view reads the shared timeline row-height setting; mock to 22
    // (the SUB_ROW_HEIGHT these sub-row layout assertions were written for).
    getMusicalTimelineSubRowHeight: () => 22,
    onMusicalTimelineSubRowHeightChange: () => () => {},
  }
})

import { FullSongTimeline } from '../FullSongTimeline'

let mockGridWidth = 800
class MockResizeObserver {
  private cb: ResizeObserverCallback
  constructor(cb: ResizeObserverCallback) {
    this.cb = cb
  }
  observe(target: Element): void {
    Object.defineProperty(target, 'clientWidth', { value: mockGridWidth, configurable: true })
    Promise.resolve().then(() => {
      this.cb(
        [{ contentRect: { width: mockGridWidth, height: 48 } as DOMRectReadOnly, target } as ResizeObserverEntry],
        this as unknown as ResizeObserver,
      )
    })
  }
  unobserve(): void {}
  disconnect(): void {}
}

beforeEach(() => {
  mockGridWidth = 800
  globalThis.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver
})
afterEach(() => cleanup())

// One lane keyed 'drums' (matches the crafted events' laneKeyOf).
const analysis: SongAnalysis = {
  periodCycles: 2,
  horizonCycles: 4,
  displaySpan: { kind: 'loop', cycles: 2 },
  lanes: [{ laneKey: 'drums', onsetsByCycle: [3, 0] }],
  sections: [{ startCycle: 0, endCycle: 2, laneKeys: ['drums'] }],
}

function renderFull() {
  return render(
    <FullSongTimeline
      analysis={analysis}
      ir={{} as never}
      getTimelineEvents={() => DRUM_EVENTS as never}
      getSongPosition={() => null}
      onSeek={vi.fn()}
      getDrawerOpen={() => true}
      getActiveTabId={() => 'musical-timeline'}
    />,
  )
}

async function expandDrums(container: HTMLElement) {
  await act(async () => {
    await Promise.resolve()
  })
  await act(async () => {
    ;(container.querySelector('[data-full-song-lane-expand="drums"]') as HTMLElement).click()
  })
}

describe('FullSongTimeline — per-voice sub-rows (#424)', () => {
  it('collapsed: shows no per-voice labels', async () => {
    const { container } = renderFull()
    await act(async () => {
      await Promise.resolve()
    })
    expect(container.querySelectorAll('[data-full-song-voice]').length).toBe(0)
    expect(container.querySelector('[data-full-song-lane="drums"]')!.hasAttribute('data-full-song-voices')).toBe(false)
  })

  it('expanded: splits the drum lane into a sub-row per voice with labels', async () => {
    const { container } = renderFull()
    await expandDrums(container)
    const lane = container.querySelector('[data-full-song-lane="drums"]')!
    // ≥2 voices → the lane advertises its voice count.
    expect(Number(lane.getAttribute('data-full-song-voices'))).toBeGreaterThanOrEqual(2)
    // Voice 0 rides in the header (`drums · bd`); the rest get indented sub-labels.
    const subLabels = Array.from(container.querySelectorAll('[data-full-song-voice]')).map((e) =>
      e.getAttribute('data-full-song-voice'),
    )
    // First-seen order from the crafted events: bd, hh, sd → sub-labels are hh, sd.
    expect(subLabels).toEqual(['hh', 'sd'])
    expect(lane.textContent).toContain('bd') // voice 0 in the header
    expect(lane.textContent).toContain('hh')
    expect(lane.textContent).toContain('sd')
  })

  it('expanded: the lane grows to N sub-rows tall', async () => {
    const { container } = renderFull()
    await expandDrums(container)
    const lane = container.querySelector('[data-full-song-lane="drums"]') as HTMLElement
    // 3 voices × SUB_ROW_HEIGHT(22) = 66px.
    expect(lane.style.height).toBe('66px')
  })
})
