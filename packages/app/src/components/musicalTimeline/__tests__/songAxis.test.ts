import { describe, it, expect } from 'vitest'
import {
  songCycleToX,
  xToSongCycle,
  trimExtent,
  wrapSongPosition,
  clampZoom,
  clampRestoreZoom,
  contentWidthFor,
  scrollLeftForZoom,
  followScrollLeft,
  rulerTicks,
  MIN_ZOOM,
  MAX_ZOOM,
  MAX_RESTORE_ZOOM,
  MAX_TICKS,
  wholeSongWindow,
} from '../songAxis'
import { BEATS_PER_BAR, DEFAULT_METER } from '../../../lib/meter'

/** Terse window literal for the origin-0 arms — every pre-#1108 case is a
 *  window anchored at cycle 0, so these read exactly as they did before. */
const win = (spanCycles: number, originCycle = 0) => ({ originCycle, spanCycles })

describe('songCycleToX', () => {
  it('maps a cycle linearly across the width', () => {
    expect(songCycleToX(0, win(8), 800)).toBe(0)
    expect(songCycleToX(4, win(8), 800)).toBe(400)
    expect(songCycleToX(8, win(8), 800)).toBe(800)
  })

  it('clamps out-of-range cycles to the edges', () => {
    expect(songCycleToX(-2, win(8), 800)).toBe(0)
    expect(songCycleToX(20, win(8), 800)).toBe(800)
  })

  it('returns 0 for degenerate inputs', () => {
    expect(songCycleToX(null, win(8), 800)).toBe(0)
    expect(songCycleToX(4, win(0), 800)).toBe(0)
    expect(songCycleToX(4, win(8), 0)).toBe(0)
    expect(songCycleToX(Number.NaN, win(8), 800)).toBe(0)
  })
})

describe('xToSongCycle', () => {
  it('inverts songCycleToX', () => {
    expect(xToSongCycle(0, win(8), 800)).toBe(0)
    expect(xToSongCycle(400, win(8), 800)).toBeCloseTo(4)
  })

  it('clamps x to the canvas and keeps the result below displayCycles', () => {
    expect(xToSongCycle(-50, win(8), 800)).toBe(0)
    // far edge → just below 8 (so it seeks the last cycle, not a wrap to 0)
    const atEdge = xToSongCycle(800, win(8), 800)
    expect(atEdge).toBeLessThan(8)
    expect(atEdge).toBeGreaterThan(7.9)
  })

  it('returns 0 for degenerate inputs', () => {
    expect(xToSongCycle(100, win(0), 800)).toBe(0)
    expect(xToSongCycle(100, win(8), 0)).toBe(0)
  })

  it('round-trips a mid cycle through both directions', () => {
    const x = songCycleToX(3, win(8), 800)
    expect(xToSongCycle(x, win(8), 800)).toBeCloseTo(3)
  })
})

describe('wrapSongPosition', () => {
  it('wraps a position past the loop length back into [0, displayCycles)', () => {
    expect(wrapSongPosition(2, win(8), true)).toBe(2)
    expect(wrapSongPosition(10, win(8), true)).toBe(2)
    expect(wrapSongPosition(8, win(8), true)).toBe(0)
  })

  it('handles negative positions', () => {
    expect(wrapSongPosition(-1, win(8), true)).toBe(7)
  })

  it('returns null for null / non-finite / degenerate', () => {
    expect(wrapSongPosition(null, win(8), true)).toBeNull()
    expect(wrapSongPosition(Number.NaN, win(8), true)).toBeNull()
    expect(wrapSongPosition(4, win(0), true)).toBeNull()
  })

  // #1105 — when the span is the analysis cap rather than a loop, the modulo
  // would assert a repeat the song does not have.
  describe('non-looping span (the analysis gave up at the cap)', () => {
    it('passes a position INSIDE the span straight through', () => {
      expect(wrapSongPosition(0, win(256), false)).toBe(0)
      expect(wrapSongPosition(200, win(256), false)).toBe(200)
      expect(wrapSongPosition(255.9, win(256), false)).toBeCloseTo(255.9)
    })

    it('withholds the playhead PAST the span instead of wrapping it', () => {
      // The whole point: 257 must NOT come back as 1.
      expect(wrapSongPosition(257, win(256), false)).toBeNull()
      expect(wrapSongPosition(256, win(256), false)).toBeNull()
      expect(wrapSongPosition(5000, win(256), false)).toBeNull()
    })

    it('differs from the looping arm exactly where the loop claim is false', () => {
      // Same inputs, both arms — inside the span they agree, past it they must not.
      expect(wrapSongPosition(100, win(256), false)).toBe(wrapSongPosition(100, win(256), true))
      expect(wrapSongPosition(257, win(256), true)).toBe(1)
      expect(wrapSongPosition(257, win(256), false)).toBeNull()
    })

    it('still returns null for null / non-finite / degenerate', () => {
      expect(wrapSongPosition(null, win(256), false)).toBeNull()
      expect(wrapSongPosition(Number.NaN, win(256), false)).toBeNull()
      expect(wrapSongPosition(4, win(0), false)).toBeNull()
    })

    it('clamps a negative position to 0 rather than wrapping it to the tail', () => {
      // Wrapping -1 to 255 would place the playhead at the far edge of a span
      // that does not loop — the same false claim from the other direction.
      expect(wrapSongPosition(-1, win(256), false)).toBe(0)
    })
  })
})

