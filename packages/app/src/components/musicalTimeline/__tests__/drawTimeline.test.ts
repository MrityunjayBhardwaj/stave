import { describe, it, expect } from 'vitest'
import { drawTimeline, laneRenderMode, COARSEN_PX, MIN_MARK_W, type DrawTransform, type DrawTheme } from '../drawTimeline'
import { DEFAULT_METER } from '../../../lib/meter'
import { computeLaneLayout } from '../laneLayout'
import type { TimelineScene, SceneNote } from '../timelineScene'

const theme: DrawTheme = {
  background: '#000',
  rowAlt: '#111',
  section: '#222',
  sectionAlt: '#333',
  gridline: '#444',
  clipFill: '#555',
  clipCaption: '#fff', clipBorder: '#666',
  automationLine: '#automationLine',
}

interface Rect { x: number; y: number; w: number; h: number; style: string; alpha: number }
/** A drawn caption (#1391) — the text AND where it landed, because a name drawn
 *  outside its own clip is a name on the wrong section. */
interface Text { text: string; x: number; y: number; style: string; font: string }

/** Recording mock 2D context — captures every fillRect (the only primitive the
 *  renderer uses) so tests can assert positions/counts without a real canvas.
 *
 *  `style`/`alpha` are captured too (#1100). They were originally dropped, which
 *  made this harness structurally unable to see a defect of VISIBILITY: the
 *  silent lane's clip was being drawn all along, at an alpha that composited to
 *  ~3/255, and every geometry assertion here passed while nothing was on screen.
 *  A recorder that keeps only positions can only ever answer "was it drawn", and
 *  that is not the same question as "can it be seen". */
function mockCtx() {
  const rects: Rect[] = []
  const texts: Text[] = []
  const ctx = {
    fillStyle: '' as string,
    globalAlpha: 1,
    font: '' as string,
    textBaseline: '' as string,
    clearRect() {},
    save() {},
    restore() {},
    fillRect(x: number, y: number, w: number, h: number) {
      rects.push({ x, y, w, h, style: ctx.fillStyle, alpha: ctx.globalAlpha })
    },
    fillText(text: string, x: number, y: number) {
      texts.push({ text, x, y, style: ctx.fillStyle, font: ctx.font })
    },
    // A stand-in metric, NOT a real font measurement: 6px per glyph. The
    // truncation logic under test only needs a width that GROWS with the string,
    // and a deterministic one makes the fit boundary assertable. What this cannot
    // check is whether the real font agrees — that is what the browser arm is for.
    measureText(text: string) {
      return { width: text.length * 6 } as TextMetrics
    },
  }
  return { ctx: ctx as unknown as CanvasRenderingContext2D, rects, texts }
}

const scene: TimelineScene = {
  displayCycles: 4,
  windowOriginCycles: 0,
  period: 4,
  peakDensity: 2,
  notesCapped: false,
  sections: [{ startCycle: 0, endCycle: 4, laneKeys: ['lead'] }],
  lanes: [
    {
      laneKey: 'lead',
      displayName: 'lead',
      color: '#0af',
      density: [1, 0, 2, 0], // onsets at integer cycles 0 and 2
      notes: [
        { cycle: 0, end: 0.25, pitch: 60, gain: 1 },
        { cycle: 2, end: 2.25, pitch: 72, gain: 0.5 },
        { cycle: 2.5, end: 2.75, pitch: 64, gain: 0.8 }, // fractional → only marks render here
      ],
      pitchMin: 60,
      pitchMax: 72,
      voices: [{ key: 'lead', label: 'lead', melodic: true, pitchMin: 60, pitchMax: 72 }],
      clips: [],
      sourceOffset: null,
      arrangeOffset: null,
      labelOffset: null,
      automations: [],
    },
  ],
}

/** Default collapsed layout (one 22px row), the common case for these tests. */
const flat = computeLaneLayout(scene.lanes, new Set(), 22, 88)

