/**
 * IR Inspector chrome — pure helpers for summarize() / children().
 *
 * Extracted from IRInspectorPanel.tsx so unit tests can import them
 * without pulling in the full panel + transitive `gifenc` (CommonJS)
 * dependency chain. The panel re-exports both for back-compat.
 *
 * Phase 20-04 (PV37 / D-05): wrapper-aware summarize + children honour
 * Code-with-via in the developer audience (PV35).
 */

import type { PatternIR } from '../../../editor/src/ir/PatternIR'

function round(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(3)
}

export function summarize(node: PatternIR): string {
  switch (node.tag) {
    case 'Pure':   return '()'
    case 'Play':   return `${JSON.stringify(node.note)} dur=${round(node.duration)}`
    case 'Sleep':  return `dur=${round(node.duration)}`
    case 'Seq':    return `${node.children.length} children`
    case 'Stack':  return `${node.tracks.length} tracks`
    case 'Cycle':  return `${node.items.length} items`
    case 'Choice': return `p=${node.p}`
    case 'Every':  return `n=${node.n}`
    case 'When':   return `gate=${node.gate}`
    case 'Ramp':   return `${node.param} ${node.from}→${node.to} over ${node.cycles}c`
    case 'Fast':
    case 'Slow':
    case 'Elongate':
      return `factor=${node.factor}`
    case 'Late':    return `offset=${node.offset}`
    case 'Degrade': return `p=${node.p}`
    case 'Chunk':   return `n=${node.n}`
    case 'Ply':     return `n=${node.n}`
    case 'Struct':   return `mask="${node.mask}"`
    case 'Swing':    return `n=${node.n}`
    case 'Pick':     return `${node.lookup.length} entries`
    // #463 / #475 — named/object pick family. Developer chrome shows the
    // combinator + the named keys so the structure is visible at a glance.
    case 'NamedPick': return `${node.method} {${node.entries.map((e) => e.key).join(', ')}}`
    case 'Shuffle':  return `n=${node.n}`
    case 'Scramble': return `n=${node.n}`
    case 'Chop':     return `n=${node.n}`
    // #1352 — the count is what defines the slice boundaries, so it is the
    // summary. An array count is shown as its split points.
    case 'Slice':    return Array.isArray(node.n) ? `at ${node.n.join(', ')}` : `n=${node.n}`
    case 'Loop':   return ''
    case 'Code':
      // Phase 20-04 T-12 / D-05 / PV35 (developer chrome) + 20-17 D-1c.
      // Discriminate Code.via union:
      //   - wrapAsOpaque arm: render full call-site detail —
      //     "[opaque: .release(0.3)]" (unchanged developer-chrome behaviour).
      //   - literal arm ({literal:true;raw}): render as `[literal: <raw>]`
      //     so the developer sees the substituted source verbatim.
      //   - no via (parse-failure leaf): render the source code as before.
      if (node.via) {
        if ('literal' in node.via) return `[literal: ${node.via.raw}]`
        return `[opaque: .${node.via.method}(${node.via.args})]`
      }
      return JSON.stringify(node.code).slice(0, 60)
    case 'Param': {
      // Phase 20-10 wave β-2 (developer chrome / PV35 / D-05).
      //
      // Three branches matching Param.value's union type:
      //   - string → key="value"   (JSON.stringify quotes the literal)
      //   - number → key=value     (no quotes; matches Strudel numeric arg)
      //   - PatternIR sub-IR → key=[pattern]   (sub-IR rendered as a child;
      //                                          children() returns it so
      //                                          the developer can drill in)
      //
      // Mirrors the Code-with-via summarize convention above (key first,
      // typed shape second). The musician-side label is short-circuited
      // by irProjection.ts:59-61 to userMethod (e.g. 's', 'gain') — see
      // RESEARCH G5.2; PV32 vocabulary regression remains unviolated.
      const v = node.value
      if (typeof v === 'string') return `${node.key}=${JSON.stringify(v)}`
      if (typeof v === 'number') return `${node.key}=${v}`
      return `${node.key}=[pattern]`
    }
    case 'Track':
      // Phase 20-11 wave γ-3 — developer chrome. Shows the track id with
      // the `track:` prefix to match PV35 audience separation: developer
      // chrome announces the IR tag's identity, musician chrome (in
      // irProjection.projectedLabel) renders just the trackId. 20-12 chrome
      // pass may add userMethod-aware text (e.g. `track: "lead" via .p()`
      // vs `track: "d1"` for synthetic-from-$:); for now the IR fields are
      // visible via the children() drill-in.
      return `track: ${node.trackId}`
    // Phase 20-18 Wave A — Signal/Builder chain-ROOT family.
    // DEVELOPER chrome (PV35): show kind + RAW args verbatim so the
    // developer sees exactly the source the parser tagged (matches the
    // Code-with-via `[opaque: .method(args)]` shape — full call-site
    // detail). LEAF — children() returns [] (no `via.inner`-style
    // recurse, even when `body?` is set in Wave C; the Wave-A roots
    // never carry body).
    case 'Signal':
      return node.args !== undefined ? `${node.kind}(${node.args})` : node.kind
    case 'Builder':
      return `${node.kind}(${node.args})`
    // Phase 5a (#386) — developer chrome: combinator + arm weights so the
    // structure (clip extents) is visible at a glance.
    case 'Arrange':
      return `${node.mode}(${node.arms.map((a) => a.weight).join(',')})`
  }
}

