/**
 * toStrudel — PatternIR → Strudel code string interpreter.
 *
 * Generates valid Strudel code from a PatternIR tree.
 * The generated code should be evaluatable by StrudelEngine.
 *
 * Design decision: Simple Seq nodes where all children are Play nodes
 * collapse into mini-notation ("c4 e4 g4") for idiomatic Strudel output.
 * Any Seq with non-Play children uses explicit method chains.
 */

import type { PatternIR, PlayParams } from './PatternIR'

/** Generate Strudel code from a PatternIR tree. */
export function toStrudel(ir: PatternIR): string {
  return gen(ir)
}

function gen(ir: PatternIR): string {
  switch (ir.tag) {
    case 'Pure':
      return '""'

    // Phase 20-18 Wave A — Signal/Builder chain-ROOT family.
    // CODE-INVARIANCE (P62): re-emit the SOURCE VERBATIM. The kind IS
    // the user-typed token; args are RAW byte-for-byte (mirrors the
    // Code.via.args / Param.rawArgs convention). 0-arity signals
    // (`sine`, `perlin`) emit the bare kind; arg-taking signals
    // (`mousex` is 0-ary in Strudel; arg-shapes belong to specific
    // builders / sample-arg signals) emit `kind(args)`. Builders ALWAYS
    // carry args. NEVER re-serialise / NEVER coerce. The `body?` field
    // is Wave-C-OPAQUE-pending (chord/arrange) — absent in Wave A.
    case 'Signal':
      return ir.args !== undefined ? `${ir.kind}(${ir.args})` : ir.kind

    case 'Builder':
      return `${ir.kind}(${ir.args})`

    case 'Arrange': {
      // Phase 5a (#386) — re-emit the literal combinator. `arrange` wraps each
      // arm in a `[weight, pattern]` tuple; `cat`/`slowcat` take bare patterns
      // (all weights are 1 by construction, so no tuple is needed).
      if (ir.arms.length === 0) return `${ir.mode}()`
      const parts = ir.mode === 'arrange'
        ? ir.arms.map(a => `[${a.weight}, ${gen(a.pattern)}]`)
        : ir.arms.map(a => gen(a.pattern))
      return `${ir.mode}(${parts.join(', ')})`
    }

    case 'Track': {
      // Phase 20-11 D-02 — userMethod discriminates the two wrapper sources:
      //   - 'p'      → user wrote .p("name") — re-emit `${gen(body)}.p("name")`.
      //   - undefined → synthetic d{N} from $: or single-expression file —
      //                 re-emit body unchanged. Multi-$: re-emission deferred
      //                 to issue #109 (Stack-of-Track currently round-trips
      //                 to `stack(...)` not `$: ...\n$: ...`).
      if (ir.userMethod === 'p') {
        return `${gen(ir.body)}.p("${ir.trackId}")`
      }
      return gen(ir.body)
    }

    case 'Code':
      // Phase 20-04 T-10 (D-02 / PV37 clause 4) + 20-17 D-02 CORRECTION.
      // Wrapper case: re-emit ${gen(via.inner)}.${method}(${args}) using
      // the RAW (untrimmed) args — round-trip is byte-equivalent to the
      // typed source.
      // Literal-RHS case (20-17 G3): emit `via.raw` VERBATIM (the named
      // acceptance check — `.slow(numChords)` → `.slow(4)` byte-for-byte
      // after Wave E wires the helper into buildBindingMap). NEVER
      // re-serialize, NEVER coerce — code-invariance per P62.
      // Parse-failure case (no via): return ir.code as before — DV-08
      // unchanged.
      if (ir.via) {
        if ('literal' in ir.via) {
          return ir.via.raw
        }
        return `${gen(ir.via.inner)}.${ir.via.method}(${ir.via.args})`
      }
      // Identity — opaque fragment, return as-is
      return ir.code

    case 'Param':
      // Phase 20-10 — byte-fidelity contract. rawArgs is preserved untrimmed
      // by the parser (parseParamArg keeps the raw `args` slice). Mirrors
      // Code-with-via precedent above. Full round-trip test corpus lands in
      // wave β-1; the arm is added at α-4 to keep the gen function's switch
      // exhaustive after the Param tag joins the union.
      return `${gen(ir.body)}.${ir.userMethod ?? ir.key}(${ir.rawArgs})`

    case 'Play':
      return genPlay(ir.note, ir.params)

    case 'Sleep':
      // Sleep is absorbed into Seq as mini-notation "~" (rest)
      return '~'

    case 'Seq': {
      if (ir.children.length === 0) return '""'
      // Try to collapse to mini-notation if all children are simple
      if (canCollapse(ir.children)) {
        return collapseToMini(ir.children)
      }
      // Non-collapsible: Seq is FASTCAT — all children share ONE cycle
      // (fastcat ≡ Seq, grounded: parseStrudel.ts:1314). Emit `fastcat(...)`,
      // NOT `cat(...)`: `cat`/`slowcat` give each child a WHOLE cycle, so a
      // round-trip would stretch a 1-cycle sequence into N cycles (#434).
      // `userMethod` is 'fastcat' (parsed form) or undefined (mini-/seq-derived);
      // both are one-cycle, so `fastcat(...)` is the faithful canonical form —
      // and it parses back to Seq via parseTimeSequenceRoot, closing the loop.
      const parts = ir.children.map(gen)
      return `fastcat(${parts.join(', ')})`
    }

    case 'Stack': {
      // TODO(layer round-trip — Phase 19-04 T-01): if all tracks are
      // non-trivial transforms applied to the same body skeleton, this
      // is a `.layer(...)` shape. Recogniser ordering must be:
      //   jux-shape   FIRST  (most specific — 2 tracks, both FX(pan, ±1))
      //   off-shape   SECOND (2 tracks, second is Late wrapping body)
      //   layer-shape THIRD  (general N-track, each track is f(body))
      //   plain stack LAST   (heterogeneous tracks)
      // v1 emits the structural stack(...) form — matches the soft target
      // for jux/off from 19-03. Belongs with the bidirectional-editing
      // follow-up (#8). RESEARCH §1.1 §B4.
      if (ir.tracks.length === 0) return '""'
      // A chord — every track expressible in mini — round-trips to `[a,b,c]`
      // mini-notation (the form the user typed), not `stack(...)` (#508). An
      // EXPLICIT `stack(...)` call carries `userMethod: 'stack'` (parseStrudel) —
      // preserve that source form (P62 code-invariance); only collapse Stacks
      // that came from mini `[a,b,c]` (or programmatic `IR.stack`, no userMethod).
      if (ir.userMethod !== 'stack') {
        const useSample = hasSampleDescendant(ir)
        const frag = miniFragment(ir, useSample)
        if (frag !== null) return useSample ? `s("${frag}")` : `note("${frag}")`
      }
      const parts = ir.tracks.map(gen)
      return `stack(\n  ${parts.join(',\n  ')}\n)`
    }

    case 'Choice': {
      const thenCode = gen(ir.then)
      if (ir.else_.tag === 'Pure') {
        // Simple case: pattern plays with probability p (per-cycle,
        // matching Choice's actual semantic — the whole pattern fires
        // or doesn't on each cycle). `.sometimesBy(retain, x => x)` is
        // the Strudel method whose semantic matches: per-cycle binary
        // choice of identity-vs-empty.
        //
        // We emit `sometimesBy(p, x => x)` — applies the identity
        // transform with probability p (i.e., keeps the pattern). The
        // per-event `.degradeBy()` round-trip target now belongs to the
        // `Degrade` tag introduced in Tier 4 (Phase 19-03). Keeping
        // `.degradeBy()` here would collide on round-trip.
        const p = +ir.p.toFixed(4)
        return `${thenCode}.sometimesBy(${p}, x => x)`
      }
      // General case: both branches with complementary probabilities.
      // sometimesBy keeps the per-cycle granularity; the original
      // .degradeBy() emit was per-event, mismatched with Choice's
      // per-cycle semantic. Keep the stack shape but use sometimesBy.
      const elseCode = gen(ir.else_)
      const pThen = +ir.p.toFixed(4)
      const pElse = +(1 - ir.p).toFixed(4)
      return `stack(\n  ${thenCode}.sometimesBy(${pThen}, x => x),\n  ${elseCode}.sometimesBy(${pElse}, x => x)\n)`
    }

    case 'Every': {
      // Reconstruct the Strudel transform from the stored body + default_
      const base = ir.default_
      const baseCode = base ? gen(base) : gen(ir.body)
      const transformStr = base ? extractTransform(ir.body, base) : '() => rev'
      return `${baseCode}.every(${ir.n}, ${transformStr})`
    }

    case 'Cycle': {
      if (ir.items.length === 0) return '""'
      // If all items are simple notes, use mini-notation
      const allSimple = ir.items.every(item => item.tag === 'Play' || item.tag === 'Sleep')
      if (!allSimple) {
        // An item is a chord/sub-sequence (e.g. `<[c,e,g] [d,f,a]>`). Render the
        // whole cycle as mini so a nested chord becomes `[a,b,c]`, NOT an invalid
        // `stack(...)` inside the mini string (#508). Falls through to the legacy
        // per-item join only if some item isn't mini-expressible.
        const useSample = hasSampleDescendant(ir)
        const frag = miniFragment(ir, useSample)
        if (frag !== null) return useSample ? `s("${frag}")` : `note("${frag}")`
      }
      // Cycle → mini-notation angle bracket alternation
      const notes = ir.items.map(item => {
        if (item.tag === 'Play') return String(item.note)
        if (item.tag === 'Sleep') return '~'
        return gen(item)
      })
      if (allSimple) {
        // Determine whether note or s pattern
        const firstPlay = ir.items.find(i => i.tag === 'Play')
        if (firstPlay && firstPlay.tag === 'Play' && firstPlay.params.s) {
          return `s("<${notes.join(' ')}>")`
        }
        return `note("<${notes.join(' ')}>")`
      }
      return `note("<${notes.join(' ')}>")`
    }

    case 'When': {
      const body = gen(ir.body)
      return `${body}.mask("${ir.gate}")`
    }

    case 'Ramp': {
      const body = gen(ir.body)
      return `${body}.${ir.param}(slow(${ir.cycles}, saw))`
    }

    case 'Fast': {
      const body = gen(ir.body)
      return `${body}.fast(${ir.factor})`
    }

    case 'Slow': {
      const body = gen(ir.body)
      return `${body}.slow(${ir.factor})`
    }

    case 'Loop':
      // All Strudel patterns loop implicitly
      return gen(ir.body)

    case 'Elongate':
      // Mini-notation `a@N` only renders inside a Seq context. As a
      // standalone, the factor is informationally lost when going
      // back to Strudel — emit the inner body unchanged. Round-trip
      // fidelity for elongation in seqs is handled where the parent
      // Seq emits its mini-notation string (Tier 3 work).
      return gen(ir.body)

    case 'Late':
      // Tier 4 — `late(offset)` shifts events forward by `offset` cycles
      // while preserving cycle length (pattern.mjs:2081-2089).
      return `${gen(ir.body)}.late(${ir.offset})`

    case 'Degrade': {
      // Tier 4 — `Degrade.p` is the per-event RETENTION probability.
      // Round-trip: `.degrade()` when p === 0.5 (the Strudel shorthand,
      // signal.mjs:720); `.degradeBy(1 - p)` otherwise (signal.mjs:699-706
      // — Strudel's amount is the DROP probability).
      const body = gen(ir.body)
      if (ir.p === 0.5) return `${body}.degrade()`
      const dropAmount = +(1 - ir.p).toFixed(4)
      return `${body}.degradeBy(${dropAmount})`
    }

    case 'Chunk': {
      // Tier 4 — `chunk(n, f)` (pattern.mjs:2569-2578). The IR stores
      // `transform` as the body with the user's transform pre-applied
      // (extracted at parse time), so we recover the transform string
      // the same way `Every` does — via `extractTransform`.
      const baseCode = gen(ir.body)
      const transformStr = extractTransform(ir.transform, ir.body)
      return `${baseCode}.chunk(${ir.n}, ${transformStr})`
    }

    case 'Ply': {
      // Tier 4 — `ply(n)` (pattern.mjs:1905-1911). 1:1 method↔tag mapping,
      // so the round-trip is direct: emit `.ply(n)` over the body.
      return `${gen(ir.body)}.ply(${ir.n})`
    }

    case 'Pick': {
      // Tier 4 (Phase 19-04 T-02) — `pick(lookup)` (pick.mjs:44-54).
      // 1:1 method↔tag mapping, so the round-trip is direct: emit
      // `.pick([...])` with each lookup entry's gen output.
      const sel = gen(ir.selector)
      const elems = ir.lookup.map(p => gen(p))
      return `${sel}.pick([${elems.join(', ')}])`
    }

    case 'NamedPick':
      // #463 Stage 1 — object/named-key pick family. Re-emit
      // `${gen(selector)}.${method}(${rawArgs})` using the VERBATIM object-
      // literal source (rawArgs), so the round-trip is byte-identical to the
      // opaque Code node this replaced (PV37 preserved — collect reads the
      // structured `entries`, round-trip reads the raw string).
      return `${gen(ir.selector)}.${ir.method}(${ir.rawArgs})`

    case 'Struct': {
      // Tier 4 (Phase 19-04 T-03) — `struct(mask)` (pattern.mjs:1161-1163).
      // 1:1 method↔tag mapping with mask carried as a raw string (matches
      // When.gate precedent). Direct round-trip.
      return `${gen(ir.body)}.struct("${ir.mask}")`
    }

    case 'Swing': {
      // Tier 4 (Phase 19-04 T-04) — `swing(n)` (pattern.mjs:2193). Narrow
      // tag per D-03 (no Inside primitive yet). Direct 1:1 method↔tag
      // mapping for round-trip.
      return `${gen(ir.body)}.swing(${ir.n})`
    }

    case 'Shuffle': {
      // Tier 4 (Phase 19-04 T-05) — `shuffle(n)` (signal.mjs:392-394).
      // 1:1 method↔tag mapping; direct round-trip.
      return `${gen(ir.body)}.shuffle(${ir.n})`
    }

    case 'Scramble': {
      // Tier 4 (Phase 19-04 T-05) — `scramble(n)` (signal.mjs:405-407).
      // 1:1 method↔tag mapping; direct round-trip.
      return `${gen(ir.body)}.scramble(${ir.n})`
    }

    case 'Chop': {
      // Tier 4 (Phase 19-04 T-08) — `chop(n)` (pattern.mjs:3291-3306).
      // 1:1 method↔tag mapping; direct round-trip. Per D-04 the IR side
      // is pattern-level only; round-trip preserves the user's source.
      return `${gen(ir.body)}.chop(${ir.n})`
    }

    case 'Slice': {
      // Tier 4 (#1352 / E2E-5) — `slice(n, ipat)` (pattern.mjs:3356-3373).
      // Two arguments, so unlike its `chop` sibling the round-trip has to
      // regenerate the INDEX pattern as well as the count. An array count is
      // emitted in the same `[a, b, c]` form it was read from, which is the
      // spelling upstream's `Array.isArray(n)` branch requires.
      const count = Array.isArray(ir.n) ? `[${(ir.n as readonly number[]).join(', ')}]` : String(ir.n)
      const index = typeof ir.index === 'string' ? `"${ir.index}"` : gen(ir.index)
      return `${gen(ir.body)}.slice(${count}, ${index})`
    }
  }
}

