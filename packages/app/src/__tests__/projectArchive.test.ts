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
  getAsset: async (hash: string) => store.blobs.get(hash) ?? null,
  putAsset: async (blob: Blob) => {
    const hash = await fakeHash(blob);
    const written = !store.blobs.has(hash);
    if (written) store.blobs.set(hash, blob);
    return { hash, written };
  },
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
