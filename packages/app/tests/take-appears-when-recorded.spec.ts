/**
 * The repaint signal, observed (#1509).
 *
 * ## What is unobserved without this
 *
 * The Song timeline is dirty-flagged: it repaints when the scene, transform,
 * size or silenced set changes, and never on a loop. A sample finishing its
 * decode is none of those, so warming announces itself and a counter bumps
 * purely to force a repaint.
 *
 * `take-waveform.spec.ts` covers the PROJECT-LOAD path, where a later redraw
 * happens for its own reasons — disabling the bump leaves it green at full
 * ratio. So it proves the feature and proves nothing about the signal. The path
 * that exercises the signal is the one where NOTHING else changes: the code is
 * already evaluated, the transport has not moved, the panel is the same size,
 * and a take arrives.
 *
 * ## Why the capture device is a file
 *
 * Recording through the real control needs the captured audio to have a shape,
 * or the drawn waveform cannot be told apart from the flat bar it must differ
 * from. Chromium's default fake device is NOT a uniform tone — measured here, it
 * is a sparse beep peaking at 0.23 with 0 loud windows in 20. So the capture is
 * pointed at a file that alternates loud and silent half-seconds; the same
 * measurement through `getUserMedia` reads 0.68 RMS in the loud windows, which
 * is what a 0.9 sine predicts (0.9/sqrt(2) = 0.636).
 *
 * ## What is asserted
 *
 * That the mark goes from FLAT to VARYING with no interaction of any kind after
 * the save. Reading the canvas is not an interaction — no scroll, no resize, no
 * edit, no transport move. Removing the notification must turn this red; that
 * break is the whole reason the spec exists.
 */
import { test, expect, type Page } from '@playwright/test'
import { writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { bootApp, seedCode } from './_appBoot'
import { readInk, firstMark, markVariation, alternatingWav } from './_waveformInk'

/**
 * The capture file, written at module scope because `test.use` needs its path
 * before any test runs. Failures are captured rather than thrown: a throw here
 * happens at COLLECTION and takes down the whole browser gate rather than
 * reporting one red spec.
 */
const CAPTURE = (() => {
  try {
    const path = join(mkdtempSync(join(tmpdir(), 'stave-1509-')), 'alternating.wav')
    writeFileSync(path, alternatingWav())
    return { path, error: null as string | null }
  } catch (e) {
    return { path: '', error: e instanceof Error ? e.message : String(e) }
  }
})()

test.use({
  launchOptions: {
    args: [
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
      // Known audio through the REAL recording path — see the header.
      ...(CAPTURE.path ? [`--use-file-for-fake-audio-capture=${CAPTURE.path}`] : []),
      '--autoplay-policy=no-user-gesture-required',
    ],
  },
  permissions: ['microphone'],
})

interface PageProbe {
  reset(): Promise<void>
  inSoundMap(name: string): boolean
}
/** Reached by cast, not a `declare global` — several specs already declare this
 *  name globally and a fourth declaration is a duplicate-identifier error. */
type ProbeWindow = Window & { __staveAssetProbe?: PageProbe }

/** Long enough that the take spans several of the file's loud/silent halves. */
const RECORD_MS = 1600

async function openLibrary(page: Page): Promise<void> {
  const panel = page.locator('[data-asset-library]')
  if (await panel.count()) return
  await page.getByRole('button', { name: /library/i }).first().click()
  await panel.waitFor({ timeout: 15_000 })
}

test('a recorded take appears on the timeline with no further interaction', async ({ page }) => {
  test.setTimeout(120_000)
  expect(CAPTURE.error, 'could not write the fake capture file').toBeNull()

  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))

  await bootApp(page, { e2eHooks: true, drawer: { tabId: 'musical-timeline' } })
  await page.waitForFunction(() => Boolean((window as ProbeWindow).__staveAssetProbe), { timeout: 30_000 })
  await page.evaluate(() => (window as ProbeWindow).__staveAssetProbe!.reset())

  // The lane exists and draws PLAIN marks: the code names a take that has not
  // been recorded yet, so there is nothing to draw a shape from.
  await seedCode(page, '$: s("take_1")')
  await page.evaluate(() => {
    try {
      localStorage.setItem('stave:musicalTimeline.subRowHeight', '48')
    } catch {
      /* ignore */
    }
  })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => Boolean((window as ProbeWindow).__staveAssetProbe), { timeout: 30_000 })
  await page.locator('[data-full-song-canvas]').waitFor({ timeout: 20_000 })

  // PRECONDITION 1: a mark is actually drawn. Without this the "it varies now"
  // reading below could be satisfied by a lane that simply appeared.
  await expect
    .poll(async () => firstMark(await readInk(page)).length, { timeout: 30_000 })
    .toBeGreaterThan(20)

  // PRECONDITION 2: and it is FLAT — a bar, not a shape. This is what makes the
  // later reading a CHANGE rather than a state that was always true.
  const before = markVariation(firstMark(await readInk(page)))
  // eslint-disable-next-line no-console
  console.log(`[#1509] before recording: variation=${before.toFixed(2)}`)
  expect(before).toBeLessThan(1.5)

  // Record through the real control.
  await openLibrary(page)
  const button = page.locator('[data-record-take]')
  await button.click()
  await expect(button).toHaveAttribute('data-recording', 'true', { timeout: 15_000 })
  await page.waitForTimeout(RECORD_MS)
  await button.click()
  await expect(button).toHaveAttribute('data-recording', 'false', { timeout: 15_000 })
  await expect(page.locator('[data-record-message]')).toContainText(/Saved/, { timeout: 20_000 })
  await page.waitForFunction(() => (window as ProbeWindow).__staveAssetProbe!.inSoundMap('take_1'), undefined, {
    timeout: 30_000,
  })

  // NOTHING is touched from here on. Reading pixels is not an interaction: no
  // scroll, no resize, no edit, no transport move — the only thing that can
  // repaint the canvas is the signal under test.
  await expect
    .poll(async () => markVariation(firstMark(await readInk(page))), {
      timeout: 20_000,
      message: 'the take never appeared without an interaction to force a repaint',
    })
    .toBeGreaterThan(3)

  const after = markVariation(firstMark(await readInk(page)))
  // eslint-disable-next-line no-console
  console.log(`[#1509] after recording: variation=${after.toFixed(2)}`)

  await page.screenshot({ path: 'test-results/take-appears-when-recorded.png' })
  expect(errors).toEqual([])
})
