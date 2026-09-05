/**
 * useGridModel — model-in-state binding shared by the grid panels (Sequencer,
 * Piano Roll).
 *
 * Both panels parse the chunk's mini-notation into a structured model, edit it,
 * and write the serialized result back over the mini range. The model is held
 * in component state rather than derived per-render so structure the user
 * clears (an emptied lane, a deleted note) survives — its serialized form may
 * omit it, but the editable scaffold stays. The model is reseeded only on
 * EXTERNAL edits, detected by comparing what we'd serialize against the
 * incoming source; the panel's own write-back echoes leave it untouched.
 *
 * `mutate(fn)` runs a pure transform against the latest model (synchronous, so
 * a fast drag reads its own prior edits), then writes the serialized result.
 * A transform whose serialization is inexpressible in the subset (serialize →
 * null) is dropped, leaving the document untouched.
 *
 * VELOCITY (the second write-back range): a panel may also carry a `.gain("…")`
 * mini that runs PARALLEL to the head mini — per-column velocity (#409). When
 * `serializeGain`/`applyGain` are supplied, every `mutate` writes the mini AND
 * the coordinated gain edit (replace an existing string `.gain` arg, insert
 * `.gain("…")` after the expression, or remove our `.gain` when all-neutral) as
 * ONE `replaceRanges` — a single undo step. The model is reseeded when EITHER
 * the mini OR the `.gain` changes externally. We only ever touch a `.gain`
 * whose arg is a grid-aligned string we authored; a numeric `.gain(0.8)` knob
 * or an unaligned/broadcast `.gain("0.8")` is left byte-identical.
 *
 * Built on `useActiveChunk` (the active-editor → chunk → writeback layer).
 */
import * as React from 'react'

import type { ChunkInfo } from '../chunkDetect'
import type { ChunkGain, GainWrite, ParseResult } from '../notation/model'
import { UNREFINED, absorbViewScale, type ViewScale } from '../notation/viewResolution'
import type { OffsetEdit, WriteSource } from '../writeback'
import { useActiveChunk } from './useActiveChunk'

export interface GridModelOptions<M> {
  /** writeback source tag for this panel's edits */
  source: WriteSource
  /** does this chunk belong to this panel? (head function / shape gate) */
  eligible: (chunk: ChunkInfo) => boolean
  parse: (mini: string, viewScale: ViewScale) => ParseResult<M>
  /**
   * How finely to DRAW the chunk (#1057). A change here re-parses at the new scale
   * and writes nothing — that is the free zone's whole mechanism. Defaults to the
   * document's own resolution, so a panel that never sets it behaves as before.
   */
  viewScale?: ViewScale
  /**
   * Called after a write-back has actually SPELLED the refinement, so the panel can
   * drop it: the document now says what was drawn (`absorbViewScale`). Not called
   * when the transform declined or the result was inexpressible — nothing was
   * written — and not called when the write was expressible at the document's own
   * resolution, because then the document's spelling did not change and the user's
   * view must stay where they put it (see `collapseToDocument`).
   */
  onViewScaleConsumed?: () => void
  /**
   * Express a model drawn at a finer view at the DOCUMENT's own resolution, or
   * `null` when the edit really used a column the document does not have (#1057).
   *
   * A write consults this FIRST, so that only a write which NEEDS the finer
   * spelling respells the file. Omitting it restores the previous behaviour —
   * every write spells what was drawn — which is what keeps a caller that never
   * refines behaving exactly as it did.
   */
  collapseToDocument?: (model: M) => M | null
  /** model → mini, or null when the model can't be expressed in the subset */
  serialize: (model: M) => string | null
  /**
   * Read an existing `.gain` (scalar or per-column) onto the freshly-parsed
   * model. Omit to opt the panel out of velocity entirely.
   */
  applyGain?: (model: M, gain: ChunkGain) => M
  /** model → what to do with the `.gain` method (write / clear / skip) */
  serializeGain?: (model: M) => GainWrite
}

