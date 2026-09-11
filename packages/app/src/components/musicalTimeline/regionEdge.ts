/**
 * regionEdge.ts — grabbing the edge of a sample mark to trim what it plays (#1527).
 *
 * The timeline already DRAWS the slice a mark plays (#1512). This is the hit
 * test and the drag arithmetic for changing it: grab the left edge to move
 * `begin`, the right edge to move `end`.
 *
 * PURE, and deliberately a third consumer of `laneMarkBands` + `markRect`
 * rather than a second opinion about where a mark sits. Those two are already
 * shared by the base draw and the live overlay so a lit mark lands exactly on
 * its base mark (PV120); a hit test that recomputed the geometry would drift
 * from both, and the symptom would be a grab band that misses the mark it is
 * drawn over by a pixel or two — which reads as "the gesture is fiddly" rather
 * than as a bug.
 */
import type { SceneLane, SceneNote } from './timelineScene'
import type { LaneLayout } from './laneLayout'
import { laneMarkBands, markRect } from './drawTimeline'

/** Which end of the region an edge grabs. Matches the editor's `RegionControl`. */
export type RegionSide = 'begin' | 'end'

/**
 * How close to a mark's edge the pointer must be, in px.
 *
 * Smaller than the song canvas's `CLIP_EDGE_GRIP_PX` band on purpose: a clip
 * edge is a lane-height target with nothing else nearby, while a mark's two
 * edges may be only a few pixels apart, and a grip wide enough to be generous
 * is wide enough for the two ends of one mark to claim the same pixel.
 */
export const REGION_EDGE_GRIP_PX = 4

/**
 * The narrowest mark whose two edges are separately grabbable.
 *
 * Below this the grip bands would overlap and a grab would be a coin toss
 * between trimming the start and trimming the end — so narrow marks are simply
 * not edge-targets. `2 * grip + 2` is the exact width at which the bands stop
 * touching, derived rather than picked, so it stays correct if the grip changes.
 */
export const MIN_REGION_EDGE_W = 2 * REGION_EDGE_GRIP_PX + 2

/**
 * The pointer travel, in px, that sweeps a region edge across the WHOLE file.
 *
 * ⚠ THE SCALE IS THE FILE, NOT THE CURRENT SLICE. Scaling to the slice
 * (`(end - begin) / width`) looks more natural for one drag and is a ratchet
 * across several: each trim shrinks the slice, which shrinks the scale, so the
 * gesture gets finer every time and the far end of the file becomes
 * unreachable. Mapping travel to the file keeps every drag the same
 * sensitivity, in both directions, however trimmed the mark already is.
 *
 * The floor matters because a mark is as wide as its NOTE, not as its audio: at
 * an ordinary zoom a sixteenth-note mark is a few px, and 1/8th of the file per
 * pixel is not a control. So a narrow mark still gets this much sweep, and the
 * drag simply extends past the mark's own edges — which is what the pointer
 * capture is for.
 */
export const REGION_DRAG_SPAN_PX = 160

/** A grabbed mark edge, with everything the drag needs frozen at pointer-down. */
export interface RegionEdgeHit {
  readonly laneKey: string
  /** The mark under the pointer. Carried for its `voice` and `region`. */
  readonly note: SceneNote
  readonly side: RegionSide
  /** The mark's rect, in the same space `drawTimeline` drew it in. */
  readonly rect: { readonly x: number; readonly y: number; readonly w: number; readonly h: number }
  /**
   * File-fraction per pixel of pointer travel. Fixed here, at pointer-down, and
   * never re-derived during the drag — see `REGION_DRAG_SPAN_PX`.
   */
  readonly fractionPerPx: number
}

export interface RegionEdgeQuery {
  readonly lanes: readonly SceneLane[]
  readonly layout: LaneLayout
  /** Pointer X in the same space `toScreenX` answers in (scroll already applied). */
  readonly screenX: number
  /** Pointer Y in layout/content space (scrollTop already added). */
  readonly contentY: number
  readonly pxPerCycle: number
  readonly viewportWidth: number
  readonly firstCycle: number
  readonly lastCycle: number
  readonly toScreenX: (cycle: number) => number
}

/**
 * The mark edge under the pointer, or null.
 *
 * Restricted to EXPANDED lanes. Not a convenience — a collapsed lane draws its
 * marks 4px tall in a row a few px high, where the waveform this gesture trims
 * is not drawn at all (`MIN_WAVEFORM_H`), so there is nothing on screen to aim
 * at. Offering an invisible grab band is how a gesture becomes "sometimes it
 * does something".
 *
 * Restricted to marks with a `voice`. A null-`s` mark is a synth note: it has no
 * sample file, so it has no region and `.begin` on it means nothing.
 */
