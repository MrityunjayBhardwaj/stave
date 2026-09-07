/**
 * IR Inspector — Strudel-vocabulary projection rules.
 *
 * Renders the IR tree using user-typed vocabulary by default
 * (e.g. `.layer(...)` → "layer", not "Stack"). Phase 19-06 (#76).
 *
 * Per CONTEXT D-01..D-03 (locked). Truth-table at RESEARCH §2.
 * Module-private to packages/app per RESEARCH Q10 — no editor barrel
 * exposure.
 *
 * Two pure functions, both exhaustive over PatternIR['tag']:
 * - projectedLabel(node): string | undefined
 *   undefined → row hidden (D-02 fold rule); parent's children list
 *   splices in this node's children.
 * - projectedChildren(node): readonly PatternIR[]
 *   Per-tag projected child list; may differ from raw children() for
 *   desugars (layer/jux/off).
 *
 * The .off() projection uses option (a) from CONTEXT pre-mortem #1 —
 * existing-IR relabel via stripInnerLate(node) recursion. RESEARCH §2.x.
 *
 * Special carve-outs:
 * - Code is whitelisted out of the D-02 hide rule (RESEARCH NEW
 *   pre-mortem #8) — hiding parser-failure-escape-hatch tags swallows
 *   debugging signal.
 * - Pure as Choice.else_ on mini `?` is filtered (RESEARCH NEW
 *   pre-mortem #10) — drops the empty () leaf.
 */
import type { PatternIR } from '@stave/editor'

/**
 * localStorage key for the IR-mode toggle. Colon-prefix convention —
 * matches existing keys `stave:editorTheme`, `stave:sidebar-width`,
 * `stave:autosnapIdleMs` (RESEARCH §5.1-5.2). Exported so the panel
 * and tests can reference one source of truth.
 */
export const LOCALSTORAGE_KEY = 'stave:inspector.irMode'

// D-03 mini-notation symbol mapping (RESEARCH §2.y — symbol-with-value
// for parametric tags Fast/Elongate; symbol-only for arity-zero).
function miniSymbol(node: PatternIR): string {
  switch (node.tag) {
    case 'Sleep':    return '~'
    case 'Cycle':    return '<>'
    case 'Choice':   return '?'   // p always 0.5 from mini ?
    case 'Elongate': return `@${node.factor}`
    case 'Fast':     return `*${node.factor}` // mini *N path
    case 'Stack':    return '{}'
    case 'Seq':      return '[]'
    // Phase 20-18 Wave A — Signal/Builder chain-ROOT family.
    // UNREACHABLE in practice — miniSymbol is only invoked from
    // projectedLabel's narrowed mini-notation arms (Sleep/Cycle/Choice/
    // Elongate/Fast/Stack/Seq at lines below). Defensive cases per the
    // PK18 FLOOR-grep completeness rule — fall through to the same
    // shape as default (the existing `return node.tag` for narrowing).
    // Existing default arm stays byte-UNCHANGED.
    case 'Signal':
    case 'Builder':  return node.tag
    default:         return node.tag // unreachable; for narrowing
  }
}

