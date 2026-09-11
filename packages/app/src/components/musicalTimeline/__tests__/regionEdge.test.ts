/**
 * Grabbing a sample mark's edge to trim what it plays (#1527).
 *
 * The geometry here is not restated — every arm queries against the SAME
 * `laneMarkBands` + `markRect` the renderer draws with, so an arm that passes
 * is an arm that agrees with the pixels.
 */
import { describe, it, expect } from 'vitest'
import {
  MIN_REGION_EDGE_W,
  REGION_DRAG_SPAN_PX,
  REGION_EDGE_GRIP_PX,
  markRegionValue,
  regionAnchorAgrees,
  regionEdgeAt,
  regionValueAtDrag,
  type RegionEdgeQuery,
} from '../regionEdge'
import { computeLaneLayout } from '../laneLayout'
import { markRect, laneMarkBands } from '../drawTimeline'
import type { SceneLane, SceneNote, TimelineScene } from '../timelineScene'

const VIEWPORT = 800
const SPAN = 4
const PX_PER_CYCLE = VIEWPORT / SPAN // 200
const toScreenX = (cycle: number): number => cycle * PX_PER_CYCLE

function laneWith(notes: SceneNote[], laneKey = 'vox'): SceneLane {
  return {
    laneKey,
    displayName: laneKey,
    color: '#0af',
    density: [1, 0, 0, 0],
    notes,
    pitchMin: null,
    pitchMax: null,
    voices: [{ key: 'take_1', label: 'take_1', melodic: false, pitchMin: null, pitchMax: null }],
    clips: [],
    sourceOffset: 6,
    arrangeOffset: 6,
    labelOffset: null,
    automations: [],
  } as unknown as SceneLane
}

const note = (over: Partial<SceneNote> = {}): SceneNote =>
  ({ cycle: 1, end: 1.5, pitch: null, gain: 1, voice: 'take_1', ...over }) as SceneNote

/** The layout a lane gets when it IS expanded, and when it is not. */
function layoutFor(lanes: readonly SceneLane[], expanded: string[]) {
  return computeLaneLayout(
    lanes.map((l) => ({ laneKey: l.laneKey, voices: l.voices })),
    new Set(expanded),
    24,
    88,
  )
}

/** Where the renderer actually puts a note's rect — asked, never restated. */
function rectOf(lane: SceneLane, layout: ReturnType<typeof layoutFor>, n: SceneNote) {
  const box = layout.boxes.find((b) => b.laneKey === lane.laneKey)!
  for (const band of laneMarkBands(lane, box)) {
    if (!band.notes.includes(n)) continue
    const r = markRect(n, band, PX_PER_CYCLE, VIEWPORT, 0, SPAN, toScreenX)
    if (r) return r
  }
  throw new Error('the renderer draws no rect for this note')
}

function queryAt(
  lanes: readonly SceneLane[],
  layout: ReturnType<typeof layoutFor>,
  screenX: number,
  contentY: number,
): RegionEdgeQuery {
  return {
    lanes,
    layout,
    screenX,
    contentY,
    pxPerCycle: PX_PER_CYCLE,
    viewportWidth: VIEWPORT,
    firstCycle: 0,
    lastCycle: SPAN,
    toScreenX,
  }
}