describe('clampZoom', () => {
  it('clamps to [MIN_ZOOM, MAX_ZOOM]', () => {
    expect(clampZoom(0.2)).toBe(MIN_ZOOM)
    expect(clampZoom(1000)).toBe(MAX_ZOOM)
    expect(clampZoom(4)).toBe(4)
  })
  it('falls back to MIN_ZOOM for non-finite (incl. infinity)', () => {
    expect(clampZoom(Number.NaN)).toBe(MIN_ZOOM)
    expect(clampZoom(Number.POSITIVE_INFINITY)).toBe(MIN_ZOOM)
  })
})

describe('clampRestoreZoom (#505)', () => {
  it('caps a restored extreme zoom at MAX_RESTORE_ZOOM (well below MAX_ZOOM)', () => {
    expect(MAX_RESTORE_ZOOM).toBeLessThan(MAX_ZOOM)
    expect(clampRestoreZoom(MAX_ZOOM)).toBe(MAX_RESTORE_ZOOM)
    expect(clampRestoreZoom(11.39)).toBe(MAX_RESTORE_ZOOM) // e.g. a persisted 1139%
  })
  it('passes through a moderate zoom unchanged', () => {
    expect(clampRestoreZoom(MAX_RESTORE_ZOOM)).toBe(MAX_RESTORE_ZOOM)
    expect(clampRestoreZoom(2)).toBe(2)
    expect(clampRestoreZoom(0.2)).toBe(MIN_ZOOM)
  })
  it('falls back to MIN_ZOOM for non-finite (incl. infinity)', () => {
    expect(clampRestoreZoom(Number.NaN)).toBe(MIN_ZOOM)
    expect(clampRestoreZoom(Number.POSITIVE_INFINITY)).toBe(MIN_ZOOM)
  })
})

describe('contentWidthFor', () => {
  it('returns the viewport width at zoom 1 and widens proportionally', () => {
    expect(contentWidthFor(800, 1)).toBe(800)
    expect(contentWidthFor(800, 2)).toBe(1600)
  })
  it('never shrinks below the viewport, and degenerates to 0', () => {
    expect(contentWidthFor(800, 0.5)).toBe(800)
    expect(contentWidthFor(0, 4)).toBe(0)
  })
})

describe('scrollLeftForZoom (cursor-centered)', () => {
  it('keeps the content point under the cursor pinned when zooming in', () => {
    // viewport 800, at zoom 1 the cursor at x=400 sits over content x=400.
    // Zoom to 2 → that content point is now at 800; to keep it under x=400 we
    // scroll to 800 - 400 = 400.
    const next = scrollLeftForZoom({
      oldZoom: 1,
      newZoom: 2,
      scrollLeft: 0,
      cursorX: 400,
      viewportWidth: 800,
    })
    expect(next).toBe(400)
  })
  it('clamps to the scrollable range', () => {
    // far-right cursor zooming in would push past max scroll → clamp.
    const next = scrollLeftForZoom({
      oldZoom: 1,
      newZoom: 2,
      scrollLeft: 0,
      cursorX: 800,
      viewportWidth: 800,
    })
    expect(next).toBe(800) // maxScroll = 800*2 - 800
  })
  it('never goes negative and handles degenerate inputs', () => {
    expect(
      scrollLeftForZoom({ oldZoom: 2, newZoom: 1, scrollLeft: 0, cursorX: 0, viewportWidth: 800 }),
    ).toBe(0)
    expect(
      scrollLeftForZoom({ oldZoom: 1, newZoom: 2, scrollLeft: 0, cursorX: 400, viewportWidth: 0 }),
    ).toBe(0)
  })
})

