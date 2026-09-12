/**
 * parseStrudel — staged pipeline.
 *
 * Surfaces the 4 internal stages of parseStrudel as named passes so
 * the IR Inspector can render each as a tab. End-to-end behavior at
 * FINAL is byte-identical to parseStrudel(code) (D-06 regression gate).
 *
 * Stage boundaries (CONTEXT D-02):
 *   RAW            — extractTracks: per-track Code lifts + offsets
 *   MINI-EXPANDED  — parseRoot per track; chains held as metadata
 *   CHAIN-APPLIED  — applyChain runs per track; metadata dropped
 *   FINAL          — identity today; reserved for future polish
 *
 * Pass<IR> contract: each stage runs PatternIR → PatternIR.
 * Seed input: callers wrap raw source `code: string` in IR.code(code)
 * before pass 0. Pass 0 (RAW) reads input.tag === 'Code' && input.code.
 *
 * Phase 19-07 (#79).
 */

import { IR, type PatternIR } from './PatternIR'
import { trackIdFromLabel, isMutedLabel } from './trackId'
import {
  extractTracks,
  parseRoot,
  applyChain,
  splitRootAndChain,
  stripParserPrelude,
  splitTopLevelStatements,
  stripSideEffectStatements,
  BINDING_RE,
  NON_EXPRESSION_HEAD_RE,
  buildBindingMap,
  collectTopLevelBindings,
  collectNumericBindings,
} from './parseStrudel'

/**
 * RAW — per-track Code lifts.
 *
 * 0 tracks → single Code node carrying `code.trim()` text + loc spanning
 *            from first non-WS char to end of source.
 * 1 track  → single Code node carrying that track's `expr` text + loc
 *            from extractTracks.
 * ≥2 tracks → outer Stack of per-track Code lifts; userMethod undefined
 *             (synthetic from RAW; projects to mini polymetric `{}` per
 *             RESEARCH §6 D-04 risk acceptance).
 *
 * PV25: every Code lift threads extractTracks's existing offset into its
 * loc.start; loc.end = offset + expr.length.
 */