/** Deep structural equality for PatternIR nodes (plain objects). */
function nodesEqual(a: PatternIR, b: PatternIR): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/**
 * Recover the Strudel transform string from Every's body + default_.
 * e.g. Every(4, Fast(2, base), base) → "fast(2)"
 */
function extractTransform(body: PatternIR, base: PatternIR): string {
  if (body.tag === 'Fast' && nodesEqual(body.body, base)) return `fast(${body.factor})`
  if (body.tag === 'Slow' && nodesEqual(body.body, base)) return `slow(${body.factor})`
  // Generic fallback: inline arrow returning the body expression. Since #944 a
  // control body is a Param, which takes this path (its `x => x.f()` form is
  // gone); the 0-arg arrow is hap-identical for every AND chunk (pinned in
  // controlClassificationGuards.test.ts with the eval oracle).
  return `() => ${gen(body)}`
}

/** Generate code for a Play node. */
function genPlay(note: string | number, params: PlayParams): string {
  if (params.s) {
    return `s("${params.s}")`
  }
  return `note("${note}")`
}

/** True if any Play descendant carries a sample name (`.s`) — picks `s("…")`
 *  vs `note("…")` for a mini-notation wrapper that may nest chords/sub-seqs. */
function hasSampleDescendant(ir: PatternIR): boolean {
  switch (ir.tag) {
    case 'Play':
      return !!ir.params.s
    case 'Seq':
      return ir.children.some(hasSampleDescendant)
    case 'Stack':
      return ir.tracks.some(hasSampleDescendant)
    case 'Cycle':
      return ir.items.some(hasSampleDescendant)
    default:
      return false
  }
}

