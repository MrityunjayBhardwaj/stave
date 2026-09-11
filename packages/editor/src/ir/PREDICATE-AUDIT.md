# Predicate audit — `ir/parseStrudel.ts`

Every regular expression in `parseStrudel.ts`, the question it answers, and the system that
owns the right answer. 37 are anchored predicates (categories A and B); 7 are unanchored
(category D), two of which are predicates as well.

This file is a **census, not a plan**. It exists so that "find the next parser bug" becomes
"close a finite list". Nothing here changes behaviour, and no entry is an instruction to
refactor — the sequencing lives in the issue.

`predicateAudit.test.ts` re-derives the census from the source on every run and fails if the
two disagree, so a new predicate cannot be added without appearing here first.

---

## Why this file exists

`parseStrudel.ts` decides things about JavaScript source text and about Strudel's vocabulary.
It answers those questions itself, in hand-written regular expressions. Every other module in
the parse path asks somebody who already knows:

| module | asks | anchored regexes | lines |
|---|---|---|---|
| `ir/parseMini.ts` | krill | **0** | 397 |
| `ir/collect.ts` | — | **0** | 1419 |
| `ir/parseStrudelStages.ts` | — | **0** | 377 |
| `visualEdit/chunkDetect.ts` | acorn | **0** | 496 |
| `visualEdit/arrange/parse.ts` | acorn | **0** | 223 |
| **`ir/parseStrudel.ts`** | **nobody** | **37** | **4214** |

