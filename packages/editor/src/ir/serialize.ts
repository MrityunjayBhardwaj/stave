/**
 * PatternIR JSON serialization.
 *
 * Serialize PatternIR trees to/from JSON.
 * Since PatternIR is already a tagged union of plain objects, round-trip is lossless.
 *
 * The JSON envelope adds a schema version for LLM consumption and versioning.
 */

import type { PatternIR, PlayParams } from './PatternIR'
import type { SourceLocation } from './IREvent'

export const PATTERN_IR_SCHEMA_VERSION = '1.0'

interface PatternIREnvelope {
  $schema: string
  tree: PatternIR
}

/** Serialize a PatternIR tree to JSON. */
export function patternToJSON(ir: PatternIR, pretty?: boolean): string {
  const envelope: PatternIREnvelope = {
    $schema: `patternir/${PATTERN_IR_SCHEMA_VERSION}`,
    tree: ir,
  }
  return pretty ? JSON.stringify(envelope, null, 2) : JSON.stringify(envelope)
}

/** Deserialize a PatternIR tree from JSON. Throws on invalid input. */
export function patternFromJSON(json: string): PatternIR {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch (e) {
    throw new Error(`PatternIR: invalid JSON — ${String(e)}`)
  }

  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('PatternIR: expected object at root')
  }

  const envelope = parsed as Record<string, unknown>
  if (!('tree' in envelope)) {
    throw new Error('PatternIR: missing "tree" field')
  }

  return validateNode(envelope.tree, 'tree')
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const VALID_TAGS = new Set([
  'Pure', 'Seq', 'Stack', 'Play', 'Sleep', 'Choice', 'Every',
  'Cycle', 'When', 'Ramp', 'Fast', 'Slow', 'Range', 'Loop', 'Code',
  'Param', 'Track',
  // Phase 20-18 Wave A — Signal/Builder chain-ROOT family (additive).
  // Every existing entry above stays byte-UNCHANGED; these are appended
  // members of the literal Set initializer (the only buildable shape
  // since `VALID_TAGS.has(node.tag)` is the gate at line 71 — without
  // these, a deserialise of a Signal/Builder node throws "unknown tag").
  'Signal', 'Builder',
  // Phase 5a (#386) — unified time-sequence node (arrange/cat/slowcat).
  'Arrange',
])

