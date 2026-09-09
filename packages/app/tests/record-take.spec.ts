import { test, expect, type Page } from '@playwright/test'

import { bootApp } from './_appBoot'

/**
 * The instrument for #1504 — record a take in the browser.
 *
 * Driven through the REAL control with a fake capture device, not by calling
 * the recorder directly. A spec that called `startRecording()` from page scope
 * would pass with the button unwired, and "there is a button you can press" is
 * half of what this slice claims.
 *
 * ⚠ What was measured before any of this was written, in this same harness:
 * `MediaRecorder` offers webm/opus (no wav, no ogg), and the blob it produces
 * decodes through `fetch` → `decodeAudioData` — so there is no transcode step.
 * 700 ms of requested recording decoded to 0.66 s, which is why every duration
 * assertion below is a BAND and never an equality.
 *
 * ONE assertion per test: a second `expect` never runs once the first fails,
 * and every other block still reports passing.
 */

test.use({
  launchOptions: {
    args: [
      // A synthetic capture device that produces a real signal, so the take is
      // not silence and the decode arm means something.
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
      '--autoplay-policy=no-user-gesture-required',
    ],
  },
  permissions: ['microphone'],
})

/** How long each take records for. Long enough to be unambiguously non-empty. */
const RECORD_MS = 700

interface DocRecord {
  id: string
  name: string
  blobHash: string
  mime: string
  duration?: number
}

