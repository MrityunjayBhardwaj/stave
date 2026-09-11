/**
 * The project archive's round trip, with a recorded take in it (#1539).
 *
 * A take has two identities — bytes in the content-addressed blob store, and
 * an `AssetRecord` in the project document that gives them a name. The archive
 * has to carry both, because either one alone leaves `s("my_take")` resolving
 * to nothing and the part silently absent.
 *
 * These arms drive the real `exportProjectAsZip` / `importProjectFromZip`
 * through a stateful fake of the editor's stores, so the zip under test is the
 * zip a user gets. The "other machine" is modelled by wiping the fake store
 * between export and import — the case that was broken.
 */
import JSZip from "jszip";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AssetRecord } from "@stave/editor";
// By relative path, NOT through the mocked `@stave/editor` barrel. `assetNaming`
// has no imports of its own, so this costs nothing and keeps the arms below
// driving the REAL minting rather than a hand-built record that only looks like
// one. `samplesProvider` likewise imports nothing at runtime.
import { planAssetImport } from "../../../editor/src/workspace/assetNaming";
import { recordsToAssets } from "../assetLibrary/samplesProvider";

// ---------------------------------------------------------------------------
// A stateful fake of the editor's file, document and blob stores.
// ---------------------------------------------------------------------------

interface FakeFile {
  id: string;
  path: string;
  language: string;
  content: string;
}

const store = {
  files: [] as FakeFile[],
  folderOrder: {} as Record<string, string[]>,
  subfolderOrder: {} as Record<string, string[]>,
  records: [] as AssetRecord[],
  blobs: new Map<string, Blob>(),
  // Held on the fake rather than inlined in the mock factory so an arm can
  // swap one out to model a store that is failing rather than merely empty.
  getAsset: async (hash: string): Promise<Blob | null> =>
    store.blobs.get(hash) ?? null,
  putAsset: async (blob: Blob): Promise<{ hash: string; written: boolean }> => {
    const hash = await fakeHash(blob);
    const written = !store.blobs.has(hash);
    if (written) store.blobs.set(hash, blob);
    return { hash, written };
  },
};

/**
 * Read a blob's bytes under jsdom.
 *
 * ⚠ NOT via `new Response(blob)`. Node's `Response` does not recognise jsdom's
 * `Blob` as a blob and stringifies it, so every read comes back as the 13
 * bytes of `"[object Blob]"` — identical for every input, which silently makes
 * a dedup assertion pass because everything hashes the same. `FileReader` is
 * jsdom's own and reads its own blobs correctly.
 */
function readBytes(blob: Blob): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result as ArrayBuffer);
    fr.onerror = () => reject(fr.error);
    fr.readAsArrayBuffer(blob);
  });
}

async function blobBytes(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await readBytes(blob));
}

/**
 * jsdom ships no `Blob.prototype.arrayBuffer`, which every browser has and
 * which the exporter and the blob store both call. Polyfilling it here keeps
 * the shim in the harness, where the gap actually is, instead of shaping
 * production code around a test environment.
 */
if (typeof Blob.prototype.arrayBuffer !== "function") {
  Blob.prototype.arrayBuffer = function arrayBuffer(this: Blob) {
    return readBytes(this);
  };
}

/** Names of the real files in a zip — JSZip lists `assets/` itself too. */
function entryNames(zip: JSZip, prefix = ""): string[] {
  return Object.keys(zip.files)
    .filter((p) => !zip.files[p].dir && p.startsWith(prefix))
    .sort();
}

/**
 * A deterministic content hash for the fake store.
 *
 * Not SHA-256: `crypto.subtle` needs a secure context that jsdom does not
 * provide, and nothing here depends on the digest being cryptographic — only
 * on it being a pure function of the bytes, which is what makes dedup and the
 * hash-disagreement arm meaningful.
 */
async function fakeHash(blob: Blob): Promise<string> {
  const bytes = await blobBytes(blob);
  let h = 2166136261;
  for (const b of bytes) {
    h ^= b;
    h = Math.imul(h, 16777619);
  }
  return `h${(h >>> 0).toString(16)}`;
}

