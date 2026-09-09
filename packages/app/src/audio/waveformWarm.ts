/**
 * waveformWarm — make a local take drawable, and tell the timeline it now is
 * (#1506).
 *
 * ## Why a notification exists at all
 *
 * The Song timeline is dirty-flagged: it redraws when the scene, the transform
 * or its size changes, and never on a loop (`SongTimelineCanvas`). A sample
 * finishing its decode changes none of those. Without a signal the waveform
 * would be correct in memory and absent on screen until something unrelated
 * happened to force a repaint — which is the kind of bug that reads as "it only
 * works sometimes".
 *
 * So warming and announcing are one call. Anything that makes new audio
 * available goes through here, and the timeline learns about it.
 *
 * ## Why only local assets
 *
 * `warmSamplePeaks` fetches and decodes. For a take or an imported file that is
 * a read from IndexedDB through a `blob:` URL and costs no network. Doing the
 * same for the CDN sample banks would have a page load pull megabytes of drums
 * in order to draw pictures of them, so the draw path never loads anything and
 * this is the one deliberate exception.
 */

import { warmSamplePeaks } from "@stave/editor";

type Listener = () => void;

const listeners = new Set<Listener>();

/**
 * Be told when new waveforms became drawable. Returns an unsubscribe.
 *
 * The timeline is the only subscriber today, and it uses this purely to force a
 * repaint — the peaks themselves are read through the draw path, not carried in
 * the notification, so a listener that misses one is merely late, never wrong.
 */
export function subscribeWaveformsReady(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Announce that at least one sample's shape is now available. */
export function notifyWaveformsReady(): void {
  for (const listener of [...listeners]) {
    try {
      listener();
    } catch {
      // One listener throwing must not stop the others being told, or a single
      // unmounted component could silence every waveform on the page.
    }
  }
}

/**
 * Decode the named local assets and announce whichever became drawable.
 *
 * Announces ONCE, after the batch, and only if something actually warmed —
 * a project with no assets must not cost a repaint, and neither must a name
 * whose bytes have been evicted.
 */
export async function warmWaveforms(names: readonly string[]): Promise<string[]> {
  if (names.length === 0) return [];
  let warmed: string[] = [];
  try {
    warmed = await warmSamplePeaks(names);
  } catch {
    // Warming is an enhancement; a failure leaves the timeline drawing marks.
    return [];
  }
  if (warmed.length > 0) notifyWaveformsReady();
  return warmed;
}
