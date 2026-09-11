/**
 * evalHarness — located haps OUTSIDE the browser, in the order that gets them
 * right. TEST SUPPORT ONLY: the live app evaluates through `StrudelEngine`,
 * which already has all of this; this exists so the resolver's calibration can
 * be measured over real documents in a headless run.
 *
 * Five steps, four of which fail SILENTLY when skipped — wrong numbers, never an
 * error. Each failure mode below has been hit at least once for real:
 *
 *  1. `evalScope` EXACTLY the modules the live engine registers
 *     (`StrudelEngine.ts:267-295`) — no more and no fewer. Passing `{ mini }`
 *     alone throws; passing too few produces a chain-method "is not a function"
 *     per tune, which reads as a corpus property rather than a setup bug. And
 *     passing MORE is the same fault mirrored: this harness used to call
 *     `miniAllStrings()` bare, which manufactured a parse failure for a real
 *     document whose only sin was a single-quoted emoji label.
 *
 *     ⚠ CORRECTED (#1018). The comment here used to say the engine "never calls
 *     it". It does — `StrudelEngine.ts` has called `miniAllStrings()` since long
 *     before this harness existed. So removing the call did not close the
 *     divergence, it FLIPPED it: the harness became more permissive than the
 *     engine and scored documents the live app would have thrown on. Both now
 *     install the same rule (`installMiniStringParser` — try mini, fall back to
 *     the plain value), which is the only version that is right for both.
 *  2. PASS THE TRANSPILER — `evaluate(code, transpiler)`, never `evaluate(code)`.
 *     Without it, locations are MINI-relative rather than document-space, AND
 *     `$:` never becomes `.p`, so nothing is collected and every count reads
 *     zero. That single omission once produced a probe that returned all zeros
 *     and passed its own assertions.
 *  3. MIRROR THE REPL. `evaluate()` returns only the LAST expression; the live
 *     repl stacks everything `.p` collected (`repl.mjs:238-250`), applies
 *     `each`, then the `all` transforms. Querying the return value directly
 *     reports "no location" for every earlier statement in the document — and
 *     multi-statement documents are exactly the long ones, so this fault and a
 *     short query window compound onto the same units.
 *  4. STUB ONLY WHAT PROVABLY CANNOT CHANGE WHICH SPAN PRODUCED A VALUE —
 *     tempo, sample loading, hydra, UI sliders, and the editor-side visual taps
 *     (`_pianoroll`, `scope`, …), which draw the pattern and return it
 *     unchanged. Anything that could change a VALUE is not a stub, it is a
 *     divergence, and the measurement stops being about the real program.
 *  5. QUERY A WINDOW SIZED TO THE PERIOD (see `QUERY_CYCLES`). A unit with no
 *     haps is indistinguishable from a unit with no location.
 *
 * AND, spanning all five: REPORT THE COVERAGE REACHED. Every figure computed
 * from a sweep is over the documents that DID evaluate, and those may be
 * systematically simpler.
 *
 * ── COVERAGE, AND WHY IT DOES NOT GO TO 150 ───────────────────────────────
 * 142 of the 150 real tunes evaluate here (94.7%). The eight that do not were
 * each traced to a failing frame, and the classification matters more than the
 * count, because only one class is a bug we can fix:
 *
 *   5  document-intrinsic — two tunes are saved truncated mid-string, two call
 *      a control with two arguments (`note(0,.1)`), which makes the SECOND
 *      argument the pattern the control applies to, and one calls a function
 *      that exists nowhere. These fail identically in the live app.
 *   2  browser-bound — device motion sensors, and a bytebeat tune that needs a
 *      real `AudioContext`. Between them they hold 0 known-content units and 1
 *      unoffered unit, so stubbing them buys the measurement almost nothing
 *      while adding two divergences. Left alone deliberately.
 *   1  engine-version — uses `trigzeroJoin`, which is in no `@strudel` module
 *      we pin. Our own app cannot run this tune either.
 *   0  missing-scope. The category #1008 expected the bug in is empty.
 *
 * Six of the eight therefore cannot evaluate anywhere, which puts the honest
 * ceiling for this corpus at 144/150, not 150/150 — #1008's premise that every
 * residual document "evaluates fine in the live app" does not survive being
 * checked. We are at 142 of a reachable 144, and the two we are leaving are
 * priced above.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

// The only static imports in this otherwise fully-deferred module, and all node
// built-ins: `hasCorpusArchive()` below has to answer SYNCHRONOUSLY, because
// `it.skipIf(...)` is evaluated when a test is DECLARED rather than when it
// runs. This module is test support and is never bundled — `packages/editor/dist`
// contains no reference to it.
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

let ready: Promise<any> | null = null

/**
 * Deliberate degradations, so every recovery mechanism in here can be proved
 * LOAD-BEARING by breaking it rather than by reading it. A coverage gate whose
 * only evidence is "the code looks right" is the gate this phase was filed to
 * replace.
 */
