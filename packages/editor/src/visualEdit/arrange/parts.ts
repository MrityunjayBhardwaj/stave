/**
 * parts — what a section of an `arrange(...)` song may be POINTED AT (#1560).
 *
 * ## Why this is not in `serialize.ts`
 *
 * `setArmPattern` writes whatever text it is given, because an arrange arm is an
 * expression slot and the language puts no vocabulary on it. The narrower
 * question — what may a GESTURE offer — cannot be answered from the arm alone:
 * it needs the whole document (to find the parts) and the call's own position in
 * it (to rule out the ones that would recurse). That span is the file, which is
 * the same reason `rename.ts` is its own module while every other arrange op
 * edits bytes inside the call.
 *
 * ## The exclusion that is not a style preference
 *
 * ⚠ A BINDING WHOSE DECLARATION ENCLOSES THE CALL MUST NEVER BE OFFERED:
 *
 * ```js
 * let song = arrange([8, bass], [8, song])   //  ← song is defined by this call
 * ```
 *
 * That is infinite recursion, it parses fine, and `song` is exactly the name a
 * user reaches for when asked which part a section should play. Nothing
 * downstream can catch it — the serializer sees a valid identifier and the
 * document is syntactically correct — so it has to be absent from the list.
 *
 * ## And a part must already exist where the call is
 *
 * ⚠ A BINDING DECLARED AFTER THE CALL IS NOT REFERENCEABLE FROM IT. `let`/`const`
 * are in their temporal dead zone until their declaration runs, so an arm naming
 * one throws at evaluation rather than playing it; a `var` is `undefined` there,
 * which is quieter and no better. This also closes the mutual case the enclosing
 * guard alone misses — two arrangements, each pointed at the other — because the
 * second one is always declared after the first.
 *
 * ## What is not a part
 *
 * A top-level binding is offered unless it cannot be arranged:
 *
 *  - a NUMBER — `let M = 8` is the corpus's own weight-multiplier idiom
 *    (`[M*8, stack(…)]`), not something a section can play;
 *  - a FUNCTION or arrow — `let f = p => p.fast(2)` is a transform, and arranging
 *    it plays nothing;
 *  - a destructuring declarator — it introduces no single name to reference.
 *
 * Everything else is offered, including a string: `let riff = "bd sd"` is a
 * pattern in Strudel's own reading, so refusing it would be us being stricter
 * than the language. ⚠ This list is deliberately about what CAN be referenced,
 * never about what sounds good — a guess at musical intent is the one thing it
 * must not make.
 */
import { parse } from 'acorn'

import type { ArrangeCall } from './parse'

// acorn's node types are intentionally loose; we walk untyped nodes here.
/* eslint-disable @typescript-eslint/no-explicit-any */

function parseProgram(doc: string): any | null {
  try {
    return parse(doc, { ecmaVersion: 'latest', allowAwaitOutsideFunction: true }) as any
  } catch {
    return null
  }
}

/** Can this initializer be arranged as a section's pattern? */
function isArrangeable(init: any): boolean {
  if (!init) return false
  if (init.type === 'Literal' && typeof init.value === 'number') return false
  if (init.type === 'FunctionExpression' || init.type === 'ArrowFunctionExpression') return false
  return true
}

/**
 * The document's top-level parts, in source order, that section arms of `call`
 * may be pointed at. Empty when the document does not parse — the caller then
 * offers nothing, which is the honest answer rather than a stale list.
 */
export function listSectionParts(doc: string, call: ArrangeCall): string[] {
  const program = parseProgram(doc)
  if (!program) return []
  const [callStart, callEnd] = call.callRange
  const names: string[] = []
  for (const stmt of program.body ?? []) {
    if (stmt.type !== 'VariableDeclaration') continue
    for (const decl of stmt.declarations ?? []) {
      if (decl.id?.type !== 'Identifier') continue
      if (!isArrangeable(decl.init)) continue
      // The recursion guard: this declarator is what the call is being written
      // into, so referencing its name from inside the call defines it in terms
      // of itself.
      if (decl.start <= callStart && decl.end >= callEnd) continue
      // Declared after the call: in its dead zone where the arm would run.
      if (decl.start > callStart) continue
      if (!names.includes(decl.id.name)) names.push(decl.id.name)
    }
  }
  return names
}