describe('laneRenderMode', () => {
  it('shows marks when a cycle is wide enough, density when narrow', () => {
    expect(laneRenderMode(COARSEN_PX + 1, true)).toBe('marks')
    expect(laneRenderMode(COARSEN_PX - 1, true)).toBe('density')
  })
  it('always uses density when the lane has no marks', () => {
    expect(laneRenderMode(1000, false)).toBe('density')
  })
  it('degenerate pxPerCycle → density', () => {
    expect(laneRenderMode(Number.NaN, true)).toBe('density')
  })
  it('an expanded lane with marks forces marks even when zoomed out', () => {
    expect(laneRenderMode(COARSEN_PX - 1, true, true)).toBe('marks')
    expect(laneRenderMode(1000, false, true)).toBe('density') // still no marks → density
  })
})

describe('drawTimeline', () => {
  const vw = 400

  it('draws mini-note marks when zoomed in (a mark lands at the fractional cycle 2.5)', () => {
    // contentWidth 4000 over 4 cycles = 1000px/cycle ≫ COARSEN_PX → marks mode.
    const transform: DrawTransform = { scrollLeft: 0, contentWidth: 4000, viewportWidth: vw, meter: DEFAULT_METER }
    const { ctx, rects } = mockCtx()
    drawTimeline(ctx, scene, transform, theme, flat)
    // cycle 2.5 → contentX = (2.5/4)*4000 = 2500; with scrollLeft 0 it's off-screen
    // (vw=400). Scroll so it's visible and re-check instead:
    const { ctx: ctx2, rects: rects2 } = mockCtx()
    drawTimeline(ctx2, scene, { ...transform, scrollLeft: 2400 }, theme, flat)
    const screenXof = (cycle: number) => (cycle / 4) * 4000 - 2400
    // #459 — mark height now scales with the row: at rowHeight 22 it's
    // barHeightForBand(22 − 2·3) = max(3, 16 − 12) = 4 (was a fixed 3).
    const markAt25 = rects2.some((r) => Math.abs(r.x - screenXof(2.5)) < 1 && r.h === 4)
    expect(markAt25).toBe(true)
    // sanity: marks are short (h=4), unlike full-height bands/gridlines.
    expect(rects2.some((r) => r.h === 4)).toBe(true)
    expect(rects.length).toBeGreaterThan(0)
  })

  it('draws coarse density when zoomed out (no fractional-cycle rect)', () => {
    // contentWidth 40 over 4 cycles = 10px/cycle < COARSEN_PX → density mode.
    const transform: DrawTransform = { scrollLeft: 0, contentWidth: 40, viewportWidth: vw, meter: DEFAULT_METER }
    const { ctx, rects } = mockCtx()
    drawTimeline(ctx, scene, transform, theme, flat)
    const screenXof = (cycle: number) => (cycle / 4) * 40
    // density only draws at integer cycles 0 and 2 — never at 2.5.
    expect(rects.some((r) => Math.abs(r.x - screenXof(2.5)) < 0.5 && r.h !== 22)).toBe(false)
    // and there IS a density cell at integer cycle 2 (padded height, not full).
    expect(rects.some((r) => Math.abs(r.x - screenXof(2)) < 0.5)).toBe(true)
  })

  it('no-ops cleanly on a degenerate transform', () => {
    const { ctx, rects } = mockCtx()
    drawTimeline(ctx, scene, { scrollLeft: 0, contentWidth: 0, viewportWidth: 0, meter: DEFAULT_METER }, theme, flat)
    expect(rects.length).toBe(0)
  })

  it('places a second lane at its layout top (variable row heights)', () => {
    const two: TimelineScene = {
      ...scene,
      lanes: [scene.lanes[0], { ...scene.lanes[0], laneKey: 'bass' }],
    }
    // 'lead' expanded to 88px → 'bass' starts at y=88, not y=22.
    const layout = computeLaneLayout(two.lanes, new Set(['lead']), 22, 88)
    expect(layout.boxes[1].top).toBe(88)
    const { ctx, rects } = mockCtx()
    // Zoomed out so each lane draws density (integer cells) at its own top.
    drawTimeline(ctx, two, { scrollLeft: 0, contentWidth: 40, viewportWidth: vw, meter: DEFAULT_METER }, theme, layout)
    // bass density cells sit in its band [88, 110) — i.e. at least one rect with y >= 88.
    expect(rects.some((r) => r.y >= 88 && r.y < 110)).toBe(true)
  })

  it('an expanded lane draws per-beat gridlines spanning its taller band', () => {
    // 1000px/cycle → 250px/beat ≫ BEAT_GRID_MIN_PX → beat grid shows.
    const layout = computeLaneLayout(scene.lanes, new Set(['lead']), 22, 88)
    const { ctx, rects } = mockCtx()
    drawTimeline(ctx, scene, { scrollLeft: 0, contentWidth: 4000, viewportWidth: vw, meter: DEFAULT_METER }, theme, layout)
    // A beat gridline is a 1px-wide column the full height of the 88px band.
    const beatGrid = rects.filter((r) => r.w === 1 && r.h === 88 && r.y === 0)
    expect(beatGrid.length).toBeGreaterThan(0)
  })

  it('draws marks with DURATION-proportional width (a sustained note is a long bar)', () => {
    const durScene: TimelineScene = {
      ...scene,
      lanes: [
        {
          ...scene.lanes[0],
          notes: [
            { cycle: 0, end: 0, pitch: 60, gain: 1 }, // zero-duration trigger → MIN_MARK_W
            { cycle: 1, end: 2, pitch: 64, gain: 1 }, // a whole cycle long
          ],
        },
      ],
    }
    // 4000px / 4 cycles = 1000 px/cycle ≫ COARSEN_PX → marks mode.
    const { ctx, rects } = mockCtx()
    drawTimeline(ctx, durScene, { scrollLeft: 0, contentWidth: 4000, viewportWidth: 4000, meter: DEFAULT_METER }, theme, flat)
    const marks = rects.filter((r) => r.h === 4) // mark height (collapsed, rowHeight 22 → 4; #459)
    const short = marks.find((r) => Math.abs(r.x - 0) < 1)!
    const long = marks.find((r) => Math.abs(r.x - 1000) < 1)! // cycle 1 → x=1000
    expect(short.w).toBe(MIN_MARK_W) // floored
    expect(long.w).toBe(1000) // (2 − 1) cycles × 1000 px/cycle
    expect(long.w).toBeGreaterThan(short.w)
  })

  it('places each voice of an expanded multi-voice lane on its own sub-band baseline (#424)', () => {
    // A drum lane with two percussive voices (bd, sd) at the same cycle. Before
    // #424 both landed on ONE centered baseline; now each draws in its own
    // sub-row, so the two marks sit at DIFFERENT y.
    const drumScene: TimelineScene = {
      ...scene,
      lanes: [
        {
          laneKey: 'drums',
          displayName: 'drums',
          color: '#fa0',
          density: [2, 0, 0, 0],
          notes: [
            { cycle: 0, end: 0.25, pitch: null, gain: 1, voice: 'bd' },
            { cycle: 0, end: 0.25, pitch: null, gain: 1, voice: 'sd' },
          ],
          pitchMin: null,
          pitchMax: null,
          voices: [
            { key: 'bd', label: 'bd', melodic: false, pitchMin: null, pitchMax: null },
            { key: 'sd', label: 'sd', melodic: false, pitchMin: null, pitchMax: null },
          ],
          clips: [],
          sourceOffset: null,
          arrangeOffset: null,
      labelOffset: null,
      automations: [],
        },
      ],
    }
    // Expanded with 2 voices → sub-rows (22px each → 44px lane). 1000px/cycle → marks.
    const layout = computeLaneLayout(drumScene.lanes, new Set(['drums']), 22, 88, 22)
    expect(layout.boxes[0].subRows?.length).toBe(2)
    const { ctx, rects } = mockCtx()
    drawTimeline(ctx, drumScene, { scrollLeft: 0, contentWidth: 4000, viewportWidth: 4000, meter: DEFAULT_METER }, theme, layout)
    // Marks are the short rects at x≈0 (cycle 0). #459 — the sub-row mark scales
    // with the sub-row height: barHeightForBand(22 − 2·2) = max(3, 18 − 12) = 6.
    // The two voices must land on DIFFERENT baselines — bd sub-row 0, sd sub-row 1.
    const marks = rects.filter((r) => r.h === 6 && Math.abs(r.x - 0) < 1)
    expect(marks.length).toBe(2)
    const ys = marks.map((r) => r.y).sort((a, b) => a - b)
    expect(ys[1] - ys[0]).toBeGreaterThanOrEqual(20) // ~one SUB_ROW_HEIGHT apart
    // Sub-row 0 baseline sits in [0,22), sub-row 1 in [22,44) — no overlap.
    expect(ys[0]).toBeLessThan(22)
    expect(ys[1]).toBeGreaterThanOrEqual(22)
  })
})

