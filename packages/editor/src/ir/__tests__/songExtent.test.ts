import { describe, it, expect } from 'vitest'
import { IR, type PatternIR } from '../PatternIR'
import { songExtent } from '../songExtent'

const bd = IR.play('bd')
const arm = (weight: number, pattern: PatternIR = bd) => ({ weight, pattern })

/**
 * The second spelling of an arrangement (#1427): a weighted section timeline
 * driving `pickRestart`. `slots` are `[key, weight]`, and a `null` weight is an
 * unweighted slot — the distinction the narrow rule turns on.
 */
const timeline = (...slots: Array<[string, number | null]>): PatternIR =>
  IR.namedPick(
    IR.cycle(
      ...slots.map(([key, w]) =>
        w == null ? IR.play(key) : IR.elongate(w, IR.play(key)),
      ),
    ),
    [...new Set(slots.map(([key]) => key))].map((key) => ({ key, pattern: bd })),
    'pickRestart',
    '{}',
  )

describe('songExtent', () => {
  it('a document with no arrangement is a LOOP, not a zero-length song', () => {
    // The distinction the typed answer exists for: `0` cannot tell "ends
    // immediately" from "never ends". 96.7% of real documents land here.
    expect(songExtent(bd)).toEqual({ kind: 'loop' })
    expect(songExtent(IR.stack(bd, IR.play('sd')))).toEqual({ kind: 'loop' })
    expect(songExtent(null)).toEqual({ kind: 'loop' })
  })

  it('an arrangement is the SUM of its arm weights', () => {
    const ir = IR.arrange('arrange', [arm(4), arm(8), arm(16)])
    expect(songExtent(ir)).toEqual({ kind: 'arranged', cycles: 28 })
  })

  it('cat/slowcat arms weigh 1 each', () => {
    expect(songExtent(IR.arrange('cat', [arm(1), arm(1), arm(1)]))).toEqual({
      kind: 'arranged',
      cycles: 3,
    })
  })

  it('parallel tracks take the MAX, never the sum', () => {
    // Tracks sound together. Summing would report a 16-cycle document as 28.
    const a = IR.arrange('arrange', [arm(4), arm(8)]) // 12
    const b = IR.arrange('arrange', [arm(16)]) // 16
    expect(songExtent(IR.stack(a, b))).toEqual({ kind: 'arranged', cycles: 16 })
  })

  it('does NOT descend into arms — an arm TRUNCATES a longer inner arrangement', () => {
    // `arrange([2, pat])` plays 2 whole cycles of `pat` at its natural rate. An
    // 8-cycle arrangement inside a 2-cycle arm sounds for 2 cycles, so taking a
    // descending max would over-report by 4x.
    const inner = IR.arrange('arrange', [arm(8)])
    const outer = IR.arrange('arrange', [arm(2, inner)])
    expect(songExtent(outer)).toEqual({ kind: 'arranged', cycles: 2 })
  })

  it('Track and Loop are transparent', () => {
    const ir = IR.track('d1', IR.arrange('arrange', [arm(4), arm(4)]))
    expect(songExtent(ir)).toEqual({ kind: 'arranged', cycles: 8 })
  })

  it('slow() lengthens the arrangement and fast() shortens it', () => {
    const a = IR.arrange('arrange', [arm(4), arm(4)]) // 8
    expect(songExtent(IR.slow(2, a))).toEqual({ kind: 'arranged', cycles: 16 })
    expect(songExtent(IR.fast(4, a))).toEqual({ kind: 'arranged', cycles: 2 })
  })

  it('a degenerate scaling factor is ignored rather than propagated as NaN', () => {
    // A NaN extent reaching the modal is a truncation with no symptom.
    const a = IR.arrange('arrange', [arm(8)])
    expect(songExtent(IR.slow(0, a))).toEqual({ kind: 'arranged', cycles: 8 })
    expect(songExtent(IR.fast(Number.NaN, a))).toEqual({ kind: 'arranged', cycles: 8 })
  })

  it('an arrangement under an unparsed transform is OPAQUE, not measured', () => {
    // The Code node may be a time-scaling method Stave could not read. Reporting
    // its Σweight would silently truncate the bounce. Measured on the real
    // corpus: 3 of the 5 arranged documents are in exactly this shape.
    const a = IR.arrange('arrange', [arm(4), arm(4)])
    const opaque: PatternIR = {
      tag: 'Code',
      code: '.someUnknownMethod(2)',
      lang: 'strudel',
      via: { method: 'someUnknownMethod', args: '2', callSiteRange: [0, 0], inner: a },
    }
    expect(songExtent(opaque)).toEqual({ kind: 'opaque' })
  })

  it('one tainted arrangement invalidates the whole MAX', () => {
    // The result is a max, so an unmeasurable arm could be the longest one.
    // Being wrong towards `opaque` costs nothing; towards `arranged` it truncates.
    const clean = IR.arrange('arrange', [arm(4)])
    const dirty: PatternIR = {
      tag: 'Code',
      code: '.x()',
      lang: 'strudel',
      via: { method: 'x', args: '', callSiteRange: [0, 0], inner: IR.arrange('arrange', [arm(4)]) },
    }
    expect(songExtent(IR.stack(clean, dirty))).toEqual({ kind: 'opaque' })
  })

  // ── the second spelling of an arrangement (#1427) ─────────────────────────
  //
  // `pickControl/` already parses this form, draws it on the timeline and writes
  // edits back byte-verbatim. The song layer then declined to call it a song, so
  // it got no end, no Cycle/Loop toggle and a bounce that did not know its length.

  it('two spellings of ONE song agree on its length', () => {
    // The whole issue in one assertion. Same 40-cycle piece, written both ways.
    const written = IR.arrange('arrange', [arm(4), arm(8), arm(8), arm(8), arm(8), arm(4)])
    const picked = timeline(
      ['~', 4], ['verse', 8], ['chorus', 8], ['verse', 8], ['chorus', 8], ['~', 4],
    )
    expect(songExtent(written)).toEqual({ kind: 'arranged', cycles: 40 })
    expect(songExtent(picked)).toEqual(songExtent(written))
  })

  it('an unweighted slot in a weighted timeline counts 1, as a cat arm does', () => {
    expect(songExtent(timeline(['verse', 8], ['tag', null], ['chorus', 8]))).toEqual({
      kind: 'arranged',
      cycles: 17,
    })
  })

  it('tracks with DIFFERENT section timelines take the max, never the sum', () => {
    // The question the issue left open, and the existing Stack rule answers it:
    // the piece is as long as its longest track. The fixture that motivated this
    // has every track summing to 40, so only a synthetic arm can tell max from
    // sum — 40 vs 76 here.
    const drums = timeline(['~', 4], ['verse', 8], ['chorus', 8], ['verse', 8], ['chorus', 8], ['~', 4])
    const keys = timeline(['pads', 12], ['chorus', 8], ['pads', 8], ['chorus', 8], ['pads', 4])
    expect(songExtent(IR.stack(drums, keys))).toEqual({ kind: 'arranged', cycles: 40 })
  })

  it('an UNWEIGHTED pick selector stays a loop — a bare alternation is not song form', () => {
    // `<verse chorus>.pickRestart(…)` says nothing about ending. Being wrong
    // towards `loop` costs nothing; being wrong towards `arranged` truncates.
    expect(songExtent(timeline(['verse', null], ['chorus', null]))).toEqual({ kind: 'loop' })
  })

  it('a weighted cycle that is NOT a pick selector stays a loop', () => {
    // The arm that keeps the scope narrow. 42 of the 150 corpus documents carry
    // an `Elongate`; they are melodies like `note("<[a3,c4,e4]@2 [g3,b3,d4]>")`,
    // and reading those as songs would hand a bounce a confident wrong length.
    const melody = IR.cycle(IR.elongate(2, IR.play('a3')), IR.play('g3'))
    expect(songExtent(melody)).toEqual({ kind: 'loop' })
    expect(songExtent(IR.stack(melody, bd))).toEqual({ kind: 'loop' })
  })

  it('a section timeline under an unparsed transform is OPAQUE, not measured', () => {
    // Same taint rule the `arrange` spelling gets: an unknown transform on the
    // path may scale time, so the length is found but not trusted.
    const picked = timeline(['verse', 8], ['chorus', 8])
    const wrapped: PatternIR = {
      tag: 'Code',
      code: '.someUnknownMethod(2)',
      lang: 'strudel',
      via: { method: 'someUnknownMethod', args: '2', callSiteRange: [0, 0], inner: picked },
    }
    expect(songExtent(wrapped)).toEqual({ kind: 'opaque' })
  })

  it('a Code node with NO arrangement under it stays a loop', () => {
    // `opaque` means "there is an arrangement we cannot measure". A document
    // that is merely unparseable and has no arrangement is still just a loop,
    // and the UI treats loop and opaque alike anyway.
    expect(songExtent(IR.code('wat()'))).toEqual({ kind: 'loop' })
  })
})
