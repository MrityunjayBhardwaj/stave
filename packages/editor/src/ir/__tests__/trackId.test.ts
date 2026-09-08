/**
 * trackId — the mute-invariant identity rule (#737).
 *
 * A muted track (`_` label prefix) must resolve to the SAME lane identity as its
 * unmuted self, so muting keeps a track in its place (and doesn't collapse every
 * anon `_$:` onto one lane). Guards the P235 trap: identity must strip `_` the
 * same way the DISPLAY deriver (`labelAtOffset`) already does.
 */
import { describe, it, expect } from 'vitest'
import { trackIdFromLabel, isMutedLabel } from '../trackId'
import { parseStrudel } from '../parseStrudel'
import type { PatternIR } from '../PatternIR'

function trackIds(ir: PatternIR): string[] {
  if (ir.tag === 'Stack') return ir.tracks.map((t) => (t.tag === 'Track' ? t.trackId : '?'))
  if (ir.tag === 'Track') return [ir.trackId]
  return []
}

describe('trackIdFromLabel — mute-invariant identity', () => {
  it('anon `$:` (bare or muted) keeps the positional `d{i+1}`', () => {
    expect(trackIdFromLabel('$', 0)).toBe('d1')
    expect(trackIdFromLabel('_$', 0)).toBe('d1') // muted anon → still positional, NOT '_$'
    expect(trackIdFromLabel('$', 1)).toBe('d2')
    expect(trackIdFromLabel('_$', 1)).toBe('d2')
  })

  it('named track: mute is invariant (same id muted or not)', () => {
    expect(trackIdFromLabel('drums', 0)).toBe('drums')
    expect(trackIdFromLabel('_drums', 0)).toBe('drums') // muted named → same lane, NOT '_drums'
  })

  it('undefined label falls to positional', () => {
    expect(trackIdFromLabel(undefined, 0)).toBe('d1')
  })
})

describe('parseStrudel — muted tracks keep their lane (#737 regression)', () => {
  it('two muted anon `$:` do NOT collapse into one lane', () => {
    // Without the `_`-strip both became trackId `_$` → ONE lane.
    expect(trackIds(parseStrudel('_$: s("bd")\n_$: s("hh")'))).toEqual(['d1', 'd2'])
  })

  it('a muted named track keeps its unmuted identity', () => {
    // Without the strip the muted track became `_drums` — a new lane.
    expect(trackIds(parseStrudel('drums: s("bd")\n_lead: s("hh")'))).toEqual(['drums', 'lead'])
  })

  it('mixed muted/unmuted anon stay in their positional slots', () => {
    expect(trackIds(parseStrudel('$: s("bd")\n_$: s("hh")\n$: s("cp")'))).toEqual(['d1', 'd2', 'd3'])
  })
})

describe('isMutedLabel — the other half of the `_` prefix (#1488)', () => {
  it('reads the mute marker on both label spellings', () => {
    expect(isMutedLabel('_$')).toBe(true)
    expect(isMutedLabel('_drums')).toBe(true)
  })

  it('is false for an unmuted label', () => {
    expect(isMutedLabel('$')).toBe(false)
    expect(isMutedLabel('drums')).toBe(false)
  })

  it('is false — not unknown — for a statement with NO label', () => {
    // Muting is a prefix ON a label, so a bare `s("bd*4")` has nothing to
    // prefix and cannot be muted. Treating absence as unknown would make every
    // unwrapped document unreadable to the period rule.
    expect(isMutedLabel(undefined)).toBe(false)
  })

  it('agrees with the identity strip: same marker, opposite halves', () => {
    // `trackIdFromLabel` throws the marker away so a muted track keeps its
    // lane; this reads it. The two must never disagree about what a marker is.
    expect(trackIdFromLabel('_drums', 0)).toBe('drums')
    expect(isMutedLabel('_drums')).toBe(true)
    expect(trackIdFromLabel('_$', 2)).toBe('d3')
    expect(isMutedLabel('_$')).toBe(true)
  })
})
