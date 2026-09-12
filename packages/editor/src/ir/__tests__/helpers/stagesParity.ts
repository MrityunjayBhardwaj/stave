/**
 * stagesParity — the ONE comparison routine behind every staged-pipeline
 * parity claim (#1375).
 *
 * `parseStrudelStages.ts:6` promises that the 4-stage pipeline's FINAL output
 * is byte-identical to `parseStrudel(code)`. Two tests assert that promise: the
 * 13-fixture D-06 sentinel (`parseStrudelStages.test.ts`) and the corpus sweep
 * (`stagesParityCorpus.test.ts`). Both import from here.
 *
 * ── WHY EXTRACTED, and not copied into the sweep ─────────────────────────────
 * `stripStageMeta` and `pipeline` were local to the D-06 test. The defect this
 * module exists to measure IS a parallel reimplementation kept in sync by hand
 * — the staged pipeline against `parseStrudel`. Answering it with a second
 * hand-kept copy of the comparison would reproduce the bug inside its own gate:
 * the sweep could drift from the sentinel and each would still be green. One
 * definition, two importers.
 */
import { parseStrudel } from '../../parseStrudel'
import { IR, type PatternIR } from '../../PatternIR'
import {
  runRawStage,
  runMiniExpandedStage,
  runChainAppliedStage,
  runFinalStage,
} from '../../parseStrudelStages'
import type { Pass } from '../../passes'
import { runPasses } from '../../passes'
import { unwrapD1 } from './unwrapD1'

export const PASSES: readonly Pass<PatternIR>[] = [
  { name: 'RAW',           run: runRawStage           },
  { name: 'MINI-EXPANDED', run: runMiniExpandedStage  },
  { name: 'CHAIN-APPLIED', run: runChainAppliedStage  },
  { name: 'Parsed',        run: runFinalStage         },
]

/** The 4-stage pipeline, returning the FINAL stage's IR unchanged. */
export function pipeline(code: string): PatternIR {
  const seed = IR.code(code)
  const passes = runPasses(seed, PASSES)
  return passes[passes.length - 1].ir
}

/**
 * Strip stage-transition metadata so the two sides are comparable.
 *
 * The staged pipeline threads `unresolvedChain`/`chainOffset` (chain deferral)
 * and `dollarStart`/`dollarEnd`/`trackLabel` (#671 track-loc + label) between
 * stages. `parseStrudel` never emits them, so they are removed before any
 * equality check. `assertNoStageMeta` separately proves they are ABSENT from
 * CHAIN-APPLIED and FINAL — this strip is for the intermediate comparison and
 * must not be read as tolerating them at the end.
 */
export function stripStageMeta(node: PatternIR): PatternIR {
  const rec = node as Record<string, unknown>
  const cloned: Record<string, unknown> = {}
  for (const k of Object.keys(rec)) {
    if (
      k === 'unresolvedChain' ||
      k === 'chainOffset' ||
      k === 'dollarStart' ||
      k === 'dollarEnd' ||
      k === 'trackLabel'
    ) {
      continue
    }
    cloned[k] = rec[k]
  }
  switch (node.tag) {
    case 'Seq':
      cloned.children = node.children.map(stripStageMeta)
      break
    case 'Stack':
      cloned.tracks = node.tracks.map(stripStageMeta)
      break
    case 'Cycle':
      cloned.items = node.items.map(stripStageMeta)
      break
    case 'Choice':
      cloned.then = stripStageMeta(node.then)
      cloned.else_ = stripStageMeta(node.else_)
      break
    case 'Every':
      cloned.body = stripStageMeta(node.body)
      if (node.default_) cloned.default_ = stripStageMeta(node.default_)
      break
    case 'When':
    case 'Ramp':
    case 'Fast':
    case 'Slow':
    case 'Elongate':
    case 'Late':
    case 'Degrade':
    case 'Ply':
    case 'Struct':
    case 'Swing':
    case 'Shuffle':
    case 'Scramble':
    case 'Chop':
    case 'Loop':
      cloned.body = stripStageMeta(node.body)
      break
    case 'Param':
      cloned.body = stripStageMeta(node.body)
      if (typeof node.value === 'object' && node.value !== null) {
        cloned.value = stripStageMeta(node.value as PatternIR)
      }
      break
    case 'Track':
      cloned.body = stripStageMeta(node.body)
      break
    case 'Chunk':
      cloned.transform = stripStageMeta(node.transform)
      cloned.body = stripStageMeta(node.body)
      break
    case 'Pick':
      cloned.selector = stripStageMeta(node.selector)
      cloned.lookup = node.lookup.map(stripStageMeta)
      break
    default:
      break
  }
  return cloned as PatternIR
}

