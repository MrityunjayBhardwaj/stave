import { test, expect, type Page } from '@playwright/test'

import { bootApp } from './_appBoot'

/**
 * The instrument for #1500 — "bring your own audio", Phase 1 of #1352.
 *
 * The claim is that a byte gets into the browser, SURVIVES A RELOAD, and plays
 * as `s("my_take")`. No unit test can say any of that: `@stave/editor` has no
 * `fake-indexeddb` and jsdom has no IndexedDB, so the naming half is unit-
 * tested (`assetNaming.test.ts`) and this file observes the rest.
 *
 * ⚠ The reload arm is the one that matters and the one a same-session
 * round-trip silently skips. An in-memory Map passes "store then read back"
 * perfectly; only a reload distinguishes a store from a cache. So the
 * persistence arm goes through `page.reload()`, and asserts on the bytes.
 *
 * The negative arm carries its POSITIVE CONTROL in the same run: an unknown
 * name must be absent from the live `soundMap` while a just-registered one is
 * present. Asserting only the absence would pass against a detector that
 * matches nothing at all.
 *
 * ONE assertion per test throughout — a second `expect` in a block never runs
 * once the first has failed, and every other block still reports passing.
 */

// ---------------------------------------------------------------------------
// Fixtures — authored here so the expected duration is a fact about the file
// ---------------------------------------------------------------------------

/** A mono 16-bit PCM WAV of `seconds` at `freq`. Node-side, so it cannot drift. */
function wavBase64(seconds: number, freq: number, sampleRate = 44100): string {
  const frames = Math.round(seconds * sampleRate)
  const buf = Buffer.alloc(44 + frames * 2)
  buf.write('RIFF', 0)
  buf.writeUInt32LE(36 + frames * 2, 4)
  buf.write('WAVE', 8)
  buf.write('fmt ', 12)
  buf.writeUInt32LE(16, 16) // PCM chunk size
  buf.writeUInt16LE(1, 20) // format = PCM
  buf.writeUInt16LE(1, 22) // channels
  buf.writeUInt32LE(sampleRate, 24)
  buf.writeUInt32LE(sampleRate * 2, 28) // byte rate
  buf.writeUInt16LE(2, 32) // block align
  buf.writeUInt16LE(16, 34) // bits per sample
  buf.write('data', 36)
  buf.writeUInt32LE(frames * 2, 40)
  for (let i = 0; i < frames; i++) {
    const v = Math.sin((2 * Math.PI * freq * i) / sampleRate) * 0.4
    buf.writeInt16LE(Math.round(v * 32767), 44 + i * 2)
  }
  return buf.toString('base64')
}

/** 1.0s @ 440Hz. */
const TAKE_A = wavBase64(1.0, 440)
/** 0.5s @ 220Hz — different bytes, so a different hash. */
const TAKE_B = wavBase64(0.5, 220)

const A_SECONDS = 1.0
const B_SECONDS = 0.5

// ---------------------------------------------------------------------------
// Probe access
// ---------------------------------------------------------------------------

/** The probe's surface, as the page exposes it (`src/e2e/assetProbe.ts`). */
interface PageProbe {
  reset(): Promise<void>
  put(base64: string, mime: string): Promise<{ hash: string; written: boolean }>
  get(hash: string): Promise<string | null>
  list(): Promise<Array<{ hash: string; mime: string; size: number }>>
  import(
    base64: string,
    mime: string,
    filename: string,
    existing: unknown[],
  ): Promise<{
    record: { id: string; name: string; blobHash: string; mime: string; duration?: number }
    isFirstReference: boolean
    written: boolean
  }>
  resolve(hash: string): Promise<string | null>
  concurrentResolve(hash: string, n: number): Promise<{ urls: (string | null)[]; opens: number }>
  peek(hash: string): Promise<string | null>
  release(hash: string): Promise<void>
  register(record: unknown): Promise<boolean>
  inSoundMap(name: string): boolean
  soundMapEntry(name: string): { type?: string; samples?: unknown } | null
  decode(url: string): Promise<{ duration: number; sampleRate: number }>
}

declare global {
  interface Window {
    __staveAssetProbe?: PageProbe
  }
}

/** Boot with the E2E hooks on and wait until the probe has actually attached. */
async function bootWithProbe(page: Page): Promise<void> {
  await bootApp(page, { e2eHooks: true })
  await page.waitForFunction(() => Boolean(window.__staveAssetProbe), { timeout: 30_000 })
}

/**
 * Wait for superdough's live `soundMap` to be published on `globalThis`.
 *
 * It is a superdough module singleton that nothing publishes on its own — the
 * engine assigns it at init (`StrudelEngine.ts:843`), and the app warms an
 * engine on idle for the instrument picker (#813). So this is a wait, not a
 * gesture: no Play is required.
 */
