/**
 * collectNoteMarks — eval-backed DISPLAY marks (#861).
 *
 * The Song timeline's note marks must come from the EVALUATED haps, not the
 * static IR: the IR carries the raw source token (`note:"0"` for `n("0 2 4")`)
 * and drops `.scale`, so IR-read pitch is null → a flat pitchless bar (P274).
 * The evaluated hap carries the RESOLVED note (`"C3"`), which `extractPitch`
 * parses directly — no scale/degree logic needed.
 *
 * `collectNoteMarks` pulls the runtime `collectCycles`/`laneKeyOf` from
 * `@stave/editor` (a CJS-`gifenc`-laden barrel), so — mirroring
 * FullSongTimeline.test.tsx — we mock just those two. The IR events the mock
 * returns deliberately carry a BARE-INTEGER `note` (`"0"`), which is exactly
 * the case the static IR gets wrong; the eval events carry note NAMES. So a
 * pitched mark can ONLY come from the eval path, making the two paths
 * distinguishable in the assertions below.
 */
import { describe, it, expect, vi } from 'vitest'

// IR events (what `collectCycles` returns) — TWO `$:` lanes:
//   d1 at statement offset (dollarPos) 0, its mini-notation at chars [10,20]
//   d2 at statement offset 30,            its mini-notation at chars [40,50]
// `note:"0"` is the P274 symptom: extractPitch rejects a bare int → pitch null.
const { IR_EVENTS } = vi.hoisted(() => ({
  IR_EVENTS: [
    { begin: 0, end: 1, trackId: 'd1', dollarPos: 0, note: '0', loc: [{ start: 10, end: 20 }] },
    { begin: 0, end: 1, trackId: 'd2', dollarPos: 30, note: '0', loc: [{ start: 40, end: 50 }] },
  ],
}))
vi.mock('@stave/editor', async () => {
  // #974 — lane STRUCTURE (incl. `labelOffsetByLane`, the containment anchors these tests
  // exercise) now comes from `structuralWalk`, not collect events. Reduce the SAME IR_EVENTS
  // through the REAL production reducer so d1/d2 keep their dollarPos anchors (PV192).
  const { skeletonsFromEvents, wholeWalkWindow } = await import('./structuralWalkTestStub')
  return {
    structuralWalk: (_ir: unknown, window: { originCycle: number; spanCycles: number }) =>
      skeletonsFromEvents(IR_EVENTS, window),
    wholeWalkWindow,
    laneKeyOf: (ev: { trackId?: string; s?: string }) => ev?.trackId ?? ev?.s ?? '$default',
  }
})

import { collectNoteMarks } from '../timelineMarks'
import { wholeSongWindow } from '../songAxis'

// C3 = 48, E3 = 52, G3 = 55 (C4 = 60 convention, per pitch.ts).
const C3 = 48
const E3 = 52