describe('drawClips (#386)', () => {
  const vw = 400
  it('draws a bordered filled rect per clip segment over the shared transform', () => {
    // Two clips: arm 0 cycles [0,2), arm 1 [2,4). 100px/cycle (contentWidth 400).
    const clipScene: TimelineScene = {
      ...scene,
      lanes: [
        {
          ...scene.lanes[0],
          notes: [],
          clips: [
            { armIndex: 0, startCycle: 0, endCycle: 2, label: 'a', nameRange: null, sectionName: '' },
            { armIndex: 1, startCycle: 2, endCycle: 4, label: 'b', nameRange: null, sectionName: '' },
          ],
        },
      ],
    }
    const { ctx, rects } = mockCtx()
    drawTimeline(ctx, clipScene, { scrollLeft: 0, contentWidth: 400, viewportWidth: vw, meter: DEFAULT_METER }, theme, flat)
    // Clip fills span their cycle range: arm0 [0,200), arm1 [200,400).
    const fill0 = rects.find((r) => r.x === 0 && r.w === 200 && r.h === 22)
    const fill1 = rects.find((r) => r.x === 200 && r.w === 200 && r.h === 22)
    expect(fill0).toBeDefined()
    expect(fill1).toBeDefined()
    // Border at the internal boundary cycle 2 (x=200), full row height.
    const borderAt200 = rects.find((r) => Math.abs(r.x - 200) < 1 && r.w === 1 && r.h === 22)
    expect(borderAt200).toBeDefined()
  })

  it('an implicit single clip fills the whole lane (bare track, seamless)', () => {
    const oneClip: TimelineScene = {
      ...scene,
      lanes: [{ ...scene.lanes[0], notes: [], clips: [{ armIndex: -1, startCycle: 0, endCycle: 4, label: null, nameRange: null, sectionName: '' }] }],
    }
    const { ctx, rects } = mockCtx()
    drawTimeline(ctx, oneClip, { scrollLeft: 0, contentWidth: 400, viewportWidth: vw, meter: DEFAULT_METER }, theme, flat)
    expect(rects.some((r) => r.x === 0 && r.w === 400 && r.h === 22)).toBe(true)
  })
})