vi.mock("@stave/editor", () => ({
  listWorkspaceFiles: () => store.files,
  getFolderOrder: (p: string) => store.folderOrder[p] ?? [],
  getSubfolderOrder: (p: string) => store.subfolderOrder[p] ?? [],
  listAssetRecords: () => store.records,
  getAsset: (hash: string) => store.getAsset(hash),
  putAsset: (blob: Blob) => store.putAsset(blob),
  addAssetRecord: (r: AssetRecord) => {
    store.records.push(r);
  },
  createProject: async (name: string) => ({ id: "imported-1", name }),
  touchProject: async () => {},
  switchProject: async () => {},
  resetFileStore: () => {
    store.files = [];
  },
  createWorkspaceFile: (
    id: string,
    path: string,
    content: string,
    language: string,
  ) => {
    store.files.push({ id, path, content, language });
  },
  setFolderOrder: (p: string, ids: string[]) => {
    store.folderOrder[p] = ids;
  },
  setSubfolderOrder: (p: string, names: string[]) => {
    store.subfolderOrder[p] = names;
  },
  withStructBatch: (fn: () => void) => fn(),
}));

const { exportProjectAsZip } = await import("../exportProject");
const { importProjectFromZip } = await import("../importProject");

/** Run a real export and hand back the zip the browser would have downloaded. */
async function exportToZip(): Promise<{ blob: Blob; zip: JSZip }> {
  let captured: Blob | null = null;
  const realCreate = URL.createObjectURL;
  const realRevoke = URL.revokeObjectURL;
  URL.createObjectURL = ((b: Blob) => {
    captured = b;
    return "blob:test";
  }) as typeof URL.createObjectURL;
  URL.revokeObjectURL = (() => {}) as typeof URL.revokeObjectURL;
  try {
    await exportProjectAsZip({ id: "p1", name: "Song" } as never);
  } finally {
    URL.createObjectURL = realCreate;
    URL.revokeObjectURL = realRevoke;
  }
  if (!captured) throw new Error("export minted no object URL");
  return { blob: captured, zip: await JSZip.loadAsync(captured) };
}

async function readManifest(zip: JSZip) {
  return JSON.parse(await zip.file("stave.json")!.async("string"));
}

/** Model the receiving machine: the archive arrives, nothing else does. */
function wipeStore() {
  store.files = [];
  store.folderOrder = {};
  store.subfolderOrder = {};
  store.records = [];
  store.blobs.clear();
}

const TAKE_BYTES = new Uint8Array([82, 73, 70, 70, 1, 2, 3, 4, 5, 6, 7, 8]);

async function seedTake(name: string, bytes = TAKE_BYTES): Promise<AssetRecord> {
  const blob = new Blob([bytes], { type: "audio/wav" });
  const blobHash = await fakeHash(blob);
  store.blobs.set(blobHash, blob);
  const record: AssetRecord = {
    id: `rec_${name}`,
    name,
    blobHash,
    mime: "audio/wav",
    duration: 1.5,
  };
  store.records.push(record);
  return record;
}

/**
 * Put one file through the REAL import decision, the way `importAsset` does.
 *
 * `seedTake` above hand-builds a record; this one asks `planAssetImport` for it,
 * so the arms that care about `origin` are reading the field its actual producer
 * writes rather than a literal a test author typed. `mintId` is injected for the
 * same reason production injects it — the plan has to be deterministic here.
 */
async function bringIn(
  filename: string,
  // ⚠ `Uint8Array<ArrayBuffer>`, not a bare `Uint8Array`. The bare spelling
  // widens to `ArrayBufferLike`, which admits a `SharedArrayBuffer` and so is
  // not a `BlobPart` — `new Blob([bytes])` then fails to type-check while every
  // arm stays green, because vitest does not type-check. `seedTake` above gets
  // the narrow type for free by inferring it from its default.
  bytes: Uint8Array<ArrayBuffer>,
  origin: "recorded" | "imported",
): Promise<AssetRecord> {
  const blob = new Blob([bytes], { type: "audio/wav" });
  const blobHash = await fakeHash(blob);
  store.blobs.set(blobHash, blob);
  const { record } = planAssetImport(
    { blobHash, filename, mime: blob.type, duration: 1.5, origin },
    store.records,
    () => `id_${filename}_${origin}`,
  );
  store.records.push(record);
  return record;
}