describe('followScrollLeft (center-lock, #505)', () => {
  // viewport 800, content 1600 (zoom 2) -> maxScroll 800. Default = center-lock:
  // target = playheadX - viewportWidth/2, clamped to [0, maxScroll].
  it('keeps the playhead centered every step (smooth continuous pan)', () => {
    // playhead 800 -> target 400; scrollLeft already 400 (centered) -> 400.
    expect(followScrollLeft(800, 800, 1600, 400)).toBe(400)
    // playhead drifts 1px past center -> recenters by 1px (no dead-zone hold).
    expect(followScrollLeft(820, 800, 1600, 400)).toBe(420)
    // a playhead the old 0.6 band would have held in place now recenters.
    expect(followScrollLeft(1040, 800, 1600, 400)).toBe(640)
    expect(followScrollLeft(600, 800, 1600, 700)).toBe(200)
  })

  it('clamps (pins) at the song ends so the playhead drifts into the margin', () => {
    // near the start: target 40 - 400 = -360 -> clamps to 0 (playhead left of center).
    expect(followScrollLeft(40, 800, 1600, 0)).toBe(0)
    // near the end: target 1550 - 400 = 1150 -> clamps to maxScroll 800.
    expect(followScrollLeft(1550, 800, 1600, 800)).toBe(800)
  })

  it('no-ops when there is nothing to scroll (not zoomed) or on degenerate input', () => {
    expect(followScrollLeft(400, 800, 800, 0)).toBe(0) // content == viewport
    expect(followScrollLeft(400, 0, 1600, 123)).toBe(123) // viewportWidth 0
    expect(followScrollLeft(Number.NaN, 800, 1600, 400)).toBe(400) // non-finite playhead
    // an out-of-range current offset doesn't matter under center-lock: target
    // is derived from the playhead, not the current offset.
    expect(followScrollLeft(1200, 800, 1600, 5000)).toBe(800)
  })

  it('opt-in page-follow (deadZone > 0): holds in-band, recenters at the edge', () => {
    const band = { deadZone: 0.6 } // middle 60% -> in-band viewport-x [160, 640]
    // playhead 1040, scrollLeft 400 -> viewport-x 640 (right edge) is in-band -> hold.
    expect(followScrollLeft(1040, 800, 1600, 400, band)).toBe(400)
    // playhead 1200, scrollLeft 0 -> viewport-x 1200 out of band -> recenter to 800.
    expect(followScrollLeft(1200, 800, 1600, 0, band)).toBe(800)
  })
})

describe('rulerTicks', () => {
  it('emits a 0-indexed major per cycle when there is room (CYCLES)', () => {
    const ticks = rulerTicks(win(4), 200, 'cycles', DEFAULT_METER)
    expect(ticks.map((t) => t.label)).toEqual(['0', '1', '2', '3'])
    expect(ticks.every((t) => t.major)).toBe(true)
  })
  it('uses 1-indexed bar labels and adds beat ticks when zoomed in (BARS)', () => {
    const ticks = rulerTicks(win(2), 200, 'bars', DEFAULT_METER) // 200px/cycle → 50px/beat ≥ 14
    const majors = ticks.filter((t) => t.major)
    expect(majors.map((t) => t.label)).toEqual(['1', '2'])
    const beats = ticks.filter((t) => !t.major)
    // 2 bars × (BEATS_PER_BAR - 1) interior beat ticks
    expect(beats.length).toBe(2 * (BEATS_PER_BAR - 1))
    expect(beats.map((t) => t.cycle)).toContain(0.25)
    expect(beats.every((t) => t.label === null)).toBe(true)
  })
  it('drops beat ticks when each beat is too narrow', () => {
    const ticks = rulerTicks(win(2), 40, 'bars', DEFAULT_METER) // 40/4 = 10px/beat < 14 → no beats
    expect(ticks.every((t) => t.major)).toBe(true)
  })
  it('thins majors by powers of two when zoomed out', () => {
    // 64 cycles across 800px → 12.5px/cycle; step doubles until ≥40 → step 4.
    const ticks = rulerTicks(win(64), 12.5, 'cycles', DEFAULT_METER)
    expect(ticks.map((t) => t.cycle)).toEqual([0, 4, 8, 12, 16, 20, 24, 28, 32, 36, 40, 44, 48, 52, 56, 60])
  })
  it('caps the total tick count on a long song at high zoom (#415)', () => {
    // 4000 cycles × 1000px/cycle would emit 4000 majors uncapped → thin by
    // powers of two until majors fit the budget.
    const ticks = rulerTicks(win(4000), 1000, 'cycles', DEFAULT_METER)
    expect(ticks.length).toBeLessThanOrEqual(MAX_TICKS)
    // step doubled to 8 (4000/8 = 500 ≤ 600) → first majors are 0, 8, 16…
    expect(ticks.slice(0, 3).map((t) => t.cycle)).toEqual([0, 8, 16])
  })

  it('drops beats when they would blow the budget, keeping only majors', () => {
    // 256 bars at step 1 with wide beats: 256×4 = 1024 > MAX_TICKS → beats off.
    const ticks = rulerTicks(win(256), 250, 'bars', DEFAULT_METER)
    expect(ticks.every((t) => t.major)).toBe(true)
    expect(ticks.length).toBe(256)
    expect(ticks.length).toBeLessThanOrEqual(MAX_TICKS)
  })

  it('returns [] for degenerate inputs', () => {
    expect(rulerTicks(win(0), 100, 'cycles', DEFAULT_METER)).toEqual([])
    expect(rulerTicks(win(4), 0, 'cycles', DEFAULT_METER)).toEqual([])
    expect(rulerTicks(win(4), Number.NaN, 'cycles', DEFAULT_METER)).toEqual([])
  })
})