export interface EvalOptions {
  /** install the hydra globals for a document that calls `initHydra` (default true) */
  hydra?: boolean
  /**
   * install `miniAllStrings()` BARE instead of the engine's fallback rule — the
   * DIVERGENCE, off by default. Kept solely so the red test can turn it back on and
   * show it still breaks a real document.
   */
  bareMiniAllStrings?: boolean
}

/**
 * A callable that swallows every call and property access and returns itself.
 * Used for the hydra globals — see the stub block below for why that is
 * span-neutral. `then` must stay undefined or awaiting one of these hangs, and
 * symbol lookups must too or string coercion breaks.
 */
const chainableNoop: any = new Proxy(function () {} as any, {
  get: (_t, p) => (typeof p === 'symbol' || p === 'then' ? undefined : chainableNoop),
  apply: () => chainableNoop,
  construct: () => chainableNoop,
})

export async function boot() {
  if (ready) return ready
  ready = (async () => {
    const core: any = await import('@strudel/core')
    const mini: any = await import('@strudel/mini')
    const tonal: any = await import('@strudel/tonal')
    const xen: any = await import('@strudel/xen')
    // MIRROR THE ENGINE'S MODULE LIST (`StrudelEngine.ts:267-295`). The engine
    // registers webaudio/soundfonts/midi/mondo and deliberately EXCLUDES
    // `@strudel/draw` (it injects a full-screen canvas into document.body).
    // Registering a different set than the engine turns a setup gap into a
    // per-document "is not a function" that reads as a corpus property.
    //
    // Measured: mirroring the list changes coverage by ZERO documents. Not one
    // residual failure named a control these modules provide — so "we simply
    // did not register it", the category #1008 expected to find the bug in, is
    // EMPTY. It is kept anyway because a divergence that costs nothing today is
    // still a divergence, and the next dependency bump is what makes it cost.
    const optional: any[] = []
    const missingModules: string[] = []
    for (const [name, load] of [
      ['@strudel/webaudio', () => import('@strudel/webaudio')],
      ['@strudel/soundfonts', () => import('@strudel/soundfonts')],
      ['@strudel/midi', () => import('@strudel/midi')],
      ['@strudel/mondo', () => import('@strudel/mondo')],
    ] as const) {
      try {
        optional.push(await load())
      } catch (e: any) {
        // STATED DEVIATION, not a silent one. `@strudel/soundfonts` does not
        // load under this vitest config: it takes named exports from
        // `soundfont2`, which is CJS. Adding it to `server.deps.inline` does
        // not fix it. Coverage is identical with and without the module, and
        // sound selection happens at trigger time, never at eval, so it cannot
        // move a span — but the gap is reported rather than assumed harmless.
        missingModules.push(`${name}: ${String(e?.message ?? e).slice(0, 120)}`)
      }
    }
    await core.evalScope(core, mini, tonal, xen, ...optional)
    const { transpiler } = await import('@strudel/transpiler')

    // --- repl mirror (repl.mjs:171-268) ---------------------------------
    const state = { pPatterns: {} as Record<string, any>, allTransforms: [] as any[], eachTransform: null as any, anon: 0 }
    const Pattern = core.Pattern
    Pattern.prototype.p = function (id: any) {
      if (typeof id === 'string' && (id.startsWith('_') || id.endsWith('_'))) return core.silence
      if (String(id).includes('$')) { id = `${id}${state.anon}`; state.anon++ }
      state.pPatterns[id] = this
      return this
    }
    Pattern.prototype.q = function () { return core.silence }
    for (let i = 1; i < 10; i++) {
      Object.defineProperty(Pattern.prototype, `d${i}`, { get() { return this.p(i) }, configurable: true })
      Object.defineProperty(Pattern.prototype, `p${i}`, { get() { return this.p(i) }, configurable: true })
    }
    const g: any = globalThis
    g.all = (transform: any) => { state.allTransforms.push(transform); return core.silence }
    g.each = (transform: any) => { state.eachTransform = transform; return core.silence }
    // stubs that provably cannot change which span produced a value
    for (const name of ['setcps', 'setcpm', 'setCps', 'setCpm', 'setbpm', 'setBpm', 'initHydra', 'initBytebeat', 'initVideo', 'enableMotion', 'setVoicingRange', 'useRNG', 'setGainCurve', 'setmidimap', 'aliasBank', 'initAudio', 'setGain', 'setVolume', 'hush', 'render', 'src', 'dough']) {
      if (typeof g[name] !== 'function') g[name] = () => undefined
    }
    // A painter reads the scheduler clock when it registers (`draw.mjs:49`). We
    // no longer register `@strudel/draw` at all — the engine does not — and the
    // taps below are identity, so nothing should reach that path; the constant
    // clock stays because it costs nothing and is span-neutral either way (it
    // decides WHEN to draw, never which span produced a value). `setTime` is a
    // core export, so dropping the draw module does not remove it.
    core.setTime?.(() => 0)
    g.samples = async () => undefined
    g.slider = (v: any) => v
    g.sliderWithID = (_id: any, v: any) => v
    // (hydra globals are installed PER DOCUMENT — see `withHydra` below.)
    // Editor-side VISUAL taps. They exist in the live REPL (@strudel/codemirror),
    // draw the pattern and return it unchanged — provably span-neutral.
    for (const m of ['_pianoroll', '_punchcard', '_scope', '_spectrum', '_pitchwheel', '_spiral', 'scope', 'spectrum', 'markcss', 'pianoroll', 'punchcard', 'wordfall', 'spiral', 'pitchwheel', 'draw', 'onPaint']) {
      ;(Pattern.prototype as any)[m] = function (this: any) { return this }
    }
    if (!g.window) g.window = g

    return { core, transpiler, state, missingModules }
  })()
  return ready
}

