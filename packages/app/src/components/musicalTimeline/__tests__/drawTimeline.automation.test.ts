/**
 * The continuous-automation curve on a lane (#1464 Stage 1, READ ONLY).
 *
 * The producer being correct says nothing about pixels, and this file exists
 * because the two failure modes are different: `signalAutomation.test.ts` asks
 * "did we read the document right", this one asks "did anything reach the
 * canvas, in the right band, and does each of the three legs #1464 names
 * actually change it".
 *
 * ⚠ The mock records STROKED PATHS, not just calls. A recorder that counted
 * `stroke()` alone could not tell a curve from a flat line, and "a curve was
 * drawn" is not the same claim as "the curve has a shape" — the same distinction
 * `drawTimeline.test.ts` learned to make about alpha and visibility.
 */
import { describe, it, expect } from 'vitest'
import { drawTimeline, type DrawTheme, type DrawTransform } from '../drawTimeline'
import { DEFAULT_METER } from '../../../lib/meter'
import type { TimelineScene, SceneLane } from '../timelineScene'
import type { SignalAutomation } from '@stave/editor'
import { computeLaneLayout } from '../laneLayout'

const THEME: DrawTheme = {
  background: '#bg', rowAlt: '#rowAlt', section: '#sect', sectionAlt: '#sectAlt',
  gridline: '#grid', clipFill: '#clipFill', clipCaption: '#cap', clipBorder: '#border',
  automationLine: '#AUTO',
}
const TRANSFORM: DrawTransform = { scrollLeft: 0, contentWidth: 400, viewportWidth: 400, meter: DEFAULT_METER }

interface Path { points: { x: number; y: number }[]; style: string; dash: readonly number[] }
interface Text { text: string; x: number; y: number; style: string }
interface Fill { x: number; y: number; w: number; h: number; style: string; alpha: number }

function mockCtx() {
  const paths: Path[] = []
  const texts: Text[] = []
  const fills: Fill[] = []
  let cur: { x: number; y: number }[] = []
  const ctx = {
    fillStyle: '', strokeStyle: '', globalAlpha: 1, lineWidth: 1, lineJoin: '',
    font: '', textBaseline: '', _dash: [] as readonly number[],
    setLineDash(d: readonly number[]) { ctx._dash = d },
    clearRect() {}, save() {}, restore() {},
    fillRect(x: number, y: number, w: number, h: number) {
      fills.push({ x, y, w, h, style: ctx.fillStyle, alpha: ctx.globalAlpha })
    },
    measureText(t: string) { return { width: t.length * 6 } as TextMetrics },
    fillText(text: string, x: number, y: number) { texts.push({ text, x, y, style: ctx.fillStyle }) },
    beginPath() { cur = [] },
    moveTo(x: number, y: number) { cur.push({ x, y }) },
    lineTo(x: number, y: number) { cur.push({ x, y }) },
    stroke() { paths.push({ points: cur, style: ctx.strokeStyle, dash: ctx._dash }) },
  }
  return { ctx: ctx as unknown as CanvasRenderingContext2D, paths, texts, fills }
}

const NO_SPANS = { shape: null, rate: null, range: null, chainEnd: null } as const

const auto = (over: Partial<SignalAutomation> = {}): SignalAutomation => ({
  trackId: 'd1', paramKey: 'cutoff', kind: 'sine', periodCycles: 1,
  // Spans are Stage 2's WRITE coordinates; nothing on the drawing path reads
  // them, which is why the drawing fixtures leave them empty.
  lo: 0, hi: 1, ranged: true, offset: 0, spans: NO_SPANS, ...over,
})

const lane = (automations: readonly SignalAutomation[]): SceneLane => ({
  laneKey: 'd1', displayName: 'd1', color: '#7af', density: [1, 1, 1, 1],
  notes: [], pitchMin: null, pitchMax: null, voices: [], clips: [],
  sourceOffset: null, arrangeOffset: null, labelOffset: null, automations,
})

const sceneWith = (automations: readonly SignalAutomation[]): TimelineScene => ({
  lanes: [lane(automations)], sections: [], displayCycles: 4,
  windowOriginCycles: 0, period: null, peakDensity: 1, notesCapped: false,
})

