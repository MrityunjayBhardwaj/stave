import JSZip from "jszip";
import {
  createProject,
  touchProject,
  switchProject,
  resetFileStore,
  createWorkspaceFile,
  setFolderOrder,
  setSubfolderOrder,
  withStructBatch,
  putAsset,
  addAssetRecord,
  type AssetRecord,
  type ProjectMeta,
  type WorkspaceLanguage,
} from "@stave/editor";

import { ASSET_DIR } from "./exportProject";

interface StaveManifest {
  schemaVersion: 1;
  project: { id: string; name: string; exportedAt: number };
  files: Array<{ id: string; path: string; language: string }>;
  fileOrder: Record<string, string[]>;
  subfolderOrder?: Record<string, string[]>;
  /** Optional for the same reason the exporter omits it — see `StaveManifest` there. */
  assets?: AssetRecord[];
}

/**
 * Import a stave.zip into a NEW project. Returns the created project
 * metadata. Throws on a malformed archive — caller surfaces the error
 * via a toast.
 */
export async function importProjectFromZip(file: File): Promise<ProjectMeta> {
  const zip = await JSZip.loadAsync(file);
  const manifestEntry = zip.file("stave.json");
  if (!manifestEntry) {
    throw new Error("Not a Stave archive — stave.json missing");
  }
  const manifestText = await manifestEntry.async("string");
  const manifest = JSON.parse(manifestText) as StaveManifest;
  if (manifest.schemaVersion !== 1) {
    throw new Error(
      `Unsupported Stave archive schema (${manifest.schemaVersion})`,
    );
  }

  // Name disambiguation — append "(imported)" so it doesn't collide.
  const name = `${manifest.project.name} (imported)`;

  const meta = await createProject(name);
  // Switch to it so createWorkspaceFile / setFolderOrder write into the
  // right Y.Doc. switchProject re-inits doc + y-indexeddb on the new id.
  resetFileStore();
  await switchProject(meta.id);
  await touchProject(meta.id);

  // Seed files + orders in one structural batch so the import is a
  // single undo step (though undo right after import is an odd case
  // since the user just switched projects).
  const filesWithContent = await Promise.all(
    manifest.files.map(async (f) => {
      const entry = zip.file(f.path);
      const content = entry ? await entry.async("string") : "";
      return { ...f, content };
    }),
  );

  withStructBatch(() => {
    for (const f of filesWithContent) {
      createWorkspaceFile(f.id, f.path, f.content, f.language as WorkspaceLanguage);
    }
    for (const [folder, ids] of Object.entries(manifest.fileOrder)) {
      setFolderOrder(folder, ids);
    }
    if (manifest.subfolderOrder) {
      for (const [parent, names] of Object.entries(manifest.subfolderOrder)) {
        setSubfolderOrder(parent, names);
      }
    }
  });

  // Assets last, and outside the struct batch: storing bytes is async, so it
  // cannot join a synchronous batch, and putting it after the files means a
  // failure here leaves the project with its code rather than with neither.
  //
  // ⚠ The record is written with the hash the STORE computed, never the one
  // the manifest claims. They agree for an intact archive; when they don't,
  // trusting the manifest would mint a record pointing at bytes that are not
  // in the store — a name that registers nothing and plays silently, which is
  // the failure this whole path exists to remove.
  //
  // Registration is deliberately NOT done here. `StrudelEditorClient` already
  // owns "a project's takes are playable", keyed on project id, and it also
  // warms each take's waveform. A second registration site would be a second
  // owner of that invariant and would skip the warm. This function's contract
  // is narrower and is what that effect needs: by the time it returns, the
  // records exist and their bytes are in the store.
  //
  // ⚠ Guarded per asset. The files are already in the project by this point,
  // so throwing would surface "Import failed" over a project that imported
  // fine, and one unreadable take would cost the user every other one. A take
  // that cannot be stored is skipped for the same reason its bytes are never
  // half-written: a record with no bytes behind it is the silent failure.
  for (const asset of manifest.assets ?? []) {
    try {
      const entry = zip.file(`${ASSET_DIR}${asset.blobHash}`);
      if (!entry) continue;
      // Read as an ArrayBuffer rather than a blob: a blob from JSZip carries an
      // empty MIME type and would have to be re-wrapped, and `new Blob([aBlob])`
      // — legal in a browser — is not implemented by jsdom, which would put this
      // line beyond the reach of any arm. Going through the buffer gives the
      // store the MIME the record remembers and stays testable. The bytes are
      // untouched either way, so the content hash is unaffected.
      const bytes = await entry.async("arraybuffer");
      const { hash } = await putAsset(new Blob([bytes], { type: asset.mime }));
      addAssetRecord({ ...asset, blobHash: hash });
    } catch (err) {
      console.error(`[stave] import: skipped asset "${asset.name}":`, err);
    }
  }

  return meta;
}