export function runRawStage(input: PatternIR): PatternIR {
  // Pre-pass-0 seed: input is IR.code(rawSource).
  if (input.tag !== 'Code') {
    // Defensive: passed something other than Code. Pass-through.
    return input
  }
  const code = input.code
  if (!code.trim()) {
    // Empty source — single empty Code node. Mirrors parseStrudel's
    // `if (!code.trim()) return IR.pure()` guard but as a Code lift so
    // the RAW tab still shows something structured.
    return {
      tag: 'Code' as const,
      code: '',
      lang: 'strudel' as const,
      loc: [{ start: 0, end: code.length }],
    }
  }
  // #1514 — the document's top-level NUMERIC bindings, resolved ONCE, above
  // the track dispatch, for the same reason `trackBindings` is: `let M = 1` is
  // a property of the DOCUMENT, and a track's lifted `code` is its expression
  // alone. `parseStrudel` collects this at its own top (parseStrudel.ts:967)
  // and threads it to every branch; this pipeline collected it nowhere, so an
  // arrange arm weighted `M*2` was unresolvable HERE and resolvable THERE.
  //
  // A separate map from `trackBindings` because that one resolves to PATTERNS,
  // and because it must survive that collector declining — a document whose
  // pattern bindings don't resolve can still have a readable `let M = 1`.
  const docNumbers = collectNumericBindings(code)
  const numberMeta = docNumbers ? { trackNumbers: docNumbers } : {}
  const tracks = extractTracks(code)
  if (tracks.length === 0) {
    // Phase 20-14 parser-gap PARITY (#113) — strip the leading prelude
    // (whole-line comments, blank lines, recognised boot side-effects like
    // `setcps(…)` / `samples(…)`) before lifting, exactly as parseStrudel's
    // no-`$:` branch does (parseStrudel.ts:804). Without this, a bare pattern
    // PRECEDED by a prelude statement (`setcps(120/240)\ns("bd hh sd")`) lifted
    // the WHOLE source as one Code node → MINI-EXPANDED read `setcps(…)` as the
    // root and the pattern fell through to opaque Code → zero events → an empty
    // timeline. parseStrudel got this fix in 20-14; the STAGED pipeline (the
    // snapshot/timeline path via runPasses) had diverged and still lifted the
    // raw source. A lone bare pattern (no prelude) is unaffected — strip is a
    // no-op there.
    const stripped = stripParserPrelude(code)
    if (!stripped.body.trim()) {
      // Source is ENTIRELY prelude (no musical body) — empty Code lift.
      // MINI-EXPANDED maps an empty Code → IR.pure(), preserving the
      // synthetic-d1 shape downstream (mirrors parseStrudel.ts:805-810).
      return {
        tag: 'Code' as const,
        code: '',
        lang: 'strudel' as const,
        loc: [{ start: stripped.offset, end: code.length }],
      }
    }
    // #1376 — a bare document with SEVERAL top-level statements declares
    // several tracks, and every one of them gets a row.
    //
    // `parseStrudel` learned this in #1096; the staged pipeline did not, and
    // the failure was not a degraded shape but a DISAPPEARANCE. Handed the
    // whole body, `parseRoot` kept ONE expression, so
    // `sound("hh hh hh hh")\nsound("[bd bd][sd bd] bd sd")` produced an IR in
    // which the second statement did not appear at all — no opaque `Code` node
    // standing in for it, nothing to notice. Every consumer of the published
    // snapshot then drew a song with fewer parts than the user wrote.
    //
    // REUSES `splitTopLevelStatements` + `stripSideEffectStatements` +
    // `BINDING_RE` from `parseStrudel` rather than re-deriving them here. A
    // second, hand-kept splitter is exactly the defect this whole issue is
    // about — one list, two readers.
    //
    // Deliberately as NARROW as its counterpart: taken only when every
    // remaining statement is a plain expression. A `let`/`const` needs
    // substitution to be meaningful, and inventing per-statement binding
    // semantics here would be a second, weaker binding map. One candidate
    // keeps the existing single-Code path untouched, so every single-statement
    // bare document stays byte-identical.
    const bareStmts = stripSideEffectStatements(
      splitTopLevelStatements(stripped.body, stripped.offset),
    )
    // #1523 — the mirror of parseStrudel.ts's bare branch: a document that
    // DECLARES a binding and then plays several expressions is split the same
    // way, reading its identifiers through the same engine.
    //
    // The narrowness this replaces was justified as "inventing per-statement
    // binding semantics here would be a second, weaker binding map", and that
    // reason still holds — which is why this asks `collectTopLevelBindings`
    // rather than inventing anything. The map travels to MINI-EXPANDED on the
    // existing `trackBindings` channel, exactly as a labelled track's does.
    const declaresBinding = bareStmts.some((st) => BINDING_RE.test(st.text))
    const collected = declaresBinding
      // #1522 — the numeric map reaches the pattern collector here too, so a
      // binding whose RHS is `arrange([M, …])` reads its weight on both sides.
      ? collectTopLevelBindings(stripped.body, stripped.offset, docNumbers)
      : null
    const trackStmts = collected ? collected.tail : declaresBinding ? [] : bareStmts
    // #1534/#1536 — the mirror of parseStrudel.ts's row filter. A statement that
    // cannot be an expression is not a part and must not take a row.
    //
    // ⚠ The reason this one is mirrorable at all, when the filter #1523
    // rejected was not, is that it is TEXTUAL. That one asked "did this
    // statement parse musically?", which this stage cannot answer — it splits
    // at RAW, before anything is parsed. `NON_EXPRESSION_HEAD_RE` reads the
    // statement's text, which is all RAW has and all it needs.
    //
    // ⚠ AND THAT IS WHY #1536's WIDENING COST NOTHING HERE. Adding `function`,
    // `class`, `if` and the rest to the predicate is still a question about
    // TEXT, so this line did not change at all — one predicate, imported, and
    // both parsers move together. A widening that had needed parse results
    // would have had to stop at the same fence #1523 hit.
    const playable = trackStmts.filter((st) => !NON_EXPRESSION_HEAD_RE.test(st.text))
    if (playable.length > 1) {
      return {
        tag: 'Stack' as const,
        tracks: playable.map((st) => ({
          tag: 'Code' as const,
          code: st.text,
          lang: 'strudel' as const,
          loc: [{ start: st.offset, end: st.offset + st.text.length }],
          // #1523 — the document's bindings, same map on every statement. And
          // `numberMeta` alongside, because the monolithic side passes its
          // numeric map to every one of these statements; without it a
          // `[M*8, …]` arm would resolve THERE and not HERE, which is the
          // divergence #1514 closed on the single-statement arm.
          ...(collected ? { trackBindings: collected.bindings } : {}),
          ...numberMeta,
          // The statement's OWN range, threaded through the EXISTING
          // dollarStart/dollarEnd channel so CHAIN-APPLIED builds
          // `Track(d{i+1}, …, {loc})` with no new metadata path.
          // `trackLabel` stays undefined → `trackIdFromLabel` yields d{i+1},
          // matching parseStrudel.ts's `IR.track(\`d${i + 1}\`, …)`.
          dollarStart: st.offset,
          dollarEnd: st.offset + st.text.length,
          // `unknown` hop — the same idiom the labelled-track lifts below use,
          // and it became necessary here for the same reason they need it: once
          // `trackBindings` is in the object, the literal no longer overlaps
          // `PatternIR` enough for a direct assertion. ⚠ Only the tsup dts build
          // says so; the whole vitest suite was green with the direct cast.
        } as unknown as PatternIR)),
        loc: [{ start: 0, end: code.length }],
        // userMethod intentionally undefined — synthetic-from-RAW wrapper,
        // same as the multi-`$:` return below.
      }
    }
    // #1534 — the mirror of the single-survivor arm. When the filter drops the
    // tail below the `> 1` fence, the one surviving expression is lifted ALONE,
    // with the document's bindings, rather than falling to the whole-body Code
    // the fence would otherwise reach.
    //
    // Lifted as a lone Code with the statement's own `loc` — so MINI-EXPANDED
    // parses that text at that offset with `trackBindings`, and CHAIN-APPLIED's
    // single-track wrap gives `Track('d1', …)`. ⚠ NO `dollarStart`: this row is
    // deliberately the same shape a declaration-free document gets, and
    // `withTrackMeta` would drop the range anyway (it only re-attaches it
    // alongside a `trackLabel`), so setting it would read as a loc that never
    // arrives.
    //
    // ⚠ NOT fenced on `collected` — see the counterpart's note: a document with
    // no binding map at all reaches the split through `bareStmts` and can be
    // dropped below the fence by a filter that reads declarations.
    if (trackStmts.length > 1 && playable.length === 1) {
      const only = playable[0]
      return {
        tag: 'Code' as const,
        code: only.text,
        lang: 'strudel' as const,
        loc: [{ start: only.offset, end: only.offset + only.text.length }],
        ...(collected ? { trackBindings: collected.bindings } : {}),
        ...numberMeta,
      } as unknown as PatternIR
    }
    const bodyTrimStart = stripped.body.search(/\S/)
    const start = stripped.offset + (bodyTrimStart >= 0 ? bodyTrimStart : 0)
    return {
      tag: 'Code' as const,
      code: stripped.body.trim(),
      lang: 'strudel' as const,
      loc: [{ start, end: code.length }],
      // #1514 — a BARE document resolves its own pattern bindings in
      // MINI-EXPANDED (`buildBindingMap`), but the numeric map is built from
      // the whole source, so it travels the same meta channel as every other
      // shape rather than being re-derived in one arm.
      ...numberMeta,
    } as unknown as PatternIR
  }
  // #1392 — the document's top-level bindings, resolved ONCE for every track.
  //
  // A track's lifted `code` is its expression ALONE (`t.expr`), so the
  // `const intro = …` lines are not in it and no later stage can recover them
  // from what it is handed. RAW is the only stage that still holds the whole
  // document, so this is the only place the map can be built — it then travels
  // as stage-meta on each lift, exactly as `trackLabel` and `dollarStart` do.
  // Stripped from FINAL by `stripStageMeta` with the rest of the meta.
  const docBindings = collectTopLevelBindings(code, 0, docNumbers)?.bindings
  // #1514 — `numberMeta` rides alongside; both are document-scope and both are
  // stripped by `stripStageMeta` before FINAL.
  const bindingMeta = { ...(docBindings ? { trackBindings: docBindings } : {}), ...numberMeta }
  if (tracks.length === 1) {
    const t = tracks[0]
    return {
      tag: 'Code' as const,
      code: t.expr,
      lang: 'strudel' as const,
      loc: [{ start: t.offset, end: t.offset + t.expr.length }],
      ...bindingMeta,
      // #671 — a lone `name: …` / `$:` track threads its label AND its
      // `$:`-line range so CHAIN-APPLIED's single-track wrap mirrors
      // parseStrudel.ts:857 exactly: `trackId = label` (not synthetic `d1`)
      // AND `loc = [{ dollarStart, end }]`. A lone `$:` carries label === '$'
      // → d1 (unchanged); a bare pattern (tracks.length === 0) never reaches
      // here so it stays loc-free, matching parseStrudel's no-`$:` branch.
      trackLabel: t.label,
      dollarStart: t.dollarStart,
      dollarEnd: t.end,
      // `unknown` hop: the stage-meta stash is deliberately off-type (D-03
      // narrow union), and `trackBindings` carries it past the point where a
      // direct assertion still overlaps. Same idiom as `withTrackMeta` below.
    } as unknown as PatternIR
  }
  const trackCodes: PatternIR[] = tracks.map((t) => ({
    tag: 'Code' as const,
    code: t.expr,
    lang: 'strudel' as const,
    loc: [{ start: t.offset, end: t.offset + t.expr.length }],
    // #1392 — the document's bindings, same map on every track (see above).
    ...bindingMeta,
    // Phase 20-11 α-4 — stage-transition metadata. Stash the `$:` line
    // range (dollarStart..end-of-track-body-slice) so runChainAppliedStage
    // can construct the Track wrapper with the same loc parseStrudel main
    // produces (line 0..15 for the first $:, 15..28 for the second, etc.).
    // Additive narrow-union per D-03; mirrors `unresolvedChain` /
    // `chainOffset` (PR-A precedent). Stripped from FINAL by stripStageMeta
    // — the strip happens in applyOnTrack via stripStageMeta below + in
    // the test-helper stripStageMeta the regression sentinel uses.
    dollarStart: t.dollarStart,
    dollarEnd: t.end,
    // #671 — thread the `name:` label so CHAIN-APPLIED builds the Track
    // wrapper with `trackId = label` (parseStrudel.ts:876), not a `d{N}`
    // ordinal. Without this the full-song timeline (which consumes THIS
    // staged pipeline, not monolithic parseStrudel) dropped labelled-track
    // names → `d1/d2/d3`. `$:` carries label === '$' → d{N} unchanged.
    trackLabel: t.label,
  } as unknown as PatternIR))
  return {
    tag: 'Stack' as const,
    tracks: trackCodes,
    loc: [{ start: 0, end: code.length }],
    // userMethod intentionally undefined — synthetic-from-RAW outer
    // wrapper. Projects to mini polymetric `{}` symbol per 19-06.
  }
}

