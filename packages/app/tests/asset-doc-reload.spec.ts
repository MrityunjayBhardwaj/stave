import { test, expect, type Page } from '@playwright/test'

import { bootApp } from './_appBoot'

/**
 * The instrument for #1502 — the project document remembers its assets.
 *
 * #1500 proved BYTES survive a reload. That is only half of "playable as
 * `s("my_take")` after a reload": the blob store knows hashes, not names, so
 * without the document's own memory nothing after a refresh knows a blob was
 * ever called anything.
 *
 * ⚠ The load-bearing arm is not "does the record persist" but "is the name
 * addressable again with NO user action" — the registration on project load.
 * A spec that re-registered by hand after reloading would pass with that wiring
 * deleted, which is the shape that makes a green suite meaningless.
 *
 * ONE assertion per test: a second `expect` in a block never runs once the
 * first has failed, and every other block still reports passing.
 */

/** A mono 16-bit PCM WAV of `seconds` at `freq`. Authored here so it cannot drift. */
function wavBase64(seconds: number, freq: number, sampleRate = 44100): string {
  const frames = Math.round(seconds * sampleRate)
  const buf = Buffer.alloc(44 + frames * 2)
  buf.write('RIFF', 0)
  buf.writeUInt32LE(36 + frames * 2, 4)
  buf.write('WAVE', 8)
  buf.write('fmt ', 12)
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(1, 20)
  buf.writeUInt16LE(1, 22)
  buf.writeUInt32LE(sampleRate, 24)
  buf.writeUInt32LE(sampleRate * 2, 28)
  buf.writeUInt16LE(2, 32)
  buf.writeUInt16LE(16, 34)
  buf.write('data', 36)
  buf.writeUInt32LE(frames * 2, 40)
  for (let i = 0; i < frames; i++) {
    const v = Math.sin((2 * Math.PI * freq * i) / sampleRate) * 0.4
    buf.writeInt16LE(Math.round(v * 32767), 44 + i * 2)
  }
  return buf.toString('base64')
}

const TAKE_A = wavBase64(1.0, 440)
const TAKE_B = wavBase64(0.5, 220)

interface DocRecord {
  id: string
  name: string
  blobHash: string
  mime: string
  duration?: number
}

interface PageProbe {
  reset(): Promise<void>
  put(base64: string, mime: string): Promise<{ hash: string; written: boolean }>
  list(): Promise<Array<{ hash: string }>>
  import(
    base64: string,
    mime: string,
    filename: string,
    existing: unknown[],
  ): Promise<{ record: DocRecord }>
  remove(hash: string): Promise<void>
  resolve(hash: string): Promise<string | null>
  register(record: unknown): Promise<boolean>
  registerAll(records: unknown[]): Promise<string[]>
  docList(): Promise<DocRecord[]>
  docAdd(record: DocRecord): Promise<void>
  docRemove(id: string): Promise<void>
  docRename(id: string, name: string): Promise<string | null>
  docWatch(): Promise<void>
  docNotifyCount(): Promise<number>
  docUnwatch(): Promise<number>
  inSoundMap(name: string): boolean
  decode(url: string): Promise<{ duration: number; sampleRate: number }>
}

declare global {
  interface Window {
    __staveAssetProbe?: PageProbe
  }
}

async function bootWithProbe(page: Page): Promise<void> {
  await bootApp(page, { e2eHooks: true })
  await page.waitForFunction(() => Boolean(window.__staveAssetProbe), { timeout: 30_000 })
}

/**
 * Superdough's `soundMap` is a module singleton nothing publishes on its own —
 * the engine assigns it at init, and the app warms an engine on idle for the
 * instrument picker. So this is a wait, not a gesture: no Play is required.
 */
async function soundMapPublished(page: Page): Promise<void> {
  await page.waitForFunction(
    () =>
      Boolean((globalThis as unknown as { soundMap?: { get?: () => unknown } }).soundMap?.get),
    { timeout: 60_000 },
  )
}

/** Import one file and record it in the project document. Returns the record. */
async function seedAsset(
  page: Page,
  b64: string,
  filename: string,
): Promise<DocRecord> {
  return page.evaluate(
    async ([bytes, name]) => {
      const p = window.__staveAssetProbe!
      const { record } = await p.import(bytes, 'audio/wav', name, await p.docList())
      await p.docAdd(record)
      return record
    },
    [b64, filename],
  )
}

test.beforeEach(async ({ page }) => {
  await bootWithProbe(page)
  await page.evaluate(() => window.__staveAssetProbe!.reset())
})

// ---------------------------------------------------------------------------
// The document's memory
// ---------------------------------------------------------------------------

test('a record added to the project is listed back', async ({ page }) => {
  const record = await seedAsset(page, TAKE_A, 'my_take.wav')
  const listed = await page.evaluate(() => window.__staveAssetProbe!.docList())
  expect(listed).toEqual([record])
})

