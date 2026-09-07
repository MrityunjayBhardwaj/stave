/**
 * parseStrudel — Strudel code string → PatternIR.
 *
 * Structural pattern matcher (not a full JS parser).
 * Handles the most common Strudel patterns by regex extraction.
 *
 * Strategy:
 * 1. Split code by $: lines → extract track blocks
 * 2. For each track: identify root function (note/s/stack)
 * 3. Parse mini-notation string argument
 * 4. Walk the method chain (.fast/.slow/.every/etc.)
 * 5. Combine tracks into Stack
 *
 * Unsupported fragments fall back to Code nodes (never throws).
 */

import { parse as acornParse } from 'acorn'
import { IR, type PatternIR, type ArrangeArm } from './PatternIR'
import type { SourceLocation } from './IREvent'
import { parseMini } from './parseMini'
import { trackIdFromLabel } from './trackId'
import { NON_TRACK_HEAD_RE } from './statementHeads'
// #928 (Tier 2) — the deny-list authority. `isControlName(m)` is Strudel's OWN
// control-registry membership predicate (main names + aliases), queried LIVE so
// the classifier never drifts from the running @strudel/core version. NEVER
// transcribe the registry into a local array — that is a second oracle (PV192,
// the class that shipped #904) and it defeats the single-authority point (PV200).
import { isControlName, getControlName } from '@strudel/core/controls.mjs'

/**
 * Build the optional `meta` payload for a non-Play smart constructor or
 * literal-construction site (19-05 / #74).
 *
 * - `method` is the user-typed method name (exact token, D-08 — e.g.
 *   `'degradeBy'` ≠ `'degrade'`, `'jux'` ≠ `'layer'`). Sites that pass
 *   the live `method` variable from `applyMethod` automatically satisfy
 *   D-08; desugar / root sites that hard-code a method string must match
 *   the user's vocabulary.
 * - `callSiteRange` is the absolute source range of the method-call
 *   substring (e.g., `.fast(2)`'s start..end in the user's full code).
 *
 * Returns the shape every smart constructor / literal-construction site
 * accepts. Loc is single-element here — multi-element only arises in
 * mini-notation `!N` repetition (not implemented today). RESEARCH §10 #12
 * for the load-bearing arithmetic gotcha (consumed = remaining - rest).
 */
export function tagMeta(
  method: string,
  callSiteRange: [number, number],
): { loc: SourceLocation[]; userMethod: string } {
  const [start, end] = callSiteRange
  return {
    loc: [{ start, end }],
    userMethod: method,
  }
}

/**
 * Phase 20-04 (PV37 / PK13 step 2 / D-01..D-03).
 *
 * Wrap a receiver pattern as an opaque Code-with-via node carrying the
 * full source range of the .method(args) call site. Used by:
 *   - applyMethod's default arm (any unrecognised method — DV-06)
 *   - typed arms' parse-failure branches (D-03 — e.g. .fast("<2 3>"))
 *
 * The wrapper preserves the typed source for round-trip (toStrudel re-emits
 * via.method/args verbatim per D-02) AND for collect (walks via.inner;
 * threads loc per D-01 via withWrapperLoc, which lands in 20-03).
 *
 * `args` MUST be passed RAW (untrimmed) — D-02 byte-fidelity contract.
 * `code: ''` is unused on the wrapper path (`toStrudel` branches on `via`).
 *
 * Known v1 limitation (Trap 5): argless unrecognised methods round-trip
 * with empty parens — `note("c").nudge` becomes `note("c").nudge()`.
 * Documented in PR description; fixtures avoid argless probes.
 *
 * @param inner Receiver IR (required — D-01 walks it).
 * @param method Raw method name as the user typed it.
 * @param args Raw arg string between parens (whitespace preserved).
 * @param callSiteRange Absolute source range of the entire .method(args) substring.
 */
function wrapAsOpaque(
  inner: PatternIR,
  method: string,
  args: string,
  callSiteRange: [number, number],
): PatternIR {
  return {
    tag: 'Code',
    code: '',                                // unused on wrapper path; toStrudel branches on via
    lang: 'strudel',
    loc: [{ start: callSiteRange[0], end: callSiteRange[1] }],
    via: { method, args, callSiteRange, inner },
  }
}

/** Test-only re-export of the module-private wrapAsOpaque helper. Mirrors
 *  the `__resetParseTransformDebug` convention below; not part of the
 *  public API. Consumed by PatternIR.test.ts wave-α probes. */
export const __test_wrapAsOpaque = wrapAsOpaque

/**
 * Phase 20-17 G3 (D-02 CORRECTION) — classify a STRICT bare-literal RHS
 * and return a structured `Code.via = {literal:true; raw}` node, or `null`.
 *
 * STRICT scope (the matcher line — LOCKED per CONTEXT D-02 CORRECTION
 * 2026-05-19): ONLY bare literals match:
 *   - number:               any JS numeric literal (`isNumericLiteral`)
 *   - plain double-quoted:  `^"[^"]*"$`
 *   - plain single-quoted:  `^'[^']*'$`
 *   - enumerated arithmetic: `^NUM(WS op WS NUM)+$` where op ∈ {/ * + -}
 *     and NUM is the number token above (Phase 20-22 D-02; F3 verbatim).
 *
 * ENUMERATED ARITHMETIC GRAMMAR (Phase 20-22 D-02 — the verdict lever):
 * a STRICT closed token set — number literals joined by exactly the four
 * operators `/ * + -` with optional inter-token spaces only. This is the
 * matcher-not-interpreter line: `via.raw` is the source text byte-verbatim
 * (`172/4` stays the string `"172/4"`, we NEVER compute `43`). Strudel
 * evaluates the arithmetic natively at runtime. WHY this matters: before
 * this arm, `classifyLiteralRhs('172/4')` returned `null` → the binding
 * never left `pending` → `buildBindingMap`'s occurs-check terminal
 * (`if (pending.size > 0) return null`) bailed the WHOLE binding map → the
 * entire program bareCoded EVEN IF the binding was unreferenced. Admitting
 * arithmetic clears `pending`, the map builds, the program structures.
 *
 * EXPLICITLY OUT (stays `null` → graceful bare Code, never widened —
 * the P70 / #140 γ-4 scope-creep-into-interpreter trap): parens `(1+2)/3`,
 * calls `foo(2)`, operand identifiers `bpm/2`, `${}`-templates, operators
 * not in the set (`**` `%` `<<`), leading/trailing op, empty. Each falls
 * through to `null`. The grammar is CLOSED (no recursion, no idents, no
 * calls) — admitting any of those would be the interpreter trap.
 *
 * `4 + 1` now matches (arithmetic arm); `${}`-template, any call, any
 * array/object, any concat, any operand-ident → `null`. The caller keeps
 * bare Code → the opaque fence (`tag === 'Code' && via === undefined`)
 * fires correctly.
 *
 * SEMANTICS: substitution of a literal is **term-splicing, NEVER
 * evaluation**. `via.raw` is the source text byte-verbatim — `4` stays
 * the string `"4"`, never the number `4`. The byte-exact round-trip is
 * the named acceptance check (`.slow(numChords)` → `.slow(4)` byte-for-byte
 * after Wave E wires the helper into buildBindingMap; code-invariance per
 * P62).
 *
 * This helper is the **provenance source consumed by E-1** — Wave E's
 * bounded fixpoint loop calls it post-parse at each iteration; D-1a ships
 * only the type widen + this named helper, NOT the call site (avoids a
 * throwaway single-pass literal call before the fixpoint restructure).
 */
/**
 * Phase 20-22 D-02 — the enumerated-arithmetic grammar (F3 verbatim).
 * Module-level consts so they compile once AND give the P68 dist/ grep a
 * stable literal anchor (`ARITH_RHS`). NUM is the existing number token;
 * ARITH_RHS requires AT LEAST ONE operator (a lone number already matches
 * the existing bare-number arm). Operators are EXACTLY `/ * + -`;
 * parens / calls / idents are structurally impossible to match (no `(`,
 * no letters) → graceful `null`.
 */
/**
 * Is this token a JS numeric literal? (#957)
 *
 * THE SINGLE ANSWER. This question was transcribed as `/^-?\d+(\.\d+)?$/` in
 * THREE separate places, and that transcription rejects `.5` — so `.gain(.8)`
 * opaqued, `const beat = .5` never classified as a literal binding, and a bare
 * `.5` in a `.pick([...])` list failed to wrap. Fixing one site left the other
 * two live; the duplication IS the bug, so the fix is one function.
 *
 * We do not describe JS's number grammar, we ask JS. `Number` accepts every
 * literal form (`.5`, `5.`, `+5`, `1e-3`, `0x10`) and returns NaN for anything
 * that is not one — expressions, identifiers, `5abc`. Two guards: `Number('')`
 * and `Number(' ')` are 0 rather than NaN, and `isFinite` keeps `Infinity`/
 * `NaN` spellings out of fields the IR serialises as JSON.
 */
export function isNumericLiteral(token: string): boolean {
  const t = token.trim()
  return t !== '' && Number.isFinite(Number(t))
}

/**
 * Phase 20-22 D-02 — the enumerated-arithmetic grammar, operand-delegated.
 *
 * Splits on the four operators and asks `isNumericLiteral` about each operand,
 * instead of embedding a second copy of the number token in a bigger regex.
 * The lookbehind is what keeps a SIGN attached to its operand: a `-` or `+`
 * only ends an operand when a digit or `.` precedes it, so `-0.5` and the
 * exponent in `1e-3` stay whole while `0.5-2` splits.
 *
 * The grammar stays CLOSED, which is the point of this arm (the P70 / #140
 * γ-4 interpreter trap): no parens, no calls, no identifiers. Those now fail
 * because an operand fails `isNumericLiteral`, not because a regex could not
 * spell them — `(1+2)/3` splits to `(1`, `2)/3`; `bpm/2` never splits at all
 * and is rejected as a single non-numeric operand; `2**3` splits to `2`, `*3`.
 * Still a matcher, never an interpreter: `via.raw` is spliced byte-verbatim
 * and `172/4` is never computed to `43`.
 */
const ARITH_SPLIT = /(?<=[\d.])[ \t]*[/*+\-][ \t]*/

function isEnumeratedArithmetic(token: string): boolean {
  const parts = token.split(ARITH_SPLIT)
  return parts.length > 1 && parts.every(isNumericLiteral)
}

export function classifyLiteralRhs(
  rhs: string,
): { tag: 'Code'; code: string; lang: 'strudel'; via: { literal: true; raw: string } } | null {
  const t = rhs.trim()
  const isNum = isNumericLiteral(t)
  const isDq = /^"[^"]*"$/.test(t)
  const isSq = /^'[^']*'$/.test(t)
  // Phase 20-22 D-02: the enumerated-arithmetic arm. Same `{literal:true;
  // raw}` node shape (no new union arm → PV52 obligation not newly
  // triggered). `raw` = the trimmed source VERBATIM (matcher, not
  // interpreter — we never evaluate `172/4` to `43`).
  const isArith = isEnumeratedArithmetic(t)
  if (!(isNum || isDq || isSq || isArith)) return null
  return { tag: 'Code', code: t, lang: 'strudel', via: { literal: true, raw: t } }
}

/**
 * Is this token a bare ES identifier, and nothing else?
 *
 * ONE authority for the question, because two callers now ask it and they must
 * agree: `substituteBoundIdentInArg` (is this arg a name I can resolve to its
 * binding?) and `parseNamedPickEntries` (#1456 — is this colon-less property
 * object shorthand, or something I must not pretend to understand?). Both are
 * really the same question, and a shorthand key that the substituter would not
 * recognise as a name would be a silent disagreement between them.
 *
 * Deliberately NOT the full ES identifier grammar (no unicode escapes, no
 * reserved-word check) — it is a conservative admission test, so anything it
 * declines simply keeps the existing opaque fallback (PV37).
 */
function isBareIdent(t: string): boolean {
  return /^[A-Za-z_$][\w$]*$/.test(t)
}

/**
 * Phase 20-22 D-01 — round-trip fidelity primitive (F1 option iii).
 *
 * If `args` is EXACTLY a single bare identifier bound to a LITERAL-arm
 * node in `bindings`, return that binding's raw RHS text (`via.raw`);
 * otherwise return `args` UNCHANGED. This is the code-invariance the
 * debugger / bidirectional-editing thesis (PV38) needs: `.slow(n)` with
 * `var n = 4` should round-trip to `args="4"`, not `args="n"`.
 *
 * It reads the raw text off the EXISTING literal-arm `via.raw` — NO new
 * binding-map value shape, NO PV52 ripple (the value stays `PatternIR`).
 * `bindings` is the trailing optional param (PV50 — stack-threaded, never
 * module state). It NEVER evaluates: returns raw text only (matcher line).
 *
 * F2 FENCE (the load-bearing loc-fidelity risk, PV49): the returned string
 * is consumed in EXACTLY TWO loc-safe positions —
 *   (1) value operands of recognised NUMERIC arms (`parseFloat(args)` →
 *       the tag's `loc` is the unchanged `callSiteRange`; the substituted
 *       text becomes a parsed scalar and NEVER a loc anchor), and
 *   (2) `via.args` round-trip text on opaque wrappers (a code-invariance
 *       string, NOT a loc anchor; `wrapAsOpaque`'s `callSiteRange` is
 *       computed independently of `args`).
 * It MUST NOT be routed into any path that re-parses a mutated string into
 * loc-bearing mini-notation leaves at the use site (forbidden F2 position
 * 3 — that breaks `src.slice(loc.start, loc.end)` fidelity). String→mini-
 * leaf cases ALREADY structure via the existing subtree splice
 * (parseStrudel.ts:1131/1248/1430) — that path is left untouched.
 *
 * PV52 guard: only the `{literal:true; raw}` arm is substituted. The
 * opaque-wrapper arm (`via.inner` present) and Pattern-valued (non-`Code`)
 * bindings return `args` unchanged (they keep the subtree-splice path).
 * This is the single new `bindings.get()` reader (the one new
 * PV52/PV53 audit point).
 */
function substituteBoundIdentInArg(
  args: string,
  bindings?: ReadonlyMap<string, PatternIR>,
): string {
  if (!bindings) return args
  const t = args.trim()
  if (!isBareIdent(t)) return args
  const node = bindings.get(t)
  if (!node) return args
  // PV52 discriminated-union guard — only the literal arm carries `raw`.
  if (
    node.tag === 'Code' &&
    (node as { via?: unknown }).via !== undefined &&
    'literal' in ((node as { via: object }).via)
  ) {
    return (node as { via: { raw: string } }).via.raw
  }
  return args
}

/** Test-only re-export of the module-private substituteBoundIdentInArg
 *  helper (Phase 20-22 D-01). Mirrors the `__test_wrapAsOpaque`
 *  convention; not part of the public API. */
export const __test_substituteBoundIdentInArg = substituteBoundIdentInArg

/**
 * Phase 20-14 parser-gap fix — strip a "prelude" from non-`$:` Strudel
 * programs so the musical expression that follows parses to a structured
 * IR instead of the Code() fallback.
 *
 * A prelude is the sequence of leading lines that are either:
 *   - blank
 *   - a `// …` line comment (whole-line; inline `// …` after expression
 *     code is untouched)
 *   - a TOP-LEVEL call to a recognised boot-side-effect function:
 *     `samples(…)`, `useRNG(…)`, `setcps(…)`, `setVoicingRange(…)`,
 *     `initAudio(…)`, `aliasBank(…)`, and the tempo-setter family
 *     `setcpm(…)` / `setCpm(…)` / `setCps(…)` (#135 / 20-15 G2). The call
 *     may span multiple lines
 *     (multi-line `samples({ … })` is the common case); we track paren /
 *     brace / bracket depth across newlines and consume the whole call
 *     as one unit. The call ends at the line whose end-of-line depth is
 *     zero AND whose final non-whitespace char is `)` (allowing a
 *     trailing `;` per `bassFuge.strudel`).
 *
 * Returns the substring from the first non-prelude line plus the absolute
 * char offset where that substring starts in the ORIGINAL `code`. Callers
 * thread `offset` into `parseExpression` so every `loc.start` derived from
 * the parser is still a valid index into the user-typed source.
 *
 * Forms NOT skipped (fall through to existing Code() fallback at the
 * call site, same shape as today):
 *   - `let` / `const` / `var` bindings
 *   - `await` / arbitrary statements
 *   - any function we haven't enumerated here
 * If a corpus tune surfaces another prelude form, add it to the regex
 * below — explicit list is intentional, not an open-ended skip.
 */