/**
 * MINI-EXPANDED — parseRoot per track; chains held as metadata.
 *
 * Reads RAW's Code lifts (0/1-track single Code, or multi-track Stack
 * of Codes); produces parsed root IR per track with `unresolvedChain`
 * + `chainOffset` metadata stashed on each root for CHAIN-APPLIED to
 * consume.
 *
 * PV31 hot spot: root-level `stack(...)` literal-construction sets
 * userMethod === 'stack' inside parseRoot. We delegate to parseRoot
 * directly so this is preserved by construction.
 */
export function runMiniExpandedStage(input: PatternIR): PatternIR {
  if (input.tag === 'Code') {
    const base = input.loc?.[0]?.start ?? 0
    // #671 — carry a lone track's `name:`/`$:` label AND `$:`-line range
    // through to CHAIN-APPLIED (mirrors the multi-track threading below).
    const cMeta = input as unknown as {
      trackLabel?: string
      dollarStart?: number
      dollarEnd?: number
      // #1392 — the document's bindings, put here by RAW (the only stage that
      // still holds the `const` lines a track's own `code` does not contain).
      trackBindings?: ReadonlyMap<string, PatternIR>
      // #1514 — the document's numeric bindings, same provenance.
      trackNumbers?: ReadonlyMap<string, number>
    }

    // #1384 — the ONE place this stage re-attaches a lone track's stage-meta.
    // Both exits below go through it: the empty-code exit and the parsed exit.
    // It used to be inline on the parsed exit only, which is how the empty one
    // came to forget (see the guard below).
    const withTrackMeta = (node: PatternIR): PatternIR =>
      cMeta.trackLabel === undefined
        ? node
        : ({
            ...(node as object),
            trackLabel: cMeta.trackLabel,
            ...(cMeta.dollarStart !== undefined && cMeta.dollarEnd !== undefined
              ? { dollarStart: cMeta.dollarStart, dollarEnd: cMeta.dollarEnd }
              : {}),
          } as unknown as PatternIR)

    // 0-track or 1-track from RAW. Empty Code (empty source from RAW)
    // → IR.pure() to mirror parseStrudel's empty-source behavior.
    //
    // #1384 — a COMMENTED track is empty-bodied but is still a track.
    // `extractTracks` deliberately keeps `// PR: s("bd")` so the numbering
    // stays stable when a comment prefix is toggled, and `parseStrudel` gives
    // it an `IR.pure()` body while KEEPING its trackId and its `$:`-line loc
    // (parseStrudel.ts:928). RAW threads label/dollarStart/dollarEnd here
    // correctly — but this guard returned before `cMeta` was ever read, so
    // CHAIN-APPLIED got a bare `Pure` and had nothing to build the wrapper
    // from: no loc, and `trackIdFromLabel(undefined, 0)` fell back to the
    // synthetic `d1`. A track named `PR` renamed itself the moment it was
    // commented out — #671's failure mode, narrowed to commented tracks.
    if (!input.code.trim()) return withTrackMeta(IR.pure())

    // #1375 step 2 — resolve top-level `const`/`let`/`var` bindings.
    //
    // `parseStrudel` runs `buildBindingMap` as its stage 0.5 in the no-`$:`
    // branch (parseStrudel.ts:853-871) and re-parses the final expression with
    // the resolved map. The staged pipeline never did, so `parseRoot` met a
    // bare identifier it could not resolve and the whole document fell to an
    // opaque `Code` node — the single largest group of divergences on the
    // corpus, and the reason `arrange()` behind a `const` sized a 3:28 song at
    // 0:08 (#1373).
    //
    // ⚠ THIS ARM IS THE BARE DOCUMENT'S ONLY. A `$:`/`name:` track takes the
    // `trackBindings` route on the exit below instead, because its `code` is
    // the track expression alone and `buildBindingMap` would find no `const`
    // lines in it. RAW marks a track with `trackLabel`/`dollarStart`, so their
    // absence is still the discriminator.
    //
    // It used to mean something stronger — "a `$:` track resolves NO bindings,
    // matching `parseStrudel`" — and that mirrored a real gap in the reference
    // rather than a decision (#1392). Both parsers agreeing is what kept the
    // corpus gate silent about it: a differential gate proves agreement, never
    // correctness. `parseStrudel` resolves them for every branch now, and so
    // does this pipeline.
    if (cMeta.trackLabel === undefined && cMeta.dollarStart === undefined) {
      // #1522 — the numeric map reaches the pattern collector on THIS branch
      // too. `parseStrudel` now passes it to its own `buildBindingMap`, so a
      // bare document binding `let p = arrange([M, …])` resolves there; without
      // the same argument here the two parsers answer differently on exactly
      // the documents this change is for.
      const bound = buildBindingMap(input.code, base, cMeta.trackNumbers)
      if (bound) {
        const boundParsed = parseRootWithChainMeta(
          bound.finalExpr,
          bound.finalOffset,
          bound.bindings,
          // #1514 — mirrors parseStrudel.ts:1007, which passes `numbers` on
          // this same bare-document branch.
          cMeta.trackNumbers,
        )
        // P67 (parseStrudel.ts:864-871) — if the final expression STILL
        // resolves to bare Code the map did not help, and wrapping an opaque
        // body would be worse than the existing whole-document fallback. A
        // structured `Code.via` is not bare, and is kept.
        const isBareCode =
          boundParsed.tag === 'Code' && (boundParsed as { via?: unknown }).via === undefined
        if (!isBareCode) return boundParsed
      }
    }

    // #1392 — a `$:`/`name:` track parses its expression WITH the document's
    // bindings. `undefined` for a document that declares none, which is what
    // this call passed unconditionally before.
    return withTrackMeta(
      parseRootWithChainMeta(input.code, base, cMeta.trackBindings, cMeta.trackNumbers),
    )
  }
  if (input.tag === 'Stack' && input.userMethod === undefined) {
    // Multi-track from RAW — apply parseRootWithChainMeta to each Code.
    // Phase 20-11 α-4: thread the dollarStart/dollarEnd stage-meta from
    // RAW through to the parsed root so CHAIN-APPLIED can construct the
    // Track wrapper with the correct loc.
    const tracks = input.tracks.map((t) => {
      if (t.tag !== 'Code') return t // defensive
      const tMeta = t as unknown as {
        dollarStart?: number
        dollarEnd?: number
        trackLabel?: string
        trackBindings?: ReadonlyMap<string, PatternIR>
        // #1514 — every track in a multi-`$:` document resolves its arrange
        // weights against the same document-level numeric map RAW built.
        trackNumbers?: ReadonlyMap<string, number>
      }
      // #1392 — every track in a multi-`$:` document resolves against the same
      // document-level map RAW built.
      const parsed = parseRootWithChainMeta(
        t.code,
        t.loc?.[0]?.start ?? 0,
        tMeta.trackBindings,
        tMeta.trackNumbers,
      )
      if (tMeta.dollarStart !== undefined && tMeta.dollarEnd !== undefined) {
        return {
          ...(parsed as object),
          dollarStart: tMeta.dollarStart,
          dollarEnd: tMeta.dollarEnd,
          // #671 — thread the label alongside the loc stage-meta.
          ...(tMeta.trackLabel !== undefined ? { trackLabel: tMeta.trackLabel } : {}),
        } as unknown as PatternIR
      }
      return parsed
    })
    return { ...input, tracks }
  }
  // Defensive pass-through.
  return input
}