describe('collectNoteMarks — eval-backed marks (#861)', () => {
  it('derives pitched marks from the eval haps (resolved note names)', () => {
    // One hap per lane, note already RESOLVED by Strudel (as `n().scale()`
    // would yield). trackId is `$0`/`$1` (the eval scheme) — DIFFERENT from the
    // IR lane keys `d1`/`d2`, to prove attribution is NOT trackId equality.
    const haps = [
      { begin: 0, end: 0.5, trackId: '$0', note: 'C3', gain: 1, loc: [{ start: 12, end: 14 }] },
      { begin: 0.5, end: 1, trackId: '$1', note: 'E3', gain: 1, loc: [{ start: 42, end: 44 }] },
    ] as unknown as Parameters<typeof collectNoteMarks>[0]

    const marks = collectNoteMarks(haps, { fake: true } as never, wholeSongWindow(4))

    // Containment: hap at char 12 → largest dollarPos ≤ 12 is 0 → lane d1;
    // hap at char 42 → largest ≤ 42 is 30 → lane d2.
    const d1 = marks.marksByLane.get('d1')
    const d2 = marks.marksByLane.get('d2')
    expect(d1).toHaveLength(1)
    expect(d2).toHaveLength(1)
    expect(d1![0].pitch).toBe(C3)
    expect(d2![0].pitch).toBe(E3)
  })

  it('attributes haps by source containment across two lanes, not trackId', () => {
    // Both haps carry trackId `$9` (matching NEITHER IR lane) — pure containment
    // decides. Char 15 is inside d1's statement (dollarPos 0, before d2's 30);
    // char 45 is past d2's statement start (30).
    const haps = [
      { begin: 0, end: 0.5, trackId: '$9', note: 'C3', gain: 1, loc: [{ start: 15, end: 17 }] },
      { begin: 0, end: 0.5, trackId: '$9', note: 'E3', gain: 1, loc: [{ start: 45, end: 47 }] },
    ] as unknown as Parameters<typeof collectNoteMarks>[0]

    const marks = collectNoteMarks(haps, { fake: true } as never, wholeSongWindow(4))

    expect(marks.marksByLane.get('d1')?.map((n) => n.pitch)).toEqual([C3])
    expect(marks.marksByLane.get('d2')?.map((n) => n.pitch)).toEqual([E3])
  })

  it('routes a loc-less hap to its OWN eval lane by trackId, not a default IR lane (#864)', () => {
    // A sampled-signal hap carries NO loc → un-attributable by containment. P1b
    // routes it to an EVAL lane keyed by its producer id (`$1` → `d2`), NOT the
    // first IR lane — so it neither vanishes nor pollutes an unrelated lane.
    const haps = [
      { begin: 0, end: 1, trackId: '$1', note: 'C3', gain: 1 },
    ] as unknown as Parameters<typeof collectNoteMarks>[0]

    const marks = collectNoteMarks(haps, { fake: true } as never, wholeSongWindow(4))

    // Its own eval lane `d2` (`$1` → d{1+1}); the IR lanes d1/d2 got no marks
    // (d2 here is the EVAL lane, disjoint from any IR lane — the mock IR has
    // events only under d1/d2 keys, but this hap has no loc so it can't attach).
    expect(marks.marksByLane.get('d2')?.map((n) => n.pitch)).toEqual([C3])
    // Not routed to the first IR lane (the old default-lane pollution bug).
    expect(marks.marksByLane.get('d1')).toBeUndefined()
  })

  it('keys a named-producer eval lane by the name verbatim (#864)', () => {
    // An un-attributable hap from a NAMED producer (no loc) → eval lane keyed by
    // the name, not a positional `d{N}` — mirroring `trackIdFromLabel`.
    const haps = [
      { begin: 0, end: 1, trackId: 'bass', note: 'E3', gain: 1 },
    ] as unknown as Parameters<typeof collectNoteMarks>[0]

    const marks = collectNoteMarks(haps, { fake: true } as never, wholeSongWindow(4))

    expect(marks.marksByLane.get('bass')?.map((n) => n.pitch)).toEqual([E3])
  })

  it('produces no marks pre-eval (structure only) — the collect fallback was removed (#975)', () => {
    // Pre-eval: `events` is null → no eval haps, and the pre-eval `collectCycles`
    // fallback was removed with the collect interpreter (#975). So a lane draws
    // its STRUCTURE but carries no marks until eval fills them (#978), instead of
    // the old source-lossy IR marks.
    const marks = collectNoteMarks(null, { fake: true } as never, wholeSongWindow(4))

    expect(marks.marksByLane.get('d1')).toBeUndefined()
    expect(marks.marksByLane.get('d2')).toBeUndefined()
    // Structure is still walk-derived — both lanes anchored by their label offset.
    expect(marks.labelOffsetByLane.get('d1')).toBe(0)
    expect(marks.labelOffsetByLane.get('d2')).toBe(30)
  })

  it('keeps structure (label offsets) IR-derived even on the eval path', () => {
    const haps = [
      { begin: 0, end: 0.5, trackId: '$0', note: 'C3', gain: 1, loc: [{ start: 12, end: 14 }] },
    ] as unknown as Parameters<typeof collectNoteMarks>[0]

    const marks = collectNoteMarks(haps, { fake: true } as never, wholeSongWindow(4))

    // dollarPos (label offset) comes from the IR, regardless of the mark source.
    expect(marks.labelOffsetByLane.get('d1')).toBe(0)
    expect(marks.labelOffsetByLane.get('d2')).toBe(30)
  })
})