export interface GridModel<M> {
  model: M | null
  chunk: ChunkInfo | null
  /** transform the model and write the serialized result over the mini range */
  mutate: (fn: (model: M) => M) => void
  /**
   * Write `model` over the mini range UNCONDITIONALLY — no live-model guard, no
   * identity short-circuit (#1453).
   *
   * `mutate` is a transform OF the current model, so it correctly declines when
   * there is no current model and when the transform changed nothing. A gesture's
   * commit-time settle is a different question: the gesture already knows the model
   * it started from, and it is asserting what the document must now hold. Routing
   * that through `mutate` made it silently skippable — a mid-drag frame can leave
   * the document unparseable, which nulls the live model, which made `mutate`
   * return before running the callback that computes the refusal. The gate was
   * disabled by the write it exists to undo.
   */
  settle: (model: M) => void
  beginGesture: () => void
  endGesture: () => void
}

/**
 * Read a chunk's `.gain` argument into a normalized `ChunkGain`:
 *   - no `.gain`            → { mini:null, numeric:null, foreign:false }
 *   - scalar `.gain(0.4)`   → { numeric:0.4 }   (a uniform base — velocity reads it)
 *   - string `.gain("…")`   → { mini:inner }    (per-column; applyGain checks alignment)
 *   - any other arg         → { foreign:true }  (a signal/expr — hands off)
 */