Every module that delegates has zero. The one that does not has thirty-seven (was 42 before #965 delegated the pattern-source grid, and 36 before #1178 moved the side-effect head list to `statementHeads.ts`). `parseMini.ts` is
the controlled before/after: 512 lines with a hand-rolled tokenizer, 397 lines and no anchored
regexes after it was rebuilt on krill.

(The five zeroes are a negative result, so they carry a control arm: the same query finds
anchored regexes in 42 other `.ts` files under `packages/editor/src`, and `parseMini.ts`
retains two *unanchored* single-character scans — `/[0-9.]/` and `/\s/` at
`parseMini.ts:302,377` — which locate a boundary rather than decide what a token means.)

**Line numbers throughout this file are indicative and drift.** They are navigation aids as of
the commit that added this document; the gate deliberately keys on regex *source*, never on
position, so a moved predicate does not read as a new one.

### The failure mode is silence

A regular expression cannot express an infinite grammar, so every transcription here is
incomplete by construction. None of them throw. Three things happen instead, in increasing
order of harm:

1. **The node opaques.** It becomes `Code`, keeps its bytes, and loses its structure. Honest,
   and visible in the parity counts.
2. **The node changes meaning.** `.s("drum/kit")` stops being a literal sample name and is
   re-read as mini-notation.
3. **The node silently disappears.** `.every(2, fast(2*2))` produces an `Every` wrapping the
   *untransformed* pattern. There is no `Code` marker, no count movement, and no error — the
   IR simply asserts a transform that the source does not contain, and the view draws it.

Class 3 is the reason counting these is worth more than fixing them one at a time.

### How to read the "known-incomplete" column

Every case marked **observed** was run through `parseStrudel` against a control arm that
differs only in the property under test, and the two IR tag-paths compared. Cases marked
**reasoned** follow from the regex but were not run. Nothing here is asserted from reading
the regex alone without saying so.

---

## Category A — JavaScript syntax · owner: **acorn**

29 of the 37. `acorn` is already a dependency and is already used to parse this same source
text, three times, in `visualEdit/`. The package parses one document two different ways.

### A1 · "is this token a bare identifier?" — 4 sites

`substituteBoundIdentInArg:257` · `parseExpression:1313` · `parseRoot:1519` · `parseRoot:1959`

Owner: acorn (`Identifier`). **Transcribed.**

Known-incomplete: **observed** — a non-ASCII identifier is not recognised. `const café =
note("c3")` / `stack(café)` opaques the whole program; the ASCII control arm `cafe` yields a
structured `Play`. JS identifiers admit the full `ID_Start`/`ID_Continue` Unicode sets;
`[A-Za-z_$][\w$]*` admits a 63-character subset.

```regex
4x  /^[A-Za-z_$][\w$]*$/
```

### A2 · "is this a call expression, and what is the callee?" — 2 sites

`parseRoot:1579` · `parseRoot:1927`

Owner: acorn (`CallExpression.callee`). **Transcribed.**

Known-incomplete: **reasoned** — a computed or member callee (`lib.note(…)`, `fns["note"](…)`)
does not match, and a comment between callee and parenthesis (`note /*x*/ (…)`) does not match.

```regex
2x  /^([A-Za-z_$][\w$]*)\s*\(/
```

### A3 · "is this a variable declaration, and what are its name and initialiser?" — 1 site

`BINDING_RE:691`

Owner: acorn (`VariableDeclaration`). **Transcribed.**

Known-incomplete: **reasoned** — one declarator only (`const a = 1, b = 2` captures `a` and
the rest of the line as its initialiser), no destructuring, no `=` inside a preceding comment.

```regex
1x  /^(?:let|const|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([\s\S]+)$/
```

### A3b · "can this statement ever be a musical part?" — 1 site

`NON_EXPRESSION_HEAD_RE:839`

Owner: acorn (`Statement` vs `ExpressionStatement`). **Transcribed.**

⚠ A SEPARATE ENTRY FROM A3 ON PURPOSE, and the separation is the finding. A3 asks a
question whose answer feeds a substitution map, so it needs a name and an initialiser and
declines a destructuring pattern. This one asks only whether a top-level statement can ever
be a musical part — and `const {movement} = createParams('movement')` answers no just as
firmly while matching A3 not at all. Written with A3, the #1534 row filter left that exact
line drawing a silent row in the one archive document it was measured on.

⚠ RENAMED AND WIDENED IN #1536, AND THE QUESTION IS WHAT CHANGED. It used to be spelled
`DECLARATION_RE` and ask "does this DECLARE", which forced its own entry to argue why
`function` and `class` — declarations by any reading — were excluded from it. That argument
was the tell. The question it actually answers is whether the statement can SOUND, and
JavaScript decides that: a statement is not an expression, and only an expression can
evaluate to a pattern. Membership is now a syntactic fact rather than a judgement, which is
what keeps it from becoming the hand-rolled category #1534 refused to build.

Known-incomplete: **observed** — ASSIGNMENTS are deliberately outside it.
`Pattern.prototype.kolam = …` and `window.inited = …` cannot sound either, but they are
ExpressionStatements and `x = s("bd")` is the same shape and can, so dropping them would hide
something a better parser could use. Measured over the 558-document archive (99 bare
multi-statement documents, 494 top-level statements): the widening newly drops 7 statements
in 4 documents — 5 `function` declarations and 2 `if` blocks, every one a helper or a boot
guard — and touches zero real parts; the 2 excluded assignments live in 1 document. The
corpus holds no top-level `class`, `for`, `while`, `switch`, `try` or `do` at all, so those
members rest on the syntactic argument rather than on evidence.

The word boundary rather than whitespace is a deliberate choice between two spellings that
differ on exactly four inputs: it accepts `const{m}=x` and `let[a,b]=x`, declarations written
without a space, and the only thing it additionally admits — a call spelled `var(…)` — cannot
appear at statement start, because those are reserved words. The same boundary is what keeps
`doubled`, `iffy`, `forEach` and `classic` out, each with an arm.

```regex
1x  /^(?:let|const|var|function|class|if|for|while|switch|try|do)\b|^async\s+function\b/
```

### A4 · "is this a `param => bodyvar.chain` arrow, what is the chain, and WHAT IS THE PARAM CALLED?" — 1 site

`parseTransform:2823`

Owner: acorn (`ArrowFunctionExpression`). **Transcribed.**

Known-incomplete: **observed** — the param and body-var may be multi-char and the param may be
parenthesised (`pp => pp.fast(2)`, `(x) => x.fast(2)`), all reducing to the same chain applied
to the body; the earlier `[a-z]`-only form dropped those to a silent `Fast`-less identity,
against a control arm `x => x.fast(2)` that kept it (#963, fixed). Only the `param =>
bodyvar.chain` shape matches here. An identity arrow (`x => x`) is caught by A4c below; a
fresh-expression arrow that rebuilds the pattern from its arg (`x => n("a").set(x)`) falls
through to the residual `null`, which opaques the whole `.method(args)` call so it round-trips
verbatim (#969) — no longer a drop.

#1550 — the param is now CAPTURED, because it binds inside the body. The predicate answers a
third question it always had the information for and used to discard: the name. Every
occurrence of that name in the chain's arguments denotes the arrow's argument, so both
document-scope maps are stripped of it before the body is parsed — without which
`let p = s("bd")` + `.every(2, p => p.cat(p))` cats the body with `s("bd")` instead of with
itself. Widening a capture group, not the matched language: the set of strings this accepts is
unchanged, which is why the corpus cannot move on the match and can only move on the shadowing.

```regex
1x  /^\(?\s*([A-Za-z_$][\w$]*)\s*\)?\s*=>\s*[A-Za-z_$][\w$]*\s*\.(.+)$/
```

### A4b · "is this a bare `name(args)` / `name` transform to wrap opaque?" — 1 site

`parseTransform:2846`

Owner: acorn (`CallExpression`). **Transcribed.**

A partial-application transform the typed arms did not model — `fast(2*2)`, `slow(-2)`, `add(5)`,
a bare `rev` — is split into method + verbatim args and wrapped as an opaque `Code` node
(wrap-never-drop), so the transform is present in the tree and round-trips as `() =>
body.name(args)` instead of collapsing to the silent `every(n, identity)` that A4's old regex
produced (#963). The args are kept byte-exact rather than routed through the `fast`/`slow`
`parseFloat` arms, which would truncate `2*2` to `2`. The optional-parens group also admits the
argless `rev`.

```regex
1x  /^([A-Za-z_$][\w$]*)\s*(?:\(([\s\S]*)\))?\s*$/
```

### A4c · "is this an identity arrow (`x => x`)?" — 1 site

`parseTransform:2852`

Owner: acorn (`ArrowFunctionExpression`). **Transcribed.**

An identity arrow is `f(body) = body`, so it returns the body unchanged and keeps the method's
structural IR (Every/Stack/…) rather than opaquing the whole call (#969). The two capture groups
are compared for identifier equality (`x => x`, `(p) => p` match; `x => y` does not — that
rebuilds from a free var and takes the residual). Anything that reaches this point and is neither
this nor a partial application (A4b) returns `null`, and the caller opaques the whole
`.method(args)` verbatim.

```regex
1x  /^\(?\s*([A-Za-z_$][\w$]*)\s*\)?\s*=>\s*([A-Za-z_$][\w$]*)\s*$/
```

### A5 · "is this a string literal, and what is inside it?" — 15 sites

`classifyLiteralRhs:206,207` · `parseRoot:1714,1715,1815,1829,1837,1864` · `applyMethod:2175,2506,2596` ·
`parseParamArg:2838 (×2), 2844 (×2)`

Owner: acorn (`Literal` / `TemplateLiteral`). **Transcribed**, fifteen times, in six spellings
of the same question.

Known-incomplete: **observed** —
- An escaped quote terminates the string early. `.s("b\"d")` opaques; the control `.s("bd")`
  yields `Param:s`.
- Single quotes are accepted in some arms and not others, so support depends on which arm the
  text reaches. `.mask('1 0')` and `.struct('1 0')` opaque, while the double-quoted controls
  give `When` and `Struct`.
- The two charset-restricted arms at `2596` and `2838` decide meaning, not just shape:
  `.p("café")` opaques (control `.p("lead")` gives a `Track`), and `.s("drum/kit")` falls
  through to the mini-notation arm and is re-parsed as a pattern rather than a sample name
  (control `.s("bd")` stays a literal) — class 2.

Also **reasoned**: no escape sequence is ever decoded, so `"\n"` reaches the IR as two
characters; and `${…}` inside a backtick arm is treated as literal text.

The fifth `/^"([^"]*)"$/` is `slice`'s index argument (#1352), and it is the same
question as `struct`'s mask: *is this argument a quoted mini-notation string I should
carry RAW?* Carrying it raw is load-bearing rather than lazy — `parseExpression` reads a
bare mini string as a NOTE pattern, and `slice`'s second argument is slice INDICES, so
parsing it round-tripped `.slice(4, "0 1 2 3")` to `.slice(4, note("0 1 2 3"))`.

