/**
 * FullSongTimeline coverage (#385) —
 *   - lane labels render from analysis.lanes
 *   - section chips + onset cells render once a width is known
 *   - empty state when there is no analysis
 *   - clicking the ruler/grid calls onSeek (the DV-10 relaxation)
 *
 * Pure props in (no @stave/editor runtime dependency — SongAnalysis is a
 * type), so no module mock is needed. A MockResizeObserver supplies the grid
 * width (jsdom ships none), mirroring MusicalTimeline.test.tsx.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as React from 'react'
import { act, render, cleanup, fireEvent } from '@testing-library/react'
import type { SongAnalysis } from '@stave/editor'
import { setRulerUnits } from '../../state/rulerUnits'

// FullSongTimeline now pulls the editor runtime (collectCycles/laneKeyOf, via
// timelineMarks) into its import graph; the real module drags in a CJS dep
// (gifenc) that breaks vitest's loader. These props never pass a real `ir`, so
// the stubs are loaded but never called — the mini-note collection path is
// covered by the Playwright spec against a real song.
// Trim-gesture fixture (#437): an `arrange` song with TWO bd arms — arm 0 over
// cycles [0,2), arm 1 over [2,4). The events carry `armIndex` + `loc` so
// collectNoteMarks builds real clips (armIndex ≥ 0 = trimmable). Returned only
// when an `ir` is passed, so the no-`ir` tests above still see no marks.
const { TRIM_EVENTS, BARE_EVENTS, NESTED_EVENTS } = vi.hoisted(() => ({
  TRIM_EVENTS: [
    { begin: 0, end: 1, s: 'bd', armIndex: 0, loc: [{ start: 9, end: 21 }] },
    { begin: 1, end: 2, s: 'bd', armIndex: 0, loc: [{ start: 9, end: 21 }] },
    { begin: 2, end: 3, s: 'bd', armIndex: 1, loc: [{ start: 23, end: 35 }] },
    { begin: 3, end: 4, s: 'bd', armIndex: 1, loc: [{ start: 23, end: 35 }] },
  ],
  // A BARE track: events with NO armIndex → no clipsByLane entry → the scene
  // synthesises ONE implicit clip (armIndex −1) spanning the song. Used for the
  // bare-clip-is-not-movable test (#488: dragging it must be a no-op).
  BARE_EVENTS: [
    { begin: 0, end: 1, s: 'bd', loc: [{ start: 0, end: 9 }] },
    { begin: 1, end: 2, s: 'bd', loc: [{ start: 0, end: 9 }] },
  ],
  // A NESTED combinator (#451), mimicking the real collector output for
  // `arrange([2, cat(s("bd"),s("sd"))], [1, s("hh")])`: ONE track lane
  // (shared `trackId`), the cat block's events carry the OUTER arm index 0
  // (outermost-wins) and `loc` = [inner cat {12,39}, outer arrange {0,58}];
  // `hh` is the outer arm 1, non-nested (`loc` = [arrange]). So the lane RLEs
  // into ONE clip for arm 0 spanning cycles [0,2) and one for arm 1 at [2,3),
  // and its `arrangeOffset` (loc[last]) = 0 → detectArrangeAt resolves the outer.
  NESTED_EVENTS: [
    { begin: 0, end: 1, s: 'bd', trackId: 'song', armIndex: 0, loc: [{ start: 12, end: 39 }, { start: 0, end: 58 }] },
    { begin: 1, end: 2, s: 'sd', trackId: 'song', armIndex: 0, loc: [{ start: 12, end: 39 }, { start: 0, end: 58 }] },
    { begin: 2, end: 3, s: 'hh', trackId: 'song', armIndex: 1, loc: [{ start: 0, end: 58 }] },
  ],
}))
vi.mock('@stave/editor', async () => {
  // #974 — the timeline derives lane STRUCTURE from `structuralWalk`, not collect events. Reduce
  // the SAME fixture events the collect mock returns, through the REAL production reducer (from
  // source, no gifenc), so structure + marks stay in sync and the stub can't drift (PV192).
  // Only vi.hoisted values (the fixtures) are safe to reference here — the factory is hoisted
  // above every top-level const, so `eventsForIr` lives inside it.
  const { skeletonsFromEvents, wholeWalkWindow } = await import(
    '../musicalTimeline/__tests__/structuralWalkTestStub'
  )
  // #1489 moved this reader into the editor, so the barrel mock has to carry it
  // or the component gets `undefined` and every case here dies in a useMemo —
  // the exact trap the `wholeWalkWindow` note below already describes. Real
  // function, from source: it is a pure IR walk, so there is nothing to stub.
  const { signalAutomations } = await import('../../../../editor/src/ir/signalAutomation')
  const eventsForIr = (ir: { bare?: boolean; nested?: boolean } | null) =>
    ir?.bare ? BARE_EVENTS : ir?.nested ? NESTED_EVENTS : ir ? TRIM_EVENTS : []
  return {
    signalAutomations,
    collectCycles: (ir: { bare?: boolean; nested?: boolean } | null) => eventsForIr(ir),
    structuralWalk: (ir: { bare?: boolean; nested?: boolean } | null, window: { originCycle: number; spanCycles: number }) =>
      skeletonsFromEvents(eventsForIr(ir), window),
    // Production calls this (the bare-song probe). A barrel mock that omits it
    // hands the component `undefined` — invisible to tsc, because a vi.mock
    // factory is untyped.
    wholeWalkWindow,
    laneKeyOf: (ev: { trackId?: string; s?: string }) => ev?.trackId ?? ev?.s ?? '$default',
    // #459 — Song view now reads the shared timeline row-height setting. Mock it
    // to 22 (the height these layout assertions were written for) + a no-op
    // subscribe, mirroring MusicalTimeline.test's mock.
    getMusicalTimelineSubRowHeight: () => 22,
    onMusicalTimelineSubRowHeightChange: () => () => {},
  }
})

import { FullSongTimeline } from '../FullSongTimeline'

// jsdom ships no PointerEvent, so fireEvent.pointer* would drop clientX/pointerId
// (the trim hit-test reads both). Shim it as a MouseEvent subclass that keeps the
// coordinate init and carries pointerId — enough for the gesture tests below.
if (typeof (globalThis as { PointerEvent?: unknown }).PointerEvent === 'undefined') {
  class PointerEventShim extends MouseEvent {
    pointerId: number
    constructor(type: string, params: PointerEventInit = {}) {
      super(type, params)
      this.pointerId = params.pointerId ?? 1
    }
  }
  ;(globalThis as { PointerEvent?: unknown }).PointerEvent =
    PointerEventShim as unknown as typeof PointerEvent
}

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

const analysisFixture: SongAnalysis = {
  periodCycles: 4,
  horizonCycles: 8,
  displaySpan: { kind: 'loop', cycles: 4 },
  lanes: [
    { laneKey: 'bd', onsetsByCycle: [2, 0, 2, 0] },
    { laneKey: 'hh', onsetsByCycle: [1, 1, 1, 1] },
  ],
  sections: [
    { startCycle: 0, endCycle: 1, laneKeys: ['bd', 'hh'] },
    { startCycle: 1, endCycle: 4, laneKeys: ['hh'] },
  ],
}

// One-lane song for the NESTED fixture (period 3: cat block [0,2) + hh [2,3)).
const nestedAnalysis: SongAnalysis = {
  periodCycles: 3,
  horizonCycles: 6,
  displaySpan: { kind: 'loop', cycles: 3 },
  lanes: [{ laneKey: 'song', onsetsByCycle: [1, 1, 1] }],
  sections: [{ startCycle: 0, endCycle: 3, laneKeys: ['song'] }],
}

function renderFull(overrides?: Partial<React.ComponentProps<typeof FullSongTimeline>>) {
  const props = {
    analysis: analysisFixture,
    getSongPosition: () => null,
    onSeek: vi.fn(),
    getDrawerOpen: () => true,
    getActiveTabId: () => 'musical-timeline',
    ...overrides,
  }
  const utils = render(<FullSongTimeline {...props} />)
  return { ...utils, onSeek: props.onSeek as ReturnType<typeof vi.fn> }
}

describe('FullSongTimeline', () => {
  it('renders a lane label per analysis lane', async () => {
    const { container } = renderFull()
    await act(async () => {
      await Promise.resolve()
    })
    const lanes = container.querySelectorAll('[data-full-song-lane]')
    expect(lanes.length).toBe(2)
    expect(container.querySelector('[data-full-song-lane="bd"]')).not.toBeNull()
    expect(container.querySelector('[data-full-song-lane="hh"]')).not.toBeNull()
  })

  it('mounts the canvas body without any DOM section chips on the ruler', async () => {
    const { container } = renderFull()
    await act(async () => {
      await Promise.resolve()
    })
    // Section bands were removed from the ruler (#752): the numbered labels
    // collided with the cycle numbers and were a no-op for single-section songs.
    expect(container.querySelectorAll('[data-full-song-section]').length).toBe(0)
    // The onset heatmap is now drawn on the canvas (the per-cell DOM nodes are
    // gone). Assert the canvas surface mounted; pixel output is covered by the
    // drawTimeline unit tests + the Playwright screenshot.
    expect(container.querySelector('[data-full-song-canvas]')).not.toBeNull()
    expect(container.querySelectorAll('[data-full-song-cell]').length).toBe(0)
  })

  it('shows an empty state when there is no analysis', async () => {
    const { container } = renderFull({ analysis: null })
    await act(async () => {
      await Promise.resolve()
    })
    expect(container.querySelectorAll('[data-full-song-lane]').length).toBe(0)
    expect(container.textContent).toContain('No song to map yet')
  })

  it('seeks from the RULER, not the grid (#610 — the grid row now jumps to code)', async () => {
    const { container, onSeek } = renderFull()
    await act(async () => {
      await Promise.resolve()
    })
    // A grid press no longer seeks — it selects/jumps to the track under it
    // (#610). With no onSelectLane wired here it is a no-op, but crucially it
    // does NOT call onSeek.
    const grid = container.querySelector('[data-full-song="grid"]') as HTMLElement
    await act(async () => {
      grid.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 50 }))
    })
    expect(onSeek).not.toHaveBeenCalled()
    // The ruler time-axis is now the seek surface (seek moved off the grid).
    const ruler = container.querySelector('[data-full-song="ruler-area"]') as HTMLElement
    await act(async () => {
      ruler.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 50 }))
    })
    expect(onSeek).toHaveBeenCalledTimes(1)
    // jsdom getBoundingClientRect is zero-width → seek resolves to cycle 0, but
    // the call itself proves the wiring (x→cycle math is unit-tested in
    // songAxis.test.ts).
    expect(typeof onSeek.mock.calls[0][0]).toBe('number')
  })

  it('toggles a lane expansion and binds it when the disclosure caret is clicked', async () => {
    const onBindLane = vi.fn()
    const { container } = renderFull({ onBindLane })
    await act(async () => {
      await Promise.resolve()
    })
    const row = () => container.querySelector('[data-full-song-lane="bd"]') as HTMLElement
    expect(row().getAttribute('data-expanded')).toBe('false')
    const caret = container.querySelector('[data-full-song-lane-expand="bd"]') as HTMLElement
    await act(async () => {
      caret.click()
    })
    expect(row().getAttribute('data-expanded')).toBe('true') // accordion expanded
    expect(onBindLane).toHaveBeenCalledTimes(1) // bound into the Pattern panel
    // no `ir` in this fixture → no source provenance, so the offset is null.
    expect(onBindLane).toHaveBeenLastCalledWith(null)
    await act(async () => {
      ;(container.querySelector('[data-full-song-lane-expand="bd"]') as HTMLElement).click()
    })
    expect(row().getAttribute('data-expanded')).toBe('false') // collapses again
  })

  it('jumps to the track code when the lane header is clicked, without expanding (#610)', async () => {
    const onSelectLane = vi.fn()
    // A `bare` ir gives the lane source provenance (loc[0].start = 0) so the
    // header becomes a jump target; no `dollarPos` here, so the offset resolves
    // through the sourceOffset fallback (the labelOffset path is covered e2e).
    const { container } = renderFull({ ir: { bare: true } as never, onSelectLane })
    await act(async () => {
      await Promise.resolve()
    })
    const header = container.querySelector('[data-full-song-lane-select="bd"]') as HTMLElement
    expect(header).not.toBeNull()
    await act(async () => {
      header.click()
    })
    expect(onSelectLane).toHaveBeenCalledTimes(1)
    expect(onSelectLane).toHaveBeenLastCalledWith(0)
    // It is a pure "go to code" — the lane must NOT have expanded.
    expect(
      (container.querySelector('[data-full-song-lane="bd"]') as HTMLElement).getAttribute('data-expanded'),
    ).toBe('false')
  })

  it('does not jump when the disclosure caret is clicked (caret stops propagation) (#610)', async () => {
    const onSelectLane = vi.fn()
    const onBindLane = vi.fn()
    const { container } = renderFull({ ir: { bare: true } as never, onSelectLane, onBindLane })
    await act(async () => {
      await Promise.resolve()
    })
    const caret = container.querySelector('[data-full-song-lane-expand="bd"]') as HTMLElement
    await act(async () => {
      caret.click()
    })
    // Caret expands + binds, but the header's jump must NOT also fire.
    expect(onBindLane).toHaveBeenCalledTimes(1)
    expect(onSelectLane).not.toHaveBeenCalled()
    expect(
      (container.querySelector('[data-full-song-lane="bd"]') as HTMLElement).getAttribute('data-expanded'),
    ).toBe('true')
  })

  it('supports multi-expand (two lanes expanded for cross-track alignment)', async () => {
    const { container } = renderFull()
    await act(async () => {
      await Promise.resolve()
    })
    await act(async () => {
      ;(container.querySelector('[data-full-song-lane-expand="bd"]') as HTMLElement).click()
      ;(container.querySelector('[data-full-song-lane-expand="hh"]') as HTMLElement).click()
    })
    expect(container.querySelector('[data-full-song-lane="bd"]')!.getAttribute('data-expanded')).toBe('true')
    expect(container.querySelector('[data-full-song-lane="hh"]')!.getAttribute('data-expanded')).toBe('true')
  })

  it('exposes the loop length for observation', async () => {
    const { container } = renderFull()
    await act(async () => {
      await Promise.resolve()
    })
    const meta = container.querySelector('[data-full-song-period]')
    expect(meta?.getAttribute('data-full-song-period')).toBe('loop 4')
  })

  // ── Zoom + ruler controls (#412) ───────────────────────────────────────────

  it('renders zoom controls at 100% with Fit/zoom-out disabled', async () => {
    const { container } = renderFull()
    await act(async () => {
      await Promise.resolve()
    })
    const cluster = container.querySelector('[data-full-song-zoom]') as HTMLElement
    expect(cluster.getAttribute('data-full-song-zoom')).toBe('100')
    expect((container.querySelector('[data-full-song-zoom-fit]') as HTMLButtonElement).disabled).toBe(true)
    expect((container.querySelector('[data-full-song-zoom-out]') as HTMLButtonElement).disabled).toBe(true)
    expect((container.querySelector('[data-full-song-zoom-in]') as HTMLButtonElement).disabled).toBe(false)
  })

  it('zooms in on the + button (enables Fit/zoom-out)', async () => {
    const { container } = renderFull()
    await act(async () => {
      await Promise.resolve()
    })
    const zoomIn = container.querySelector('[data-full-song-zoom-in]') as HTMLButtonElement
    await act(async () => {
      zoomIn.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    // default ZOOM_STEP is 1.5 → 150%
    expect(container.querySelector('[data-full-song-zoom]')?.getAttribute('data-full-song-zoom')).toBe('150')
    expect((container.querySelector('[data-full-song-zoom-fit]') as HTMLButtonElement).disabled).toBe(false)
  })

  // ── Follow toggle (#415) ───────────────────────────────────────────────────

  it('renders the Follow toggle defaulting to on', async () => {
    const { container } = renderFull()
    await act(async () => {
      await Promise.resolve()
    })
    const toggle = container.querySelector('[data-full-song-follow-toggle]') as HTMLButtonElement
    expect(toggle).not.toBeNull()
    expect(toggle.getAttribute('data-follow')).toBe('on')
    expect(toggle.getAttribute('aria-pressed')).toBe('true')
  })

  it('flips Follow off on click', async () => {
    const { container } = renderFull()
    await act(async () => {
      await Promise.resolve()
    })
    const toggle = container.querySelector('[data-full-song-follow-toggle]') as HTMLButtonElement
    await act(async () => {
      toggle.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(toggle.getAttribute('data-follow')).toBe('off')
    expect(toggle.getAttribute('aria-pressed')).toBe('false')
  })

  it('the ruler reflects the shared units store — bars adds beat ticks (#750)', async () => {
    // The CYCLES/BARS toggle moved to the editor pattern bar; the ruler now
    // reads the shared `rulerUnits` store. Drive the store directly.
    setRulerUnits('cycles')
    const { container } = renderFull()
    await act(async () => {
      await Promise.resolve()
    })
    // CYCLES: 4 major ticks (period 4 across 800px → 200px/cycle), no beats.
    expect(container.querySelectorAll('[data-full-song-tick="major"]').length).toBe(4)
    expect(container.querySelectorAll('[data-full-song-tick="beat"]').length).toBe(0)
    await act(async () => {
      setRulerUnits('bars')
    })
    // BARS: 4 majors + 4×3 interior beat ticks (200/4 = 50px/beat ≥ 14).
    expect(container.querySelectorAll('[data-full-song-tick="major"]').length).toBe(4)
    expect(container.querySelectorAll('[data-full-song-tick="beat"]').length).toBe(12)
    setRulerUnits('cycles') // reset the module singleton for other tests
  })
})

describe('FullSongTimeline — trim a clip (drag right edge → set-weight, #437)', () => {
  // The fixture song is `arrange([2, s("bd")], [2, s("hh")])`-shaped: bd lane has
  // two clips, arm 0 over [0,2) and arm 1 over [2,4). At zoom 1 the period (4)
  // fits 800px → 200px/cycle, so arm 0's right edge sits at x=400. We grab just
  // inside it, drag to cycle 3, and expect a set-weight to 3 for arm 0.
  function renderTrimmable(onTrimClip: ReturnType<typeof vi.fn>) {
    const utils = renderFull({ ir: {} as never, onTrimClip })
    const grid = utils.container.querySelector('[data-full-song="grid"]') as HTMLElement
    // jsdom has no layout — supply the grid rect the content-space math reads.
    grid.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 800, height: 48, right: 800, bottom: 48, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect
    return { ...utils, grid }
  }

  it('drags arm 0’s right edge to cycle 3 → onTrimClip(arm 0, weight 3)', async () => {
    const onTrimClip = vi.fn()
    const { grid } = renderTrimmable(onTrimClip)
    await act(async () => {
      await Promise.resolve()
    })
    // Grab 2px inside arm 0's right edge (x=400), in the bd row (y≈10).
    fireEvent.pointerDown(grid, { clientX: 398, clientY: 10, pointerId: 1 })
    fireEvent.pointerMove(grid, { clientX: 600, clientY: 10, pointerId: 1 }) // cycle 3
    fireEvent.pointerUp(grid, { clientX: 600, clientY: 10, pointerId: 1 })
    expect(onTrimClip).toHaveBeenCalledTimes(1)
    // sourceOffset = the bd lane's first event loc (9); arm 0; new whole-cycle weight 3.
    expect(onTrimClip).toHaveBeenCalledWith({ sourceOffset: 9, armIndex: 0, weight: 3 })
  })

  it('grabs the LAST clip’s right edge (at the song end) and shrinks it', async () => {
    const onTrimClip = vi.fn()
    const { grid } = renderTrimmable(onTrimClip)
    await act(async () => {
      await Promise.resolve()
    })
    // Arm 1 spans [2,4); its right edge is the song end at x=800. Grab it and
    // drag left to cycle 3 → new weight 1 (4−2 was 2). clipAtCycle(4) is null —
    // the edge-proximity scan is what makes this clip grabbable.
    fireEvent.pointerDown(grid, { clientX: 798, clientY: 10, pointerId: 1 })
    fireEvent.pointerMove(grid, { clientX: 600, clientY: 10, pointerId: 1 }) // cycle 3
    fireEvent.pointerUp(grid, { clientX: 600, clientY: 10, pointerId: 1 })
    expect(onTrimClip).toHaveBeenCalledWith({ sourceOffset: 9, armIndex: 1, weight: 1 })
  })

  it('EXTENDS the LAST clip past the song end → grows the span + set-weight (#487)', async () => {
    const onTrimClip = vi.fn()
    const { grid, container } = renderTrimmable(onTrimClip)
    await act(async () => {
      await Promise.resolve()
    })
    // At rest the visual span is exactly the song (period 4) — NO trailing blank,
    // so the ruler shows 4 major ticks and the last clip's edge sits at the wall.
    expect(container.querySelectorAll('[data-full-song-tick="major"]').length).toBe(4)
    // Grab arm 1's right edge (the song end, cycle 4 → x=800) and drag RIGHT to
    // a content-x mapping to cycle 6 (1200px at the constant 200px/cycle). The
    // edge tracks the cursor 1:1 (constant px/cycle) and the span grows to make
    // room: displayCycles = max(4, 6 + EXTEND_MARGIN(2)) = 8.
    fireEvent.pointerDown(grid, { clientX: 798, clientY: 10, pointerId: 1 })
    fireEvent.pointerMove(grid, { clientX: 1200, clientY: 10, pointerId: 1 }) // cycle 6
    // Mid-drag the span GREW — 8 major ticks now (the empty extend room is real
    // timeline). The pre-#487 code held the span fixed at 4; this is the
    // discriminator for the grow logic.
    expect(container.querySelectorAll('[data-full-song-tick="major"]').length).toBe(8)
    fireEvent.pointerUp(grid, { clientX: 1200, clientY: 10, pointerId: 1 })
    // arm 1 extended from weight 2 (span [2,4)) to weight 4 (end cycle 6).
    expect(onTrimClip).toHaveBeenCalledWith({ sourceOffset: 9, armIndex: 1, weight: 4 })
    // On release the transient room collapses → back to 4 majors (no permanent
    // blank; the real re-eval would then grow the period to fill it).
    expect(container.querySelectorAll('[data-full-song-tick="major"]').length).toBe(4)
  })

  it('a click that lands NOT on a clip edge does not trim (and no longer seeks — #610)', async () => {
    const onTrimClip = vi.fn()
    const { grid, onSeek } = renderTrimmable(onTrimClip)
    await act(async () => {
      await Promise.resolve()
    })
    // Mid-clip (x=100 ≈ cycle 0.5), nowhere near an edge → no trim. The grid no
    // longer seeks either (#610 moved seek to the ruler); with no onSelectLane
    // wired here the click is a no-op.
    fireEvent.pointerDown(grid, { clientX: 100, clientY: 10, pointerId: 1 })
    fireEvent.pointerUp(grid, { clientX: 100, clientY: 10, pointerId: 1 })
    expect(onTrimClip).not.toHaveBeenCalled()
    expect(onSeek).not.toHaveBeenCalled()
  })

  it('a drag that does not change the weight does not fire onTrimClip', async () => {
    const onTrimClip = vi.fn()
    const { grid } = renderTrimmable(onTrimClip)
    await act(async () => {
      await Promise.resolve()
    })
    // Grab the edge and release without crossing into a new cycle (stays weight 2).
    fireEvent.pointerDown(grid, { clientX: 398, clientY: 10, pointerId: 1 })
    fireEvent.pointerMove(grid, { clientX: 402, clientY: 10, pointerId: 1 }) // still cycle 2
    fireEvent.pointerUp(grid, { clientX: 402, clientY: 10, pointerId: 1 })
    expect(onTrimClip).not.toHaveBeenCalled()
  })
})

describe('FullSongTimeline — delete a clip (select body + Delete → remove-arm, #386)', () => {
  // Same `arrange([2, s("bd")], [2, s("hh")])`-shaped fixture: the bd lane has two
  // real clips (arm 0 [0,2), arm 1 [2,4)) at 200px/cycle, so arm 0's body centre
  // sits at x≈200 and arm 1's at x≈600 (bd row y≈10). The hh lane carries no
  // armIndex events, so it gets ONE implicit clip (armIndex −1, not deletable).
  function renderDeletable(onDeleteClip: ReturnType<typeof vi.fn>) {
    const utils = renderFull({ ir: {} as never, onDeleteClip })
    const grid = utils.container.querySelector('[data-full-song="grid"]') as HTMLElement
    grid.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 800, height: 48, right: 800, bottom: 48, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect
    return { ...utils, grid }
  }

  const settle = () => act(async () => { await Promise.resolve() })

  it('selecting arm 0’s body then Delete → onDeleteClip(arm 0)', async () => {
    const onDeleteClip = vi.fn()
    const { grid, container } = renderDeletable(onDeleteClip)
    await settle()
    // Click arm 0's body (x≈200 = cycle 1, bd row) → selects it (highlight shows).
    fireEvent.pointerDown(grid, { clientX: 200, clientY: 10, pointerId: 1 })
    fireEvent.pointerUp(grid, { clientX: 200, clientY: 10, pointerId: 1 })
    expect(container.querySelector('[data-full-song="clip-selection"]')).not.toBeNull()
    // Delete removes that arm — assert the VALUE (sourceOffset = bd lane anchor 9).
    fireEvent.keyDown(grid, { key: 'Delete' })
    expect(onDeleteClip).toHaveBeenCalledTimes(1)
    expect(onDeleteClip).toHaveBeenCalledWith({ sourceOffset: 9, armIndex: 0 })
    // Selection clears after the delete fires.
    expect(container.querySelector('[data-full-song="clip-selection"]')).toBeNull()
  })

  it('Backspace also deletes the selected clip (arm 1)', async () => {
    const onDeleteClip = vi.fn()
    const { grid } = renderDeletable(onDeleteClip)
    await settle()
    fireEvent.pointerDown(grid, { clientX: 600, clientY: 10, pointerId: 1 }) // arm 1 body
    fireEvent.pointerUp(grid, { clientX: 600, clientY: 10, pointerId: 1 })
    fireEvent.keyDown(grid, { key: 'Backspace' })
    expect(onDeleteClip).toHaveBeenCalledWith({ sourceOffset: 9, armIndex: 1 })
  })

  it('Delete with nothing selected is a no-op', async () => {
    const onDeleteClip = vi.fn()
    const { grid } = renderDeletable(onDeleteClip)
    await settle()
    fireEvent.keyDown(grid, { key: 'Delete' })
    expect(onDeleteClip).not.toHaveBeenCalled()
  })

  it('clicking the bare/implicit clip (hh lane) + Delete → gap at the clicked bar (#489)', async () => {
    const onDeleteClip = vi.fn()
    const { grid, container } = renderDeletable(onDeleteClip)
    await settle()
    // hh row (y≈30) has only the implicit clip (armIndex −1, span [0,4)). Clicking
    // x≈200 (cycle 1) selects bar 1; Delete carves a GAP there — the parent
    // materializes arrange([1,pat],[1,silence],[2,pat]) (#489). barIndex = the
    // clicked whole-cycle, span = the bare clip's floored width.
    fireEvent.pointerDown(grid, { clientX: 200, clientY: 30, pointerId: 1 })
    fireEvent.pointerUp(grid, { clientX: 200, clientY: 30, pointerId: 1 })
    expect(container.querySelector('[data-full-song="clip-selection"]')).not.toBeNull()
    fireEvent.keyDown(grid, { key: 'Delete' })
    expect(onDeleteClip).toHaveBeenCalledTimes(1)
    expect(onDeleteClip.mock.calls[0][0]).toMatchObject({ armIndex: -1, barIndex: 1, span: 4 })
    // Selection clears after the delete fires.
    expect(container.querySelector('[data-full-song="clip-selection"]')).toBeNull()
  })

  it('clicking a clip selects it but no longer seeks (#610 — seek moved to the ruler)', async () => {
    const onDeleteClip = vi.fn()
    const { grid, container, onSeek } = renderDeletable(onDeleteClip)
    await settle()
    fireEvent.pointerDown(grid, { clientX: 200, clientY: 10, pointerId: 1 })
    fireEvent.pointerUp(grid, { clientX: 200, clientY: 10, pointerId: 1 })
    // Selection (for clip ops) is preserved; the grid click no longer seeks.
    expect(container.querySelector('[data-full-song="clip-selection"]')).not.toBeNull()
    expect(onSeek).not.toHaveBeenCalled()
  })
})

describe('FullSongTimeline — move a clip (drag body → reorder; bare clip = no-op, #386/#488)', () => {
  // Reorder fixture: the same two-arm bd lane (arm 0 [0,2), arm 1 [2,4)) at
  // 200px/cycle. Dragging arm 0's body (x≈200) right into arm 1's span (x≈600 =
  // cycle 3) reorders it to slot 1.
  function renderReorderable(onMoveClip: ReturnType<typeof vi.fn>) {
    const utils = renderFull({ ir: {} as never, onMoveClip })
    const grid = utils.container.querySelector('[data-full-song="grid"]') as HTMLElement
    grid.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 800, height: 48, right: 800, bottom: 48, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect
    return { ...utils, grid }
  }
  // Wrap fixture: a BARE track (no armIndex) → one implicit clip spanning [0,4).
  function renderWrappable(onMoveClip: ReturnType<typeof vi.fn>) {
    const utils = renderFull({ ir: { bare: true } as never, onMoveClip })
    const grid = utils.container.querySelector('[data-full-song="grid"]') as HTMLElement
    grid.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 800, height: 48, right: 800, bottom: 48, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect
    return { ...utils, grid }
  }
  const settle = () => act(async () => { await Promise.resolve() })

  it('dragging arm 0’s body into arm 1’s span → onMoveClip reorder(0 → 1)', async () => {
    const onMoveClip = vi.fn()
    const { grid } = renderReorderable(onMoveClip)
    await settle()
    fireEvent.pointerDown(grid, { clientX: 200, clientY: 10, pointerId: 1 }) // arm 0 body
    fireEvent.pointerMove(grid, { clientX: 600, clientY: 10, pointerId: 1 }) // cycle 3 = arm 1 span
    fireEvent.pointerUp(grid, { clientX: 600, clientY: 10, pointerId: 1 })
    expect(onMoveClip).toHaveBeenCalledTimes(1)
    expect(onMoveClip).toHaveBeenCalledWith({ kind: 'reorder', sourceOffset: 9, fromIndex: 0, toIndex: 1 })
  })

  it('a body press that does not travel is a click (select), not a move', async () => {
    const onMoveClip = vi.fn()
    const { grid, container } = renderReorderable(onMoveClip)
    await settle()
    fireEvent.pointerDown(grid, { clientX: 200, clientY: 10, pointerId: 1 })
    fireEvent.pointerMove(grid, { clientX: 202, clientY: 10, pointerId: 1 }) // 2px < threshold
    fireEvent.pointerUp(grid, { clientX: 202, clientY: 10, pointerId: 1 })
    expect(onMoveClip).not.toHaveBeenCalled()
    expect(container.querySelector('[data-full-song="clip-selection"]')).not.toBeNull()
  })

  it('dropping a clip back on its own span does not fire onMoveClip', async () => {
    const onMoveClip = vi.fn()
    const { grid } = renderReorderable(onMoveClip)
    await settle()
    fireEvent.pointerDown(grid, { clientX: 200, clientY: 10, pointerId: 1 })
    fireEvent.pointerMove(grid, { clientX: 100, clientY: 10, pointerId: 1 }) // still arm 0 span
    fireEvent.pointerUp(grid, { clientX: 100, clientY: 10, pointerId: 1 })
    expect(onMoveClip).not.toHaveBeenCalled()
  })

  it('clears a held selection after a reorder (no stale armIndex, #448)', async () => {
    const onMoveClip = vi.fn()
    const { grid, container } = renderReorderable(onMoveClip)
    await settle()
    // Select arm 1 (a non-drag click) — the highlight shows.
    fireEvent.pointerDown(grid, { clientX: 600, clientY: 10, pointerId: 1 })
    fireEvent.pointerUp(grid, { clientX: 600, clientY: 10, pointerId: 1 })
    expect(container.querySelector('[data-full-song="clip-selection"]')).not.toBeNull()
    // Now reorder arm 0 → arm 1's span; the arm list reindexes, so selection clears.
    fireEvent.pointerDown(grid, { clientX: 200, clientY: 10, pointerId: 1 })
    fireEvent.pointerMove(grid, { clientX: 600, clientY: 10, pointerId: 1 })
    fireEvent.pointerUp(grid, { clientX: 600, clientY: 10, pointerId: 1 })
    expect(onMoveClip).toHaveBeenCalledWith({ kind: 'reorder', sourceOffset: 9, fromIndex: 0, toIndex: 1 })
    expect(container.querySelector('[data-full-song="clip-selection"]')).toBeNull()
  })

  it('dragging a BARE track’s clip is a no-op — onMoveClip never fires (#488)', async () => {
    const onMoveClip = vi.fn()
    const { grid, container } = renderWrappable(onMoveClip)
    await settle()
    // The implicit clip tiles [0,4) uniformly; dragging it must NOT introduce an
    // arrange/silence (a uniform pattern has no distinct clip to move).
    fireEvent.pointerDown(grid, { clientX: 200, clientY: 10, pointerId: 1 })
    fireEvent.pointerMove(grid, { clientX: 600, clientY: 10, pointerId: 1 }) // cycle 3
    fireEvent.pointerUp(grid, { clientX: 600, clientY: 10, pointerId: 1 })
    expect(onMoveClip).not.toHaveBeenCalled()
    // A bare clip isn't selectable either — the press falls through to seek.
    expect(container.querySelector('[data-full-song="clip-selection"]')).toBeNull()
  })
})

describe('FullSongTimeline — duplicate a clip (select + ⌘/Ctrl-D → insert arm, #386)', () => {
  function renderDuplicatable(onDuplicateClip: ReturnType<typeof vi.fn>) {
    const utils = renderFull({ ir: {} as never, onDuplicateClip })
    const grid = utils.container.querySelector('[data-full-song="grid"]') as HTMLElement
    grid.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 800, height: 48, right: 800, bottom: 48, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect
    return { ...utils, grid }
  }
  const settle = () => act(async () => { await Promise.resolve() })

  it('selecting arm 0 then ⌘-D → onDuplicateClip(arm 0)', async () => {
    const onDuplicateClip = vi.fn()
    const { grid } = renderDuplicatable(onDuplicateClip)
    await settle()
    fireEvent.pointerDown(grid, { clientX: 200, clientY: 10, pointerId: 1 }) // select arm 0
    fireEvent.pointerUp(grid, { clientX: 200, clientY: 10, pointerId: 1 })
    fireEvent.keyDown(grid, { key: 'd', metaKey: true })
    expect(onDuplicateClip).toHaveBeenCalledTimes(1)
    expect(onDuplicateClip).toHaveBeenCalledWith({ sourceOffset: 9, armIndex: 0 })
  })

  it('Ctrl-D also duplicates (arm 1)', async () => {
    const onDuplicateClip = vi.fn()
    const { grid } = renderDuplicatable(onDuplicateClip)
    await settle()
    fireEvent.pointerDown(grid, { clientX: 600, clientY: 10, pointerId: 1 }) // arm 1
    fireEvent.pointerUp(grid, { clientX: 600, clientY: 10, pointerId: 1 })
    fireEvent.keyDown(grid, { key: 'd', ctrlKey: true })
    expect(onDuplicateClip).toHaveBeenCalledWith({ sourceOffset: 9, armIndex: 1 })
  })

  it('⌘⇧-D does NOT duplicate, while ⌘-D on the same selection does (#1421)', async () => {
    // `e.key` is the produced character, so Shift+d is literally 'D' — the
    // handler's `|| e.key === 'D'` used to swallow ⌘⇧D and duplicate on it.
    // ⚠ Both halves in ONE arm on purpose. The negative alone would also pass
    // if the whole handler were broken, which is the failure it is meant to
    // exclude; the positive that follows is what makes the silence meaningful.
    const onDuplicateClip = vi.fn()
    const { grid } = renderDuplicatable(onDuplicateClip)
    await settle()
    fireEvent.pointerDown(grid, { clientX: 200, clientY: 10, pointerId: 1 }) // select arm 0
    fireEvent.pointerUp(grid, { clientX: 200, clientY: 10, pointerId: 1 })

    fireEvent.keyDown(grid, { key: 'D', metaKey: true, shiftKey: true })
    expect(onDuplicateClip, '⌘⇧D must not duplicate').not.toHaveBeenCalled()

    fireEvent.keyDown(grid, { key: 'd', metaKey: true })
    expect(onDuplicateClip, 'the selection was live all along').toHaveBeenCalledTimes(1)
  })

  it('⌘-D still duplicates when Shift is absent but the key arrives capitalised', async () => {
    // Capslock produces 'D' with no shiftKey. That case was always meant to
    // work and must survive the guard — the guard is about SHIFT, not case.
    const onDuplicateClip = vi.fn()
    const { grid } = renderDuplicatable(onDuplicateClip)
    await settle()
    fireEvent.pointerDown(grid, { clientX: 200, clientY: 10, pointerId: 1 })
    fireEvent.pointerUp(grid, { clientX: 200, clientY: 10, pointerId: 1 })
    fireEvent.keyDown(grid, { key: 'D', metaKey: true })
    expect(onDuplicateClip).toHaveBeenCalledTimes(1)
  })

  it('⌘-D with nothing selected is a no-op', async () => {
    const onDuplicateClip = vi.fn()
    const { grid } = renderDuplicatable(onDuplicateClip)
    await settle()
    fireEvent.keyDown(grid, { key: 'd', metaKey: true })
    expect(onDuplicateClip).not.toHaveBeenCalled()
  })

  it('clears the selection after duplicating (no stale armIndex, #448)', async () => {
    const onDuplicateClip = vi.fn()
    const { grid, container } = renderDuplicatable(onDuplicateClip)
    await settle()
    fireEvent.pointerDown(grid, { clientX: 200, clientY: 10, pointerId: 1 }) // select arm 0
    fireEvent.pointerUp(grid, { clientX: 200, clientY: 10, pointerId: 1 })
    expect(container.querySelector('[data-full-song="clip-selection"]')).not.toBeNull()
    fireEvent.keyDown(grid, { key: 'd', metaKey: true })
    expect(container.querySelector('[data-full-song="clip-selection"]')).toBeNull()
  })
})

describe('FullSongTimeline — split a clip (select + S → split arm at midpoint, #386)', () => {
  function renderSplittable(onSplitClip: ReturnType<typeof vi.fn>) {
    const utils = renderFull({ ir: {} as never, onSplitClip })
    const grid = utils.container.querySelector('[data-full-song="grid"]') as HTMLElement
    grid.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 800, height: 48, right: 800, bottom: 48, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect
    return { ...utils, grid }
  }
  const settle = () => act(async () => { await Promise.resolve() })

  it('selecting a 2-cycle arm then S → onSplitClip(firstWeight = midpoint 1)', async () => {
    const onSplitClip = vi.fn()
    const { grid } = renderSplittable(onSplitClip)
    await settle()
    fireEvent.pointerDown(grid, { clientX: 200, clientY: 10, pointerId: 1 }) // arm 0 [0,2)
    fireEvent.pointerUp(grid, { clientX: 200, clientY: 10, pointerId: 1 })
    fireEvent.keyDown(grid, { key: 's' })
    expect(onSplitClip).toHaveBeenCalledTimes(1)
    // weight 2 → midpoint firstWeight = floor(2/2) = 1; span = clip width (2)
    expect(onSplitClip).toHaveBeenCalledWith({ sourceOffset: 9, armIndex: 0, firstWeight: 1, span: 2 })
  })

  it('S with nothing selected is a no-op', async () => {
    const onSplitClip = vi.fn()
    const { grid } = renderSplittable(onSplitClip)
    await settle()
    fireEvent.keyDown(grid, { key: 's' })
    expect(onSplitClip).not.toHaveBeenCalled()
  })

  it('clears the selection after splitting (#448)', async () => {
    const onSplitClip = vi.fn()
    const { grid, container } = renderSplittable(onSplitClip)
    await settle()
    fireEvent.pointerDown(grid, { clientX: 200, clientY: 10, pointerId: 1 }) // select arm 0 [0,2)
    fireEvent.pointerUp(grid, { clientX: 200, clientY: 10, pointerId: 1 })
    expect(container.querySelector('[data-full-song="clip-selection"]')).not.toBeNull()
    fireEvent.keyDown(grid, { key: 's' })
    expect(container.querySelector('[data-full-song="clip-selection"]')).toBeNull()
  })

  it('⌘-S (save) does not trigger a split', async () => {
    const onSplitClip = vi.fn()
    const { grid } = renderSplittable(onSplitClip)
    await settle()
    fireEvent.pointerDown(grid, { clientX: 200, clientY: 10, pointerId: 1 })
    fireEvent.pointerUp(grid, { clientX: 200, clientY: 10, pointerId: 1 })
    fireEvent.keyDown(grid, { key: 's', metaKey: true })
    expect(onSplitClip).not.toHaveBeenCalled()
  })
})

describe('FullSongTimeline — NESTED combinator arm binds the OUTER arrange (#451)', () => {
  // `arrange([2, cat(s("bd"),s("sd"))], [1, s("hh")])`: the cat block is ONE
  // outer clip (arm 0, cycles [0,2)). Gestures must bind the OUTER arrange
  // (sourceOffset = 0, the `arrange(` token) — NOT the inner cat at offset 12 —
  // so the op edits the outer arm. Period 3 over 800px → 266.7px/cycle.
  function renderNested(overrides: Partial<React.ComponentProps<typeof FullSongTimeline>>) {
    const utils = renderFull({ ir: { nested: true } as never, analysis: nestedAnalysis, ...overrides })
    const grid = utils.container.querySelector('[data-full-song="grid"]') as HTMLElement
    grid.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 800, height: 48, right: 800, bottom: 48, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect
    return { ...utils, grid }
  }
  const settle = () => act(async () => { await Promise.resolve() })

  it('the cat block is ONE clip spanning the outer weight (split → firstWeight 1)', async () => {
    // Splitting at the midpoint yields floor(weight/2). firstWeight 1 holds ONLY
    // if the cat block clip has weight 2 (the whole outer arm) — i.e. bd/sd did
    // NOT become separate 1-cycle clips. Also confirms the OUTER offset (0).
    const onSplitClip = vi.fn()
    const { grid } = renderNested({ onSplitClip })
    await settle()
    fireEvent.pointerDown(grid, { clientX: 133, clientY: 10, pointerId: 1 }) // select cat block
    fireEvent.pointerUp(grid, { clientX: 133, clientY: 10, pointerId: 1 })
    fireEvent.keyDown(grid, { key: 's' })
    expect(onSplitClip).toHaveBeenCalledWith({ sourceOffset: 0, armIndex: 0, firstWeight: 1, span: 2 })
  })

  it('⌘-D on the cat block dispatches the OUTER arrange offset (0), not the inner cat (12)', async () => {
    const onDuplicateClip = vi.fn()
    const { grid } = renderNested({ onDuplicateClip })
    await settle()
    // Click inside the cat block (cycle ~0.5 → x≈133), song row (y≈10).
    fireEvent.pointerDown(grid, { clientX: 133, clientY: 10, pointerId: 1 })
    fireEvent.pointerUp(grid, { clientX: 133, clientY: 10, pointerId: 1 })
    fireEvent.keyDown(grid, { key: 'd', metaKey: true })
    expect(onDuplicateClip).toHaveBeenCalledWith({ sourceOffset: 0, armIndex: 0 })
  })

  it('trimming the cat block’s right edge dispatches the OUTER arrange offset (0)', async () => {
    const onTrimClip = vi.fn()
    const { grid } = renderNested({ onTrimClip })
    await settle()
    // arm 0's right edge is cycle 2 → x = 2*266.7 ≈ 533; grab 2px inside, drag
    // to cycle 1 (x≈267) → shrink the OUTER arm 0 to weight 1.
    fireEvent.pointerDown(grid, { clientX: 531, clientY: 10, pointerId: 1 })
    fireEvent.pointerMove(grid, { clientX: 267, clientY: 10, pointerId: 1 })
    fireEvent.pointerUp(grid, { clientX: 267, clientY: 10, pointerId: 1 })
    expect(onTrimClip).toHaveBeenCalledTimes(1)
    expect(onTrimClip).toHaveBeenCalledWith({ sourceOffset: 0, armIndex: 0, weight: 1 })
  })
})

describe('FullSongTimeline — resize a bare loop (#662, set display span; option B = no write-back)', () => {
  const settle = () => act(async () => { await Promise.resolve() })

  // A PURE bare song mirroring `$: s("bd*4")`: one lane, content period 1 cycle
  // (the pattern tiles every cycle). So the natural floor is 1 and the user can
  // shrink the DISPLAY span down to the MIN_BARE_SPLIT_SPAN clamp (2). The fixture
  // analysis used by the trim tests has period 4 — too coarse to exercise shrink.
  const bareAnalysis: SongAnalysis = {
    periodCycles: 1,
    horizonCycles: 1,
    displaySpan: { kind: 'loop', cycles: 1 },
    lanes: [{ laneKey: 'bd', onsetsByCycle: [4] }],
    sections: [{ startCycle: 0, endCycle: 1, laneKeys: ['bd'] }],
  }

  // This test env ships a `window.localStorage` whose methods are non-functional,
  // so install a real Map-backed Storage (mirrors timelineCameraPersistence.test)
  // — the bare span override round-trips through it. Fresh per test → isolation.
  let originalStorage: PropertyDescriptor | undefined
  beforeEach(() => {
    originalStorage = Object.getOwnPropertyDescriptor(window, 'localStorage')
    const map = new Map<string, string>()
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      writable: true,
      value: {
        get length() { return map.size },
        clear: () => map.clear(),
        getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
        key: (i: number) => Array.from(map.keys())[i] ?? null,
        removeItem: (k: string) => map.delete(k),
        setItem: (k: string, v: string) => { map.set(k, String(v)) },
      } as Storage,
    })
  })
  afterEach(() => {
    if (originalStorage) Object.defineProperty(window, 'localStorage', originalStorage)
  })

  // BARE_EVENTS (no armIndex) → one implicit clip per lane spanning [0, displaySpan).
  // `onTrimClip` is wired so the edge hit-test runs — but a bare resize must NEVER
  // call it (option B writes no code). `onSplitClip` lets the split-at-span test
  // observe the chosen granularity flowing through.
  function renderBareResizable() {
    const onTrimClip = vi.fn()
    const onSplitClip = vi.fn()
    const utils = renderFull({ analysis: bareAnalysis, ir: { bare: true } as never, onTrimClip, onSplitClip })
    const grid = utils.container.querySelector('[data-full-song="grid"]') as HTMLElement
    grid.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 800, height: 48, right: 800, bottom: 48, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect
    return { ...utils, grid, onTrimClip, onSplitClip }
  }

  const majors = (c: HTMLElement) => c.querySelectorAll('[data-full-song-tick="major"]').length

  it('drags the bare clip’s right edge to EXTEND the span — grows bars, writes NO code', async () => {
    const { grid, container, onTrimClip } = renderBareResizable()
    await settle()
    // At rest the bare loop is floored to MIN_BARE_SPAN (4) → 4 major ticks; its
    // single implicit clip’s right edge sits at the song end (cycle 4 → x=800).
    expect(majors(container as unknown as HTMLElement)).toBe(4)
    // Grab the bare edge (x=798, 2px inside) in the bd row (y≈10) and drag RIGHT to
    // a content-x mapping to cycle 6 (1200px at the constant 200px/cycle).
    fireEvent.pointerDown(grid, { clientX: 798, clientY: 10, pointerId: 1 })
    fireEvent.pointerMove(grid, { clientX: 1200, clientY: 10, pointerId: 1 })
    // Mid-drag the transient extend room is real timeline: max(4, 6 + MARGIN 2) = 8.
    expect(majors(container as unknown as HTMLElement)).toBe(8)
    fireEvent.pointerUp(grid, { clientX: 1200, clientY: 10, pointerId: 1 })
    // On release the OVERRIDE persists (unlike #487 real-trim, which collapses the
    // room): displaySpan = max(2, natural 1, override 6) = 6 → 6 majors that STAY.
    expect(majors(container as unknown as HTMLElement)).toBe(6)
    // Option B observation gate: NO code write-back — the set-weight handler is
    // never called. Only Split/Delete (separate gestures) write code.
    expect(onTrimClip).not.toHaveBeenCalled()
  })

  it('drags the edge LEFT to shrink — clamped at MIN_BARE_SPLIT_SPAN (2) so Split stays possible', async () => {
    const { grid, container, onTrimClip } = renderBareResizable()
    await settle()
    expect(majors(container as unknown as HTMLElement)).toBe(4)
    // Grab the edge (cycle 4 → x=798) and drag hard LEFT past cycle 0 (x=0). The
    // bare clamp floors the span at 2 — never below a splittable 2 bars.
    fireEvent.pointerDown(grid, { clientX: 798, clientY: 10, pointerId: 1 })
    fireEvent.pointerMove(grid, { clientX: 0, clientY: 10, pointerId: 1 })
    fireEvent.pointerUp(grid, { clientX: 0, clientY: 10, pointerId: 1 })
    // displaySpan = max(2, natural 1, override 2) = 2 → 2 majors.
    expect(majors(container as unknown as HTMLElement)).toBe(2)
    expect(onTrimClip).not.toHaveBeenCalled()
  })

  it('persists the resized span to the camera and restores it on a fresh mount (reload)', async () => {
    const first = renderBareResizable()
    await settle()
    fireEvent.pointerDown(first.grid, { clientX: 798, clientY: 10, pointerId: 1 })
    fireEvent.pointerMove(first.grid, { clientX: 1200, clientY: 10, pointerId: 1 })
    fireEvent.pointerUp(first.grid, { clientX: 1200, clientY: 10, pointerId: 1 })
    expect(majors(first.container as unknown as HTMLElement)).toBe(6)
    // The override landed in the persisted camera under `bareSpan`.
    const cam = JSON.parse(window.localStorage.getItem('stave:timelineCamera') ?? '{}')
    expect(cam.bareSpan).toBe(6)
    cleanup()
    // A fresh mount (a reload) seeds the override from the camera → 6 bars with NO
    // drag. This is the "persists across reload" guarantee at the unit level.
    const second = renderBareResizable()
    await settle()
    expect(majors(second.container as unknown as HTMLElement)).toBe(6)
  })

  it('after extending to 6, selecting the bare clip + S splits at the CHOSEN span (6), not the floor (4)', async () => {
    const { grid, onSplitClip } = renderBareResizable()
    await settle()
    // Extend to 6 bars.
    fireEvent.pointerDown(grid, { clientX: 798, clientY: 10, pointerId: 1 })
    fireEvent.pointerMove(grid, { clientX: 1200, clientY: 10, pointerId: 1 })
    fireEvent.pointerUp(grid, { clientX: 1200, clientY: 10, pointerId: 1 })
    // Select the bare clip (a click that does NOT travel) in the bd row.
    fireEvent.pointerDown(grid, { clientX: 200, clientY: 10, pointerId: 1 })
    fireEvent.pointerUp(grid, { clientX: 200, clientY: 10, pointerId: 1 })
    // `S` materializes the combinator at the bare clip’s width — now 6, the chosen
    // span — so split → arrange([3, pat], [3, pat]). The span flows through the
    // clip’s endCycle (= displaySpan) for free, no serializer change (#662).
    fireEvent.keyDown(grid, { key: 's' })
    expect(onSplitClip).toHaveBeenCalledTimes(1)
    expect(onSplitClip.mock.calls[0][0]).toMatchObject({ armIndex: -1, firstWeight: 3, span: 6 })
  })
})

describe('FullSongTimeline — the marks are read for the WINDOW on screen (#1209)', () => {
  // The view's marks used to be read as a PREFIX (`getTimelineEvents(span)`)
  // and derived over `[0, span)`, whatever the origin. Once the view pages that
  // is the wrong stretch of song twice over: it asks for events the window does
  // not contain, and it discards the ones it does. These arms drive the real
  // memo through a real render, so they fail if production stops threading the
  // window — which is what separates them from arms that restate the rule.
  function renderAtOrigin(originCycle: number) {
    const band = vi.fn(() => [] as never[])
    const prefix = vi.fn(() => [] as never[])
    renderFull({
      ir: {} as never,
      windowOriginCycles: originCycle,
      getTimelineEventsBand: band as never,
      getTimelineEvents: prefix as never,
    })
    return { band, prefix }
  }

  it('asks the BAND accessor for the window, not for a prefix from cycle 0', () => {
    // The fixture's display span is 4, so the second page is [4, 8).
    const { band, prefix } = renderAtOrigin(4)

    expect(band).toHaveBeenCalled()
    expect(band.mock.calls[0]).toEqual([4, 8])
    // ⚠ The whole point of the band accessor: a deep page must not query and
    // discard everything to its left. If the prefix form is still reached while
    // a band accessor is wired, that cost is back.
    expect(prefix).not.toHaveBeenCalled()
  })

  it('at origin 0 it asks for [0, span) — the unpaged behaviour, unchanged', () => {
    const { band } = renderAtOrigin(0)
    expect(band.mock.calls[0]).toEqual([0, 4])
  })

  it('falls back to the PREFIX accessor when no band accessor is wired', () => {
    // Correct, just slow: the prefix returns a superset and `collectNoteMarks`
    // narrows it to the window.
    const prefix = vi.fn(() => [] as never[])
    renderFull({
      ir: {} as never,
      windowOriginCycles: 4,
      getTimelineEvents: prefix as never,
    })
    expect(prefix).toHaveBeenCalled()
    expect(prefix.mock.calls[0]).toEqual([8])
  })
})
