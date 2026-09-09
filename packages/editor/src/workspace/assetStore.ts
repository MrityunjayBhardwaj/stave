/**
 * assetStore — where a user's bytes live (#1500, Phase 1 of #1352; decision #1499).
 *
 * Four features wanted somewhere to put binary data and none of them owned it
 * (#1499). This is that place: content-addressed blobs in IndexedDB, with the
 * document holding a reference rather than the bytes. Blobs cannot live in a
 * CRDT — a `Y.Text` carrying megabytes of base64 would wreck sync, undo and
 * document size — so the split is bytes here, `AssetRecord` in the doc.
 *
 * This module is the I/O half. Every decision that can be made from plain
 * values lives in `assetNaming.ts` and is unit-tested there; this file is the
 * thin part that cannot be, and is observed in a browser instead
 * (`asset-store-roundtrip.spec.ts`).
 *
 * ## Why the store opens through `openIdbWithTimeout`
 *
 * A raw `indexedDB.open` can hang forever — blocked by another tab's older
 * connection, rejected in private mode, corrupted — and that was the boot hang
 * (#685/#687). Four stores already route through the shared bounded opener; a
 * fifth that opened raw would reintroduce the exact failure the helper exists
 * to bound. Callers of this module catch and degrade, they do not await
 * indefinitely.
 *
 * ## Why object URLs are cached
 *
 * `URL.createObjectURL` mints a handle that pins the blob until it is revoked.
 * The sampler asks for a URL on the path to every note, so minting per call
 * leaks one blob handle per note — the leak grows with playback time, which is
 * the worst shape to discover later. The cache is keyed by content hash, which
 * is also what makes the dedup real: two records naming the same bytes share
 * one URL, not two.
 *
 * ## Why registration goes through `samples()`
 *
 * `samples(sampleMap, baseUrl)` is superdough's documented public entry
 * (`superdough/sampler.mjs:249`). It walks the map through `processSampleMap`
 * (`sampler.mjs:146`) and lands on `registerSampleSource` → `registerSample` →
 * `registerSound` (`sampler.mjs:361`, `:354`, `superdough.mjs:60`), which is a
 * plain write into the `soundMap` store — no audio context required, so an
 * asset can be registered before the engine has ever started.
 *
 * A blob URL survives that path intact: with an empty `baseUrl` the map value
 * is concatenated onto `''` (`sampler.mjs:159`), and playback bottoms out in
 * `loadBuffer` — `fetch(url) → arrayBuffer() → decodeAudioData`
 * (`sampler.mjs:88-104`). Nothing in it parses the URL or infers a format from
 * an extension, which is why a `blob:` URL with no extension decodes normally.
 */

import { samples } from '@strudel/webaudio'

import { openIdbWithTimeout } from '../idb'
import type { AssetImportPlan, AssetRecord } from './assetNaming'
import { planAssetImport } from './assetNaming'

/**
 * The asset database's name, exported so nothing has to keep a second copy.
 *
 * A test harness that wipes the store by literal string is a second owner of
 * this value: rename the database and the wipe silently stops wiping, while
 * every test still passes — on state inherited from the previous one. Observed,
 * not hypothetical — a break test that changed this name left the probe
 * deleting a database that no longer existed.
 */
export const ASSET_DB_NAME = 'stave-assets'

const DB_NAME = ASSET_DB_NAME
const DB_VERSION = 1
const STORE_NAME = 'blobs'

/** A stored blob and what we know about it without decoding. */
export interface StoredAsset {
  /** Content hash — the object store's key. */
  readonly hash: string
  /** The bytes. */
  readonly blob: Blob
  /** The blob's reported MIME type. */
  readonly mime: string
  /** `blob.size`, denormalised so `listAssets` need not carry the bytes. */
  readonly size: number
  /** When these bytes first entered the store. */
  readonly storedAt: number
}

/** What `listAssets` returns: every stored blob, minus the bytes. */
export type StoredAssetMeta = Omit<StoredAsset, 'blob'>

function openDb(): Promise<IDBDatabase> {
  return openIdbWithTimeout(DB_NAME, DB_VERSION, (db) => {
    if (!db.objectStoreNames.contains(STORE_NAME)) {
      db.createObjectStore(STORE_NAME, { keyPath: 'hash' })
    }
  })
}

function wrap<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

// ---------------------------------------------------------------------------
// Hashing
// ---------------------------------------------------------------------------

/** Hashes bytes to a hex string. Injected so the import path is testable. */
export type AssetDigest = (bytes: ArrayBuffer) => Promise<string>

/**
 * SHA-256, hex-encoded — the production digest.
 *
 * `crypto.subtle` needs a secure context, which localhost and https both are.
 * It is async, which is fine here (unlike `ir/nodeIdentity`, which needs a
 * synchronous hash and uses FNV-1a for that reason).
 */