// ---------------------------------------------------------------------------
// Shape descriptors + the parity verdict
// ---------------------------------------------------------------------------

/** Child IR nodes of a node, tag by tag. Mirrors `stripStageMeta`'s walk. */
function childrenOf(n: PatternIR): PatternIR[] {
  switch (n.tag) {
    case 'Seq':   return n.children
    case 'Stack': return n.tracks
    case 'Cycle': return n.items
    case 'Choice': return [n.then, n.else_]
    case 'Every': return n.default_ ? [n.body, n.default_] : [n.body]
    case 'When': case 'Ramp': case 'Fast': case 'Slow': case 'Elongate':
    case 'Late': case 'Degrade': case 'Ply': case 'Struct': case 'Swing':
    case 'Shuffle': case 'Scramble': case 'Chop': case 'Loop': case 'Track':
      return [n.body]
    case 'Param':
      return typeof n.value === 'object' && n.value !== null
        ? [n.body, n.value as PatternIR]
        : [n.body]
    case 'Chunk': return [n.transform, n.body]
    case 'Pick':  return [n.selector, ...n.lookup]
    default:      return []
  }
}

/**
 * A compact, depth-bounded structural signature — `Track→[Stack→[Play,Play]]`.
 *
 * Bounded because the baseline is READ by a human deciding whether a movement
 * is a fix or a regression. An unbounded dump of a 200-node tree is not read,
 * and a pin nobody reads is a pin that gets re-baselined blind.
 */
export function shapeOf(n: PatternIR, maxDepth = 3, maxBreadth = Infinity): string {
  if (maxDepth <= 0) return '…'
  const kids = childrenOf(n)
  if (kids.length === 0) return n.tag
  const shown = kids.slice(0, maxBreadth).map((k) => shapeOf(k, maxDepth - 1, maxBreadth))
  const hidden = kids.length - shown.length
  return `${n.tag}→[${shown.join(',')}${hidden > 0 ? `,+${hidden}` : ''}]`
}

/**
 * The rendering written into the baseline. Bounded in BOTH directions, because
 * one corpus document has 100 sibling tracks and an unbounded row is a pin
 * nobody reads.
 *
 * ⚠ Display only. `shapeMatch` must compare UNBOUNDED shapes — comparing
 * truncated strings would call two genuinely different trees equal wherever
 * they agree down to the cut, deflating the very count this file exists to
 * hold steady.
 */
export function displayShape(n: PatternIR): string {
  return shapeOf(n, 3, 6)
}

/**
 * Deep structural equality with `toEqual` semantics — a key present with value
 * `undefined` equals a key that is absent, and key ORDER is irrelevant.
 *
 * Hand-written rather than `JSON.stringify`-compared: `stripStageMeta` rebuilds
 * each node by iterating that side's own `Object.keys`, so the two sides can
 * carry identical content in different key order. A stringify comparison would
 * report those as divergent and inflate the count with pure noise.
 */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false
    return a.every((x, i) => deepEqual(x, b[i]))
  }
  const ra = a as Record<string, unknown>
  const rb = b as Record<string, unknown>
  const keys = new Set([...Object.keys(ra), ...Object.keys(rb)])
  for (const k of keys) {
    if (ra[k] === undefined && rb[k] === undefined) continue
    if (!deepEqual(ra[k], rb[k])) return false
  }
  return true
}

/**
 * The per-document row the corpus baseline pins — TWO verdicts, deliberately.
 *
 * `match` is the contract: deep equality, the same question the D-06 sentinel
 * asks with `toEqual`. `shapeMatch` is the weaker structural question — do the
 * two sides agree on the TREE, ignoring payload detail like offsets and params.
 *
 * They are different numbers and both are worth pinning. A document that agrees
 * structurally but not deeply is a real breach of the stated contract, yet it
 * hands the four downstream consumers the right SHAPE; one that disagrees
 * structurally hands them the wrong tree. The second class is what silently
 * broke #113, #671 and #1373. Recording only one number loses that distinction —
 * and #1375's original figure of 17 was the shape number, quoted against a
 * contract that says byte-identical.
 */
