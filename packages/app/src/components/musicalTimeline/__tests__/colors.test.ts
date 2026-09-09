import { describe, it, expect } from 'vitest'
import {
  trackColorFromStem,
  STEM_DRUMS,
  STEM_BASS,
  STEM_PAD,
  STEM_MELODY,
  STEM_FALLBACK,
  TRACK_PALETTE_32,
  paletteForTrack,
  trackIndexOf,
  automationColorOnLane, colorForAutomation,
  AUTOMATION_PALETTE,
} from '../colors'

describe('trackColorFromStem — drum family (DV-04 / DV-11)', () => {
  const drumIds = ['bd', 'hh', 'sd', 'cp', 'hat', 'kick', 'snare', 'drum', 'perc', 'ride', 'crash', 'tom']
  for (const id of drumIds) {
    it(`maps "${id}" → STEM_DRUMS`, () => {
      expect(trackColorFromStem(id)).toBe(STEM_DRUMS)
    })
  }
})

describe('trackColorFromStem — bass family', () => {
  for (const id of ['bass', 'sub', '808']) {
    it(`maps "${id}" → STEM_BASS`, () => {
      expect(trackColorFromStem(id)).toBe(STEM_BASS)
    })
  }
})

describe('trackColorFromStem — pad family', () => {
  for (const id of ['pad', 'pads']) {
    it(`maps "${id}" → STEM_PAD`, () => {
      expect(trackColorFromStem(id)).toBe(STEM_PAD)
    })
  }
})

describe('trackColorFromStem — melody family', () => {
  for (const id of ['lead', 'melody', 'synth', 'piano', 'keys', 'guitar']) {
    it(`maps "${id}" → STEM_MELODY`, () => {
      expect(trackColorFromStem(id)).toBe(STEM_MELODY)
    })
  }
})

describe('trackColorFromStem — fallback (DV-04)', () => {
  it('returns STEM_FALLBACK for unknown ids', () => {
    expect(trackColorFromStem('xyz123')).toBe(STEM_FALLBACK)
  })

  it('returns STEM_FALLBACK for empty string', () => {
    expect(trackColorFromStem('')).toBe(STEM_FALLBACK)
  })

  it('STEM_FALLBACK equals STEM_MELODY (DV-04 spec)', () => {
    expect(STEM_FALLBACK).toBe(STEM_MELODY)
  })

  it('returns STEM_FALLBACK for the $default sentinel', () => {
    expect(trackColorFromStem('$default')).toBe(STEM_FALLBACK)
  })
})

describe('trackColorFromStem — sample outranks trackId (DV-11)', () => {
  it('uses sample when both are provided', () => {
    expect(trackColorFromStem('mystery-track', 'bd')).toBe(STEM_DRUMS)
    expect(trackColorFromStem('bd', 'pad')).toBe(STEM_PAD)
  })

  it('falls through to trackId when sample is undefined', () => {
    expect(trackColorFromStem('bass-line')).toBe(STEM_BASS)
  })
})

describe('trackColorFromStem — precedence ordering (DV-11)', () => {
  it('drums beat bass when both could match — drums earlier', () => {
    expect(trackColorFromStem('bd-bass')).toBe(STEM_DRUMS)
  })
})

describe('trackColorFromStem — case-insensitive', () => {
  it('uppercase BD matches drums', () => {
    expect(trackColorFromStem('BD')).toBe(STEM_DRUMS)
  })

  it('mixed-case Bass matches bass', () => {
    expect(trackColorFromStem('Bass')).toBe(STEM_BASS)
  })
})

describe('20-11 — 32-palette + paletteForTrack + trackIndexOf', () => {
  it('TRACK_PALETTE_32 has 32 entries', () => {
    expect(TRACK_PALETTE_32.length).toBe(32)
  })

  it('paletteForTrack(0, undefined) returns a valid hex string', () => {
    expect(/^#[0-9a-f]{6}$/i.test(paletteForTrack(0))).toBe(true)
  })

  it('paletteForTrack with drum sample returns drum-family color', () => {
    // trackIndex=0, sample='bd' → hueGroup=0 (drums) → slot=(0*4+0)%32=0 → drums lightest.
    expect(paletteForTrack(0, 'bd')).toBe(TRACK_PALETTE_32[0])
  })

  it('paletteForTrack with bass sample biases toward bass family', () => {
    // trackIndex=0, sample='bass1' → hueGroup=1 (bass) → slot=(0*4+1)%32=1.
    expect(paletteForTrack(0, 'bass1')).toBe(TRACK_PALETTE_32[1])
  })

  it('paletteForTrack(33, undefined) wraps mod 32', () => {
    expect(paletteForTrack(33, undefined)).toBe(paletteForTrack(1, undefined))
  })

  it('trackIndexOf("d1") === 0; trackIndexOf("d12") === 11', () => {
    expect(trackIndexOf('d1')).toBe(0)
    expect(trackIndexOf('d12')).toBe(11)
  })

  it('trackIndexOf("custom") returns a stable hash 0..31', () => {
    const a = trackIndexOf('custom')
    const b = trackIndexOf('custom')
    expect(a).toBe(b)
    expect(a).toBeGreaterThanOrEqual(0)
    expect(a).toBeLessThan(32)
  })

  it('trackIndexOf("d33") === 0 (mod 32 wrap)', () => {
    expect(trackIndexOf('d33')).toBe(0)
  })

  it('trackColorFromStem still works (back-compat shim)', () => {
    expect(trackColorFromStem('bd')).toBe(STEM_DRUMS)
  })
})

describe('colorForAutomation — a parameter\'s stable curve colour (#1485)', () => {
  it('is stable for a given parameter name', () => {
    expect(colorForAutomation('cutoff')).toBe(colorForAutomation('cutoff'))
  })

  it('separates the parameters a lane actually carries together', () => {
    // The measured pairing this exists for: 47 corpus documents automate `pan`
    // and 76 automate `cutoff`, and a track doing both is ordinary.
    expect(colorForAutomation('cutoff')).not.toBe(colorForAutomation('pan'))
    expect(colorForAutomation('gain')).not.toBe(colorForAutomation('cutoff'))
  })

  it('always returns a colour from the automation palette', () => {
    for (const k of ['cutoff', 'pan', 'gain', 'room', 'delaytime', 'lpq', 'speed', 'crush', '']) {
      expect(AUTOMATION_PALETTE, k).toContain(colorForAutomation(k))
    }
  })

  it('does NOT borrow the track palette', () => {
    // A curve is drawn INSIDE a lane, over that lane's own marks: sharing the
    // track palette lets a curve land on a neighbouring track's swatch and read
    // as belonging to it.
    for (const c of AUTOMATION_PALETTE) expect(TRACK_PALETTE_32).not.toContain(c)
  })
})

describe('automationColorOnLane — one rule, read by the curve and by its editor (#1464)', () => {
  const THEME_LINE = '#theme'

  it('a lane with ONE automation keeps the theme colour — nothing to disambiguate', () => {
    expect(automationColorOnLane('cutoff', 1, THEME_LINE)).toBe(THEME_LINE)
    expect(automationColorOnLane('cutoff', 0, THEME_LINE)).toBe(THEME_LINE)
  })

  it('a lane with several takes the per-parameter hue', () => {
    expect(automationColorOnLane('cutoff', 2, THEME_LINE)).toBe(colorForAutomation('cutoff'))
  })

  it('the hue is keyed on the PARAMETER, so a lane gaining a curve does not recolour the first', () => {
    expect(automationColorOnLane('cutoff', 2, THEME_LINE))
      .toBe(automationColorOnLane('cutoff', 5, THEME_LINE))
  })
})
