/**
 * assetNaming — the PURE half of the binary asset store (#1500, decision #1499).
 *
 * Everything here is a function of plain values: no IndexedDB, no `crypto`, no
 * `Date`. That split is not stylistic. `@stave/editor` does not install
 * `fake-indexeddb` and the vitest env (jsdom) has no IndexedDB, so a module that
 * touches storage cannot be unit-tested at all in this package — the established
 * convention is pure logic in vitest, I/O observed in a browser (P80/P81; the
 * `history/` modules were built this way in PR #205).
 *
 * The bugs in an import path live on this side anyway: what a file called
 * `My Take (2).wav` is allowed to become, and what happens when two different
 * files are both called `vocal.wav` — which is not hypothetical, it is what
 * every browser names the file you just downloaded.
 *
 * ## Why names are lowercase
 *
 * Not cosmetic. Superdough resolves a sound by lowercasing the key it was asked
 * for — `getSound` is `soundMap.get()[s.toLowerCase()]`
 * (`superdough/superdough.mjs:165`). A name registered with any uppercase
 * character is therefore registered at an address `s("...")` can never reach.
 * The sanitiser lowercases so a registered name is a reachable one.
 *
 * ## Two identities, on purpose
 *
 * A record carries BOTH a `blobHash` (what the bytes are) and an `id` (which
 * reference in the document this is). #1499 settled the pair: mutable documents
 * get stable minted ids, immutable blobs get content hashes. The consequence
 * that shows up here is that the same bytes imported twice are ONE blob and TWO
 * records — dedup belongs to the bytes, not to the user's intent to reference
 * them twice.
 */

/**
 * A reference to stored bytes, as the project document will carry it.
 *
 * The document wiring itself is the next slice (#1500 scopes it out) — this is
 * the shape that slice will persist, defined here so the naming and dedup
 * decisions that produce it are testable now.
 */
/**
 * Where a record's audio came from (#1541).
 *
 * ⚠ ABSENT means recorded, and that is a fact about this code's history rather
 * than a default: until #1541 there was no way to bring a file in, so every
 * record any project already holds was made by `saveTake`. New records always
 * say which they are.
 */
export type AssetOrigin = 'recorded' | 'imported'

export interface AssetRecord {
  /** Stable per-reference id. Minted, never derived from content — #1499. */
  readonly id: string
  /** The `s("…")` address. Lowercase and unique within the project. */
  readonly name: string
  /** Content hash of the bytes in the blob store. Shared by duplicates. */
  readonly blobHash: string
  /** The blob's MIME type as the browser reported it, e.g. `audio/wav`. */
  readonly mime: string
  /** Decoded length in seconds, when it could be measured. */
  readonly duration?: number
  /** Recorded here, or brought in. Absent on records written before #1541. */
  readonly origin?: AssetOrigin
}

/** The fallback name for a filename with nothing usable left after sanitising. */
export const FALLBACK_ASSET_NAME = 'asset'

/**
 * Strip a filename down to something `s("…")` can address.
 *
 * The extension goes (it is not part of the sound's identity), everything that
 * is not `a-z0-9` collapses to a single `_`, and leading/trailing separators are
 * trimmed. Mirrors `sanitizePresetName`'s shape rather than inventing a second
 * slug dialect.
 *
 *   `My Take (2).wav`   → `my_take_2`
 *   `vocal.wav`         → `vocal`
 *   `.wav`              → `asset`   (nothing left)
 *   `drums.take.1.aiff` → `drums_take_1`
 */
export function soundNameFromFilename(filename: string): string {
  // Only strip a trailing extension — `drums.take.1.aiff` keeps `take.1`.
  const stem = filename.replace(/\.[^./\\]*$/, '')
  const slug = stem
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return slug || FALLBACK_ASSET_NAME
}

/**
 * Make `base` unique against `taken` by suffixing the smallest free `_N`.
 *
 * The bare name is preferred, so the first `vocal.wav` is `vocal` and a second,
 * DIFFERENT `vocal.wav` becomes `vocal_2`. Counting starts at 2 for that reason:
 * `vocal_1` would imply a `vocal_0` that never exists.
 */
