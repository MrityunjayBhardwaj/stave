import { describe, it, expect } from 'vitest'
import { parseStrudel, collectTopLevelBindings } from '../parseStrudel'
import type { PatternIR } from '../PatternIR'

/**
 * Phase 20-17 E-1 — bounded least-fixpoint regression spec.
 *
 * The 4 proto synthetics from
 * `packages/app/tests/parity-corpus/_proto-d01.spec.ts` ported into the
 * editor's unit suite to lock the fixpoint loop's behaviour against
 * regression:
 *
 *   (b) forward-ref     → STRUCTURED   (iter-0 unresolves `a`, iter-1
 *                                       resolves `b` then iter-2 resolves
 *                                       `a` via the partial map; order-
 *                                       independent by construction)
 *   (c) cyclic          → Code         (nothing resolves at all, so there
 *                                       is no map to hand back → the
 *                                       whole-program Code-fallback)
 *   (d) dup-key         → Code         (first-pass dup-key fence; the
 *                                       fixpoint never runs)
 *   OQ1-5c              → STRUCTURED   (#1468 B — one opaque binding no
 *                                       longer costs the ones that DID
 *                                       resolve; see the arm's own note)
 *
 * These tests pin the fixpoint discipline (Datalog: total + PTIME +
 * order-independent + occurs-check-stratified) at the editor level so a
 * future parser refactor that breaks any of the four shapes fails here
 * (parity-corpus only covers Bakery-realistic inputs; the synthetics
 * stress the loop invariant in isolation).
 *
 * ⚠ OQ1-5c's EXPECTATION WAS REWRITTEN BY #1468, DELIBERATELY. What it used
 * to pin was a SCOPE decision rather than a correctness argument — its own
 * comment said "E-1 ships the NON-relax disposition (the proto's relax-
 * unreferenced toggle was a 20-16 design probe, NOT this wave's behaviour)"
 * — and the prototype that informed it records in its own header that five
 * of its six repros were pruned in #1292 and its verdicts "are not
 * re-derivable from this tree". So the evidence for the old expectation no
 * longer exists, while the 329-document corpus that moved it does. What the
 * three remaining shapes pin is unchanged.
 */

/** Mirror parseStrudel's no-`$:` shape: Track('d1', inner). Returns inner. */
function unwrapTrackD1(ir: PatternIR): PatternIR {
  if (ir.tag !== 'Track') return ir
  return (ir as unknown as { body: PatternIR }).body
}

function isBareCode(ir: PatternIR): boolean {
  return ir.tag === 'Code' && (ir as { via?: unknown }).via === undefined
}

describe('20-17 E-1 — buildBindingMap bounded least-fixpoint', () => {
  it('(b) forward-ref — `const a=b; const b=n("0"); stack(a)` STRUCTURED', () => {
    const code = 'const a=b\nconst b=n("0")\nstack(a)'
    const ir = parseStrudel(code)
    const inner = unwrapTrackD1(ir)
    // Order-independent: iter-0 cannot resolve `a` (refers to `b`,
    // unbound); iter-1 resolves `b` (literal n("0")); iter-2 resolves
    // `a` via the partial bindings map. Final expr `stack(a)` substitutes
    // the resolved `a` subtree → structured Stack.
    expect(isBareCode(inner)).toBe(false)
    expect(inner.tag).not.toBe('Code')
  })

  it('(c) cyclic — `const a=b; const b=a; stack(a,b)` Code (nothing resolves)', () => {
    const code = 'const a=b\nconst b=a\nstack(a,b)'
    const ir = parseStrudel(code)
    const inner = unwrapTrackD1(ir)
    // Both `a` and `b` stay pending across every iter (each RHS parses to
    // bareCode while the other is unresolved), so the map ends EMPTY.
    //
    // #1468 B kept this outcome without adding any cycle detection: the
    // partial map is returned only when it resolved something, and a cycle
    // resolves nothing. Measured on 329 documents, handing back the empty map
    // instead would change `collectTopLevelBindings`'s non-null count by +7
    // and change NOTHING a consumer can see — identical whole-document opaque
    // count, identical Play leaves, identical Code nodes, identical
    // arrangements. An empty map differs from null only in claiming to be an
    // answer.
    expect(isBareCode(inner)).toBe(true)
  })

  it('(d) dup-key — `var x=n("0"); var x=n("1"); stack(x)` Code (first-pass fence)', () => {
    const code = 'var x=n("0")\nvar x=n("1")\nstack(x)'
    const ir = parseStrudel(code)
    const inner = unwrapTrackD1(ir)
    // The dup-key fence (kept γ-3, byte-unchanged predicate) fires
    // during the first descriptor-build pass — the fixpoint never runs.
    expect(isBareCode(inner)).toBe(true)
  })

  it('OQ1-5c — `var d=makeBass(); const p=n("0"); stack(p)` STRUCTURED (#1468 B)', () => {
    const code = 'var d=makeBass()\nconst p=n("0")\nstack(p)'
    const ir = parseStrudel(code)
    const inner = unwrapTrackD1(ir)
    // `d`'s RHS `makeBass()` is opaque — parseExpression cannot lift it (no
    // recognised root, no chain shape) — and NOTHING REFERENCES IT. It used to
    // take the whole document with it anyway.
    //
    // Now the residual pending set costs only itself: `p` resolved, so the map
    // is returned with `p` in it, `stack(p)` substitutes, and the tree is
    // structured. That is #1392's argument one level up — a structured tree
    // with an opaque LEAF beats one opaque node standing for everything.
    //
    // Measured over 329 real documents: whole-document opaques 20 → 15, Play
    // leaves 25607 → 26016, arrange documents reaching an arrangement 8/13 →
    // 9/13. `Code` rising 2484 → 2606 is the SHAPE of the win, not a cost —
    // one document-sized opaque node becomes a tree carrying a few small ones.
    expect(isBareCode(inner)).toBe(false)
    expect(inner.tag).not.toBe('Code')
  })

  it('#1468 B — the opaque binding stays opaque; nothing is invented for it', () => {
    // The other half of the same property, and the one that says this is a
    // relaxation rather than a guess: `d` is absent from the map entirely.
    const got = collectTopLevelBindings('var d=makeBass()\nconst p=n("0")\nstack(p)', 0)
    expect(got).not.toBeNull()
    expect(got!.bindings.has('p')).toBe(true)
    expect(got!.bindings.has('d')).toBe(false)
  })
})