beforeEach(() => {
  wipeStore();
  store.files = [
    { id: "f1", path: "song.js", language: "javascript", content: '$: s("my_take")' },
  ];
  store.folderOrder = { "": ["f1"] };
});

describe("#1539 — the archive carries a recorded take", () => {
  it("round-trips the bytes and the name onto a machine that has neither", async () => {
    const original = await seedTake("my_take");
    const { blob } = await exportToZip();

    wipeStore();
    // CONTROL — the receiving machine really is empty. Without this the arms
    // below could pass on state the export never carried.
    expect(store.records).toHaveLength(0);
    expect(store.blobs.size).toBe(0);

    await importProjectFromZip(blob as unknown as File);

    expect(store.records).toHaveLength(1);
    const restored = store.records[0];
    expect(restored.name).toBe("my_take");
    expect(restored.mime).toBe("audio/wav");
    expect(restored.duration).toBe(1.5);
    expect(restored.id).toBe(original.id);

    // The record resolves to bytes that are actually in the store, and they
    // are the same bytes — the whole point, since a matching name over the
    // wrong bytes plays the wrong take.
    const bytesBack = store.blobs.get(restored.blobHash);
    expect(bytesBack).toBeDefined();
    expect(await blobBytes(bytesBack!)).toEqual(TAKE_BYTES);
    expect(bytesBack!.type).toBe("audio/wav");
  });

  it("writes one entry for bytes two records share, and two for bytes they do not", async () => {
    await seedTake("take_a");
    await seedTake("take_b"); // identical bytes → identical hash
    // CONTROL — a third take with DIFFERENT bytes. Without it, "one entry"
    // also passes when the byte reader is broken and every blob hashes the
    // same, which is exactly how this arm first passed.
    await seedTake("take_c", new Uint8Array([9, 9, 9, 9]));
    expect(store.blobs.size).toBe(2);

    const { blob, zip } = await exportToZip();
    expect(entryNames(zip, "assets/")).toHaveLength(2);

    wipeStore();
    await importProjectFromZip(blob as unknown as File);
    // All three names come back, over two distinct blobs.
    expect(store.records.map((r) => r.name).sort()).toEqual([
      "take_a",
      "take_b",
      "take_c",
    ]);
    expect(store.blobs.size).toBe(2);
    expect(new Set(store.records.map((r) => r.blobHash)).size).toBe(2);
  });

  it("drops a record whose bytes the browser has evicted while carrying its neighbour", async () => {
    const ghost = await seedTake("gone");
    store.blobs.delete(ghost.blobHash); // evicted between recording and export
    // The survivor is what makes this arm discriminate. Asserting only that
    // the evicted take is absent also passes when NOTHING is exported — which
    // is how this arm read green with the whole feature switched off.
    await seedTake("kept", new Uint8Array([7, 7, 7]));

    const { blob, zip } = await exportToZip();
    expect(await readManifest(zip)).toHaveProperty("assets");
    expect(entryNames(zip, "assets/")).toHaveLength(1);

    wipeStore();
    await importProjectFromZip(blob as unknown as File);
    expect(store.records.map((r) => r.name)).toEqual(["kept"]);
    // No dangling reference: the one record that arrived resolves to bytes.
    expect(store.blobs.has(store.records[0].blobHash)).toBe(true);
  });

  it("trusts the bytes over the manifest, so an edited archive cannot mint a dangling name", async () => {
    await seedTake("my_take");
    const { zip } = await exportToZip();

    // Rewrite the manifest's hash to something the bytes do not hash to,
    // leaving the entry itself where the exporter put it.
    const manifest = await readManifest(zip);
    const realHash = manifest.assets[0].blobHash;
    manifest.assets[0].blobHash = "h_not_the_bytes";
    const realBytes = await zip.file(`assets/${realHash}`)!.async("blob");
    zip.file("stave.json", JSON.stringify(manifest));
    zip.file("assets/h_not_the_bytes", realBytes);
    const tampered = await zip.generateAsync({ type: "blob" });

    wipeStore();
    await importProjectFromZip(tampered as unknown as File);

    expect(store.records).toHaveLength(1);
    // The record points at the hash of the bytes that actually arrived, so it
    // resolves — the manifest's claim is ignored.
    expect(store.records[0].blobHash).not.toBe("h_not_the_bytes");
    expect(store.blobs.has(store.records[0].blobHash)).toBe(true);
  });
});