export function projectedLabel(node: PatternIR): string | undefined {
  // Tags whose userMethod is set (user-callable) project to that name —
  // covers fast, slow, every, sometimes, sometimesBy, mask/when, gain,
  // pan, room, delay, ..., late, degrade, degradeBy, chunk, ply, pick,
  // struct, swing, shuffle, scramble, chop, layer, jux, off, stack.
  if ('userMethod' in node && node.userMethod !== undefined) {
    return node.userMethod
  }

  // userMethod === undefined or absent. D-02 hide rule + carve-outs.
  switch (node.tag) {
    // Mini-notation symbol tags (D-03)
    case 'Sleep':
    case 'Cycle':
    case 'Choice':
    case 'Elongate':
      return miniSymbol(node)
    // Fast and Stack are dual-origin: from method or from mini.
    // userMethod === undefined here → from mini (parseMini doesn't set it).
    case 'Fast':
      return miniSymbol(node)
    case 'Stack':
      return miniSymbol(node) // mini polymetric `{...}`
    case 'Seq':
      return miniSymbol(node) // mini `[...]` / euclid
    // Code: parser-failure escape hatch — render even when userMethod
    // undefined. RESEARCH NEW pre-mortem #8 — hiding swallows debugging
    // signal.
    //
    // Phase 20-04 T-12 / PV35 / PV32 (musician chrome). Wrapper case
    // (via set): label-only "unmodelled" — DO NOT leak the method name
    // (PV32 vocabulary regression). Developer chrome shows the full
    // call site via summarize() in IRInspectorPanel.tsx; the audience
    // split is the load-bearing PV35 mechanism.
    case 'Code':
      // Phase 20-17 D-1c — discriminate Code.via union.
      //   - wrapAsOpaque arm: unparsed call site → "unmodelled" (existing
      //     PV35 musician-chrome label, unchanged).
      //   - literal arm ({literal:true;raw}): a resolved literal binding
      //     (G3 / D-02 CORRECTION). The user's source IS the value — it
      //     is NOT unmodelled; it is a value-leaf. Label it as 'Code'
      //     so the musician tree shows the substituted literal as a leaf.
      if (node.via && !('literal' in node.via)) return 'unmodelled'
      return 'Code'
    // Play: leaf, no userMethod field per PatternIR.ts:38.
    case 'Play':
      return 'Play'
    // Pure: D-02 hide. Caller filters Pure-as-Choice.else_ explicitly
    // via projectedChildren (RESEARCH NEW pre-mortem #10).
    case 'Pure':
      return undefined
    // Synthetic intermediates that should fold into parent (D-02):
    // - Late from .off() (parseStrudel.ts:585-588)
    // - Param(pan,±1) from .jux() — handled in the Param case below (#967;
    //   was FX(pan,±1) before the FX tag was deleted)
    // - Ramp (no parser path; defensive)
    // - Loop (no parser path; defensive)
    case 'Late':
    case 'Ramp':
    case 'Loop':
      return undefined
    // Tags that always have userMethod when constructed by the parser
    // — fall here only if a future parser path forgets to set it.
    // Fall through to raw tag name as a fail-safe (visible bug, not
    // silent loss).
    case 'Slow':
    case 'When':
    case 'Every':
    case 'Degrade':
    case 'Chunk':
    case 'Ply':
    case 'Pick':
    case 'Struct':
    case 'Swing':
    case 'Shuffle':
    case 'Scramble':
    case 'Chop':
    case 'Slice':
      return node.tag
    case 'Param':
      // #967 — a synthetic jux pan is now Param(pan, ±1) with no userMethod
      // (it was FX(pan) before the FX tag was deleted). It folds into the
      // parent exactly as the old FX case did: it is stripped structurally at
      // the jux projection (see `m === 'jux'` below), and folded here for any
      // path that labels it directly.
      if (node.key === 'pan' && node.userMethod === undefined) return undefined
      // Phase 20-10 wave β-2 (PV35 / PV32 — musician chrome).
      //
      // Defensive fallthrough only. The userMethod-first short-circuit at
      // lines 59-61 returns the user-typed token ('s' / 'gain' / 'note' /
      // 'bank' / 'scale' / 'color' / 'velocity' / 'pan' / 'speed' / 'n')
      // for every parser-constructed Param — α-3's parseParamArg routes
      // through tagMeta which sets userMethod unconditionally.
      //
      // This arm fires only when a hand-constructed Param node lacks
      // userMethod (test fixtures, future synthesised nodes). Returning
      // `node.tag` ('Param') here is intentionally visible so the leak
      // is debuggable rather than silent (NEW pre-mortem #8 — same
      // rationale as Code's whitelist). It is NOT a PV32 violation in
      // the normal path — that path short-circuits one frame earlier.
      return node.tag
    case 'Track':
      // Phase 20-11 wave γ-3 (PV35 / PV32 — musician chrome).
      //
      // Note: the userMethod-first short-circuit at lines 59-61 already
      // returns 'p' for `.p()`-derived Tracks (userMethod === 'p'); this
      // arm fires only for synthetic d{N} Tracks where userMethod is
      // undefined. For those, the trackId IS the user-visible identity —
      // the musician sees `d1`, `d2`, ... rendered as the row label, not
      // the IR tag name. Distinct from Param's userMethod-first short-
      // circuit because the synthetic case still has a meaningful name
      // (`d{N}` from the `$:` block index) rather than a leaked tag.
      return node.trackId
    // Phase 20-18 Wave A — Signal/Builder chain-ROOT family.
    // MUSICIAN chrome (PV35 / PV32 — no IR-tag leak): label = the
    // user-typed kind token (`sine`, `perlin`, `irand`, `binary`) — the
    // discriminator IS what the user wrote at the call site (Wave-0
    // ACTION 5 verdict (a)). The userMethod-first short-circuit at
    // lines 59-61 does NOT fire here (chain ROOTS have no `.method()`
    // call → userMethod undefined by construction). PV32 satisfied: no
    // IR-tag identifier ('Signal'/'Builder') is ever shown to the
    // musician; only the kind (the source token) is. LEAF — projection
    // children below returns [] for these tags.
    case 'Signal':
    case 'Builder':
      return node.kind
    // Phase 5a (#386) — time-sequence combinator. The userMethod short-circuit
    // above returns 'arrange'/'cat'/'slowcat' for parser-produced nodes; this
    // arm covers hand-built nodes with no userMethod. The musician sees the
    // combinator name (the source token), never the IR tag (PV32).
    case 'Arrange':
      return node.mode
    // #463 / #475 — object/named-key pick family. The userMethod short-circuit
    // above returns the method ('pickRestart'/'pickReset'/'pick') for parser-
    // produced nodes; this arm covers hand-built nodes with no userMethod,
    // falling back to `method` (the source token, never the IR tag — PV32).
    case 'NamedPick':
      return node.method
    default: {
      // Exhaustiveness guard (compile-time) + runtime fail-safe (#475). A tag
      // added to PatternIR but not handled above is a `tsc` error here. If it
      // slips past an un-typechecked build, degrade to the raw tag name rather
      // than returning the node object — see reportUnhandledTag.
      reportUnhandledTag(node)
      return (node as { tag: string }).tag
    }
  }
}