export const sha256Hex: AssetDigest = async (bytes) => {
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

// ---------------------------------------------------------------------------
// The blob store
// ---------------------------------------------------------------------------

/** True when the store already holds these bytes. */
export async function hasAsset(hash: string): Promise<boolean> {
  const db = await openDb()
  try {
    const n = await wrap(
      db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).count(hash),
    )
    return n > 0
  } finally {
    db.close()
  }
}

/** What a `putAsset` did. */
export interface PutAssetResult {
  /** The content hash the bytes are stored under. */
  readonly hash: string
  /**
   * Whether the bytes were actually written. False means the store already
   * held them and the write was skipped.
   *
   * This is the store's OWN answer, read from IndexedDB. It is deliberately
   * not derived from — and does not derive — `AssetImportPlan.isFirstReference`,
   * which answers the different question of whether the document already
   * references these bytes.
   */
  readonly written: boolean
}

/**
 * Store a blob under the hash of its content, deduplicating identical bytes.
 *
 * A second `putAsset` of the same bytes is a no-op rather than a rewrite: the
 * key is the content, so a rewrite could only ever replace the row with an
 * identical one while resetting `storedAt` to a time the bytes did not arrive.
 */
export async function putAsset(
  blob: Blob,
  digest: AssetDigest = sha256Hex,
): Promise<PutAssetResult> {
  const hash = await digest(await blob.arrayBuffer())
  const db = await openDb()
  try {
    const existing = await wrap(
      db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).count(hash),
    )
    if (existing > 0) return { hash, written: false }
    const record: StoredAsset = {
      hash,
      blob,
      mime: blob.type,
      size: blob.size,
      storedAt: Date.now(),
    }
    await wrap(
      db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).put(record),
    )
    return { hash, written: true }
  } finally {
    db.close()
  }
}

/** Read bytes back by content hash. `null` when the store has never held them. */
export async function getAsset(hash: string): Promise<Blob | null> {
  const db = await openDb()
  try {
    const row = await wrap<StoredAsset | undefined>(
      db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(hash),
    )
    return row?.blob ?? null
  } finally {
    db.close()
  }
}

/**
 * Drop bytes from the store, and any object URL minted for them.
 *
 * Revoking is not optional here: a URL left alive after its row is gone points
 * at bytes nothing can reach through the store, so it becomes the only handle
 * keeping them in memory.
 */
export async function deleteAsset(hash: string): Promise<void> {
  releaseAsset(hash)
  const db = await openDb()
  try {
    await wrap(
      db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).delete(hash),
    )
  } finally {
    db.close()
  }
}

/** Every stored blob's metadata, oldest first. The bytes are omitted. */
export async function listAssets(): Promise<StoredAssetMeta[]> {
  const db = await openDb()
  try {
    const rows = await wrap<StoredAsset[]>(
      db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).getAll(),
    )
    return rows
      .map(({ hash, mime, size, storedAt }) => ({ hash, mime, size, storedAt }))
      .sort((a, b) => a.storedAt - b.storedAt)
  } finally {
    db.close()
  }
}

// ---------------------------------------------------------------------------
// The resolver seam
// ---------------------------------------------------------------------------

/** hash → object URL. One URL per distinct blob, for as long as it is needed. */
const urlCache = new Map<string, string>()

/**
 * hash → the resolve currently in flight for it.
 *
 * The PROMISE is what has to be shared, not the finished URL. Two concurrent
 * `resolveAsset` calls for the same hash both miss a URL cache, both await the
 * IndexedDB read, and both then mint — a re-check after the await cannot catch
 * that, because neither has written anything by the time the other looks. So
 * the second caller has to join the first call rather than repeat it.
 *
 * Superdough's sampler solves the identical problem the identical way
 * (`loadCache[url] = fetch(...)`, `sampler.mjs:90`).
 */
const inFlight = new Map<string, Promise<string | null>>()

/**
 * Resolve stored bytes to a URL the audio path can fetch, or `null` if the
 * store does not hold them.
 *
 * This is the seam #1499 asks for: IndexedDB is the first provider, and a
 * cloud one is additive behind the same signature. It addresses bytes by
 * **content hash** rather than by `AssetRecord.id`, for two reasons — the
 * id→hash mapping lives in the project document, whose wiring is the next
 * slice; and the URL cache has to be keyed by content or two records sharing
 * one blob would mint two URLs, undoing the dedup one layer up. A caller
 * holding a record already holds `record.blobHash`, so no lookup is lost.
 */