test('a record survives a page reload', async ({ page }) => {
  const record = await seedAsset(page, TAKE_A, 'my_take.wav')

  await page.reload({ waitUntil: 'domcontentloaded' })
  await bootWithProbe(page)

  const listed = await page.evaluate(() => window.__staveAssetProbe!.docList())
  expect(listed).toEqual([record])
})

test('the record still points at bytes the store can produce after a reload', async ({
  page,
}) => {
  // The two halves persist in DIFFERENT places — the record in the project
  // Y.Doc via y-indexeddb, the bytes in `stave-assets` keyed by hash. Either
  // one surviving alone is useless, so the arm crosses the join.
  await seedAsset(page, TAKE_A, 'my_take.wav')

  await page.reload({ waitUntil: 'domcontentloaded' })
  await bootWithProbe(page)

  const decoded = await page.evaluate(async () => {
    const p = window.__staveAssetProbe!
    const [record] = await p.docList()
    const url = await p.resolve(record.blobHash)
    if (!url) return null
    return (await p.decode(url)).duration
  })
  expect(decoded).toBeCloseTo(1.0, 2)
})

// ---------------------------------------------------------------------------
// Registration on project load — the arm the slice exists for
// ---------------------------------------------------------------------------

test('after a reload the name is addressable with NO user action', async ({ page }) => {
  // Nothing in this block registers anything. If the load-time registration is
  // removed, this is the arm that goes red.
  const record = await seedAsset(page, TAKE_A, 'my_take.wav')

  await page.reload({ waitUntil: 'domcontentloaded' })
  await bootWithProbe(page)
  await soundMapPublished(page)

  await page.waitForFunction(
    (name) => window.__staveAssetProbe!.inSoundMap(name),
    record.name,
    { timeout: 30_000 },
  )
  const present = await page.evaluate(
    (name) => window.__staveAssetProbe!.inSoundMap(name),
    record.name,
  )
  expect(present).toBe(true)
})

test('a name that was never a record stays absent — the control for the arm above', async ({
  page,
}) => {
  const record = await seedAsset(page, TAKE_A, 'my_take.wav')

  await page.reload({ waitUntil: 'domcontentloaded' })
  await bootWithProbe(page)
  await soundMapPublished(page)
  await page.waitForFunction(
    (name) => window.__staveAssetProbe!.inSoundMap(name),
    record.name,
    { timeout: 30_000 },
  )

  // Measured in the same run as a name that DID arrive, so this cannot pass
  // against a detector that matches nothing.
  const seen = await page.evaluate(
    (name) => ({
      registered: window.__staveAssetProbe!.inSoundMap(name),
      neverARecord: window.__staveAssetProbe!.inSoundMap('no_such_take_7b31'),
    }),
    record.name,
  )
  expect(seen).toEqual({ registered: true, neverARecord: false })
})

test('a record whose bytes are gone is skipped while its sibling registers', async ({
  page,
}) => {
  await soundMapPublished(page)
  const names = await page.evaluate(
    async ([a, b]) => {
      const p = window.__staveAssetProbe!
      const A = await p.import(a, 'audio/wav', 'kept.wav', [])
      await p.docAdd(A.record)
      const B = await p.import(b, 'audio/wav', 'evicted.wav', await p.docList())
      await p.docAdd(B.record)
      // The browser reclaiming storage between writing a document and opening it.
      await p.remove(B.record.blobHash)
      return p.registerAll(await p.docList())
    },
    [TAKE_A, TAKE_B],
  )
  expect(names).toEqual(['kept'])
})

// ---------------------------------------------------------------------------
// The observer — and the 'add' vs 'update' trap specifically
// ---------------------------------------------------------------------------

test('adding a record notifies subscribers', async ({ page }) => {
  const n = await page.evaluate(async (b64) => {
    const p = window.__staveAssetProbe!
    await p.docWatch()
    const { record } = await p.import(b64, 'audio/wav', 'my_take.wav', [])
    await p.docAdd(record)
    return p.docUnwatch()
  }, TAKE_A)
  expect(n).toBe(1)
})

test('RENAMING a record notifies too — Y.Map calls that an update, not an add', async ({
  page,
}) => {
  // The trap this arm exists for: a handler that switched on the change action
  // and only answered 'add' would leave every consumer holding a stale name
  // after a rename, with nothing failing. The count is measured from AFTER the
  // add, so the add's own notification cannot be mistaken for this one.
  const n = await page.evaluate(async (b64) => {
    const p = window.__staveAssetProbe!
    const { record } = await p.import(b64, 'audio/wav', 'my_take.wav', [])
    await p.docAdd(record)
    await p.docWatch()
    await p.docRename(record.id, 'chorus')
    return p.docUnwatch()
  }, TAKE_A)
  expect(n).toBe(1)
})

