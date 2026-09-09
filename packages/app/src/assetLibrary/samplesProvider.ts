import type { Asset, AssetPreviewHandle, AssetProvider } from "./types";

/**
 * Samples AssetProvider (#1504) — the project's OWN audio in the library.
 *
 * `AssetType` has declared `"sample"` and `AssetSource` has declared `"user"`
 * as "locally imported" since the library shipped, and until now both were
 * design notes with nothing behind them. A recorded take is exactly that
 * category, so it fills the hole rather than adding a sixth surface.
 *
 * The mapping is pure and dependency-injected, matching `soundsProvider`: the
 * app wires `readRecords` to the project document and `startPreview`/`onInsert`
 * to the audio and editor seams, so the mapping is unit-testable without a
 * Y.Doc, an audio graph, or the editor barrel.
 */

/** The record shape this provider reads — a structural subset of `AssetRecord`. */
export interface SampleRecord {
  readonly id: string;
  readonly name: string;
  readonly blobHash: string;
  readonly mime: string;
  readonly duration?: number;
}

export interface SamplesProviderDeps {
  /** The project's asset records, live. */
  readRecords: () => readonly SampleRecord[];
  /** Audition one by name; returns a handle to stop it. */
  startPreview: (name: string) => AssetPreviewHandle;
  /** Round-trip the sample into code at the cursor. */
  onInsert: (name: string) => void;
}

/** `1.5` → `1.5s`; absent duration contributes no tag rather than "unknown". */
function durationTag(seconds: number | undefined): string[] {
  if (seconds == null || !Number.isFinite(seconds)) return [];
  // One decimal: a take's length is a band, not an exact figure — the encoder
  // does not give back precisely what was recorded for.
  return [`${seconds.toFixed(1)}s`];
}

/**
 * Pure mapping: the project's records → `Asset[]`, sorted by name.
 *
 * Sorted rather than left in insertion order because the library is a BROWSE
 * surface — a list that reorders as takes are added and removed is harder to
 * scan than a stable alphabetical one, and `take_2` sorting after `take_1` is
 * the order a user expects anyway.
 */
export function recordsToAssets(
  records: readonly SampleRecord[],
  deps: Pick<SamplesProviderDeps, "startPreview" | "onInsert">,
): Asset[] {
  return records
    .map((record) => ({
      type: "sample" as const,
      // Keyed by the RECORD id, not the name: the shell keys rows on
      // `${type}:${id}`, and a rename must move a row rather than replace it
      // with a different-looking one.
      id: record.id,
      name: record.name,
      source: "user" as const,
      // What Copy puts on the clipboard, and what `s()` addresses — the name,
      // never the id. The id is a row key; it means nothing in code.
      code: record.name,
      tags: ["sample", "recorded", ...durationTag(record.duration)],
      group: "Your audio",
      preview: () => deps.startPreview(record.name),
      insert: () => deps.onInsert(record.name),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Build the provider. `list` reads live, so a new take appears without a remount. */
export function createSamplesProvider(deps: SamplesProviderDeps): AssetProvider {
  return {
    type: "sample",
    label: "Samples",
    // No `isLoading`: unlike sounds, which fill from a CDN after engine
    // warm-up, the project's own records are present the moment the document
    // has synced — and the document has synced before this component renders.
    // An always-false loading flag would be a state the shell can never leave.
    list: () =>
      recordsToAssets(deps.readRecords(), {
        startPreview: deps.startPreview,
        onInsert: deps.onInsert,
      }),
  };
}