function validateNode(raw: unknown, path: string): PatternIR {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error(`${path}: expected object, got ${typeof raw}`)
  }

  const node = raw as Record<string, unknown>

  if (typeof node.tag !== 'string') {
    throw new Error(`${path}: missing or invalid "tag" field`)
  }

  if (!VALID_TAGS.has(node.tag)) {
    throw new Error(`${path}: unknown tag "${node.tag}"`)
  }

  switch (node.tag) {
    case 'Pure':
      return { tag: 'Pure' }

    case 'Seq': {
      requireArray(node, 'children', path)
      const children = (node.children as unknown[]).map((c, i) =>
        validateNode(c, `${path}.children[${i}]`)
      )
      // #434 — carry `userMethod` + `loc` through the JSON round-trip (P33-class
      // silent-drop otherwise, same trap the Track case warns about below).
      // `userMethod: 'fastcat'` distinguishes a parsed fastcat from a
      // mini-/seq-derived Seq; dropping it would erase the combinator the
      // round-trip is meant to preserve.
      const out: PatternIR = { tag: 'Seq', children }
      if (Array.isArray(node.loc)) out.loc = node.loc as SourceLocation[]
      if (typeof node.userMethod === 'string') out.userMethod = node.userMethod
      return out
    }

    case 'Stack': {
      requireArray(node, 'tracks', path)
      const tracks = (node.tracks as unknown[]).map((t, i) =>
        validateNode(t, `${path}.tracks[${i}]`)
      )
      return { tag: 'Stack', tracks }
    }

    case 'Play': {
      requireField(node, 'note', ['string', 'number'], path)
      requireField(node, 'duration', ['number'], path)
      requireObject(node, 'params', path)
      return {
        tag: 'Play',
        note: node.note as string | number,
        duration: node.duration as number,
        params: node.params as PlayParams,
      }
    }

    case 'Sleep': {
      requireField(node, 'duration', ['number'], path)
      return { tag: 'Sleep', duration: node.duration as number }
    }

    case 'Choice': {
      requireField(node, 'p', ['number'], path)
      requireField(node, 'then', ['object'], path)
      requireField(node, 'else_', ['object'], path)
      return {
        tag: 'Choice',
        p: node.p as number,
        then: validateNode(node.then, `${path}.then`),
        else_: validateNode(node.else_, `${path}.else_`),
      }
    }

    case 'Every': {
      requireField(node, 'n', ['number'], path)
      requireField(node, 'body', ['object'], path)
      const result: Extract<PatternIR, { tag: 'Every' }> = {
        tag: 'Every',
        n: node.n as number,
        body: validateNode(node.body, `${path}.body`),
      }
      if (node.default_ !== undefined) {
        result.default_ = validateNode(node.default_, `${path}.default_`)
      }
      return result
    }

    case 'Cycle': {
      requireArray(node, 'items', path)
      const items = (node.items as unknown[]).map((item, i) =>
        validateNode(item, `${path}.items[${i}]`)
      )
      return { tag: 'Cycle', items }
    }

    case 'When': {
      requireField(node, 'gate', ['string'], path)
      requireField(node, 'body', ['object'], path)
      return {
        tag: 'When',
        gate: node.gate as string,
        body: validateNode(node.body, `${path}.body`),
      }
    }

    case 'Ramp': {
      requireField(node, 'param', ['string'], path)
      requireField(node, 'from', ['number'], path)
      requireField(node, 'to', ['number'], path)
      requireField(node, 'cycles', ['number'], path)
      requireField(node, 'body', ['object'], path)
      return {
        tag: 'Ramp',
        param: node.param as string,
        from: node.from as number,
        to: node.to as number,
        cycles: node.cycles as number,
        body: validateNode(node.body, `${path}.body`),
      }
    }

    case 'Fast': {
      requireField(node, 'factor', ['number'], path)
      requireField(node, 'body', ['object'], path)
      return {
        tag: 'Fast',
        factor: node.factor as number,
        body: validateNode(node.body, `${path}.body`),
      }
    }

    case 'Slow': {
      requireField(node, 'factor', ['number'], path)
      requireField(node, 'body', ['object'], path)
      return {
        tag: 'Slow',
        factor: node.factor as number,
        body: validateNode(node.body, `${path}.body`),
      }
    }

    case 'Range': {
      // #1481 — `rawArgs` is carried through like `Param`'s, because it is the
      // round-trip authority; dropping it here would make a serialize/deserialize
      // cycle rewrite the user's spacing.
      requireField(node, 'lo', ['number'], path)
      requireField(node, 'hi', ['number'], path)
      requireField(node, 'rawArgs', ['string'], path)
      requireField(node, 'body', ['object'], path)
      return {
        tag: 'Range',
        lo: node.lo as number,
        hi: node.hi as number,
        rawArgs: node.rawArgs as string,
        body: validateNode(node.body, `${path}.body`),
      }
    }

    case 'Loop': {
      requireField(node, 'body', ['object'], path)
      return {
        tag: 'Loop',
        body: validateNode(node.body, `${path}.body`),
      }
    }

    case 'Elongate': {
      requireField(node, 'factor', ['number'], path)
      requireField(node, 'body', ['object'], path)
      return {
        tag: 'Elongate',
        factor: node.factor as number,
        body: validateNode(node.body, `${path}.body`),
      }
    }

    case 'Param': {
      // Phase 20-10 — semantics-completeness pair-of PV37 / Trap 4 mirror.
      // Carry Param through serialize→deserialize without silently stripping
      // value/rawArgs. value is a discriminated union (string | number |
      // PatternIR); recurse via validateNode for the sub-IR branch.
      requireField(node, 'key', ['string'], path)
      requireField(node, 'rawArgs', ['string'], path)
      requireField(node, 'body', ['object'], path)
      const v = node.value
      let value: string | number | PatternIR
      if (typeof v === 'string' || typeof v === 'number') {
        value = v
      } else if (typeof v === 'object' && v !== null) {
        value = validateNode(v, `${path}.value`)
      } else {
        throw new Error(`${path}: field "value" must be string|number|object, got ${typeof v}`)
      }
      const out: PatternIR = {
        tag: 'Param',
        key: node.key as string,
        value,
        rawArgs: node.rawArgs as string,
        body: validateNode(node.body, `${path}.body`),
      }
      if (Array.isArray(node.loc)) out.loc = node.loc as SourceLocation[]
      if (typeof node.userMethod === 'string') out.userMethod = node.userMethod
      return out
    }

    case 'Track': {
      // Phase 20-11 — Track wrapper. Mirrors Param's structure (key+body) but
      // simpler — value is just trackId, no rawArgs. Serialize MUST carry
      // through round-trip (P33-class trap if omitted: silent-drop on
      // deserialize like 20-04 caught for `via` and 20-10 for Param).
      requireField(node, 'trackId', ['string'], path)
      requireField(node, 'body', ['object'], path)
      const out: PatternIR = {
        tag: 'Track',
        trackId: node.trackId as string,
        body: validateNode(node.body, `${path}.body`),
      }
      if (Array.isArray(node.loc)) out.loc = node.loc as SourceLocation[]
      if (typeof node.userMethod === 'string') out.userMethod = node.userMethod
      // #1488 — the mute flag is exactly the trap this case's own comment
      // warns about: `patternToJSON` is a plain stringify and emits it, while
      // this rebuilds the node field by field, so without this line a document
      // would lose its muting on save-and-reload and the period rule would go
      // back to folding silent tracks into the song's length. Written as
      // `=== true` so an absent flag stays absent rather than becoming `false`.
      if (node.muted === true) out.muted = true
      return out
    }

    case 'Code': {
      // Phase 20-04 T-11 (PV37 clause 4 / D-02 / Trap 4).
      // Wrapper case: carry `via` through JSON snapshot round-trip — without
      // this passthrough, serialize→deserialize would silently strip `via`,
      // breaking debugger replay and the round-trip contract. Mirror the
      // existing requireField shape; recurse into via.inner via validateNode.
      // `loc` propagation also added — wrapper carries non-trivial loc that
      // must round-trip.
      requireField(node, 'code', ['string'], path)
      const out: PatternIR = { tag: 'Code', code: node.code as string, lang: 'strudel' }
      if (node.via !== undefined && node.via !== null) {
        const via = node.via as Record<string, unknown>
        // Phase 20-17 D-1c — Code.via union has two arms:
        //   - wrapAsOpaque: {method, args, callSiteRange, inner}
        //   - literal (G3 / D-02 CORRECTION): {literal:true; raw:string}
        // Discriminate by `'literal' in via` (LEAF — no inner to recurse).
        if (via.literal === true) {
          if (typeof via.raw !== 'string') {
            throw new Error(`${path}.via: literal arm requires string "raw"`)
          }
          out.via = { literal: true, raw: via.raw as string }
        } else {
          requireField(via, 'method', ['string'], `${path}.via`)
          requireField(via, 'args', ['string'], `${path}.via`)
          if (!Array.isArray(via.callSiteRange)) {
            throw new Error(`${path}.via: field "callSiteRange" must be an array`)
          }
          if (typeof via.inner !== 'object' || via.inner === null) {
            throw new Error(`${path}.via: field "inner" must be an object`)
          }
          out.via = {
            method: via.method as string,
            args: via.args as string,
            callSiteRange: via.callSiteRange as [number, number],
            inner: validateNode(via.inner, `${path}.via.inner`),
          }
        }
      }
      if (Array.isArray(node.loc)) {
        out.loc = node.loc as SourceLocation[]
      }
      return out
    }

    // Phase 20-18 Wave A — Signal/Builder chain-ROOT family (lossless
    // round-trip). Mirrors the Param/Track pattern above: requireField
    // each primitive, recurse into the optional `body` sub-IR, restore
    // optional metadata. The `kind` literal-union is validated by TS at
    // construction-site (PatternIR.ts) — the runtime guard accepts any
    // string and trusts the consumer's narrowing (matches Param.key's
    // shape). `args` is RAW source verbatim; we DO NOT coerce / trim.
    case 'Signal': {
      requireField(node, 'kind', ['string'], path)
      const out: PatternIR = {
        tag: 'Signal',
        kind: node.kind as Extract<PatternIR, { tag: 'Signal' }>['kind'],
      }
      if (typeof node.args === 'string') {
        (out as Extract<PatternIR, { tag: 'Signal' }>).args = node.args
      }
      if (Array.isArray(node.loc)) out.loc = node.loc as SourceLocation[]
      if (typeof node.userMethod === 'string') out.userMethod = node.userMethod
      return out
    }

    case 'Builder': {
      requireField(node, 'kind', ['string'], path)
      requireField(node, 'args', ['string'], path)
      const out: PatternIR = {
        tag: 'Builder',
        kind: node.kind as Extract<PatternIR, { tag: 'Builder' }>['kind'],
        args: node.args as string,
      }
      if (typeof node.body === 'object' && node.body !== null) {
        (out as Extract<PatternIR, { tag: 'Builder' }>).body =
          validateNode(node.body, `${path}.body`)
      }
      if (Array.isArray(node.loc)) out.loc = node.loc as SourceLocation[]
      if (typeof node.userMethod === 'string') out.userMethod = node.userMethod
      return out
    }

    case 'Arrange': {
      // Phase 5a (#386) — unified time-sequence node. Validate mode + arms;
      // each arm is { weight:number, pattern:PatternIR, loc? }.
      requireField(node, 'mode', ['string'], path)
      requireArray(node, 'arms', path)
      const arms = (node.arms as unknown[]).map((a, i) => {
        if (typeof a !== 'object' || a === null) {
          throw new Error(`${path}.arms[${i}]: expected object`)
        }
        const arm = a as Record<string, unknown>
        if (typeof arm.weight !== 'number') {
          throw new Error(`${path}.arms[${i}]: field "weight" must be a number`)
        }
        const out: Extract<PatternIR, { tag: 'Arrange' }>['arms'][number] = {
          weight: arm.weight,
          pattern: validateNode(arm.pattern, `${path}.arms[${i}].pattern`),
        }
        if (Array.isArray(arm.loc)) out.loc = arm.loc as SourceLocation[]
        return out
      })
      const out: PatternIR = {
        tag: 'Arrange',
        mode: node.mode as Extract<PatternIR, { tag: 'Arrange' }>['mode'],
        arms,
      }
      if (Array.isArray(node.loc)) out.loc = node.loc as SourceLocation[]
      if (typeof node.userMethod === 'string') out.userMethod = node.userMethod
      return out
    }

    default:
      throw new Error(`${path}: unhandled tag "${node.tag}"`)
  }
}

function requireField(
  node: Record<string, unknown>,
  key: string,
  types: string[],
  path: string,
): void {
  if (!(key in node)) {
    throw new Error(`${path}: missing field "${key}"`)
  }
  if (!types.includes(typeof node[key])) {
    throw new Error(
      `${path}: field "${key}" must be ${types.join(' or ')}, got ${typeof node[key]}`
    )
  }
}

function requireArray(node: Record<string, unknown>, key: string, path: string): void {
  if (!(key in node) || !Array.isArray(node[key])) {
    throw new Error(`${path}: field "${key}" must be an array`)
  }
}

function requireObject(node: Record<string, unknown>, key: string, path: string): void {
  if (!(key in node) || typeof node[key] !== 'object' || node[key] === null || Array.isArray(node[key])) {
    throw new Error(`${path}: field "${key}" must be an object`)
  }
}
