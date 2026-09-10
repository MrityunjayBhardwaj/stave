/**
 * rename — renaming a SECTION of an `arrange(...)` song (#1417 Stage 2).
 *
 * ## Why this is not a caption edit, and not in `serialize.ts`
 *
 * A section's name is not stored anywhere. `arrange([8, verse], …)` names its
 * arms by REFERENCING top-level bindings, so the name the timeline draws is the
 * identifier `verse` — and renaming the section means renaming the binding: its
 * declaration, this arm, and every other reference in the document. That span is
 * the whole file, which is why this is its own module: every other arrange op
 * edits bytes inside the `arrange(...)` call, and this one cannot.
 *
 * It is also the exact opposite of the pick spelling's rename, and the pair is
 * worth holding in mind together. There the section name is an object KEY and
 * the binding is left alone; here the name IS the binding and the keys must be
 * left alone. Same gesture, opposite edit — which is why each spelling gets its
 * own primitive rather than one shared one with a flag.
 *
 * ## A returning section is renamed everywhere it returns
 *
 * A real document contains `arrange([16, allTogether], …, [12, allTogether])`.
 * Those are not two sections that share a name; they are one pattern arranged
 * twice, which is what a song does when a chorus comes back. So the rename moves
 * both, and `countSectionArms` exists so a caller can say "this renames 2
 * sections" BEFORE writing rather than after.
 *
 * ## Declines, and why each one writes a wrong document if allowed
 *
 * Every refusal below is a case where the edit would mean something other than
 * what the user asked for, so it returns no edits at all rather than a partial
 * rewrite:
 *
 *  - the arm is not a bare identifier — an inline `[8, stack(a, b)]` has no name
 *    to rename, and hoisting it into a binding is a larger transformation that
 *    is deliberately out of scope;
 *  - there is no top-level declaration — `arrange([1, silence], …)` names
 *    Strudel's OWN `silence`, and renaming it breaks the document. Checked as
 *    the general case, "an arm identifier with no declaration", never as a list
 *    of known built-in names;
 *  - the name is declared more than once, or is introduced again anywhere as a
 *    parameter or a nested binding — then some occurrences refer to a different
 *    thing and renaming them all changes the music;
 *  - the new name is already taken anywhere in the document — the rename would
 *    silently merge two identifiers into one.
 *
 * ⚠ THREE PLACES AN IDENTIFIER IS NOT A REFERENCE, and missing any of them
 * corrupts a document that parses fine afterwards, which is the worst kind:
 * an object KEY (`{verse: …}`), a member PROPERTY (`x.verse`), and a STATEMENT
 * LABEL (`verse: s("bd")`) — that last one is how Stave spells a named track, so
 * it is not a hypothetical. All three are excluded by asking the AST what the
 * node's role is, never by matching text.
 *
 * ⚠ SHORTHAND IS THE ONE CASE THAT EXPANDS. In `{verse}` the key and the value
 * are the same token, so a binding rename has to keep the key and move only the
 * value: `{verse}` becomes `{verse: intro}`. Rewriting the token outright would
 * rename the object's key too, which nobody asked for.
 */
import { parse } from 'acorn'

import type { OffsetEdit } from '../writeback'

import type { ArrangeCall } from './parse'

// acorn's node types are intentionally loose; we walk untyped nodes here.
/* eslint-disable @typescript-eslint/no-explicit-any */

/** A bare JS identifier, which is all a section name can be. */
const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/

/** Never a safe key to introduce, however valid it looks as an identifier. */
const NOT_A_NAME = '__proto__'

/** Walk every node, handing the visitor its parent and the field it sits in. */
function walk(
  node: any,
  parent: any,
  key: string | null,
  visit: (n: any, parent: any, key: string | null) => void,
): void {
  if (!node || typeof node !== 'object') return
  if (typeof node.type === 'string' && typeof node.start === 'number') visit(node, parent, key)
  for (const k of Object.keys(node)) {
    if (k === 'type' || k === 'start' || k === 'end') continue
    const child = node[k]
    if (Array.isArray(child)) {
      for (const c of child) walk(c, node, k, visit)
    } else if (child && typeof child === 'object') {
      walk(child, node, k, visit)
    }
  }
}

function parseProgram(doc: string): any | null {
  try {
    return parse(doc, { ecmaVersion: 'latest', allowAwaitOutsideFunction: true }) as any
  } catch {
    return null
  }
}

/** Is this identifier node a NAME in some other role rather than a reference? */
function isNonReference(node: any, parent: any, key: string | null): boolean {
  if (!parent) return false
  // `{ verse: … }` — a key, unless the object is computed (`{ [verse]: … }`).
  //
  // ⚠ SHORTHAND IS SKIPPED HERE TOO, and it is not the same reason. For `{verse}`
  // acorn gives the Property the SAME node object as both `key` and `value`, so
  // a walk over the node's fields reaches it TWICE and a naive collector emits
  // two identical edits for one token — which the writeback rejects outright as
  // overlapping ranges. Skipping the `key` visit leaves exactly one, and it is
  // the `value` visit, which is the one that knows to expand.
  if (parent.type === 'Property' && key === 'key' && !parent.computed) return true
  // `x.verse` — a property, unless computed (`x[verse]`).
  if (parent.type === 'MemberExpression' && key === 'property' && !parent.computed) return true
  // `verse: s("bd")` — a STATEMENT LABEL, which is how Stave names a track.
  if (parent.type === 'LabeledStatement' && key === 'label') return true
  if (parent.type === 'BreakStatement' || parent.type === 'ContinueStatement') return true
  // Class and object method names.
  if ((parent.type === 'MethodDefinition' || parent.type === 'PropertyDefinition') && key === 'key' && !parent.computed) {
    return true
  }
  return false
}