/**
 * Single-track helper — runs parseRoot + stashes unresolvedChain
 * metadata on the resulting root. Mirrors parseExpression's logic
 * (parseStrudel.ts:126-160) but stops after parseRoot, holding the
 * chain string + offset as metadata for CHAIN-APPLIED to consume.
 *
 * Empty/whitespace expr → IR.pure() (mirrors parseExpression's guard).
 *
 * If parseRoot falls back to Code (whole expression is opaque), we
 * mirror parseExpression's branch: when chain is non-empty, return
 * Code(expr) with no chain stash; when chain is empty, return Code(expr).
 * Both branches preserve PR-A regression sentinel (T-05.c byte-equal vs
 * parseStrudel).
 */
function parseRootWithChainMeta(
  expr: string,
  baseOffset: number,
  // #1375 step 2 — the resolved top-level bindings, when this expression came
  // from a `bindings*, finalExpr` document. Threaded into `parseRoot` exactly
  // as `parseExpression` threads it (parseStrudel.ts:1367), and stashed for
  // CHAIN-APPLIED so `applyChain` resolves bound identifiers inside method
  // chains too (parseStrudel.ts:1388). `undefined` everywhere else keeps every
  // existing call byte-identical.
  bindings?: ReadonlyMap<string, PatternIR>,
  // #1514 — the document's numeric bindings, threaded exactly as `bindings` is
  // (optional trailing STACK param, PV50) so `arrange([M*2, …])` reads its
  // weight instead of declining the whole arrangement. `parseExpression`
  // threads the same map to the same `parseRoot` param (parseStrudel.ts:1628);
  // this is the copy of that call that never received it. `applyChain` takes
  // no numeric map on EITHER side, so the chain half stays at parity.
  numbers?: ReadonlyMap<string, number>,
): PatternIR {
  if (!expr.trim()) return IR.pure()
  const leadingWs = expr.length - expr.trimStart().length
  const trimmedOffset = baseOffset + leadingWs
  const trimmed = expr.trim()
  const { root, chain } = splitRootAndChain(trimmed)
  const rootIR = parseRoot(root, trimmedOffset, undefined, bindings, undefined, numbers)

  // Mirror parseExpression's Code-fallback branch (parseStrudel.ts:1371-1379):
  // when parseRoot couldn't parse the root, the entire expression is opaque
  // — return Code(expr) (no chain stash). This guarantees PR-A regression
  // sentinel byte-equality vs today's parseStrudel for opaque inputs.
  //
  // #1383 — the test must ask about `via`, not the tag alone. `Code` is TWO
  // nodes wearing one tag: the parse's give-up fallback (`via === undefined`),
  // and `wrapAsOpaque`'s STRUCTURED wrapper, which keeps the parsed chain in
  // `via` precisely so the subtree is not dropped (PV37 wrap-never-drop). Only
  // the first is opaque. `parseExpression` has discriminated between them since
  // Phase 20-14 — its own comment records that checking the tag alone "treated
  // those wrappers as opaque and discarded the entire structure" — and this
  // parallel copy never received the port, so it discarded a real subtree and
  // replaced it with the raw expression text plus a document-wide `loc`.
  //
  // That is 15 of the 20 remaining corpus divergences, and it is the quieter
  // failure of the two: the staged node is still a legal `Code`, so a
  // structural comparison calls both sides identical while `MusicalTimeline`
  // — which anchors marks by `loc` containment — collapses every hap in the
  // document onto one anchor.
  //
  // The binding call site 80 lines above (`isBareCode`) already uses this
  // form. Same discrimination, other entry.
  const rootIsBareCode =
    rootIR.tag === 'Code' && (rootIR as { via?: unknown }).via === undefined
  if (rootIsBareCode) {
    return IR.code(expr)
  }

  if (chain.trim()) {
    const chainOffset = trimmedOffset + root.length
    // Narrow-union metadata stash (D-03; RESEARCH §3.1 fallback).
    return {
      ...rootIR,
      unresolvedChain: chain,
      chainOffset,
      ...(bindings ? { unresolvedBindings: bindings } : {}),
      // #1547 — the NUMERIC map needs its own stash for the same reason the
      // pattern map has one: CHAIN-APPLIED runs in a later stage and no longer
      // holds the document. Without it `parseStrudel` resolves an arrange
      // weight inside a chain argument and this pipeline does not, which is a
      // divergence on exactly the documents the fix is for.
      ...(numbers ? { unresolvedNumbers: numbers } : {}),
    } as PatternIR
  }
  return rootIR
}

