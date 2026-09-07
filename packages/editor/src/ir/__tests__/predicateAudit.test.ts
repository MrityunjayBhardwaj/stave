/**
 * predicateAudit.test.ts — the census in `ir/PREDICATE-AUDIT.md` still matches
 * the source (#959).
 *
 * `parseStrudel.ts` decides things about JavaScript syntax and about Strudel's
 * vocabulary by hand, in anchored regular expressions. Every other module in
 * the parse path asks an authority instead and has zero. The audit document
 * lists all 43 regex literals in the file — the 36 anchored predicates grouped by
 * the question each decides and who owns the answer, plus the 7 unanchored — so that
 * "find the next parser bug" is a finite list rather than a search.
 *
 * A document like that decays the moment someone adds a regex, and a decayed
 * census reads exactly like a current one. Hence this gate: it re-derives the
 * census from the source on every run and fails if the document disagrees.
 * Adding a predicate is still allowed; adding one *silently* is not.
 *
 * WHY IT ASKS TYPESCRIPT. Finding regex literals in a TypeScript file means
 * knowing which slashes are division, which are inside strings, and which are
 * inside comments — the same class of question the audit is about. Answering
 * it with a scanner here would reproduce the defect inside the tool that
 * measures it, so the scan delegates to `ts.createSourceFile`. That also makes
 * the exclusion of commented-out regexes structural rather than heuristic:
 * four of them are quoted in prose in `parseStrudel.ts` and the tokenizer
 * never offers them.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'

const IR_DIR = join(__dirname, '..')
const SOURCE = join(IR_DIR, 'parseStrudel.ts')
const AUDIT = join(IR_DIR, 'PREDICATE-AUDIT.md')

/**
 * Every regex literal in a file, in order, duplicates kept.
 *
 * The census is deliberately NOT filtered to anchored expressions. An anchored
 * regex decides what a whole token means and an unanchored one usually only
 * locates a boundary — a real distinction, and the one the audit is organised
 * around — but it is a judgement, and a gate that applied it would be deciding
 * for itself what counts as a predicate. It missed `ARITH_SPLIT` (which
 * transcribes JavaScript's operator set without an anchor) on the first pass
 * here, which is the argument. So the gate counts everything and the document
 * does the classifying, in the open, where it can be disagreed with.
 */
function regexLiteralsIn(path: string): string[] {
  const text = readFileSync(path, 'utf8')
  const sf = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const found: string[] = []
  const walk = (node: ts.Node): void => {
    if (node.kind === ts.SyntaxKind.RegularExpressionLiteral) {
      found.push((node as ts.RegularExpressionLiteral).getText(sf))
    }
    ts.forEachChild(node, walk)
  }
  walk(sf)
  return found
}

const censusFromSource = (): string[] => regexLiteralsIn(SOURCE)

/** Every `<count>x  <regex>` line inside a ```regex fence in the audit. */
function censusFromAudit(): string[] {
  const text = readFileSync(AUDIT, 'utf8')
  const fences = text.matchAll(/```regex\n([\s\S]*?)```/g)
  const declared: string[] = []
  for (const fence of fences) {
    for (const line of fence[1].split('\n')) {
      const trimmed = line.trim()
      if (!trimmed) continue
      const m = trimmed.match(/^(\d+)x\s+(\/.*)$/)
      expect(m, `unparseable line in a \`\`\`regex fence: ${JSON.stringify(trimmed)}`).toBeTruthy()
      const [, count, source] = m as RegExpMatchArray
      for (let i = 0; i < Number(count); i += 1) declared.push(source)
    }
  }
  return declared
}

function tally(sources: string[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const s of sources) counts.set(s, (counts.get(s) ?? 0) + 1)
  return counts
}

/**
 * ANCHORED — decides what a whole token means, rather than merely locating a
 * boundary. Module-level because two tests ask it and a second spelling of the
 * rule is the same drift this file exists to catch. `parseMini.ts` legitimately
 * keeps two unanchored character scans after its rebuild, which is why the
 * delegating claim is about anchored regexes only.
 */