// ── Windowed axis (#1108) ────────────────────────────────────────────────────
//
// Every arm above sits at origin 0, where the window and the song coincide and
// an origin bug is invisible. These are the arms that can see one.

describe('the axis under a non-zero window origin (#1108)', () => {
  const w1 = win(256, 256) // the second page: [256, 512)

  it('wholeSongWindow is the unpaged window', () => {
    expect(wholeSongWindow(256)).toEqual({ originCycle: 0, spanCycles: 256 })
  })

  it('maps ABSOLUTE cycles across the window, not offsets from it', () => {
    expect(songCycleToX(256, w1, 800)).toBe(0)
    expect(songCycleToX(384, w1, 800)).toBe(400)
    expect(songCycleToX(512, w1, 800)).toBe(800)
    // The bug this catches: treating the cycle as an offset would put 256 at
    // the far edge instead of the near one.
    expect(songCycleToX(256, w1, 800)).not.toBe(songCycleToX(256, win(256), 800))
  })

  it('clamps a cycle outside the window to the nearer edge', () => {
    expect(songCycleToX(0, w1, 800)).toBe(0)
    expect(songCycleToX(9999, w1, 800)).toBe(800)
  })

  it('inverts back to an ABSOLUTE cycle', () => {
    expect(xToSongCycle(0, w1, 800)).toBe(256)
    expect(xToSongCycle(400, w1, 800)).toBeCloseTo(384)
    const atEdge = xToSongCycle(800, w1, 800)
    expect(atEdge).toBeLessThan(512)
    expect(atEdge).toBeGreaterThan(511.9)
  })

  it('round-trips an absolute cycle through both directions', () => {
    const x = songCycleToX(300, w1, 800)
    expect(xToSongCycle(x, w1, 800)).toBeCloseTo(300)
  })

  it('resolves a degenerate inversion to the window origin, not to cycle 0', () => {
    // Cycle 0 is not even in view here; answering 0 would seek the transport to
    // a different part of the song than the one the user clicked in.
    expect(xToSongCycle(100, win(0, 256), 800)).toBe(256)
    expect(xToSongCycle(100, w1, 0)).toBe(256)
    expect(xToSongCycle(Number.NaN, w1, 800)).toBe(256)
  })

  it('withholds the playhead BEFORE the window, not just past it', () => {
    // The paging-specific half: the user has paged ahead of the transport.
    expect(wrapSongPosition(100, w1, false)).toBeNull()
    expect(wrapSongPosition(255.9, w1, false)).toBeNull()
    // In view → the absolute position, unchanged.
    expect(wrapSongPosition(256, w1, false)).toBe(256)
    expect(wrapSongPosition(400, w1, false)).toBe(400)
    // Past it → still null, as before.
    expect(wrapSongPosition(512, w1, false)).toBeNull()
  })

  it('labels the ruler with ABSOLUTE cycle numbers', () => {
    const ticks = rulerTicks(win(4, 256), 200, 'cycles', DEFAULT_METER)
    expect(ticks.map((t) => t.label)).toEqual(['256', '257', '258', '259'])
    // BARS mode stays 1-indexed off the absolute cycle, so bar 1 cannot appear
    // in the middle of the piece.
    expect(rulerTicks(win(4, 256), 200, 'bars', DEFAULT_METER).filter((t) => t.major).map((t) => t.label))
      .toEqual(['257', '258', '259', '260'])
  })

  it('aligns majors to ABSOLUTE multiples of the step, not to the window start', () => {
    // 64-cycle window from 250, thinned to step 4: the first major is 252, not
    // 250. Anchoring to the window would relabel the same musical position
    // differently depending on where the user paged from.
    const ticks = rulerTicks(win(64, 250), 12.5, 'cycles', DEFAULT_METER)
    expect(ticks[0].cycle).toBe(252)
    expect(ticks.every((t) => t.cycle % 4 === 0)).toBe(true)
    expect(ticks.every((t) => t.cycle >= 250 && t.cycle < 314)).toBe(true)
  })
})

