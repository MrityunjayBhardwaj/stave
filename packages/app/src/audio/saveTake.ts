import {
  addAssetRecord,
  importAsset,
  listAssetRecords,
  nextTakeName,
  registerAsset,
  type AssetOrigin,
  type AssetRecord,
} from "@stave/editor";

/**
 * saveTake — audio becomes a named, persistent, playable asset (#1504, #1541).
 *
 * The join between three things that already exist: the byte store (#1500), the
 * project document's memory (#1502), and superdough's registration. Nothing new
 * is invented here; this is the order they have to happen in.
 *
 * Two things arrive at that join and only one of them used to: a RECORDING,
 * which has no filename, and a FILE the user brought in, which has one and
 * nothing else. `storeAudio` is the shared path; `saveTake` mints a name before
 * it, `importAudioFile` reads one off the file and screens the bytes first.
 *
 * ## Why the name goes in as a filename
 *
 * A take has no filename, so `nextTakeName` mints a positional one and it is
 * handed to `importAsset` AS a filename. That looks indirect but it is the
 * point: the whole import path — sanitising, the uniqueness check against every
 * other asset, the record shape — is the same code an imported file walks, and
 * a take that took a private shortcut around it would be the first asset whose
 * name was not guaranteed reachable from `s()`.
 *
 * It also handles a case a bare mint would not: `nextTakeName` guarantees
 * uniqueness against other TAKES, but a user could have imported a file already
 * called `take_1`. Routing through the shared path resolves that collision the
 * way every other collision is resolved, rather than silently producing two
 * records answering to one address.
 */

/** Injectable edges so the join is drivable in a test without a microphone. */
export interface SaveTakeDeps {
  /**
   * Decoded length in seconds, or undefined when it cannot be measured.
   *
   * ⚠ Measured, never derived from how long recording ran: 700 ms of requested
   * recording decoded to 0.66 s in the grounding run. Wall-clock is not the
   * take's duration.
   */
  readonly measureDuration?: (blob: Blob) => Promise<number | undefined>;
}

/** What saving a take produced. */
export interface SavedTake {
  /** The record now in the project document. */
  readonly record: AssetRecord;
  /**
   * Whether `s(record.name)` resolves right now.
   *
   * False means the bytes could not be resolved to a URL — the take is stored
   * and named but not yet playable this session. Surfaced rather than thrown,
   * because a take that exists is worth more than an exception.
   */
  readonly playable: boolean;
}

/**
 * Store audio under a filename, record it in the project, and register it.
 *
 * The order is load-bearing. Bytes first (so a failure leaves nothing dangling
 * in the document), then the record, then registration — registering a name
 * whose record was never written would leave `s()` resolving to something the
 * project does not know it has, and that survives until reload.
 *
 * The filename is the only thing the two callers disagree about, and it is
 * genuinely the whole difference: everything below it — sanitising, the
 * uniqueness check against every other asset, dedup by content hash, the record
 * shape — is one path both must walk.
 */
export async function storeAudio(
  blob: Blob,
  filename: string,
  origin: AssetOrigin,
  deps: SaveTakeDeps = {},
): Promise<SavedTake> {
  const existing = listAssetRecords();
  const { record } = await importAsset(
    blob,
    filename,
    existing,
    { measureDuration: deps.measureDuration },
    origin,
  );

  addAssetRecord(record);
  const playable = await registerAsset(record);
  return { record, playable };
}

/** A recording becomes an asset under a minted positional name. */
export async function saveTake(
  blob: Blob,
  deps: SaveTakeDeps = {},
): Promise<SavedTake> {
  const name = nextTakeName(listAssetRecords().map((r) => r.name));

  // The extension is cosmetic — nothing downstream reads it. `loadBuffer`
  // fetches and decodes without parsing the URL or inferring a format, which is
  // why a blob URL with no extension at all decodes normally.
  return storeAudio(blob, `${name}.webm`, "recorded", deps);
}

