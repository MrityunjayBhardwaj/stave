/**
 * writeback — chunk → document.
 *
 * The mutation half of the visual-editing spine. Visual panels read a
 * `ChunkInfo` (see `chunkDetect.ts`) to learn the doc offsets they may edit,
 * then route every edit through here so it is:
 *
 *  1. **Surgical** — only the named offset range changes; the rest of the
 *     statement (mini-notation quotes, spacing, indent) stays byte-identical.
 *     This is the whole reason write-back panels edit TEXT and not the IR:
 *     `toStrudel` is a whole-statement canonical regenerator that would
 *     reformat the leaf layer (design doc Appendix A).
 *  2. **Origin-tagged** — while a panel edit is applied, `currentSource` names
 *     it, so the host's `onDidChangeModelContent` listener can tell a panel
 *     edit (re-eval audio, keep panel model) from a typed edit (re-parse the
 *     panel model). Monaco's content-change event carries no source of its
 *     own, so the flag is set synchronously around the edit — the listener
 *     fires inside `pushEditOperations`, while the flag is up.
 *  3. **One undo step** — every call is a single `pushEditOperations`, so even
 *     a multi-cell drag (`replaceRanges`) is one Ctrl-Z.
 *
 * Range discipline: offsets come from a `ChunkInfo` and are valid ONLY against
 * the exact doc it was detected from. Use `applyFresh` (or call `isChunkFresh`
 * yourself) before every write — stale offsets corrupt unrelated code.
 *
 * The pure helpers (`formatNumber`, `normalizeEdits`) are string/number math
 * with no Monaco dependency, so they unit-test with plain assertions. The
 * `Writeback` class is the thin Monaco-bound shell, observed in the app.
 */
import type * as Monaco from 'monaco-editor'
import { isChunkFresh, type ChunkInfo } from './chunkDetect'
import { requestReeval, getFileIdForEditor } from '../workspace/editorRegistry'

/** trailing-debounce window for the live re-eval — coalesces a quick burst of
 * commits into fewer re-evals (less eval churn) while staying snappy for a
 * single edit. Correctness under a burst (the final state winning) is guaranteed
 * by the app handler serialising re-evals per file, NOT by this window. */
const REEVAL_DEBOUNCE_MS = 120

/**
 * Which panel originated an edit. The host content-change listener switches on
 * this to decide whether to re-parse its model (typed edit) or leave it
 * (panel-originated edit it already knows about).
 */
export type WriteSource =
  | 'knob'
  | 'seq'
  | 'roll'
  | 'arrange.weights'
  | 'arrange.structure'
  | 'transport'
  | 'mixer'
  | 'rename'
  // #1464 Stage 2 — the Song Timeline's automation caption (a bound or a signal
  // kind edited in place on the lane).
  | 'automation'
  // #1527 — the Song Timeline's region trim: dragging a sample mark's own edge
  // to change which slice of its file it plays (`.begin` / `.end`). Its own
  // source rather than `knob` because it edits the same two controls the
  // inspector's knobs do, from a different surface with a different failure
  // mode, and a Console line that cannot tell them apart is not an instrument.
  | 'region.trim'

/** A single replacement, addressed by absolute pre-edit doc offsets. */
export interface OffsetEdit {
  /** absolute [start, end) offsets in the document as it was when detected */
  range: [number, number]
  /** replacement text ('' to delete) */
  text: string
}

/**
 * Format a number for insertion as a source literal. Drag handlers produce
 * values like `0.30000000000000004` or `2.9999999`; emitting those verbatim
 * would corrupt the user's code with float noise. We round to `maxDecimals`
 * and strip trailing zeros, so `0.3`, `2`, `-1.5` come out clean.
 *
 * Pure — no Monaco.
 */
export function formatNumber(v: number, maxDecimals = 4): string {
  if (!Number.isFinite(v)) return '0'
  if (Number.isInteger(v)) return String(v)
  // toFixed then trim trailing zeros and any orphaned decimal point.
  const fixed = v.toFixed(maxDecimals)
  return fixed.replace(/\.?0+$/, '')
}

