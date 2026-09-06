/**
 * How long is the document — structurally, off the IR, with no evaluation and
 * no window.
 *
 * WHY THIS IS NOT `SongAnalysis.displaySpan`. That span answers "what should the
 * timeline SHOW", and it is measured over the evaluated event stream against a
 * progressive horizon. Three shapes make it wrong for a bounce, all measured
 * (#1359): a period-4 loop with 400 cycles of content reports `{loop, 4}`; an
 * aperiodic 400-cycle document reports `{capped, 256}` and truncates 144 cycles;
 * and — the one that surprises — an aperiodic document only 40 cycles long ALSO
 * reports `{capped, 256}`, because a song that ends still grows to the cap. A
 * bounce driven off it renders six times more silence than music.
 *
 * WHY IT IS NOT `SceneClip.endCycle` EITHER. Those cycles are song-absolute, but
 * the LAST clip of every lane is flushed at `originCycle + nCycles`
 * unconditionally, so `max(endCycle)` hands the visible window straight back.
 *
 * THE DATUM IS `ArrangeArm.weight`, which `PatternIR` already states outright:
 * "the whole node's period is `Σ weight`". This module is the one place that
 * reads it AS AN EXTENT. The three existing `Σ weight` reduces in
 * `structuralWalk.ts` are deliberately left alone — they compute a period in
 * order to modulo into it and SELECT an arm, which is a different job.
 *
 * THE ANSWER IS TYPED, NOT A NUMBER, for the same reason `DisplaySpan` refuses to
 * collapse `capped` into `horizon`: the cases mean different things and a bare
 * number erases which one answered. A caller that gets `0` cannot tell "this
 * document ends immediately" from "this document never ends".
 */
import type { PatternIR } from './PatternIR'

export type SongExtent =
  /** A definite end. `cycles` is `Σ weight` over the longest arrangement, scaled
   *  by any time-scaling above it. Safe to bounce whole. */
  | { readonly kind: 'arranged'; readonly cycles: number }
  /** No arrangement anywhere — the document loops, and a loop has no end. NOT a
   *  failure: this is the correct answer for 96.7% of real documents (#1359).
   *  The caller pairs it with `SongAnalysis.periodCycles` to offer repeats. */
  | { readonly kind: 'loop' }
  /** An arrangement IS present but something unparsed sits above it, so its
   *  length cannot be trusted. Distinct from `loop` so the UI can say so rather
   *  than quietly presenting an arrangement as a loop. */
  | { readonly kind: 'opaque' }

/** Time-scaling accumulated between the root and an `Arrange`. `Slow(f)` makes
 *  the arrangement f times longer, `Fast(f)` f times shorter. A non-finite or
 *  non-positive factor is IGNORED rather than propagated — it would poison the
 *  extent into NaN, and a NaN reaching the modal is a truncation with no
 *  symptom. */
function scaled(cycles: number, factor: number): number {
  return factor > 0 && Number.isFinite(factor) ? cycles * factor : cycles
}

/**
 * The document's extent.
 *
 * WALK RULES, and each is load-bearing:
 *
 * - `Arrange` → `Σ weight`, and **the arms are not descended into**. An arm
 *   spans `n` WHOLE cycles at the pattern's natural rate, so a longer inner
 *   arrangement is TRUNCATED by its arm, not extended by it. Taking a max that
 *   descended would over-report exactly the documents most likely to be nested.
 * - `NamedPick` whose selector is a WEIGHTED `Cycle` → `Σ` slot weights, slots
 *   without an `Elongate` counting 1, entries not descended into (#1427). The
 *   second spelling of an arrangement; the case body says why the RECEIVER, not
 *   the weighting alone, is what keeps it narrow.
 * - `Stack` → the MAX over tracks, never the sum. Tracks are parallel. That is
 *   also the answer for a song whose tracks carry DIFFERENT section timelines:
 *   the piece is as long as its longest track, never their sum.
 * - `Track` / `Loop` → transparent.
 * - `Fast` / `Slow` → scale what is below them.
 * - `Code` → TAINT. A `Code` node is either an opaque wrapper around a
 *   `.method(args)` Stave could not parse (with the real receiver at
 *   `via.inner`) or a whole parse failure. Either way an unknown transform sits
 *   between the arrangement and the output, and it may be a time-scaling one —
 *   measured on the real corpus, 3 of the 5 arranged documents have a `Code` on
 *   the path, and one of those three also has a `Slow`. So the receiver is still
 *   walked (to learn WHETHER an arrangement exists) but any arrangement found
 *   under it is reported as `opaque` rather than measured.
 *
 * ⚠ WHAT THE WALK DELIBERATELY DOES NOT FOLLOW. Only `body`, `Stack.tracks` and
 * `Code.via.inner` are traversed — not `Seq.children`, `Cycle.items`,
 * `Choice.then`/`else_`, or the `Pick` selector. Every one of those
 * constructs repeats once per cycle (a `Seq` is fastcat, which COMPRESSES its
 * children into a single cycle; a `Cycle` alternates between them), so a
 * document whose only arrangement sits inside one still loops forever and `loop`
 * is the correct verdict, not a miss. Checked rather than assumed: a probe
 * walking EVERY object field finds arrangements in the same 5 corpus documents
 * this walk classifies, so the narrower traversal loses nothing on real code.
 * ⚠ ONE EXCEPTION SINCE #1427: a `NamedPick`'s selector is READ for its weights,
 * though still not walked into — reading a shape is not traversing it.
 * `Sleep.duration` is likewise unmodelled — it contributes time that this
 * function does not count.
 *
 * ⚠ TAINT IS DOCUMENT-WIDE ONCE ANY ARRANGEMENT IS TAINTED, deliberately. The
 * result is a MAX, so one unmeasurable arm invalidates the maximum — the
 * untrusted arrangement could be the longest. Being wrong towards `opaque` costs
 * nothing (the UI treats `opaque` and `loop` alike, asking for a length); being
 * wrong towards `arranged` silently truncates someone's bounce.
 */