```regex
5x  /^"([^"]*)"$/
2x  /^"[^"]*"$/
2x  /^'([^']*)'$/
1x  /^'[^']*'$/
1x  /^`([^`]*)`$/
1x  /^`[^`]*`$/
1x  /^\(\s*("[^"]*"|'[^']*'|`[^`]*`)\s*\)$/
1x  /^(?:"([a-zA-Z0-9_\-][a-zA-Z0-9_:.\- ]*?)"|'([a-zA-Z0-9_\-][a-zA-Z0-9_:.\- ]*?)')$/
1x  /^"([a-zA-Z0-9#_:-]*?)"$/
1x  /^'([a-zA-Z0-9#_:-]*?)'$/
```

### A6 · "is this statement a guarded call?" — 1 site

`stripParserPrelude:375` (`GUARDED_BOOT_RE`)

Owner: acorn (`ExpressionStatement` → `LogicalExpression` → `UnaryExpression`). **Transcribed.**
Recognises exactly one idiom, `typeof X !== 'undefined' && X(…)`, and the comment above it
already records that it is hand-maintained with no programmatic cross-reference.

Known-incomplete: **reasoned** — any other guard spelling (`if (typeof X !== 'undefined')`,
`X?.()`, `globalThis.X && X()`) is not recognised.

```regex
1x  /^[ \t]*typeof\s+\w+\s*!==?\s*['"]undefined['"]\s*&&\s*\w+\s*\(/
```

### A7 · "where does a line comment end?" — 1 site

`splitTopLevelStatements:537`

Owner: acorn (comment ranges via `onComment`). **Transcribed.**

Known-incomplete: **reasoned** — `//` inside a string or regex literal is treated as the start
of a comment, so `note("http://x")` loses the rest of the line during statement splitting.
(This runs on a copy used only to decide whether a segment is comment-only, which is what has
kept it from doing visible damage.)

```regex
1x  /\/\/.*$/
```

### A8 · "is this a labelled statement, and what is the label?" — 1 site

`extractTracks:1169`

Owner: acorn (`LabeledStatement`) for the syntax; the `$:` / named-track *convention* is
Strudel's. **Transcribed.** This site already carries a hand-written guard rejecting matches
inside brackets, strings and templates — which is the shape of the problem: a regex that needs
a second regex to undo its false positives is doing a parser's job.

Known-incomplete: **reasoned** — a label whose identifier is non-ASCII (as A1), and any `:`
adjacency the guard's bracket/string tracking does not model.

```regex
1x  /^[ \t]*(\/\/[ \t]*)?([A-Za-z_$][\w$]*)\s*:/gm
```

---

## Category B — Strudel vocabulary · owner: **`controls.mjs` / `signal.mjs` / krill**

8 of the 34. These ask "is this name one of Strudel's?" — the same question #928 routed
through `controls.mjs` for controls and #953 re-derived from `signal.mjs` for chain roots.
The remaining sixteen have not had that treatment.

### B1 · "is this call a pattern source, and what is its mini string?" — 2 sites

`PATTERN_SOURCE_CALL_RE:1465` (the acorn gate) · `parseRoot` (the loose fallback)

Owner: `@strudel/core` `controls.mjs` for the names, krill for the string.

**The quote×name grid is gone (#965).** This was the largest cluster in the file — nine
regexes, three name-groups (`note`/`n`, `s`/`sound`, `mini`) each spelled once per quote style,
a product of two independent transcriptions. The extraction ("is the argument a string literal,
where does it start") is now delegated to acorn in `extractPatternSourceCall`; the offset it
returns reproduces the old `indexOf(quote)` byte-for-byte, and the parity corpus moved no
snapshot. What remains is the **vocabulary gate** — is the callee one of the five source
names — kept as a cheap regex so a non-source root is not handed to acorn just to be declined,
and the **loose fallback** for a chained inner (`n("0".fast(2))`), a different question that
#132 owns.

Known-incomplete: **reasoned** — the name list is still a hand-picked five out of ~270 controls
(the vocabulary delegation is #944's job, not this collapse). The two survivors decide only "is
this plausibly a source call"; the string/offset question they used to answer is now acorn's.

```regex
1x  /^(?:note|n|s|sound|mini)\s*\(/
1x  /^(note|n|s|sound|mini)\s*\(/
```

### B2 · "is this call a time-sequencing combinator?" — 1 site

`parseTimeSequenceRoot:1411`

Owner: `@strudel/core` (the exported combinator set). **Transcribed** as a list of four.

Known-incomplete: **reasoned** — `timeCat`, `stepcat`, `seq`, `polymeter` and the rest of the
family are absent, and take the opaque path.

```regex
1x  /^(arrange|cat|slowcat|fastcat)\s*\(/
```

### B3 · "is this call `stack`?" — 1 site

`parseRoot:1764`

Owner: `@strudel/core`. **Transcribed.**

Known-incomplete: **observed** — the match is anchored at position 0 of the trimmed text, so a
leading block comment defeats it: `/*x*/stack(note("c3"))` opaques the whole program where the
control `stack(note("c3"))` yields a structured `Play`. Also **reasoned**: `overlay` and the
`,`-separated stack spelling are not this arm.

```regex
1x  /^stack\s*\(/
```

### B4 · "is this transform `fast(n)` / `slow(n)`?" — 2 sites

`parseTransform:2776,2783`

Owner: `@strudel/core` for the names, and `Number` for the argument. **Transcribed**, including
a fresh transcription of the number token as `[0-9.]+` — the same question `isNumericLiteral`
was created to own in #958, answered here a fourth time and differently.

Known-incomplete: **observed, silent (class 3)** — `fast(2*2)` and `slow(-2)` both drop the
transform node entirely against controls `fast(2)` / `slow(2)`, with no opaque marker.
`[0-9.]+` admits `1.2.3` and rejects `-2` and `1e3`. **Reasoned**: only `fast` and `slow` are
recognised here at all.

```regex
1x  /^fast\s*\(\s*([0-9.]+)\s*\)$/
1x  /^slow\s*\(\s*([0-9.]+)\s*\)$/
```

### B5 · "is this statement a setup/side-effect head?" — 1 site

`stripParserPrelude:342` (`PRELUDE_CALL_RE`)

Owner: `@strudel/core` `repl.mjs` (the setter/boot surface). **Transcribed.**

⚠ THIS ENTRY USED TO LIST TWO SITES, and the second one LEFT rather than vanished (#1178).
`SIDE_EFFECT_CALL_RE` moved to `statementHeads.ts`, because the Mixer kept a THIRD copy of
nearly the same vocabulary and the two disagreed for 14 of 55 bare corpus documents. It is now
one list with two readers, and the regex there is derived from the set rather than spelled
beside it. Recorded here rather than merely deleted: a census that drops an entry without
saying where it went reads the same as one that never had it.

The two remaining lists are NOT redundant, which this entry previously implied by calling them
"two copies of one vocabulary". They answer different questions, and the difference is exactly
the entries they disagree on: `PRELUDE_CALL_RE` asks "is this a LEADING boot call I may strip
before parsing?", and its own docblock reasons that `all` and `hush` are not — `all` takes a
pattern transform, `hush` stops playback. `statementHeads` asks "is this statement a track?",
for which both plainly qualify. Merging them would strip `all(...)` as prelude.

Known-incomplete: **observed** — a setup head absent from the list opaques the whole program:
`setGain(0.5)` + `note("c3")` goes to `Code`, against a control `setcps(0.5)` that parses.

```regex
1x  /^[ \t]*(?:samples|useRNG|setcps|setCps|setcpm|setCpm|setVoicingRange|initAudio|aliasBank)\s*\(/
```

---

## Category D — unanchored regexes

An anchored regex decides what a whole token *means*; an unanchored one usually just locates a
boundary. That distinction is real, but it is a judgement, and leaving it to the gate would
mean the gate quietly deciding what counts as a predicate. So the census covers **every** regex
literal in the file and this category holds the seven that are not anchored — five of them
genuinely scans, two of them predicates that the anchored-only reading would have missed.

**D1 · "which characters are JavaScript's arithmetic operators?" — 1 site** (`ARITH_SPLIT:194`)

Owner: acorn (`BinaryExpression`); the operands already delegate to `Number` via
`isNumericLiteral`. **Transcribed.** This one is a predicate despite being unanchored — it
decides the operator set for the enumerated-arithmetic arm.

Known-incomplete: **reasoned** — the four operators `/ * + -` only, so `%`, `**`, `<<` and
parenthesised sub-expressions are not this grammar. The surrounding comment states that as a
deliberate closed grammar rather than an oversight, which is the right way to record it.

**D2 · "where does a block comment end?" — 1 site** (`splitTopLevelStatements:535`)

Owner: acorn (comment ranges). **Transcribed.** Pairs with A7; same known-incomplete shape —
`/*` inside a string literal is treated as a comment opener.

**D3 · character scans — 5 sites** (`:615`, `:859`, `:1261`, `:3072`, `:3121`)

`/\s/`, `/\S/`, `/[a-zA-Z0-9_$]/`. These locate a boundary rather than decide what a token
means, which is the same role the two survivors in `parseMini.ts` play after its rebuild. No
owner, nothing to delegate — listed only so that "seven unanchored" is accounted for rather
than waved past.

```regex
1x  /(?<=[\d.])[ \t]*[/*+\-][ \t]*/
1x  /\/\*[\s\S]*?\*\//g
2x  /\s/
1x  /\S/
2x  /[a-zA-Z0-9_$]/
```

---

## Category E — transcriptions that are not regexes at all

Outside the gate's reach entirely — it can only see regex literals. Recorded here so this
audit is not read as complete when it is only complete for one syntactic form. These are the
curated sets enumerated in the issue, with their sites verified rather than quoted:

| set | site | owner | status |
|---|---|---|---|
| curated FX arms | `applyMethod` switch, from `:2417` | `controls.mjs` | partly routed via `asControlParam:2733` (#935) |
| curated Param arms | `applyMethod` switch, from `:2614` | `controls.mjs` | partly routed via the registry fallback (#928) |
| `CHAIN_ROOT_RECOGNISER` | `:1039` | `signal.mjs` | transcribed, but re-derived by a drift gate (#953) |
| `SIDE_EFFECT_CALL_RE` list | `:676` | `repl.mjs` | transcribed (also B5) |
| `RESERVED_LABEL_IDENTS` | `:1016` | — | ours; no external owner, so nothing to delegate |

`classifyLiteralRhs`'s numeric arm is **closed**: all three copies of `/^-?\d+(\.\d+)?$/` were
replaced by `isNumericLiteral`, which asks `Number` (#958). Confirmed still closed by
observation — `const n = .5` and `const n = 4` now produce the same IR shape.

---

## Totals

| category | owner | sites |
|---|---|---|
| A — JavaScript syntax | acorn | 29 |
| B — Strudel vocabulary | `controls.mjs` / `signal.mjs` / krill | 7 |
| **total anchored regexes** | | **37** |
| D — unanchored (2 predicates + 5 scans) | acorn / — | 7 |
| **total regex literals** | | **44** |
| distinct sources | | 32 |

Of the 37 anchored predicates, **zero** currently delegate (the pattern-source extraction that #965 removed DID delegate — to acorn — which is why it is no longer a regex). Eleven of the incompleteness claims
above are observed against a control arm; the rest are reasoned from the expression and marked
as such.