/**
 * Validate a batch of edits and return them sorted ascending by start offset.
 * Throws on any overlap — overlapping ranges in a single `pushEditOperations`
 * have undefined application order and would corrupt the doc. Zero-width edits
 * (inserts) are allowed and never count as overlapping a neighbour that starts
 * at the same offset only if texts don't both target it; we conservatively
 * reject ranges that share interior space.
 *
 * Pure — no Monaco.
 */
export function normalizeEdits(edits: OffsetEdit[]): OffsetEdit[] {
  for (const e of edits) {
    if (e.range[0] > e.range[1]) {
      throw new Error(`writeback: inverted range [${e.range[0]}, ${e.range[1]}]`)
    }
  }
  const sorted = [...edits].sort((a, b) => a.range[0] - b.range[0] || a.range[1] - b.range[1])
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1].range
    const cur = sorted[i].range
    // Overlap when the current edit starts strictly before the previous ends.
    // Touching at a point (prev.end === cur.start) is fine.
    if (cur[0] < prev[1]) {
      throw new Error(
        `writeback: overlapping edits [${prev[0]}, ${prev[1]}] and [${cur[0]}, ${cur[1]}]`,
      )
    }
  }
  return sorted
}

/**
 * Apply a batch of offset edits to a string and return the result. Pure mirror
 * of what `Writeback.apply` does to a Monaco model — used by callers that edit
 * plain text (arrangement round-trip / parity tests) and to preview an edit
 * before it touches the document. Edits are validated + sorted by
 * `normalizeEdits`, then spliced from the END so earlier offsets stay valid.
 *
 * Pure — no Monaco.
 */
export function applyEdits(doc: string, edits: OffsetEdit[]): string {
  const sorted = normalizeEdits(edits)
  let out = doc
  for (let i = sorted.length - 1; i >= 0; i--) {
    const { range, text } = sorted[i]
    out = out.slice(0, range[0]) + text + out.slice(range[1])
  }
  return out
}

/**
 * Monaco-bound edit sink. One per editor. Construct with the editor instance
 * and the `monaco` namespace (for `Range`). All edits go through `apply`, which
 * keeps the origin flag up across the synchronous content-change event.
 */
export class Writeback {
  private writingSource: WriteSource | null = null
  /** true between beginGesture/endGesture — suppresses per-edit undo boundaries */
  private inGesture = false
  /** whether the in-flight gesture has applied any edit — gates the one re-eval
   * on `endGesture` so a gesture that wrote nothing doesn't re-evaluate. */
  private gestureDidEdit = false
  /** trailing-debounce timer for the live re-eval (see `requestLiveReeval`). */
  private reevalTimer: ReturnType<typeof setTimeout> | null = null

  constructor(
    private readonly editor: Monaco.editor.IStandaloneCodeEditor,
    private readonly monaco: typeof Monaco,
  ) {}

  /**
   * Open a gesture: edits applied until `endGesture` coalesce into ONE undo
   * step. Used for a continuous knob drag or a multi-cell sweep so the whole
   * gesture is a single Ctrl-Z. Re-eval still fires per edit (live audio); only
   * the undo grouping is affected. Idempotent if already in a gesture.
   */
  beginGesture(): void {
    if (this.inGesture) return
    const model = this.editor.getModel()
    if (!model) return
    model.pushStackElement() // close any prior (typing) undo group
    this.inGesture = true
    this.gestureDidEdit = false
  }

  /** Close the gesture, sealing all its edits as one undo step — and, if the
   * gesture changed anything, make it audible immediately (one re-eval on
   * release, not per drag frame). */
  endGesture(): void {
    if (!this.inGesture) return
    this.inGesture = false
    this.editor.getModel()?.pushStackElement()
    if (this.gestureDidEdit) {
      this.gestureDidEdit = false
      this.requestLiveReeval()
    }
  }

