/**
 * takeRecorder — capture a vocal take in the browser (#1504, Phase 2 of #1352).
 *
 * ## Why this is not blocked by the live-audio wall
 *
 * Recording audio and running audio THROUGH the engine are different problems,
 * and only the second is hard. Nothing here touches superdough's graph:
 * `getUserMedia` gives a `MediaStream`, `MediaRecorder` gives bytes, and the
 * bytes go into the store that already exists. `createMediaStreamSource` stays
 * at zero across superdough — that wall is Phase 5a's problem, not this one.
 *
 * ## What was measured before this was written
 *
 * In headless Chromium with a fake capture device:
 *   - `MediaRecorder.isTypeSupported` → `audio/webm;codecs=opus`, `audio/webm`,
 *     `audio/mp4`. **No wav, no ogg.**
 *   - the recorded blob through `fetch` → `decodeAudioData` **decodes**
 *     (0.66 s, 48 kHz, mono, peak 1.018, non-zero fraction 1.0).
 *
 * So webm/opus survives the exact path the sampler already uses and there is NO
 * transcode step. That reading is the reason this module is as small as it is.
 *
 * ⚠ Two traps from the same measurement, both encoded below:
 *   - `recorder.mimeType` is `""` BEFORE `start()`. The blob's own `type` is the
 *     authoritative one, so the type is read off the finished blob.
 *   - 700 ms of requested recording decoded to 0.66 s. A take's duration is a
 *     band, never an absolute — the caller measures it rather than assuming the
 *     wall-clock it recorded for.
 */

/** Why a recording could not start. Distinguished so the UI can say which. */
export type RecordStartFailure =
  /** The browser has no `getUserMedia` / `MediaRecorder` at all. */
  | "unsupported"
  /** The user (or policy) refused microphone access. */
  | "denied"
  /** A device exists but could not be opened — in use, or hardware error. */
  | "unavailable";

export class RecordStartError extends Error {
  constructor(readonly reason: RecordStartFailure, cause?: unknown) {
    super(`take-recorder:${reason}`);
    this.name = "RecordStartError";
    this.cause = cause;
  }
}

/** A recording in progress. `stop` resolves with the captured bytes. */
export interface ActiveRecording {
  /**
   * Stop capturing and resolve the take.
   *
   * Releases the microphone as part of stopping — see {@link stopTracks}.
   * Idempotent: a second call resolves with the same blob rather than throwing,
   * because a double-click on a stop button should not be an error.
   */
  stop(): Promise<Blob>;
  /** True until `stop` has been called. */
  isRecording(): boolean;
}

/**
 * End every track on the stream.
 *
 * Not optional and not tidiness: a `MediaRecorder.stop()` leaves the underlying
 * tracks LIVE, so the browser keeps showing its recording indicator and the
 * microphone stays held after the user believes they have stopped. That reads
 * as the app still listening, which is the worst possible thing to be wrong
 * about. The spec asserts the tracks actually ended.
 */
function stopTracks(stream: MediaStream): void {
  for (const track of stream.getTracks()) track.stop();
}

/** Map a `getUserMedia` rejection onto something the UI can act on. */
function classifyGumError(err: unknown): RecordStartFailure {
  const name = (err as { name?: string } | null)?.name ?? "";
  if (name === "NotAllowedError" || name === "SecurityError") return "denied";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "unavailable";
  return "unavailable";
}

/** Injectable edges, so the whole path is drivable without a real microphone. */
export interface TakeRecorderDeps {
  /** Defaults to `navigator.mediaDevices.getUserMedia`. */
  readonly getStream?: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  /** Defaults to the global `MediaRecorder`. */
  readonly createRecorder?: (stream: MediaStream) => MediaRecorder;
}

/**
 * Begin recording from the default audio input.
 *
 * Rejects with a {@link RecordStartError} rather than a bare DOMException, so a
 * caller can tell "you said no" from "there is no microphone" from "this
 * browser cannot" — three cases that need three different things said to the
 * user, and which a single "recording failed" would flatten.
 */
export async function startRecording(
  deps: TakeRecorderDeps = {},
): Promise<ActiveRecording> {
  const getStream =
    deps.getStream ??
    (typeof navigator !== "undefined" && navigator.mediaDevices
      ? navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
      : undefined);
  const createRecorder =
    deps.createRecorder ??
    (typeof MediaRecorder !== "undefined" ? (s: MediaStream) => new MediaRecorder(s) : undefined);

  if (!getStream || !createRecorder) throw new RecordStartError("unsupported");

  let stream: MediaStream;
  try {
    stream = await getStream({ audio: true });
  } catch (err) {
    throw new RecordStartError(classifyGumError(err), err);
  }

  let recorder: MediaRecorder;
  try {
    recorder = createRecorder(stream);
  } catch (err) {
    // The stream opened but nothing can encode it. Release the microphone
    // rather than leaving it held by a recording that never started.
    stopTracks(stream);
    throw new RecordStartError("unsupported", err);
  }

  const chunks: Blob[] = [];
  recorder.ondataavailable = (e: BlobEvent) => {
    // A zero-byte chunk is normal at the tail; keeping it would not corrupt the
    // blob, but skipping it keeps the chunk count meaningful for diagnostics.
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };

  const finished = new Promise<Blob>((resolve) => {
    recorder.onstop = () => {
      // `recorder.mimeType` is `""` before `start()` and only meaningful after.
      // Reading it here is safe, but the BLOB's type is what every consumer
      // downstream actually sees, so that is what the take carries.
      resolve(new Blob(chunks, { type: recorder.mimeType || "audio/webm" }));
    };
  });

  recorder.start();

  let stopped = false;
  return {
    isRecording: () => !stopped,
    async stop() {
      if (!stopped) {
        stopped = true;
        if (recorder.state !== "inactive") recorder.stop();
        stopTracks(stream);
      }
      // A second call awaits the same promise rather than throwing — a
      // double-click on stop is not an error.
      return finished;
    },
  };
}

/** What the browser said when asked to keep this origin's storage. */
export type PersistOutcome = "granted" | "denied" | "unsupported";

/**
 * Ask the browser not to evict this origin's storage.
 *
 * ⚠ This is the FIRST use of `navigator.storage` anywhere in the codebase, and
 * it lands here rather than with the byte store on purpose: an imported file
 * can be re-imported from the copy the user still has, and a performance
 * cannot. Losing a take is losing something that no longer exists anywhere.
 *
 * The answer is RETURNED rather than swallowed. A user whose takes are
 * evictable should be able to find that out; a silent `void persist()` is a
 * durability guarantee nobody can check.
 */
export async function requestPersistentStorage(): Promise<PersistOutcome> {
  if (typeof navigator === "undefined") return "unsupported";
  const storage = navigator.storage;
  if (!storage?.persist || !storage.persisted) return "unsupported";
  try {
    // Already granted is not the same as newly granted, but it IS the same
    // answer to "are these bytes safe", which is the only question here.
    if (await storage.persisted()) return "granted";
    return (await storage.persist()) ? "granted" : "denied";
  } catch {
    return "unsupported";
  }
}