/**
 * #1100 — a declared-but-silent track (#1099) has a whole-song clip with no
 * content. Before this, the clip WAS drawn (fill + two verticals) but the fill
 * composited to ~3/255 and the verticals sat at the song's extreme edges, so the
 * row read as inert rather than silenced.
 *
 * The load-bearing assertion is the HORIZONTAL edges: they are what make a clip
 * whose verticals are off at the song boundaries visible at all. A geometry-only
 * check ("some rect exists") would have passed on the broken code too, which is
 * why these assert the drawn STYLE as well.
 */
describe('drawClips — empty clip outline (#1100)', () => {
  const vw = 400
  const emptyLane = {
    ...scene.lanes[0],
    color: '#0af',
    // Annotated: a bare `[]` infers `never[]`, which makes every later override
    // that supplies a note a type error rather than a fixture.
    notes: [] as readonly SceneNote[],
    density: [0, 0, 0, 0] as readonly number[],
    clips: [{ armIndex: -1, startCycle: 0, endCycle: 4, label: null, nameRange: null, sectionName: '' }],
  }
  const emptyScene: TimelineScene = { ...scene, lanes: [emptyLane] }
  const draw = (s: TimelineScene, silenced?: ReadonlySet<string>) => {
    const { ctx, rects } = mockCtx()
    drawTimeline(ctx, s, { scrollLeft: 0, contentWidth: 400, viewportWidth: vw, meter: DEFAULT_METER }, theme, flat, silenced)
    return rects
  }
  /** 1px-tall rects in the lane's own colour = the outline's horizontal edges. */
  const horizontalEdges = (rects: Rect[], color: string) =>
    rects.filter((r) => r.h === 1 && r.w > 1 && r.style === color)

  it('outlines an empty clip with BOTH horizontal edges, in the lane colour', () => {
    const edges = horizontalEdges(draw(emptyScene), '#0af')
    expect(edges).toHaveLength(2)
    // Both span the clip's full on-screen width — the whole song.
    for (const e of edges) {
      expect(e.x).toBe(0)
      expect(e.w).toBe(400)
      expect(e.alpha).toBeGreaterThan(0)
      expect(e.alpha).toBeLessThan(1)
    }
    // Top edge above bottom edge, both inside the 22px band.
    const [top, bottom] = edges.map((e) => e.y).sort((a, b) => a - b)
    expect(top).toBeGreaterThanOrEqual(0)
    expect(bottom).toBeLessThan(22)
    expect(bottom - top).toBeGreaterThan(0)
  })

  it('backs the outline with a neutral floor, so legibility does not track the lane hue', () => {
    // A dark lane colour and a bright one must both clear the same floor: the
    // neutral pass is drawn in the SAME token a clip seam uses.
    for (const color of ['#0af', '#101010']) {
      const rects = draw({ ...scene, lanes: [{ ...emptyLane, color }] })
      const neutral = rects.filter((r) => r.h === 1 && r.w === 400 && r.style === theme.clipBorder)
      expect(neutral).toHaveLength(2)
    }
  })

  // ⚠ The three arms below assert an ABSENCE, which holds trivially when the
  // outline is not drawn at all — so each carries a POSITIVE control on the same
  // scene with only the content removed. Without the control they pass on code
  // that never outlines anything, and prove nothing about the discriminator.
  it('leaves a clip WITH content untouched — no outline on a sounding lane', () => {
    // `scene.lanes[0]` carries density [1,0,2,0]; same clip, same geometry.
    const clips = [{ armIndex: -1, startCycle: 0, endCycle: 4, label: null, nameRange: null, sectionName: '' }]
    const sounding: TimelineScene = { ...scene, lanes: [{ ...scene.lanes[0], clips }] }
    expect(horizontalEdges(draw(sounding), scene.lanes[0].color)).toHaveLength(0)
    // CONTROL: identical but silent → the outline must appear.
    const silent: TimelineScene = {
      ...scene,
      lanes: [{ ...scene.lanes[0], clips, notes: [], density: [0, 0, 0, 0] }],
    }
    expect(horizontalEdges(draw(silent), scene.lanes[0].color)).toHaveLength(2)
  })

  it('counts DENSITY as content even with no notes, and notes with no density', () => {
    const clips = [{ armIndex: -1, startCycle: 0, endCycle: 4, label: null, nameRange: null, sectionName: '' }]
    const lane = (over: Partial<typeof emptyLane>) =>
      draw({ ...scene, lanes: [{ ...emptyLane, clips, ...over }] })
    // Either source alone suppresses the outline…
    expect(horizontalEdges(lane({ density: [0, 1, 0, 0], notes: [] }), '#0af')).toHaveLength(0)
    expect(horizontalEdges(
      lane({ density: [0, 0, 0, 0], notes: [{ cycle: 1, end: 1.5, pitch: 60, gain: 1 }] }), '#0af',
    )).toHaveLength(0)
    // CONTROL: …and with BOTH empty it appears, so the two arms above are
    // reading the sources and not merely never outlining.
    expect(horizontalEdges(lane({ density: [0, 0, 0, 0], notes: [] }), '#0af')).toHaveLength(2)
  })

  it('counts a ZERO-DURATION trigger, and does not count one ending ON the seam', () => {
    const arms = [
      { armIndex: 0, startCycle: 0, endCycle: 2, label: 'a', nameRange: null, sectionName: '' },
      { armIndex: 1, startCycle: 2, endCycle: 4, label: 'b', nameRange: null, sectionName: '' },
    ]
    const withNote = (n: SceneNote) =>
      horizontalEdges(
        draw({ ...scene, lanes: [{ ...emptyLane, density: [0, 0, 0, 0], notes: [n], clips: arms }] }),
        '#0af',
      )
    // A percussive trigger at arm 1's very start has end === cycle. It is
    // content, so only arm 0 is outlined.
    const zeroDur = withNote({ cycle: 2, end: 2, pitch: null, gain: 1 })
    expect(zeroDur).toHaveLength(2)
    for (const e of zeroDur) expect(e.x).toBe(0)
    // A note ending EXACTLY on the seam contributes nothing past it, so arm 1
    // is still empty and gets the outline.
    const endsOnSeam = withNote({ cycle: 1, end: 2, pitch: 60, gain: 1 })
    expect(endsOnSeam).toHaveLength(2)
    for (const e of endsOnSeam) expect(e.x).toBe(200)
  })

  it('outlines only the EMPTY arm of a part-empty arrangement', () => {
    // Arm 0 [0,2) carries density; arm 1 [2,4) is empty → only arm 1 outlined.
    const partly: TimelineScene = {
      ...scene,
      lanes: [{
        ...emptyLane,
        density: [1, 1, 0, 0],
        clips: [
          { armIndex: 0, startCycle: 0, endCycle: 2, label: 'a', nameRange: null, sectionName: '' },
          { armIndex: 1, startCycle: 2, endCycle: 4, label: 'b', nameRange: null, sectionName: '' },
        ],
      }],
    }
    const edges = horizontalEdges(draw(partly), '#0af')
    expect(edges).toHaveLength(2)
    for (const e of edges) {
      expect(e.x).toBe(200) // the empty arm only
      expect(e.w).toBe(200)
    }
  })

  it('a note SUSTAINING across a boundary leaves neither arm reading as empty', () => {
    const arms = [
      { armIndex: 0, startCycle: 0, endCycle: 2, label: 'a', nameRange: null, sectionName: '' },
      { armIndex: 1, startCycle: 2, endCycle: 4, label: 'b', nameRange: null, sectionName: '' },
    ]
    const withNote = (n: SceneNote) =>
      draw({ ...scene, lanes: [{ ...emptyLane, density: [0, 0, 0, 0], notes: [n], clips: arms }] })
    // Straddles the cycle-2 seam → belongs to BOTH arms, neither is empty.
    expect(horizontalEdges(withNote({ cycle: 1.5, end: 2.5, pitch: 60, gain: 1 }), '#0af')).toHaveLength(0)
    // CONTROL: the same note pulled back wholly inside arm 0 leaves arm 1 empty,
    // so the arm above is spared by the OVERLAP rule, not by nothing being drawn.
    const inArm0 = horizontalEdges(withNote({ cycle: 1.5, end: 1.9, pitch: 60, gain: 1 }), '#0af')
    expect(inArm0).toHaveLength(2)
    for (const e of inArm0) expect(e.x).toBe(200)
  })

  it('is drawn BEFORE the silenced scrim, so a muted lane fades with everything else', () => {
    const rects = draw(emptyScene, new Set(['lead']))
    const lastEdge = rects.map((r, i) => ({ r, i })).filter((x) => x.r.h === 1 && x.r.style === '#0af').pop()
    const scrim = rects.map((r, i) => ({ r, i })).find((x) => x.r.style === theme.background && x.r.alpha < 1)
    expect(lastEdge).toBeDefined()
    expect(scrim).toBeDefined()
    expect(scrim!.i).toBeGreaterThan(lastEdge!.i)
  })
})