/** Does this identifier node INTRODUCE a binding rather than refer to one? */
function isBindingIntroduction(parent: any, key: string | null): boolean {
  if (!parent) return false
  if (parent.type === 'VariableDeclarator' && key === 'id') return true
  if ((parent.type === 'FunctionDeclaration' || parent.type === 'FunctionExpression' || parent.type === 'ClassDeclaration') && key === 'id') {
    return true
  }
  if (key === 'params') return true
  if (parent.type === 'ArrowFunctionExpression' && key === 'params') return true
  return false
}

/** The arm's name when it is a bare identifier, else null. */
function armIdentifier(doc: string, call: ArrangeCall, i: number): string | null {
  const arm = call.arms[i]
  if (!arm) return null
  const text = doc.slice(arm.patternRange[0], arm.patternRange[1]).trim()
  return IDENTIFIER.test(text) ? text : null
}

/**
 * How many arms of this call carry section `i`'s name — 1 normally, more when
 * the section RETURNS. Mirrors the pick spelling's function of the same name.
 *
 * Returns 0 whenever `renameSection` would decline, so a caller that shows the
 * count and then writes cannot be told "2 sections" and handed no edits.
 */
export function countSectionArms(doc: string, call: ArrangeCall, i: number): number {
  const name = armIdentifier(doc, call, i)
  if (name == null) return 0
  // The OLD name's side of the decision, asked directly rather than by trying a
  // rename with an invented name — a probe name is a value that could itself
  // collide, and a count must not depend on one.
  if (analyze(doc, name, null) == null) return 0
  return call.arms.filter((_, k) => armIdentifier(doc, call, k) === name).length
}

/**
 * Rename section `i` — the binding's declaration and every reference to it.
 *
 * Returns the edits as one batch so the caller applies them as a single undo
 * step, or an empty array for any of the declines documented in the header.
 */
export function renameSection(
  doc: string,
  call: ArrangeCall,
  i: number,
  newName: string,
): OffsetEdit[] {
  if (!IDENTIFIER.test(newName) || newName === NOT_A_NAME) return []
  const oldName = armIdentifier(doc, call, i)
  if (oldName == null || oldName === newName) return []

  const references = analyze(doc, oldName, newName)
  if (references == null) return []

  return references.map((r) => ({
    range: r.range,
    // `{verse}` keeps its key and moves only its value → `{verse: intro}`.
    text: r.shorthand ? `${oldName}: ${newName}` : newName,
  }))
}

/** One reference to rewrite. `shorthand` marks the `{verse}` case, which expands. */
interface Reference {
  readonly range: [number, number]
  readonly shorthand: boolean
}

/**
 * Every site that refers to `oldName`, or `null` when the rename must decline.
 *
 * Both public functions ask the same question of the same walk, which is what
 * keeps the count and the write from ever disagreeing — a caller told "this
 * renames 2 sections" and then handed no edits would be worse than either.
 *
 * `newName` may be null to ask only about the OLD name's side (is it a real,
 * uniquely-declared binding?), which is exactly what a COUNT needs to know.
 */
function analyze(doc: string, oldName: string, newName: string | null): Reference[] | null {
  const program = parseProgram(doc)
  if (!program) return null

  const references: Reference[] = []
  let declarations = 0
  let introductions = 0
  let newNameSeen = false

  walk(program, null, null, (node, parent, key) => {
    if (node.type !== 'Identifier') return
    if (newName != null && node.name === newName) {
      // ANY appearance of the target name is a collision — a label and a
      // property included, because a document where the name already means
      // something else is one the rename cannot be read against afterwards.
      newNameSeen = true
      return
    }
    if (node.name !== oldName) return
    if (isNonReference(node, parent, key)) return

    const shorthand = parent?.type === 'Property' && parent.shorthand === true
    if (isBindingIntroduction(parent, key)) {
      introductions++
      // Only a TOP-LEVEL declaration is the one this rename owns. A parameter or
      // a nested binding means the name is not one thing across the document.
      const isTopLevelVar =
        parent.type === 'VariableDeclarator' &&
        program.body.some(
          (st: any) =>
            st.type === 'VariableDeclaration' && st.declarations.some((d: any) => d === parent),
        )
      const isTopLevelFn =
        (parent.type === 'FunctionDeclaration' || parent.type === 'ClassDeclaration') &&
        program.body.includes(parent)
      if (isTopLevelVar || isTopLevelFn) declarations++
    }
    references.push({ range: [node.start, node.end], shorthand })
  })

  if (newNameSeen) return null // the name is already taken somewhere
  if (declarations !== 1) return null // a built-in, or declared more than once
  if (introductions !== declarations) return null // shadowed by a param or nested binding
  if (references.length === 0) return null
  return references
}