async function soundMapPublished(page: Page): Promise<void> {
  await page.waitForFunction(
    () =>
      Boolean(
        (globalThis as unknown as { soundMap?: { get?: () => unknown } }).soundMap?.get,
      ),
    { timeout: 60_000 },
  )
}

test.beforeEach(async ({ page }) => {
  await bootWithProbe(page)
  await page.evaluate(() => window.__staveAssetProbe!.reset())
})

// ---------------------------------------------------------------------------
// 1. Round-trip
// ---------------------------------------------------------------------------

test('bytes read back by content hash are the bytes that went in', async ({ page }) => {
  const back = await page.evaluate(async (b64) => {
    const p = window.__staveAssetProbe!
    const { hash } = await p.put(b64, 'audio/wav')
    return p.get(hash)
  }, TAKE_A)
  expect(back).toBe(TAKE_A)
})

test('an unknown hash reads back null — the control for the arm above', async ({ page }) => {
  const back = await page.evaluate(async (b64) => {
    const p = window.__staveAssetProbe!
    // A real blob is stored first, so this measures "not that one" rather than
    // "the store is empty and returns null for everything".
    await p.put(b64, 'audio/wav')
    return p.get('0'.repeat(64))
  }, TAKE_A)
  expect(back).toBeNull()
})

// ---------------------------------------------------------------------------
// 2. Persistence — the arm the whole slice exists for
// ---------------------------------------------------------------------------

test('bytes survive a page reload', async ({ page }) => {
  const hash = await page.evaluate(
    async (b64) => (await window.__staveAssetProbe!.put(b64, 'audio/wav')).hash,
    TAKE_A,
  )

  await page.reload({ waitUntil: 'domcontentloaded' })
  await bootWithProbe(page)

  const back = await page.evaluate(
    (h) => window.__staveAssetProbe!.get(h),
    hash,
  )
  expect(back).toBe(TAKE_A)
})

test('the hash is stable across a reload, so the stored bytes stay addressable', async ({
  page,
}) => {
  // This arm is about the KEY, not about persistence — break-tested: a store
  // that loses its bytes on reload leaves this one green, because the hash is
  // a function of the content and nothing else. What it does catch is a digest
  // seeded per session, which would mint a new key for the same file every
  // time and leave the previous document's reference pointing at nothing.
  const first = await page.evaluate(
    async (b64) => (await window.__staveAssetProbe!.put(b64, 'audio/wav')).hash,
    TAKE_A,
  )

  await page.reload({ waitUntil: 'domcontentloaded' })
  await bootWithProbe(page)

  const second = await page.evaluate(
    async (b64) => (await window.__staveAssetProbe!.put(b64, 'audio/wav')).hash,
    TAKE_A,
  )
  expect(second).toBe(first)
})

test('a reload does not re-write bytes the store already holds', async ({ page }) => {
  const before = await page.evaluate(
    async (b64) => (await window.__staveAssetProbe!.put(b64, 'audio/wav')).written,
    TAKE_A,
  )

  await page.reload({ waitUntil: 'domcontentloaded' })
  await bootWithProbe(page)

  const after = await page.evaluate(
    async (b64) => (await window.__staveAssetProbe!.put(b64, 'audio/wav')).written,
    TAKE_A,
  )
  // `before` is the positive control: the first write really did write.
  expect([before, after]).toEqual([true, false])
})

// ---------------------------------------------------------------------------
// 3. Registration — a stored asset becomes playable
// ---------------------------------------------------------------------------

test('a registered asset appears in the live soundMap under its derived name', async ({
  page,
}) => {
  await soundMapPublished(page)
  const seen = await page.evaluate(async (b64) => {
    const p = window.__staveAssetProbe!
    const { record } = await p.import(b64, 'audio/wav', 'My Take (2).wav', [])
    await p.register(record)
    return { name: record.name, present: p.inSoundMap(record.name) }
  }, TAKE_A)
  expect(seen).toEqual({ name: 'my_take_2', present: true })
})

test('superdough records it as a sample pointing at the blob URL', async ({ page }) => {
  await soundMapPublished(page)
  const entry = await page.evaluate(async (b64) => {
    const p = window.__staveAssetProbe!
    const { record } = await p.import(b64, 'audio/wav', 'my_take.wav', [])
    await p.register(record)
    const e = p.soundMapEntry(record.name)
    const urls = Array.isArray(e?.samples) ? (e!.samples as string[]) : []
    return { type: e?.type, blobUrls: urls.filter((u) => u.startsWith('blob:')).length }
  }, TAKE_A)
  // `samples()` → `registerSampleSource` → `registerSample` registers
  // `{ type: 'sample', samples: bank }` (superdough/sampler.mjs:354). An empty
  // baseUrl leaves the blob URL unprefixed (sampler.mjs:159).
  expect(entry).toEqual({ type: 'sample', blobUrls: 1 })
})