export interface ParityRow {
  /** Deep equality — THE contract (`parseStrudelStages.ts:6`). */
  match: boolean
  /** Structural agreement only — the weaker, downstream-facing question. */
  shapeMatch: boolean
  /**
   * Weakest of the three: do the two sides agree on the top-level tag INSIDE
   * the `Track('d1', …)` wrapper. This is the measure #1375's body quotes.
   * A document whose structure is wrong three levels down still passes it.
   */
  tagMatch: boolean
  /** Present only when they differ — `parseStrudel`'s shape. */
  direct?: string
  /** Present only when they differ — the pipeline's FINAL shape. */
  staged?: string
  /** Present only when they differ — the measured mechanism (step 1). */
  cls?: string
  /** Present only when they differ — where in the tree they first disagree. */
  at?: string
}

/**
 * Render the actionable half of a divergence row — the part the corpus gate's
 * enumeration used to drop on the floor (#1525).
 *
 * ⚠ `displayShape` CANNOT RENDER EVERY DIVERGENCE CLASS, AND WAS SILENTLY THE
 * WRONG RENDERER FOR ONE OF THEM. `C-via-vs-blob` is by definition a difference
 * that shape does not show: both sides are a `Code` node, and they differ in
 * whether `via` carries the parsed chain or the node is the parse's give-up
 * fallback. So the gate printed
 *
 *     250/1qReIiYTCTb-  Track→[Code]  !=  Track→[Code]
 *
 * — two identical strings joined by `!=`. A reader's first conclusion is that
 * the instrument is broken, not that a document regressed.
 *
 * ⚠⚠ AND THAT IS THE ONE CLASS A REAL REGRESSION REFILLS. It is pinned at 0, so
 * the uninformative rendering was reserved for precisely the case that has to be
 * read on sight, by someone who did not write it, on the day it goes red.
 *
 * `cls` and `at` were already measured by `parityRow` and already on the row.
 * This is a formatting change, not new measurement — which is why it can be
 * unit-tested off a plain object.
 */
export function divergenceDetail(r: ParityRow): string {
  const bits = [r.cls, r.at ? `at ${r.at}` : ''].filter(Boolean)
  return bits.length ? `  (${bits.join(' ')})` : ''
}

/**
 * The ⚠ line, emitted ONLY when the two rendered shapes are byte-equal.
 *
 * Kept separate from `divergenceDetail` because the caller decides where it
 * goes: the detail belongs beside the shapes (inside the `(was …)` parens on a
 * FIXED row), the warning belongs on its own line after them. Composing them
 * into one string put a two-line warning inside a parenthesis.
 *
 * ⚠ Emitted only for the shapes-equal case on purpose. A warning printed on
 * every row trains the reader to skip it, and this is the line that must not be
 * skipped.
 */
export function shapesEqualWarning(r: ParityRow): string {
  return r.direct !== undefined && r.direct === r.staged
    ? `\n      ⚠ SHAPES RENDER EQUAL — the difference is NOT structural, so the two` +
      `\n        sides above are meant to look identical. Read the class in brackets.`
    : ''
}

/**
 * Compare one document. Throwing is NOT a match: a document that makes either
 * side throw is recorded as a divergence carrying the error, so it can never
 * shrink the denominator silently.
 */
export function parityRow(code: string): ParityRow {
  let direct: PatternIR
  let staged: PatternIR
  try {
    direct = stripStageMeta(parseStrudel(code))
  } catch (e) {
    return { match: false, shapeMatch: false, tagMatch: false, direct: `THREW: ${(e as Error).message.slice(0, 80)}`, staged: '—' }
  }
  try {
    staged = stripStageMeta(pipeline(code))
  } catch (e) {
    return { match: false, shapeMatch: false, tagMatch: false, direct: displayShape(direct), staged: `THREW: ${(e as Error).message.slice(0, 80)}` }
  }
  // Full depth for the structural question — a bounded shape would call two
  // trees equal because they agree down to the cut, which is a false negative
  // in the direction that hides defects.
  const shapeMatch = shapeOf(direct, Infinity) === shapeOf(staged, Infinity)
  const tagMatch = unwrapD1(direct).tag === unwrapD1(staged).tag
  if (deepEqual(direct, staged)) return { match: true, shapeMatch, tagMatch }
  const d = firstDivergence(direct, staged)
  return {
    match: false, shapeMatch, tagMatch,
    direct: displayShape(direct), staged: displayShape(staged),
    cls: classifyDivergence(d),
    at: 'path' in d ? d.path : '',
  }
}

// ---------------------------------------------------------------------------
// Divergence classification (#1375 step 1)
// ---------------------------------------------------------------------------