/**
 * `trimExtent` (#1203) — the extend drag's inverse.
 *
 * Every arm below is at a NON-ZERO origin on purpose. At origin 0 the
 * window-relative and song-absolute frames coincide, so the defect this
 * function exists to remove is invisible: the old inline arithmetic passes
 * every origin-0 assertion that could be written about it.
 */
describe('trimExtent', () => {
  const base = {
    pxPerCycle: 10,
    originCycle: 256,
    floorCycle: 0,
    marginCycles: 2,
    minSpanCycles: 32,
  }

  it('returns a SONG-ABSOLUTE end cycle — the origin plus the cursor offset', () => {
    // 80px at 10px/cycle is 8 cycles INTO the window, and the window starts at
    // 256, so the user is asking for cycle 264 — not cycle 8.
    expect(trimExtent({ ...base, contentX: 80 }).endCycle).toBe(264)
  })

  it('returns a WINDOW-RELATIVE span — the same measurement from the other side', () => {
    // 264 absolute is 8 into the window, +2 margin = 10; the floor of 32 wins.
    expect(trimExtent({ ...base, contentX: 80 }).spanCycles).toBe(32)
    // Past the floor the margin decides, and the origin must NOT be in it:
    // 500px = 50 cycles in = cycle 306 absolute, span 50 + 2 = 52.
    const far = trimExtent({ ...base, contentX: 500 })
    expect(far.endCycle).toBe(306)
    expect(far.spanCycles).toBe(52)
  })

  it('the end and the span differ by exactly the origin, at any cursor position', () => {
    // The property the two-number return exists to guarantee. Deriving them
    // separately is how one gained the origin and the other kept it.
    //
    // Both floors are released (margin 0, minSpan 0) on purpose: with either of
    // them binding, the span stops tracking the end and the identity is simply
    // not the property — as written with `minSpanCycles: 1` this arm failed at
    // contentX 0 for that reason, and the code was right.
    for (const contentX of [0, 37, 250, 1000, 4096]) {
      const { endCycle, spanCycles } = trimExtent({ ...base, contentX, minSpanCycles: 0, marginCycles: 0 })
      expect(endCycle - spanCycles).toBe(base.originCycle)
    }
  })

  it('clamps to the floor, which is itself song-absolute', () => {
    // A clip starting at cycle 300 may not be trimmed below 301, even though
    // the cursor is far to the left of it inside the window.
    expect(trimExtent({ ...base, contentX: 0, floorCycle: 301 }).endCycle).toBe(301)
  })

  it('can ask for a cycle PAST the window end — this is why the clamped inverse cannot serve it', () => {
    // The window is [256, 288). 900px is 90 cycles in → 346, well beyond it.
    // `xToSongCycle` would clamp this to just under 288 and the extend drag
    // could never grow the span at all.
    const { endCycle } = trimExtent({ ...base, contentX: 900 })
    expect(endCycle).toBe(346)
    expect(endCycle).toBeGreaterThan(base.originCycle + 32)
  })

  it('never lets the span shrink below the current one', () => {
    expect(trimExtent({ ...base, contentX: 0, minSpanCycles: 64 }).spanCycles).toBe(64)
  })

  it('degenerate scale falls back to the floor and the current span', () => {
    expect(trimExtent({ ...base, contentX: 80, pxPerCycle: 0 })).toEqual({ endCycle: 0, spanCycles: 32 })
    expect(trimExtent({ ...base, contentX: Number.NaN })).toEqual({ endCycle: 0, spanCycles: 32 })
  })

  it('CONTROL — at origin 0 the two frames coincide, which is why this went unseen', () => {
    // Documents the blind spot rather than covering behaviour: this arm passes
    // against the origin-blind arithmetic too.
    const { endCycle, spanCycles } = trimExtent({ ...base, originCycle: 0, contentX: 500, minSpanCycles: 1 })
    expect(endCycle).toBe(50)
    expect(spanCycles).toBe(52)
  })
})