// ---------------------------------------------------------------------------
// Section-name captions (#1391)
// ---------------------------------------------------------------------------

describe('clip captions — the section name on the canvas', () => {
  const clipScene = (
    sectionName: string,
    startCycle = 0,
    endCycle = 4,
  ): TimelineScene => ({
    ...scene,
    lanes: [
      {
        ...scene.lanes[0]!,
        clips: [
          { armIndex: 0, startCycle, endCycle, label: 'bd', nameRange: null, sectionName },
        ],
      },
    ],
  })

  it('draws the section name inside its clip', () => {
    const { ctx, texts } = mockCtx()
    drawTimeline(ctx, clipScene('verse'), { scrollLeft: 0, contentWidth: 400, viewportWidth: 400, meter: DEFAULT_METER }, theme, flat)
    const caption = texts.find((t) => t.text === 'verse')
    expect(caption, `no caption drawn — got ${JSON.stringify(texts)}`).toBeDefined()
    // Inside the clip's own horizontal span, not at the canvas origin.
    expect(caption!.x).toBeGreaterThanOrEqual(0)
    expect(caption!.x).toBeLessThan(400)
    expect(caption!.style).toBe(theme.clipCaption)
  })

  it('draws the positional name for an unnamed section', () => {
    const { ctx, texts } = mockCtx()
    drawTimeline(ctx, clipScene('§2'), { scrollLeft: 0, contentWidth: 400, viewportWidth: 400, meter: DEFAULT_METER }, theme, flat)
    expect(texts.map((t) => t.text)).toContain('§2')
  })

  it('draws NOTHING for a bare track — it is not an arrangement', () => {
    // The implicit whole-song clip of a non-arranged lane carries `''`, and a
    // caption there would invent a section the document does not have.
    const { ctx, texts } = mockCtx()
    drawTimeline(ctx, clipScene(''), { scrollLeft: 0, contentWidth: 400, viewportWidth: 400, meter: DEFAULT_METER }, theme, flat)
    expect(texts).toEqual([])
  })

  it('truncates a name too long for its clip rather than overflowing it', () => {
    // A clip WIDE ENOUGH to caption (60px, over the 34px floor) but far too
    // narrow for a 20-glyph name at the stand-in 6px/glyph. The
    // caption must shrink and mark itself elided, never spill into the section
    // next door.
    const { ctx, texts } = mockCtx()
    drawTimeline(
      ctx,
      clipScene('averylongsectionname', 0, 1),
      { scrollLeft: 0, contentWidth: 240, viewportWidth: 240, meter: DEFAULT_METER },
      theme,
      flat,
    )
    const caption = texts[0]
    expect(caption).toBeDefined()
    expect(caption!.text).not.toBe('averylongsectionname')
    expect(caption!.text.endsWith('…')).toBe(true)
    expect(caption!.text.length).toBeLessThan('averylongsectionname'.length)
  })

  it('draws no caption at all in a clip too narrow to hold one', () => {
    // A one-glyph caption reads as a DIFFERENT section's name; silence is the
    // honest degradation.
    const { ctx, texts } = mockCtx()
    drawTimeline(
      ctx,
      clipScene('verse', 0, 4),
      { scrollLeft: 0, contentWidth: 12, viewportWidth: 12, meter: DEFAULT_METER },
      theme,
      flat,
    )
    expect(texts).toEqual([])
  })
})