function readChunkGain(chunk: ChunkInfo): ChunkGain {
  const call = chunk.chain.find((c) => c.name === 'gain')
  const arg = call?.args[0]
  if (!call || !arg) return { mini: null, numeric: null, foreign: false }
  if (arg.numeric !== null) return { mini: null, numeric: arg.numeric, foreign: false }
  if (/^["'`]/.test(arg.raw)) return { mini: arg.raw.slice(1, -1), numeric: null, foreign: false }
  return { mini: null, numeric: null, foreign: true } // some other expression
}

/** is the `.gain` arg one velocity manages (a scalar number or a string)? */
function managedGainArg(chunk: ChunkInfo): { call: ChunkInfo['chain'][number]; argRange: [number, number] } | null {
  const call = chunk.chain.find((c) => c.name === 'gain')
  const arg = call?.args[0]
  if (!call || !arg) return null
  if (arg.numeric !== null || /^["'`]/.test(arg.raw)) return { call, argRange: arg.range }
  return null
}

/** the gain edits for one `mutate`, given the model's `GainWrite` intent */
function gainEdits(fresh: ChunkInfo, g: GainWrite): OffsetEdit[] {
  if (g.kind === 'skip') return []
  const managed = managedGainArg(fresh)
  if (g.kind === 'clear') {
    // remove ONLY a `.gain` we manage (scalar/string); absent/foreign → nothing
    return managed ? [{ range: managed.call.range, text: '' }] : []
  }
  const lit = g.quoted ? `"${g.value}"` : g.value
  // replace the whole managed arg in place (swaps scalar↔string as needed)…
  if (managed) return [{ range: managed.argRange, text: lit }]
  // …else append `.gain(…)` after the expression (the Mixer's quick-transform idiom)
  return [{ range: [fresh.exprRange[1], fresh.exprRange[1]], text: `.gain(${lit})` }]
}

/** does prev's gain intent already match the chunk's current `.gain`? */
function gainUnchanged(g: GainWrite, cur: ChunkGain): boolean {
  if (g.kind === 'skip') return true // not managing it → never force a reseed
  if (g.kind === 'clear') return cur.mini === null && cur.numeric === null
  return g.quoted ? cur.mini === g.value : cur.numeric !== null && cur.numeric === parseFloat(g.value)
}

export function useGridModel<M extends { viewScale?: ViewScale }>(
  opts: GridModelOptions<M>,
): GridModel<M> {
  const { chunk, applyEdit, beginGesture, endGesture } = useActiveChunk()
  const [model, setModel] = React.useState<M | null>(null)
  // Mirror for synchronous reads inside pointer handlers / rapid drags.
  const modelRef = React.useRef<M | null>(null)
  React.useEffect(() => {
    modelRef.current = model
  }, [model])

  // opts is recreated each render; keep the latest in a ref so the reconcile
  // effect can depend on `chunk` alone.
  const optsRef = React.useRef(opts)
  optsRef.current = opts

  // Read off the LIVE opts rather than the ref: this one has to be a real
  // dependency, because changing how finely we draw is precisely a reason to
  // re-parse (#1057) and a ref would swallow it.
  const viewScale = opts.viewScale ?? UNREFINED
  // The scale the retained model was actually built at. Without it a scale change
  // could keep the previous model whenever it happened to serialize back to the
  // source — retaining a ×2 model for a ×1 view, with no error anywhere.
  const modelScaleRef = React.useRef<ViewScale>(UNREFINED)

  React.useEffect(() => {
    const o = optsRef.current
    if (!chunk || chunk.miniString === null || !o.eligible(chunk)) {
      modelRef.current = null
      setModel(null)
      return
    }
    const parsed = o.parse(chunk.miniString, viewScale)
    if (!parsed.ok) {
      modelRef.current = null
      setModel(null)
      return
    }
    const chunkGain = readChunkGain(chunk)
    const fresh = o.applyGain ? o.applyGain(parsed.model, chunkGain) : parsed.model

    // Keep the in-progress model only when the mini, the `.gain` AND the scale it
    // was drawn at all still match; any external change to either — or any change
    // to how finely we are drawing — reseeds.
    const prev = modelRef.current
    // ASKED THE WAY THE WRITE ASKS IT. A refined model does not serialize to the
    // document's bytes — it serializes to the drawn spelling — so comparing it
    // directly would call every refined model "changed" and reseed on every frame
    // of a velocity drag. The honest question is the one `mutate` answers: what
    // would this model WRITE? (#1057)
    const asWritten = prev == null ? null : (o.collapseToDocument?.(prev) ?? prev)
    const sameMini = asWritten != null && o.serialize(asWritten) === chunk.miniString
    const sameGain =
      prev == null || !o.serializeGain
        ? true
        : gainUnchanged(o.serializeGain(prev), chunkGain)
    const sameScale = modelScaleRef.current === viewScale
    const next = prev && sameMini && sameGain && sameScale ? prev : fresh
    modelScaleRef.current = viewScale
    modelRef.current = next
    setModel(next)
  }, [chunk, viewScale])

  /**
   * The write half, shared by `mutate` and `settle` — everything from "what
   * resolution should this spell" down to the edit. Holds no opinion about whether
   * the write SHOULD happen; its callers decide that, and they decide it
   * differently (#1453).
   */
  const writeModel = React.useCallback(
    (next: M): void => {
      const o = optsRef.current
      // WHAT RESOLUTION SHOULD THIS WRITE SPELL? Only an edit that used a column
      // the document does not have needs the finer one; a velocity drag does not,
      // and respelling for it rewrites the file to record how closely someone was
      // looking (#1057). Asked once, here, rather than per op — and asked of the
      // real ÷k guard rather than predicted, the same discipline `slotState` uses.
      const atDocument = o.collapseToDocument ? o.collapseToDocument(next) : null
      const spellsRefinement = atDocument === null
      const toWrite = atDocument ?? next
      const mini = o.serialize(toWrite)
      if (mini == null) return // inexpressible — leave the document untouched
      // The refinement is absorbed ONLY when the write actually spelled it. When
      // the write went out at the document's own resolution the file's spelling
      // did not change, so the marker and the panel's scale both stay put — and
      // the model on screen stays the one the user is looking at.
      const written = spellsRefinement ? absorbViewScale(next) : next
      if (spellsRefinement) modelScaleRef.current = UNREFINED
      modelRef.current = written
      setModel(written)
      if (spellsRefinement) o.onViewScaleConsumed?.()
      applyEdit((fresh, wb) => {
        if (!fresh.miniRange) return
        const edits: OffsetEdit[] = [{ range: fresh.miniRange, text: mini }]
        // ⚠ THE SAME MODEL as the mini. These read `next` and `toWrite` separately
        // once, and the gain mini was widened to the drawn column count while the
        // notation was not — two ranges disagreeing about the document's resolution.
        if (o.serializeGain) edits.push(...gainEdits(fresh, o.serializeGain(toWrite)))
        // One pushEditOperations → the mini and its `.gain` are one undo step.
        wb.replaceRanges(edits, o.source)
      })
    },
    [applyEdit],
  )

  const mutate = React.useCallback(
    (fn: (m: M) => M): void => {
      const prev = modelRef.current
      if (prev == null) return
      const next = fn(prev)
      if (next === prev) return
      writeModel(next)
    },
    [writeModel],
  )

  /** See {@link GridModel.settle}. Deliberately skips both of `mutate`'s guards. */
  const settle = React.useCallback((next: M): void => writeModel(next), [writeModel])

  return { model, chunk, mutate, settle, beginGesture, endGesture }
}