  /**
   * The source of the edit currently being applied, or null. The host's
   * `onDidChangeModelContent` listener reads this synchronously to attribute
   * the change. It is non-null ONLY for the duration of `apply`.
   */
  get currentSource(): WriteSource | null {
    return this.writingSource
  }

  /** Replace a single offset range. One undo step. */
  replaceRange(range: [number, number], text: string, source: WriteSource): void {
    this.apply([{ range, text }], source)
  }

  /**
   * Replace several non-overlapping ranges as ONE edit — one undo step. Used
   * for multi-cell drags (toggle several steps, then a single Ctrl-Z reverts
   * the whole gesture).
   */
  replaceRanges(edits: OffsetEdit[], source: WriteSource): void {
    this.apply(edits, source)
  }

  /** Insert text at an offset (zero-width edit). */
  insertAt(offset: number, text: string, source: WriteSource): void {
    this.apply([{ range: [offset, offset], text }], source)
  }

  /** Delete an offset range. */
  deleteRange(range: [number, number], source: WriteSource): void {
    this.apply([{ range, text: '' }], source)
  }

  /**
   * Freshness-guarded write. Re-reads the live model text and refuses the edit
   * if the chunk's statement no longer matches what it was detected from
   * (the doc changed under the panel). Returns true if applied, false if stale.
   * Prefer this over the raw methods on any path that can race a typed edit.
   */
  applyFresh(chunk: ChunkInfo, edits: OffsetEdit[], source: WriteSource): boolean {
    const model = this.editor.getModel()
    if (!model) return false
    if (!isChunkFresh(model.getValue(), chunk)) return false
    this.apply(edits, source)
    return true
  }

  private apply(edits: OffsetEdit[], source: WriteSource): void {
    const model = this.editor.getModel()
    if (!model) return
    const normalized = normalizeEdits(edits)
    const ops: Monaco.editor.IIdentifiedSingleEditOperation[] = normalized.map((e) => {
      const start = model.getPositionAt(e.range[0])
      const end = model.getPositionAt(e.range[1])
      return {
        range: new this.monaco.Range(
          start.lineNumber,
          start.column,
          end.lineNumber,
          end.column,
        ),
        text: e.text,
        forceMoveMarkers: true,
      }
    })
    // Outside a gesture, bracket the batch with undo boundaries so it is its
    // own single undo step. Inside a gesture, skip the boundaries so every
    // edit between beginGesture/endGesture coalesces into ONE undo step.
    if (!this.inGesture) model.pushStackElement()
    this.writingSource = source
    try {
      model.pushEditOperations([], ops, () => null)
    } finally {
      this.writingSource = null
    }
    if (!this.inGesture) model.pushStackElement()
    // Live visual editing: a committed mutation should be audible immediately
    // while playing. A single (non-gesture) edit re-evals now; a gesture's many
    // edits coalesce into ONE re-eval on `endGesture`.
    if (this.inGesture) this.gestureDidEdit = true
    else this.requestLiveReeval()
  }

  /**
   * Ask the app to re-evaluate the EDITED file so a visual mutation is audible
   * the moment it commits. Centralised here so every visual surface — sequencer,
   * piano roll, knobs, mixer — goes live from ONE place, not per panel. The app
   * re-evals only a PLAYING file, and only when live mode isn't already doing
   * it, so this never auto-starts audio nor double-evaluates.
   *
   * Trailing-debounced: rapid successive commits (e.g. clearing several
   * sequencer steps in a row) coalesce into ONE re-eval shortly after the last,
   * which also lets the Monaco→file-store sync settle so the re-eval reads the
   * final content rather than racing a not-yet-synced edit.
   */
  private requestLiveReeval(): void {
    if (this.reevalTimer) clearTimeout(this.reevalTimer)
    this.reevalTimer = setTimeout(() => {
      this.reevalTimer = null
      requestReeval(getFileIdForEditor(this.editor))
    }, REEVAL_DEBOUNCE_MS)
  }
}