export async function resolveAsset(blobHash: string): Promise<string | null> {
  const cached = urlCache.get(blobHash)
  if (cached) return cached
  const pending = inFlight.get(blobHash)
  if (pending) return pending

  const work = (async () => {
    const blob = await getAsset(blobHash)
    if (!blob) return null
    // `releaseAsset` may have run while the read was in flight; it clears
    // `inFlight` too, so a caller that joined this promise still gets a live
    // URL and the next caller starts a fresh resolve.
    const url = URL.createObjectURL(blob)
    urlCache.set(blobHash, url)
    return url
  })().finally(() => {
    inFlight.delete(blobHash)
  })

  inFlight.set(blobHash, work)
  return work
}

/** Revoke the object URL for one blob, if any was minted. */
export function releaseAsset(blobHash: string): void {
  // Dropped even when no URL exists yet: a resolve still in flight would
  // otherwise land after the release and re-populate the cache the caller
  // just asked to clear.
  inFlight.delete(blobHash)
  const url = urlCache.get(blobHash)
  if (!url) return
  urlCache.delete(blobHash)
  URL.revokeObjectURL(url)
}

/** Revoke every object URL this module minted — e.g. on project close. */
export function releaseAllAssets(): void {
  inFlight.clear()
  for (const url of urlCache.values()) URL.revokeObjectURL(url)
  urlCache.clear()
}

/** The URL currently cached for a blob, without minting one. For observation. */
export function peekAssetUrl(blobHash: string): string | null {
  return urlCache.get(blobHash) ?? null
}

// ---------------------------------------------------------------------------
// Registration — a stored asset becomes playable
// ---------------------------------------------------------------------------

/**
 * Make one stored asset addressable as `s(name)`.
 *
 * Returns false when the store cannot produce a URL for the record's bytes,
 * which is a real outcome rather than an error: storage can be evicted by the
 * browser between the document being written and being opened.
 */
export async function registerAsset(record: AssetRecord): Promise<boolean> {
  const url = await resolveAsset(record.blobHash)
  if (!url) return false
  // Empty baseUrl: `processSampleMap` concatenates it onto the value, so the
  // blob URL must not be prefixed (`sampler.mjs:159`).
  await samples({ [record.name]: url }, '')
  return true
}

/**
 * Register every asset a project holds. Returns the names that resolved —
 * a record whose bytes are gone is skipped rather than registered at a URL
 * that will 404 on the first note.
 */
export async function registerAssets(
  records: readonly AssetRecord[],
): Promise<string[]> {
  const registered: string[] = []
  for (const record of records) {
    if (await registerAsset(record)) registered.push(record.name)
  }
  return registered
}

// ---------------------------------------------------------------------------
// The composed import path
// ---------------------------------------------------------------------------

/** Injectable edges of {@link importAsset}, so the whole path is observable. */
export interface ImportAssetDeps {
  /** Content hash. Defaults to SHA-256. */
  readonly digest?: AssetDigest
  /** Record id minting. Defaults to `crypto.randomUUID()`, as elsewhere. */
  readonly mintId?: () => string
  /**
   * Decoded length in seconds, or undefined when it cannot be measured.
   *
   * Injected because decoding needs an `AudioContext`, which this module has
   * no business owning — and because an import whose bytes are not decodable
   * audio must still succeed as a stored blob rather than throw.
   */
  readonly measureDuration?: (blob: Blob) => Promise<number | undefined>
}

/** What one import produced. */
export interface ImportAssetResult extends AssetImportPlan {
  /** The store's own account of the blob write. */
  readonly put: PutAssetResult
}

/**
 * Take one file all the way in: hash it, store the bytes, and decide the
 * record the project document will carry.
 *
 * `existing` is the project's current records — the source of both the taken
 * names and the known hashes. Persisting the returned record is the caller's
 * job; the document wiring is #1500's next slice.
 */
export async function importAsset(
  blob: Blob,
  filename: string,
  existing: readonly AssetRecord[] = [],
  deps: ImportAssetDeps = {},
): Promise<ImportAssetResult> {
  const put = await putAsset(blob, deps.digest ?? sha256Hex)
  // A measurer that throws must not fail the import: the bytes are already
  // stored by this point, so rejecting here would leave an orphan blob with no
  // record pointing at it — and "not decodable audio" is a perfectly ordinary
  // thing for a file to be. Absent duration is the honest answer, and it is
  // the same answer a measurer that returns undefined gives.
  let duration: number | undefined
  try {
    duration = await deps.measureDuration?.(blob)
  } catch {
    duration = undefined
  }
  const plan = planAssetImport(
    { blobHash: put.hash, filename, mime: blob.type, duration },
    existing,
    deps.mintId ?? (() => crypto.randomUUID()),
  )
  return { ...plan, put }
}
