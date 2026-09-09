/**
 * assetDoc — the project document's memory of its assets (#1502).
 *
 * #1500 gave a byte somewhere durable to live and proved it survives a reload.
 * What it deliberately did not do is give the PROJECT a memory of that byte:
 * `listAssets()` returns hashes, sizes and MIME types, so after a reload
 * nothing knows a blob was ever called `my_take` and `s("my_take")` cannot
 * resolve. This module is that memory — a fifth top-level map on the project
 * Y.Doc beside `files`, `fileOrder`, `subfolderOrder` and `childOrder`.
 *
 * ## The split, restated
 *
 * Bytes are content-addressed and live in IndexedDB (`assetStore`). References
 * are minted, mutable and live in the CRDT (here). Blobs cannot go in a Y.Doc —
 * a `Y.Text` carrying megabytes of base64 would wreck sync, undo and document
 * size — and that constraint is what the whole two-identity design comes from.
 *
 * ## Why records are plain values, not inner `Y.Map`s
 *
 * A record is five small fields that are replaced together, so a rename is one
 * `set` on the outer map and the outer observer fires. Storing each record as
 * an inner `Y.Map` would buy per-field merge granularity nobody needs and cost
 * a real hazard: a write to an inner map does NOT propagate to the outer map's
 * observer, so every mutation site would have to rebuild-and-notify by hand or
 * the module would have to observe every inner map. That trap has been paid for
 * once already, in the file store's rename path.
 *
 * ## Root maps do not write when you ask for them
 *
 * The standing rule is that lazy sub-store allocation must live on write paths,
 * never on read paths — a getter that allocates writes to the doc during React
 * render and lands a `setState` mid-render of another component. That rule is
 * about NESTED maps. A root type is different: `doc.getMap('assets')` creates
 * the type lazily but emits no update until something is put into it, which is
 * why the existing readers call `getMap('fileOrder')` directly and are safe.
 * Stated here so nobody generalises the exemption to nested maps.
 */

import * as Y from 'yjs'

import { ensureDoc } from './projectDoc'
import type { AssetRecord } from './assetNaming'
import { uniqueSoundName } from './assetNaming'

type Subscriber = () => void

const subscribers = new Set<Subscriber>()

function notify(): void {
  // Snapshot first: a subscriber may unsubscribe while we are iterating.
  for (const cb of Array.from(subscribers)) cb()
}

/**
 * The assets map. Safe on a read path — see the header on root types.
 *
 * Values are frozen-shaped `AssetRecord`s stored as plain JSON, not `Y.Map`s.
 */
function getAssetsMap(): Y.Map<AssetRecord> {
  return ensureDoc().getMap('assets') as Y.Map<AssetRecord>
}

/**
 * Track the CURRENT wired map by REFERENCE, never a boolean.
 *
 * A project switch swaps the active doc, so `getAssetsMap()` starts returning a
 * different object. A boolean flag would leave the observer bound to the map
 * that is about to be destroyed, and the new doc's map would have no observer
 * at all — writes would persist while the UI never re-rendered. That exact race
 * has bitten the file store.
 */
let wiredAssetsMap: Y.Map<AssetRecord> | null = null

function ensureAssetsObserver(): void {
  const current = getAssetsMap()
  if (wiredAssetsMap === current) return
  // A shallow observe is enough BECAUSE records are plain values: every change
  // to one is a key-level `set` on this map. If records ever become inner
  // Y.Maps this has to become `observeDeep`, and the header explains why they
  // should not.
  //
  // 'add' and 'update' are the same event for us — Y.Map does not distinguish a
  // first write from an overwrite, and handling only 'add' leaves a stale read
  // after a rename. So the handler does not inspect the action at all.
  current.observe(() => notify())
  wiredAssetsMap = current
}

/** Subscribe to any change in the project's asset records. */
export function subscribeToAssets(cb: Subscriber): () => void {
  ensureAssetsObserver()
  subscribers.add(cb)
  return () => {
    subscribers.delete(cb)
  }
}

/**
 * Every asset the project references, in insertion order.
 *
 * Read-only: wires the observer (observing an existing map is doc-write-free)
 * but never allocates.
 */
export function listAssetRecords(): AssetRecord[] {
  ensureAssetsObserver()
  return Array.from(getAssetsMap().values())
}

/** One record by id, or null. */
export function getAssetRecord(id: string): AssetRecord | null {
  return getAssetsMap().get(id) ?? null
}

/**
 * Add a reference to the project.
 *
 * ⚠ Must run AFTER `initProjectDoc` has resolved. A write that races the
 * IndexedDB sync is a concurrent `set` on the same key from two clients, and
 * Y.Map settles that by client id — non-deterministically.
 */
export function addAssetRecord(record: AssetRecord): void {
  getAssetsMap().set(record.id, record)
}

/** Drop a reference. The BYTES are not touched — they may be shared. */
export function removeAssetRecord(id: string): void {
  getAssetsMap().delete(id)
}

/**
 * Rename a reference, returning the name actually taken.
 *
 * This exists before anything calls it, on purpose. A recording has no
 * filename, so a take's default name has to be an opaque positional one and the
 * only honest way to a meaningful name is an explicit user rename — the same
 * reason a track defaults to a bare positional id rather than an inferred
 * label. Shipping the store without a rename path would force the next slice to
 * either auto-derive a descriptive name or leave the user stuck with `take_3`.
 *
 * The requested name is made unique against the project's other assets, so a
 * rename can never produce two records answering to one `s()` address. Returns
 * null when there is no such record.
 */
export function renameAssetRecord(id: string, name: string): string | null {
  const map = getAssetsMap()
  const existing = map.get(id)
  if (!existing) return null
  const taken = Array.from(map.values())
    .filter((r) => r.id !== id)
    .map((r) => r.name)
  const unique = uniqueSoundName(name, taken)
  if (unique === existing.name) return unique
  // One `set` of the whole record — see the header on why records are plain
  // values. This fires the outer observer; an inner-map field write would not.
  map.set(id, { ...existing, name: unique })
  return unique
}

/*
 * There is deliberately NO `resetAssetDocState()` here yet.
 *
 * The file store needs one because it caches snapshots and must notify on a
 * project switch. This module caches nothing, and the observer guard is a
 * reference check — so when the doc swaps, the next read simply re-wires
 * against the new map with no help. The only thing a reset would add is
 * notifying subscribers that the project changed underneath them, and nothing
 * subscribes yet.
 *
 * Adding it now would mean a notify-only function threaded through five
 * existing switch sites with no caller that can observe the difference — an
 * export nothing exercises, which is the exact shape #1500's self-review had
 * to remove. It lands with the Asset Library UI, which is the first thing that
 * can actually tell whether it fired.
 */
