/**
 * Stepped automation a track declares, read off the static IR (#1463 Stage 1).
 *
 * `.gain("<0.2 0.8>")` is a parameter that holds one value per cycle and moves
 * between them — the stepped class, next to #1464's continuous one. It already
 * parses completely: `Param{value: Cycle{items: [Play "0.2", Play "0.8"]}}`, with
 * an exact source span on every step. This module turns that into what a lane
 * needs to DRAW it, and into the one edit a lane may make to it.
 *
 * WHAT THE ENGINE DOES WITH IT, measured through the real evaluator before any of
 * this was written (#1463, the grounding comment on the issue):
 *
 *   `<a b>`        cycle n plays step (n mod 2)          → period 2
 *   `<a@2 b>`      a weighted step spans 2 cycles         → period 3
 *   `<a [b c]>`    the second step SUBDIVIDES its cycle   → not stepped
 *   `<a ~ b>`      the `~` step SILENCES THE TRACK        → not "no value"
 *   inside an `arrange` arm, the step is still chosen by the ABSOLUTE cycle
 *
 * ⚠ THE LAST LINE IS WHY A STEP IS ADDRESSED BY ITS INDEX, NOT BY A BAR. Step k
 * plays in every cycle where `cycle mod period` selects it, so an edit to step k
 * changes every bar that plays it — which is what the document says. A lane that
 * pretended to change one bar would be describing a document nobody wrote.
 *
 * Mirrors `signalAutomation.ts`: pure and structural, no eval, no source
 * scanning, the same per-track attribution, and the same direction of error —
 * ABSTAIN rather than approximate. A missing lane shows less than it could; a
 * wrong one is the editor lying about what plays.
 */
import type { PatternIR } from './PatternIR'
import type { SourceLocation } from './IREvent'

/** One step of a stepped parameter. */
export interface SteppedStep {
  /** The value this step holds, as a number. */
  readonly value: number
  /** How many cycles the step holds for — `@n`, else 1. A positive integer. */
  readonly weight: number
  /** The cycle, within one period, at which this step begins. */
  readonly startCycle: number
  /** Where the number is spelled — the whole of what a value edit replaces. */
  readonly valueSpan: SourceLocation
}

/** One drawable, editable stepped automation. */
export interface SteppedAutomation {
  /** The lane this belongs to — the same `trackId` `signalAutomations` keys on. */
  readonly trackId: string
  /** The CANONICAL control: `.lpf(...)` reads as `cutoff`, as the engine names it. */
  readonly paramKey: string
  /** The method as the user TYPED it (`lpf`), for anything that shows a name. */
  readonly method: string
  readonly steps: readonly SteppedStep[]
  /** The sum of the weights — the cycles one full pass of the steps spans. */
  readonly periodCycles: number
  /** Source offset of the `Param` call site, or null. */
  readonly offset: number | null
}

const NUMBER = /^-?(?:\d+\.?\d*|\.\d+)$/

/**
 * Read one `Param`'s value as steps, or decline.
 *
 * ⚠ ALL THREE QUOTES ARE STEPPED, and that was checked rather than assumed. The
 * transpiler turns double-quoted and backtick strings into mini calls; a
 * SINGLE-quoted one reaches `reify` as a plain string, and the engine's
 * `installMiniStringParser` then pattern-parses it when it is valid notation
 * (`engine/stringParser.ts`). So `.gain('<0.2 0.8>')` plays steps too — pinned by
 * `steppedAutomation.engine.test.ts` against the real transpiler, not by this
 * comment.
 *
 * ⚠ WHAT IS REQUIRED IS THAT THE ARGUMENT IS ONE STRING LITERAL AND NOTHING ELSE —
 * `rawArgs` opens and closes on the same quote. The parser reads the first
 * literal of `.gain("<0.2 0.8>" + "")` as the same `Cycle` it reads for the plain
 * spelling, but the transpiler turns each quoted string into a pattern before the
 * `+` runs, so the engine never plays those steps (engine test). A second
 * argument (`"<…>", 1`) is declined too: it plays, but it is not an argument a
 * lane can own.
 */
function readSteps(param: PatternIR & { tag: 'Param' }): SteppedStep[] | null {
  const value = param.value
  if (!value || typeof value !== 'object' || value.tag !== 'Cycle') return null
  const raw = param.rawArgs.trim()
  const quote = raw[0]
  // ONE literal: the next quote after the opening one is the LAST character.
  // Opening and closing on the same quote is not enough — `"<0.2 0.8>" + ""` does
  // both, and the first spelling of this check (first char === last char) passed
  // it. This single clause also refuses a second argument and an unterminated
  // literal, so there is no separate "ends with a quote" branch left for no arm to
  // defend (a break of that branch alone turned nothing red).
  if ((quote !== '"' && quote !== '`' && quote !== "'") || raw.indexOf(quote, 1) !== raw.length - 1) {
    return null
  }

  const steps: SteppedStep[] = []
  let at = 0
  for (const item of value.items) {
    let weight = 1
    let body: PatternIR = item
    if (item.tag === 'Elongate') {
      // A fractional weight has no whole-cycle start, and the per-cycle reading
      // this lane exists to draw would have to invent one.
      if (!Number.isInteger(item.factor) || item.factor < 1) return null
      weight = item.factor
      body = item.body
    }
    // `~` silences the track and `[a b]` subdivides the cycle: neither is a
    // value held for a cycle, so the whole parameter declines rather than a lane
    // drawing a step the engine does not play.
    //
    // ⚠ This line NARROWS; the numeric test below is what DECLINES. A `Sleep` or
    // `Seq` carries no numeric `note`, so the number check refuses both on its
    // own — measured by breaking this line, which turned no arm red. It stays
    // because without it `.note`/`.loc` are not known to exist on `body`.
    if (body.tag !== 'Play') return null
    const text = String(body.note)
    if (!NUMBER.test(text)) return null
    const span = body.loc?.[0]
    if (!span || !Number.isFinite(span.start) || !Number.isFinite(span.end)) return null
    steps.push({ value: Number(text), weight, startCycle: at, valueSpan: span })
    at += weight
  }
  return steps.length > 0 ? steps : null
}