export function children(node: PatternIR): readonly PatternIR[] {
  switch (node.tag) {
    case 'Seq':   return node.children
    case 'Stack': return node.tracks
    case 'Cycle': return node.items
    case 'Arrange': return node.arms.map((a) => a.pattern)
    case 'Choice': return [node.then, node.else_]
    case 'Every': return node.default_ ? [node.body, node.default_] : [node.body]
    case 'When':  return [node.body]
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
    case 'Slice':
    case 'Loop':  return [node.body]
    case 'Param': {
      // Phase 20-10 wave β-2 (developer tree expansion).
      //
      // Param wraps a receiver (`body`) AND optionally carries a sub-IR
      // value (the pattern-arg form: `.s("<bd cp>")` parses with
      // value = parsed PatternIR for `<bd cp>`). The developer chrome
      // exposes BOTH so the inspector tree drills into the pattern-arg
      // sub-IR (matches Code-with-via's via.inner expansion at line 93).
      //
      // Literal-value Params (string | number) have no sub-IR — return
      // [body] only.
      const v = node.value
      if (typeof v === 'object' && v !== null) return [v as PatternIR, node.body]
      return [node.body]
    }
    case 'Chunk': return [node.body, node.transform]
    // Pick is the first IR shape with a list-of-sub-IRs alongside a
    // distinguished selector child — render selector first, then the
    // lookup entries as siblings.
    case 'Pick':  return [node.selector, ...node.lookup]
    // #463 / #475 — named/object pick family; same selector-first shape as
    // Pick, entries' patterns as siblings. (children() already degraded
    // safely via `default: return []`, but the explicit case lets irMode
    // drill into the entries too — parity with projectedChildren.)
    case 'NamedPick': return [node.selector, ...node.entries.map((e) => e.pattern)]
    // Phase 20-04 T-12 / D-05 (developer tree expansion).
    // Wrapper case: expose via.inner as a child so the inspector tree can
    // drill into the wrapped receiver. Parse-failure case (no via): leaf.
    // Phase 20-17 D-1c — discriminate Code.via union. Only the
    // wrapAsOpaque arm has `inner` (drill into wrapped receiver). The
    // literal arm (`{literal:true;raw}`) is a LEAF — return [].
    case 'Code':  return node.via && !('literal' in node.via) ? [node.via.inner] : []
    // Phase 20-11 γ-3 — Track is a single-body wrapper (like FX/Loop);
    // children expose the body so the developer can drill into the
    // wrapped expression.
    case 'Track': return [node.body]
    // Phase 20-18 Wave A — Signal/Builder chain-ROOT family.
    // LEAF — no `via.inner`-style child to drill into. The amendment
    // explicitly forbids "spurious recurse into a non-existent child"
    // (the 20-17 MusicalTimeline:298 silent-wrong class). The `body?`
    // field on Builder is Wave-C-OPAQUE-pending (chord/arrange) —
    // absent in Wave A; if a Wave-C ground-first producer later sets
    // it, this arm widens then. Matches the existing `default: return []`
    // shape; made explicit per the PK18 FLOOR-grep completeness rule.
    case 'Signal':
    case 'Builder': return []
    default:      return []
  }
}