test('removing a record notifies, and an unsubscribed watcher hears nothing', async ({
  page,
}) => {
  // Two readings in one run: the delete path fires, and the returned
  // unsubscribe actually detaches. Without the second half, a subscription
  // that never released would still satisfy the first.
  const seen = await page.evaluate(async (b64) => {
    const p = window.__staveAssetProbe!
    const { record } = await p.import(b64, 'audio/wav', 'my_take.wav', [])
    await p.docAdd(record)
    await p.docWatch()
    await p.docRemove(record.id)
    const afterRemove = await p.docUnwatch()
    // now unsubscribed — this write must not be counted
    await p.docAdd(record)
    return { afterRemove, afterUnsubscribe: await p.docNotifyCount() }
  }, TAKE_A)
  expect(seen).toEqual({ afterRemove: 1, afterUnsubscribe: 1 })
})

// ---------------------------------------------------------------------------
// Rename — the path the naming rule needs
// ---------------------------------------------------------------------------

test('a rename replaces the name in the document', async ({ page }) => {
  const record = await seedAsset(page, TAKE_A, 'take_1.wav')
  const after = await page.evaluate(async (id) => {
    const p = window.__staveAssetProbe!
    await p.docRename(id, 'chorus')
    return (await p.docList()).map((r) => r.name)
  }, record.id)
  expect(after).toEqual(['chorus'])
})

test('a rename keeps the same id and bytes — it is not a re-import', async ({ page }) => {
  const record = await seedAsset(page, TAKE_A, 'take_1.wav')
  const after = await page.evaluate(async (before) => {
    const p = window.__staveAssetProbe!
    await p.docRename(before.id, 'chorus')
    const [now] = await p.docList()
    return { sameId: now.id === before.id, sameHash: now.blobHash === before.blobHash }
  }, record)
  expect(after).toEqual({ sameId: true, sameHash: true })
})

test('a rename onto a taken name is uniqued rather than colliding', async ({ page }) => {
  // Two records answering to one `s()` address would make the second
  // unreachable, silently.
  const first = await seedAsset(page, TAKE_A, 'chorus.wav')
  const second = await seedAsset(page, TAKE_B, 'verse.wav')
  const taken = await page.evaluate(
    async ([, b]) => {
      const p = window.__staveAssetProbe!
      return p.docRename((b as DocRecord).id, 'chorus')
    },
    [first, second],
  )
  expect(taken).toBe('chorus_2')
})

test('the renamed name is what registers after a reload', async ({ page }) => {
  const record = await seedAsset(page, TAKE_A, 'take_1.wav')
  await page.evaluate((id) => window.__staveAssetProbe!.docRename(id, 'chorus'), record.id)

  await page.reload({ waitUntil: 'domcontentloaded' })
  await bootWithProbe(page)
  await soundMapPublished(page)
  await page.waitForFunction(() => window.__staveAssetProbe!.inSoundMap('chorus'), undefined, {
    timeout: 30_000,
  })

  const seen = await page.evaluate(() => ({
    renamed: window.__staveAssetProbe!.inSoundMap('chorus'),
    original: window.__staveAssetProbe!.inSoundMap('take_1'),
  }))
  expect(seen).toEqual({ renamed: true, original: false })
})

test('renaming a record that does not exist reports null rather than creating one', async ({
  page,
}) => {
  await seedAsset(page, TAKE_A, 'take_1.wav')
  const outcome = await page.evaluate(async () => {
    const p = window.__staveAssetProbe!
    const result = await p.docRename('no-such-id', 'chorus')
    return { result, count: (await p.docList()).length }
  })
  expect(outcome).toEqual({ result: null, count: 1 })
})

// ---------------------------------------------------------------------------
// Remove
// ---------------------------------------------------------------------------

test('removing a record drops it while its sibling survives', async ({ page }) => {
  const first = await seedAsset(page, TAKE_A, 'kept.wav')
  const second = await seedAsset(page, TAKE_B, 'dropped.wav')
  const left = await page.evaluate(
    async ([, b]) => {
      const p = window.__staveAssetProbe!
      await p.docRemove((b as DocRecord).id)
      return (await p.docList()).map((r) => r.name)
    },
    [first, second],
  )
  expect(left).toEqual(['kept'])
})

test('removing a record leaves the BYTES alone — they may be shared', async ({ page }) => {
  // Two records, one blob. Dropping one reference must not take the bytes the
  // other one still points at.
  const bothLeft = await page.evaluate(async (b64) => {
    const p = window.__staveAssetProbe!
    const A = await p.import(b64, 'audio/wav', 'vocal.wav', [])
    await p.docAdd(A.record)
    const B = await p.import(b64, 'audio/wav', 'backing.wav', await p.docList())
    await p.docAdd(B.record)
    await p.docRemove(B.record.id)
    return { blobs: (await p.list()).length, records: (await p.docList()).length }
  }, TAKE_A)
  expect(bothLeft).toEqual({ blobs: 1, records: 1 })
})
