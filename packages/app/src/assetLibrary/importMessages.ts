/**
 * The sentence a finished audio import gets (#1541).
 *
 * Split from the control on purpose: this is a pure function of a batch result
 * and nothing else, and keeping it out of the component keeps it out of the
 * editor barrel's import graph — which drags a CommonJS dependency the app's
 * unit tests cannot load. A message formatter that needs a Yjs document to be
 * tested is a message formatter in the wrong place.
 */
import type { ImportSummary } from "../audio/saveTake";

/** `["a.wav"]` → `“a.wav”`; more than two are counted rather than listed. */
function nameList(names: readonly string[]): string {
  if (names.length <= 2) return names.map((n) => `“${n}”`).join(" and ");
  return `${names.length} files`;
}

/**
 * The one sentence a finished import gets, or null when it did nothing.
 *
 * Skipped and failed get different clauses, the way the recorder's three
 * refusals get different sentences. "Not audio this browser can read" is
 * something a user can act on — convert it, try another file. "Could not be
 * saved" is not, and telling someone to convert a file when the disk is full
 * sends them the wrong way entirely.
 */
export function summarize(summary: ImportSummary): string | null {
  const { saved, rejected, failed } = summary;
  const parts: string[] = [];
  if (saved.length === 1) parts.push(`Added ${saved[0].record.name}`);
  else if (saved.length > 1) parts.push(`Added ${saved.length} sounds`);

  // Named, not counted, while there are few: a user who dropped a folder needs
  // to know WHICH file was skipped to do anything about it.
  if (rejected.length > 0) {
    parts.push(`skipped ${nameList(rejected)} — not audio this browser can read`);
  }
  if (failed.length > 0) parts.push(`could not save ${nameList(failed)}`);

  if (parts.length === 0) return null;
  const sentence = parts.join("; ");
  return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}`;
}

/**
 * Does this drag carry OS files, as opposed to something the app is moving?
 *
 * ⚠ The guard that keeps the audio drop target from eating the app's own
 * drags. The file tree moves rows with `application/stave-tree-item`, and a
 * target that called `preventDefault()` on every drag would swallow those —
 * reordering would stop working with nothing on screen to say why. Pure, and
 * armed, because a silent regression here looks like an unrelated bug in the
 * tree.
 */
export function dragCarriesFiles(types: Iterable<string> | undefined): boolean {
  if (!types) return false;
  return Array.from(types).includes("Files");
}