export interface EvalResult {
  ok: boolean
  error?: string
  /** document-space spans the TRANSPILER declared */
  declared: Array<[number, number]>
  /** every location seen on a queried hap, deduped, in first-seen order */
  seen: Array<{ start: number; end: number }>
}

/**
 * HYDRA, installed per document rather than at boot.
 *
 * `initHydra()` builds a WebGL canvas and publishes these names onto `window`,
 * OVERWRITING the strudel globals they collide with — `shape`, `noise` and `a`
 * are strudel controls until hydra takes them. So the faithful mirror of the
 * live app is not "always stub" (that would change what `shape("…")` means for
 * the 143 documents that never call `initHydra`) and not "stub only the free
 * names" (that leaves a hydra chain calling strudel's `shape` with three
 * arguments): it is "install exactly when the document calls `initHydra`, and
 * restore afterwards".
 *
 * The stub is SPAN-NEUTRAL because a hydra call's return value never becomes a
 * Pattern. Verified over all 150 documents before this was written: every hydra
 * use is a standalone visual statement terminating in `.out(oN)` or
 * `render(oN)`, never a sub-expression of a pattern. A mini string handed to
 * hydra through `H("<4 5 6>")` is still transpiled and still declared in
 * `meta.miniLocations`; it simply never reaches a queried hap — which is also
 * what happens in the live app.
 */
const HYDRA_GLOBALS = [
  'osc', 'noise', 'voronoi', 'shape', 'gradient', 'solid', 'src', 'render', 'H', 'a',
  'o0', 'o1', 'o2', 'o3', 's0', 's1', 's2', 's3',
]