/**
 * Compile-time exhaustiveness guard with a runtime fail-safe (#475).
 *
 * The `node: never` parameter makes an unhandled PatternIR tag a `tsc` error
 * at the call site — preserving the original `const _exhaustive: never`
 * guarantee that forces every new tag to be projected. But unlike the old
 * arm (which `return`ed the node object, making projectedChildren yield a
 * non-iterable and white-screen the inspector — the #475 crash), this only
 * warns. The caller supplies a safe structural fallback (empty children /
 * raw tag label), matching children()'s existing `default: return []`.
 */
function reportUnhandledTag(node: never): void {
  // eslint-disable-next-line no-console
  console.warn(
    `[IR Inspector] unhandled PatternIR tag "${(node as { tag?: string }).tag}" ` +
      `in projection — rendering as an opaque leaf. Add a projection case (#475).`,
  )
}

export function projectedChildren(node: PatternIR): readonly PatternIR[] {
  switch (node.tag) {
    case 'Stack': {
      // Per-userMethod dispatch (D-01 children projection rules).
      const m = node.userMethod
      if (m === 'layer') {
        // Raw IR: Stack(f(body), g(body)) — already correct shape.
        return node.tracks
      }
      if (m === 'jux') {
        // Raw IR: Stack(Param(pan=-1, body), Param(pan=+1, transformed))
        // Strip the synthetic pan wrappers; surface [body, transformed].
        // #967 — these were FX(pan,±1) before the FX tag was deleted; the
        // discriminator is now (key 'pan' + no userMethod), since a
        // user-written .pan(...) is Param('pan', userMethod: 'pan').
        return node.tracks.map((t) => {
          if (t.tag === 'Param' && t.key === 'pan' && t.userMethod === undefined) {
            return t.body
          }
          return t
        })
      }
      if (m === 'off') {
        // Raw IR: Stack(body, transformed) where transformed contains
        // a synthetic Late at some descendant body position. Strip the
        // Late; return [body, transformed-without-Late]. RESEARCH §2.x
        // option (a).
        const [body, transformed] = node.tracks
        if (body === undefined || transformed === undefined) {
          return node.tracks
        }
        return [body, stripInnerLate(transformed)]
      }
      // 'stack' (user-typed) and undefined (mini polymetric): tracks verbatim
      return node.tracks
    }
    case 'Seq':   return node.children
    case 'Cycle': return node.items
    case 'Choice': {
      // Filter Pure else_ (RESEARCH NEW pre-mortem #10). Mini `?`
      // constructs Choice(0.5, then, IR.pure()).
      if (node.else_.tag === 'Pure' && node.else_.userMethod === undefined) {
        return [node.then]
      }
      return [node.then, node.else_]
    }
    case 'Every':
      return node.default_ ? [node.body, node.default_] : [node.body]
    case 'When':
      return [node.body]
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
    case 'Loop':
      return [node.body]
    case 'Param': {
      // Phase 20-10 wave β-2 (musician tree expansion / PV35).
      //
      // The pattern-arg sub-IR (`.s("<bd cp>")` → value = parsed cycle IR)
      // IS a child of the projected musical tree — without it the user
      // can't drill into nested cycles to inspect their atoms or set
      // breakpoints. Mirrors the Code-with-via expansion at line 219
      // (musician chrome reveals `via.inner` for the same reason).
      //
      // Literal-value Params (string | number) have no sub-IR — return
      // [body] only, matching the single-body wrapper shape.
      //
      // Order: [value, body] places the sub-IR first because it is the
      // structural child the user typed; body is the receiver chain.
      const v = node.value
      if (typeof v === 'object' && v !== null) return [v as PatternIR, node.body]
      return [node.body]
    }
    case 'Chunk':
      return [node.body, node.transform]
    case 'Pick':
      return [node.selector, ...node.lookup]
    case 'Pure':
    case 'Play':
    case 'Sleep':
      return []
    // Phase 20-04 T-12 / D-05 (musician tree expansion).
    // Wrapper case: expose via.inner so the projected tree drills into
    // the wrapped receiver. Parse-failure case (no via): leaf as before.
    case 'Code':
      // Phase 20-17 D-1c — discriminate Code.via union. Only the
      // wrapAsOpaque arm has `inner` (drill into wrapped receiver). The
      // literal arm (`{literal:true;raw}`) is a LEAF — return [].
      return node.via && !('literal' in node.via) ? [node.via.inner] : []
    case 'Track':
      // Phase 20-11 γ-3 — single-body wrapper; surface body so the
      // inspector tree drills through Track. Promotion of Stack-body
      // children (flattening the row hierarchy) is deferred to 20-12
      // chrome polish.
      return [node.body]
    // Phase 20-18 Wave A — Signal/Builder chain-ROOT family.
    // LEAF — explicitly NO spurious recurse into a non-existent child
    // (the named amendment trap: the 20-17 MusicalTimeline:298 silent-
    // wrong class). The `body?` field on Builder is Wave-C-OPAQUE-
    // pending (chord/arrange ground-first); absent in Wave A. If Wave C
    // later sets `body` for chord/arrange, this arm widens then —
    // adding a Wave-A recurse now would mis-render every existing
    // Signal/Builder root (which is every Wave-A producer output).
    case 'Signal':
    case 'Builder':
      return []
    // Phase 5a (#386) — the inspector tree drills into each clip: the arms'
    // patterns ARE the structural children (ordered, one per timeline clip).
    case 'Arrange':
      return node.arms.map((a) => a.pattern)
    // #463 / #475 — object/named-key pick family. Mirrors Pick: the selector
    // is the distinguished child, the entries' patterns are the structural
    // siblings the user typed (one per named key). Without this case the tag
    // fell through to `default` and returned the node object → the
    // `kids is not iterable` white-screen.
    case 'NamedPick':
      return [node.selector, ...node.entries.map((e) => e.pattern)]
    default: {
      // Exhaustiveness guard (compile-time) + runtime fail-safe (#475).
      // The old arm `return _exhaustive` returned the node object here — a
      // non-iterable that crashed spliceHiddenChildren. Degrade to an opaque
      // leaf instead (matches children()'s `default: return []`).
      reportUnhandledTag(node)
      return []
    }
  }
}