/** Thrown when a file the user brought in is not audio this browser can read. */
export class UnsupportedAudioError extends Error {
  constructor(readonly filename: string) {
    super(`“${filename}” is not audio this browser can decode`);
    this.name = "UnsupportedAudioError";
  }
}

/**
 * A file the user brought in becomes an asset — #1541's half of the same join.
 *
 * ## Why this measures BEFORE it stores, when `saveTake` measures after
 *
 * A recording is audio by construction; a dropped file is whatever the user
 * dropped. The screen is the decode itself rather than the extension, because
 * the sampler infers nothing from an extension either — but `importAsset`
 * writes the bytes before it measures, deliberately, so that a measurer which
 * throws cannot leave a record without a blob. Refusing *after* that call would
 * therefore leave an orphan blob nothing points at, every time someone drops a
 * PDF. So the decode happens here, once, and its result is handed down as a
 * constant rather than measured a second time.
 *
 * A file whose bytes will not decode is still accepted when it *claims* to be
 * audio: a codec this browser lacks is a real thing, the bytes may well be
 * playable elsewhere, and "no duration" is an answer the record already has a
 * shape for. What is refused is the file that neither decodes nor claims.
 */
export async function importAudioFile(
  file: File,
  deps: SaveTakeDeps = {},
): Promise<SavedTake> {
  const measure = deps.measureDuration ?? decodeDurationSeconds;
  const duration = await measure(file);
  if (duration === undefined && !file.type.startsWith("audio/")) {
    throw new UnsupportedAudioError(file.name);
  }
  return storeAudio(file, file.name, "imported", {
    measureDuration: async () => duration,
  });
}

/** What importing a batch of dropped or picked files did. */
export interface ImportSummary {
  /** Every file that became an asset, in the order they were handed over. */
  readonly saved: SavedTake[];
  /** Filenames refused because they are not audio this browser can read. */
  readonly rejected: string[];
  /** Filenames that failed for any other reason — a full disk, a dead store. */
  readonly failed: string[];
}

/**
 * Import several files, reporting per file rather than failing the batch.
 *
 * ## Why this is sequential and must stay that way
 *
 * Each import reads `listAssetRecords()` to make its name unique against every
 * name already taken. Run two in parallel and both read the same "existing",
 * both find `vocal` free, and both mint `vocal` — two records answering to one
 * `s()` address, which is exactly the collision `uniqueSoundName` exists to
 * prevent. `Promise.all` here would be a correctness bug, not a speed-up, and
 * the operation is I/O-bound on a decode the user is waiting for anyway.
 *
 * One bad file does not cost the others: a person dropping a folder gets the
 * audio in it and a list of what was skipped, rather than nothing and an error.
 */
export async function importAudioFiles(
  files: readonly File[],
  deps: SaveTakeDeps = {},
): Promise<ImportSummary> {
  const saved: SavedTake[] = [];
  const rejected: string[] = [];
  const failed: string[] = [];
  for (const file of files) {
    try {
      saved.push(await importAudioFile(file, deps));
    } catch (err) {
      if (err instanceof UnsupportedAudioError) rejected.push(file.name);
      else failed.push(file.name);
    }
  }
  return { saved, rejected, failed };
}

/**
 * Decode a blob far enough to learn its length, or undefined if it will not
 * decode.
 *
 * Owns its own `AudioContext` and closes it: the engine's context belongs to
 * playback, and borrowing it to measure would couple a take's metadata to
 * whether the transport happens to be running.
 */
export async function decodeDurationSeconds(blob: Blob): Promise<number | undefined> {
  const Ctor =
    typeof window === "undefined"
      ? undefined
      : window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
  if (!Ctor) return undefined;
  const ctx = new Ctor();
  const url = URL.createObjectURL(blob);
  try {
    const bytes = await (await fetch(url)).arrayBuffer();
    return (await ctx.decodeAudioData(bytes)).duration;
  } catch {
    // Not decodable audio is an ordinary thing for bytes to be. The take is
    // still stored; it just has no duration.
    return undefined;
  } finally {
    URL.revokeObjectURL(url);
    void ctx.close();
  }
}