export function uniqueSoundName(base: string, taken: Iterable<string>): string {
  const used = new Set(taken)
  if (!used.has(base)) return base
  let n = 2
  while (used.has(`${base}_${n}`)) n++
  return `${base}_${n}`
}

/** The prefix a recorded take is named with, before its number. */
export const TAKE_NAME_PREFIX = 'take'

/**
 * The next positional name for a recorded take: `take_1`, `take_2`, …
 *
 * A recording has no filename, so something has to name it — and what it must
 * NOT be is a descriptive name derived from anything. A name the tool invented
 * and the user did not write is the tool deciding for them; the honest default
 * is positional and opaque, and the friction of seeing `take_3` is exactly what
 * prompts a deliberate rename. Same rule that makes an unnamed track `d1`
 * rather than "Bass".
 *
 * Numbering continues past the highest existing take rather than filling gaps.
 * Reusing a number a take used to hold would make two different recordings
 * share one name across a session — the user deleted `take_2` because they did
 * not want it, and handing that name to the next recording is confusing in a
 * way an ever-increasing counter is not. (`uniqueSoundName` fills gaps because
 * it is resolving a collision between names the user supplied; this is minting
 * a fresh one, which is a different question.)
 */
export function nextTakeName(existing: Iterable<string>): string {
  let highest = 0
  const pattern = new RegExp(`^${TAKE_NAME_PREFIX}_(\\d+)$`)
  for (const name of existing) {
    const m = pattern.exec(name)
    if (!m) continue
    const n = Number(m[1])
    if (Number.isFinite(n) && n > highest) highest = n
  }
  return `${TAKE_NAME_PREFIX}_${highest + 1}`
}

/** What an import is about to do, decided before anything is written. */
export interface AssetImportPlan {
  /** The reference to add to the document. */
  readonly record: AssetRecord
  /**
   * False when some record in `existing` already points at these bytes — i.e.
   * this import adds a second name for one blob.
   *
   * ⚠ This is a statement about the RECORD LIST, not about the blob store.
   * "Are these bytes already stored?" is a different question with a different
   * owner: IndexedDB, answered by `putAsset`. The two can legitimately
   * disagree (bytes present with no record left pointing at them), so neither
   * is derived from the other and neither is a proxy for the other.
   */
  readonly isFirstReference: boolean
}

/** The measured facts about an incoming file, before it becomes a record. */
export interface AssetImportInput {
  /** Content hash of the bytes — the blob store's key. */
  readonly blobHash: string
  /** The name the user's file had. */
  readonly filename: string
  /** The blob's reported MIME type. */
  readonly mime: string
  /** Decoded length in seconds, when it could be measured. */
  readonly duration?: number
  /** Recorded here, or brought in. */
  readonly origin?: AssetOrigin
}

/**
 * Decide the record and the write for one incoming file.
 *
 * `existing` is every record the project already holds — it supplies both the
 * taken names and the known hashes, which is why they are not two arguments.
 * `mintId` is injected rather than calling `crypto.randomUUID()` inside, so the
 * plan is deterministic under test; the production caller passes exactly that
 * (matching `projectRegistry` and `snapshotStore`).
 *
 * Re-importing the SAME bytes under the SAME filename still yields a second
 * record (`vocal`, then `vocal_2`) sharing one blob. A record is a reference the
 * user asked for; collapsing it would silently discard an intentional second
 * one. Only the bytes are deduplicated.
 */
export function planAssetImport(
  input: AssetImportInput,
  existing: readonly AssetRecord[],
  mintId: () => string,
): AssetImportPlan {
  const name = uniqueSoundName(
    soundNameFromFilename(input.filename),
    existing.map((r) => r.name),
  )
  const record: AssetRecord = {
    id: mintId(),
    name,
    blobHash: input.blobHash,
    mime: input.mime,
    ...(input.duration != null ? { duration: input.duration } : {}),
    ...(input.origin != null ? { origin: input.origin } : {}),
  }
  return {
    record,
    isFirstReference: !existing.some((r) => r.blobHash === input.blobHash),
  }
}