/**
 * Recursively strip the synthetic Late inserted by .off()'s desugar.
 *
 * Background: .off(t, f) is parsed as Stack(body, f(Late(t, body))).
 * The Late lives at some `body` position inside the transformed sub-IR
 * (parseStrudel.ts:585-588 places it at the leaf-most body of
 * parseTransform's result; chain `.gain(0.5).fast(2)` wraps it in
 * Fast{body: Param{body: lateBody}}).
 *
 * Strategy: traverse single-body chains; replace the synthetic Late
 * (tag === 'Late' && userMethod === undefined) with its body. Stop at
 * non-body-bearing nodes (Pure, Play, Sleep, Code, Stack, Seq, Cycle,
 * Choice, Pick, Chunk) to prevent infinite loops.
 *
 * RESEARCH §2.x — option (a) existing-IR relabel; no virtual node
 * synthesis.
 *
 * Exported for unit testability (T-03 tests it directly).
 */
export function stripInnerLate(node: PatternIR): PatternIR {
  if (node.tag === 'Late' && node.userMethod === undefined) {
    return node.body
  }
  // Single-body wrappers: recurse into body.
  switch (node.tag) {
    case 'Param':         // single-body wrapper
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
    case 'When':
    case 'Loop':
    case 'Track':         // Phase 20-11 — single-body wrapper; same shape as Param.
      return { ...node, body: stripInnerLate(node.body) }
    // Phase 20-18 Wave A — Signal/Builder chain-ROOT family.
    // LEAF — stripInnerLate never recurses through these. parseTransform
    // (the caller's caller, via .off() desugar) never produces a chain-
    // root signal/builder at the transformed sub-IR — these are root
    // tokens, not single-body wrappers. Matches default's `return node`
    // (existing default arm stays byte-UNCHANGED). Made explicit per
    // PK18 FLOOR-grep completeness rule.
    case 'Signal':
    case 'Builder':
      return node
    default:
      // Multi-child / leaf nodes (Pure, Play, Sleep, Code, Stack, Seq,
      // Cycle, Choice, Pick, Chunk): stop. .off()'s transform never
      // produces these in current parser paths (parseTransform yields
      // single-body wrappers only).
      return node
  }
}