/**
 * CHAIN-APPLIED — reads `unresolvedChain` + `chainOffset` metadata from
 * each track root; calls applyChain with the chainOffset as baseOffset
 * (PK12 dot-inclusive convention preserved); drops metadata from output.
 *
 * Per RESEARCH §6 D-05 alternative: PR-A ships the REAL implementation
 * here (not a no-op stub), tested as identity-equivalent-to-today's-
 * parseStrudel-output via T-05.c regression sentinel. PR-B's split is
 * about splitting FINAL out as a polish stage, not about replacing this
 * logic.
 *
 * D-06.c: output has NO orphan unresolvedChain/chainOffset on any node.
 */
export function runChainAppliedStage(input: PatternIR): PatternIR {
  // #1553 — TWO different things arrive here as a `Stack`, and only one of
  // them is several tracks.
  //
  //   several STATEMENTS            → Stack, one child per statement
  //   ONE statement whose pattern
  //   holds a top-level comma       → Stack, one child per comma ARM
  //
  // Only the first is a multi-track document. The second is one track whose
  // root happens to be a stack, and its chain is parked on the STACK itself —
  // `parseRootWithChainMeta` stashes it by spreading onto whatever `parseRoot`
  // returned. Treating it as multi-track mapped `applyOnTrack` over the ARMS,
  // none of which carries a chain, so every call took its
  // `unresolvedChain === undefined` early return and the chain was discarded
  // with nothing recording it had existed. Not degraded, not opaque:
  // `.sound()`, `.gain()`, `.room()` and `.lpf()` ceased to exist while the
  // document still parsed into a plausible tree. Measured on the archive, 6
  // documents lost every method in their chain; one kept 7 of its 66 notes.
  //
  // THE DISCRIMINATOR IS STATEMENT PROVENANCE, and it is exact rather than
  // heuristic. RAW threads `dollarStart` onto the children of a stack it built
  // from statements — for labelled, named AND bare multi-statement documents
  // (#1376) alike — and never onto comma arms, which RAW never saw because
  // they appear only when `parseRoot` expands the mini. Over 558 documents:
  // 299 stacks where EVERY child carries `dollarStart`, 165 where NO child
  // does, and 0 mixed. A statement that itself contains a comma nests, so the
  // outer children still carry their own statement offsets.
  //
  // ⚠ THIS RETIRES #950's COMMA-ARM TRACK SPLIT ON PURPOSE. That split existed
  // so the song timeline could attribute marks per arm, and it bought that by
  // having the PARSER fabricate top-level `Track` wrappers the source never
  // declared — a presentation concern reshaping the parse tree. It is also why
  // the chain went missing: once arms are wrappers, the thing wrapping them has
  // nowhere to go. Structure is the parse's to state and marks are the eval
  // layer's to attribute, so the per-arm anchoring now lives where it belongs,
  // in `timelineMarks.ts`, deriving arm anchors from this same `Stack` via the
  // exported `armSourceSpan`. The parse says what the user wrote; the timeline
  // decides how to draw it.
  const kids = input.tag === 'Stack' ? input.tracks : []
  const fromStatements =
    kids.length > 0 &&
    kids.every((k) => (k as unknown as { dollarStart?: number }).dollarStart !== undefined)
  if (input.tag === 'Stack' && input.userMethod === undefined && fromStatements) {
    // Multi-track from MINI-EXPANDED — applyChain per track, then
    // rebuild the outer Stack via IR.stack so the FINAL shape matches
    // today's parseStrudel (`IR.stack(...tracks.map(parseExpression))`
    // at parseStrudel.ts:66) which produces `{ tag: 'Stack', tracks }`
    // with NO outer loc/userMethod. RAW's synthetic outer loc is
    // intentionally dropped here — it was only useful at the RAW tab
    // for visualizing the source span, NOT a real source-correspondence
    // for the multi-track Stack node. T-05.c regression sentinel
    // enforces byte-equality.
    //
    // Phase 20-11 α-4 — wrap each track with Track(`d${i+1}`, applied,
    // {loc: dollarStart..dollarEnd}) so the pipeline FINAL output mirrors
    // parseStrudel main path (line 110-115). dollarStart / dollarEnd were
    // threaded from RAW → MINI-EXPANDED → here as stage-meta; consume +
    // strip in applyOnTrack so the inner Track body is metadata-clean.
    return IR.stack(
      ...input.tracks.map((t, i) => {
        const tMeta = t as unknown as { dollarStart?: number; dollarEnd?: number; trackLabel?: string }
        const applied = applyOnTrack(t)
        // #950 — the Track wrapper's `loc` is what makes the arm ADDRESSABLE
        // downstream: the song timeline builds its containment-anchor map from
        // these wrappers (`declaredTrackAnchors`) and attributes every evaluated
        // hap to the lane whose anchor is the largest one ≤ the hap's own `loc`.
        //
        // `dollarStart`/`dollarEnd` only exist for arms that came from a real
        // `$:`/`name:` STATEMENT. Arms produced by expanding a top-level comma
        // inside ONE statement (`$: s("bd, cp")`) have neither, so they used to
        // get NO loc at all — the anchor map came out EMPTY, every hap fell back
        // to the engine trackId (identical for all arms of one statement), and
        // all marks piled onto the first arm while every later arm rendered as an
        // empty lane. The lanes were partitioned by IR structure and the marks by
        // statement, and for this shape the two disagree.
        //
        // The arm's OWN source span is the missing key, and it is already on the
        // applied node: `bd` at 6 and `cp` at 10 for `s("bd, cp")`. Anchoring on
        // it makes "largest anchor ≤ hap start" partition the mini string BY ARM,
        // which is the same containment rule the statement case already uses —
        // one granularity finer. Statement locs still win when present, so the
        // real-`$:` path is byte-identical.
        // Every child reaching this branch came from a STATEMENT (that is the
        // guard above), so the statement range is always the anchor. #950's
        // arm-span fallback lived here and has moved to `timelineMarks.ts`
        // with the rest of the per-arm anchoring.
        const meta =
          tMeta.dollarStart !== undefined && tMeta.dollarEnd !== undefined
            ? { loc: [{ start: tMeta.dollarStart, end: tMeta.dollarEnd }] }
            : undefined
        // #671/#737 — a real `name:` label becomes the trackId (mirrors
        // parseStrudel.ts:876); `$:` (bare label '$', incl. a muted `_$:`)
        // keeps the synthetic `d{i+1}`. The `_` mute marker is stripped so
        // identity is mute-invariant (see `trackIdFromLabel`).
        const trackId = trackIdFromLabel(tMeta.trackLabel, i)
        // #1488 — the flag has to be set on BOTH parse paths or the staged
        // pipeline stops matching `parseStrudel`, which is what
        // `stagesParityCorpus` exists to catch (and did).
        return IR.track(trackId, applied, meta, isMutedLabel(tMeta.trackLabel))
      }),
    )
  }
  // Single-track case (or any non-multi-track shape). Phase 20-11 γ-4 —
  // wrap with synthetic Track('d1', applied) to mirror parseStrudel main
  // path. NO loc and NO userMethod (synthetic-from-non-`$:`); toStrudel's
  // β-2 Track arm strips the wrap on round-trip when userMethod undefined
  // so byte identity holds. The test migration uses the unwrapD1 helper
  // (`__tests__/helpers/unwrapD1.ts`) to drill through this wrap.
  // #671 — a lone `name:` track carries its label → trackId AND its `$:`-line
  // loc (mirrors parseStrudel.ts:857); a lone `$:` (label === '$') keeps the
  // synthetic `d1` but still gets the loc; a bare pattern (no meta) stays
  // `d1` with NO loc, matching parseStrudel's no-`$:` branch.
  const sMeta = input as unknown as { trackLabel?: string; dollarStart?: number; dollarEnd?: number }
  const singleTrackId = trackIdFromLabel(sMeta.trackLabel, 0)
  const singleMeta =
    sMeta.dollarStart !== undefined && sMeta.dollarEnd !== undefined
      ? { loc: [{ start: sMeta.dollarStart, end: sMeta.dollarEnd }] }
      : undefined
  return IR.track(singleTrackId, applyOnTrack(input), singleMeta, isMutedLabel(sMeta.trackLabel))
}