/** Draw one lane at a generous height so the curve is never suppressed. */
function run(automations: readonly SignalAutomation[], expanded = false) {
  const m = mockCtx()
  const scene = sceneWith(automations)
  const layout = computeLaneLayout(
    scene.lanes, expanded ? new Set(['d1']) : new Set<string>(), 40, 90, 20,
  )
  drawTimeline(m.ctx, scene, TRANSFORM, THEME, layout)
  return { ...m, layout }
}

/** The same lane, but zoomed so the whole 256-cycle aperiodic window is on
 *  screen — the state a continuously modulated document actually lands in
 *  (#1465), where one oscillation is a few pixels wide. */
function runWide(automations: readonly SignalAutomation[]) {
  const m = mockCtx()
  const scene: TimelineScene = { ...sceneWith(automations), displayCycles: 256 }
  const layout = computeLaneLayout(scene.lanes, new Set<string>(), 40, 90, 20)
  drawTimeline(m.ctx, scene, TRANSFORM, THEME, layout)
  return m
}

describe('automation curve — presence', () => {
  it('draws nothing when the lane has no automation', () => {
    expect(run([]).paths).toHaveLength(0)
  })

  it('draws one stroked path for one automated parameter', () => {
    const { paths } = run([auto()])
    expect(paths).toHaveLength(1)
    expect(paths[0].style).toBe('#AUTO')
    expect(paths[0].points.length).toBeGreaterThan(10)
  })

  it('draws one path per automated parameter', () => {
    const { paths } = run([auto({ paramKey: 'cutoff' }), auto({ paramKey: 'pan' })])
    expect(paths).toHaveLength(2)
  })

  it('keeps every point inside the lane band', () => {
    const { paths, layout } = run([auto()])
    const box = layout.boxes[0]
    for (const p of paths[0].points) {
      expect(p.y).toBeGreaterThanOrEqual(box.top)
      expect(p.y).toBeLessThanOrEqual(box.top + box.height)
    }
  })
})

describe('automation curve — the three legs visibly change it', () => {
  it('SHAPE: a square wave and a sine do not draw the same path', () => {
    const sine = run([auto({ kind: 'sine' })]).paths[0].points.map((p) => p.y)
    const square = run([auto({ kind: 'square' })]).paths[0].points.map((p) => p.y)
    expect(square).not.toEqual(sine)
    // A square only ever sits at the band's two extremes; a sine visits neither
    // exclusively. Distinct y-values is the cheapest way to say that.
    expect(new Set(square).size).toBeLessThan(new Set(sine).size)
  })

  it('RATE: a slower signal turns fewer times across the same window', () => {
    const turns = (period: number) => {
      const ys = run([auto({ periodCycles: period })]).paths[0].points.map((p) => p.y)
      let n = 0
      for (let i = 2; i < ys.length; i++) {
        const a = ys[i - 1] - ys[i - 2]
        const b = ys[i] - ys[i - 1]
        if (a !== 0 && b !== 0 && Math.sign(a) !== Math.sign(b)) n++
      }
      return n
    }
    expect(turns(1)).toBeGreaterThan(turns(4))
  })

  it('RANGE: the bounds are stated on an expanded lane', () => {
    const { texts } = run([auto({ paramKey: 'cutoff', lo: 200, hi: 2000 })], true)
    expect(texts.map((t) => t.text)).toContain('cutoff 200→2000')
  })

  it('RANGE: a different range reads differently', () => {
    const { texts } = run([auto({ paramKey: 'pan', lo: 0.4, hi: 0.6 })], true)
    expect(texts.map((t) => t.text)).toContain('pan 0.4→0.6')
  })

  it('marks a bound this module SUPPLIED so it is never read as the user\'s', () => {
    const { texts } = run([auto({ paramKey: 'gain', lo: 0, hi: 1, ranged: false })], true)
    expect(texts.map((t) => t.text)).toContain('gain ~0→1')
  })

  it('states no bounds on a collapsed lane — that row is a contour view', () => {
    const { texts, paths } = run([auto({ paramKey: 'cutoff', lo: 200, hi: 2000 })], false)
    expect(texts.map((t) => t.text)).not.toContain('cutoff 200→2000')
    expect(paths).toHaveLength(1) // the curve itself still draws
  })
})