/**
 * Render an IR node as a mini-notation FRAGMENT (no `note(…)`/`s(…)` wrapper),
 * or null when it can't be expressed in mini. The inverse of `parseMini`'s
 * structure: a chord `Stack` → `[a,b,c]`, a `Seq` → `a b c`, a `Cycle` →
 * `<a b c>`. Lets a chord round-trip back to `[a,b,c]` in ANY mini context —
 * standalone (`note("[c,e,g]")`) or nested in alternation
 * (`note("<[c,e,g] [d,f,a]>")`) — instead of an invalid `stack(…)` inside a
 * mini string (#508). `useSample` selects the note-vs-sample token, fixed by the
 * wrapper from `hasSampleDescendant`, so every leaf agrees.
 */
function miniFragment(ir: PatternIR, useSample: boolean): string | null {
  switch (ir.tag) {
    case 'Sleep':
      return '~'
    case 'Play': {
      // Only collapsible Plays (no FX params beyond s/gain/velocity/color) —
      // same fence `canCollapse` applies to sequence collapse. Those extra
      // params are lossy in mini (matches `collapseToMini`'s existing drop).
      const { gain, velocity, color, ...rest } = ir.params
      void gain
      void velocity
      void color
      // `s` stays in `rest` so the only-s/gain/velocity/color fence still holds;
      // delete it after the check so `rest` is the FX residue.
      delete (rest as { s?: string }).s
      if (Object.keys(rest).length > 0) return null
      // The wrapper is a SINGLE `s("…")` or `note("…")`. A play whose sample-ness
      // disagrees can't share it (a note token in `s("…")` would play as a sample
      // name) — refuse so a mixed-voice stack falls back to `stack(...)`.
      const isSample = !!ir.params.s
      if (isSample !== useSample) return null
      return useSample ? String(ir.params.s) : String(ir.note)
    }
    case 'Seq': {
      if (ir.children.length === 0) return null
      const parts = ir.children.map(c => miniFragment(c, useSample))
      if (parts.some(p => p === null)) return null
      return parts.join(' ')
    }
    case 'Stack': {
      if (ir.tracks.length === 0) return null
      const parts = ir.tracks.map(t => miniFragment(t, useSample))
      if (parts.some(p => p === null)) return null
      return `[${parts.join(',')}]`
    }
    case 'Cycle': {
      if (ir.items.length === 0) return null
      const parts = ir.items.map(it => miniFragment(it, useSample))
      if (parts.some(p => p === null)) return null
      return `<${parts.join(' ')}>`
    }
    default:
      return null
  }
}

/**
 * Returns true if all children can be collapsed to a simple mini-notation string.
 * Collapse is safe when: all children are Play (with no complex params) or Sleep.
 */
function canCollapse(children: PatternIR[]): boolean {
  return children.every(child => {
    if (child.tag === 'Sleep') return true
    if (child.tag === 'Play') {
      // Only collapse if no FX params beyond s/gain/velocity
      const { s, gain, velocity, color, ...rest } = child.params
      return Object.keys(rest).length === 0
    }
    return false
  })
}

/**
 * Collapse a list of Play/Sleep children into mini-notation.
 * e.g. [Play('c4'), Play('e4'), Play('g4')] → note("c4 e4 g4")
 */
function collapseToMini(children: PatternIR[]): string {
  // Determine if this is a sample pattern (any Play has .s)
  const hasSample = children.some(c => c.tag === 'Play' && c.params.s)

  const tokens = children.map(child => {
    if (child.tag === 'Sleep') return '~'
    if (child.tag === 'Play') {
      if (hasSample) return String(child.params.s ?? child.note)
      return String(child.note)
    }
    return '~'
  })

  const notation = tokens.join(' ')
  if (hasSample) return `s("${notation}")`
  return `note("${notation}")`
}