describe('regionEdgeAt — which edge is under the pointer', () => {
  const n = note()
  const lane = laneWith([n])
  const layout = layoutFor([lane], ['vox'])
  const r = rectOf(lane, layout, n)

  it('the renderer gives this mark a rect wide enough to have two edges', () => {
    // Guards every arm below: a mark narrower than this is deliberately inert,
    // so an arm that silently fell under the floor would pass by not applying.
    expect(r.w).toBeGreaterThanOrEqual(MIN_REGION_EDGE_W)
  })

  it('grabs `begin` at the left edge', () => {
    const hit = regionEdgeAt(queryAt([lane], layout, r.x, r.y + r.h / 2))
    expect(hit?.side).toBe('begin')
    expect(hit?.laneKey).toBe('vox')
    expect(hit?.note).toBe(n)
  })

  it('grabs `end` at the right edge', () => {
    const hit = regionEdgeAt(queryAt([lane], layout, r.x + r.w, r.y + r.h / 2))
    expect(hit?.side).toBe('end')
  })

  it('grabs within the grip band and misses just outside it', () => {
    const y = r.y + r.h / 2
    expect(regionEdgeAt(queryAt([lane], layout, r.x + REGION_EDGE_GRIP_PX, y))?.side).toBe('begin')
    expect(regionEdgeAt(queryAt([lane], layout, r.x + REGION_EDGE_GRIP_PX + 1, y))).toBeNull()
  })

  it('⚠ the grip lies INSIDE the mark — just outside its left edge is a miss', () => {
    // The bands used to straddle the edges, which made the pixels around every
    // join between two abutting marks claim both marks. Inside-only bands are
    // what keep each side of a join its own gesture; this is the arm that
    // fails if they ever straddle again.
    const y = r.y + r.h / 2
    expect(regionEdgeAt(queryAt([lane], layout, r.x, y))?.side).toBe('begin')
    expect(regionEdgeAt(queryAt([lane], layout, r.x - 1, y))).toBeNull()
    expect(regionEdgeAt(queryAt([lane], layout, r.x + r.w, y))?.side).toBe('end')
    expect(regionEdgeAt(queryAt([lane], layout, r.x + r.w + 1, y))).toBeNull()
  })

  it('misses above and below the mark`s own band', () => {
    expect(regionEdgeAt(queryAt([lane], layout, r.x, r.y - 1))).toBeNull()
    expect(regionEdgeAt(queryAt([lane], layout, r.x, r.y + r.h))).toBeNull()
  })

  it('⚠ a COLLAPSED lane is inert — there is no waveform drawn to aim at', () => {
    const collapsed = layoutFor([lane], [])
    // Sweep the whole row rather than one point: "collapsed is inert" must not
    // be provable only at a coordinate the mark happens not to occupy.
    const box = collapsed.boxes[0]
    let hits = 0
    for (let x = 0; x <= VIEWPORT; x += 2) {
      for (let y = box.top; y < box.top + box.height; y += 2) {
        if (regionEdgeAt(queryAt([lane], collapsed, x, y))) hits++
      }
    }
    expect(hits).toBe(0)
  })

  it('a synth note (no `s`) is inert — it has no file to trim', () => {
    const synth = note({ voice: null, pitch: 60 })
    const synthLane = laneWith([synth])
    const synthLayout = layoutFor([synthLane], ['vox'])
    const sr = rectOf(synthLane, synthLayout, synth)
    expect(regionEdgeAt(queryAt([synthLane], synthLayout, sr.x, sr.y + sr.h / 2))).toBeNull()
  })

  it('a mark too narrow for two grips is inert rather than ambiguous', () => {
    // 1/500th of a cycle — well under `MIN_REGION_EDGE_W` at this zoom.
    const tiny = note({ cycle: 1, end: 1.002 })
    const tinyLane = laneWith([tiny])
    const tinyLayout = layoutFor([tinyLane], ['vox'])
    const tr = rectOf(tinyLane, tinyLayout, tiny)
    expect(tr.w).toBeLessThan(MIN_REGION_EDGE_W)
    expect(regionEdgeAt(queryAt([tinyLane], tinyLayout, tr.x, tr.y + tr.h / 2))).toBeNull()
  })

  it('picks the NEARER edge when both are in reach', () => {
    // A mark exactly at the floor width: both grips are live, and the midpoint
    // is the only place the tie-break can be read.
    const mid = r.x + r.w / 2
    const left = regionEdgeAt(queryAt([lane], layout, mid - r.w / 2 + 1, r.y + 1))
    const right = regionEdgeAt(queryAt([lane], layout, mid + r.w / 2 - 1, r.y + 1))
    expect(left?.side).toBe('begin')
    expect(right?.side).toBe('end')
  })
})

describe('the drag scale is the FILE, and it has a floor', () => {
  it('a wide mark sweeps the file across its own width', () => {
    const wide = note({ cycle: 0, end: 2 }) // 400px at this zoom
    const lane = laneWith([wide])
    const layout = layoutFor([lane], ['vox'])
    const r = rectOf(lane, layout, wide)
    const hit = regionEdgeAt(queryAt([lane], layout, r.x, r.y + 1))!
    expect(r.w).toBeGreaterThan(REGION_DRAG_SPAN_PX)
    expect(hit.fractionPerPx).toBeCloseTo(1 / r.w, 10)
  })

  it('⚠ a narrow mark gets the FLOOR, not 1/w — otherwise a px is a third of the file', () => {
    const n = note({ cycle: 1, end: 1.1 }) // 20px
    const lane = laneWith([n])
    const layout = layoutFor([lane], ['vox'])
    const r = rectOf(lane, layout, n)
    const hit = regionEdgeAt(queryAt([lane], layout, r.x, r.y + 1))!
    expect(r.w).toBeLessThan(REGION_DRAG_SPAN_PX)
    expect(hit.fractionPerPx).toBeCloseTo(1 / REGION_DRAG_SPAN_PX, 10)
    // The property the floor exists for: one pixel is a small move.
    expect(hit.fractionPerPx).toBeLessThan(0.01)
  })

  it('the scale does NOT depend on how trimmed the mark already is', () => {
    // A ratchet — scaling to the current slice — would make these differ, and
    // each successive trim would be finer than the last.
    const untrimmed = note({ cycle: 0, end: 2 })
    const trimmed = note({
      cycle: 0,
      end: 2,
      region: { begin: 0.45, end: 0.5, speed: 1, unit: null },
    } as Partial<SceneNote>)
    const scaleOf = (n: SceneNote): number => {
      const lane = laneWith([n])
      const layout = layoutFor([lane], ['vox'])
      const r = rectOf(lane, layout, n)
      return regionEdgeAt(queryAt([lane], layout, r.x, r.y + 1))!.fractionPerPx
    }
    expect(scaleOf(trimmed)).toBe(scaleOf(untrimmed))
  })
})

