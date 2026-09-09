import { describe, expect, it } from 'vitest'

import {
  FALLBACK_ASSET_NAME,
  nextTakeName,
  planAssetImport,
  soundNameFromFilename,
  uniqueSoundName,
  type AssetRecord,
} from '../assetNaming'

/**
 * The pure half of the asset store (#1500). Storage itself is not tested here
 * and cannot be: `@stave/editor` has no `fake-indexeddb` and jsdom has no
 * IndexedDB. The blob round-trip, the survives-a-reload claim and the
 * registration into superdough's `soundMap` are observed in
 * `packages/app/tests/asset-store-roundtrip.spec.ts` instead.
 */

/** Deterministic id minting — the production caller passes `crypto.randomUUID`. */
function counterIds(prefix = 'id'): () => string {
  let n = 0
  return () => `${prefix}-${++n}`
}

function record(over: Partial<AssetRecord> = {}): AssetRecord {
  return {
    id: 'r0',
    name: 'vocal',
    blobHash: 'aaaa',
    mime: 'audio/wav',
    ...over,
  }
}

describe('soundNameFromFilename', () => {
  it('turns a real download name into something s() can address', () => {
    expect(soundNameFromFilename('My Take (2).wav')).toBe('my_take_2')
  })

  it('drops only the trailing extension', () => {
    expect(soundNameFromFilename('drums.take.1.aiff')).toBe('drums_take_1')
  })

  it('lowercases, because superdough resolves a sound by lowercased key', () => {
    // `getSound` is `soundMap.get()[s.toLowerCase()]` (superdough.mjs:165), so
    // an uppercase registration is unreachable from `s("…")`.
    expect(soundNameFromFilename('VOCAL.WAV')).toBe('vocal')
  })

  it('collapses runs of separators rather than emitting a run of underscores', () => {
    expect(soundNameFromFilename('a -- b__c.wav')).toBe('a_b_c')
  })

  it('trims leading and trailing separators', () => {
    expect(soundNameFromFilename('  spaced  .wav')).toBe('spaced')
  })

  it('falls back when nothing addressable survives', () => {
    expect(soundNameFromFilename('.wav')).toBe(FALLBACK_ASSET_NAME)
    expect(soundNameFromFilename('!!!.wav')).toBe(FALLBACK_ASSET_NAME)
  })

  it('keeps a name with no extension at all', () => {
    expect(soundNameFromFilename('vocal')).toBe('vocal')
  })
})

describe('uniqueSoundName', () => {
  it('prefers the bare name when it is free', () => {
    expect(uniqueSoundName('vocal', [])).toBe('vocal')
  })

  it('starts suffixing at 2 — there is never a _1', () => {
    expect(uniqueSoundName('vocal', ['vocal'])).toBe('vocal_2')
  })

  it('takes the smallest free suffix, not the next after the largest', () => {
    expect(uniqueSoundName('vocal', ['vocal', 'vocal_3'])).toBe('vocal_2')
  })

  it('skips a run of taken suffixes', () => {
    expect(uniqueSoundName('vocal', ['vocal', 'vocal_2', 'vocal_3'])).toBe('vocal_4')
  })
})

describe('nextTakeName', () => {
  it('the first take is take_1, not take', () => {
    // Positional from the start — a bare `take` would imply there is only ever
    // one, and the number is the whole point of the friction.
    expect(nextTakeName([])).toBe('take_1')
  })

  it('counts past the highest existing take', () => {
    expect(nextTakeName(['take_1', 'take_2'])).toBe('take_3')
  })

  it('does NOT fill a gap left by a deleted take', () => {
    // The user deleted take_2 because they did not want it. Handing that name
    // to the next recording makes two different takes share one name across a
    // session. An ever-increasing counter never does.
    expect(nextTakeName(['take_1', 'take_3'])).toBe('take_4')
  })

  it('ignores names that merely start with take', () => {
    expect(nextTakeName(['take_one', 'takeaway', 'my_take_9'])).toBe('take_1')
  })

  it('ignores a renamed take — the counter tracks names, not history', () => {
    // A take renamed to `chorus` no longer defends its number, so the next
    // recording may reuse it. That is the cost of a rename being a real rename.
    expect(nextTakeName(['chorus'])).toBe('take_1')
  })

  it('is unaffected by imported assets that are not takes', () => {
    expect(nextTakeName(['vocal', 'my_take_2', 'take_5'])).toBe('take_6')
  })
})

