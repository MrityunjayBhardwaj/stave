import {
  addAssetRecord,
  importAsset,
  listAssetRecords,
  nextTakeName,
  registerAsset,
  type AssetRecord,
} from "@stave/editor";

/**
 * saveTake — a recorded blob becomes a named, persistent, playable asset (#1504).
 *
 * The join between three things that already exist: the byte store (#1500), the
 * project document's memory (#1502), and superdough's registration. Nothing new
 * is invented here; this is the order they have to happen in.
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
 * Store a recording, name it, record it in the project, and register it.
 *
 * The order is load-bearing. Bytes first (so a failure leaves nothing dangling
 * in the document), then the record, then registration — registering a name
 * whose record was never written would leave `s()` resolving to something the
 * project does not know it has, and that survives until reload.
 */
export async function saveTake(
  blob: Blob,
  deps: SaveTakeDeps = {},
): Promise<SavedTake> {
  const existing = listAssetRecords();
  const name = nextTakeName(existing.map((r) => r.name));

  // The extension is cosmetic — nothing downstream reads it. `loadBuffer`
  // fetches and decodes without parsing the URL or inferring a format, which is
  // why a blob URL with no extension at all decodes normally.
  const { record } = await importAsset(blob, `${name}.webm`, existing, {
    measureDuration: deps.measureDuration,
  });

  addAssetRecord(record);
  const playable = await registerAsset(record);
  return { record, playable };
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