const SKIP_KEYS: ReadonlySet<string> = new Set(['loc', 'keyLoc', 'callSiteRange'])

/** Every child IR node of `node`, found by reflection — the walk
 *  `signalAutomation.ts` uses, and its note says why reflection. */
function childNodes(node: PatternIR): PatternIR[] {
  const out: PatternIR[] = []
  const visit = (value: unknown, depth: number): void => {
    if (!value || typeof value !== 'object' || depth > 12) return
    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1)
      return
    }
    if (typeof (value as PatternIR).tag === 'string') {
      out.push(value as PatternIR)
      return
    }
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (SKIP_KEYS.has(key)) continue
      visit(child, depth + 1)
    }
  }
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (SKIP_KEYS.has(key)) continue
    visit(value, 0)
  }
  return out
}

/**
 * Collect one track's stepped automations.
 *
 * ⚠ `overridden` IS THE LOAD-BEARING ARGUMENT. Strudel's controls SET a value, so
 * the last call in a chain wins: `.gain("<0.2 0.8>").gain(0.5)` plays 0.5 on every
 * event (measured). In the IR the later call is the OUTER node, so a stepped
 * parameter is dead exactly when a same-key `Param` encloses it. That holds
 * through structure too — `stack(a.gain("<…>"), b).gain(0.5)` overrides the inner
 * steps (measured, engine test). Drawing them would show steps nobody hears, and
 * editing them would change nothing, silently. Keys are canonical, so `.cutoff`
 * over `.lpf` counts too.
 *
 * Every descendant of a Param inherits its key, not only its `body`. Only a
 * Param's VALUE could hold a Param the other way, and no document spells a
 * same-key stepped control inside another control's argument — a distinction no
 * input can exercise is a branch no test can defend, so it is not drawn.
 */
function collect(
  trackId: string,
  node: PatternIR,
  overridden: ReadonlySet<string>,
  out: SteppedAutomation[],
  seen: Set<PatternIR>,
): void {
  if (!node || typeof node !== 'object' || seen.has(node)) return
  seen.add(node)

  let passDown = overridden
  if (node.tag === 'Param') {
    if (!overridden.has(node.key)) {
      const steps = readSteps(node)
      if (steps) {
        const start = node.loc?.[0]?.start
        out.push({
          trackId,
          paramKey: node.key,
          method: node.userMethod ?? node.key,
          steps,
          periodCycles: steps.reduce((sum, s) => sum + s.weight, 0),
          offset: typeof start === 'number' && Number.isFinite(start) ? start : null,
        })
      }
    }
    passDown = new Set(overridden).add(node.key)
  }

  for (const child of childNodes(node)) {
    // A nested Track declares its own lane; its parameters are not this one's.
    if (child.tag === 'Track') continue
    collect(trackId, child, passDown, out, seen)
  }
}

/**
 * Every stepped automation the document declares, by track, in the order the
 * walk meets them. Empty for a document with none, which is most of them.
 */
export function steppedAutomations(ir: PatternIR | null | undefined): readonly SteppedAutomation[] {
  if (!ir) return []
  const roots: readonly PatternIR[] = ir.tag === 'Stack' ? ir.tracks : [ir]
  const out: SteppedAutomation[] = []
  for (const node of roots) {
    if (node?.tag !== 'Track') continue
    const id = node.trackId
    if (typeof id !== 'string' || id.length === 0) continue
    collect(id, node, new Set(), out, new Set())
  }
  return out
}

/**
 * Which step plays in `cycle` — the same selection the engine makes: the
 * position within the period, matched against each step's weighted start.
 * Negative cycles wrap like positive ones.
 */
export function stepIndexAtCycle(a: SteppedAutomation, cycle: number): number {
  const period = a.periodCycles
  const pos = ((Math.floor(cycle) % period) + period) % period
  for (let k = a.steps.length - 1; k >= 0; k--) {
    if (pos >= a.steps[k].startCycle) return k
  }
  return 0
}

/**
 * Turn "step `index` should hold `value`" into a source edit, or into NOTHING.
 *
 * Replaces that step's number and no other byte — its `@n`, its neighbours and
 * the user's spelling of every untouched step all survive. Returns null for an
 * index out of range, a non-finite value, or a value the step already holds
 * (compared as numbers, so `0.30` over `0.3` is no edit rather than a rewrite).
 *
 * ⚠ `String(value)`, not a formatter — the same reason `captionEdit` gives: there
 * is no arithmetic here to produce float noise, and a rounding formatter would
 * write a different number than the one asked for.
 */
export function stepValueEdit(
  a: SteppedAutomation,
  index: number,
  value: number,
): { range: [number, number]; text: string } | null {
  const step = a.steps[index]
  if (!step || !Number.isFinite(value) || value === step.value) return null
  return { range: [step.valueSpan.start, step.valueSpan.end], text: String(value) }
}