/** Named child slots, so a divergence can be reported at a readable path. */
function childSlots(n: PatternIR): [string, PatternIR][] {
  const N = n as unknown as Record<string, unknown>
  switch (n.tag) {
    case 'Seq':   return n.children.map((c, i) => [`children[${i}]`, c])
    case 'Stack': return n.tracks.map((c, i) => [`tracks[${i}]`, c])
    case 'Cycle': return n.items.map((c, i) => [`items[${i}]`, c])
    case 'Choice': return [['then', n.then], ['else_', n.else_]]
    case 'Every': return n.default_ ? [['body', n.body], ['default_', n.default_]] : [['body', n.body]]
    case 'When': case 'Ramp': case 'Fast': case 'Slow': case 'Elongate':
    case 'Late': case 'Degrade': case 'Ply': case 'Struct': case 'Swing':
    case 'Shuffle': case 'Scramble': case 'Chop': case 'Loop': case 'Track':
      return [['body', n.body]]
    case 'Param':
      return typeof N.value === 'object' && N.value !== null
        ? [['body', n.body], ['value', N.value as PatternIR]]
        : [['body', n.body]]
    case 'Chunk': return [['transform', n.transform], ['body', n.body]]
    case 'Pick':  return [['selector', n.selector], ...n.lookup.map((c, i) => [`lookup[${i}]`, c] as [string, PatternIR])]
    default: return []
  }
}

export type DivergenceKind =
  | { kind: 'none' }
  | { kind: 'tag'; path: string; a: string; b: string }
  | { kind: 'arity'; path: string; a: number; b: number }
  | { kind: 'field'; path: string; fields: string[] }

/**
 * The FIRST point at which the two trees disagree, depth-first, scalar fields
 * before children.
 *
 * Reports EVERY differing field at that node, not just one. Reporting only the
 * first understated this badly: the 16 documents in class C differ in
 * `code` AND `loc` AND `via` at once, and seeing only `code` made them look
 * like cosmetic text noise when they are nothing of the kind.
 */
export function firstDivergence(a: PatternIR, b: PatternIR, path = '$'): DivergenceKind {
  if (a.tag !== b.tag) return { kind: 'tag', path, a: a.tag, b: b.tag }
  const ra = a as unknown as Record<string, unknown>
  const rb = b as unknown as Record<string, unknown>
  const kidsA = childSlots(a)
  const kidsB = childSlots(b)
  const childKeys = new Set([...kidsA, ...kidsB].map(([k]) => k.replace(/\[\d+\]$/, '')))
  const fields: string[] = []
  for (const k of new Set([...Object.keys(ra), ...Object.keys(rb)])) {
    if (k === 'tag' || childKeys.has(k)) continue
    if (ra[k] === undefined && rb[k] === undefined) continue
    if (!deepEqual(ra[k], rb[k])) fields.push(k)
  }
  if (fields.length > 0) return { kind: 'field', path, fields: fields.sort() }
  if (kidsA.length !== kidsB.length) return { kind: 'arity', path, a: kidsA.length, b: kidsB.length }
  for (let i = 0; i < kidsA.length; i++) {
    const d = firstDivergence(kidsA[i][1], kidsB[i][1], `${path}.${kidsA[i][0]}`)
    if (d.kind !== 'none') return d
  }
  return { kind: 'none' }
}

/**
 * The four mechanisms behind the 44, measured (#1375 step 1) — NOT guessed.
 *
 *   A-opaque-collapse   the pipeline replaces a real subtree with opaque `Code`
 *   B-track-count       the two sides disagree on how many tracks exist, at the root
 *   C-via-vs-blob       both emit `Code`, but one carries a structured `via` + a
 *                       narrow `loc` and the other carries raw text
 *   D-metadata          `loc`/`trackId` only
 *
 * ⚠ C is the one to distrust most. Those documents AGREE on shape, so the
 * structural check calls them identical — while `0/-1j62z5xjyCN`'s direct node
 * describes a 9-character span and its staged node describes all 1912. A
 * structural comparison cannot see a 200x difference in what a node covers.
 */
export function classifyDivergence(d: DivergenceKind): string {
  switch (d.kind) {
    case 'none':  return ''
    case 'arity': return 'B-track-count'
    case 'tag':   return d.b === 'Code' ? 'A-opaque-collapse'
                       : d.a === 'Code' ? 'A-opaque-collapse-inverted'
                       : 'B-track-count'
    case 'field': return d.fields.includes('via') ? 'C-via-vs-blob' : 'D-metadata'
  }
}
