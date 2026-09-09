"use client";

import * as React from "react";

import {
  RecordStartError,
  requestPersistentStorage,
  startRecording,
  type ActiveRecording,
  type RecordStartFailure,
} from "../audio/takeRecorder";
import { decodeDurationSeconds, saveTake } from "../audio/saveTake";
import { notifyAssetProvidersChanged } from "./registry";

/**
 * The record control (#1504) — one button, in the library, beside the assets it
 * produces.
 *
 * Self-contained rather than prop-drilled from the app shell: recording state
 * belongs to the thing that starts it, and threading `recording` /
 * `onRecordToggle` / `error` up to `StaveApp` would put three pieces of state
 * in a component that has no other reason to know about microphones.
 *
 * ## What it says when it cannot record
 *
 * Three refusals need three different sentences, which is why the recorder
 * distinguishes them rather than throwing one error: "you said no" is fixable
 * by the user in browser settings, "no microphone" is not fixable in the app at
 * all, and "this browser cannot" is neither. Flattening them to "recording
 * failed" would leave a user retrying a button that can never work.
 */

const MESSAGES: Record<RecordStartFailure, string> = {
  denied: "Microphone access was denied. Allow it in your browser settings to record.",
  unavailable: "No microphone available.",
  unsupported: "This browser cannot record audio.",
};

export function RecordTakeButton(): React.JSX.Element {
  const [active, setActive] = React.useState<ActiveRecording | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [message, setMessage] = React.useState<string | null>(null);
  // Held in a ref as well so unmount-while-recording can release the microphone
  // without waiting for a state read.
  const activeRef = React.useRef<ActiveRecording | null>(null);

  React.useEffect(() => {
    return () => {
      // Leaving the panel mid-recording must not leave the microphone held —
      // the browser would keep showing its indicator with nothing on screen to
      // explain it.
      void activeRef.current?.stop();
      activeRef.current = null;
    };
  }, []);

  const begin = React.useCallback(async () => {
    setBusy(true);
    setMessage(null);
    try {
      // Asked on the first record rather than at boot: a permission-adjacent
      // request the user has not asked for is noise, and until there is a take
      // there is nothing to keep.
      const persisted = await requestPersistentStorage();
      const rec = await startRecording();
      activeRef.current = rec;
      setActive(rec);
      // Reported, not swallowed. A user whose takes are evictable should be
      // able to find that out; a silent request is a guarantee nobody can check.
      if (persisted === "denied") {
        setMessage("Recording. Note: the browser may evict stored takes.");
      }
    } catch (err) {
      const reason = err instanceof RecordStartError ? err.reason : "unavailable";
      setMessage(MESSAGES[reason]);
    } finally {
      setBusy(false);
    }
  }, []);

  const finish = React.useCallback(async () => {
    const rec = activeRef.current;
    if (!rec) return;
    setBusy(true);
    try {
      const blob = await rec.stop();
      activeRef.current = null;
      setActive(null);
      const { record, playable } = await saveTake(blob, {
        measureDuration: decodeDurationSeconds,
      });
      // The provider reads records live, so the panel only needs telling that
      // the catalog changed.
      notifyAssetProvidersChanged();
      setMessage(
        playable
          ? `Saved ${record.name}`
          : `Saved ${record.name}, but it could not be loaded for playback`,
      );
    } catch {
      setMessage("The recording could not be saved.");
    } finally {
      setBusy(false);
    }
  }, []);

  const recording = active != null;

  return (
    <>
      <button
        style={{ ...styles.button, ...(recording ? styles.recording : null) }}
        onClick={() => void (recording ? finish() : begin())}
        disabled={busy}
        title={recording ? "Stop recording" : "Record a take"}
        aria-label={recording ? "Stop recording" : "Record a take"}
        aria-pressed={recording}
        data-record-take
        data-recording={recording ? "true" : "false"}
      >
        <span style={styles.dot} aria-hidden />
        {recording ? "STOP" : "REC"}
      </button>
      {message && (
        <div style={styles.message} role="status" data-record-message>
          {message}
        </div>
      )}
    </>
  );
}

const styles: Record<string, React.CSSProperties> = {
  button: {
    background: "none",
    border: "1px solid var(--border-subtle)",
    borderRadius: 3,
    color: "var(--text-secondary)",
    cursor: "pointer",
    padding: "2px 6px",
    fontSize: 9,
    fontWeight: 700,
    letterSpacing: 0.6,
    display: "flex",
    alignItems: "center",
    gap: 4,
  },
  recording: {
    color: "var(--danger, #e5484d)",
    borderColor: "var(--danger, #e5484d)",
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: "50%",
    background: "currentColor",
    display: "inline-block",
  },
  message: {
    padding: "6px 14px",
    fontSize: 10,
    lineHeight: 1.4,
    color: "var(--text-secondary)",
    borderBottom: "1px solid var(--border-subtle)",
  },
};
