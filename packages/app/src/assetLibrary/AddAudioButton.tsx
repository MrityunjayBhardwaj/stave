"use client";

import * as React from "react";

import { decodeDurationSeconds, importAudioFiles } from "../audio/saveTake";
import { warmWaveforms } from "../audio/waveformWarm";
import { notifyAssetProvidersChanged } from "./registry";
import { dragCarriesFiles, summarize } from "./importMessages";

/**
 * Bringing audio in (#1541) — the other way a sound gets into a project.
 *
 * Sits beside `RecordTakeButton` for the same reason that one sits in the
 * library: the control belongs with the assets it produces. From the user's
 * side these are one feature — "get a sound into this project" — and they land
 * in the same place, under the same "Your audio" group.
 *
 * ## Why the state lives in a hook and not in the button
 *
 * There are TWO gestures for one operation: the picker and a drop onto the
 * panel. `RecordTakeButton` keeps its own state because recording has exactly
 * one entry point; here, two components would mean two `busy` flags and two
 * places a result message could appear, and a drop would have no way to reach
 * the button's message slot. One owner, both gestures.
 */

export interface AudioImport {
  readonly busy: boolean;
  readonly message: string | null;
  readonly importFiles: (files: readonly File[]) => Promise<void>;
}

/** Owns the import operation for both gestures. */
export function useAudioImport(): AudioImport {
  const [busy, setBusy] = React.useState(false);
  const [message, setMessage] = React.useState<string | null>(null);

  const importFiles = React.useCallback(async (files: readonly File[]) => {
    if (files.length === 0) return;
    setBusy(true);
    setMessage(null);
    try {
      const summary = await importAudioFiles(files, {
        measureDuration: decodeDurationSeconds,
      });
      // The provider reads records live, so the panel only needs telling that
      // the catalog changed.
      if (summary.saved.length > 0) notifyAssetProvidersChanged();
      // Decode what registered, so each new sound can be SEEN on the Song
      // timeline before anything has played it — the same warm the recorder
      // does, and skipped for the same reason when a record has no URL.
      const playable = summary.saved
        .filter((s) => s.playable)
        .map((s) => s.record.name);
      if (playable.length > 0) void warmWaveforms(playable);
      setMessage(summarize(summary));
    } catch {
      setMessage("The files could not be added.");
    } finally {
      setBusy(false);
    }
  }, []);

  return { busy, message, importFiles };
}

/**
 * Drop handlers for a container that accepts audio files.
 *
 * ⚠ Only OS file drags are claimed. The app drags its own items around with
 * `application/stave-tree-item`, and a drop target that called
 * `preventDefault()` on everything would quietly eat those — the tree would
 * stop reordering with nothing to say why.
 */
export function useAudioDrop(onFiles: (files: readonly File[]) => void) {
  const [over, setOver] = React.useState(false);
  // Drag events fire on every child as the pointer moves, so a boolean toggled
  // by enter/leave flickers. Counting them is the standard remedy.
  const depth = React.useRef(0);

  return {
    over,
    handlers: {
      onDragEnter: (e: React.DragEvent) => {
        if (!dragCarriesFiles(e.dataTransfer.types)) return;
        depth.current += 1;
        setOver(true);
      },
      onDragOver: (e: React.DragEvent) => {
        if (!dragCarriesFiles(e.dataTransfer.types)) return;
        // Without this the browser navigates to the dropped file.
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
      },
      onDragLeave: (e: React.DragEvent) => {
        if (!dragCarriesFiles(e.dataTransfer.types)) return;
        depth.current = Math.max(0, depth.current - 1);
        if (depth.current === 0) setOver(false);
      },
      onDrop: (e: React.DragEvent) => {
        if (!dragCarriesFiles(e.dataTransfer.types)) return;
        e.preventDefault();
        depth.current = 0;
        setOver(false);
        onFiles(Array.from(e.dataTransfer.files));
      },
    },
  };
}

/**
 * The picker control. Presentational — the operation belongs to the hook.
 *
 * ## Why a hidden input rather than a styled one
 *
 * `<input type="file">` cannot be restyled to match the chrome, and a visible
 * one would be the only browser-default control in the panel. The button owns
 * the appearance and the accessible name; the input is the mechanism, kept out
 * of the tab order so it is not a second stop that does the same thing.
 */
export function AddAudioButton({
  busy,
  onFiles,
}: {
  busy: boolean;
  onFiles: (files: readonly File[]) => void;
}): React.JSX.Element {
  const inputRef = React.useRef<HTMLInputElement>(null);
  return (
    <>
      <button
        style={styles.button}
        onClick={() => inputRef.current?.click()}
        disabled={busy}
        title="Add audio files"
        aria-label="Add audio files"
        data-add-audio
      >
        + AUDIO
      </button>
      <input
        ref={inputRef}
        type="file"
        // Permissive on purpose: the sampler infers nothing from an extension,
        // so the honest gate is whether the bytes decode, which
        // `importAudioFile` checks. A hardcoded extension list would refuse
        // formats that play perfectly well.
        accept="audio/*"
        multiple
        tabIndex={-1}
        style={{ display: "none" }}
        data-add-audio-input
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          // Cleared before anything awaits, so picking the SAME file twice in a
          // row still fires a change event the second time.
          e.currentTarget.value = "";
          onFiles(files);
        }}
      />
    </>
  );
}

/** The result line, rendered once wherever the panel wants it. */
export function AddAudioMessage({
  message,
}: {
  message: string | null;
}): React.JSX.Element | null {
  if (!message) return null;
  return (
    <div style={styles.message} role="status" data-add-audio-message>
      {message}
    </div>
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
  message: {
    padding: "6px 14px",
    fontSize: 10,
    lineHeight: 1.4,
    color: "var(--text-secondary)",
    borderBottom: "1px solid var(--border-subtle)",
  },
};
