import { describe, expect, it, vi } from "vitest";

import { recordsToAssets, type SampleRecord } from "../samplesProvider";

/**
 * The pure mapping only. The recorder, the store and the document are observed
 * in `packages/app/tests/record-take.spec.ts` — none of them has a unit surface
 * (no `MediaRecorder`, no IndexedDB in jsdom).
 */

const deps = {
  startPreview: vi.fn(() => ({ stop: () => {} })),
  onInsert: vi.fn(),
};

function record(over: Partial<SampleRecord> = {}): SampleRecord {
  return {
    id: "r1",
    name: "take_1",
    blobHash: "aaaa",
    mime: "audio/webm",
    ...over,
  };
}

describe("recordsToAssets", () => {
  it("maps nothing to nothing", () => {
    expect(recordsToAssets([], deps)).toEqual([]);
  });

  it("keys the row on the RECORD id, so a rename moves a row rather than replacing it", () => {
    const [asset] = recordsToAssets([record({ id: "r7" })], deps);
    expect(asset.id).toBe("r7");
  });

  it("makes the NAME the code token — the id means nothing in code", () => {
    const [asset] = recordsToAssets([record({ id: "r7", name: "chorus" })], deps);
    expect(asset.code).toBe("chorus");
  });

  it("tags a take as a user sample so the source filter can find it", () => {
    const [asset] = recordsToAssets([record()], deps);
    expect({ type: asset.type, source: asset.source }).toEqual({
      type: "sample",
      source: "user",
    });
  });

  it("shows a measured duration as a one-decimal tag", () => {
    // One decimal on purpose: an encoder does not give back precisely what was
    // recorded for, so the figure is a band and extra digits would imply it is not.
    const [asset] = recordsToAssets([record({ duration: 1.2345 })], deps);
    expect(asset.tags).toContain("1.2s");
  });

  it("omits the duration tag entirely when it was never measured", () => {
    // Not "unknown" — a row that says nothing about length is honest; a row
    // that says "unknown" spends space to say the same thing.
    const [asset] = recordsToAssets([record({ duration: undefined })], deps);
    expect(asset.tags).toEqual(["sample", "recorded"]);
  });

  it("drops a non-finite duration rather than rendering NaNs", () => {
    const [asset] = recordsToAssets([record({ duration: Number.NaN })], deps);
    expect(asset.tags).toEqual(["sample", "recorded"]);
  });

  it("sorts by name so the list does not reshuffle as takes arrive", () => {
    const assets = recordsToAssets(
      [record({ id: "b", name: "take_2" }), record({ id: "a", name: "take_1" })],
      deps,
    );
    expect(assets.map((a) => a.name)).toEqual(["take_1", "take_2"]);
  });

  it("previews by NAME, which is what the sound map is keyed on", () => {
    const startPreview = vi.fn(() => ({ stop: () => {} }));
    const [asset] = recordsToAssets([record({ id: "r7", name: "chorus" })], {
      startPreview,
      onInsert: vi.fn(),
    });
    asset.preview?.();
    expect(startPreview).toHaveBeenCalledWith("chorus");
  });

  it("inserts by NAME too", () => {
    const onInsert = vi.fn();
    const [asset] = recordsToAssets([record({ id: "r7", name: "chorus" })], {
      startPreview: vi.fn(() => ({ stop: () => {} })),
      onInsert,
    });
    asset.insert?.();
    expect(onInsert).toHaveBeenCalledWith("chorus");
  });
});