describe("#1539 — a failing blob store costs takes, never the project", () => {
  it("still exports the code when the blob store is unreachable", async () => {
    await seedTake("my_take");
    const realGet = store.getAsset;
    store.getAsset = async () => {
      throw new Error("IndexedDB unavailable");
    };
    try {
      const { zip } = await exportToZip();
      // The code is all there — which is the point: before assets were in the
      // archive at all, a broken store could not stop anyone exporting.
      expect(entryNames(zip)).toEqual(["song.js", "stave.json"]);
      expect(await readManifest(zip)).not.toHaveProperty("assets");
    } finally {
      store.getAsset = realGet;
    }
  });

  it("skips one unstorable take and keeps its neighbour", async () => {
    await seedTake("bad", new Uint8Array([1, 1, 1]));
    await seedTake("good", new Uint8Array([2, 2, 2]));
    const { blob } = await exportToZip();

    wipeStore();
    const realPut = store.putAsset;
    let seen = 0;
    store.putAsset = async (b: Blob) => {
      // Fail exactly the first take stored, not all of them — an arm where
      // every write fails cannot tell "skipped one" from "skipped all".
      if (++seen === 1) throw new Error("quota exceeded");
      return realPut(b);
    };
    try {
      await importProjectFromZip(blob as unknown as File);
    } finally {
      store.putAsset = realPut;
    }

    expect(store.records).toHaveLength(1);
    expect(store.blobs.has(store.records[0].blobHash)).toBe(true);
  });
});

describe("#1539 — archives without takes are unchanged", () => {
  it("omits the assets key entirely when the project has none", async () => {
    const { zip } = await exportToZip();
    const manifest = await readManifest(zip);
    expect(manifest).not.toHaveProperty("assets");
    expect(manifest.schemaVersion).toBe(1);
    expect(entryNames(zip, "assets/")).toEqual([]);
  });

  it("imports an archive written before assets existed", async () => {
    const zip = new JSZip();
    zip.file("song.js", '$: s("bd")');
    zip.file(
      "stave.json",
      JSON.stringify({
        schemaVersion: 1,
        project: { id: "old", name: "Old", exportedAt: 0 },
        files: [{ id: "f1", path: "song.js", language: "javascript" }],
        fileOrder: { "": ["f1"] },
      }),
    );
    const blob = await zip.generateAsync({ type: "blob" });

    wipeStore();
    await importProjectFromZip(blob as unknown as File);

    expect(store.files.map((f) => f.path)).toEqual(["song.js"]);
    expect(store.records).toHaveLength(0);
  });
});

/**
 * Provenance across the archive — the property that lived between two branches
 * (#1543).
 *
 * #1539 taught the archive to carry an `AssetRecord` and its bytes. #1541 added
 * `origin` to that record and turned it into a word the user can see and search
 * in the asset library. "A file you brought in still reads *imported* after an
 * export and an import on another machine" is a property of the PAIR.
 *
 * It could be tested on neither branch: `AssetOrigin` did not exist on one, and
 * the archive's asset code did not exist on the other. So both self-reviews read
 * complete while nothing covered the meeting point. It is covered here, now that
 * both have landed.
 *
 * ⚠ IT HOLDS BY CONSTRUCTION, AND THAT IS EXACTLY WHY IT NEEDS AN ARM. Both
 * halves copy the record WHOLE — `assets.push(record)` on the way out,
 * `addAssetRecord({ ...asset, blobHash: hash })` on the way back — so a field
 * nobody named survives for free. The change that would break it does not look
 * like a break: giving the manifest an explicit field list reads like tidying.
 *
 * TWO RECORDS, NOT ONE, DELIBERATELY. A single imported take also passes when
 * `origin` is hard-coded to `"imported"` anywhere on the path. What has to
 * survive is the two being told APART, which is what #1541 newly made possible —
 * before it, every record in every project was a recording.
 */
