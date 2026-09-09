import type { AssetRecord, ImportAssetResult, StoredAssetMeta } from "@stave/editor";

/**
 * E2E-only handle onto the binary asset store (#1500).
 *
 * The claim Phase 1 makes is "a byte gets in, survives a RELOAD, and plays as
 * `s("my_take")`". No unit test can say that — `@stave/editor` has no
 * `fake-indexeddb` and jsdom has no IndexedDB — and the slice deliberately
 * ships no UI, so there is no gesture to drive either. This probe is therefore
 * the instrument: without it the only observable half is the naming logic,
 * which is not the half that carries the risk.
 *
 * Guarded twice, exactly as `bounceProbe` is: `NODE_ENV === production` is
 * statically replaced so the body dead-code-eliminates from a real build, and
 * `__STAVE_E2E__` is the runtime gate for dev/test.
 *
 * `@stave/editor` is imported LAZILY inside the calls rather than at module
 * scope. A static import here would be dragged into every app unit test that
 * partially mocks `@stave/editor`, hiding real exports behind the mock in a
 * way `tsc` cannot see (that shape cost 52 tests once already).
 */
export interface AssetProbeImport {
  /** The record the project document would carry. */
  record: AssetRecord;
  /** Whether the document already referenced these bytes. */
  isFirstReference: boolean;
  /** Whether the STORE actually wrote them — its own separate answer. */
  written: boolean;
}

export interface AssetProbe {
  /** Wipe the asset database and every cached object URL. */
  reset(): Promise<void>;
  /** Store base64 bytes as a blob; returns the content hash and whether it wrote. */
  put(base64: string, mime: string): Promise<{ hash: string; written: boolean }>;
  /** Read bytes back by hash, base64-encoded. `null` when absent. */
  get(hash: string): Promise<string | null>;
  /** Every stored blob's metadata, bytes omitted. */
  list(): Promise<StoredAssetMeta[]>;
  /** Full import path: hash → store → record. `existing` is the doc's records. */
  import(
    base64: string,
    mime: string,
    filename: string,
    existing: AssetRecord[],
  ): Promise<AssetProbeImport>;
  /** Resolve a hash to an object URL through the provider seam. */
  resolve(hash: string): Promise<string | null>;
  /** The URL already cached for a hash, without minting one. */
  peek(hash: string): Promise<string | null>;
  /** Revoke the object URL for a hash. */
  release(hash: string): Promise<void>;
  /** Drop bytes from the store by hash. */
  remove(hash: string): Promise<void>;
  /** Register a record so `s(record.name)` addresses it. */
  register(record: AssetRecord): Promise<boolean>;
  /** Register a whole project's records; returns the names that resolved. */
  registerAll(records: AssetRecord[]): Promise<string[]>;
  /** Is this name present in superdough's live `soundMap`? */
  inSoundMap(name: string): boolean;
  /** What superdough recorded for a name: its type and the URLs it will fetch. */
  soundMapEntry(name: string): { type?: string; samples?: unknown } | null;
  /** Fetch + decode a URL, returning the buffer's duration and the context rate. */
  decode(url: string): Promise<{ duration: number; sampleRate: number }>;
  /**
   * Resolve one hash N times concurrently, reporting how many times the asset
   * database was OPENED while doing it.
   *
   * The open count is the discriminating reading. "Do concurrent resolves
   * return the same URL?" is not: two separate IDB reads almost always settle
   * at different times, so even a cache that re-checks only AFTER its read
   * usually wins the race by accident — observed, that arm stayed green
   * against the defect. Sharing the in-flight promise is visible instead as
   * ONE open where the unshared version does N.
   */
  concurrentResolve(
    hash: string,
    n: number,
  ): Promise<{ urls: (string | null)[]; opens: number }>;
}