export function regionEdgeAt(q: RegionEdgeQuery): RegionEdgeHit | null {
  const { lanes, layout, screenX, contentY } = q
  let best: RegionEdgeHit | null = null
  let bestDist = REGION_EDGE_GRIP_PX
  lanes.forEach((lane, idx) => {
    const box = layout.boxes[idx]
    if (!box || !box.expanded || box.height <= 0) return
    if (contentY < box.top || contentY >= box.top + box.height) return
    for (const band of laneMarkBands(lane, box)) {
      for (const note of band.notes) {
        if (note.voice == null) continue // a synth note has no file to trim
        const rect = markRect(
          note,
          band,
          q.pxPerCycle,
          q.viewportWidth,
          q.firstCycle,
          q.lastCycle,
          q.toScreenX,
        )
        if (!rect) continue
        if (rect.w < MIN_REGION_EDGE_W) continue // the two grips would overlap
        // The mark's own vertical band, so a grab lands on the mark the pointer
        // is over rather than on one in a neighbouring sub-row at the same x.
        if (contentY < rect.y || contentY >= rect.y + rect.h) continue
        // ⚠ THE GRIP BANDS LIE INSIDE THE MARK, NOT ACROSS ITS EDGES, and that
        // is what makes the gesture work where two marks touch. A band centred
        // on each edge makes the `2 * grip` pixels around every internal
        // boundary claim BOTH the earlier mark's `end` and the later one's
        // `begin`; the scan resolves that to one of them, and half the time the
        // answer is a `begin` already at 0, where dragging left clamps to 0 and
        // commits nothing. A gesture that silently does nothing on a common
        // pixel reads as broken, not as ambiguous. Inside-only bands leave a
        // single genuinely-tied pixel at the join instead of eight.
        for (const [side, dist] of [
          ['begin', screenX - rect.x],
          ['end', rect.x + rect.w - screenX],
        ] as const) {
          if (dist < 0 || dist > bestDist) continue
          bestDist = dist
          best = {
            laneKey: lane.laneKey,
            note,
            side,
            rect,
            fractionPerPx: 1 / Math.max(rect.w, REGION_DRAG_SPAN_PX),
          }
        }
      }
    }
  })
  return best
}

/**
 * What the mark currently plays for one edge, as the ENGINE resolved it.
 *
 * This is the value the document's text must agree with before a trim is
 * allowed to write — see `regionAnchorAgrees`. superdough's defaults
 * (`sampler.mjs:67`) stand in for a mark with no region controls at all.
 */
export function markRegionValue(note: SceneNote, side: RegionSide): number {
  const r = note.region
  if (!r) return side === 'begin' ? 0 : 1
  return side === 'begin' ? r.begin : r.end
}

/**
 * Does the chunk the lane anchor resolved to actually own this mark's region?
 *
 * ⚠ THIS GUARD EXISTS BECAUSE THE ANCHOR IS SOMETIMES WRONG, MEASURED RATHER
 * THAN FEARED. A lane's `sourceOffset` is its innermost CONTENT anchor, and for
 * every direct spelling — `$: s("take").begin(0.1)`, a named track, a long
 * chain, a region written inside the `const` — it lands on the expression that
 * carries the region. For one real spelling it does not:
 *
 *     const vox = s("take_1")
 *     $: vox.begin(0.1)
 *
 * There the anchor resolves to the CONST's right-hand side, whose chain has no
 * `.begin` at all. Trimming through it would append a second `.begin` to the
 * binding — which the outer one then overrides, so the document changes, a
 * shared binding is edited, and the sound does not move. Silent, and wrong in
 * the two ways that are hardest to notice together.
 *
 * The check that catches it needs nothing new: the engine already told the mark
 * what it plays, and the text already says what it writes. If those disagree,
 * the anchor is pointing somewhere else and the trim must decline. Comparing
 * both ends rather than only the one being dragged is deliberate — a document
 * can agree about `begin` and disagree about `end`, and the clamp reads both.
 *
 * `docValue` is the chunk's reading: a number, `'absent'` (writable — the
 * control is unwritten and superdough's default applies), or null (patterned,
 * which this cannot compare and the caller refuses anyway).
 */
export function regionAnchorAgrees(
  played: number,
  side: RegionSide,
  docValue: number | 'absent' | null,
): boolean {
  if (docValue === null) return false // patterned — nothing to agree with
  if (!Number.isFinite(played)) return false
  const written = docValue === 'absent' ? (side === 'begin' ? 0 : 1) : docValue
  // The engine's value is a float it computed; the document's is one somebody
  // typed. A tolerance of half `knobRanges`' step for these controls is the
  // widest that still cannot confuse two values a user could mean.
  return Math.abs(played - written) < 0.005
}

/**
 * Map a pointer travel in pixels to a new value for one region edge.
 *
 * ⚠ THE SCALE IS THE CALLER'S, FIXED AT POINTER-DOWN. `fractionPerPx` must come
 * from the `RegionEdgeHit` captured when the drag started, never be re-derived
 * per move: re-deriving it against the shrinking slice makes the edge
 * accelerate away from the cursor, and the same physical drag then means
 * different amounts depending on how it was paced. Same reason the song
 * canvas's clip trim captures `origWeight` at pointer-down.
 *
 * ⚠ IT LIVES HERE, NOT WITH THE WRITE DECISION IN `@stave/editor`. It was
 * written there first, next to `regionTrimEdit`, which forced `FullSongTimeline`
 * to import a new symbol from the editor barrel — and every test that mocks
 * that barrel then handed the call site `undefined`, invisibly to tsc because a
 * `vi.mock` factory is untyped. Four arms went red. The fix is not to widen the
 * mock: this is drag GEOMETRY, and it belongs beside the hit test that produces
 * its scale. The editor owns what to write; this file owns where the pointer is.
 */
export function regionValueAtDrag(
  startValue: number,
  deltaPx: number,
  fractionPerPx: number,
): number {
  if (!Number.isFinite(startValue) || !Number.isFinite(deltaPx)) return startValue
  if (!Number.isFinite(fractionPerPx) || fractionPerPx <= 0) return startValue
  return startValue + deltaPx * fractionPerPx
}