describe("#1543 — provenance survives the archive", () => {
  const SUNG = new Uint8Array([82, 73, 70, 70, 1, 2, 3, 4]);
  const BROUGHT = new Uint8Array([82, 73, 70, 70, 9, 9, 9, 9]);

  it("keeps a sung take and a brought-in file told apart on another machine", async () => {
    const sung = await bringIn("take_1.wav", SUNG, "recorded");
    const brought = await bringIn("guitar.wav", BROUGHT, "imported");
    // CONTROL — they really do differ before the round trip, over DIFFERENT
    // bytes. Without it, "the origins differ afterwards" also reads green when
    // nothing was carried at all and both came back undefined.
    expect(sung.origin).toBe("recorded");
    expect(brought.origin).toBe("imported");
    expect(sung.blobHash).not.toBe(brought.blobHash);

    const { blob } = await exportToZip();

    wipeStore();
    expect(store.records).toHaveLength(0);
    expect(store.blobs.size).toBe(0);

    await importProjectFromZip(blob as unknown as File);

    const byName = Object.fromEntries(store.records.map((r) => [r.name, r]));
    expect(Object.keys(byName).sort()).toEqual(["guitar", "take_1"]);
    expect(byName.take_1.origin).toBe("recorded");
    expect(byName.guitar.origin).toBe("imported");
    // And the bytes came with them, uncrossed — a name over the wrong bytes is
    // the failure the whole path exists to remove.
    expect(await blobBytes(store.blobs.get(byName.take_1.blobHash)!)).toEqual(SUNG);
    expect(await blobBytes(store.blobs.get(byName.guitar.blobHash)!)).toEqual(BROUGHT);
  });

  it("shows the brought-in file as imported in the library after the round trip", async () => {
    await bringIn("take_1.wav", SUNG, "recorded");
    await bringIn("guitar.wav", BROUGHT, "imported");
    const { blob } = await exportToZip();
    wipeStore();
    await importProjectFromZip(blob as unknown as File);

    // The REAL library mapping, over the records the archive delivered. This is
    // the half the user can actually see: the tag feeds a free-text search, so a
    // row answering to "recorded" when it was imported is a lie they can act on.
    const rows = recordsToAssets(store.records, {
      startPreview: () => ({ stop: () => {} }),
      onInsert: () => {},
    });
    // Named rather than asserted non-null: if the archive dropped the record
    // entirely, `find(...)!.tags` throws "cannot read properties of undefined"
    // and says nothing about WHICH row is missing — the same count-shaped
    // failure this arm exists to replace.
    const tagsFor = (name: string) => {
      const row = rows.find((r) => r.code === name);
      expect(row, `no library row addresses s("${name}")`).toBeDefined();
      return row!.tags;
    };

    expect(tagsFor("guitar")).toContain("imported");
    expect(tagsFor("guitar")).not.toContain("recorded");
    // CONTROL — the sung one still reads "recorded", so the assertion above is
    // not passing on a mapping that says "imported" for everything.
    expect(tagsFor("take_1")).toContain("recorded");
    expect(tagsFor("take_1")).not.toContain("imported");
  });

  it("leaves a record written before origin existed reading as recorded", async () => {
    // `seedTake` writes no `origin` at all — the shape every record in every
    // project had before #1541. It must not come back as "imported", and it must
    // not come back as a third thing either.
    await seedTake("older_take");
    const { blob } = await exportToZip();
    wipeStore();
    await importProjectFromZip(blob as unknown as File);

    expect(store.records).toHaveLength(1);
    expect(store.records[0].origin).toBeUndefined();
    const rows = recordsToAssets(store.records, {
      startPreview: () => ({ stop: () => {} }),
      onInsert: () => {},
    });
    expect(rows[0].tags).toContain("recorded");
  });
});