test('the registered URL decodes to the length of the file that was stored', async ({
  page,
}) => {
  await soundMapPublished(page)
  const read = await page.evaluate(
    async ([a, b]) => {
      const p = window.__staveAssetProbe!
      const A = await p.import(a, 'audio/wav', 'take_a.wav', [])
      const B = await p.import(b, 'audio/wav', 'take_b.wav', [A.record])
      await p.register(A.record)
      await p.register(B.record)
      const urlA = (await p.resolve(A.record.blobHash))!
      const urlB = (await p.resolve(B.record.blobHash))!
      const dA = await p.decode(urlA)
      const dB = await p.decode(urlB)
      return { a: dA.duration, b: dB.duration, sr: dA.sampleRate }
    },
    [TAKE_A, TAKE_B],
  )
  // Reported so a future reader can see the device state this ran on; the
  // assertion is the RATIO of two readings taken in one run on one context,
  // which is invariant to the context's rate. 1.0s / 0.5s = 2.
  console.log(`[asset-store] sr=${read.sr} durA=${read.a} durB=${read.b}`)
  expect(read.a / read.b).toBeCloseTo(A_SECONDS / B_SECONDS, 2)
})

test('the record carries the measured duration', async ({ page }) => {
  const duration = await page.evaluate(
    async (b64) => (await window.__staveAssetProbe!.import(b64, 'audio/wav', 'take_a.wav', []))
      .record.duration,
    TAKE_A,
  )
  expect(duration).toBeCloseTo(A_SECONDS, 2)
})

test('a file that is not decodable audio still imports, with no duration', async ({
  page,
}) => {
  // The measurer rejects on these bytes (the probe passes the rejection
  // straight through rather than swallowing it, so this measures the STORE).
  // Failing the import here would be the worse outcome: the blob is written
  // before the measurement, so a rejection would leave bytes with no record
  // pointing at them.
  const outcome = await page.evaluate(async () => {
    const p = window.__staveAssetProbe!
    const notAudio = btoa('this is plainly not a wav file')
    const res = await p.import(notAudio, 'text/plain', 'notes.txt', [])
    return {
      name: res.record.name,
      stored: (await p.list()).length,
      hasDuration: res.record.duration !== undefined,
    }
  })
  expect(outcome).toEqual({ name: 'notes', stored: 1, hasDuration: false })
})

// ---------------------------------------------------------------------------
// 4. Dedup — same bytes, second name
// ---------------------------------------------------------------------------

test('the same bytes under a second name are stored once', async ({ page }) => {
  const list = await page.evaluate(async (b64) => {
    const p = window.__staveAssetProbe!
    const first = await p.import(b64, 'audio/wav', 'vocal.wav', [])
    await p.import(b64, 'audio/wav', 'backing.wav', [first.record])
    return p.list()
  }, TAKE_A)
  expect(list).toHaveLength(1)
})

test('the same bytes under a second name yield two records sharing one hash', async ({
  page,
}) => {
  const pair = await page.evaluate(async (b64) => {
    const p = window.__staveAssetProbe!
    const first = await p.import(b64, 'audio/wav', 'vocal.wav', [])
    const second = await p.import(b64, 'audio/wav', 'backing.wav', [first.record])
    return {
      names: [first.record.name, second.record.name],
      sameHash: first.record.blobHash === second.record.blobHash,
      distinctIds: first.record.id !== second.record.id,
      secondWroteBytes: second.written,
    }
  }, TAKE_A)
  expect(pair).toEqual({
    names: ['vocal', 'backing'],
    sameHash: true,
    distinctIds: true,
    secondWroteBytes: false,
  })
})

test('two DIFFERENT files are stored twice — the control for the dedup arms', async ({
  page,
}) => {
  const list = await page.evaluate(
    async ([a, b]) => {
      const p = window.__staveAssetProbe!
      const first = await p.import(a, 'audio/wav', 'vocal.wav', [])
      await p.import(b, 'audio/wav', 'vocal.wav', [first.record])
      return p.list()
    },
    [TAKE_A, TAKE_B],
  )
  expect(list).toHaveLength(2)
})

