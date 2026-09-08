/**
 * Full-song view: the continuous-automation curve (#1464 Stage 1) — Playwright
 * observation (AnviDev observe gate).
 *
 * The unit tests cover the IR read (`signalAutomation.test.ts`) and the canvas
 * draw against a mock context (`drawTimeline.automation.test.ts`). This drives
 * the REAL app end-to-end, because those two can both pass while nothing reaches
 * the screen — the scene wiring, the theme entry and the `props.ir` memo all sit
 * between them and are covered by neither.
 *
 * ⚠ IT CARRIES ITS OWN CONTROL ARM. "The automation colour appears on the canvas"
 * is not evidence unless the same probe finds it ABSENT for a document with no
 * automation: a detector tuned loosely enough to match the lane's own colours
 * would pass on every document, including the ones this feature does nothing for.
 * The negative arm is what separates "the curve drew" from "the probe matches
 * anything blue".
 */
import { test, expect, type Page } from '@playwright/test'

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control'

/** Automated: cutoff swept by a slow saw. `s("bd")` alone keeps the lane's own
 *  marks sparse so the curve is not competing with a wall of note rects. */
const AUTOMATED_SONG = 's("bd*2").cutoff(saw.slow(4).range(200, 2000))'
/** The control: byte-for-byte the same song with a CONSTANT cutoff. Same lane,
 *  same marks, same colours — the only difference is the thing under test. */
const CONSTANT_SONG = 's("bd*2").cutoff(800)'

async function bootShell(page: Page): Promise<void> {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('stave:bottomPanel.height', '340')
      localStorage.setItem('stave:bottomPanel.open', 'true')
      localStorage.setItem('stave:bottomPanel.activeTabId', 'musical-timeline')
    } catch {
      /* ignore */
    }
  })
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await page.locator('[data-bottom-panel="root"]').waitFor({ timeout: 20_000 })
  await page.waitForFunction(
    () => ((window as unknown as { monaco?: { editor?: { getEditors?: () => unknown[] } } }).monaco?.editor?.getEditors?.()?.length ?? 0) > 0,
    { timeout: 20_000 },
  )
}

async function typeSongAndEval(page: Page, code: string): Promise<void> {
  await page.evaluate(() => {
    const eds = ((window as unknown as { monaco?: { editor?: { getEditors?: () => Array<{ getModel: () => { getLanguageId?: () => string } | null; focus: () => void }> } } }).monaco?.editor?.getEditors?.()) ?? []
    const t = eds.find((e) => e.getModel()?.getLanguageId?.() === 'strudel') ?? eds[0]
    t?.focus()
  })
  await page.locator('.monaco-editor').first().click()
  await page.keyboard.press(`${MOD}+A`)
  await page.keyboard.press('Backspace')
  await page.keyboard.type(code, { delay: 8 })
  await page.waitForTimeout(400)
  await page.keyboard.press(`${MOD}+Enter`)
  await page.waitForTimeout(1800)
}

/**
 * Find the automation stroke on the canvas.
 *
 * The theme stroke is `rgba(140,200,255,0.75)` — distinctly blue-dominant. The
 * detector requires blue to lead BOTH other channels by a clear margin and the
 * pixel to be bright, which the background (`#0f0f1a`), the row/section washes
 * (white at 2–7% alpha) and the clip furniture all fail. The control arm is what
 * proves that claim rather than assuming it.
 */
async function readCurve(page: Page) {
  return page.locator('[data-full-song-canvas]').evaluate((el) => {
    const c = el as HTMLCanvasElement
    const ctx = c.getContext('2d')!
    const { width: W, height: H } = c
    const img = ctx.getImageData(0, 0, W, H).data
    let hits = 0
    let minY = Infinity
    let maxY = -Infinity
    const xs = new Set<number>()
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4
        const r = img[i], g = img[i + 1], b = img[i + 2]
        if (b > 120 && b - r > 45 && b - g > 20) {
          hits++
          xs.add(x)
          if (y < minY) minY = y
          if (y > maxY) maxY = y
        }
      }
    }
    return { hits, xSpread: xs.size, ySpread: maxY >= minY ? maxY - minY : 0, W, H }
  })
}

test('a continuously automated parameter draws a curve on its lane', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console.error: ${m.text()}`)
  })

  await bootShell(page)

  // ── CONTROL ARM FIRST, so a detector that matches everything is caught before
  //    the positive result can be believed.
  await typeSongAndEval(page, CONSTANT_SONG)
  await page.locator('[data-full-song-canvas]').waitFor({ timeout: 10_000 })
  await page.waitForTimeout(500)
  const control = await readCurve(page)

  // ── The same song, automated.
  await typeSongAndEval(page, AUTOMATED_SONG)
  await page.locator('[data-full-song-canvas]').waitFor({ timeout: 10_000 })
  await page.waitForTimeout(500)
  const automated = await readCurve(page)

  // (1) THE CONTROL IS CLEAN — a constant parameter draws no curve.
  expect(
    control.hits,
    `the detector fires on a document with NO automation, so it proves nothing: ${JSON.stringify(control)}`,
  ).toBeLessThan(20)

  // (2) THERE IS A SIGNAL. Asserted before any claim about its shape.
  expect(
    automated.hits,
    `no automation stroke found on the canvas: ${JSON.stringify(automated)}`,
  ).toBeGreaterThan(control.hits + 100)

  // (3) IT IS A CURVE, not a flat line: it moves vertically while spanning the
  //     lane horizontally. A horizontal rule would satisfy (2) and fail here.
  expect(automated.xSpread, `stroke does not span the lane: ${JSON.stringify(automated)}`)
    .toBeGreaterThan(automated.W * 0.5)
  expect(automated.ySpread, `stroke is flat — no modulation drawn: ${JSON.stringify(automated)}`)
    .toBeGreaterThan(6)

  // (4) The new scene field flows through the app's IR consumers cleanly.
  expect(errors, `page/console errors: ${errors.join(' | ')}`).toEqual([])
})
