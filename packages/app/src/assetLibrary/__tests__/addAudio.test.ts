/**
 * What the panel says after audio is brought in (#1541).
 *
 * `summarize` is the whole of it: a pure function from a batch result to the
 * one sentence a user reads. Kept pure so the sentences can be checked without
 * a DOM, a store, or a decode.
 */
import { describe, expect, it } from "vitest";

import { dragCarriesFiles, summarize } from "../importMessages";
import type { ImportSummary } from "../../audio/saveTake";

function saved(...names: string[]) {
  return names.map((name) => ({
    record: { id: name, name, blobHash: "h", mime: "audio/wav" },
    playable: true,
  }));
}

function summary(over: Partial<ImportSummary> = {}): ImportSummary {
  return { saved: [], rejected: [], failed: [], ...over } as ImportSummary;
}

describe("#1541 — the sentence a finished import gets", () => {
  it("names the sound when exactly one arrived", () => {
    // The name is what the user now types into `s()`, so it is the one piece
    // of information worth spending the sentence on.
    expect(summarize(summary({ saved: saved("my_vocal") }))).toBe(
      "Added my_vocal",
    );
  });

  it("counts them once there are several, rather than listing every name", () => {
    expect(summarize(summary({ saved: saved("a", "b", "c") }))).toBe(
      "Added 3 sounds",
    );
  });

  it("says nothing at all when nothing happened", () => {
    // An empty drop is not an error and not an event. A toast saying "added 0
    // sounds" is noise about a thing the user did not do.
    expect(summarize(summary())).toBeNull();
  });

  it("names what it skipped while there are few, so the user can act on it", () => {
    expect(summarize(summary({ rejected: ["notes.pdf"] }))).toBe(
      "Skipped “notes.pdf” — not audio this browser can read",
    );
  });

  it("counts skipped files once naming them would be a wall of text", () => {
    expect(
      summarize(summary({ rejected: ["a.pdf", "b.doc", "c.txt"] })),
    ).toBe("Skipped 3 files — not audio this browser can read");
  });

  it("keeps a refusal and a failure in separate clauses", () => {
    // They need different remedies: one is "convert it", the other is not, and
    // telling someone to convert a file when the disk is full sends them the
    // wrong way entirely.
    const line = summarize(
      summary({
        saved: saved("good"),
        rejected: ["notes.pdf"],
        failed: ["huge.wav"],
      }),
    );
    expect(line).toBe(
      "Added good; skipped “notes.pdf” — not audio this browser can read; could not save “huge.wav”",
    );
  });

  it("still leads with the failure when nothing was added", () => {
    expect(summarize(summary({ failed: ["huge.wav"] }))).toBe(
      "Could not save “huge.wav”",
    );
  });
});

describe("#1541 — the drop target claims file drags only", () => {
  it("takes a drag carrying OS files", () => {
    expect(dragCarriesFiles(["Files"])).toBe(true);
    expect(dragCarriesFiles(["text/plain", "Files"])).toBe(true);
  });

  it("CONTROL — leaves the app's own tree drag alone", () => {
    // The reason the guard exists: claiming this would stop the file tree
    // reordering, with nothing on screen to say why.
    expect(dragCarriesFiles(["application/stave-tree-item"])).toBe(false);
  });

  it("treats a drag with no types at all as not ours", () => {
    expect(dragCarriesFiles([])).toBe(false);
    expect(dragCarriesFiles(undefined)).toBe(false);
  });
});
