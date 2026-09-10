/**
 * Reporting a refused surgical write, in ONE place (#1414).
 *
 * `applyOffsetEditsToFile` names five distinct refusals. Two surfaces write
 * through it — the Song Timeline's clip gestures and the Mixer's backdrop write
 * — and before this module they said so in two different voices: one turned the
 * refusal into a sentence, the other leaked the raw enum into a message a user
 * reads. The table belongs wherever the SECOND caller appeared, which is here.
 *
 * ⚠ WHY `warn` AND NOT `error`. StaveApp's toast bridge raises a toast for
 * errors only; warnings reach the Console panel and the activity-bar unread
 * badge without interrupting. A gesture that quietly declined should be
 * findable, not shouty — and on the timeline the clip already snaps back on its
 * own, because the canvas re-derives its extents from the IR. What was missing
 * was never the visual: it was knowing WHICH refusal fired.
 */
import { emitLog, type RegionTrimRefusal, type WriteRefusal } from '@stave/editor'

/**
 * Human-readable cause for each refusal. A `Record` over the union rather than a
 * lookup with a fallback, so adding a `WriteRefusal` cannot compile until
 * someone has written the sentence a user will actually see.
 */
export const REFUSAL_CAUSE: Record<WriteRefusal, string> = {
  'no-editor': 'the editor for this document is not mounted',
  'no-monaco': 'the editor core has not finished loading',
  'no-edits': 'the change could not be expressed in the document',
  'stale-document':
    'the document changed underneath the gesture, so the edit was dropped rather than applied at stale offsets — try again',
  'writeback-threw': 'the write-back itself failed',
}

/**
 * Report a refused write. `what` names the gesture from the user's point of view
 * ("Timeline: delete clip", "Mixer: the backdrop"), because the cause alone does
 * not say what they were trying to do.
 *
 * emitLog coalesces on (level, runtime, source, message), so a repeated refusal
 * bumps ONE row's count instead of flooding the Console — which is also what
 * makes "how often, and which one" readable off the panel at all.
 */
export function reportWriteRefusal(
  fileId: string | undefined,
  what: string,
  refusal: WriteRefusal,
): void {
  emitLog({
    level: 'warn',
    runtime: 'stave',
    source: fileId,
    message: `${what} was not applied — ${REFUSAL_CAUSE[refusal]}.`,
  })
}

/**
 * Why a region trim declined (#1527), in the same voice as the table above.
 *
 * ⚠ THESE REFUSALS FIRE BEFORE THE WRITER IS EVER CALLED, which is why they need
 * their own table rather than a sixth `WriteRefusal`. A region trim can be
 * perfectly writable as text and still be the wrong thing to write — the value
 * is patterned, the expression stacks several voices, or the lane anchor
 * resolved to an expression that does not own the region the mark is playing.
 * `applyOffsetEditsToFile` would apply every one of those happily.
 *
 * And they matter more than the writer's own do, because the gesture leaves no
 * trace when it declines: the mark snaps back to where it was and the document
 * is untouched, which looks exactly like a drag that did not take. P787's shape
 * — a refusal correct for its input is indistinguishable from a feature that
 * does not apply — unless it says so.
 */
/**
 * Every way a region trim can decline: the editor's own three, plus the two the
 * app resolves for itself before the editor is ever asked.
 */
export type RegionRefusal = RegionTrimRefusal | 'no-anchor' | 'anchor-mismatch'

export const REGION_REFUSAL_CAUSE: Record<RegionRefusal, string> = {
  'not-a-number':
    'this track writes its region as a pattern or an expression rather than a plain number, so dragging it would overwrite something you wrote on purpose',
  'not-one-voice':
    'this expression combines several sounds, so trimming it would trim all of them — trim the take on its own track instead',
  'no-change': 'the drag landed on the value the document already has',
  'no-anchor': 'this lane has no source position, so there is nothing to write to',
  'anchor-mismatch':
    'the code at this lane does not set the slice this mark is playing — it is probably set somewhere else, such as on a shared binding',
}

/** Report a region trim that declined before any write was attempted (#1527). */
export function reportRegionRefusal(
  fileId: string | undefined,
  what: string,
  refusal: RegionRefusal,
): void {
  emitLog({
    level: 'warn',
    runtime: 'stave',
    source: fileId,
    message: `${what} was not applied — ${REGION_REFUSAL_CAUSE[refusal]}.`,
  })
}