interface PageProbe {
  reset(): Promise<void>
  docList(): Promise<DocRecord[]>
  docRename(id: string, name: string): Promise<string | null>
  resolve(hash: string): Promise<string | null>
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

async function soundMapPublished(page: Page): Promise<void> {
  await page.waitForFunction(
    () =>
      Boolean((globalThis as unknown as { soundMap?: { get?: () => unknown } }).soundMap?.get),
    { timeout: 60_000 },
  )
}

/** Open the Library panel — the record control lives in its header. */
async function openLibrary(page: Page): Promise<void> {
  const panel = page.locator('[data-asset-library]')
  if (await panel.count()) return
  await page.getByRole('button', { name: /library/i }).first().click()
  await panel.waitFor({ timeout: 15_000 })
}

const recordButton = (page: Page) => page.locator('[data-record-take]')

/** Press record, wait, press stop, and wait for the take to be saved. */
async function recordOnce(page: Page, ms = RECORD_MS): Promise<void> {
  const button = recordButton(page)
  await button.click()
  await expect(button).toHaveAttribute('data-recording', 'true', { timeout: 15_000 })
  await page.waitForTimeout(ms)
  await button.click()
  await expect(button).toHaveAttribute('data-recording', 'false', { timeout: 15_000 })
  // The save is async (hash → store → document → register); the message is the
  // artefact that says it finished, so waiting on it beats a fixed sleep.
  await expect(page.locator('[data-record-message]')).toContainText(/Saved/, {
    timeout: 20_000,
  })
}

test.beforeEach(async ({ page }) => {
  await bootWithProbe(page)
  await page.evaluate(() => window.__staveAssetProbe!.reset())
  await openLibrary(page)
})

// ---------------------------------------------------------------------------
// A take exists
// ---------------------------------------------------------------------------

test('pressing record then stop puts one take in the project', async ({ page }) => {
  await recordOnce(page)
  const names = await page.evaluate(async () =>
    (await window.__staveAssetProbe!.docList()).map((r) => r.name),
  )
  expect(names).toEqual(['take_1'])
})

test('the take carries bytes the store can resolve and decode', async ({ page }) => {
  await recordOnce(page)
  const duration = await page.evaluate(async () => {
    const p = window.__staveAssetProbe!
    const [record] = await p.docList()
    const url = await p.resolve(record.blobHash)
    if (!url) return null
    return (await p.decode(url)).duration
  })
  // A BAND, not an equality: the encoder does not return precisely what was
  // recorded for — 700 ms requested measured 0.66 s in the grounding run.
  expect(duration).toBeGreaterThan(0.3)
})

test('the recorded take is not silence — the fake device produces a real signal', async ({
  page,
}) => {
  // Without this, every arm above would pass on an empty buffer of the right
  // length, which is the failure a recorder is most likely to have.
  await recordOnce(page)
  const peak = await page.evaluate(async () => {
    const p = window.__staveAssetProbe!
    const [record] = await p.docList()
    const url = await p.resolve(record.blobHash)
    if (!url) return null
    const ctx = new AudioContext()
    try {
      const buf = await ctx.decodeAudioData(await (await fetch(url)).arrayBuffer())
      const data = buf.getChannelData(0)
      let max = 0
      for (let i = 0; i < data.length; i++) max = Math.max(max, Math.abs(data[i]))
      return max
    } finally {
      void ctx.close()
    }
  })
  expect(peak).toBeGreaterThan(0.01)
})

test('the take is playable immediately, without a reload', async ({ page }) => {
  await soundMapPublished(page)
  await recordOnce(page)
  const seen = await page.evaluate(() => ({
    take: window.__staveAssetProbe!.inSoundMap('take_1'),
    neverRecorded: window.__staveAssetProbe!.inSoundMap('take_9'),
  }))
  // The control shares the run, so this cannot pass against a detector that
  // matches every name.
  expect(seen).toEqual({ take: true, neverRecorded: false })
})

// ---------------------------------------------------------------------------
// It survives — the claim the phase exists for
// ---------------------------------------------------------------------------

test('a take survives a reload and is addressable with no user action', async ({ page }) => {
  await recordOnce(page)

  await page.reload({ waitUntil: 'domcontentloaded' })
  await bootWithProbe(page)
  await soundMapPublished(page)

  await page.waitForFunction(() => window.__staveAssetProbe!.inSoundMap('take_1'), undefined, {
    timeout: 30_000,
  })
  const present = await page.evaluate(() => window.__staveAssetProbe!.inSoundMap('take_1'))
  expect(present).toBe(true)
})

test('the take still decodes after a reload — the bytes persisted, not just the name', async ({
  page,
}) => {
  await recordOnce(page)

  await page.reload({ waitUntil: 'domcontentloaded' })
  await bootWithProbe(page)

  const duration = await page.evaluate(async () => {
    const p = window.__staveAssetProbe!
    const [record] = await p.docList()
    const url = await p.resolve(record.blobHash)
    if (!url) return null
    return (await p.decode(url)).duration
  })
  expect(duration).toBeGreaterThan(0.3)
})

// ---------------------------------------------------------------------------
// Naming
// ---------------------------------------------------------------------------

test('a second take is take_2 — not a collision and not an overwrite', async ({ page }) => {
  await recordOnce(page)
  await recordOnce(page)
  const names = await page.evaluate(async () =>
    (await window.__staveAssetProbe!.docList()).map((r) => r.name).sort(),
  )
  expect(names).toEqual(['take_1', 'take_2'])
})

test('two takes are two blobs — a re-record is not deduplicated away', async ({ page }) => {
  // Content hashing means identical bytes collapse. Two recordings of a
  // deterministic fake device could plausibly produce identical bytes, and if
  // they did, the second take would silently share the first's audio.
  await recordOnce(page)
  await recordOnce(page)
  const hashes = await page.evaluate(async () => {
    const records = await window.__staveAssetProbe!.docList()
    return new Set(records.map((r) => r.blobHash)).size
  })
  expect(hashes).toBe(2)
})

test('a renamed take answers to its new name after a reload', async ({ page }) => {
  await recordOnce(page)
  await page.evaluate(async () => {
    const p = window.__staveAssetProbe!
    const [record] = await p.docList()
    await p.docRename(record.id, 'chorus')
  })

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

// ---------------------------------------------------------------------------
// The library shows it
// ---------------------------------------------------------------------------

/**
 * Narrow the library to the Samples type, as a user would.
 *
 * Load-bearing for two reasons, both observed. The list is VIRTUALISED and the
 * ~1850 sounds fill the window, so a take's row exists in the data and never
 * reaches the DOM unfiltered. And the panel contains the "Saved take_1"
 * confirmation message, so asserting `toContainText('take_1')` over the whole
 * panel passes with the provider unregistered entirely — which is how this arm
 * was written first, and it was green for the wrong reason.
 */
async function filterToSamples(page: Page): Promise<void> {
  await page.locator('[data-filter="asset-type-filter"] [data-chip="sample"]').click()
}

test('the take appears in the library as a user sample', async ({ page }) => {
  await recordOnce(page)
  await filterToSamples(page)
  await expect(page.locator('[data-asset-row^="sample:"]')).toHaveCount(1, {
    timeout: 15_000,
  })
})

test('the library row carries the take name', async ({ page }) => {
  await recordOnce(page)
  await filterToSamples(page)
  await expect(page.locator('[data-asset-row^="sample:"]')).toContainText('take_1', {
    timeout: 15_000,
  })
})

test('a second take adds a second row rather than replacing the first', async ({ page }) => {
  await recordOnce(page)
  await recordOnce(page)
  await filterToSamples(page)
  await expect(page.locator('[data-asset-row^="sample:"]')).toHaveCount(2, {
    timeout: 15_000,
  })
})

// ---------------------------------------------------------------------------
// The microphone is released
// ---------------------------------------------------------------------------

test('stopping ends the capture tracks rather than leaving the mic held', async ({ page }) => {
  // Not tidiness. `MediaRecorder.stop()` leaves the tracks LIVE, so the browser
  // keeps showing its recording indicator after the user believes they have
  // stopped — the app appearing to still listen is the worst thing to be wrong
  // about here. Counting live tracks is the reading; the button's own state is
  // not, because it would be "true" either way.
  const live = await page.evaluate(async () => {
    const opened: MediaStream[] = []
    const real = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
    navigator.mediaDevices.getUserMedia = async (c?: MediaStreamConstraints) => {
      const s = await real(c ?? { audio: true })
      opened.push(s)
      return s
    }
    ;(window as unknown as { __openedStreams: MediaStream[] }).__openedStreams = opened
    return opened.length
  })
  expect(live).toBe(0) // control: nothing opened before we pressed anything

  await recordOnce(page)

  const stillLive = await page.evaluate(() => {
    const opened = (window as unknown as { __openedStreams: MediaStream[] }).__openedStreams
    return opened
      .flatMap((s) => s.getTracks())
      .filter((t) => t.readyState === 'live').length
  })
  expect(stillLive).toBe(0)
})
