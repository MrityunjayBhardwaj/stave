import JSZip from "jszip";
import {
  listWorkspaceFiles,
  getFolderOrder,
  getSubfolderOrder,
  listAssetRecords,
  getAsset,
  type AssetRecord,
  type ProjectMeta,
} from "@stave/editor";

/**
 * Where a take's bytes sit inside the archive, named by content hash.
 *
 * The hash is already the blob store's key, so using it as the entry name
 * makes deduplication fall out: two records sharing bytes name one entry.
 * Shared with the importer, which must look under exactly this path.
 */
export const ASSET_DIR = "assets/";

interface StaveManifest {
  schemaVersion: 1;
  project: { id: string; name: string; exportedAt: number };
  files: Array<{ id: string; path: string; language: string }>;
  fileOrder: Record<string, string[]>;
  subfolderOrder: Record<string, string[]>;
  /**
   * The project's asset references — optional, so an archive written before
   * this existed still reads, and one written now still opens in a build that
   * predates it (minus its takes).
   *
   * ⚠ Deliberately NOT a `schemaVersion` bump. Bumping would make an older
   * build REFUSE an archive it could otherwise read, which is a worse failure
   * than the one this fixes.
   */
  assets?: AssetRecord[];
}

export async function exportProjectAsZip(project: ProjectMeta): Promise<void> {
  const files = listWorkspaceFiles();
  const zip = new JSZip();

  for (const f of files) {
    zip.file(f.path, f.content);
  }

  // Collect file order for every folder (including root "") that
  // contains at least one file.
  const folderPaths = new Set<string>([""]);
  for (const f of files) {
    const i = f.path.lastIndexOf("/");
    folderPaths.add(i < 0 ? "" : f.path.slice(0, i));
  }
  const fileOrder: Record<string, string[]> = {};
  const subfolderOrder: Record<string, string[]> = {};
  // Subfolder order is keyed by PARENT path, so gather every parent that
  // has at least one subfolder. Root ("") is always a candidate parent.
  const parentPaths = new Set<string>([""]);
  for (const fp of folderPaths) {
    const order = getFolderOrder(fp);
    if (order.length > 0) fileOrder[fp] = order;
    if (!fp) continue;
    // Each folder's parent contributes one subfolder entry.
    const i = fp.lastIndexOf("/");
    parentPaths.add(i < 0 ? "" : fp.slice(0, i));
  }
  for (const pp of parentPaths) {
    const order = getSubfolderOrder(pp);
    if (order.length > 0) subfolderOrder[pp] = order;
  }

  // A recorded take is two things and the archive needs both: the bytes, which
  // are content-addressed in IndexedDB, and the record that gives them a name.
  // Without the bytes `s("my_take")` has nothing to play; without the record
  // nothing knows those bytes were ever called `my_take`.
  //
  // A record whose bytes are gone — the browser can evict the store — is
  // dropped rather than exported. Carrying it would import a name that
  // registers nothing and plays silently, which is precisely the failure this
  // path exists to remove.
  //
  // ⚠ The whole walk is guarded. Before this existed an export touched no
  // storage at all, so a blob store that is unreachable — a bounded open that
  // rejects, a private-mode refusal — could not stop anyone exporting their
  // CODE. Letting it throw here would trade a missing take for a missing
  // project. Records already collected are kept: each one is pushed only
  // after its bytes are in the zip, so a partial list still describes the
  // archive truthfully.
  const assets: AssetRecord[] = [];
  const packed = new Set<string>();
  try {
    for (const record of listAssetRecords()) {
      if (!packed.has(record.blobHash)) {
        const blob = await getAsset(record.blobHash);
        if (!blob) continue;
        // Written as bytes rather than as the blob itself, symmetric with the
        // importer reading `arraybuffer` back. It costs no extra memory — the
        // zip is assembled in memory regardless — and it keeps both directions
        // on one representation instead of relying on JSZip's blob handling.
        zip.file(`${ASSET_DIR}${record.blobHash}`, await blob.arrayBuffer());
        packed.add(record.blobHash);
      }
      assets.push(record);
    }
  } catch (err) {
    console.error("[stave] export: assets unavailable, exporting code only:", err);
  }

  const manifest: StaveManifest = {
    schemaVersion: 1,
    project: {
      id: project.id,
      name: project.name,
      exportedAt: Date.now(),
    },
    files: files.map((f) => ({ id: f.id, path: f.path, language: f.language })),
    fileOrder,
    subfolderOrder,
    // Omitted entirely when there are none, so an archive from a project with
    // no takes is byte-for-byte what it was before this existed.
    ...(assets.length > 0 ? { assets } : {}),
  };
  zip.file("stave.json", JSON.stringify(manifest, null, 2));

  const blob = await zip.generateAsync({ type: "blob" });
  const safeName = project.name.replace(/[^a-z0-9_-]+/gi, "_");
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${safeName || "stave-project"}.zip`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Revoke on next tick so the download stream has a chance to start.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