describe('markRegionValue — what the ENGINE says this mark plays', () => {
  it('falls back to superdough`s defaults for a mark with no region', () => {
    expect(markRegionValue(note(), 'begin')).toBe(0)
    expect(markRegionValue(note(), 'end')).toBe(1)
  })

  it('reads the resolved region when there is one', () => {
    const n = note({ region: { begin: 0.25, end: 0.75, speed: 1, unit: null } } as Partial<SceneNote>)
    expect(markRegionValue(n, 'begin')).toBe(0.25)
    expect(markRegionValue(n, 'end')).toBe(0.75)
  })
})

describe('regionAnchorAgrees — the guard against a wrong anchor', () => {
  const plain = note()
  const trimmed = note({
    region: { begin: 0.1, end: 1, speed: 1, unit: null },
  } as Partial<SceneNote>)

  it('agrees when the document writes what the engine played', () => {
    expect(regionAnchorAgrees(markRegionValue(trimmed, 'begin'), 'begin', 0.1)).toBe(true)
  })

  it('agrees when both say the default — an unwritten control on a plain mark', () => {
    expect(regionAnchorAgrees(markRegionValue(plain, 'begin'), 'begin', 'absent')).toBe(true)
    expect(regionAnchorAgrees(markRegionValue(plain, 'end'), 'end', 'absent')).toBe(true)
  })

  it('⚠ REFUSES the measured hazard: the mark is trimmed, the chunk is not', () => {
    // `const vox = s("take_1")` / `$: vox.begin(0.1)`. The lane anchor lands on
    // the const, whose chain has no `.begin`, so the chunk reads `absent` while
    // the mark plays 0.1. Appending there would edit a shared binding that the
    // outer `.begin` then overrides — the document changes and the sound does not.
    expect(regionAnchorAgrees(markRegionValue(trimmed, 'begin'), 'begin', 'absent')).toBe(false)
  })

  it('refuses when the chunk writes a DIFFERENT number than the mark plays', () => {
    expect(regionAnchorAgrees(markRegionValue(trimmed, 'begin'), 'begin', 0.6)).toBe(false)
  })

  it('refuses a patterned value — there is nothing to agree with', () => {
    expect(regionAnchorAgrees(markRegionValue(trimmed, 'begin'), 'begin', null)).toBe(false)
  })

  it('tolerates float drift, but not a value a user could have meant', () => {
    expect(regionAnchorAgrees(markRegionValue(trimmed, 'begin'), 'begin', 0.1 + 1e-9)).toBe(true)
    expect(regionAnchorAgrees(markRegionValue(trimmed, 'begin'), 'begin', 0.11)).toBe(false)
  })
})

describe('regionValueAtDrag — the scale is the caller`s, fixed at pointer-down', () => {
  it('is linear in the travel', () => {
    expect(regionValueAtDrag(0.2, 10, 0.01)).toBeCloseTo(0.3, 10)
    expect(regionValueAtDrag(0.2, -10, 0.01)).toBeCloseTo(0.1, 10)
    // Twice the travel is twice the change — the property that fails if a
    // caller re-derives the scale against a shrinking slice each move.
    expect(regionValueAtDrag(0.2, 20, 0.01) - 0.2).toBeCloseTo(
      2 * (regionValueAtDrag(0.2, 10, 0.01) - 0.2),
      10,
    )
  })

  it('returns the start value unchanged for a scale that cannot be used', () => {
    expect(regionValueAtDrag(0.2, 10, 0)).toBe(0.2)
    expect(regionValueAtDrag(0.2, 10, Number.NaN)).toBe(0.2)
    expect(regionValueAtDrag(0.2, Number.NaN, 0.01)).toBe(0.2)
  })
})