const isAnchored = (source: string): boolean => {
  const body = source.replace(/^\//, '').replace(/\/[gimsuy]*$/, '')
  return body.startsWith('^') || body.endsWith('$')
}

describe('predicate audit (#959)', () => {
  const actual = censusFromSource()
  const declared = censusFromAudit()

  it('every regex literal in parseStrudel.ts has an audit entry', () => {
    const have = tally(declared)
    const missing: string[] = []
    for (const [source, count] of tally(actual)) {
      const claimed = have.get(source) ?? 0
      if (claimed < count) missing.push(`${source} — ${count} in source, ${claimed} in audit`)
    }
    expect(
      missing,
      'A predicate was added to parseStrudel.ts without an audit entry. Add it to ' +
        'PREDICATE-AUDIT.md under the category that owns the question it answers — ' +
        'and note whether it delegates or transcribes.',
    ).toEqual([])
  })

  it('every audit entry still exists in parseStrudel.ts', () => {
    const have = tally(actual)
    const stale: string[] = []
    for (const [source, count] of tally(declared)) {
      const real = have.get(source) ?? 0
      if (real < count) stale.push(`${source} — ${count} in audit, ${real} in source`)
    }
    expect(
      stale,
      'The audit claims predicates the source no longer has. If one was deleted or ' +
        'delegated, remove its entry (and say so in the totals) — a census that ' +
        'overstates reads the same as one that is current.',
    ).toEqual([])
  })

  it('the audit states the total it actually lists', () => {
    const text = readFileSync(AUDIT, 'utf8')
    const stated = text.match(/\*\*total regex literals\*\*\s*\|\s*\|\s*\*\*(\d+)\*\*/)
    expect(stated, 'the totals table lost its **total regex literals** row').toBeTruthy()
    expect(Number((stated as RegExpMatchArray)[1])).toBe(actual.length)
  })

  /**
   * The anchored count is stated in FOUR places and only two of them were
   * asserted, so #1178 moved one predicate out and left three saying the old
   * number while the totals table said the new one. A census that disagrees with
   * itself reads exactly like one that is current — the same failure this file
   * exists to prevent, one level up.
   *
   * Every figure is re-derived here and compared against the SOURCE, never
   * against another figure in the document. The prose spellings are included
   * because a number written as a word drifts just as silently as a digit, and
   * `28 of the 36` is the denominator a reader uses to judge whether the
   * category breakdown still adds up.
   */
  it('every place the audit states the anchored count agrees with the source', () => {
    const text = readFileSync(AUDIT, 'utf8')
    const anchored = actual.filter(isAnchored).length

    const words: Record<number, string> = {
      33: 'thirty-three', 34: 'thirty-four', 35: 'thirty-five',
      36: 'thirty-six', 37: 'thirty-seven', 38: 'thirty-eight',
    }

    const perModule = text.match(/\|\s*\*\*`ir\/parseStrudel\.ts`\*\*\s*\|[^|]*\|\s*\*\*(\d+)\*\*/)
    expect(perModule, 'the per-module table lost its `ir/parseStrudel.ts` row').toBeTruthy()
    expect(
      Number((perModule as RegExpMatchArray)[1]),
      'the per-module table row disagrees with the source',
    ).toBe(anchored)

    const totals = text.match(/\*\*total anchored regexes\*\*\s*\|\s*\|\s*\*\*(\d+)\*\*/)
    expect(totals, 'the totals table lost its **total anchored regexes** row').toBeTruthy()
    expect(Number((totals as RegExpMatchArray)[1])).toBe(anchored)

    expect(
      text.includes(`has ${words[anchored]} (was `),
      `the prose still spells the anchored count as something other than "${words[anchored]}"`,
    ).toBe(true)

    const catA = text.match(/^(\d+) of the (\d+)\./m)
    expect(catA, 'Category A lost its "N of the M." denominator line').toBeTruthy()
    expect(
      Number((catA as RegExpMatchArray)[2]),
      "Category A's denominator disagrees with the source",
    ).toBe(anchored)
  })

  /**
   * The claim the audit rests on, re-measured rather than quoted. It is a
   * negative result about five modules, so it carries a control arm: the same
   * scan must find anchored regexes in parseStrudel.ts itself. A zero from a
   * broken query would otherwise read as a delegating module.
   */
  it('modules that delegate to an authority still have no anchored regexes', () => {
    const delegating = [
      'parseMini.ts',
      'parseStrudelStages.ts',
      '../visualEdit/chunkDetect.ts',
      '../visualEdit/arrange/parse.ts',
    ]
    const scan = (rel: string): number =>
      regexLiteralsIn(join(IR_DIR, rel)).filter(isAnchored).length

    expect(scan('parseStrudel.ts'), 'control arm: the scan must find the known anchored predicates').toBe(36)
    for (const rel of delegating) expect(`${rel}: ${scan(rel)}`).toBe(`${rel}: 0`)
  })
})