async function withHydra<T>(code: string, on: boolean, fn: () => Promise<T>): Promise<T> {
  const g: any = globalThis
  if (!on || !/\binitHydra\s*\(/.test(code)) return fn()
  const saved = HYDRA_GLOBALS.map((n) => [n, Object.prototype.hasOwnProperty.call(g, n), g[n]] as const)
  for (const n of HYDRA_GLOBALS) g[n] = chainableNoop
  try {
    return await fn()
  } finally {
    for (const [n, had, v] of saved) {
      if (had) g[n] = v
      else delete g[n]
    }
  }
}

/**
 * Install the SAME string rule the live engine installs, for the duration of one
 * evaluation, and take it back off afterwards.
 *
 * `reify` hands every bare string to whatever parser is installed. `miniAllStrings()`
 * installs `mini` bare, which THROWS on anything that is not mini notation — a
 * single-quoted label (`.label('🍕')`) or single-quoted bytebeat source takes the whole
 * document down. Installing NOTHING is the opposite error: `note('c4 e4')` then plays as
 * one note whose value is the string, silently.
 *
 * The engine resolves this with `installMiniStringParser` (try mini, fall back to the
 * plain value) and so does this harness, because an instrument that parses strings
 * differently from the engine is measuring a dialect nobody ships — in EITHER direction.
 * `bare` exists only for the red test that shows the naive call still breaks a document.
 *
 * The parser is a module-global in `@strudel/core`, so the restore is not optional: a
 * quiet no-op here would leave every subsequent document in the process running someone
 * else's dialect, with no error anywhere and only a coverage figure slightly off.
 */
async function withStringParser<T>(bare: boolean, fn: () => Promise<T>): Promise<T> {
  const core: any = await import('@strudel/core')
  const mini: any = await import('@strudel/mini')
  if (bare) mini.miniAllStrings()
  else {
    // imported here rather than at module scope to match this file's dynamic-import
    // style, and imported at all rather than reimplemented: one rule, two callers
    const { installMiniStringParser } = await import('../../../engine/stringParser')
    installMiniStringParser({ core, mini })
  }
  try {
    return await fn()
  } finally {
    core.setStringParser?.(undefined)
  }
}

/** Evaluate + query. `cycles` is the query WINDOW (see PV229 — scales with the period). */
export async function evalLocations(code: string, cycles = 128, opts: EvalOptions = {}): Promise<EvalResult> {
  return withStringParser(opts.bareMiniAllStrings === true, () =>
    withHydra(code, opts.hydra !== false, () => evalLocationsInner(code, cycles)),
  )
}

async function evalLocationsInner(code: string, cycles: number): Promise<EvalResult> {
  const { core, transpiler, state } = await boot()
  state.pPatterns = {}
  state.allTransforms = []
  state.eachTransform = null
  state.anon = 0
  let pattern: any
  let meta: any
  try {
    const r = await core.evaluate(code, transpiler)
    pattern = r.pattern
    meta = r.meta
  } catch (e: any) {
    return { ok: false, error: String(e?.message ?? e), declared: [], seen: [] }
  }
  try {
    // repl.mjs:238-250 — collect pPatterns, apply each, stack
    if (Object.keys(state.pPatterns).length) {
      let patterns: any[] = []
      let soloActive = false
      for (const [key, value] of Object.entries(state.pPatterns)) {
        const isSolod = key.length > 1 && key.startsWith('S')
        if (isSolod && !soloActive) { patterns = []; soloActive = true }
        if (!soloActive || isSolod) patterns.push(value)
      }
      if (state.eachTransform) patterns = patterns.map((x) => state.eachTransform(x))
      pattern = core.stack(...patterns)
    } else if (state.eachTransform) {
      pattern = state.eachTransform(pattern)
    }
    for (const t of state.allTransforms) pattern = t(pattern)
    if (!core.isPattern(pattern)) return { ok: false, error: 'not a pattern', declared: meta?.miniLocations ?? [], seen: [] }
  } catch (e: any) {
    return { ok: false, error: 'post: ' + String(e?.message ?? e), declared: meta?.miniLocations ?? [], seen: [] }
  }

  const seen: Array<{ start: number; end: number }> = []
  const key = new Set<string>()
  try {
    for (let c = 0; c < cycles; c++) {
      const haps = pattern.queryArc(c, c + 1)
      for (const h of haps) {
        for (const l of h.context?.locations ?? []) {
          const k = `${l.start}-${l.end}`
          if (!key.has(k)) { key.add(k); seen.push({ start: l.start, end: l.end }) }
        }
      }
    }
  } catch (e: any) {
    return { ok: false, error: 'query: ' + String(e?.message ?? e), declared: meta?.miniLocations ?? [], seen }
  }
  return { ok: true, declared: meta?.miniLocations ?? [], seen }
}

/** One captured track, mirroring an entry of `StrudelEngine.songPatterns`. */
export interface SongTrack {
  /** the capture key — `$N` for anonymous `$:`, the user's name for `name:`. */
  trackId: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pattern: any
}

export interface SongTracksResult {
  ok: boolean
  error?: string
  tracks: SongTrack[]
}

/**
 * The per-track patterns the SONG frame draws from — a mirror of
 * `StrudelEngine.songPatterns` (assigned `StrudelEngine.ts:1002`), NOT of the
 * repl's single stacked play pattern.
 *
 * WHY THE DISTINCTION IS LOAD-BEARING, and why a period sweep must come through
 * here rather than through `evalLocations`: `getTimelineEvents`
 * (`StrudelEngine.ts:1366-1378`) queries each captured pattern SEPARATELY and
 * stamps that pattern's capture key onto every hap as `trackId`. A probe that
 * queries one stacked pattern instead gets haps with NO `trackId`, so
 * `laneKeyOf`'s `ev.trackId ?? ev.s` fallback puts the SAMPLE NAME in the lane
 * key — which silently repairs the exact defect #1102 is about ([[PV255]]) and
 * would report a healthy corpus. The instrument has to carry the production
 * shape or it measures a program nobody runs.
 *
 * The `$0` bare fallback is applied on the same condition the engine applies it
 * — nothing registered, so the repl plays the document's last expression
 * (#1094, `StrudelEngine.ts:978-980`).
 *
 * DECLARED BOUND: production takes one more step this does not — it remaps each
 * hap's `trackId` to its STRUCTURAL lane via `laneKeyForHap`
 * (`MusicalTimeline.tsx:266`). That is a relabelling of the same partition
 * wherever the join is injective over capture keys, and period is invariant
 * under relabelling; only a join that MERGED two capture keys into one lane
 * could move a period (upward). Stated rather than assumed harmless.
 */
export async function evalSongTracks(
  code: string,
  opts: EvalOptions = {},
): Promise<SongTracksResult> {
  return withStringParser(opts.bareMiniAllStrings === true, () =>
    withHydra(code, opts.hydra !== false, () => evalSongTracksInner(code)),
  )
}

async function evalSongTracksInner(code: string): Promise<SongTracksResult> {
  const { core, transpiler, state } = await boot()
  state.pPatterns = {}
  state.allTransforms = []
  state.eachTransform = null
  state.anon = 0
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let played: any
  try {
    const r = await core.evaluate(code, transpiler)
    played = r.pattern
  } catch (e: unknown) {
    return { ok: false, error: String((e as Error)?.message ?? e), tracks: [] }
  }
  const tracks: SongTrack[] = Object.entries(state.pPatterns).map(([trackId, pattern]) => ({
    trackId,
    pattern,
  }))
  if (tracks.length === 0) {
    // repl.mjs:238-250 — nothing registered, so the LAST EXPRESSION is what plays.
    if (!core.isPattern(played)) return { ok: false, error: 'not a pattern', tracks: [] }
    tracks.push({ trackId: '$0', pattern: played })
  }
  return { ok: true, tracks }
}

/**
 * The exact three files the corpus is made of. Named rather than globbed, so a
 * stray `edit-samples-*.json` dropped into the directory by a later sampler run
 * cannot silently widen what the calibration is measured over.
 *
 * Resolved from THIS file, not from the cwd — the calibration runs from
 * @stave/app while the harness lives in @stave/editor.
 */
const CORPUS_FILES = [
  'edit-samples-2026-07-24T17-49-00-172Z.json',
  'edit-samples-offset250-2026-07-24T17-49-04-301Z.json',
  'edit-samples-offset500-2026-07-24T17-49-08-639Z.json',
] as const

// ⚠ `fileURLToPath` + `path.resolve`, NOT `new URL(rel, import.meta.url)`.
// Vite REWRITES that second form at transform time — it treats it as an asset
// reference — and it came back as `http://localhost:3000/@fs/…` against a
// truncated path, so `existsSync` was false with the archive plainly present
// and all five tests skipped while claiming to be guarded. Observed, not
// reasoned about; the skip looked exactly like a correct guard.
const CORPUS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../../app/tests/parity-corpus/.bakery-runs',
)