function bytesToBase64(bytes: Uint8Array): string {
  let s = "";
  // Chunked: `String.fromCharCode(...bytes)` blows the argument limit on a
  // blob of any real size.
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

/** Returns an `ArrayBuffer` rather than a view: a `Uint8Array` over a possibly
 *  shared buffer is not assignable to `BlobPart` under the current lib types. */
function base64ToBuffer(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

/** Decode audio off a probe-owned context — the store must not own one. */
async function decodeWith(url: string): Promise<{ duration: number; sampleRate: number }> {
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) throw new Error("no AudioContext");
  const ctx = new Ctor();
  try {
    const bytes = await (await fetch(url)).arrayBuffer();
    const buf = await ctx.decodeAudioData(bytes);
    return { duration: buf.duration, sampleRate: buf.sampleRate };
  } finally {
    void ctx.close();
  }
}

export function installAssetProbe(): () => void {
  if (typeof window === "undefined") return () => {};
  if (process.env.NODE_ENV === "production") return () => {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (!(window as any).__STAVE_E2E__) return () => {};

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const editor = () => import("@stave/editor") as Promise<any>;

  const blobOf = (base64: string, mime: string) =>
    new Blob([base64ToBuffer(base64)], { type: mime });

  const probe: AssetProbe = {
    async reset() {
      const m = await editor();
      m.releaseAllAssets();
      // The database name comes from the store, never from a copy here — a
      // literal would keep wiping working only until the store renamed it,
      // and then every test would silently inherit the previous one's state.
      await new Promise<void>((resolve) => {
        const req = indexedDB.deleteDatabase(m.ASSET_DB_NAME);
        req.onsuccess = req.onerror = req.onblocked = () => resolve();
      });
    },

    async put(base64, mime) {
      const m = await editor();
      return m.putAsset(blobOf(base64, mime));
    },

    async get(hash) {
      const m = await editor();
      const blob: Blob | null = await m.getAsset(hash);
      if (!blob) return null;
      return bytesToBase64(new Uint8Array(await blob.arrayBuffer()));
    },

    async list() {
      const m = await editor();
      return m.listAssets();
    },

    async import(base64, mime, filename, existing) {
      const m = await editor();
      const res: ImportAssetResult = await m.importAsset(
        blobOf(base64, mime),
        filename,
        existing,
        {
          measureDuration: async (blob: Blob) => {
            // Measured through a throwaway object URL so the store's own cache
            // is not warmed by the act of measuring — otherwise the resolver
            // arms would be observing the probe, not the store.
            //
            // Deliberately NOT wrapped in a try/catch: `decodeAudioData`
            // rejects on a blob that is not audio, and swallowing that here
            // would mean the probe, not the store, was the thing surviving it.
            // Whether an undecodable import still succeeds is the store's
            // claim to make, so the throw is passed straight to it.
            const url = URL.createObjectURL(blob);
            try {
              return (await decodeWith(url)).duration;
            } finally {
              URL.revokeObjectURL(url);
            }
          },
        },
      );
      return {
        record: res.record,
        isFirstReference: res.isFirstReference,
        written: res.put.written,
      };
    },

    async resolve(hash) {
      const m = await editor();
      return m.resolveAsset(hash);
    },

    async peek(hash) {
      const m = await editor();
      return m.peekAssetUrl(hash);
    },

    async release(hash) {
      const m = await editor();
      m.releaseAsset(hash);
    },

    async remove(hash) {
      const m = await editor();
      await m.deleteAsset(hash);
    },

    async register(record) {
      const m = await editor();
      return m.registerAsset(record);
    },

    async registerAll(records) {
      const m = await editor();
      return m.registerAssets(records);
    },

    inSoundMap(name) {
      const dict = (
        window as unknown as { soundMap?: { get?: () => Record<string, unknown> } }
      ).soundMap?.get?.();
      return Boolean(dict && name in dict);
    },

    soundMapEntry(name) {
      const dict = (
        window as unknown as {
          soundMap?: { get?: () => Record<string, { data?: { type?: string; samples?: unknown } }> };
        }
      ).soundMap?.get?.();
      const entry = dict?.[name];
      if (!entry) return null;
      return { type: entry.data?.type, samples: entry.data?.samples };
    },

    decode: decodeWith,

    async concurrentResolve(hash, n) {
      const m = await editor();
      const dbName: string = m.ASSET_DB_NAME;
      const realOpen = indexedDB.open.bind(indexedDB);
      let opens = 0;
      // Counting `indexedDB.open` rather than instrumenting the store keeps
      // the measurement on the store's OTHER side — it observes what the store
      // actually asked the browser for, not what it says it did.
      indexedDB.open = ((name: string, version?: number) => {
        if (name === dbName) opens++;
        return realOpen(name, version);
      }) as typeof indexedDB.open;
      try {
        const urls = await Promise.all(
          Array.from({ length: n }, () => m.resolveAsset(hash) as Promise<string | null>),
        );
        return { urls, opens };
      } finally {
        indexedDB.open = realOpen;
      }
    },
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).__staveAssetProbe = probe;
  return () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (window as any).__staveAssetProbe;
  };
}