/**
 * Phase 20-12 D-03 — flatten a Track body to its leaf voices.
 *
 * A leaf voice = an IR subtree that produces events in ONE conceptual
 * sub-row. The recursion rule (RESEARCH §C.2) is one-line: recurse iff
 * `Stack` with `userMethod ∈ {undefined, 'stack'}`.
 *   - `undefined` covers mini polymetric `{ ... }`.
 *   - `'stack'` covers user-typed `stack(...)`.
 *   - Layer / jux / off Stacks are SINGLE leaves — they're transformations
 *     attached to one voice, not parallel composition.
 *   - Everything else (Seq, Cycle, Cat, Param, Fast, Slow, Late, Choice,
 *     Code, Play, …) is a leaf — wrappers/modifiers attached to ONE voice.
 *
 * Inputs: typically `track.body` (NOT the Track itself; Track is the
 * unwrapped container).
 * Output: a flat list of leaf nodes in source order. Returns `[body]` when
 * `body` is a non-Stack leaf; returns `[]` when `body` is an empty Stack.
 *
 * Edge cases (RESEARCH §C.3, §C.4):
 *   - Empty Stack `stack()` → [] (chevron is a visual no-op when expanded).
 *   - Single-voice (non-Stack body) → [body] (one leaf — collapsed and
 *     expanded views render the same row).
 *   - `cat(a, b)` → 1 leaf (Cat is sequencing, not parallel; D-03 example).
 *
 * Phase 20-12 D-03 / RESEARCH §C.2; consumed by β-2 layoutTrackRows.
 */