const corpusFilePath = (f: string) => path.join(CORPUS_DIR, f)

/**
 * What to do about a missing archive, carried next to every report of its
 * absence — `restore` rebuilds all three files from `mini-corpus-inputs.json`
 * by hash, and fails loudly rather than partially if upstream has lost a row.
 */
export const CORPUS_RESTORE_HINT =
  '`.bakery-runs/` is gitignored on purpose — unreviewed third-party tunes, almost all\n' +
  'declaring no licence. Rebuild it from the committed manifest with:\n' +
  '  node packages/app/scripts/mini-corpus-manifest.mjs restore'

/**
 * Is the corpus archive on THIS machine?
 *
 * THE ONE COPY OF THE RULE (#1307). Every gated test that needs the corpus
 * imports this rather than writing its own `existsSync`, exactly as
 * `mini-corpus-inputs.test.ts` imports `isInputFile` rather than restating the
 * generator's rule. Five copies could drift from `loadCorpus` and from each
 * other, and the drift would show up as a test that fails on a fresh clone
 * — which is the very thing this predicate exists to prevent.
 *
 * It checks the three FILES rather than the directory, because that is what
 * `loadCorpus` actually reads: a directory that exists but is missing one input
 * still ENOENTs, and a predicate coarser than the read it guards would let that
 * through.
 *
 * ⚠ COUPLING, DELIBERATE (#1524). `loadEveryCorpusDocument` reads ~112 more
 * files than these three and guards on this same predicate, so the predicate is
 * NARROWER than that read — the opposite of the relationship described above.
 * That is on purpose, and what makes it safe is NOT this predicate:
 *   - these three missing → both loaders skip. Correct for both.
 *   - these three present, others missing → the wide loader returns FEWER
 *     documents and does not throw (its per-file `try/catch` absorbs it). A
 *     silent narrowing is exactly the failure #1524 was filed about, so the
 *     gate that consumes it pins `corpus.length` against its own `CORPUS_SIZE`
 *     and fails loudly with the restore hint. **The count pin is the guard
 *     here; widening this predicate would only move the same check earlier.**
 * What it must NOT become is a per-loader predicate: five copies drifting is
 * the failure this function was extracted to prevent (#1307). If the wide
 * loader ever needs a file it cannot do without, name that file in
 * `CORPUS_FILES` so ONE predicate still covers both reads.
 */
