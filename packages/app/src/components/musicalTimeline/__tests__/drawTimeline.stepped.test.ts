/**
 * The STEPPED automation staircase on a lane (#1463 Stage 2, READ ONLY).
 *
 * `steppedAutomation.test.ts` (editor) asks "did we read the document right",
 * `steppedLane.test.ts` asks "are the segments and the axis right". This file asks
 * the question neither can: did a staircase reach the canvas, at the heights the
 * axis says, over the x the ruler uses — and does a second automation class on the
 * same lane change how the FIRST one is coloured, the way a second curve already
 * does.
 *
 * ⚠ The mock records STROKED PATHS as point lists, as `drawTimeline.automation.test`
 * does. Counting `stroke()` calls could not tell a staircase from a flat line.
 */
import { describe, it, expect } from 'vitest'
import { drawTimeline, type DrawTheme, type DrawTransform } from '../drawTimeline'
import { DEFAULT_METER } from '../../../lib/meter'
import type { TimelineScene, SceneLane, SceneStepped } from '../timelineScene'
import type { SignalAutomation, SteppedAutomation } from '@stave/editor'
import { computeLaneLayout } from '../laneLayout'
import { AUTOMATION_PAD_Y } from '../automationCaption'
import { colorForAutomation } from '../colors'
import { unitOnAxis, type StepAxis } from '../steppedLane'

const THEME: DrawTheme = {
  background: '#bg', rowAlt: '#rowAlt', section: '#sect', sectionAlt: '#sectAlt',
  gridline: '#grid', clipFill: '#clipFill', clipCaption: '#cap', clipBorder: '#border',
  automationLine: '#AUTO',
}
// 4 cycles over 400px → 100px per cycle, no scroll.
const TRANSFORM: DrawTransform = { scrollLeft: 0, contentWidth: 400, viewportWidth: 400, meter: DEFAULT_METER }

interface Path { points: { x: number; y: number }[]; style: string; dash: readonly number[] }

function mockCtx() {
  const paths: Path[] = []
  let cur: { x: number; y: number }[] = []
  const ctx = {
    fillStyle: '', strokeStyle: '', globalAlpha: 1, lineWidth: 1, lineJoin: '',
    font: '', textBaseline: '', _dash: [] as readonly number[],
    setLineDash(d: readonly number[]) { ctx._dash = d },
    clearRect() {}, save() {}, restore() {}, fillRect() {},
    measureText(t: string) { return { width: t.length * 6 } as TextMetrics },
    fillText() {},
    beginPath() { cur = [] },
    moveTo(x: number, y: number) { cur.push({ x, y }) },
    lineTo(x: number, y: number) { cur.push({ x, y }) },
    stroke() { paths.push({ points: cur, style: ctx.strokeStyle, dash: ctx._dash }) },
  }
  return { ctx: ctx as unknown as CanvasRenderingContext2D, paths }
}

const SPAN = { start: 0, end: 1 }
function stepped(steps: [number, number?][], method = 'gain'): SteppedAutomation {
  let at = 0
  const built = steps.map(([value, weight = 1]) => {
    const s = { value, weight, startCycle: at, valueSpan: SPAN }
    at += weight
    return s
  })
  return { trackId: 'd1', paramKey: method, method, steps: built, periodCycles: at, offset: 0 }
}
const LINEAR: StepAxis = { lo: 0, hi: 1, scale: 'linear' }
const entry = (a: SteppedAutomation, axis: StepAxis = LINEAR): SceneStepped => ({ automation: a, axis })

const NO_SPANS = { shape: null, rate: null, range: null, chainEnd: null } as const
const signal = (paramKey: string): SignalAutomation => ({
  trackId: 'd1', paramKey, kind: 'sine', periodCycles: 1, lo: 0, hi: 1, ranged: true, offset: 0, spans: NO_SPANS,
})

const lane = (stepped: readonly SceneStepped[], automations: readonly SignalAutomation[] = []): SceneLane => ({
  laneKey: 'd1', displayName: 'd1', color: '#7af', density: [1, 1, 1, 1],
  notes: [], pitchMin: null, pitchMax: null, voices: [], clips: [],
  sourceOffset: null, arrangeOffset: null, labelOffset: null, automations, stepped,
})