/**
 * Apply chain (if any) to a single track's root; strip stage-transition
 * metadata. Returns a clean PatternIR with no unresolvedChain/chainOffset.
 */
function applyOnTrack(node: PatternIR): PatternIR {
  const m = node as {
    unresolvedChain?: string
    chainOffset?: number
    unresolvedBindings?: ReadonlyMap<string, PatternIR>
    // #1547 — stashed by MINI-EXPANDED alongside `unresolvedBindings`.
    unresolvedNumbers?: ReadonlyMap<string, number>
  }
  if (m.unresolvedChain === undefined) {
    // No chain to apply — but the metadata fields may still exist as
    // `undefined` after a `{ ...rootIR, unresolvedChain: x }` spread that
    // didn't fire. Strip defensively.
    return stripStageMeta(node)
  }
  const chain = m.unresolvedChain
  const chainOffset = m.chainOffset ?? 0
  // Strip stage-transition metadata BEFORE feeding to applyChain so
  // applyChain's output is metadata-free by construction.
  const clean = stripStageMeta(node)
  if (chain.trim()) {
    return applyChain(clean, chain, chainOffset, m.unresolvedBindings, m.unresolvedNumbers)
  }
  return clean
}

/**
 * Drop stage-transition metadata from a node (shallow). Returns a new
 * object; original is untouched. Strips:
 *   - `unresolvedChain` / `chainOffset` (PR-A precedent — 19-07)
 *   - `dollarStart` / `dollarEnd` (Phase 20-11 α-4 — Track-loc threading)
 */