export function hasCorpusArchive(): boolean {
  return CORPUS_FILES.every((f) => existsSync(corpusFilePath(f)))
}

/**
 * The 150 saved #986-P3 tunes (3 offsets × 50) — the NARROW population.
 *
 * ⚠ 150 ROWS, 142 DISTINCT DOCUMENTS: six groups repeat under two or three
 * `offset/hash` names. And this is 3 of the archive's input files — see
 * `loadEveryCorpusDocument` below for the whole of it (#1524).
 */
export async function loadCorpus(): Promise<{ name: string; code: string }[]> {
  const fs = await import('node:fs')
  // The gated tests skip via `hasCorpusArchive()` and never reach this. The
  // hand-run `_*` probes do not, so they get a next step instead of a bare
  // ENOENT naming a path `.gitignore` refuses to track.
  if (!hasCorpusArchive()) {
    throw new Error(`the Bakery corpus archive is not on this machine.\n${CORPUS_RESTORE_HINT}`)
  }
  const out: { name: string; code: string }[] = []
  for (const f of CORPUS_FILES) {
    const j = JSON.parse(fs.readFileSync(corpusFilePath(f), 'utf8'))
    for (const s of j.samples) out.push({ name: `${j.offset}/${s.hash}`, code: s.code })
  }
  return out
}