export function songExtent(ir: PatternIR | null): SongExtent {
  if (ir == null) return { kind: 'loop' }
  let best = 0
  let found = false
  let tainted = false

  const walk = (node: PatternIR | null | undefined, factor: number, opaque: boolean): void => {
    if (!node || typeof node !== 'object') return
    switch (node.tag) {
      case 'Arrange': {
        found = true
        if (opaque) {
          tainted = true
          return
        }
        const sum = node.arms.reduce((s, a) => s + (a.weight > 0 ? a.weight : 0), 0)
        // Arms are NOT walked — see the header. An arm truncates what it holds.
        if (sum > 0) best = Math.max(best, scaled(sum, factor))
        return
      }
      case 'NamedPick': {
        // A WEIGHTED SECTION TIMELINE IS THE OTHER SPELLING OF AN ARRANGEMENT (#1427).
        // `"<~@4 verse@8 chorus@8 …>".pickRestart({…})` and the `arrange(…)` of the same
        // song describe one piece; only the first was being called a loop. The header's
        // rule that a `Cycle` repeats once per cycle and so loops forever is true — and
        // it is equally true of `arrange`, which is `timeCat(...).slow(Σweight)`, itself
        // a weighted sequence that loops. So the definite end was never a fact about
        // `arrange()`; it is Stave reading a finite weighted sequence of sections AS a
        // song. That reading is right — it was being applied to one of two spellings.
        //
        // ⚠ NARROW ON PURPOSE, AND THE RECEIVER IS THE NARROWING. Only a `NamedPick`'s
        // own selector qualifies. Any weighted `Cycle` anywhere would sweep in melodic
        // alternations like `note("<[a3,c4,e4]@2 [g3,b3,d4]>")`, which are emphatically
        // not song form — 42 of the 150 corpus documents carry an `Elongate` somewhere
        // and not one of them is a section timeline. The existing bias holds: wrong
        // towards `loop` costs nothing, wrong towards `arranged` truncates a bounce.
        const sel = node.selector
        if (!sel || sel.tag !== 'Cycle') return
        // ⚠ AT LEAST ONE WEIGHT REQUIRED. A bare `<verse chorus>` selector is an
        // alternation the author is likelier jamming with than ending on, and nothing in
        // the shape says otherwise. Unweighted arms DO count under `Arrange`, where the
        // CALL declares the intent; here the shape is all there is, so the weight is what
        // separates a section timeline from an alternation.
        if (!sel.items.some((i) => i != null && i.tag === 'Elongate')) return
        found = true
        if (opaque) {
          tainted = true
          return
        }
        // Slots without an `Elongate` weigh 1, exactly as `cat` arms do.
        const sum = sel.items.reduce(
          (acc, i) =>
            acc +
            (i != null && i.tag === 'Elongate' && i.factor > 0 && Number.isFinite(i.factor)
              ? i.factor
              : 1),
          0,
        )
        // Entries are NOT walked, for the same reason `Arrange` arms are not: a slot
        // spans whole cycles, so it truncates a longer inner arrangement rather than
        // being extended by it.
        if (sum > 0) best = Math.max(best, scaled(sum, factor))
        return
      }
      case 'Stack':
        for (const t of node.tracks) walk(t, factor, opaque)
        return
      case 'Track':
      case 'Loop':
        walk(node.body, factor, opaque)
        return
      case 'Slow':
        walk(node.body, scaled(factor, node.factor), opaque)
        return
      case 'Fast':
        walk(node.body, node.factor > 0 && Number.isFinite(node.factor) ? factor / node.factor : factor, opaque)
        return
      case 'Code': {
        // Everything below is reached through a transform we could not read.
        // `via` is a union: the opaque-fragment WRAPPER carries `inner` (the
        // real receiver), while the literal-RHS marker carries no pattern at
        // all — so narrow rather than optional-chain, or the literal arm
        // silently reads `undefined` as "nothing below".
        const via = node.via
        if (via && 'inner' in via) walk(via.inner, factor, true)
        return
      }
      default: {
        // Every other node either holds no arrangement or holds one under a
        // transform whose effect on TIME this module does not model. Walking a
        // `body` generically would be a guess; the honest move is to look, and
        // to mark anything found as unmeasured.
        const body = (node as { body?: PatternIR }).body
        if (body && typeof body === 'object') walk(body, factor, true)
        return
      }
    }
  }

  walk(ir, 1, false)
  if (!found) return { kind: 'loop' }
  if (tainted || best <= 0) return { kind: 'opaque' }
  return { kind: 'arranged', cycles: best }
}