describe('automation curve — it declines rather than smearing', () => {
  it('draws no curve in a band too short to show a shape', () => {
    const m = mockCtx()
    const scene = sceneWith([auto()])
    const layout = computeLaneLayout(scene.lanes, new Set<string>(), 4, 4, 4)
    drawTimeline(m.ctx, scene, TRANSFORM, THEME, layout)
    expect(m.paths).toHaveLength(0)
  })

  it('ignores an automation with a non-finite period rather than drawing NaN', () => {
    const { paths } = run([auto({ periodCycles: Number.NaN })])
    expect(paths).toHaveLength(0)
  })
})

describe('automation curve — too fast to resolve at this zoom', () => {
  it('states a rapid modulation as a BAND instead of smearing strokes', () => {
    // 256 cycles across 400px = 1.56px/cycle, so a 2-cycle sine is ~3px per
    // oscillation — below what a 1.5px stroke can distinguish.
    const { paths, fills } = runWide([auto({ periodCycles: 2 })])
    expect(paths).toHaveLength(0)
    const band = fills.filter((f) => f.style === '#AUTO')
    expect(band).toHaveLength(1)
    expect(band[0].alpha).toBeLessThan(0.5)
    expect(band[0].w).toBeGreaterThan(100)
  })

  it('still draws a real curve when the signal IS slow enough to resolve', () => {
    // A 64-cycle period over the same 256-cycle window is 100px per oscillation.
    const { paths, fills } = runWide([auto({ periodCycles: 64 })])
    expect(paths).toHaveLength(1)
    expect(fills.filter((f) => f.style === '#AUTO')).toHaveLength(0)
  })

  it('draws the curve, not a band, at an ordinary 4-cycle zoom', () => {
    const { paths, fills } = run([auto({ periodCycles: 1 })])
    expect(paths).toHaveLength(1)
    expect(fills.filter((f) => f.style === '#AUTO')).toHaveLength(0)
  })
})

/**
 * #1485 — a lane can carry several automated parameters, and drawn in one
 * colour they are identical lines sharing a band. Every curve is normalised to
 * its OWN range, so there is no positional cue either: a curve near the top is
 * not "the high one", it is whichever signal is near its own maximum.
 */
describe('several automations on one lane are told apart (#1485)', () => {
  it('gives each PARAMETER its own curve colour', () => {
    const m = run([auto({ paramKey: 'cutoff' }), auto({ paramKey: 'pan' })])
    const styles = m.paths.map((p) => p.style)
    expect(styles).toHaveLength(2)
    expect(styles[0]).not.toBe(styles[1])
  })

  it('draws a caption in ITS OWN curve colour — the only thing tying the two', () => {
    const m = run([auto({ paramKey: 'cutoff' }), auto({ paramKey: 'pan' })], true)
    const cutoff = m.texts.find((t) => t.text.startsWith('cutoff'))
    const pan = m.texts.find((t) => t.text.startsWith('pan'))
    expect(cutoff, 'the cutoff caption').toBeDefined()
    expect(pan, 'the pan caption').toBeDefined()
    // Each caption matches a DRAWN curve, and they do not match each other.
    expect(m.paths.map((p) => p.style)).toContain(cutoff!.style)
    expect(m.paths.map((p) => p.style)).toContain(pan!.style)
    expect(cutoff!.style).not.toBe(pan!.style)
  })

  it('keeps the theme colour when there is only one curve to tell apart', () => {
    // The hue exists to disambiguate; with nothing to disambiguate the lane
    // looks exactly as it did before this change.
    const m = run([auto({ paramKey: 'cutoff' })])
    expect(m.paths.map((p) => p.style)).toEqual(['#AUTO'])
  })

  it('colours a parameter by NAME, not by its position in the lane', () => {
    // A lane gaining a second automation must not recolour the first, or the
    // hue would mean "how many curves are here" rather than "which parameter".
    const first = run([auto({ paramKey: 'pan' }), auto({ paramKey: 'cutoff' })])
    const swapped = run([auto({ paramKey: 'cutoff' }), auto({ paramKey: 'pan' })])
    const styleOf = (m: ReturnType<typeof run>, i: number) => m.paths[i].style
    expect(styleOf(first, 0)).toBe(styleOf(swapped, 1)) // pan
    expect(styleOf(first, 1)).toBe(styleOf(swapped, 0)) // cutoff
  })
})