/**
 * EVERY document in the archive, deduped — the WIDE population (#1524).
 *
 * ── WHY THIS IS A SECOND LOADER AND NOT A WIDER `loadCorpus` ─────────────────
 * `loadCorpus` has 24 consumers, including the census pins and the two slowest
 * files in the app suite (976 s and 393 s on their own). Widening it would
 * multiply those populations ~4x and move every pinned census at the same time
 * — one change, two unrelated effects, and no way to read which caused what.
 *
 * The population a gate sweeps belongs to that gate. The staged-parity
 * invariant spans exactly one test, so its corpus is defined here for it and
 * `loadCorpus` is left alone.
 *
 * ── WHAT IT READS ───────────────────────────────────────────────────────────
 * Every sample-bearing INPUT file. `result-*` / `edit-result-*` /
 * `ir-support-result*` are OUTPUTS of past runs, not documents anyone wrote,
 * and are excluded.
 *
 * **558 documents** by sha256 of the `code` field, against `loadCorpus`'s 150
 * rows / 142 documents — the narrow set is a strict subset.
 *
 * ⚠ DEDUP IS BY CONTENT, AND THE KEY IS NOT THE SAMPLE'S OWN `hash` FIELD.
 * Those are different questions and give different numbers: across this archive
 * there are 1300 distinct `offset/hash` keys for 558 distinct documents, and
 * `loadCorpus`'s own 150 rows are 142 documents — six groups appear two or
 * three times under different names. Quote the key with the number.
 *
 * ⚠ ORDERING IS LOAD-BEARING, NOT TIDINESS. `CORPUS_FILES` is read FIRST so
 * every document the narrow gate already pinned keeps the exact name it had.
 * That is what makes the baseline diff READABLE: purely additive, no renames,
 * so "we widened the population" cannot be confused with "an existing verdict
 * changed". Verified: 0 of the 142 are renamed under this order; 3 would be
 * under plain alphabetical.
 */
export async function loadEveryCorpusDocument(): Promise<{ name: string; code: string }[]> {
  const fs = await import('node:fs')
  const crypto = await import('node:crypto')
  if (!hasCorpusArchive()) {
    throw new Error(`the Bakery corpus archive is not on this machine.\n${CORPUS_RESTORE_HINT}`)
  }
  const isOutput = (f: string): boolean =>
    f.startsWith('result-') || f.startsWith('edit-result-') || f.startsWith('ir-support-result')
  const rest = fs
    .readdirSync(CORPUS_DIR)
    .filter(
      (f) =>
        f.endsWith('.json') && !isOutput(f) && !(CORPUS_FILES as readonly string[]).includes(f),
    )
    .sort()
  const seen = new Set<string>()
  const out: { name: string; code: string }[] = []
  for (const f of [...CORPUS_FILES, ...rest]) {
    let j: { offset?: unknown; samples?: { hash?: string; code?: unknown }[] }
    try {
      j = JSON.parse(fs.readFileSync(corpusFilePath(f), 'utf8'))
    } catch {
      // A file that is not a sample archive is not an error here — the
      // directory is a working area, and the filter above is a convention
      // rather than a contract.
      continue
    }
    for (const s of j.samples ?? []) {
      if (typeof s.code !== 'string') continue
      const sha = crypto.createHash('sha256').update(s.code).digest('hex')
      if (seen.has(sha)) continue
      seen.add(sha)
      out.push({ name: `${j.offset}/${s.hash}`, code: s.code })
    }
  }
  return out
}