export function flattenLeafVoices(body: PatternIR): readonly PatternIR[] {
  // Recursion gate: Stack with `userMethod ∈ {undefined, 'stack'}` is the
  // ONLY recursion case. Everything else is a leaf — UNLESS the node is a
  // single-body wrapper (uniform modifier) hiding a Stack inside. Then we
  // peel one layer and re-evaluate. This handles the common case
  // `stack(...).viz(...)` / `.gain(...)` / `.fast(...)` etc., where the
  // user's mental model is "N voices regardless of outer wrappers" but the
  // IR puts the Stack inside an outer Code/Param/Fast/etc.
  if (body.tag === 'Stack') {
    const um = body.userMethod
    if (um === undefined || um === 'stack') {
      const leaves: PatternIR[] = []
      for (const child of body.tracks) {
        for (const leaf of flattenLeafVoices(child)) leaves.push(leaf)
      }
      return leaves
    }
    // Stack with userMethod 'layer'/'jux'/'off' = single leaf (transforms,
    // not parallel composition).
    return [body]
  }
  const peeled = peelSingleBodyWrapper(body)
  if (peeled) return flattenLeafVoices(peeled)
  return [body]
}

/**
 * Peel one layer of a single-body wrapper. Returns the structural inner when
 * the node is a uniform modifier (effect / time-transform / parameter /
 * opaque-method-wrapper); returns null otherwise.
 *
 * NOT peeled: multi-path nodes (Choice then/else_, Pick selector/lookup),
 * structural carriers (Stack, Seq, Cat — they ARE the voice topology), and
 * Chunk (transform field is alternative event source, peeling would lose it).
 * Code WITHOUT via.inner is also not peeled (parse-failure leaf, no inner).
 */
function peelSingleBodyWrapper(n: PatternIR): PatternIR | null {
  // Phase 20-17 D-1c — only the wrapAsOpaque arm has `inner` (peel into
  // wrapped receiver); the literal arm (`{literal:true;raw}`) is a LEAF
  // (do NOT peel — `via.inner` is undefined and peeling would crash).
  if (n.tag === 'Code' && n.via && !('literal' in n.via) && n.via.inner) return n.via.inner
  switch (n.tag) {
    case 'Param':
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
    case 'When':
    case 'Every':
    case 'Loop':
    case 'Ramp':
      return n.body
    // Phase 20-18 Wave A — Signal/Builder chain-ROOT family.
    // NOT a single-body wrapper. Return null (don't peel) — matches
    // default. A chain root is a LEAF in flattenLeafVoices' recursion
    // gate; the existing `default: return null` would catch them, but
    // explicit cases are required per the PK18 FLOOR-grep rule. The
    // `body?` field on Builder is Wave-C-OPAQUE-pending (chord/arrange)
    // — if Wave C later sets `body`, peeling DEPENDS on chord/arrange's
    // ground-truth semantics (peel into the inner pattern? OR carry the
    // whole `arrange([...])` shape as one leaf?). That decision is
    // ground-first in Wave C. For Wave A: never set, never peel.
    case 'Signal':
    case 'Builder':
      return null
    default:
      return null
  }
}