/**
 * The sibling defect in the same loop: several parameters too fast to resolve
 * each filled the SAME rectangle at alpha 0.18, so the alpha compounded and N
 * parameters rendered darker than one.
 */
describe('unresolvable automations do not stack their alpha (#1485)', () => {
  /** Fast enough that a period spans well under the minimum drawable pixels. */
  const fast = (paramKey: string) => auto({ paramKey, periodCycles: 0.001 })
  const bands = (m: ReturnType<typeof run>) => m.fills.filter((f) => f.alpha === 0.18)

  it('covers each band region exactly once, whatever the count', () => {
    const one = bands(run([fast('cutoff')]))
    const three = bands(run([fast('cutoff'), fast('pan'), fast('gain')]))
    expect(one).toHaveLength(1)
    expect(three).toHaveLength(3)
    // Same total painted area for 1 and for 3 — the lane's darkness must not
    // read as an intensity it has no business claiming.
    const area = (fs: typeof one) => fs.reduce((n, f) => n + f.h, 0)
    expect(area(three)).toBeCloseTo(area(one), 6)
  })

  it('gives the slices disjoint vertical ranges', () => {
    const fs = bands(run([fast('cutoff'), fast('pan'), fast('gain')]))
      .slice()
      .sort((a, b) => a.y - b.y)
    for (let i = 1; i < fs.length; i++) {
      expect(fs[i].y).toBeGreaterThanOrEqual(fs[i - 1].y + fs[i - 1].h - 1e-6)
    }
  })

  it('keeps each unresolvable parameter identifiable by colour', () => {
    const styles = bands(run([fast('cutoff'), fast('pan')])).map((f) => f.style)
    expect(new Set(styles).size).toBe(2)
  })
})

/**
 * #1486 — `rand`/`perlin`/`berlin`/`brand` and the mouse signals are 120 of the
 * 313 curves this lane draws, and their stream depends on a runtime seed the
 * static IR does not carry. The drawn contour is a stand-in at the right RATE
 * and between the right BOUNDS; the path itself is invented.
 */
describe('a fabricated curve is drawn as indicative (#1486)', () => {
  const dashOf = (kind: SignalAutomation['kind']) =>
    run([auto({ kind, periodCycles: 2 })]).paths[0].dash

  it('dashes the stochastic kinds', () => {
    for (const kind of ['rand', 'rand2', 'brand', 'perlin', 'berlin'] as const) {
      expect(dashOf(kind), kind).not.toEqual([])
    }
  })

  it('dashes the live-input kinds, whose path is equally unknowable', () => {
    for (const kind of ['mousex', 'mousey', 'mouseX', 'mouseY'] as const) {
      expect(dashOf(kind), kind).not.toEqual([])
    }
  })

  it('leaves every faithful waveform SOLID', () => {
    // The control arm: if this dashed too, "dashed" would say nothing.
    for (const kind of [
      'sine', 'sine2', 'cosine', 'cosine2', 'saw', 'saw2', 'isaw', 'isaw2',
      'tri', 'tri2', 'itri', 'itri2', 'square', 'square2',
    ] as const) {
      expect(dashOf(kind), kind).toEqual([])
    }
  })

  it('leaves `time` solid — deterministic, so the drawn ramp IS the signal', () => {
    // It is unbounded, not fabricated. The two are different objections and it
    // already abstains for the other one.
    expect(dashOf('time')).toEqual([])
  })

  it('does not leave the dash set for whatever strokes next', () => {
    const m = run([auto({ kind: 'perlin', periodCycles: 2 }), auto({ kind: 'sine', periodCycles: 2 })])
    const sine = m.paths[1]
    expect(sine.dash, 'a faithful curve inherited the previous curve\'s dash').toEqual([])
  })
})