test('two different files both called vocal.wav get two reachable names', async ({
  page,
}) => {
  const names = await page.evaluate(
    async ([a, b]) => {
      const p = window.__staveAssetProbe!
      const first = await p.import(a, 'audio/wav', 'vocal.wav', [])
      const second = await p.import(b, 'audio/wav', 'vocal.wav', [first.record])
      return [first.record.name, second.record.name]
    },
    [TAKE_A, TAKE_B],
  )
  expect(names).toEqual(['vocal', 'vocal_2'])
})

// ---------------------------------------------------------------------------
// 5. The negative arm, with its positive control in the SAME run
// ---------------------------------------------------------------------------

test('an unregistered name is absent from the soundMap while a registered one is present', async ({
  page,
}) => {
  await soundMapPublished(page)
  const seen = await page.evaluate(async (b64) => {
    const p = window.__staveAssetProbe!
    const { record } = await p.import(b64, 'audio/wav', 'my_take.wav', [])
    await p.register(record)
    return {
      registered: p.inSoundMap(record.name),
      neverImported: p.inSoundMap('no_such_asset_2f9c1'),
    }
  }, TAKE_A)
  expect(seen).toEqual({ registered: true, neverImported: false })
})

test('registering a record whose bytes are gone reports failure rather than a dead URL', async ({
  page,
}) => {
  const outcome = await page.evaluate(async (b64) => {
    const p = window.__staveAssetProbe!
    const { record } = await p.import(b64, 'audio/wav', 'my_take.wav', [])
    // Simulates the browser reclaiming storage between a document being
    // written and being opened — the case #1500 leaves quota handling to
    // Phase 2 for, but which must still not register a URL that 404s.
    await p.reset()
    return { ok: await p.register(record), url: await p.resolve(record.blobHash) }
  }, TAKE_A)
  expect(outcome).toEqual({ ok: false, url: null })
})

// ---------------------------------------------------------------------------
// 6. The URL cache — one blob, one handle
// ---------------------------------------------------------------------------

test('resolving the same bytes twice returns the identical URL', async ({ page }) => {
  // Not cosmetic: the sampler asks for a URL on the way to every note, so a
  // fresh `createObjectURL` per call pins one blob per note for the lifetime
  // of the page.
  const same = await page.evaluate(async (b64) => {
    const p = window.__staveAssetProbe!
    const { hash } = await p.put(b64, 'audio/wav')
    const [one, two] = [await p.resolve(hash), await p.resolve(hash)]
    return { one, identical: one === two }
  }, TAKE_A)
  expect(same.identical && same.one !== null).toBe(true)
})

test('four concurrent resolves read the store once, not four times', async ({ page }) => {
  // ⚠ THE OPEN COUNT IS THE ASSERTION, and the reason is a break test.
  //
  // The obvious arm — "do concurrent resolves return the same URL?" — was
  // written first and PASSED against the defect. Two separate IndexedDB reads
  // almost always settle at different times, so a cache that re-checks only
  // AFTER its read still wins the race by accident, and the arm never went
  // red. It asserted a true thing that could not fail.
  //
  // What does separate the two implementations is how many times the store was
  // asked to open: sharing the in-flight promise reads once, repeating the
  // work reads once per caller. Same discipline superdough's sampler uses
  // (`loadCache[url] = fetch(...)`, sampler.mjs:90).
  const seen = await page.evaluate(async (b64) => {
    const p = window.__staveAssetProbe!
    const { hash } = await p.put(b64, 'audio/wav')
    const { urls, opens } = await p.concurrentResolve(hash, 4)
    return { opens, oneUrl: new Set(urls).size, live: urls[0] !== null }
  }, TAKE_A)
  expect(seen).toEqual({ opens: 1, oneUrl: 1, live: true })
})

test('two records sharing one blob share one URL', async ({ page }) => {
  const same = await page.evaluate(async (b64) => {
    const p = window.__staveAssetProbe!
    const first = await p.import(b64, 'audio/wav', 'vocal.wav', [])
    const second = await p.import(b64, 'audio/wav', 'backing.wav', [first.record])
    const a = await p.resolve(first.record.blobHash)
    const b = await p.resolve(second.record.blobHash)
    return a !== null && a === b
  }, TAKE_A)
  expect(same).toBe(true)
})

test('releasing a blob drops its cached URL and the next resolve mints a new one', async ({
  page,
}) => {
  const seen = await page.evaluate(async (b64) => {
    const p = window.__staveAssetProbe!
    const { hash } = await p.put(b64, 'audio/wav')
    const first = await p.resolve(hash)
    await p.release(hash)
    const afterRelease = await p.peek(hash)
    const second = await p.resolve(hash)
    return { cleared: afterRelease === null, reminted: second !== null && second !== first }
  }, TAKE_A)
  expect(seen).toEqual({ cleared: true, reminted: true })
})