describe('planAssetImport', () => {
  it('mints the id through the injected minter, never from content', () => {
    const plan = planAssetImport(
      { blobHash: 'aaaa', filename: 'vocal.wav', mime: 'audio/wav' },
      [],
      counterIds(),
    )
    expect(plan.record.id).toBe('id-1')
  })

  it('names the record from the filename', () => {
    const plan = planAssetImport(
      { blobHash: 'aaaa', filename: 'My Take (2).wav', mime: 'audio/wav' },
      [],
      counterIds(),
    )
    expect(plan.record.name).toBe('my_take_2')
  })

  it('resolves the vocal.wav collision — two different files, two names', () => {
    // The case that is not hypothetical: every browser calls the file you just
    // downloaded `vocal.wav`.
    const first = planAssetImport(
      { blobHash: 'aaaa', filename: 'vocal.wav', mime: 'audio/wav' },
      [],
      counterIds(),
    )
    const second = planAssetImport(
      { blobHash: 'bbbb', filename: 'vocal.wav', mime: 'audio/wav' },
      [first.record],
      counterIds('two'),
    )
    expect([first.record.name, second.record.name]).toEqual(['vocal', 'vocal_2'])
  })

  it('gives two different files two different hashes', () => {
    const first = planAssetImport(
      { blobHash: 'aaaa', filename: 'vocal.wav', mime: 'audio/wav' },
      [],
      counterIds(),
    )
    const second = planAssetImport(
      { blobHash: 'bbbb', filename: 'vocal.wav', mime: 'audio/wav' },
      [first.record],
      counterIds('two'),
    )
    expect(second.record.blobHash).not.toBe(first.record.blobHash)
  })

  it('same bytes under a second name: one blob', () => {
    const existing = [record({ id: 'r0', name: 'vocal', blobHash: 'aaaa' })]
    const plan = planAssetImport(
      { blobHash: 'aaaa', filename: 'backing.wav', mime: 'audio/wav' },
      existing,
      counterIds(),
    )
    expect(plan.record.blobHash).toBe('aaaa')
  })

  it('same bytes under a second name: two records', () => {
    const existing = [record({ id: 'r0', name: 'vocal', blobHash: 'aaaa' })]
    const plan = planAssetImport(
      { blobHash: 'aaaa', filename: 'backing.wav', mime: 'audio/wav' },
      existing,
      counterIds(),
    )
    expect([plan.record.id, plan.record.name]).toEqual(['id-1', 'backing'])
  })

  it('reports the second reference to known bytes as not the first', () => {
    const existing = [record({ blobHash: 'aaaa' })]
    const plan = planAssetImport(
      { blobHash: 'aaaa', filename: 'backing.wav', mime: 'audio/wav' },
      existing,
      counterIds(),
    )
    expect(plan.isFirstReference).toBe(false)
  })

  it('reports unknown bytes as a first reference — the control for the arm above', () => {
    const existing = [record({ blobHash: 'aaaa' })]
    const plan = planAssetImport(
      { blobHash: 'cccc', filename: 'backing.wav', mime: 'audio/wav' },
      existing,
      counterIds(),
    )
    expect(plan.isFirstReference).toBe(true)
  })

  it('re-importing the identical file still yields a second reference', () => {
    // A record is a reference the user asked for. Collapsing it would silently
    // discard an intentional second one; only the BYTES are deduplicated.
    const existing = [record({ id: 'r0', name: 'vocal', blobHash: 'aaaa' })]
    const plan = planAssetImport(
      { blobHash: 'aaaa', filename: 'vocal.wav', mime: 'audio/wav' },
      existing,
      counterIds(),
    )
    expect(plan.record.name).toBe('vocal_2')
  })

  it('carries the mime through unchanged', () => {
    const plan = planAssetImport(
      { blobHash: 'aaaa', filename: 'take.ogg', mime: 'audio/ogg' },
      [],
      counterIds(),
    )
    expect(plan.record.mime).toBe('audio/ogg')
  })

  it('carries a measured duration', () => {
    const plan = planAssetImport(
      { blobHash: 'aaaa', filename: 'take.wav', mime: 'audio/wav', duration: 1.5 },
      [],
      counterIds(),
    )
    expect(plan.record.duration).toBe(1.5)
  })

  it('omits duration entirely when it could not be measured', () => {
    // Absent, not `undefined`-valued: the record is persisted into a document,
    // and a key holding undefined is not the same row as a key that is absent.
    const plan = planAssetImport(
      { blobHash: 'aaaa', filename: 'take.wav', mime: 'audio/wav' },
      [],
      counterIds(),
    )
    expect('duration' in plan.record).toBe(false)
  })
})