function stripStageMeta(node: PatternIR): PatternIR {
  const n = node as Record<string, unknown>
  if (
    !('unresolvedChain' in n) &&
    !('unresolvedBindings' in n) &&
    !('unresolvedNumbers' in n) &&
    !('trackBindings' in n) &&
    !('trackNumbers' in n) &&
    !('chainOffset' in n) &&
    !('dollarStart' in n) &&
    !('dollarEnd' in n) &&
    !('trackLabel' in n)
  ) {
    return node
  }
  const {
    unresolvedChain: _u,
    unresolvedBindings: _ub,
    // #1547 — the numeric map's chain-stage stash. Same lifecycle as _ub:
    // consumed in CHAIN-APPLIED, stripped here so it never reaches FINAL.
    // ⚠ Missing from EITHER the guard above or this list leaks it onto a
    // FINAL node and reddens every parity assertion — which is the loud
    // failure, and the reason both halves are edited together.
    unresolvedNumbers: _un,
    // #1392 — RAW's document-level binding map. Consumed in MINI-EXPANDED;
    // stripped here so it can never reach a FINAL node body.
    trackBindings: _tb,
    // #1514 — RAW's document-level NUMERIC map. Same lifecycle as _tb:
    // consumed in MINI-EXPANDED, stripped here so it never reaches FINAL.
    trackNumbers: _tn,
    chainOffset: _o,
    dollarStart: _ds,
    dollarEnd: _de,
    // #671 — the label is CONSUMED as trackId in CHAIN-APPLIED; strip the
    // meta so it never leaks onto a FINAL node body (keeps byte-equality).
    trackLabel: _tl,
    ...clean
  } = n
  void _u
  void _ub
  void _tb
  void _tn
  void _o
  void _ds
  void _de
  void _tl
  return clean as PatternIR
}

/**
 * FINAL — identity today; reserved for future normalization passes
 * (per CONTEXT scope). Keeps the name `'Parsed'` at the STRUDEL_PASSES
 * call site for tab-persistence backward-compat (RESEARCH §3.2).
 */
export function runFinalStage(input: PatternIR): PatternIR {
  return input
}