// ---------------------------------------------------------------------------
// #1512 — the region rides from the runtime hap onto the mark.
//
// The values below are not invented. Each is what the real runtime was MEASURED
// to put on `hap.value` for the spelling named in the comment, so these arms pin
// the join between an engine that already resolved the region and a renderer
// that had been discarding it.
// ---------------------------------------------------------------------------
describe('collectNoteMarks — the played region (#1512)', () => {
  /** One sample hap on lane d1, carrying whatever `params` it is given. */
  function hapWith(params: Record<string, unknown> | undefined) {
    return [
      { begin: 0, end: 1, trackId: '$0', s: 'take_1', gain: 1, loc: [{ start: 12, end: 14 }], params },
    ] as unknown as Parameters<typeof collectNoteMarks>[0]
  }

  function markFor(params: Record<string, unknown> | undefined) {
    const marks = collectNoteMarks(hapWith(params), { fake: true } as never, wholeSongWindow(4))
    const lane = marks.marksByLane.get('d1')
    expect(lane).toHaveLength(1)
    return lane![0]
  }

  it('leaves a plain take with no region at all', () => {
    // Absence is the signal that the mark plays the whole file, and it must stay
    // distinguishable from an explicit whole-file region at the call site.
    expect(markFor(undefined).region).toBeUndefined()
  })

  it('ignores params that say nothing about the region', () => {
    // A hap carrying reverb and cutoff is still a plain take.
    expect(markFor({ room: 0.3, cutoff: 800, delay: 0.2 }).region).toBeUndefined()
  })

  it('carries a chop’s own quarter — measured from `.chop(4)`', () => {
    expect(markFor({ begin: 0.5, end: 0.75 }).region).toEqual({
      begin: 0.5,
      end: 0.75,
      speed: 1,
      unit: null,
    })
  })

  it('fills in superdough’s own defaults for whatever the hap omits', () => {
    // `.speed(2)` sets speed alone; the slice is still the whole file
    // (`sampler.mjs:67` defaults begin to 0 and end to 1).
    expect(markFor({ speed: 2 }).region).toEqual({ begin: 0, end: 1, speed: 2, unit: null })
  })

  it('carries the unit — measured from `.fit()` and `.loopAt(2)`', () => {
    expect(markFor({ speed: 1, unit: 'c' }).region!.unit).toBe('c')
    expect(markFor({ speed: 0.25, unit: 'c' }).region!.speed).toBe(0.25)
  })

  it('keeps `_slices` out — measured from `.slice(4, "0 2")`', () => {
    // `.slice()` adds a bookkeeping field playback never reads; `begin`/`end`
    // already say everything the shape needs.
    const region = markFor({ begin: 0, end: 0.25, _slices: 4 }).region!
    expect(Object.keys(region).sort()).toEqual(['begin', 'end', 'speed', 'unit'])
  })

  it('never reads a non-numeric region value', () => {
    // A patterned control that failed to resolve must not become a NaN width.
    expect(markFor({ begin: 'nonsense', end: null, speed: Number.NaN }).region).toBeUndefined()
  })

  it('does not confuse the region’s `end` with the mark’s own end IN TIME', () => {
    // The one collision worth an arm of its own: `SceneNote.end` is a song cycle
    // and `region.end` is a fraction of a file, and they share the word because
    // Strudel's controls do.
    const mark = markFor({ begin: 0.25, end: 0.5 })
    expect(mark.end).toBe(1) // the hap's own `end`, in cycles
    expect(mark.region!.end).toBe(0.5) // …and its slice's end, in the file
  })
})