function run(stepped: readonly SceneStepped[], automations: readonly SignalAutomation[] = [], rowH = 40) {
  const m = mockCtx()
  const scene: TimelineScene = {
    lanes: [lane(stepped, automations)], sections: [], displayCycles: 4,
    windowOriginCycles: 0, period: null, peakDensity: 1, notesCapped: false,
  }
  const layout = computeLaneLayout(scene.lanes, new Set<string>(), rowH, 90, 20)
  drawTimeline(m.ctx, scene, TRANSFORM, THEME, layout)
  const box = layout.boxes[0]
  const yOf = (value: number, axis: StepAxis = LINEAR) =>
    box.top + AUTOMATION_PAD_Y + (1 - unitOnAxis(value, axis)) * (box.height - AUTOMATION_PAD_Y * 2)
  return { ...m, yOf }
}

/** The flat runs of a staircase path: consecutive point pairs sharing a y. */
function runs(p: Path): [x0: number, x1: number, y: number][] {
  const out: [number, number, number][] = []
  for (let i = 0; i + 1 < p.points.length; i++) {
    const a = p.points[i]
    const b = p.points[i + 1]
    if (a.y === b.y && b.x > a.x) out.push([a.x, b.x, a.y])
  }
  return out
}

describe('stepped staircase — presence', () => {
  it('draws nothing when the lane has no stepped automation', () => {
    expect(run([]).paths).toHaveLength(0)
  })

  it('draws one path per stepped automation', () => {
    expect(run([entry(stepped([[0.2], [0.8]]))]).paths).toHaveLength(1)
    expect(run([entry(stepped([[0.2], [0.8]])), entry(stepped([[0.5], [0.1]], 'room'))]).paths).toHaveLength(2)
  })

  it('draws nothing in a band too short to read a level in', () => {
    // The same floor the continuous curve abstains at — one constant, two readers.
    expect(run([entry(stepped([[0.2], [0.8]]))], [], 12).paths).toHaveLength(0)
  })
})

describe('stepped staircase — geometry', () => {
  it('holds each step flat for its cycle, at the height the axis gives it', () => {
    const { paths, yOf } = run([entry(stepped([[0.2], [0.8]]))])
    expect(runs(paths[0])).toEqual([
      [0, 100, yOf(0.2)],
      [100, 200, yOf(0.8)],
      [200, 300, yOf(0.2)],
      [300, 400, yOf(0.8)],
    ])
    // Screen y grows downward: the larger value is drawn HIGHER.
    expect(yOf(0.8)).toBeLessThan(yOf(0.2))
  })

  it('joins consecutive steps with a riser, so it reads as one line', () => {
    const { paths } = run([entry(stepped([[0.2], [0.8]]))])
    const pts = paths[0].points
    // Every flat run ends at the x the next one starts at.
    for (let i = 1; i + 1 < pts.length; i += 2) expect(pts[i].x).toBe(pts[i + 1].x)
  })

  it('a weighted step is one flat run across its weight', () => {
    const { paths, yOf } = run([entry(stepped([[0.2, 2], [0.8]]))])
    expect(runs(paths[0])).toEqual([
      [0, 200, yOf(0.2)],
      [200, 300, yOf(0.8)],
      [300, 400, yOf(0.2)],
    ])
  })

  it('places a frequency control on its log axis', () => {
    const axis: StepAxis = { lo: 20, hi: 20000, scale: 'log' }
    const { paths, yOf } = run([entry(stepped([[200], [2000]], 'cutoff'), axis)])
    const [[, , y0], [, , y1]] = runs(paths[0])
    expect(y0).toBeCloseTo(yOf(200, axis), 6)
    expect(y1).toBeCloseTo(yOf(2000, axis), 6)
  })

  it('is solid — a stepped value is the literal value, not an indication', () => {
    expect(run([entry(stepped([[0.2], [0.8]]))]).paths[0].dash).toEqual([])
  })
})

describe('stepped staircase — colour follows the SAME rule as the curves', () => {
  it('a lone stepped automation takes the theme colour', () => {
    expect(run([entry(stepped([[0.2], [0.8]]))]).paths[0].style).toBe('#AUTO')
  })

  // The arm that makes the two classes one vocabulary. Counted apart, a lane with
  // one curve and one staircase would draw BOTH in the theme colour — two
  // identical lines with nothing tying either to its parameter.
  it('a staircase beside a curve puts BOTH in their parameter colours', () => {
    const { paths } = run([entry(stepped([[0.2], [0.8]], 'velocity'))], [signal('cutoff')])
    const styles = new Set(paths.map((p) => p.style))
    expect(styles).toEqual(new Set([colorForAutomation('velocity'), colorForAutomation('cutoff')]))
    expect(styles.has('#AUTO')).toBe(false)
  })
})