export function stripParserPrelude(code: string): { body: string; offset: number } {
  // Top-level boot-side-effect calls we recognise. Exact tokens — D-08
  // (no aliasing). Anchored to the start of the trimmed line.
  //
  // SETTER FAMILY PROVENANCE (#135 / 20-15 G2) — HAND-MAINTAINED LIST.
  // Upstream source audited: `packages/core/repl.mjs` (uzu/strudel) at
  // pinned Codeberg SHA f73b395648645aabe699f91ba0989f35a6fd8a3c
  // (the same SHA pinned in
  // packages/app/tests/parity-corpus/CORPUS-SOURCE.md).
  //   - repl.mjs:284-287  `setCps  = (cps) => { scheduler.setCps(unpure(cps)); return silence }`
  //   - repl.mjs:301-303  `setCpm  = (cpm) => { scheduler.setCps(unpure(cpm)/60); return silence }`
  //   - repl.mjs:393-400  `evalScope({ ... setCps, setcps: setCps, setCpm, setcpm: setCpm })`
  // i.e. the top-level tempo-setter family is exactly
  // {setcps, setCps, setcpm, setCpm} — all pure no-return side effects
  // (they mutate the scheduler tempo and return `silence`, which the user
  // discards at statement level — identical class to the already-present
  // `setcps`). Tokens ADDED by 20-15 G2 beyond the existing `setcps`:
  // `setcpm`, `setCpm`, `setCps`. No other `set*` in core's evalScope
  // (all/each/hush/cpm) is a top-level pure setter — `cpm` is a chain
  // method (`register('cpm',…)`), `all`/`each` take pattern transforms,
  // `hush` is a silence control — NONE are prelude boot calls.
  //
  // There is NO programmatic cross-ref: the upstream setter export list
  // is NOT vendored in this repo, so this regex is hand-maintained. The
  // anti-drift mechanism is (a) this comment's file:line + SHA citation
  // and (b) one CI fixture per setter (task V-3). #135's premise that the
  // 20-14 α-6 `settingPatterns` audit is the authoritative source is a
  // MISREAD: α-6 covers strudel.cc UI setters {theme,fontFamily,fontSize}
  // (20-14-OBSERVATIONS.md:13-71) — those are CHAIN methods
  // (`$: theme("dracula")`), UI-only (`onTrigger(...,false)` = no audio),
  // NOT top-level tempo boot calls. α-6 is therefore NOT the source for
  // THIS list; the @strudel/core repl.mjs audit above is.
  const PRELUDE_CALL_RE =
    /^[ \t]*(?:samples|useRNG|setcps|setCps|setcpm|setCpm|setVoicingRange|initAudio|aliasBank)\s*\(/

  // #143 (20-15 V-1 backlog) — SECOND line classifier: a guarded boot
  // side-effect of the defensive idiom
  // `typeof X !== 'undefined' && X(...)` (sample `-7LU6zgzViSM`,
  // "Doubly-Linked Liszt"). It is NOT matched by PRELUDE_CALL_RE (the
  // line starts with `typeof`, not a recognised call name). This is a
  // RECOGNITION extension only (issue #143 scope — explicitly NOT
  // evaluation): once the line is classified as prelude, the EXISTING
  // multi-line depth walker (pS:~205) consumes the `&& X(...)` call to
  // depth 0 UNCHANGED — the walker only needs `sawOpenParen` + a
  // depth-0 close, which `X(...)` provides; the leading
  // `typeof X !== '…' &&` is plain non-paren/non-brace text the walker
  // already walks past.
  //
  // R2 ANTI-DRIFT (mandatory, mirrors the PRELUDE_CALL_RE provenance
  // block above): this guarded-boot idiom is a HAND-MAINTAINED skip
  // shape — there is NO programmatic cross-ref (the upstream Bakery
  // corpus is not vendored). The anti-drift mechanism is (a) this
  // comment + the Codeberg pin SHA f73b395648645aabe699f91ba0989f35a6fd8a3c
  // (same SHA as packages/app/tests/parity-corpus/CORPUS-SOURCE.md) and
  // (b) the per-shape CI fixture `bakery-143-guarded-boot.strudel`
  // (task V-2). The shape mirrors the V-1 classifier
  // `_bakery-classify.spec.ts:53` (`typeof\s+\w+\s*!==?\s*['"]undefined['"]\s*&&`)
  // so the recogniser and the classifier stay in lockstep.
  //
  // PV49 R1 DIVERGENCE (deliberate): this is a LINE classifier — it is
  // intentionally NOT routed through `skipWhitespaceAndLineComments`
  // (the inter-token walker primitive), exactly the same structural
  // class as the existing `PRELUDE_CALL_RE` whole-line skip. The PV49
  // primitive governs inter-ELEMENT scanning; whole-line prelude
  // classification is a different (R1-divergent) concern.
  const GUARDED_BOOT_RE =
    /^[ \t]*typeof\s+\w+\s*!==?\s*['"]undefined['"]\s*&&\s*\w+\s*\(/

  let i = 0
  while (i < code.length) {
    // Walk to end of current line (exclusive of '\n').
    let lineEnd = code.indexOf('\n', i)
    if (lineEnd === -1) lineEnd = code.length
    const line = code.slice(i, lineEnd)
    const trimmed = line.trim()

    // 1. Blank line — skip and advance past the newline.
    if (trimmed === '') {
      i = lineEnd + 1
      continue
    }

    // 2. Whole-line comment — skip.
    if (trimmed.startsWith('//')) {
      i = lineEnd + 1
      continue
    }

    // 3. Top-level recognised prelude call — possibly multi-line.
    //    Either a direct boot call (PRELUDE_CALL_RE) OR the #143
    //    guarded-boot idiom `typeof X !== 'undefined' && X(...)`
    //    (GUARDED_BOOT_RE). Both route into the SAME unchanged depth
    //    walker — recognition widens, the consume mechanism does not.
    if (PRELUDE_CALL_RE.test(line) || GUARDED_BOOT_RE.test(line)) {
      // Track paren/brace/bracket depth + string state from the line start,
      // advancing across newlines until depth returns to zero AT THE END
      // OF A LINE whose final non-ws char is `)` (allow trailing `;`).
      let j = i
      let depth = 0
      let inString = false
      let stringChar = ''
      let escaped = false
      let sawOpenParen = false
      while (j < code.length) {
        const ch = code[j]
        if (escaped) {
          escaped = false
          j++
          continue
        }
        if (inString) {
          if (ch === '\\') {
            escaped = true
          } else if (ch === stringChar) {
            inString = false
          }
          j++
          continue
        }
        if (ch === '"' || ch === "'" || ch === '`') {
          inString = true
          stringChar = ch
          j++
          continue
        }
        if (ch === '(' || ch === '[' || ch === '{') {
          depth++
          if (ch === '(') sawOpenParen = true
          j++
          continue
        }
        if (ch === ')' || ch === ']' || ch === '}') {
          depth--
          j++
          // When depth returns to zero AFTER seeing at least one '(', the
          // call body is closed. Consume any trailing `;`, then advance to
          // the next line and resume prelude scan.
          if (depth === 0 && sawOpenParen) {
            // Allow optional `;` + horizontal whitespace before EOL.
            while (j < code.length && (code[j] === ' ' || code[j] === '\t' || code[j] === ';')) {
              j++
            }
            // Advance past the newline (if any) so the outer loop
            // starts at the next line.
            if (j < code.length && code[j] === '\n') j++
            break
          }
          continue
        }
        if (ch === '\n') {
          j++
          continue
        }
        j++
      }
      // Defensive: if depth never closed (malformed source), stop the
      // prelude scan here and let the body parser handle whatever remains.
      // We do NOT consume the malformed call.
      if (depth !== 0) break
      i = j
      continue
    }

    // 4. Anything else — first body line. Stop here.
    break
  }

  return { body: code.slice(i), offset: i }
}

/**
 * 20-15 G1 (#134 / D-02) — minimal single-assignment binding map.
 *
 * NEW PK16(b) stage 0.5 — runs AFTER prelude-strip (stage 1; prelude still
 * does NOT skip let/const, pS:~127) and BEFORE splitRootAndChain (stage 2).
 *
 * Scope (D-02, the matcher-not-interpreter line — DO NOT cross it):
 *   - ONLY `let/const/var x = <pattern>` where `x` is a SINGLE identifier
 *     (destructuring `{a}=`/`[a]=` does not match `[A-Za-z_$]` → returns
 *     null → caller falls back to whole-program Code).
 *   - Each name defined EXACTLY ONCE (reassignment/shadowing → null).
 *   - No use-before-def is enforced at the SUBSTITUTION site (a ref whose
 *     name is not yet in the map when its arg is resolved → not
 *     substituted → that arg parses as a bare ident → bare Code → the
 *     stack arm's existing fallback → whole expression Code; topology
 *     preserved, never a crash).
 *   - The RHS is parsed via `parseExpression` and KEEPS its definition-site
 *     source offsets (R6 — click-to-source lands on the DEFINITION).
 *   - RHS that itself parses to bare Code → null (the binding is opaque;
 *     do not pretend it is structured).
 *
 * Returns:
 *   - `null` when the body is NOT a clean "N bindings then one final
 *     expression" shape, or any D-02 violation → caller MUST fall back to
 *     the existing whole-program `IR.code(code)` (topology-preserving, one
 *     Code node — NEVER a throw; the parseStrudel try/catch stays the last
 *     resort, not the mechanism).
 *   - `{ bindings, finalExpr, finalOffset }` on success; `bindings` is the
 *     resolved subtree map, `finalExpr`/`finalOffset` the trailing
 *     non-binding expression + its absolute offset into ORIGINAL source.
 */
/**
 * Characters that CANNOT begin a new statement, so a depth-0 newline before one
 * is a line continuation rather than a boundary — JS's own ASI rule, which does
 * not insert a semicolon when the next line opens with any of these.
 *
 * `.` (the leading-dot method chain, #148) was the only member for a long time
 * because this walker fed `buildBindingMap`, whose shape fence rejects anything
 * odd — so an over-split cost nothing visible. #1096 promoted the walker to
 * deciding what a bare document's TRACKS are, where an over-split invents a row.
 * `stack\n(…)` (#901) is the case that surfaced it: `stack` and `(…)` became two
 * statements, and a legal one-call document grew a second, meaningless track.
 *
 * Erring toward CONTINUATION is the safe direction: a missed split falls back to
 * the single-Track shape this branch has always produced, while a wrong split
 * fabricates a track the document never declared.
 */
const STMT_CONTINUATION_STARTS = new Set([
  '.', '(', '[', '`', ',', '+', '-', '*', '/', '%', '?', ':', '&', '|', '<', '>', '=',
])

export function splitTopLevelStatements(
  body: string,
  baseOffset: number,
): { text: string; offset: number }[] {
  // Split on `;` or newline at depth 0, string/comment aware. REUSE the
  // lexStateAt walker discipline inline (PV49 spirit) — a statement
  // boundary is a `;`/`\n` that is at brace/paren/bracket depth 0 and not
  // inside a string/template/`//` comment.
  const out: { text: string; offset: number }[] = []
  let depth = 0
  let inString = false
  let stringChar = ''
  let escaped = false
  let segStart = 0
  let i = 0
  const flush = (end: number): void => {
    const raw = body.slice(segStart, end)
    if (raw.trim().length > 0) {
      // #151 / #152: strip `/* … */` blocks AND `//` line-comments from
      // the segment's residue; if nothing executable remains, skip.
      // Prevents comment-only physical lines (and trailing `/* … */`
      // blocks left between real statements) from becoming phantom
      // statements after a depth-0 `\n` flush. Inline trailing `// …`
      // on a code line is unaffected (the line's residue is the code).
      const stripped = raw
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .map((line) => line.replace(/\/\/.*$/, ''))
        .join('\n')
        .trim()
      if (stripped.length > 0) {
        const lead = raw.length - raw.trimStart().length
        out.push({ text: raw.trim(), offset: baseOffset + segStart + lead })
      }
    }
    segStart = end + 1
  }
  while (i < body.length) {
    const ch = body[i]
    if (escaped) {
      escaped = false
      i++
      continue
    }
    if (inString) {
      if (ch === '\\') escaped = true
      else if (ch === stringChar) inString = false
      i++
      continue
    }
    if (ch === '/' && body[i + 1] === '/') {
      while (i < body.length && body[i] !== '\n') i++
      continue
    }
    if (ch === '/' && body[i + 1] === '*') {
      // #152: skip `/* … */` block comments (the segmenter walked their
      // content as code before, so any depth-0 `\n` inside the block
      // flushed). Mirror of the `//` skip's structure.
      i += 2
      while (i < body.length && !(body[i] === '*' && body[i + 1] === '/')) i++
      if (i < body.length) i += 2 // consume the closing `*/`
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      inString = true
      stringChar = ch
      i++
      continue
    }
    if (ch === '(' || ch === '[' || ch === '{') {
      depth++
      i++
      continue
    }
    if (ch === ')' || ch === ']' || ch === '}') {
      depth--
      i++
      continue
    }
    if (depth === 0 && ch === ';') {
      // Explicit JS terminator — always flush (ASI: `;` ends the
      // statement even when the next non-ws char is `.`).
      flush(i)
      i++
      continue
    }
    if (depth === 0 && ch === '\n') {
      // ASI / line-continuation aware (#148, PK16 stage-0.5 input).
      // Two cases suppress the depth-0 `\n` flush; both are recognition
      // only (matcher line, no eval):
      //   (a) #148 forward-peek for `.` — leading-dot multi-line method
      //       chain continuation (`sound("x")\n  .gain(...)`). Peek past
      //       whitespace + `//` line-comments via the PV49 primitive.
      //   (b) #150 backward-peek for `=` — binding RHS on next line
      //       (`const harm2 = \n  chords2.voicings(...)`). `=` is not a
      //       JS statement terminator. Skip backward over whitespace;
      //       if the last non-ws char is `=`, do NOT flush.
      // Either suppression: do not flush, keep walking; the segment
      // accumulates across the physical line break.
      const peek = skipWhitespaceAndLineComments(body, i + 1)
      if (STMT_CONTINUATION_STARTS.has(body[peek])) {
        i++
        continue
      }
      let k = i - 1
      while (k >= segStart && /\s/.test(body[k])) k--
      if (k >= segStart && body[k] === '=') {
        i++
        continue
      }
      flush(i)
      i++
      continue
    }
    i++
  }
  flush(body.length)
  return out
}

/**
 * 20-19 (#158) — filter statements that configure or load rather than play out
 * of the stmts array BEFORE `buildBindingMap` consumes it, so a program shaped
 * `bindings*, sideEffect, finalExpr` becomes the `bindings*, finalExpr` shape
 * the shape guard already accepts. Also the population #1096's bare branch
 * declares tracks over.
 *
 * ⚠ THE LIST LIVES IN `statementHeads.ts`, NOT HERE (#1178). It used to be a
 * regex spelled out at this line, alongside a DIFFERENT list in the Mixer doing
 * the same job — and the two disagreed for 14 of 55 bare corpus documents,
 * which is what a positional meter key cannot survive. One list, two readers;
 * the grounding for every token lives with the list.
 *
 * PV49 loc-additive by construction (filter() removes items; the remaining
 * items' `offset` fields are untouched; the source string is never mutated).
 */
export function stripSideEffectStatements(
  stmts: { text: string; offset: number }[],
): { text: string; offset: number }[] {
  return stmts.filter((s) => !NON_TRACK_HEAD_RE.test(s.text))
}

export const BINDING_RE = /^(?:let|const|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([\s\S]+)$/

/**
 * The leading run of top-level bindings, resolved — the ENGINE half of
 * `buildBindingMap`, with the "and exactly one expression follows" fence lifted
 * off it (#1392).
 *
 * ── WHY THE SPLIT EXISTS ────────────────────────────────────────────────────
 * What an identifier MEANS is a property of the DOCUMENT. It was a property of
 * one branch of `parseStrudel`'s track dispatch: the no-`$:` branch called
 * `buildBindingMap`, and both `$:` branches passed `undefined` for `bindings`,
 * so every `$:`-declared track lost binding resolution entirely. Measured on
 * `76e42d9e` — opaque `Code` nodes left in the tree:
 *
 *   arrange([4, a], [8, b])        0      $: arrange([4, a], [8, b])     2
 *   stack(a, b)                    0      $: stack(a, b)                 2
 *                                         $: a                           1
 *                                         drums: stack(a, b)             2
 *
 * `$:` is the ordinary way to declare a track, so the ordinary document lost
 * its bindings — and an arm that stays `Code` yields no leaves, hence no
 * `armIndex`, hence NO CLIPS on the timeline at all.
 *
 * ⚠ ONE ENGINE, NOT TWO. The fixpoint below is the only place bindings resolve.
 * This file already warns that inventing per-statement binding semantics beside
 * it would be "a second, weaker `buildBindingMap`" — so the fix EXTRACTS rather
 * than reimplements, and `buildBindingMap` is now a caller of it.
 *
 * Returns `null` on every shape the old fence rejected: no bindings at all, no
 * trailing statement, a duplicate name (reassignment/shadowing), or an RHS that
 * stays opaque once every other binding has resolved (cyclic or genuinely
 * unparseable). `null` means "resolve nothing", never a partial map.
 */
export function collectTopLevelBindings(
  body: string,
  baseOffset: number,
):
  | { bindings: ReadonlyMap<string, PatternIR>; tail: readonly { text: string; offset: number }[] }
  | null {
  const stmts = stripSideEffectStatements(
    splitTopLevelStatements(body, baseOffset),
  )
  if (stmts.length < 2) return null // need ≥1 binding + ≥1 trailing statement

  // 20-17 E-1 — descriptor list + bounded least-fixpoint.
  //
  // FIRST PASS (kept γ-3 fences UNCHANGED — predicates byte-identical):
  //   - `< 2 statements` (above)
  //   - dup-key (`bindings.has(name)` → `seen.has(name)` keyed on the
  //     in-progress descriptor list, first-dup-wins)
  //   - BINDING_RE LHS filter
  // The one fence that MOVED (#1392) is the shape check
  // (`finalIdx !== stmts.length - 1`): it now lives in `buildBindingMap`, which
  // still wants exactly one trailing expression, while the engine itself
  // accepts N — a `$:` document's tail is one statement per track.
  // Build `descs = [{ name, rhs, rhsOffset }, …]`. The RHS-absolute
  // offset (`rhsOffset = offset + rhsStartInText`) is computed ONCE here
  // and STORED on the descriptor — never recomputed inside the fixpoint
  // (the 20-16 lesson: silent offset drift comes from re-basing
  // mid-loop; the def-site arithmetic is fixed at first pass).
  const descs: { name: string; rhs: string; rhsOffset: number }[] = []
  const seen = new Set<string>()
  let tailIdx = -1
  for (let s = 0; s < stmts.length; s++) {
    const { text, offset } = stmts[s]
    const bm = text.match(BINDING_RE)
    if (!bm) {
      // First non-binding statement opens the TAIL. Bindings are the leading
      // run only; anything binding-shaped after this point is not part of the
      // map (a trailing binding is what `buildBindingMap`'s shape fence
      // rejects, and the tail is what a `$:` document's tracks live in).
      tailIdx = s
      break
    }
    const name = bm[1]
    const rhs = bm[2].trim()
    // D-02: reassignment / shadowing (duplicate name) → fallback.
    if (seen.has(name)) return null
    seen.add(name)
    // RHS absolute offset = statement offset + (where rhs starts in text).
    const rhsStartInText = text.length - rhs.length // bm[2] was end-anchored, then trimmed
    const rhsOffset = offset + rhsStartInText
    descs.push({ name, rhs, rhsOffset })
  }
  if (tailIdx === -1) return null // all statements were bindings, nothing to play
  if (descs.length === 0) return null // no bindings → nothing to resolve

  // BOUNDED LEAST-FIXPOINT (Datalog discipline: total + PTIME +
  // order-independent + occurs-check stratified):
  //   - Iterate up to `descs.length` times: in a non-cyclic graph each
  //     iter resolves ≥1 new descriptor, so all resolve within N iters.
  //   - At each iter, re-parse every pending RHS with the partially-
  //     resolved `bindings` map. Apply D-1a's `classifyLiteralRhs`
  //     POST-PARSE (literal-RHS arm consumes the named helper). If the
  //     result is non-bareCode, add to `bindings` + drop from pending +
  //     mark progress.
  //   - Exit on `pending.size === 0` OR `!progress` (monotone — each
  //     iter only ADDS; cycles + persistently-opaque RHSs trigger
  //     `!progress` early exit). Belt-and-suspenders: iter-bound AND
  //     progress-check; either alone suffices.
  const bindings = new Map<string, PatternIR>()
  const pending = new Set<number>(descs.map((_, i) => i))
  for (let iter = 0; iter < descs.length && pending.size > 0; iter++) {
    let progress = false
    for (const i of [...pending]) {
      const d = descs[i]
      const parsed = parseExpression(d.rhs, d.rhsOffset, undefined, bindings)
      // D-1a provenance: classifyLiteralRhs is the NAMED helper defined
      // in Wave D (D-1a). E-1 consumes it POST-PARSE so a bare literal
      // RHS becomes the structured {literal:true;raw} Code-with-via node
      // instead of bareCode (the D-1c consumer audit guards every
      // production via-reader against the literal arm).
      const lit = classifyLiteralRhs(d.rhs)
      // 20-17 E-1 precedence (within D-02 CORRECTION "strict scope; bare
      // literals only; substitution never downgrades a richer parsed
      // tree"). The classifyLiteralRhs regex `^"[^"]*"$` cannot
      // syntactically distinguish a plain string from a Strudel mini-
      // pattern string ("<Gsus G7 Em7 D7>" matches both). Encode the
      // bare-only intent via precedence: prefer the literal arm ONLY
      // when `parsed` is itself bareCode (no richer structured IR to
      // preserve). Strict improvement — never downgrade.
      const parsedIsBareCode =
        parsed.tag === 'Code' && (parsed as { via?: unknown }).via === undefined
      const ir = parsedIsBareCode ? (lit ?? parsed) : parsed
      const bare =
        ir.tag === 'Code' && (ir as { via?: unknown }).via === undefined
      if (!bare) {
        bindings.set(d.name, ir)
        pending.delete(i)
        progress = true
      }
    }
    if (!progress) break
  }
  // OCCURS-CHECK TERMINAL — the kept opaque-RHS fence, repositioned
  // post-fixpoint, predicate TEXT byte-unchanged from the old in-loop
  // form (`tag === 'Code' && via === undefined` now lives inside the
  // `bare` computation above; this terminal turns the residual pending
  // set — bindings whose RHS still parses to bareCode even with all
  // OTHER bindings resolved = cyclic or genuinely opaque — into the
  // same whole-program fallback the old single-pass produced inline).
  if (pending.size > 0) return null
  return { bindings, tail: stmts.slice(tailIdx) }
}

/**
 * The clean `bindings*, ONE final expression` shape — `collectTopLevelBindings`
 * plus the shape fence that has always guarded this caller.
 *
 * Unchanged in behaviour (#1392 moved the fence here, it did not loosen it):
 * every document this returned a map for still gets one, and every document it
 * rejected — trailing bindings, several final expressions — is still rejected.
 */
export function buildBindingMap(
  body: string,
  baseOffset: number,
):
  | { bindings: ReadonlyMap<string, PatternIR>; finalExpr: string; finalOffset: number }
  | null {
  const got = collectTopLevelBindings(body, baseOffset)
  if (!got || got.tail.length !== 1) return null
  return {
    bindings: got.bindings,
    finalExpr: got.tail[0].text,
    finalOffset: got.tail[0].offset,
  }
}

/** Parse a Strudel code string. Always returns a tree (Code node for unsupported). */
export function parseStrudel(
  code: string,
  // 20-18 E-1 (D-01) — flagged-general fallback (off-by-default,
  // measurement-only, NEVER gate-counted). When `true`, the general arm
  // in `parseRoot` emits a structured-OPAQUE `Code.via{method,args,inner}`
  // wrapper for unbound `identifier(...)` chain heads NOT in the curated
  // `CHAIN_ROOT_RECOGNISER` set. Default `undefined` → general arm
  // dormant → every existing path byte-identical (the 20-17 G4
  // optional-arg-threading idiom; PV50: STACK param, NOT module state).
  // Threaded `parseStrudel → parseExpression → parseRoot` only. The
  // parity oracle (`_bakery-classify.spec.ts:77`) calls
  // `parseStrudel(s.code)` with EXACTLY one arg → opts is never
  // constructed by the gate → the flag is STRUCTURALLY never-gate-counted
  // (Wave-0 ACTION 7 invariant, hardened in this wave's spec).
  _opts?: { recogniseGeneralChainRoots?: boolean },
): PatternIR {
  if (!code.trim()) return IR.pure()
  const opts = _opts

  try {
    // Split into track blocks ($: lines). Each carries the absolute
    // char offset of `expr[0]` within `code` so parseMini can attach
    // `loc` (source ranges) to Play nodes.
    const tracks = extractTracks(code)
    // #1392 — WHAT AN IDENTIFIER MEANS IS A PROPERTY OF THE DOCUMENT, so it is
    // resolved ONCE, here, above the track dispatch. It used to be computed
    // inside the no-`$:` branch alone, which meant every `$:`-declared track —
    // the ordinary way to declare one — parsed its body with no bindings at all
    // and left each reference an opaque `Code` node. Downstream that is not a
    // cosmetic gap: an opaque arm yields no leaves, so no `armIndex`, so the
    // timeline drew NO CLIPS for an arranged song.
    //
    // `null` when there is nothing to resolve (no bindings, or a shape the
    // engine rejects), which is exactly the `undefined` these branches passed
    // before — so a document without bindings is byte-identical.
    const trackBindings = tracks.length > 0
      ? (collectTopLevelBindings(code, 0)?.bindings ?? undefined)
      : undefined
    // #1468 A — the OTHER thing an identifier can mean at document scope: a
    // number. Resolved once, here, for the same reason `trackBindings` is —
    // `var M = 1` is a property of the document, not of one arrange arm. A
    // separate map because `collectTopLevelBindings` resolves to PATTERNS, and
    // because it must survive that collector declining: a document whose
    // pattern bindings don't resolve can still have a readable `var M = 1`.
    const numbers = collectNumericBindings(code)
    if (tracks.length === 0) {
      // No $: prefix — parse as a single expression and wrap in a
      // synthetic Track('d1', ...). 20-11 D-04 option (a): every parseStrudel
      // result whose root is the user's musical expression carries a
      // trackId, even when the source has no `$:` block. The wrap has
      // NO `loc` (no $: line to point at) and NO userMethod (synthetic,
      // distinguishes from `.p("d1")`). toStrudel's β-2 Track arm strips
      // synthetic-d1 (userMethod === undefined) on round-trip so the
      // input → IR → string identity is preserved for non-$: sources.
      //
      // Phase 20-14 parser-gap fix — strip any leading prelude (whole-line
      // comments, blank lines, recognised boot-side-effect calls) before
      // parsing. Real upstream tunes start with a license comment block +
      // `samples(...)` / `useRNG(...)` invocations; without this strip,
      // `splitRootAndChain` reads the comment text as the root and the
      // whole tune falls through to the Code() fallback at line 270.
      //
      // The strip applies ONLY to the no-`$:` branch. The multi-track
      // path keeps reading the original `code` so a `$:` line appearing
      // before the prelude (uncommon but legal) still produces tracks.
      const stripped = stripParserPrelude(code)
      if (!stripped.body.trim()) {
        // Source is ENTIRELY prelude (no musical body). Return an
        // empty-body Track wrapper so downstream consumers still get
        // the synthetic-d1 shape. PV37 wrap-never-drop preserved.
        return IR.track('d1', IR.pure())
      }
      const bodyTrimStart = stripped.body.search(/\S/)
      const innerOffset = stripped.offset + (bodyTrimStart >= 0 ? bodyTrimStart : 0)
      // 20-15 G1 (#134 / D-02) — NEW PK16(b) stage 0.5: try the minimal
      // single-assignment binding map. Only the clean
      // `let p1=… / let p2=… / stack(p1,p2)` shape (R4 partial — the
      // measured 2/10 Bakery case). buildBindingMap returns null on ANY
      // D-02 violation (reassignment / shadowing / opaque RHS / not a
      // "bindings* then one expr" shape) → fall through to the existing
      // whole-program parse below (topology-preserving; use-before-def is
      // handled at the substitution site, never a throw).
      const bound = buildBindingMap(stripped.body, stripped.offset)
      if (bound) {
        const inner = parseExpression(bound.finalExpr, bound.finalOffset, undefined, bound.bindings, opts, numbers)
        // P67: if the final expression resolved to bare Code (the binding
        // map did not help — e.g. a non-stack final expr), keep the
        // existing whole-program fallback shape rather than wrapping a
        // bare-Code body in a Track. Otherwise the substituted subtrees
        // are real structured IR flowing through the pS:~620 chokepoint.
        const innerIsBareCode =
          inner.tag === 'Code' && (inner as { via?: unknown }).via === undefined
        if (!innerIsBareCode) {
          return IR.track('d1', inner)
        }
        // else: fall through to the plain parse (whole-program Code).
      }
      // #1096 — a bare document with SEVERAL top-level statements declares
      // several tracks, and every one of them gets a row.
      //
      // Until this branch existed, `parseExpression` was handed the whole
      // body and kept ONE expression, so `s("bd*4")\ns("hh*8")` produced
      // `Track(d1)[Fast[Play(bd)]]` — statement 2 was not in the IR at all.
      // Three surfaces then gave three answers: the mixer drew two strips,
      // the timeline drew one row anchored at `bd`, and strudel played `hh`
      // (its repl plays the LAST expression when nothing called `.p()`).
      // Measured over the parity corpus: 27 bare documents are this shape and
      // all the real ones are multi-part arrangements MEANT to layer — the
      // largest a five-part song in which only the clap texture sounds.
      //
      // The row machinery needs nothing new: PV253's `declaredTracks` already
      // turns every top-level `Track` node into a row, and a track with no
      // marks already draws silent. What was missing is an IR that declares
      // all N tracks, which is all this does.
      //
      // Statement splitting REUSES `splitTopLevelStatements` (the depth-,
      // string-, comment- and line-continuation-aware walker this file already
      // runs for the binding map) rather than a second, divergent scanner —
      // a leading-dot chain and a multi-line `stack(` stay ONE statement.
      // `stripSideEffectStatements` drops recognised transport/boot calls
      // (`setcps`, `samples`, …): they are not tracks and must not take a row.
      //
      // Deliberately NARROW — the multi-track shape is taken only when EVERY
      // remaining statement is a plain expression. A `let`/`const` binding
      // means the document needs substitution to be meaningful, and inventing
      // per-statement binding semantics here would be a second, weaker
      // `buildBindingMap`; those documents keep the existing single-Track
      // shape. One candidate keeps the existing path untouched too, body and
      // all, so every single-statement bare document is byte-identical.
      const bareStmts = stripSideEffectStatements(
        splitTopLevelStatements(stripped.body, stripped.offset),
      )
      if (bareStmts.length > 1 && !bareStmts.some(s => BINDING_RE.test(s.text))) {
        return IR.stack(
          ...bareStmts.map((s, i) =>
            // Each statement carries its OWN source range, so the timeline can
            // anchor a hap to the statement that produced it by containment —
            // the same mechanism a `$:` document uses, not a parallel path.
            // Synthetic wrapper: no userMethod (there is no `.p()` here).
            IR.track(`d${i + 1}`, parseExpression(s.text, s.offset, undefined, undefined, opts, numbers), {
              loc: [{ start: s.offset, end: s.offset + s.text.length }],
            }),
          ),
        )
      }
      const inner = parseExpression(stripped.body.trim(), innerOffset, undefined, undefined, opts, numbers)
      return IR.track('d1', inner)
    }
    if (tracks.length === 1) {
      // Single `$:` block — Track('d1', expr) without an enclosing Stack.
      // loc covers the `$:` line range (PV36 / D-02). Synthetic-from-$:
      // form: no userMethod (toStrudel β-2 distinguishes from `.p()` form
      // via `userMethod === 'p'`).
      //
      // Phase 20-12.1 follow-up — commented `$:` lines produce an
      // empty-body Track wrapper so d{N} numbering stays stable when
      // the user toggles a line's comment prefix.
      const t = tracks[0]
      const body = t.commented ? IR.pure() : parseExpression(t.expr, t.offset, undefined, trackBindings, opts, numbers)
      // 20-15 G5 (#138 / D-01) — a named label becomes the trackId so the
      // label IS the timeline row name (no `.p()` needed). `$` (the legacy
      // `$:` marker) keeps the synthetic `d1` numbering — byte-identical to
      // pre-G5. dollarStart = label-line start → collect.ts:447-450
      // OUTER-WINS dollarPos → MusicalTimeline `$${pos}` source-anchored
      // slot (PV47 / #119 substrate). Same mechanism `$:` uses, NOT a
      // parallel path.
      const trackId0 = trackIdFromLabel(t.label, 0)
      return IR.track(trackId0, body, {
        loc: [{ start: t.dollarStart, end: t.end }],
      })
    }
    // Two+ `$:` blocks — Stack(Track('d1', ...), Track('d2', ...), ...).
    // Each Track carries its own `$:` line range as loc. The outer Stack
    // is synthetic (no loc / no userMethod) — same shape as today.
    // Commented `$:` lines get Track wrappers with IR.pure() bodies so
    // they keep their slot in the numbering.
    return IR.stack(
      ...tracks.map((t, i) => {
        const body = t.commented ? IR.pure() : parseExpression(t.expr, t.offset, undefined, trackBindings, opts, numbers)
        // 20-15 G5 (#138 / D-01) — labelled tracks carry trackId = label;
        // legacy `$:` (label === '$') keeps `d{i+1}` so existing multi-$:
        // tunes are byte-identical. dollarStart (label-line start) is the
        // source-anchored slot identity for BOTH forms — mixed `$:` +
        // `name:` interleave correctly because the unified regex matches
        // both in one scan and dollarStart is always line-start.
        const trackId = trackIdFromLabel(t.label, i)
        return IR.track(trackId, body, {
          loc: [{ start: t.dollarStart, end: t.end }],
        })
      }),
    )
  } catch {
    return IR.code(code)
  }
}

// ---------------------------------------------------------------------------
// Track extraction
// ---------------------------------------------------------------------------

/**
 * Split code by $: lines.
 * Returns each track's expression body (without the $: prefix) plus
 * the absolute char offset of the body within the original code, so
 * downstream parsing can attach source-range information.
 *
 * Slices preserve original whitespace + newlines (no .trim()) so an
 * offset within the slice is also a valid offset within `code`.
 * Returns [] if no $: lines found (caller handles single-expression case).
 */
/**
 * 20-15 G5 (#138) — scan `code[0 .. idx)` and report the lexical state at
 * `idx`: paren/brace/bracket nesting depth + whether `idx` is inside a
 * string / template literal or a `//` line comment.
 *
 * REUSE of the `stripParserPrelude` depth-walker discipline (pS:~192-243):
 * same string/escape/`//`-comment handling, same depth bookkeeping. It is
 * lifted here as a small shared scanner (PV49 spirit — do not hand-roll a
 * second divergent walker) so the generalized label matcher can reject a
 * `name:` that is actually an object-literal key (`{ a: 1 }` multi-line),
 * a colon inside a string/template (`` s(`bd:3`) ``), or a comment.
 *
 * The γ-1 probe proved single-line false-positives are already rejected by
 * the label regex shape itself; this guard is load-bearing for the
 * MULTI-LINE forms where the colon-bearing token sits at a physical line
 * start (matrix in 20-15-OBSERVATIONS.md).
 */
function lexStateAt(code: string, idx: number): { depth: number; inString: boolean } {
  let depth = 0
  let inString = false
  let stringChar = ''
  let escaped = false
  let i = 0
  while (i < idx) {
    const ch = code[i]
    if (escaped) {
      escaped = false
      i++
      continue
    }
    if (inString) {
      if (ch === '\\') escaped = true
      else if (ch === stringChar) inString = false
      i++
      continue
    }
    // `//` line comment (only outside strings) — consume to EOL. The
    // newline itself is left for the outer loop (depth/string unchanged).
    if (ch === '/' && code[i + 1] === '/') {
      while (i < idx && code[i] !== '\n') i++
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      inString = true
      stringChar = ch
      i++
      continue
    }
    if (ch === '(' || ch === '[' || ch === '{') {
      depth++
      i++
      continue
    }
    if (ch === ')' || ch === ']' || ch === '}') {
      depth--
      i++
      continue
    }
    i++
  }
  return { depth, inString }
}

// 20-15 G5 (#138) — reserved identifiers that the generalized `name:`
// matcher must NOT treat as a track label. `let/const/var` would be a
// binding (G1, γ-3 / D-02); `default/case` are statement-label keywords.
// Strudel has no `switch`, so these only appear as false-positives.
const RESERVED_LABEL_IDENTS = new Set(['let', 'const', 'var', 'default', 'case'])

// 20-18 Wave B-1 (D-01) — the FROZEN Wave-0 curated chain-root recogniser
// scope contract. Module-const immutable map: root token → discriminant +
// kind. The producer side of the additive Signal/Builder union introduced
// in Wave A. Membership = `20-18-OBSERVATIONS.md` ACTION 6, R-2 GT-seeded:
//   Signal (21) — sine/cosine/saw/isaw/tri/square/pulse/perlin/berlin/
//                  time/rand/rand2/brand/sine2/cosine2/saw2/isaw2/tri2/
//                  square2/mousex/mousey
//   Builder (6) — run/irand/binary/binaryN/binaryL/binaryNL
// `chord`/`arrange` are DELIBERATELY EXCLUDED (OPAQUE-pending → Wave C
// ground-first per the Grounding Check on `@strudel/tonal` /
// `pattern.mjs`). Mirrors the `RESERVED_LABEL_IDENTS` curated-Set idiom
// directly above — immutable config, NOT mutable module state (PV50).
// The set is FROZEN: any later wave widening this scope without a
// re-pose + provenance is a PK18 STOP (the 20-16 4×-cascade discipline,
// P70 spine).
type ChainRootDescriptor =
  | { tag: 'Signal'; kind: (PatternIR & { tag: 'Signal' })['kind'] }
  | { tag: 'Builder'; kind: (PatternIR & { tag: 'Builder' })['kind'] }
// Exported for `__tests__/chainRootDrift.test.ts` (#953), which re-derives this
// set from `@strudel/core/signal.mjs` and fails when the two disagree. Exported
// for the gate only — parsing still reads it through the local binding.
export const CHAIN_ROOT_RECOGNISER: ReadonlyMap<string, ChainRootDescriptor> = new Map([
  // Continuous + random Signal roots (21)
  ['sine',    { tag: 'Signal', kind: 'sine'    }],
  ['cosine',  { tag: 'Signal', kind: 'cosine'  }],
  ['saw',     { tag: 'Signal', kind: 'saw'     }],
  ['isaw',    { tag: 'Signal', kind: 'isaw'    }],
  ['tri',     { tag: 'Signal', kind: 'tri'     }],
  ['square',  { tag: 'Signal', kind: 'square'  }],
  // #953 — `pulse` was here and is GONE. It is not exported by signal.mjs, not
  // in pattern.mjs, and not a control: it does not exist in Strudel as an
  // identifier. It is a superdough oscillator WAVEFORM, reachable only as
  // `s("pulse")`. Recognising it drew a structured lane for code Strudel would
  // refuse to run. Do not re-add without an export to point at.
  ['perlin',  { tag: 'Signal', kind: 'perlin'  }],
  ['berlin',  { tag: 'Signal', kind: 'berlin'  }],
  ['time',    { tag: 'Signal', kind: 'time'    }],
  ['rand',    { tag: 'Signal', kind: 'rand'    }],
  ['rand2',   { tag: 'Signal', kind: 'rand2'   }],
  ['brand',   { tag: 'Signal', kind: 'brand'   }],
  ['sine2',   { tag: 'Signal', kind: 'sine2'   }],
  ['cosine2', { tag: 'Signal', kind: 'cosine2' }],
  ['saw2',    { tag: 'Signal', kind: 'saw2'    }],
  ['isaw2',   { tag: 'Signal', kind: 'isaw2'   }],
  ['tri2',    { tag: 'Signal', kind: 'tri2'    }],
  ['square2', { tag: 'Signal', kind: 'square2' }],
  ['mousex',  { tag: 'Signal', kind: 'mousex'  }],
  ['mousey',  { tag: 'Signal', kind: 'mousey'  }],
  // #953 — Signal roots the map had drifted past. Each is a signal.mjs export
  // that is a `Pattern` INSTANCE; `chainRootDrift.test.ts` re-derives this set
  // from the module, so a future Strudel release cannot silently outgrow it.
  // Strudel exports BOTH mouse spellings — we had only the lowercase pair.
  ['mouseX',    { tag: 'Signal', kind: 'mouseX'    }],
  ['mouseY',    { tag: 'Signal', kind: 'mouseY'    }],
  ['itri',      { tag: 'Signal', kind: 'itri'      }],
  ['itri2',     { tag: 'Signal', kind: 'itri2'     }],
  ['cyclesPer', { tag: 'Signal', kind: 'cyclesPer' }],
  ['per',       { tag: 'Signal', kind: 'per'       }],
  ['perCycle',  { tag: 'Signal', kind: 'perCycle'  }],
  ['perx',      { tag: 'Signal', kind: 'perx'      }],
  // Discrete Builder roots (6 Wave-B closed-set + 2 Wave-C GROUNDED additions)
  ['run',      { tag: 'Builder', kind: 'run'      }],
  ['irand',    { tag: 'Builder', kind: 'irand'    }],
  ['binary',   { tag: 'Builder', kind: 'binary'   }],
  ['binaryN',  { tag: 'Builder', kind: 'binaryN'  }],
  ['binaryL',  { tag: 'Builder', kind: 'binaryL'  }],
  ['binaryNL', { tag: 'Builder', kind: 'binaryNL' }],
  // #953 — Builder roots the map had drifted past: signal.mjs exports that are
  // root-capable (`fn(1) instanceof Pattern`) AND absent from
  // `Pattern.prototype`. That second condition is what keeps `choose`,
  // `degrade`, `keyDown` and `undegrade` OUT — they are root-capable too, but
  // they are chain METHODS, and admitting them as roots would be a new bug.
  // Args ride the existing raw-slice path (the `chord`/`arrange` contract):
  // args RAW, no `body` — so a lambda-taking root like `signal` stays opaque
  // inside while still getting a lane instead of vanishing.
  ['brandBy',      { tag: 'Builder', kind: 'brandBy'      }],
  ['chooseCycles', { tag: 'Builder', kind: 'chooseCycles' }],
  ['chooseIn',     { tag: 'Builder', kind: 'chooseIn'     }],
  ['chooseOut',    { tag: 'Builder', kind: 'chooseOut'    }],
  ['randL',        { tag: 'Builder', kind: 'randL'        }],
  ['randcat',      { tag: 'Builder', kind: 'randcat'      }],
  ['randrun',      { tag: 'Builder', kind: 'randrun'      }],
  ['signal',       { tag: 'Builder', kind: 'signal'       }],
  ['steady',       { tag: 'Builder', kind: 'steady'       }],
  // 20-18 Wave C — `chord`/`arrange` GROUNDED against real source
  // (~/.anvideck/projects/struCode/ref/GROUND_TRUTH_SIGNAL_MJS.md §2/§3):
  //   `chord` → @strudel/core@1.2.6 controls.mjs:2130 (registerControl) →
  //     :10-54 createParam → :41-49 root path (reify(value).withValue(withVal))
  //     — arg is a chord-symbol sublanguage, NOT a Strudel-pattern → `args`
  //     RAW, **no `body`** (modelling body would be inferred-taxonomy — the
  //     domain-specific sublanguage is non-recursable in the matcher's
  //     competence; D-02 matcher line, EXECUTOR NOTES line 842).
  //   `arrange` → @strudel/core@1.2.6 pattern.mjs:1469-1473 — varargs of
  //     `[cycles, pattern]` two-element JS arrays. The arg surface is a
  //     JS-array-literal-of-tuples shape, NOT a single pattern expression.
  //     Parsing it would require JS-array-literal + tuple recursion, which
  //     is structurally outside the matcher's competence → `args` RAW,
  //     **no `body`** (the disposition RESEARCH R-3 specifies for OPAQUE
  //     gate-critical builders: args-raw-only until grounded; grounded
  //     evidence here closes the gate by EXCLUDING a body shape, not by
  //     constructing one).
  // Both builders ride the EXISTING Wave-B arm path unchanged (arg-taking →
  // balanced-paren-slice the raw args → emit `IR.builder(kind, rawArgs,
  // undefined, {loc})`). The chain (.voicing/.dict/.mode/.struct/...) rides
  // the EXISTING `applyChain` over the new Builder root — same composition
  // contract as the 6 Wave-B kinds.
  ['chord',    { tag: 'Builder', kind: 'chord'    }],
  ['arrange',  { tag: 'Builder', kind: 'arrange'  }],
])

export function extractTracks(
  code: string,
): {
  expr: string
  offset: number
  dollarStart: number
  end: number
  commented: boolean
  label?: string
}[] {
  // Phase 20-11 α-2 — return shape additively widened. `dollarStart` (start
  // of the literal `$:` token) and `end` (exclusive end of the track body
  // slice — either the next `$:` line start or `code.length`) are exposed
  // so α-3's parseStrudel main path can attach a loc covering the `$:` line
  // range to each Track wrapper. Existing callers (parseStrudel main +
  // parseStrudelStages.runRawStage) consume only `expr`/`offset` and are
  // forward-compatible.
  //
  // Phase 20-12.1 follow-up — commented `$:` lines (// $:) are now matched
  // and emitted as `commented: true`. parseStrudel maps these to empty-body
  // Tracks, so d{N} numbering stays stable when the user comments out a $:
  // line during live editing. Without this, the IR renumbers (commenting
  // line 4 of a 6-line fixture shifts d5/d6 down to d4/d5, leaving a
  // disconnected d6 ghost from the slot map).
  const tracks: {
    expr: string
    offset: number
    dollarStart: number
    end: number
    commented: boolean
    label?: string
  }[] = []
  // 20-15 G5 (#138) — generalized from the literal `$:` matcher to a
  // named-label matcher. Group 1 = optional `//` line-comment prefix
  // (→ `commented`); group 2 = the label identifier. `$` ∈ `[A-Za-z_$]`
  // so `$:` STILL matches with label === '$' — exact pre-G5 behavior is
  // preserved (the `$` label falls back to the synthetic `d{N}` numbering
  // in parseStrudel, so `$:` tracks are byte-identical to before).
  // `\s*:` (not `[ \t]*:`) tolerates the rare `name :` spacing; the γ-1
  // probe proved this does not introduce false-positives (ternary `?`
  // breaks the `\s*:` adjacency before any `:` is reached).
  const dollarRe = /^[ \t]*(\/\/[ \t]*)?([A-Za-z_$][\w$]*)\s*:/gm
  const starts: {
    dollarStart: number
    bodyStart: number
    commented: boolean
    label: string
  }[] = []
  let m: RegExpExecArray | null
  while ((m = dollarRe.exec(code))) {
    const label = m[2]
    // γ-1-validated guard: reject a match that is NOT a real top-level
    // track label — inside `{}`/`()`/`[]`, inside a string/template/
    // comment, or a reserved non-track keyword. lexStateAt REUSES the
    // stripParserPrelude depth-walker discipline (PV49 spirit). `$:` is
    // never reserved and is virtually always depth-0, so its behavior is
    // unchanged. A `//`-commented label sits at line start; the `//` is
    // captured by group 1 (not consumed by the lexState `//` rule because
    // we scan UP TO m.index, which is the line start BEFORE the `//`).
    const st = lexStateAt(code, m.index)
    if (st.depth > 0 || st.inString || RESERVED_LABEL_IDENTS.has(label)) {
      continue
    }
    // bodyStart points after the matched prefix (`[ws][//]label:`) and any
    // post-colon whitespace on the same physical line. Tracks may continue
    // on subsequent lines.
    const after = m.index + m[0].length
    let bodyStart = after
    while (bodyStart < code.length && (code[bodyStart] === ' ' || code[bodyStart] === '\t')) {
      bodyStart++
    }
    const commented = !!m[1]
    // dollarStart anchors at the LINE START (m.index) — consistent across
    // commented vs uncommented forms since the regex matches from `^`.
    // This keeps slice boundaries clean (`end` of one entry == line start
    // of the next entry) regardless of comment toggling, AND makes the
    // label-line start the source-anchored slot identity (PV47 / D-01).
    starts.push({ dollarStart: m.index, bodyStart, commented, label })
  }
  if (starts.length === 0) return []

  for (let i = 0; i < starts.length; i++) {
    const { dollarStart, bodyStart, commented, label } = starts[i]
    const end = i + 1 < starts.length ? starts[i + 1].dollarStart : code.length
    if (commented) {
      // Commented `$:` / `// name:` — emit an empty-body track. Body extent
      // is irrelevant (we don't parse it), but slot-map identity for this
      // position is preserved so the timeline shows a ghost row in place.
      tracks.push({ expr: '', offset: bodyStart, dollarStart, end, commented: true, label })
      continue
    }
    const slice = code.slice(bodyStart, end)
    // Trailing whitespace can stay — parseExpression handles it. We
    // keep the leading slice intact so offsets line up.
    tracks.push({ expr: slice, offset: bodyStart, dollarStart, end, commented: false, label })
  }
  return tracks
}

// ---------------------------------------------------------------------------
// Expression parser
// ---------------------------------------------------------------------------

/**
 * PV49 shared inter-token skip primitive (20-15 α substrate).
 *
 * Returns the ABSOLUTE index into `src` after any run of whitespace
 * (incl. `\n`) and whole-line / inline `// …` comments starting at
 * `pos`. Offset-additive: a caller threads it as
 * `base += skipWhitespaceAndLineComments(src, pos) - pos`.
 *
 * Behaviour MUST exactly mirror the reference regex used by the
 * already-tolerant chain walker, `applyChain`'s
 * `INTER_METHOD_SEP = /^(?:\s+|\/\/[^\n]*\n?)+/`: it consumes runs of
 * `\s` (newlines included) and `//`-to-end-of-line where the trailing
 * `\n` is ALSO consumed (matching the regex's `\n?`), looping until
 * neither whitespace nor a `//` comment starts at the cursor.
 *
 * `${` is NOT whitespace (it is real JS template interpolation) and is
 * NEVER consumed — PV49 scope explicitly excludes it (D-04). A `/` that
 * is not followed by a second `/` (e.g. a division operator) is also
 * not consumed.
 *
 * Pure: no state, no engine (PV50 N/A). The three genuine inter-token
 * consumers (applyChain — α-3 reference; splitArgsWithOffsets — #137/G4;
 * extractTracks label scan — #138/G5) own their additive arithmetic.
 * `stripParserPrelude`'s whole-line classifier is a structurally
 * distinct concern (R1) and is intentionally NOT migrated onto this.
 */
export function skipWhitespaceAndLineComments(src: string, pos: number): number {
  let i = pos
  for (;;) {
    // 1. Whitespace run (includes \n) — same as the regex's `\s+`.
    while (i < src.length && /\s/.test(src[i])) i++
    // 2. A `//` line comment: consume up to and INCLUDING the trailing
    //    `\n` (mirrors `\/\/[^\n]*\n?`). At EOF with no newline the
    //    `\n?` matches empty — consume to end of string.
    if (src[i] === '/' && src[i + 1] === '/') {
      i += 2
      while (i < src.length && src[i] !== '\n') i++
      if (i < src.length && src[i] === '\n') i++
      continue
    }
    // Neither whitespace nor a `//` comment at the cursor — done.
    // (`${`, `/x`, and any non-ws char fall here and are NOT consumed.)
    break
  }
  return i
}

/**
 * Parse a single Strudel expression (with optional method chain).
 * `baseOffset` is the absolute char offset of `expr[0]` within the
 * user's full code, so leaf parsers can attach `loc` to Play nodes.
 *
 * e.g. 'note("c4 e4").fast(2).every(4, fast(2))'
 */
export function parseExpression(
  expr: string,
  baseOffset = 0,
  // #132 (β-2) — when set, threads the caller's s-vs-note context into
  // the inner bare-string root. β-1 probe proved `s(...)` inner bare
  // strings MUST parse with isSampleKey=true (params.s + duration:1 are
  // lost otherwise); note/n/mini stay false. `undefined` = unchanged
  // pre-β-2 behavior (the bare-string arm's own default of false).
  isSampleKey?: boolean,
  // 20-15 G1 (#134 / D-02) — when set, a bare-identifier stack arg that
  // matches a key is substituted with the bound (definition-site) subtree.
  // `undefined` = no binding map (every call site except the no-`$:`
  // G1 entry). Threaded ONLY parseExpression → parseRoot → stack-arg.
  bindings?: ReadonlyMap<string, PatternIR>,
  // 20-18 E-1 (D-01) — flagged-general fallback (off-by-default,
  // measurement-only, NEVER gate-counted). See `parseStrudel` for the
  // full contract. Threaded EXACTLY as `bindings` (optional trailing
  // STACK param; PV50). `undefined` → general arm dormant → byte-identical.
  opts?: { recogniseGeneralChainRoots?: boolean },
  // #1468 A — numeric top-level bindings, so an `arrange` arm whose weight is
  // written `M*8` reads as 8. Optional trailing STACK param (PV50), threaded
  // exactly as `bindings`; `undefined` = literal weights only.
  numbers?: ReadonlyMap<string, number>,
): PatternIR {
  if (!expr.trim()) return IR.pure()

  // 20-15 G1 — if the WHOLE expression is a bare identifier bound in the
  // map, substitute its subtree directly (covers the single-arg
  // `stack(p1)` path which unwraps to one arg before reaching here, and
  // any bare-ident root). Definition-site loc preserved (R6).
  if (bindings) {
    const bareId = expr.trim()
    if (/^[A-Za-z_$][\w$]*$/.test(bareId) && bindings.has(bareId)) {
      return bindings.get(bareId) as PatternIR
    }
  }

  try {
    // Compute the offset of `expr.trim()[0]` within `code` so the
    // root parser can locate the inner mini-notation string accurately.
    const leadingWs = expr.length - expr.trimStart().length
    const trimmedOffset = baseOffset + leadingWs

    // Extract root function call and remaining method chain
    const { root, chain } = splitRootAndChain(expr.trim())

    // Parse the root — if it can't be parsed, fall back to full expression as Code.
    //
    // Phase 20-14 parser-gap fix — discriminate "pure Code fallback" from
    // "structural Code-with-via wrapper". wrapAsOpaque returns tag: 'Code'
    // for any unrecognised method arg (PV37 wrap-never-drop), but the
    // `.via` field carries the structured chain. Checking tag alone treated
    // those wrappers as opaque and discarded the entire structure — surfaces
    // for `stack(single-arg-with-unmapped-pattern-chain)` shapes such as
    // `stack(s("bd").delay("<0 .5>")...).sometimes(...)` in delay.strudel.
    const rootIR = parseRoot(root, trimmedOffset, isSampleKey, bindings, opts, numbers)
    const rootIsBareCode =
      rootIR.tag === 'Code' && (rootIR as { via?: unknown }).via === undefined
    if (rootIsBareCode && !chain.trim()) {
      // Entire expression is opaque — preserve full original expression
      return IR.code(expr)
    }
    if (rootIsBareCode) {
      return IR.code(expr)
    }

    // Walk the method chain, wrapping ir.
    // Compute absolute offset of chain[0] in the user's full code so that
    // parseTransform calls inside applyChain receive non-zero baseOffsets
    // for transform-arg positions (P39 / PRE-01 precursor — signature-
    // level threading only; loc attribution to non-Play nodes deferred).
    const chainOffset = trimmedOffset + root.length
    // 20-17 G4 — thread the binding map parseExpression already accepts
    // (pS:861) into applyChain. Byte-unchanged when the caller passed
    // undefined; behaviour-bearing when the pS:544 D-01 entry passes
    // `bound.bindings` — this flow is the WIRE that makes Wave C/D/E reach.
    const ir = applyChain(rootIR, chain, chainOffset, bindings)

    return ir
  } catch {
    return IR.code(expr)
  }
}

// ---------------------------------------------------------------------------
// Time-sequence combinators (Phase 5a / #386)
// ---------------------------------------------------------------------------

/**
 * Statically evaluate a NUMERIC expression node, or null when it isn't one
 * (#1468 cause A).
 *
 * Deliberately total and side-effect-free: literals, unary `+`/`-`, and binary
 * arithmetic over operands that are themselves numeric, plus identifiers that
 * a numeric top-level binding resolves. Anything else — a call, a member
 * expression, a string — is not a number we can know, and the caller declines
 * rather than inventing one.
 */
function evalNumericNode(node: unknown, numbers?: ReadonlyMap<string, number>): number | null {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const n = node as any
  if (!n || typeof n !== 'object') return null
  switch (n.type) {
    case 'Literal':
      return typeof n.value === 'number' && Number.isFinite(n.value) ? n.value : null
    case 'Identifier': {
      const v = numbers?.get(n.name)
      return typeof v === 'number' && Number.isFinite(v) ? v : null
    }
    case 'UnaryExpression': {
      if (n.operator !== '-' && n.operator !== '+') return null
      const v = evalNumericNode(n.argument, numbers)
      return v == null ? null : n.operator === '-' ? -v : v
    }
    case 'BinaryExpression': {
      const a = evalNumericNode(n.left, numbers)
      const b = evalNumericNode(n.right, numbers)
      if (a == null || b == null) return null
      let r: number
      switch (n.operator) {
        case '*': r = a * b; break
        case '+': r = a + b; break
        case '-': r = a - b; break
        case '/': r = a / b; break
        case '%': r = a % b; break
        case '**': r = a ** b; break
        default: return null
      }
      return Number.isFinite(r) ? r : null
    }
    default:
      return null
  }
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

/**
 * The value of an `arrange` arm's WEIGHT, written as source text (#1468 A).
 *
 * `Number(text)` first, so the 115-of-125 arms that are bare literals cost
 * exactly what they cost today. Only a non-numeric text reaches acorn — the
 * parser this file already imports, not a new oracle.
 *
 * Returns null when the text is not a number we can know. That refusal is
 * load-bearing: a weight is a POSITION (arm k starts at the sum of every
 * earlier weight), so a guessed weight moves every section after it. A blank
 * timeline is honest; a shifted one is a confident lie.
 */
export function evalWeightExpression(
  text: string,
  numbers?: ReadonlyMap<string, number>,
): number | null {
  const fast = Number(text)
  if (Number.isFinite(fast) && text.trim() !== '') return fast
  try {
    const program = acornParse(text, { ecmaVersion: 'latest' })
    const body = (program as unknown as { body: unknown[] }).body
    if (body.length !== 1) return null
    const stmt = body[0] as { type: string; expression?: unknown }
    if (stmt.type !== 'ExpressionStatement') return null
    return evalNumericNode(stmt.expression, numbers)
  } catch {
    return null
  }
}

/**
 * Top-level `let`/`const`/`var` declarations whose initialiser is a number
 * (#1468 A) — `var M = 1`, and `const BARS = M * 4` beside it.
 *
 * A SEPARATE map from `collectTopLevelBindings`, on purpose: that one resolves
 * identifiers to PATTERNS, and a weight needs a NUMBER. It also has no
 * interaction with that collector's occurs-check — a document whose pattern
 * bindings don't resolve can still have a perfectly readable `var M = 1`.
 *
 * Declarations are read in source order, so a later one may use an earlier one.
 * Returns undefined when the document has no numeric bindings at all, which is
 * the same `undefined` every call site passed before this existed.
 */
export function collectNumericBindings(code: string): ReadonlyMap<string, number> | undefined {
  let program: ReturnType<typeof acornParse>
  try {
    program = acornParse(code, { ecmaVersion: 'latest', allowAwaitOutsideFunction: true })
  } catch {
    return undefined
  }
  const numbers = new Map<string, number>()
  /* eslint-disable @typescript-eslint/no-explicit-any */
  for (const stmt of (program as any).body ?? []) {
    if (stmt?.type !== 'VariableDeclaration') continue
    for (const d of stmt.declarations ?? []) {
      if (d?.id?.type !== 'Identifier' || !d.init) continue
      const v = evalNumericNode(d.init, numbers)
      // A re-declaration wins, matching JS's own last-write-wins for `var`.
      if (v != null) numbers.set(d.id.name, v)
    }
  }
  /* eslint-enable @typescript-eslint/no-explicit-any */
  return numbers.size > 0 ? numbers : undefined
}

/**
 * Parse one `arrange` arm — a `[weight, pattern]` tuple. `raw` is the tuple
 * source (e.g. `[2, note("c3")]`); `absOffset` is the absolute file offset of
 * `raw[0]`. Returns the arm with weight, parsed pattern sub-IR, and the WHOLE
 * tuple range as `loc` (so write-back can edit the weight `n`), or `null` if
 * the tuple is malformed (caller falls back to the opaque Builder path).
 */
function parseArrangeArm(
  raw: string,
  absOffset: number,
  bindings?: ReadonlyMap<string, PatternIR>,
  opts?: { recogniseGeneralChainRoots?: boolean },
  // #1468 A — numeric top-level bindings, so `[M*8, a]` reads as 8 rather than
  // discarding the whole arrangement. Optional trailing STACK param (PV50),
  // threaded exactly as `bindings`: parseStrudel -> parseExpression ->
  // parseRoot -> parseTimeSequenceRoot -> here. `undefined` = literals only.
  numbers?: ReadonlyMap<string, number>,
): ArrangeArm | null {
  const lb = raw.indexOf('[')
  const rb = raw.lastIndexOf(']')
  if (lb < 0 || rb <= lb) return null
  const innerAbs = absOffset + lb + 1
  const parts = splitArgsWithOffsets(raw.slice(lb + 1, rb))
  if (parts.length < 2) return null
  const weight = evalWeightExpression(parts[0].value.trim(), numbers)
  if (weight == null) return null
  const patPart = parts[1]
  const pattern = parseExpression(patPart.value, innerAbs + patPart.offset, undefined, bindings, opts)
  return { weight, pattern, loc: [{ start: absOffset + lb, end: absOffset + rb + 1 }] }
}

/**
 * Phase 5a (#386) — recognise the time-sequence combinators
 * `arrange(…)` / `cat(…)` / `slowcat(…)` / `fastcat(…)` at the root and parse
 * them into the structured `Arrange` node (or `Seq` for `fastcat`, which is
 * one-cycle weight-slicing ≡ Seq, grounded). Returns `null` when the token is
 * not one of these combinators OR the args don't parse (caller then falls
 * through to the existing recogniser → opaque `Builder`, preserving today's
 * behaviour for malformed input). GROUNDED 2026-06-17 (see PatternIR.Arrange).
 */
function parseTimeSequenceRoot(
  trimmed: string,
  baseOffset: number,
  leadingWs: number,
  bindings?: ReadonlyMap<string, PatternIR>,
  opts?: { recogniseGeneralChainRoots?: boolean },
  // #1468 A — numeric top-level bindings, so an `arrange` arm whose weight is
  // written `M*8` reads as 8. Optional trailing STACK param (PV50), threaded
  // exactly as `bindings`; `undefined` = literal weights only.
  numbers?: ReadonlyMap<string, number>,
): PatternIR | null {
  const m = trimmed.match(/^(arrange|cat|slowcat|fastcat)\s*\(/)
  if (!m) return null
  const fn = m[1] as 'arrange' | 'cat' | 'slowcat' | 'fastcat'
  const openIdx = trimmed.indexOf('(', m[0].length - 1)
  const closeIdx = openIdx >= 0 ? findMatchingParen(trimmed, openIdx) : -1
  if (closeIdx <= openIdx) return null
  const innerAbs = baseOffset + leadingWs + openIdx + 1
  const args = splitArgsWithOffsets(trimmed.slice(openIdx + 1, closeIdx))
  if (args.length === 0) return null

  const nodeStart = baseOffset + leadingWs
  const nodeLoc: SourceLocation = { start: nodeStart, end: nodeStart + closeIdx + 1 }

  // fastcat ≡ Seq (one cycle, weight-proportional) — reuse the existing node
  // so the proven Seq collect / round-trip applies; NOT a clip producer.
  if (fn === 'fastcat') {
    const children = args.map(a =>
      parseExpression(a.value, innerAbs + a.offset, undefined, bindings, opts),
    )
    if (children.length === 1) return children[0]
    return { tag: 'Seq', children, loc: [nodeLoc], userMethod: 'fastcat' }
  }

  // arrange / cat / slowcat → Arrange node (the multi-cycle clip family).
  const arms: ArrangeArm[] = []
  for (const a of args) {
    if (fn === 'arrange') {
      const arm = parseArrangeArm(a.value, innerAbs + a.offset, bindings, opts, numbers)
      if (!arm) return null // malformed tuple → opaque fallback upstream
      arms.push(arm)
    } else {
      const armStart = innerAbs + a.offset
      arms.push({
        weight: 1,
        pattern: parseExpression(a.value, armStart, undefined, bindings, opts),
        loc: [{ start: armStart, end: armStart + a.value.length }],
      })
    }
  }
  if (arms.length === 0) return null
  return { tag: 'Arrange', mode: fn, arms, loc: [nodeLoc], userMethod: fn }
}

// ---------------------------------------------------------------------------
// Root parser
// ---------------------------------------------------------------------------

/** The pattern-source root forms: a call to one of these applied to a single
 *  mini-notation string is a leaf pattern. `sound` is Strudel's alias of `s`
 *  and `n`/`note` share note semantics; `s`/`sound` carry SAMPLE semantics. */
const PATTERN_SOURCE_NAMES = new Set(['note', 'n', 's', 'sound', 'mini'])
/** Quick gate so a non-source root (`stack(...)`, a bare ident) is not handed
 *  to acorn just to be declined. Same 5-name vocabulary as the loose arm. */
const PATTERN_SOURCE_CALL_RE = /^(?:note|n|s|sound|mini)\s*\(/

/**
 * A pattern-source root call — `note`/`n`/`s`/`sound`/`mini` applied to exactly
 * one string or backtick-template literal (#959 category B).
 *
 * This replaces the 3×3 grid of hand-rolled regexes (three name-groups × three
 * quote styles) with one delegation to acorn, which owns "what is a string
 * literal, and where does it start". The nine regexes answered the same two
 * orthogonal questions each — the NAME decides sample-vs-note semantics, the
 * DELIMITER decides `parseMini` vs `backtickInnerToIR` (only a backtick spans
 * newlines; `"` and `'` are identical for mini-notation) — so they were a
 * product, not nine distinct decisions.
 *
 * `delimOffset` is the position of the OPENING delimiter within `trimmed`,
 * identical to the regexes' `m[0].indexOf(quote)`; the caller adds
 * `baseOffset + leadingWs` and `+1` to reach the inner, so loc fidelity (PV49)
 * is byte-preserved — verified over the corpus, the collapse moves no snapshot.
 *
 * Returns null (→ the caller falls through to the loose recursive arm and then
 * bareCode, exactly as before) for anything that is not precisely one such call
 * with one plain literal argument: a chained inner (`n("0".fast(2))`), extra
 * arguments, a member/computed callee, or a `${…}` template (whose expression
 * the loose arm and `backtickInnerToIR` already route to opaque Code). A
 * chained ROOT (`note("c3").fast(2)`) never reaches here — `parseExpression`
 * splits the chain before `parseRoot`, so `trimmed` is always chain-free.
 */
function extractPatternSourceCall(
  trimmed: string,
): { isSample: boolean; isBacktick: boolean; inner: string; delimOffset: number } | null {
  if (!PATTERN_SOURCE_CALL_RE.test(trimmed)) return null
  let program: ReturnType<typeof acornParse>
  try {
    program = acornParse(trimmed, { ecmaVersion: 'latest' })
  } catch {
    return null
  }
  const body = program.body
  if (body.length !== 1 || body[0].type !== 'ExpressionStatement') return null
  // acorn's node shapes are structurally checked below; typed as `any` to avoid
  // pulling in `@types/estree` for a handful of discriminated reads.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const expr = (body[0] as any).expression
  if (
    !expr ||
    expr.type !== 'CallExpression' ||
    expr.callee.type !== 'Identifier' ||
    !PATTERN_SOURCE_NAMES.has(expr.callee.name) ||
    expr.arguments.length !== 1
  ) {
    return null
  }
  const arg = expr.arguments[0]
  const isSample = expr.callee.name === 's' || expr.callee.name === 'sound'
  if (arg.type === 'Literal' && typeof arg.value === 'string') {
    return { isSample, isBacktick: false, inner: trimmed.slice(arg.start + 1, arg.end - 1), delimOffset: arg.start }
  }
  // A `${…}` template carries expressions → declined here so it reaches the
  // same opaque-Code path the old backtick arm's `${` guard produced.
  if (arg.type === 'TemplateLiteral' && arg.expressions.length === 0) {
    return { isSample, isBacktick: true, inner: trimmed.slice(arg.start + 1, arg.end - 1), delimOffset: arg.start }
  }
  return null
}

/**
 * Parse the root function call: note("..."), s("..."), stack(...), or bare expression.
 * `baseOffset` is the absolute char offset of `root[0]` within the user's code.
 */
export function parseRoot(
  root: string,
  baseOffset = 0,
  // #132 (β-2) — caller's s-vs-note context for the bare-string root
  // arm. `undefined` keeps the pre-β-2 default (false). Threaded from
  // the loose recursive arm so `s("bd".jux(rev))`'s inner `"bd"` parses
  // with sample semantics (β-1 probe resolution).
  isSampleKey?: boolean,
  // 20-15 G1 (#134 / D-02) — binding map threaded to the stack-arg loop
  // so a bare-identifier arg matching a key substitutes the bound subtree
  // (the cleanest hook per research R4). `undefined` everywhere except the
  // no-`$:` G1 entry.
  bindings?: ReadonlyMap<string, PatternIR>,
  // 20-18 E-1 (D-01) — flagged-general fallback (off-by-default,
  // measurement-only, NEVER gate-counted). See `parseStrudel` for the
  // full contract. Threaded EXACTLY as `bindings` (optional trailing
  // STACK param; PV50). When `opts?.recogniseGeneralChainRoots === true`
  // AND the root token is an unbound `identifier(...)` chain head NOT in
  // `CHAIN_ROOT_RECOGNISER`, the general arm emits a structured-OPAQUE
  // `Code.via{method, args, inner}` wrapper. `undefined`/`false` →
  // dormant → byte-identical.
  opts?: { recogniseGeneralChainRoots?: boolean },
  // #1468 A — numeric top-level bindings, so an `arrange` arm whose weight is
  // written `M*8` reads as 8. Optional trailing STACK param (PV50), threaded
  // exactly as `bindings`; `undefined` = literal weights only.
  numbers?: ReadonlyMap<string, number>,
): PatternIR {
  const trimmed = root.trim()
  const leadingWs = root.length - root.trimStart().length

  // 20-15 G3 (#136) — a captured backtick inner that contains a `${`
  // interpolation is REAL JS evaluation (D-04): the matcher must NOT
  // attempt parseMini — return the canonical bare IR.code fallback
  // (via===undefined, the pS:~414 shape). Clean branch, never a throw
  // (PV37 wrap-never-drop; the outer try/catch stays a backstop only).
  const backtickInnerToIR = (
    inner: string,
    isSample: boolean,
    innerOffset: number,
  ): PatternIR => {
    if (inner.includes('${')) return IR.code(trimmed)
    return parseMini(inner, isSample, innerOffset)
  }

  // 20-17 G2 (D-01) — bound-ident-root substitution. When the root token
  // is a bare identifier present in `bindings`, splice the bound subtree
  // as the root; the existing applyChain (called by parseExpression at
  // pS:911) then runs the chain over the spliced IR. Placed BEFORE the
  // strict regex arms (note/n/s/sound/mini/loose): a bare ident in
  // `bindings` can never syntactically match those arms (they require a
  // `(` call shape; a bare ident has none) so this strictly WIDENS — it
  // cannot regress any existing parse (a bound ident reached parseRoot
  // only via the bare-Code fallback pre-20-17). PV49 holds: the spliced
  // subtree carries its DEFINITION-SITE offset (stored at parse time
  // inside buildBindingMap); applyChain uses the USE-SITE chain offset
  // arithmetic independently — additivity is preserved because the
  // chain arithmetic does not depend on the root's internal offset.
  // Without this arm, `chords2.rootNotes(2).note()` with `chords2`
  // resolved still parsed `chords2` as a bare ident → bare Code →
  // opaque fence. Mirrors the parseExpression whole-expr precedent
  // (pS:869-873).
  if (bindings && /^[A-Za-z_$][\w$]*$/.test(trimmed) && bindings.has(trimmed)) {
    return bindings.get(trimmed) as PatternIR
  }

  // Phase 5a (#386) — time-sequence combinators (`arrange`/`cat`/`slowcat`/
  // `fastcat`). Placed AFTER the G2 bound-ident arm (a user shadow wins) and
  // BEFORE the curated recogniser, which still lists `arrange`→Builder as the
  // opaque fallback: a malformed combinator returns null here and falls
  // through to that Builder path (behaviour-preserving). Real source now
  // parses into the structured `Arrange`/`Seq` node — fixes the arrange=blank
  // gap (collect previously returned [] for the opaque Builder).
  const timeSeq = parseTimeSequenceRoot(trimmed, baseOffset, leadingWs, bindings, opts, numbers)
  if (timeSeq) return timeSeq

  // 20-18 Wave B-1 (D-01 curated chain-root recogniser) — emit
  // `{tag:'Signal'|'Builder', kind, args?}` for the FROZEN Wave-0 curated
  // set (`20-18-OBSERVATIONS.md` ACTION 6). Placement: AFTER the G2
  // bound-ident arm (a user-shadow `const sine = s("bd")` wins via G2),
  // BEFORE `noteMatch` (every reaching input was provably bareCode by
  // Wave-0 R-1 probe — strict widen). The chain is NOT touched here:
  // per the Wave-0 ACTION 5 verdict (a) ROOT-recognition-suffices, the
  // EXISTING `applyChain` (~pS:1351) composes `.range`/`.struct`/`.slow`/
  // `.sometimesBy(...)` over the new root exactly as it composes them
  // over any root — `sound("a b").sometimesBy(0.5, fast(2))`→`Choice`
  // proved the chain arm wraps unparsed/opaque args by default. `chord`/
  // `arrange` are EXCLUDED (Wave C ground-first OPAQUE-pending). `args`
  // is the RAW (untrimmed) source slice — `Code.via.args` byte-verbatim
  // convention; the parser NEVER evaluates a signal / runs `.range` /
  // invokes a builder (D-02 matcher line). PV49 holds — definition-site
  // offsets via the EXISTING `baseOffset + leadingWs + …` convention
  // (mirrors pS:1090 `noteMatch` and pS:1156 loose-arm arithmetic).
  // PV50 holds — `CHAIN_ROOT_RECOGNISER` is a module-const immutable
  // literal (same idiom as `RESERVED_LABEL_IDENTS` pS:791), NOT mutable
  // state.
  const recognised = CHAIN_ROOT_RECOGNISER.get(trimmed)
  if (recognised) {
    // Bare 0-arity ident (e.g. `sine`/`perlin`/`rand`/`time`) — `trimmed`
    // is exactly the curated kind token; no `(` present. `loc` = root
    // token absolute offset via the existing convention.
    const rootStart = baseOffset + leadingWs
    const rootLoc: SourceLocation = {
      start: rootStart,
      end: rootStart + trimmed.length,
    }
    if (recognised.tag === 'Signal') {
      return IR.signal(recognised.kind, undefined, { loc: [rootLoc] })
    }
    // Unreachable for the FROZEN Wave-0 set (every `Builder` kind is
    // arg-taking per R-2 — `run`/`irand`/`binary`/`binaryN`/`binaryL`/
    // `binaryNL` all require an `(n)` arg). Defensive: emit a 0-arg
    // builder rather than fall through to bareCode if a future kind
    // widens to 0-arity (the FROZEN set + re-pose discipline owns
    // membership changes).
    return IR.builder(recognised.kind as (PatternIR & { tag: 'Builder' })['kind'], '', undefined, { loc: [rootLoc] })
  }
  // Arg-taking root: `<curatedToken>(<rawArgs>)` — token must match the
  // curated set AND be followed by `(`. The token is anchored at the
  // start of `trimmed`; balanced-paren-slice the RAW args between `(`
  // and the matching `)`. `args` is byte-verbatim source (NOT trimmed)
  // per the `Code.via.args` convention.
  const argMatch = trimmed.match(/^([A-Za-z_$][\w$]*)\s*\(/)
  if (argMatch) {
    const token = argMatch[1]
    const argRecognised = CHAIN_ROOT_RECOGNISER.get(token)
    if (argRecognised) {
      const openParenIdx = trimmed.indexOf('(', argMatch[0].length - 1)
      const closeIdx =
        openParenIdx >= 0 ? findMatchingParen(trimmed, openParenIdx) : -1
      if (closeIdx > openParenIdx) {
        const rawArgs = trimmed.slice(openParenIdx + 1, closeIdx)
        // Root-token loc spans the token itself (not the args). args
        // offset = baseOffset + leadingWs + openParenIdx + 1 (the
        // loose-arm convention at pS:1170-1176).
        const rootStart = baseOffset + leadingWs
        const rootLoc: SourceLocation = {
          start: rootStart,
          end: rootStart + token.length,
        }
        if (argRecognised.tag === 'Signal') {
          return IR.signal(argRecognised.kind, rawArgs, { loc: [rootLoc] })
        }
        return IR.builder(argRecognised.kind as (PatternIR & { tag: 'Builder' })['kind'], rawArgs, undefined, { loc: [rootLoc] })
      }
      // Malformed paren shape — fall through to existing arms / bareCode.
    }
  }

  // note/n/s/sound/mini("…") — a pattern-source root applied to ONE string or
  // backtick literal. #959 category B: the nine name×quote regexes that used to
  // live here (`note`/`n`, `s`/`sound`, `mini`, each × `"`/`'`/`` ` ``) are one
  // acorn extraction. The NAME chooses sample-vs-note semantics, the DELIMITER
  // chooses `backtickInnerToIR` (spans newlines) vs `parseMini`. `sound` is
  // Strudel's alias of `s` (#136); single and double quotes are identical for
  // mini-notation (#659); `mini(...)` produces a value pattern for `pick`
  // (19-04 T-02). All three histories now flow through one delegated read;
  // `delimOffset` reproduces the old `indexOf(quote)` so loc fidelity holds.
  const sourceCall = extractPatternSourceCall(trimmed)
  if (sourceCall) {
    const innerOffset = baseOffset + leadingWs + sourceCall.delimOffset + 1
    return sourceCall.isBacktick
      ? backtickInnerToIR(sourceCall.inner, sourceCall.isSample, innerOffset)
      : parseMini(sourceCall.inner, sourceCall.isSample, innerOffset)
  }

  // #132 (β-2) — LOOSE recursive arm for note/n/s/mini args that carry
  // an inner method chain, e.g. `n("[0,3]".fast(3).lastOf(4, fast(2)))`.
  // Fires ONLY after the strict `"…"\)` fast-paths above (so the common
  // single-string case keeps its exact 20-14 snapshot), and ONLY when
  // the inner is NOT a plain `"…"` / `` `…` `` (those belong to the
  // strict/backtick arms). The inner is delegated to parseExpression —
  // there is NO IR.note(parsed) constructor (research conflict); the
  // inner ROOT is a mini string and the rest is a CHAIN, exactly what
  // parseExpression already decomposes (split-root/chain + parseMini +
  // applyChain). The β-1 probe proved the s-vs-note `isSampleKey`
  // context is NOT inert and MUST be threaded (s→true, note/n/mini→
  // false). P67: if the recursion returns BARE Code
  // (tag==='Code' && via===undefined), fall THROUGH to the existing
  // IR.code(trimmed) fallback below — never emit a half-wrapped node to
  // a via-expecting consumer.
  const looseMatch = trimmed.match(/^(note|n|s|sound|mini)\s*\(/)
  if (looseMatch) {
    const fnName = looseMatch[1]
    const openParenIdx = trimmed.indexOf('(', looseMatch[0].length - 1)
    const closeIdx =
      openParenIdx >= 0 ? findMatchingParen(trimmed, openParenIdx) : -1
    if (closeIdx > openParenIdx) {
      const inner = trimmed.slice(openParenIdx + 1, closeIdx)
      const innerTrimmed = inner.trim()
      // Let the strict regexes (above) own the plain single-string case
      // — both `"…"` and backtick `` `…` `` (β-3) — to avoid churn on
      // the 15 structured tunes. Only enter for chained / non-plain
      // inners (the actual #132 shape).
      const isPlainQuoted = /^"[^"]*"$/.test(innerTrimmed)
      const isPlainBacktick = /^`[^`]*`$/.test(innerTrimmed)
      if (!isPlainQuoted && !isPlainBacktick && innerTrimmed.length > 0) {
        // Absolute offset of inner[0] within the user's full source:
        // baseOffset + leadingWs already points at trimmed[0]; the inner
        // starts at openParenIdx+1 within `trimmed` (additive — same
        // shape as the stack arm).
        const innerLeadingWs = inner.length - inner.trimStart().length
        const innerAbsOffset =
          baseOffset + leadingWs + openParenIdx + 1 + innerLeadingWs
        // β-1 resolution: thread the caller's sample context.
        const callerIsSample = fnName === 's' || fnName === 'sound'
        // 20-17 G1 (D-01) — thread the caller's `bindings` context into
        // the inner chained expression's parse. Without this thread,
        // `sound(rp1)` with `rp1` in `bindings` still parsed `rp1` as a
        // bare ident → bareCode → opaque-RHS fence → the whole program
        // bails. `bindings` is in scope from parseRoot's 4th param
        // (pS:931 signature). The `callerIsSample` (PV51) arg is
        // unchanged and continues to flow alongside the new `bindings`.
        // PV49 holds: parameter-only addition, no offset arithmetic
        // touched (`innerAbsOffset` was already computed correctly
        // pre-20-17 above).
        const innerIR = parseExpression(
          innerTrimmed,
          innerAbsOffset,
          callerIsSample,
          bindings,
          opts,
        )
        const innerIsBareCode =
          innerIR.tag === 'Code' &&
          (innerIR as { via?: unknown }).via === undefined
        // P67: bare-Code inner → DO NOT wrap; fall through to the
        // canonical IR.code(trimmed) fallback at the bottom of parseRoot
        // (single bare-Code shape, via===undefined). Only a structured
        // (or via-wrapped) inner is accepted here.
        if (!innerIsBareCode) {
          return innerIR
        }
        // else: fall through to the opaque fallback below.
      }
    }
  }

  // stack(a, b, c) — parallel composition. Issue #107 — each arg's
  // absolute file offset is now threaded into parseExpression so
  // inner atoms resolve to real file positions. Without this,
  // `stack(s("hh*8"), s("bd"))` produced events whose `loc[0]`
  // pointed inside the file's first line (typically a comment),
  // collapsing click-to-source for any sample-track event.
  const stackMatch = trimmed.match(/^stack\s*\(/)
  if (stackMatch) {
    // #901 — locate the `(` from the MATCH (whose `\s*` already consumed
    // any gap), never by re-searching for a literal `stack(`. A literal
    // disagrees with the regex the moment the source reads `stack (` or
    // `stack\n(`, and the arm then falls through to the opaque Code
    // fallback — a blank timeline for the whole program. Same idiom as
    // the arrange/cat, curated and loose arms.
    const openIdx = trimmed.indexOf('(', stackMatch[0].length - 1)
    const closeIdx = openIdx >= 0 ? findMatchingParen(trimmed, openIdx) : -1
    if (closeIdx > openIdx) {
      const inner = trimmed.slice(openIdx + 1, closeIdx)
      // Absolute file offset of inner[0] = baseOffset + leadingWs + openIdx + 1.
      const innerAbsOffset = baseOffset + leadingWs + openIdx + 1
      const argsWithOffsets = splitArgsWithOffsets(inner)
      // 20-15 G1 (#134 / D-02) — thread the binding map so a bare-ident
      // arg (`stack(p1, p2)`) substitutes the bound subtree at THIS
      // insertion point (the cleanest hook per R4). A ref whose name is
      // NOT in the map (use-before-def, undefined ident) is NOT
      // substituted → parses as a bare ident → bare Code → the
      // whole-expression Code fallback (D-02 topology-preserving, no
      // throw). Substituted subtrees keep definition-site loc (R6).
      const tracks = argsWithOffsets.map((a) =>
        parseExpression(a.value, innerAbsOffset + a.offset, undefined, bindings, opts),
      )
      if (tracks.length === 0) return IR.pure()
      if (tracks.length === 1) return tracks[0]
      // 19-05 / #74: root-level `stack(...)` outer Stack carries the call-
      // site range + userMethod: 'stack' (D-08 exact-token — distinct from
      // `'layer'` at T-04 even though both produce Stack tags). Literal
      // construction — IR.stack is rest-spread (RESEARCH §11 Q1).
      // The whole `stack(...)` substring spans from `trimmed[0]` (whose
      // absolute position is `baseOffset + leadingWs`) through the closing
      // paren at `closeIdx`.
      const trimmedAbs = baseOffset + leadingWs
      return {
        tag: 'Stack' as const,
        tracks,
        loc: [{ start: trimmedAbs, end: trimmedAbs + closeIdx + 1 }],
        userMethod: 'stack',
      }
    }
  }

  // Phase 20-14 parser-gap fix (cluster A) — bare-string-as-pattern.
  // Strudel's transpiler auto-promotes top-level string literals to
  // mini-patterns. Mirrors mini("...") semantically — produces values,
  // not notes/samples. Fired AFTER all named-function arms so this is a
  // fallback for "expression starts with a bare string" (e.g.,
  // `"0,2,[7 6]".add(...)` from barryHarris / holyflute).
  // Single-line string only (mini-notation never spans newlines).
  const bareStringMatch = trimmed.match(/^"([^"]*)"$/)
  if (bareStringMatch) {
    // innerOffset points at the FIRST char inside the quotes.
    const innerOffset = baseOffset + leadingWs + 1
    // #132 (β-2): when the loose recursive arm threaded the caller's
    // s-vs-note context, honour it here; otherwise keep the pre-β-2
    // default of `false` (snapshot-preserving for the 15 tunes).
    return parseMini(bareStringMatch[1], isSampleKey ?? false, innerOffset)
  }
  // #659 — bare single-quoted string root `'…'`. The loose recursive arm
  // (note/n/s/sound/mini with a chained inner, e.g. `s('bd'.fast(2))`) splits
  // the inner to root=`'bd'` + chain; without this arm that single-quoted
  // root falls to bare Code and the sample/note is dropped. Quote-agnostic
  // mini semantics — same parseMini as the `"…"` arm above.
  const bareStringSqMatch = trimmed.match(/^'([^']*)'$/)
  if (bareStringSqMatch) {
    const innerOffset = baseOffset + leadingWs + 1
    return parseMini(bareStringSqMatch[1], isSampleKey ?? false, innerOffset)
  }
  // 20-15 G3 (#136) — bare backtick `` `…` `` template-literal root.
  // `[^`]*` spans newlines (multi-line mini-notation, e.g.
  // `` `<bd hh>\n<sn ~>`.cpm(2) ``). `${}` → graceful Code (D-04).
  const bareBtMatch = trimmed.match(/^`([^`]*)`$/)
  if (bareBtMatch) {
    const innerOffset = baseOffset + leadingWs + 1
    return backtickInnerToIR(bareBtMatch[1], isSampleKey ?? false, innerOffset)
  }

  // #144 (20-15 V-1 backlog) — parenthesized SINGLE string-literal root:
  // `("1*1, 2*2 … 16*16").mul(60).freq()…` (Bakery sample --cHhfOZ6ON1).
  // `splitRootAndChain` ALREADY slices `("…").chain` into
  // root=`("…")` + the correct leading-dot chain (the ident-else
  // branch's `findMatchingParen` at pS:~1945-1949; the leading-dot
  // multi-line continuation is sliced too). The ONLY gap is parseRoot
  // had no arm for `( <string-lit> )` → it fell through to bare
  // IR.code below. This arm strips the wrapping parens and recurses the
  // inner string through the EXISTING bare-string / backtick logic
  // (quote-agnostic mini semantics — same parseMini / backtickInnerToIR
  // used by the arms above).
  //
  // SCOPE BOUNDARY (CONTEXT D-03 / issue #144 — root-shape RECOGNITION
  // only, NOT arbitrary parenthesized JS): the regex matches a SINGLE
  // `"…"` OR `` `…` `` between the parens with NOTHING else — not
  // `( s("bd") )`, not `( a, b )`, not nested calls. Any other
  // parenthesized content falls through to the existing IR.code
  // fallback UNCHANGED (pre-mortem mitigation: never mis-parse a
  // non-string-literal root as a mini string).
  // #659 — single-quoted `'…'` accepted alongside `"…"` / `` `…` `` (the
  // else-branch routes both quote styles through parseMini identically).
  const parenStrMatch = trimmed.match(/^\(\s*("[^"]*"|'[^']*'|`[^`]*`)\s*\)$/)
  if (parenStrMatch) {
    const litRaw = parenStrMatch[1]
    const isBacktick = litRaw[0] === '`'
    const innerLit = litRaw.slice(1, -1)
    // Offset of the inner string's FIRST char in ORIGINAL source.
    // baseOffset+leadingWs points at trimmed[0] = the `(`. The inner
    // quote sits after the `(` + any leading whitespace inside the
    // parens. Compute that gap via the PV49 shared primitive
    // (`skipWhitespaceAndLineComments`) — do NOT hand-roll the scan
    // (PV49: route every new inter-token scan through the primitive so
    // the loc offset stays additive against ORIGINAL source). The
    // primitive returns the index of the opening quote within
    // `trimmed`; +1 skips the quote to the first inner char.
    const quotePosInTrimmed = skipWhitespaceAndLineComments(trimmed, 1)
    const innerOffset = baseOffset + leadingWs + quotePosInTrimmed + 1
    const inner = isBacktick
      ? backtickInnerToIR(innerLit, isSampleKey ?? false, innerOffset)
      : parseMini(innerLit, isSampleKey ?? false, innerOffset)
    // P67: if the inner recursion returns BARE Code
    // (tag==='Code' && via===undefined) — e.g. a backtick carrying
    // `${}` (D-04) — fall THROUGH to the canonical IR.code(trimmed)
    // fallback below; never emit a half-wrapped node to a via-expecting
    // consumer (mirror the loose-arm discrimination at pS:~1027).
    const innerIsBareCode =
      inner.tag === 'Code' && (inner as { via?: unknown }).via === undefined
    if (!innerIsBareCode) return inner
    // else: fall through to the opaque fallback below.
  }

  // 20-18 E-1 (D-01) — flagged-general fallback (off-by-default,
  // measurement-only, NEVER gate-counted). When `opts.recogniseGeneralChainRoots
  // === true` AND `trimmed` is an unbound `identifier(...)` chain head NOT
  // already handled by the strict arms above AND NOT in the curated
  // `CHAIN_ROOT_RECOGNISER` set, emit a structured-OPAQUE
  // `Code.via{method, args, callSiteRange, inner}` wrapper (D-01: unknowns
  // CANNOT be modelled — opaque is correct for the general path; this is
  // NOT a `Signal`/`Builder` tag — those are reserved for curated-set
  // kinds). `inner` is the canonical bare `IR.code(trimmed)` (the same
  // shape this function returns at the bottom for an unrecognised root),
  // so the produced node is byte-identical to bare-Code MODULO the `via`
  // structural marker — every existing consumer that walks `via.inner`
  // still sees the same code-string content.
  //
  // PV50: `opts` flows on the STACK from `parseStrudel` (the 20-17 G4
  // optional-arg-threading idiom; NOT module state). Default-undefined →
  // this branch is unreachable → byte-identical to pre-E-1 output. The
  // parity oracle (`_bakery-classify.spec.ts:77`) calls `parseStrudel`
  // with EXACTLY one arg → opts is never constructed by the gate → this
  // arm is STRUCTURALLY never-gate-counted (the never-gate-counted
  // invariant, asserted in parseStrudel.generalChainRootFlag.test.ts).
  //
  // Placement: LAST arm before the bare-Code fallback. Any strict arm
  // (curated set / note / s / sound / mini / loose recursive / stack /
  // bareString / bareBacktick / parenStr) that already matched returned;
  // any bound identifier root was substituted by the G2 arm
  // (pS:~1155-1157). Reaching here = strictly the unhandled
  // `identifier(...)` (or bare `identifier`) shape — the long tail.
  //
  // The chain (.bar()/.baz(...)) rides the EXISTING `applyChain` over
  // this wrapped root unchanged — same composition contract as Wave A's
  // Signal/Builder roots.
  if (opts?.recogniseGeneralChainRoots === true) {
    const genArgMatch = trimmed.match(/^([A-Za-z_$][\w$]*)\s*\(/)
    if (genArgMatch) {
      const token = genArgMatch[1]
      // Exclude curated tokens — they are owned by the curated arm above
      // (this is a strict NON-curated complement; the curated arm fires
      // when present, this arm fires when not).
      if (!CHAIN_ROOT_RECOGNISER.has(token)) {
        const openParenIdx = trimmed.indexOf('(', genArgMatch[0].length - 1)
        const closeIdx =
          openParenIdx >= 0 ? findMatchingParen(trimmed, openParenIdx) : -1
        if (closeIdx > openParenIdx) {
          const rawArgs = trimmed.slice(openParenIdx + 1, closeIdx)
          const rootStart = baseOffset + leadingWs
          const callSiteRange: [number, number] = [rootStart, rootStart + closeIdx + 1]
          // Structured-OPAQUE wrapper — `Code.via{method, args, inner}`
          // shape. Mirrors `wrapAsOpaque` (pS:73-86): tag 'Code' with a
          // structural `via` marker; toStrudel branches on via. The inner
          // is the canonical bare-Code form of `trimmed` (the same shape
          // the bare fallback below produces) — every consumer of `via.inner`
          // walks it the same way it walks the wrapper's inner today.
          return {
            tag: 'Code',
            code: '',
            lang: 'strudel',
            loc: [{ start: callSiteRange[0], end: callSiteRange[1] }],
            via: { method: token, args: rawArgs, callSiteRange, inner: IR.code(trimmed) },
          }
        }
      }
    }
    // Bare identifier (no `(`) — also long-tail unbound. Wrap as
    // structured-OPAQUE with empty args.
    if (/^[A-Za-z_$][\w$]*$/.test(trimmed) && !CHAIN_ROOT_RECOGNISER.has(trimmed)) {
      const rootStart = baseOffset + leadingWs
      const callSiteRange: [number, number] = [rootStart, rootStart + trimmed.length]
      return {
        tag: 'Code',
        code: '',
        lang: 'strudel',
        loc: [{ start: callSiteRange[0], end: callSiteRange[1] }],
        via: { method: trimmed, args: '', callSiteRange, inner: IR.code(trimmed) },
      }
    }
  }

  // Fallback: treat as opaque
  return IR.code(trimmed)
}

// ---------------------------------------------------------------------------
// Method chain walker
// ---------------------------------------------------------------------------

/**
 * Apply a sequence of method calls to an IR node.
 * Each method wraps the current node.
 *
 * `baseOffset` is the absolute char offset of `chain[0]` in the user's
 * full code. Used to thread method-arg positions through parseTransform
 * (PRE-01 precursor — P39 / PV25 signature-level threading).
 */
export function applyChain(
  ir: PatternIR,
  chain: string,
  baseOffset = 0,
  // 20-17 G4 (#141 / D-01) — the pervasive optional-arg threading of the
  // binding map. When set, this map flows THROUGH applyChain into every
  // parseTransform / inner parseExpression recursion so a bound identifier
  // referenced anywhere in a method chain or transform arg resolves to its
  // definition-site subtree. `undefined` everywhere existing callers omit
  // it (the default) → behaviour identical to pre-20-17 by construction.
  // PV50-safe: the context flows on the stack, never module-level state.
  bindings?: ReadonlyMap<string, PatternIR>,
): PatternIR {
  if (!chain.trim()) return ir

  const leadingWs = chain.length - chain.trimStart().length
  let remaining = chain.trim()
  let remainingOffset = baseOffset + leadingWs
  let current = ir

  // Phase 20-14 parser-gap fix (cluster B) — multi-line chain tolerance.
  // Strudel programs commonly format long chains across newlines + indent
  // (e.g., `s("bd").delay(.5)\n    .delaytime(.16)\n    .delayfeedback(.6)`)
  // and tolerate inline `// comment` between methods. The pre-fix walker
  // only progressed while `remaining.startsWith('.')` after a single
  // initial `.trim()` — so the first newline between methods exited the
  // loop and every subsequent method was silently dropped to Code-fallback.
  //
  // 20-15 α-3: the inter-method separator skip is now the shared PV49
  // `skipWhitespaceAndLineComments` primitive (was the inline
  // `INTER_METHOD_SEP = /^(?:\s+|\/\/[^\n]*\n?)+/` regex, now removed —
  // it was referenced ONLY here). The primitive is byte-equivalent to
  // that regex (asserted by skipWhitespaceAndLineComments.test.ts), so
  // this reroute is the PV49 EQUIVALENCE ORACLE: applyChain is already
  // fully tolerant, therefore the 16 corpus IR-shape snapshots, the
  // loc-fidelity snapshot, and the 1551 editor tests MUST all stay
  // byte-for-byte unchanged — that three-way invariance is the proof the
  // primitive matches the reference before any GAP fix builds on it.
  // The offset arithmetic is unchanged and stays owned by applyChain:
  // `remaining` is a 0-based working buffer, so the absolute index the
  // primitive returns IS the consumed length (== the old `sep[0].length`).
  while (true) {
    // Skip inter-method separator (whitespace + line comments) via the
    // shared primitive — same additive shape as the old regex head-match.
    const consumedSep = skipWhitespaceAndLineComments(remaining, 0)
    if (consumedSep > 0) {
      remainingOffset += consumedSep
      remaining = remaining.slice(consumedSep)
    }
    if (!remaining.startsWith('.')) break
    const { method, args, rest, argsOffset } = extractNextMethod(remaining)
    if (!method) break

    // Pre-compute the call-site range BEFORE applyMethod runs (19-05 / #74).
    //   remainingOffset = position of leading '.' in user's full code.
    //   consumed        = the substring length applyMethod is about to handle
    //                     (RESEARCH §10 #12: must compute from
    //                     remaining.length - rest.length BEFORE the
    //                     advance below; off-by-one on the leading '.' is
    //                     the silent trap).
    const consumed = remaining.length - rest.length
    const callSiteRange: [number, number] = [
      remainingOffset,
      remainingOffset + consumed,
    ]

    // argsOffset is -1 when the method has no parens. We pass 0-args
    // calls through with baseOffset = remainingOffset (still > 0 for any
    // non-leading method) so the precursor test's "non-zero" assertion
    // holds even on chains that mix paren-less and paren-ful methods.
    const argsAbsoluteOffset = argsOffset >= 0 ? remainingOffset + argsOffset : remainingOffset
    current = applyMethod(current, method, args, argsAbsoluteOffset, callSiteRange, bindings)

    // Advance remainingOffset by the consumed length (same arithmetic as
    // before — just split across the call to make callSiteRange available).
    remainingOffset += consumed
    remaining = rest
  }

  return current
}

/**
 * Apply a single method call to an IR node.
 * `baseOffset` is the absolute char offset of `args[0]` in the user's
 * full code (or of the method name itself for paren-less methods),
 * threaded forward to any parseTransform calls.
 * `callSiteRange` is the absolute source range of the whole method-call
 * substring (e.g., `.fast(2)` start..end) — passed to `tagMeta` for
 * `loc` + `userMethod` population on the constructed non-Play tag
 * (19-05 / #74). Default `[0, 0]` preserves backward-compat for any
 * potential non-applyChain caller (none exist today).
 */
function applyMethod(
  ir: PatternIR,
  method: string,
  args: string,
  baseOffset = 0,
  callSiteRange: [number, number] = [0, 0],
  // 20-17 G4 (#141 / D-01) — pervasive optional-arg threading: applyChain
  // forwards the binding map here so the transform-arg parseTransform /
  // array-element parseExpression recursions can resolve a bound
  // identifier to its definition-site subtree. `undefined` whenever
  // applyChain's caller omitted it (the default) → behaviour identical to
  // pre-20-17. PV50-safe: stack-threaded, never module-level state.
  bindings?: ReadonlyMap<string, PatternIR>,
): PatternIR {
  // Phase 20-22 D-01 (F2 positions 1+2 ONLY) — when `args` is exactly a
  // bound literal ident, `subbedArgs` is its raw RHS text; otherwise it
  // is `args` unchanged. It is consumed in TWO loc-safe places per arm:
  //   (1) the numeric value parse (`parseFloat`/`parseInt`) — the parsed
  //       scalar carries NO loc (the tag's loc is `callSiteRange`), so
  //       the substituted text never becomes a loc anchor; and
  //   (2) the `wrapAsOpaque` round-trip `via.args` string — NOT a loc
  //       anchor (`callSiteRange` is computed independently of args).
  // It is NEVER routed into a loc-bearing re-parse at the use site
  // (forbidden F2 position 3 — string→mini-leaf cases stay on the
  // existing subtree-splice path at parseStrudel.ts:1131/1248/1430).
  const subbedArgs = substituteBoundIdentInArg(args, bindings)
  switch (method) {
    case 'fast': {
      const n = parseFloat(subbedArgs.trim())
      if (!isNaN(n)) return IR.fast(n, ir, tagMeta(method, callSiteRange))
      return wrapAsOpaque(ir, method, subbedArgs, callSiteRange)   // D-03 (P33 / PV37)
    }

    case 'slow': {
      const n = parseFloat(subbedArgs.trim())
      if (!isNaN(n)) return IR.slow(n, ir, tagMeta(method, callSiteRange))
      return wrapAsOpaque(ir, method, subbedArgs, callSiteRange)   // D-03 (P33 / PV37)
    }

    case 'cat':
    case 'slowcat':
    case 'fastcat': {
      // Phase 5a (#386) — method forms. The receiver `ir` is the FIRST arm;
      // each comma-separated arg is a further arm (weight 1). GROUNDED:
      // `a.cat(b)` ≡ `cat(a, b)` (slowcat, c3@[0,1] e3@[1,2]); `a.fastcat(b)`
      // ≡ `fastcat(a, b)` ≡ Seq (one cycle). args offsets are absolute via
      // baseOffset (the offset of `args[0]` in the user's code).
      const argList = splitArgsWithOffsets(args)
      const moreArms = argList.map(a =>
        parseExpression(a.value, baseOffset + a.offset, undefined, bindings),
      )
      if (moreArms.length === 0) return wrapAsOpaque(ir, method, subbedArgs, callSiteRange)
      if (method === 'fastcat') {
        return {
          tag: 'Seq' as const,
          children: [ir, ...moreArms],
          loc: [{ start: callSiteRange[0], end: callSiteRange[1] }],
          userMethod: 'fastcat',
        }
      }
      const arms: ArrangeArm[] = [ir, ...moreArms].map(pattern => ({ weight: 1, pattern }))
      return IR.arrange(method, arms, tagMeta(method, callSiteRange))
    }

    case 'every': {
      // .every(n, transform)
      const [nStr, transformStr] = splitFirstArg(args)
      const n = parseInt(nStr.trim(), 10)
      if (isNaN(n)) return wrapAsOpaque(ir, method, subbedArgs, callSiteRange)   // D-03 (P33 / PV37)
      const transformOffset = transformStr ? offsetOfSubArg(args, transformStr, baseOffset) : baseOffset
      const transform = transformStr ? parseTransform(transformStr.trim(), ir, transformOffset, bindings) : ir
      if (transform === null) return wrapAsOpaque(ir, method, subbedArgs, callSiteRange)   // D-03 (#969)
      return IR.every(n, transform, ir, tagMeta(method, callSiteRange))
    }

    case 'sometimes': {
      // .sometimes(transform) → Choice(0.5, transform(body), body)
      const transform = args.trim()
        ? parseTransform(args.trim(), ir, baseOffset + (args.length - args.trimStart().length), bindings)
        : ir
      if (transform === null) return wrapAsOpaque(ir, method, subbedArgs, callSiteRange)   // D-03 (#969)
      return IR.choice(0.5, transform, ir, tagMeta(method, callSiteRange))
    }

    case 'sometimesBy': {
      // .sometimesBy(p, transform)
      const [pStr, transformStr] = splitFirstArg(args)
      const p = parseFloat(pStr.trim())
      if (isNaN(p)) return wrapAsOpaque(ir, method, subbedArgs, callSiteRange)   // D-03 (P33 / PV37)
      const transformOffset = transformStr ? offsetOfSubArg(args, transformStr, baseOffset) : baseOffset
      const transform = transformStr ? parseTransform(transformStr.trim(), ir, transformOffset, bindings) : ir
      if (transform === null) return wrapAsOpaque(ir, method, subbedArgs, callSiteRange)   // D-03 (#969)
      return IR.choice(p, transform, ir, tagMeta(method, callSiteRange))
    }

    case 'mask': {
      // .mask("gate") → When
      const gateMatch = args.trim().match(/^"([^"]*)"$/)
      if (gateMatch) return IR.when(gateMatch[1], ir, tagMeta(method, callSiteRange))
      return wrapAsOpaque(ir, method, subbedArgs, callSiteRange)   // D-03 (P33 / PV37)
    }

    case 'layer': {
      // Tier 4 (Phase 19-04 Task T-01). `.layer(...funcs)` desugars per
      // pattern.mjs:796-798 — `stack(...funcs.map(f => f(this)))`. Each
      // func is applied to the body; the original body is NOT included
      // (contrast superimpose at pattern.mjs:810-812 which does include
      // the original via this.stack(...)).
      //
      // We split the comma-separated arg list with the existing splitArgs
      // helper (respects nested parens / strings), parse each func string
      // with parseTransform threading the absolute baseOffset of that
      // func within the user's code, then construct Stack(...transformed).
      //
      // Round-trip: toStrudel currently emits the structural stack(...)
      // form for v1 — the layer-shape recogniser is a follow-up for the
      // bidirectional editing pass (#8). Same soft-target stance taken
      // for jux/off in 19-03. RESEARCH §1.1; CONTEXT round-trip discipline.
      const argList = splitArgs(args)
      if (argList.length === 0) return wrapAsOpaque(ir, method, subbedArgs, callSiteRange)   // D-03 (P33 / PV37)
      const tracks: PatternIR[] = []
      for (const funcStr of argList) {
        const trimmed = funcStr.trim()
        if (!trimmed) {
          tracks.push(ir)
          continue
        }
        const transformOffset = offsetOfSubArg(args, trimmed, baseOffset)
        const track = parseTransform(trimmed, ir, transformOffset, bindings)
        // Any track we cannot model as a chain on the body → opaque the whole
        // `.layer(...)` so it round-trips verbatim (D-03, #969). One
        // fresh-expression arrow makes the structural stack unrecoverable.
        if (track === null) return wrapAsOpaque(ir, method, subbedArgs, callSiteRange)
        tracks.push(track)
      }
      // 19-05 / #74: outer Stack carries .layer(...)'s call-site range +
      // userMethod: 'layer' (D-09 desugar metadata). Literal construction —
      // IR.stack is rest-spread and cannot accept a trailing meta? param
      // (RESEARCH §2 / §11 Q1). Inner transformed funcs inherit metadata
      // through W5's parseTransform (recursive applyChain).
      const [layerStart, layerEnd] = callSiteRange
      return {
        tag: 'Stack' as const,
        tracks,
        loc: [{ start: layerStart, end: layerEnd }],
        userMethod: method, // 'layer' — D-08 exact-token from the switch label
      }
    }

    case 'chunk': {
      // Tier 4 (Phase 19-03 Task 09). `.chunk(n, transform)` desugars
      // (pattern.mjs:2569-2578):
      //   binary = [true, false × (n-1)]
      //   binary_pat = _iter(n, sequence(binary), true)
      //   pat = pat.repeatCycles(n)
      //   return pat.when(binary_pat, transform)
      //
      // Because `repeatCycles(n)` slows the body to span n outer cycles,
      // each outer cycle plays only one slot of the body. Combined with
      // the rotated binary, the transform is applied to ALL events the
      // chunk emits in any given outer cycle.
      //
      // Our IR's Chunk tag stores `transform` as the body with the user
      // transform pre-applied (parseTransform), so the slot-replacement
      // logic in collect can take events directly from `transform`. This
      // mirrors the existing Every shape (Every.body = transformed,
      // Every.default_ = base).
      //
      // v1 limitation (pre-mortem #3): single-cycle bodies only.
      // Multi-cycle bodies would require modelling repeatCycles' source
      // rolling, deferred to a follow-up. parseTransform doesn't thread
      // baseOffset through (P39 / pre-mortem #10), so loc on transformed
      // events points back to the body — PV24 presence holds, value
      // precision is the existing limitation.
      const [nStr, transformStr] = splitFirstArg(args)
      const n = parseInt(nStr.trim(), 10)
      if (isNaN(n) || n < 1) return wrapAsOpaque(ir, method, subbedArgs, callSiteRange)   // D-03 (P33 / PV37)
      const transformOffset = transformStr ? offsetOfSubArg(args, transformStr, baseOffset) : baseOffset
      const transform = transformStr ? parseTransform(transformStr.trim(), ir, transformOffset, bindings) : ir
      if (transform === null) return wrapAsOpaque(ir, method, subbedArgs, callSiteRange)   // D-03 (#969)
      return IR.chunk(n, transform, ir, tagMeta(method, callSiteRange))
    }

    case 'degrade': {
      // Tier 4 (Phase 19-03 Task 07). `.degrade()` shorthand for
      // `.degradeBy(0.5)` (signal.mjs:720). Our Degrade.p is the
      // retention probability; 50% drop ⇒ 50% retain ⇒ p = 0.5.
      return IR.degrade(0.5, ir, tagMeta(method, callSiteRange))
    }

    case 'degradeBy': {
      // Tier 4 (Phase 19-03 Task 07). `.degradeBy(amount)` filters each
      // event with drop probability `amount` (signal.mjs:686-706 — keeps
      // events where `rand > amount`). Our Degrade.p is the RETENTION
      // probability — translate via p = 1 - amount.
      //
      // Off-by-one trap (CONTEXT pre-mortem #2 / RESEARCH §3.4): the
      // direction of the inversion silently inverts user intent, so two
      // boundary tests below land at degradeBy(0) (full retain) and
      // degradeBy(1) (full drop) plus an asymmetric probe at
      // degradeBy(0.8) that distinguishes p=0.2 from the wrong p=0.8.
      const amount = parseFloat(subbedArgs.trim())
      if (isNaN(amount)) return wrapAsOpaque(ir, method, subbedArgs, callSiteRange)   // D-03 (P33 / PV37)
      // D-08 exact-token: userMethod is `'degradeBy'`, NOT `'degrade'`. The
      // tag is Degrade (canonical) but `method` here is the user's literal
      // `'degradeBy'` from the switch — pass it through, don't substitute.
      return IR.degrade(1 - amount, ir, tagMeta(method, callSiteRange))
    }

    case 'late': {
      // Tier 4 (Phase 19-03 Task 03). `.late(t)` shifts events forward by
      // `t` cycles while preserving cycle length (pattern.mjs:2081-2089).
      // Modeled as the Late IR tag (Task 02). Decimal literals only —
      // fraction literals like `.late(1/8)` fall back to identity (same
      // limitation `.fast()` has today).
      const t = parseFloat(subbedArgs.trim())
      if (isNaN(t)) return wrapAsOpaque(ir, method, subbedArgs, callSiteRange)   // D-03 (P33 / PV37)
      return IR.late(t, ir, tagMeta(method, callSiteRange))
    }

    case 'jux': {
      // Tier 4 (Phase 19-03 Task 05). `.jux(f)` desugars per
      //   pattern.mjs:2379-2381: jux(func, pat) = pat._juxBy(1, func, pat)
      //   pattern.mjs:2356-2368: juxBy halves the `by` arg, then
      //     left  = pat.withValue(v => { pan: (v.pan ?? 0.5) - by/2 })
      //     right = func(pat.withValue(v => { pan: (v.pan ?? 0.5) + by/2 }))
      //     return stack(left, right)
      // For `jux(f)` with by=1: by/2 = 0.5 → left pan = 0.0 (full left),
      // right pan = 1.0 (full right) in Strudel's [0,1] convention.
      //
      // Our IR's pan convention is [-1, 1] centered at 0 (PatternIR.ts:23
      // PlayParams). Mapping: Strudel 0.0 → ours -1; Strudel 1.0 → ours +1.
      // The parity harness applies `normalizeStrudelPan` (p*2-1) to the
      // Strudel side before diff so both sides land in [-1, 1].
      //
      // Round-trip: no Jux tag exists by design — the desugar is exact.
      // toStrudel emits the structural Stack(Param(pan,…), Param(pan,…))
      // form (no `.jux(...)` recovery in this wave). Accepted soft target
      // per CONTEXT round-trip discipline.
      //
      // PRE-01 (PR #70): parseTransform now receives a non-zero
      // baseOffset for the transform-arg position; loc-attribution to
      // non-Play nodes still deferred per RESEARCH §2 Subtlety C.
      const transformed = args.trim()
        ? parseTransform(args.trim(), ir, baseOffset + (args.length - args.trimStart().length), bindings)
        : ir
      if (transformed === null) return wrapAsOpaque(ir, method, subbedArgs, callSiteRange)   // D-03 (#969)
      // 19-05 / #74: outer Stack carries .jux(...)'s call-site range +
      // userMethod: 'jux' (D-09). Inner Param(pan, ±1) nodes are SYNTHETIC —
      // no metadata (a missing userMethod is the marker irProjection strips on,
      // and setting loc would mislead click-to-source into thinking the user
      // typed `.pan(...)`; RESEARCH §7). The `transformed` body
      // keeps its own Play.loc and inherited tag-level locs from the inner
      // applyChain recursion.
      const leftPan = IR.param('pan', -1, '-1', ir)
      const rightPan = IR.param('pan', 1, '1', transformed)
      const [juxStart, juxEnd] = callSiteRange
      return {
        tag: 'Stack' as const,
        tracks: [leftPan, rightPan],
        loc: [{ start: juxStart, end: juxEnd }],
        userMethod: method, // 'jux'
      }
    }

    case 'ply': {
      // Tier 4 (Phase 19-03 Task 10). `.ply(n)` repeats each event of the
      // body `n` times within its own slot (pattern.mjs:1905-1911):
      //   ply(factor, pat) = pat.fmap(x => pure(x)._fast(factor)).squeezeJoin()
      //
      // Originally the plan called for desugaring to `Fast(n, Seq(body × n))`,
      // but a probe (W4 T10) showed our Fast scales `ctx.speed` rather than
      // re-playing the body, so the desugar compresses events into [0, 1/n)
      // instead of spreading them across [0, 1). With Fast unable to model
      // ply's per-event multiplication, we promoted Ply to a forced new IR
      // tag (D-02 rule). Round-trip is then direct: toStrudel emits `.ply(n)`
      // (no shape recogniser needed).
      //
      // Non-integer factors (e.g. `.ply(2.5)`, `.ply("<2 3 4>")`) fall
      // through silently — same default-branch behaviour the parser uses for
      // any unrecognised method-arg shape today. Documented as a known
      // limitation; matches CONTEXT D-02's "non-integer falls through to
      // Code fallback in v1; revisit in 19-04 if needed."
      const trimmed = args.trim()
      const n = Number(trimmed)
      // Phase 20-04 T-05 (D-03 / P33 / PV37): wrap on parse failure.
      if (!Number.isInteger(n) || n < 1) return wrapAsOpaque(ir, method, subbedArgs, callSiteRange)
      // Phase 20-04 T-05 Trap 2: ply(1) is a VALID no-op per CONTEXT D-02
      // from 19-03 — leave UNCHANGED. Wrapping here would change the IR
      // shape (Code-with-via{ inner: Play(c) } instead of bare Play(c))
      // and break existing parity tests asserting `ply(1) === ir`.
      if (n === 1) return ir
      return IR.ply(n, ir, tagMeta(method, callSiteRange))
    }

    case 'off': {
      // Tier 4 (Phase 19-03 Task 04). `.off(t, f)` literally desugars to
      //   stack(pat, func(pat.late(time_pat)))     [pattern.mjs:2236-2238]
      // i.e., the user-supplied transform is applied to `pat.late(t)` —
      // late is computed FIRST, then the transform wraps that. So our
      // mirror is Stack(body, transform(Late(t, body))).
      //
      // Order matters. The plan-task draft used Stack(body, Late(t,
      // transform(body))) — that puts transform inside Late, not outside,
      // which produces a different event stream when the transform
      // re-times (e.g., `fast(2)`: applying fast AFTER late differs from
      // applying late AFTER fast — the latter is what Strudel does).
      // This was caught by parity diff and corrected; the desugar below
      // is the one Ground Truth supports.
      //
      // Round-trip: no Off tag exists by design — the desugar is exact.
      // For now toStrudel emits the structural Stack (no recovery); a
      // future bidirectional-editing pass (#8) can shape-match and
      // re-emit `.off(t, …)`. Accepted soft target per CONTEXT round-trip
      // discipline (which applies fully only to 1:1 method↔tag mappings,
      // not desugars).
      //
      // PRE-01 (PR #70): parseTransform now receives the transform-arg
      // baseOffset; loc-attribution to non-Play nodes still deferred per
      // RESEARCH §2 Subtlety C — parity asserts loc PRESENCE, not value.
      const [tStr, transformStr] = splitFirstArg(args)
      const t = parseFloat(tStr.trim())
      if (isNaN(t)) return wrapAsOpaque(ir, method, subbedArgs, callSiteRange)   // D-03 (P33 / PV37)
      // 19-05 / #74 D-09: inner Late carries tStr's range (the `0.125` arg
      // position). userMethod intentionally omitted — Late from .off() is a
      // synthetic intermediate, not directly authored. Reuse the existing
      // offsetOfSubArg helper (lines below) — same P39-aware whitespace
      // handling already used for transformOffset.
      const tStartAbs = offsetOfSubArg(args, tStr.trim(), baseOffset)
      const tEndAbs = tStartAbs + tStr.trim().length
      const lateBody = IR.late(t, ir, {
        loc: [{ start: tStartAbs, end: tEndAbs }],
        // userMethod intentionally undefined — synthetic intermediate (D-09).
      })
      const transformOffset = transformStr ? offsetOfSubArg(args, transformStr, baseOffset) : baseOffset
      const transformed = transformStr ? parseTransform(transformStr.trim(), lateBody, transformOffset, bindings) : lateBody
      // Opaque the WHOLE `.off(t, f)` (on `ir`, the pre-`late` receiver) when
      // the transform can't be modelled, so it round-trips verbatim (D-03, #969).
      if (transformed === null) return wrapAsOpaque(ir, method, subbedArgs, callSiteRange)
      // Outer Stack carries .off(...)'s call-site range + userMethod: 'off'.
      // Literal construction — rest-spread escape hatch (RESEARCH §11 Q1).
      const [offStart, offEnd] = callSiteRange
      return {
        tag: 'Stack' as const,
        tracks: [ir, transformed],
        loc: [{ start: offStart, end: offEnd }],
        userMethod: method, // 'off'
      }
    }

    case 'room':
    case 'delay':
    case 'reverb':
    case 'crush':
    case 'distort':
    case 'vowel':
    case 'begin':
    case 'end':
    case 'cut':
    case 'cutoff':
    case 'resonance':
    case 'lpf':
    case 'hpf': {
      // #944 + #967 — every name in this group classifies as Param. Route
      // through the single control authority FIRST: each name except `reverb`
      // is a real @strudel/core control, so asControlParam classifies BOTH
      // numeric and pattern args as Param under the canonical key (lpf→cutoff,
      // hpf→hcutoff), retiring the arg-shape split #935 left behind (numeric→FX,
      // pattern→Param — one control filed under two tags).
      const asParam = asControlParam(method, args, baseOffset, ir, callSiteRange)
      if (asParam) return asParam
      // #967 — the two names the registry does not know keep the fallback so
      // neither regresses classified→opaque (PV201). `reverb` (the core control
      // is `room`) and a bound-scalar arg the registry cannot resolve file as a
      // Param under the user's OWN token — since #967 deleted the FX tag, there
      // is no bucket to fall back to. `.reverb(0.5)` files `evt.params.reverb`
      // and round-trips `.reverb(0.5)`. A signal/expression arg
      // (`.cutoff(perlin.range(...))`) is neither numeric nor a modellable
      // pattern, so both branches decline and it opaques — as it did before.
      const val = parseFloat(subbedArgs.trim())
      if (!isNaN(val)) return IR.param(method, val, args, ir, tagMeta(method, callSiteRange))
      return wrapAsOpaque(ir, method, subbedArgs, callSiteRange)
    }

    case 'pickRestart':
    case 'pickReset':
    case 'pick': {
      // Tier 4 (Phase 19-04 Task T-02). `.pick(lookup)` per pick.mjs:44-54:
      //   pat.fmap(i => lookup[clamp(round(i), 0, len-1)]).innerJoin()
      // For each event of the receiver (`ir`, the selector pattern), the
      // value (cast to int + clamp) selects a sub-pattern from the lookup
      // array; that sub-pattern plays at the selector event's time slot.
      //
      // First IR shape that takes a list of sub-patterns as data (not a
      // transform function) — Pick is the prototype for the family
      // (inhabit, pickF, pickmod, pickRestart, pickReset, pickOut).
      // RESEARCH §1.4.
      //
      // #463 Stage 1 — OBJECT/named-key form `.pickRestart({verse:…, …})`:
      // the selector's STRING value keys the lookup. Tried FIRST for all
      // three grounded variants (pick=innerJoin, pickRestart=restartJoin,
      // pickReset=resetJoin); the variant drives collect's inner-cycle
      // timing. `subbedArgs` is carried verbatim as `rawArgs` so toStrudel
      // round-trips byte-identically to the opaque Code it replaces.
      const namedEntries = parseNamedPickEntries(args, baseOffset, bindings)
      if (namedEntries && namedEntries.length > 0) {
        return IR.namedPick(ir, namedEntries, method, subbedArgs, tagMeta(method, callSiteRange))
      }
      // Array-form lookup is structured for `pick` only (innerJoin); the
      // array form of pickRestart/pickReset stays opaque (PV37) until a
      // consumer needs it.
      if (method !== 'pick') return wrapAsOpaque(ir, method, subbedArgs, callSiteRange)   // D-03 (P33 / PV37)
      const inner = args.trim()
      if (!(inner.startsWith('[') && inner.endsWith(']'))) return wrapAsOpaque(ir, method, subbedArgs, callSiteRange)   // D-03 (P33 / PV37)
      const arrayBody = inner.slice(1, -1)
      const elements = splitArgs(arrayBody)
      if (elements.length === 0) return wrapAsOpaque(ir, method, subbedArgs, callSiteRange)   // D-03 (P33 / PV37)
      // Compute the absolute baseOffset of the array body within the
      // user's full code (skip the opening '[' inside args).
      const arrayBodyOffsetInArgs = args.indexOf('[') + 1
      const arrayBodyOffset = arrayBodyOffsetInArgs >= 1
        ? baseOffset + arrayBodyOffsetInArgs
        : baseOffset
      const lookup = elements.map(e => {
        const elemOffset = offsetOfSubArg(arrayBody, e.trim(), arrayBodyOffset)
        return parseArrayLiteralElement(e, 'note', elemOffset, bindings)
      })
      return IR.pick(ir, lookup, tagMeta(method, callSiteRange))
    }

    case 'struct': {
      // Tier 4 (Phase 19-04 Task T-03). `.struct(mask)` per pattern.mjs:1161:
      //   struct(mask) = this.keepif.out(mask)
      // _opOut is "structure from mask, values from this" — RE-TIMES this
      // pattern's value-stream to mask onsets. Distinct from `.mask("…")`
      // (When tag) which only GATES events through. RESEARCH §1.2; P43
      // (documented spec ≠ source — keepif.out is the implementation truth).
      //
      // mask is a quoted mini-notation string; we carry it raw on the IR
      // (matches When.gate precedent — sub-IR form deferred per RESEARCH §8.2).
      const gateMatch = args.trim().match(/^"([^"]*)"$/)
      if (gateMatch) return IR.struct(gateMatch[1], ir, tagMeta(method, callSiteRange))
      return wrapAsOpaque(ir, method, subbedArgs, callSiteRange)   // D-03 (P33 / PV37)
    }

    case 'swing': {
      // Tier 4 (Phase 19-04 Task T-04). `.swing(n)` per pattern.mjs:2193:
      //   swing(n, pat) = pat.swingBy(1/3, n)
      //                 = pat.inside(n, late(seq(0, 1/6)))   (pattern.mjs:2184)
      //
      // Narrow tag per D-03 — we model swing directly via slot-index
      // lateness in the collect arm, NOT through an Inside primitive
      // (which would warrant its own phase with outside/zoom/compress
      // siblings). When Inside lands, the Swing collect arm rewrites
      // (~10 lines); the IR shape `{ n; body }` is locked to keep that
      // migration cheap. RESEARCH §1.3.
      const n = parseInt(subbedArgs.trim(), 10)
      if (isNaN(n) || n < 1) return wrapAsOpaque(ir, method, subbedArgs, callSiteRange)   // D-03 (P33 / PV37)
      return IR.swing(n, ir, tagMeta(method, callSiteRange))
    }

    case 'shuffle': {
      // Tier 4 (Phase 19-04 Task T-06). `.shuffle(n)` per signal.mjs:
      // 392-394:
      //   shuffle(n, pat) = _rearrangeWith(randrun(n), n, pat)
      // Slices pat into n parts, plays them in a random per-cycle
      // PERMUTATION (each part exactly once). Forced tag per PV28 (named
      // after the user-typed method); collect arm + shared helper landed
      // in T-05. Parity test in T-07. RESEARCH §1.5; PK11 step 5.
      const n = parseInt(subbedArgs.trim(), 10)
      if (isNaN(n) || n < 1) return wrapAsOpaque(ir, method, subbedArgs, callSiteRange)   // D-03 (P33 / PV37)
      return IR.shuffle(n, ir, tagMeta(method, callSiteRange))
    }

    case 'scramble': {
      // Tier 4 (Phase 19-04 Task T-06). `.scramble(n)` per signal.mjs:
      // 405-407:
      //   scramble(n, pat) = _rearrangeWith(_irand(n)._segment(n), n, pat)
      // Slices pat into n parts and INDEPENDENTLY samples each slot's
      // source — parts may repeat or not appear at all per cycle. Forced
      // tag per PV28; collect arm + shared helper landed in T-05. Parity
      // test in T-07. RESEARCH §1.6; PK11 step 5.
      const n = parseInt(subbedArgs.trim(), 10)
      if (isNaN(n) || n < 1) return wrapAsOpaque(ir, method, subbedArgs, callSiteRange)   // D-03 (P33 / PV37)
      return IR.scramble(n, ir, tagMeta(method, callSiteRange))
    }

    case 'chop': {
      // Tier 4 (Phase 19-04 Task T-08). `.chop(n)` per pattern.mjs:
      // 3291-3306:
      //   chop(n, pat) = pat.squeezeBind(o => sequence(slice_objects.map(s => merge(o, s))))
      // Per-event sample-range slicing: each source event becomes n
      // sub-events whose time and `begin`/`end` controls carve up the
      // original event. D-04: pattern-level only — audio buffer slicing
      // is axis-5 work, deferred to phase 22. Forced tag per PV28
      // (squeezeBind has no Fast equivalent; same trap as Ply). RESEARCH
      // §1.7; PK11 step 5.
      const n = parseInt(subbedArgs.trim(), 10)
      if (isNaN(n) || n < 1) return wrapAsOpaque(ir, method, subbedArgs, callSiteRange)   // D-03 (P33 / PV37)
      return IR.chop(n, ir, tagMeta(method, callSiteRange))
    }

    case 'p': {
      // Phase 20-11 D-01/D-02 — `.p("name")` overrides auto `d{N}` from $:.
      // The 20-04 Chesterton (`return ir`) was correct under the PV37
      // REPRESENTATION model but the musician-track-identity model (PV35)
      // needs the SEMANTICS pair — mirror Param's promotion (20-10).
      //
      // Single decision (P50 — no fallback ladders): `args` is a content-
      // bearing string literal (with surrounding quotes after the parser's
      // arg extraction) → Track wrap. Anything else (no args, non-string,
      // empty string, mini-syntax inside the literal) falls back to
      // wrapAsOpaque (PV37 preserved; round-trip via toStrudel `.via.method/
      // args` still emits `.p(...)` byte-for-byte).
      //
      // Identifier-only quoted string with optional spaces / `:.-_`. Brackets,
      // angle-brackets, star, tilde, pipe excluded — anything mini-syntax
      // routes through wrapAsOpaque so the user's intent is preserved as a
      // typed source fragment.
      // Phase 20-11 wave-δ — accept BOTH single and double-quoted string
      // literals. Strudel's transpiler converts double-quoted strings
      // to mini-notation Patterns at runtime, so `.p("name")` will
      // CRASH at eval time (Strudel's .p calls `id.includes("$")` on
      // the resulting Pattern object). The working idiom is single
      // quotes: `.p('name')`. We accept both at the IR level so the
      // Track wrap still happens even if the user types double quotes
      // (the timeline shows the right row; the runtime fails
      // separately and we no-op in the StrudelEngine wrapper).
      const trimmed = args.trim()
      const strMatch = trimmed.match(
        /^(?:"([a-zA-Z0-9_\-][a-zA-Z0-9_:.\- ]*?)"|'([a-zA-Z0-9_\-][a-zA-Z0-9_:.\- ]*?)')$/,
      )
      const name = strMatch?.[1] ?? strMatch?.[2]
      if (!name) {
        // Empty / mini-syntax / non-string / no args / backtick mini —
        // preserve PV37.
        return wrapAsOpaque(ir, method, subbedArgs, callSiteRange)
      }
      return IR.track(name, ir, tagMeta(method, callSiteRange))
    }

    case 's':
    case 'n':
    case 'note':
    case 'bank':
    case 'scale':
    case 'color':
    case 'freq':
    case 'gain':
    case 'velocity':
    case 'pan':
    case 'speed': {
      // Phase 20-10 — Param tag promotion. Whitelist closes the SEMANTICS
      // gap that 20-04 left open for REPRESENTATION. PV37 still governs
      // everything outside this whitelist (default arm wraps as opaque).
      //
      // Phase 20-12 D-06 — `freq` added so chrome's Y-as-pitch can read
      // `evt.params.freq` (β-4 extractPitch). Pre-20-12 `.freq(440)`
      // wrapped as opaque Code via the default arm and `evt.params.freq`
      // was always undefined. Numeric → Param; non-numeric / pattern args
      // fall through parseParamArg's null-return → wrapAsOpaque (PV37
      // wrap-never-drop preserved; P50 single-decision — no third path).
      //
      // Phase 20-12 wave-δ — `freq` is numeric-only. `parseParamArg` arms
      // 2 + 3 (literal-string / mini-pattern) accept quoted args for
      // pattern-friendly Params (`.s("<bd cp>")` etc.) but `.freq(...)`
      // is fundamentally a Hz literal: a pattern-arg `.freq("<200 880>")`
      // resolves to a per-cycle number that chrome's `extractPitch` then
      // Y-staircases — which would silently violate PV37 (chrome reading
      // pitch from a wrap-as-opaque shape). Gate freq to numeric here so
      // pattern-arg freq lands in `wrapAsOpaque` like any other unmodelled
      // call. P50 single-decision preserved; PV37 wrap-never-drop intact.
      const isSampleKey = method === 's' || method === 'bank' || method === 'scale'
      const parsed = parseParamArg(args, isSampleKey, baseOffset)
      if (!parsed) {
        // Unrecognised arg shape — preserve PV37 (wrap-never-drop, REPRESENTATION).
        return wrapAsOpaque(ir, method, subbedArgs, callSiteRange)
      }
      if (method === 'freq' && typeof parsed.value !== 'number') {
        // Pattern-arg freq is wrap-as-opaque per PV37; chrome must not see
        // pattern-resolved Hz on `evt.params.freq`. See 20-δ rationale above.
        return wrapAsOpaque(ir, method, subbedArgs, callSiteRange)
      }
      return IR.param(method, parsed.value, args, ir, tagMeta(method, callSiteRange))
    }

    default: {
      // #928 (Tier 2 — deny-list) — before opaquing, ask Strudel's OWN control
      // registry whether this method is a control. The curated arms above stay
      // the authority for the ~24 controls whose FX/Param routing + arg gating
      // (freq numeric-only, sample-key s/bank/scale) we already trust; this
      // fallback catches the ~250 REMAINING core controls (clip, sustain,
      // attack, release, lpenv, rlp→roomlp, …) that the whitelist omitted and
      // that were opaquing — starving the mixer + structural views.
      //
      // Routing = Param (carries key+value+rawArgs; the shape the mixer/chrome
      // read via `evt.params[key]`). The user-typed token is preserved (`key`
      // = method, `userMethod` via tagMeta), NOT the canonical alias, so
      // round-trip stays byte-identical (`.rlp(0.5)` re-emits `.rlp(0.5)`,
      // never `.roomlp(...)`). Universal args via parseParamArg (number |
      // ident-string | mini). Any shape it can't model (a lambda / signal /
      // nested expression) → null → the opaque fallback below (PV37
      // wrap-never-drop; P50 single-decision — no third path).
      //
      // NOTE isControlName is DISJOINT from every structural transform above
      // (verified — 0 collisions), so reaching here with a control name is
      // unambiguous. `scale` (@strudel/tonal) + `reverb` (webaudio, not a core
      // control) are isControlName=false but stay handled by their curated
      // arms above → they never regress to opaque through this path.
      const asParam = asControlParam(method, args, baseOffset, ir, callSiteRange)
      if (asParam) return asParam
      // Phase 20-04 T-04 / DV-06 (D-03 / P33 / PV37): unrecognised method (or a
      // control with an unmodellable arg) — wrap as opaque Code carrying the
      // call site. PV37 wrap-never-drop; round-trip via toStrudel (D-02);
      // collect walks via.inner via withWrapperLoc (20-03 wave ε / D-01).
      return wrapAsOpaque(ir, method, subbedArgs, callSiteRange)
    }
  }
}

// ---------------------------------------------------------------------------
// Test hook (PRE-01 / PR #70): record the most recent baseOffset received
// by parseTransform so a parity-harness probe can assert that multi-arg
// methods thread non-zero offsets through the call chain. Internal — not
// part of the public API. Reset between tests via __resetParseTransformDebug.
// ---------------------------------------------------------------------------
let __lastParseTransformBaseOffset = -1
let __parseTransformCallCount = 0
export function __resetParseTransformDebug(): void {
  __lastParseTransformBaseOffset = -1
  __parseTransformCallCount = 0
}
export function __getLastParseTransformBaseOffset(): number {
  return __lastParseTransformBaseOffset
}
export function __getParseTransformCallCount(): number {
  return __parseTransformCallCount
}

/**
 * Parse a transform function used in .every() / .sometimes() / .off() / .jux() / .chunk().
 * e.g. "fast(2)", "rev", "x => x.fast(2)"
 *
 * `baseOffset` is the absolute char offset of `transformStr[0]` in the
 * user's full code (PRE-01 precursor — signature-level threading; loc
 * attribution to non-Play nodes is deferred per RESEARCH §2 Subtlety C).
 */
/**
 * Classify a chain method as a Param by asking Strudel's OWN control registry
 * (#928), or null when it is not a control / its arg cannot be modelled.
 *
 * Key by the CANONICAL control name, not the token the user typed. `collect`
 * maps a param key onto its event field (params.s → evt.s), so keying an alias
 * by its own spelling (`.sound(...)` → key 'sound') would leave every `evt.s`
 * consumer blind — a control that LOOKS modelled in the view but reads as
 * absent downstream (the false-affordance class). Round-trip is unaffected:
 * toStrudel emits `userMethod ?? key` (toStrudel.ts:89) and tagMeta carries the
 * user's token, so `.sound("bd")` re-emits `.sound("bd")`, never `.s("bd")`.
 *
 * isControlName is DISJOINT from every structural transform (verified — 0
 * collisions), so reaching here with a control name is unambiguous. `scale`
 * (@strudel/tonal) and `reverb` (webaudio, not a core control) are
 * isControlName=false and stay with their curated arms.
 *
 * Shared by the FX arms and the default arm so the two cannot drift: before
 * #935 they disagreed about what a pattern argument means.
 */
function asControlParam(
  method: string,
  args: string,
  baseOffset: number,
  ir: PatternIR,
  callSiteRange: [number, number],
): PatternIR | null {
  if (!isControlName(method)) return null
  const canonical = getControlName(method)
  // isSampleKey must follow the CANONICAL name too — `sound`'s mini is sample
  // names, and parseMini keys the wrong field (and the wrong per-event
  // duration) if it thinks they are note names.
  const isSampleKey = canonical === 's' || canonical === 'bank'
  const parsed = parseParamArg(args, isSampleKey, baseOffset)
  if (!parsed) return null // unmodellable control arg → caller opaques (PV37)
  return IR.param(canonical, parsed.value, args, ir, tagMeta(method, callSiteRange))
}

function parseTransform(
  transformStr: string,
  defaultIr: PatternIR,
  baseOffset = 0,
  // 20-17 G4 (#141 / D-01) — the pervasive optional-arg threading of the
  // binding map. When set, this map flows through parseTransform's inner
  // applyChain / parseExpression recursions so a bound identifier inside a
  // transform arg (e.g. `.every(2, x => x.fast(p))`) resolves to its
  // definition-site subtree. `undefined` everywhere existing callers omit
  // it (the default) → behaviour identical to pre-20-17 by construction.
  // PV50-safe: the context flows on the stack, never module-level state.
  bindings?: ReadonlyMap<string, PatternIR>,
  // Returns `null` when the transform cannot be expressed as a chain on the
  // body (a fresh-expression arrow, `compose`, …). The caller opaques the
  // whole `.method(args)` call site on `null` so it round-trips verbatim
  // (#969) rather than embedding a broken transform in its structural IR.
): PatternIR | null {
  __lastParseTransformBaseOffset = baseOffset
  __parseTransformCallCount++

  const str = transformStr.trim()

  // 19-05 / #74 D-10: callSiteRange covers the whole bare-form expression
  // (`fast(2)` / `slow(2)`). For arrow paths, the recursive applyChain
  // computes per-method callSiteRange — this outer range is unused there.
  const trimmedStart = baseOffset + (transformStr.length - transformStr.trimStart().length)
  const callSiteRange: [number, number] = [trimmedStart, trimmedStart + str.length]

  // fast(n)
  const fastMatch = str.match(/^fast\s*\(\s*([0-9.]+)\s*\)$/)
  if (fastMatch) {
    const n = parseFloat(fastMatch[1])
    if (!isNaN(n)) return IR.fast(n, defaultIr, tagMeta('fast', callSiteRange))
  }

  // slow(n)
  const slowMatch = str.match(/^slow\s*\(\s*([0-9.]+)\s*\)$/)
  if (slowMatch) {
    const n = parseFloat(slowMatch[1])
    if (!isNaN(n)) return IR.slow(n, defaultIr, tagMeta('slow', callSiteRange))
  }

  // Arrow function like "x => x.fast(2)" — recurse with the chain offset
  // adjusted to the position of `.fast(...)` inside the arrow body. The
  // param and body-var may be multi-char, and the param may be parenthesised
  // (`pp => pp.fast(2)`, `(x) => x.fast(2)`) — all reduce to the same chain
  // applied to the body. A narrower `[a-z]`-only match used to drop those
  // forms to the silent identity below (#963).
  const arrowMatch = str.match(/^\(?\s*[A-Za-z_$][\w$]*\s*\)?\s*=>\s*[A-Za-z_$][\w$]*\s*\.(.+)$/)
  if (arrowMatch) {
    const dotIdx = str.indexOf('.', str.indexOf('=>'))
    const chainStartInTrimmed = dotIdx >= 0 ? dotIdx : 0
    const leadingWs = transformStr.length - transformStr.trimStart().length
    const chainOffset = baseOffset + leadingWs + chainStartInTrimmed
    return applyChain(defaultIr, '.' + arrowMatch[1], chainOffset, bindings)
  }

  // Bare partial-application form the typed arms above did not model —
  // `fast(2*2)`, `slow(-2)`, `add(5)`, a bare `rev`, or any `name(args)` /
  // `name`. Returning `defaultIr` here silently asserted an IDENTITY
  // transform: the node vanished and the timeline drew `every(n, identity)`,
  // positively wrong music with no tag-count change to catch it (#963, PV37
  // wrap-never-drop, north-star invariant 4 — no silent data loss). Wrap it
  // as an opaque Code node carrying the verbatim source: the transform is
  // then PRESENT in the tree (collect walks `via.inner`; toStrudel re-emits
  // `() => body.name(args)`, which applies `name(args)` to the every-cycle
  // body and is hap-identical to the partially-applied `name(args)` form).
  // We deliberately do NOT route this through applyChain — its `fast`/`slow`
  // arms `parseFloat` the arg, which would truncate `2*2` to `2` (a
  // plausible-wrong value); the opaque wrap preserves `2*2` exactly and
  // defers the semantics to Strudel's own eval.
  const bareCall = str.match(/^([A-Za-z_$][\w$]*)\s*(?:\(([\s\S]*)\))?\s*$/)
  if (bareCall) return wrapAsOpaque(defaultIr, bareCall[1], bareCall[2] ?? '', callSiteRange)

  // Identity arrow (`x => x`, `(p) => p`) — the transform IS the body, so
  // return it unchanged: that is exactly f(body) for f = identity, and it
  // keeps the method's structural IR (Every/Stack/…) rather than opaquing it.
  const identityArrow = str.match(/^\(?\s*([A-Za-z_$][\w$]*)\s*\)?\s*=>\s*([A-Za-z_$][\w$]*)\s*$/)
  if (identityArrow && identityArrow[1] === identityArrow[2]) return defaultIr

  // Residual: a transform we cannot express as a chain on the body — a
  // fresh-expression arrow that rebuilds the pattern from its arg
  // (`x => n("a").set(x)`), a `compose(...)`, etc. Signal it with `null` so
  // the CALLER opaques the WHOLE `.method(args)` call site (its existing D-03
  // fallback), which round-trips the transform verbatim. Embedding an opaque
  // `body.method(args)` wrapper here instead would emit invalid JS for a
  // function body, and returning `defaultIr` would silently assert identity
  // (#963/#969, PV37 wrap-never-drop).
  return null
}

/**
 * Phase 20-10 — recognise the arg shape for a whitelisted Param method.
 * Returns null when the shape doesn't match; caller wraps as opaque
 * (preserves PV37). Shapes:
 *   - literal-number:  gain(0.3) / pan(-0.5)         → { value: 0.3 }
 *   - literal-string:  s("sawtooth") / bank("RolandTR909")  → { value: "sawtooth" }
 *   - mini-pattern:    s("<bd cp>") / gain("0.3 0.7")  → { value: PatternIR (sub-IR) }
 *
 * Boundary: any quoted string with internal whitespace OR mini-syntax
 * characters (`<`, `>`, `[`, `]`, `*`, `?`, `~`) goes to the mini-pattern
 * path. Strudel runtime parses it as mini at that point too. Identifier-
 * only quoted strings (`/^"[a-zA-Z0-9#_:-]*?"$/`) take the literal path.
 *
 * baseOffset threading: when a quoted string parses as mini, the inner
 * string's offset (for click-to-source on inner atoms — PV25 / PV36)
 * is `argsOffsetAbs + args.indexOf('"') + 1`. Same convention parseRoot
 * uses for `s(...)` at root (parseStrudel.ts:223-224).
 */
function parseParamArg(
  args: string,
  isSampleKey: boolean,
  argsOffsetAbs: number,
): { value: string | number | PatternIR } | null {
  const trimmed = args.trim()
  // 1. literal-number — via the shared `isNumericLiteral` (#957), which is the
  //    ONE place this question is answered. The transcribed regex that used to
  //    live here rejected `.5`, so `.gain(.8)` — ordinary Strudel shorthand —
  //    opaqued. It reached every control routed through here, curated or
  //    registry; the curated FX arms only looked healthy because their
  //    `parseFloat` fallback accepted `.5` and re-tagged the node FX, masking
  //    the defect for exactly the controls most often written that way.
  if (isNumericLiteral(trimmed)) return { value: Number(trimmed) }
  // 2. literal-string (identifier-only — no spaces, no mini-syntax).
  //     #659 — single quotes accepted alongside double (`.s('square')`).
  const strMatch =
    trimmed.match(/^"([a-zA-Z0-9#_:-]*?)"$/) ?? trimmed.match(/^'([a-zA-Z0-9#_:-]*?)'$/)
  if (strMatch) return { value: strMatch[1] }
  // 3. mini-pattern (anything else inside quotes) — #659: `'…'` too. The
  //    inner offset is located from the ACTUAL opening-quote char (the
  //    anchored regex guarantees trimmed[0] is that quote), never a
  //    hardcoded indexOf('"') (range discipline for the visual editor).
  const miniMatch = trimmed.match(/^"([^"]*)"$/) ?? trimmed.match(/^'([^']*)'$/)
  if (miniMatch) {
    const innerStr = miniMatch[1]
    const quoteChar = trimmed[0]
    const quoteIdx = args.indexOf(quoteChar)
    const innerOffsetAbs = quoteIdx >= 0 ? argsOffsetAbs + quoteIdx + 1 : argsOffsetAbs
    return { value: parseMini(innerStr, isSampleKey, innerOffsetAbs) }
  }
  return null   // unknown shape — caller wraps as opaque
}

/**
 * Parse a single element of an array-literal arg (used by `.pick([...])`).
 *
 * Three shapes are recognised:
 *   1. Bare quoted-string: `"g a"` or `'c'` — wrapped per receiver context
 *      (defaults to `note(...)`). This handles the docstring shape from
 *      pick.mjs:35-37 — `pick(["g a", "e f", ...])` — where bare strings
 *      need to become miniNotation patterns. Per RESEARCH §1.4 / pre-mortem
 *      #10: receiver-context detection is v1-limited to a fixed default.
 *   2. Bare numeric literal: `0`, `1.5` — wrapped as `note(...)` so the
 *      element produces a Play with that note value.
 *   3. Already a full Strudel expression: `note("c")`, `s("bd")`,
 *      `mini("...")` — parsed directly via parseExpression.
 *
 * `baseOffset` is the absolute char offset of `elem[0]` within the user's
 * full code (PV25 — parser preserves offsets at every hop).
 */
function parseArrayLiteralElement(
  elem: string,
  receiverContext: 'note' | 's',
  baseOffset = 0,
  // 20-17 G4 (#141 / D-01) — pervasive optional-arg threading: applyMethod
  // forwards the binding map here so a `pick`/array-literal element that is
  // a bound identifier resolves to its definition-site subtree via the
  // inner parseExpression recursion. `undefined` whenever the caller
  // omitted it (the default) → behaviour identical to pre-20-17.
  // PV50-safe: stack-threaded, never module-level state.
  bindings?: ReadonlyMap<string, PatternIR>,
): PatternIR {
  const trimmed = elem.trim()
  const leadingWs = elem.length - elem.trimStart().length
  if (!trimmed) return IR.pure()

  // Bare quoted-string: wrap in receiver context to give parseExpression
  // a parseable shape. Adjust baseOffset to point at the wrapper's quote
  // — internally parseRoot computes the inner mini's offset from the
  // wrapper, but the user's code has just `"..."`, so the inner offset
  // relative to the wrapper compensates by `(receiverContext.length + 1)`
  // chars (e.g. `note(` = 5 chars). This keeps Play.loc on the actual
  // user-source positions.
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    const wrapped = `${receiverContext}(${trimmed})`
    // The wrapper adds `note(` (5 chars) before the quote. parseExpression
    // → parseRoot parses `note("...")` and reads inner mini at offset
    // `quoteIdx + 1`. quoteIdx within the wrapper is `receiverContext.length + 1`.
    // To compensate, pass a baseOffset that's behind by `receiverContext.length + 1`
    // chars so the absolute innerOffset lands at the user's actual quote+1.
    const wrapperPrefix = receiverContext.length + 1
    return parseExpression(wrapped, baseOffset + leadingWs - wrapperPrefix, undefined, bindings)
  }

  // Bare numeric literal: wrap in note(...) so it parses as a Play. Third and
  // last site of the transcribed number token (#957) — `.pick([.5, 1])` used
  // to drop the `.5` element here for the same reason `.gain(.8)` opaqued.
  if (isNumericLiteral(trimmed)) {
    const wrapped = `${receiverContext}("${trimmed}")`
    const wrapperPrefix = receiverContext.length + 1 + 1  // note( + opening quote
    return parseExpression(wrapped, baseOffset + leadingWs - wrapperPrefix, undefined, bindings)
  }

  // Full expression — parse as-is.
  return parseExpression(trimmed, baseOffset + leadingWs, undefined, bindings)
}

/** Index of the first top-level `:` (object key/value separator) in an
 *  entry slice — not inside quotes, parens, brackets, or braces. #463 St.1. */
function topLevelColonIndex(s: string): number {
  let depth = 0
  let inStr = false
  let q = ''
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (inStr) {
      if (c === q && s[i - 1] !== '\\') inStr = false
      continue
    }
    if (c === '"' || c === "'" || c === '`') { inStr = true; q = c; continue }
    if (c === '(' || c === '[' || c === '{') depth++
    else if (c === ')' || c === ']' || c === '}') depth--
    else if (c === ':' && depth === 0) return i
  }
  return -1
}

/** Normalize an object-key token to its matching string (strip surrounding
 *  quotes). Returns null for an empty token. #463 Stage 1. */
function normalizePickKey(rawKey: string): string | null {
  const t = rawKey.trim()
  if (!t) return null
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1)
  }
  return t
}

/**
 * Parse an object-literal pick-family arg `{key: pat, …}` into ordered
 * NamedPickEntry[] (#463 Stage 1). Returns null when `args` is not an object
 * literal OR any entry is malformed — the caller then falls back to the
 * array-form path / wrapAsOpaque (PV37 preserved).
 *
 * Each value is parsed with `parseArrayLiteralElement` (the same sub-pattern
 * grammar as array-form pick elements, binding-aware, loc-correct). The key
 * is normalized to its string form so it matches the selector's per-cycle
 * value; `keyLoc` points at the key token so a clip gesture can bind the
 * section's definition site (Stage 2).
 */
function parseNamedPickEntries(
  args: string,
  baseOffset: number,
  bindings?: ReadonlyMap<string, PatternIR>,
): import('./PatternIR').NamedPickEntry[] | null {
  const trimmed = args.trim()
  if (!(trimmed.startsWith('{') && trimmed.endsWith('}'))) return null
  const braceOpen = args.indexOf('{')
  const braceClose = args.lastIndexOf('}')
  if (braceClose <= braceOpen) return null
  const body = args.slice(braceOpen + 1, braceClose)
  const bodyOffsetInArgs = braceOpen + 1
  const parts = splitArgsWithOffsets(body)
  if (parts.length === 0) return null
  const entries: import('./PatternIR').NamedPickEntry[] = []
  for (const part of parts) {
    const colon = topLevelColonIndex(part.value)
    // #1456 — ES object shorthand `{verse}`. The property has no colon because
    // the key token IS the value token, so both read the SAME slice at the SAME
    // offset; everything downstream (bindings lookup, sub-pattern grammar, loc
    // fidelity) is then the `{verse: verse}` path unchanged. That equivalence is
    // the whole specification — see namedPick.test.ts's oracle arms.
    //
    // The guard is deliberately the narrowest thing that admits it: a BARE
    // IDENTIFIER, via the SAME `isBareIdent` authority `substituteBoundIdentInArg`
    // uses — so a key admitted here is always a name that resolver can resolve.
    // A spread (`...rest`) or a method shorthand (`verse() {}`) is colon-less
    // too and is NOT an identifier, so it keeps returning null and keeps the
    // conservative opaque fallback (PV37) by default rather than by enumeration.
    const shorthand = colon < 0 && isBareIdent(part.value)
    if (colon < 0 && !shorthand) return null // malformed entry → bail to opaque
    const rawKey = shorthand ? part.value : part.value.slice(0, colon)
    const rawVal = shorthand ? part.value : part.value.slice(colon + 1)
    const key = normalizePickKey(rawKey)
    if (key == null) return null
    // keyLoc: part.value is already trimmed, so the key starts at part.offset
    // within `body`; it spans the trimmed key token.
    const keyStart = baseOffset + bodyOffsetInArgs + part.offset
    const keyLoc: SourceLocation = { start: keyStart, end: keyStart + rawKey.trim().length }
    // Shorthand's value lives at the key's own offset — the one token is both.
    const valOffset = shorthand
      ? keyStart
      : baseOffset + bodyOffsetInArgs + part.offset + colon + 1
    const pattern = parseArrayLiteralElement(rawVal, 'note', valOffset, bindings)
    entries.push({ key, pattern, keyLoc })
  }
  return entries
}

/**
 * Compute the absolute baseOffset of `subArg` within `args`, given that
 * `args` itself starts at `argsBaseOffset` in the user's full code.
 * Falls back to argsBaseOffset if subArg can't be located (defensive —
 * shouldn't happen since splitFirstArg returns substrings).
 */
function offsetOfSubArg(args: string, subArg: string, argsBaseOffset: number): number {
  const trimmedSub = subArg.trim()
  if (!trimmedSub) return argsBaseOffset
  const idx = args.indexOf(trimmedSub)
  return idx >= 0 ? argsBaseOffset + idx : argsBaseOffset
}

// ---------------------------------------------------------------------------
// String manipulation utilities
// ---------------------------------------------------------------------------

/**
 * Split expression into root function call and method chain.
 * e.g. 'note("c4").fast(2).slow(3)' → { root: 'note("c4")', chain: '.fast(2).slow(3)' }
 *
 * Phase 20-14 parser-gap fix (cluster A) — bare-string-as-pattern.
 * Strudel's transpiler auto-promotes top-level string literals to
 * mini-patterns (e.g., `"0,2,[7 6]".add(...)`). When `expr[0]` is `"`,
 * the root is the quoted string (escapes respected) and the chain
 * starts at the char immediately after the closing quote.
 */
export function splitRootAndChain(expr: string): { root: string; chain: string } {
  let i = 0

  if (expr[0] === '"') {
    // Bare-string root — scan to matching closing quote (escape-aware,
    // single-line: mini-strings never span newlines in the corpus).
    i = 1
    while (i < expr.length && expr[i] !== '"') {
      if (expr[i] === '\\' && i + 1 < expr.length) {
        i += 2
        continue
      }
      i++
    }
    if (i < expr.length) i++ // consume closing quote
  } else if (expr[0] === "'") {
    // #659 — single-quoted bare-string root. Without this arm a leading `'`
    // fell to the identifier branch (no `[a-zA-Z…]` to consume) → root='',
    // so parseRoot never saw the string and the chain (`'bd'.fast(2)`) /
    // bare root (`'0 1 2'`) bareCoded. Mirrors the `"` scan exactly
    // (escape-aware, single-line — mini-strings never span newlines).
    i = 1
    while (i < expr.length && expr[i] !== "'") {
      if (expr[i] === '\\' && i + 1 < expr.length) {
        i += 2
        continue
      }
      i++
    }
    if (i < expr.length) i++ // consume closing quote
  } else if (expr[0] === '`') {
    // 20-15 G3 (#136) — backtick template-literal root. Mirrors the `"`
    // scan but DELIBERATELY allows `\n` inside: backtick mini-notation
    // strings legitimately span multiple lines (the single-line note on
    // the `"` arm above does NOT apply to backticks). Escape-aware for
    // `` \` ``. `${` is NOT special here — splitRootAndChain only finds
    // the root *boundary*; the `${}` → Code-fallback decision (D-04) is
    // made later in parseRoot where the captured inner is inspected.
    i = 1
    while (i < expr.length && expr[i] !== '`') {
      if (expr[i] === '\\' && i + 1 < expr.length) {
        i += 2
        continue
      }
      i++
    }
    if (i < expr.length) i++ // consume closing backtick
  } else {
    // Skip identifier
    while (i < expr.length && /[a-zA-Z0-9_$]/.test(expr[i])) i++

    // 20-20 (#159) — PV49 extension: tolerate inter-element whitespace
    // + `// line-comments` between the identifier and the call-site
    // `(`. Mirrors upstream Strudel's pure-JS-eval whitespace
    // tolerance (acorn.parse at @strudel/transpiler/transpiler.mjs:25-30
    // + Function(body)() at @strudel/core/evaluate.mjs:29-39, Codeberg
    // pin f73b3956). The consumed whitespace MUST be included in the
    // returned `root` slice so parseRoot's existing `\s*\(` regex arms
    // (sMatch, noteMatch, miniMatch, looseMatch) match downstream.
    // When no `(` follows the whitespace, restore `i` to the identifier
    // boundary so bare-identifier roots (e.g. `let x = sine`) behave
    // exactly as before (today's no-call disposition).
    const afterIdent = i
    i = skipWhitespaceAndLineComments(expr, i)

    // If there's an opening paren, find the matching close
    if (i < expr.length && expr[i] === '(') {
      const closeIdx = findMatchingParen(expr, i)
      if (closeIdx !== -1) {
        i = closeIdx + 1
      }
    } else {
      // No `(` after whitespace — restore i to the identifier boundary.
      // Preserves today's behaviour for bare-identifier roots.
      i = afterIdent
    }
  }

  return {
    root: expr.slice(0, i),
    chain: expr.slice(i),
  }
}

/**
 * Extract the next .method(args) from a chain string.
 * Returns { method, args, rest, argsOffset } where rest is the remaining
 * chain and argsOffset is the position of args[0] within the input chain
 * (i.e., right after the opening paren). argsOffset is -1 when the method
 * has no parens.
 */
function extractNextMethod(chain: string): { method: string; args: string; rest: string; argsOffset: number } {
  // Must start with .
  if (!chain.startsWith('.')) return { method: '', args: '', rest: chain, argsOffset: -1 }

  let i = 1
  // Read method name
  let method = ''
  while (i < chain.length && /[a-zA-Z0-9_$]/.test(chain[i])) {
    method += chain[i++]
  }

  if (!method) return { method: '', args: '', rest: chain, argsOffset: -1 }

  // Read optional args in parens
  let args = ''
  let rest = chain.slice(i)
  let argsOffset = -1

  if (rest.startsWith('(')) {
    const closeIdx = findMatchingParen(rest, 0)
    if (closeIdx !== -1) {
      args = rest.slice(1, closeIdx)
      argsOffset = i + 1 // position of args[0] in chain (skip the open paren)
      rest = rest.slice(closeIdx + 1)
    }
  }

  return { method, args, rest, argsOffset }
}

/**
 * Find the index of the closing paren matching the open paren at startIdx.
 */
function findMatchingParen(str: string, startIdx: number): number {
  let depth = 0
  let inString = false
  let stringChar = ''

  for (let i = startIdx; i < str.length; i++) {
    const ch = str[i]

    if (inString) {
      if (ch === stringChar && str[i - 1] !== '\\') inString = false
      continue
    }

    // 20-21 (P70 occurrence-9; supersedes #143 framing) — skip `//`
    // line comments BEFORE the string-quote test so an odd-count
    // apostrophe inside a `// comment` (e.g. `// ma'am`) does NOT put
    // the walker into unterminated-string state and mis-depth the
    // parens. Mirrors the reference branch at
    // splitTopLevelStatements:414-417 exactly. PV49-spirit: line-
    // comment tolerance at a NEW walker call site (chain-arg
    // depth-matcher) — not a new mechanism class.
    if (ch === '/' && str[i + 1] === '/') {
      while (i < str.length && str[i] !== '\n') i++
      continue
    }

    if (ch === '"' || ch === "'" || ch === '`') {
      // 20-15 G3 (#136): backtick is a string delimiter too — without
      // this a `` ` `` inside args (e.g. `stack(s(`bd hh`))`) would not
      // suppress paren/bracket counting and the matcher mis-depths.
      inString = true
      stringChar = ch
      continue
    }

    if (ch === '(' || ch === '[' || ch === '{') depth++
    if (ch === ')' || ch === ']' || ch === '}') {
      depth--
      if (depth === 0) return i
    }
  }

  return -1
}

/**
 * Split comma-separated arguments, respecting balanced parens and strings.
 */
function splitArgs(argsStr: string): string[] {
  return splitArgsWithOffsets(argsStr).map((a) => a.value)
}

/**
 * Issue #107 — position-aware sibling of `splitArgs`. For each
 * comma-separated arg, returns the *trimmed* value AND the byte offset
 * of the trimmed arg's first character within `argsStr`. Callers thread
 * the offset down to `parseExpression(value, baseOffset + offset)` so
 * inner atom `loc` ranges resolve to absolute file positions.
 *
 * Without this, `stack(s("hh*8"), s("bd"))` parses each child at offset
 * 0 within its own slice — atom positions on the resulting events
 * collide with the file's first line (typically a comment), and
 * click-to-source navigates to the wrong place. The original `splitArgs`
 * comment in the stack arm ("Argument offsets are dropped here for v0")
 * was the explicit deferral; this is the v1 lift.
 */
function splitArgsWithOffsets(
  argsStr: string,
): Array<{ value: string; offset: number }> {
  const args: Array<{ value: string; offset: number }> = []
  let depth = 0
  let current = ''
  let currentStart = 0 // index in argsStr where `current` began
  let inString = false
  let stringChar = ''

  const pushCurrent = (): void => {
    if (current.trim().length === 0) return
    // 20-15 α-4 / #137 (G4): generalise the per-arg leading scan from
    // whitespace-only to the shared PV49 primitive so a leading
    // `// comment\n` (a whole-line comment between `stack()` args, OR a
    // comment after a `,` that the comma branch folded into the next
    // arg's leading region) is treated as consumed prefix — not as the
    // arg's first real char. Without this the arg substring begins with
    // `/`, `splitRootAndChain` reads `/` as the root, and the arg falls
    // to Code() (`Stack[Code,Code]` instead of `Stack[Play,Play]`).
    //
    // OFFSET CONTRACT (the α-4 pre-mortem mitigation): `consumed` is the
    // SINGLE source of truth — the trimmed value is sliced FROM
    // `consumed` and the offset is computed FROM the same `consumed`, so
    // they can never drift apart by the comment length. For the
    // no-comment case `consumed` === the old leading-`\s` count exactly
    // (the primitive consumes `\s` runs identically), so every existing
    // corpus snapshot + loc-fidelity entry is byte-for-byte unchanged.
    // Trailing whitespace is still trimmed (parity with the old
    // `current.trim()`); trailing trim never moves the START offset.
    const consumed = skipWhitespaceAndLineComments(current, 0)
    args.push({
      value: current.slice(consumed).trimEnd(),
      offset: currentStart + consumed,
    })
  }

  for (let i = 0; i < argsStr.length; i++) {
    const ch = argsStr[i]

    if (inString) {
      current += ch
      if (ch === stringChar && argsStr[i - 1] !== '\\') inString = false
      continue
    }

    // 20-21 (P70 occurrence-9; supersedes #143 framing) — skip `//`
    // line comments BEFORE the string-quote test so an odd-count
    // apostrophe inside a `// comment` (e.g. `// ma'am`) does NOT put
    // the walker into unterminated-string state and mis-attribute commas
    // as arg separators. Mirrors splitTopLevelStatements:414-417.
    //
    // OFFSET CONTRACT (PV49-spirit; mitigates RESEARCH §R-7 PM-4): the
    // comment chars are APPENDED to `current` (the per-arg byte buffer)
    // so the per-arg byte slice stays byte-identical to the source.
    // `pushCurrent` already consumes leading `// comment\n` via
    // `skipWhitespaceAndLineComments(current, 0)` (pS:2685-2693), so
    // the trimmed `value` + `offset` lockstep is preserved — the
    // comment is treated as leading-prefix the same way the existing
    // primitive handles leading whitespace.
    if (ch === '/' && argsStr[i + 1] === '/') {
      if (current.length === 0) currentStart = i
      while (i < argsStr.length && argsStr[i] !== '\n') {
        current += argsStr[i]
        i++
      }
      // Append the `\n` itself if we hit one (preserves byte-additive
      // semantics; the outer for-loop's i++ would otherwise skip it).
      if (i < argsStr.length) {
        current += argsStr[i]
      }
      continue
    }

    if (ch === '"' || ch === "'" || ch === '`') {
      // 20-15 G3 (#136): backtick is a string delimiter — a `,` inside a
      // `` `…` `` arg must NOT split it (e.g. `stack(s(`bd, hh`))`), and
      // a backtick inside an arg must not let comma-splitting see commas
      // that belong to the template literal.
      inString = true
      stringChar = ch
      if (current.length === 0) currentStart = i
      current += ch
      continue
    }

    if (ch === '(' || ch === '[' || ch === '{') {
      depth++
      if (current.length === 0) currentStart = i
      current += ch
      continue
    }
    if (ch === ')' || ch === ']' || ch === '}') {
      depth--
      if (current.length === 0) currentStart = i
      current += ch
      continue
    }

    if (ch === ',' && depth === 0) {
      pushCurrent()
      current = ''
      currentStart = i + 1
    } else {
      if (current.length === 0) currentStart = i
      current += ch
    }
  }

  pushCurrent()
  return args
}

/**
 * Split "n, rest..." into [n, rest].
 * Respects balanced parens for the rest part.
 */
function splitFirstArg(argsStr: string): [string, string] {
  const parts = splitArgs(argsStr)
  if (parts.length === 0) return ['', '']
  if (parts.length === 1) return [parts[0], '']
  return [parts[0], parts.slice(1).join(', ')]
}
