/**
 * Full-song view: the STEPPED automation staircase (#1463 Stage 2) — Playwright
 * observation (AnviDev observe gate).
 *
 * The unit tests cover the IR read (`steppedAutomation.test.ts`, with the real
 * engine in `steppedAutomation.engine.test.ts`), the geometry
 * (`steppedLane.test.ts`) and the canvas draw against a mock context
 * (`drawTimeline.stepped.test.ts`). All of that can pass while nothing reaches the
 * screen — the `props.ir` memo, the knob-range resolution, the scene field and the
 * two barrel imports sit between them. This drives the real app.
 *
 * ⚠ IT CARRIES ITS OWN CONTROL ARM, the discipline `full-song-automation-lane.spec`
 * established: "the automation colour is on the canvas" means nothing unless the
 * same probe finds it absent for the same song with the parameter held CONSTANT.
 *
 * ⚠ AND A SECOND READING THE CURVE SPEC DOES NOT NEED. A staircase and a flat
 * rule both span the lane; what separates them is that a staircase holds MORE
 * THAN ONE LEVEL. So the probe counts the rows the stroke runs flat along, not
 * just its vertical extent — a single slanted line would have extent and no
 * levels.
 */
import { test, expect, type Page } from '@playwright/test'

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control'

/** Stepped: velocity holds three levels, one per cycle. `s("bd*2")` keeps the
 *  lane's own marks sparse so the stroke is not competing with note rects. */
const STEPPED_SONG = 's("bd*2").velocity("<.2 .9 .5>")'
/** The control: the same song, the same lane, the parameter held constant. */
const CONSTANT_SONG = 's("bd*2").velocity(.5)'

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

/** The canvas's blue channel, one value per pixel, row-major. */
async function readBlue(page: Page): Promise<{ W: number; H: number; blue: number[] }> {
  return page.locator('[data-full-song-canvas]').evaluate((el) => {
    const c = el as HTMLCanvasElement
    const { width: W, height: H } = c
    const img = c.getContext('2d')!.getImageData(0, 0, W, H).data
    const blue = new Array<number>(W * H)
    for (let p = 0; p < W * H; p++) blue[p] = img[p * 4 + 2]
    return { W, H, blue }
  })
}

/**
 * The automation stroke, isolated AGAINST THE CONTROL RENDER, and the flat LEVELS
 * it holds.
 *
 * ⚠ WHY A DIFFERENCE AND NOT A COLOUR TEST. The first version of this spec used
 * the curve spec's absolute test (blue leads red by 45 and green by 20). It counted
 * 2 levels for a 3-step song, and the product was right: a collapsed percussive
 * lane paints its note marks across the MIDDLE rows, and the staircase's middle
 * step (`.5`) runs straight across that orange bar, where a 75%-alpha blue stroke
 * blends to a colour the absolute test rejects. Measured, then seen in a
 * screenshot, before anything was changed. The staircase was drawn; the instrument
 * was blind exactly where one of its levels sits.
 *
 * So a pixel is stroke when its blue is well ABOVE the same pixel in the control
 * render — the same song, same lane, same marks, the parameter held constant, and
 * so no automation at all. Whatever sits underneath, the stroke adds blue and
 * nothing else on the lane does.
 *
 * A LEVEL is a pixel row the stroke runs along for a long horizontal stretch: a
 * staircase has one per distinct step, a riser contributes a column, not a row.
 */
function strokeAgainst(
  subject: { W: number; H: number; blue: number[] },
  control: { W: number; H: number; blue: number[] },
) {
  const { W, H } = subject
  const perRow = new Array<number>(H).fill(0)
  const xs = new Set<number>()
  let hits = 0
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const p = y * W + x
      if (subject.blue[p] - control.blue[p] > 60) {
        hits++
        xs.add(x)
        perRow[y]++
      }
    }
  }
  // A row is a level when the stroke covers at least a tenth of the width along
  // it; contiguous qualifying rows are one level (a 1.5px stroke antialiases over
  // two or three rows).
  const minRun = Math.floor(W * 0.1)
  let levels = 0
  let inLevel = false
  for (let y = 0; y < H; y++) {
    if (perRow[y] >= minRun) {
      if (!inLevel) levels++
      inLevel = true
    } else {
      inLevel = false
    }
  }
  return { hits, xSpread: xs.size, levels, W, H }
}

test('a stepped parameter draws a staircase on its lane', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console.error: ${m.text()}`)
  })

  await bootShell(page)

  // ── The control render: the same song with the parameter held constant.
  await typeSongAndEval(page, CONSTANT_SONG)
  await page.locator('[data-full-song-canvas]').waitFor({ timeout: 10_000 })
  await page.waitForTimeout(500)
  const controlPixels = await readBlue(page)

  await typeSongAndEval(page, STEPPED_SONG)
  await page.locator('[data-full-song-canvas]').waitFor({ timeout: 10_000 })
  await page.waitForTimeout(500)
  const steppedPixels = await readBlue(page)

  // (0) THE TWO RENDERS ARE COMPARABLE — a difference between canvases of
  //     different sizes would measure the layout, not the stroke.
  expect([steppedPixels.W, steppedPixels.H]).toEqual([controlPixels.W, controlPixels.H])

  const stepped = strokeAgainst(steppedPixels, controlPixels)
  // The instrument's own control: the control render against ITSELF must find
  // nothing, or the threshold is matching noise.
  const control = strokeAgainst(controlPixels, controlPixels)

  // (1) THE INSTRUMENT IS CLEAN.
  expect(control.hits, `the detector fires on an identical render: ${JSON.stringify(control)}`).toBe(0)

  // (2) THERE IS A SIGNAL, before any claim about its shape.
  expect(
    stepped.hits,
    `no automation stroke found on the canvas: ${JSON.stringify(stepped)}`,
  ).toBeGreaterThan(control.hits + 100)

  // (3) IT SPANS THE LANE.
  expect(stepped.xSpread, `stroke does not span the lane: ${JSON.stringify(stepped)}`)
    .toBeGreaterThan(stepped.W * 0.5)

  // (4) IT IS A STAIRCASE — the three distinct steps are three flat levels. A
  //     flat rule has one; a slanted line has none.
  expect(stepped.levels, `expected three flat levels, one per step: ${JSON.stringify(stepped)}`)
    .toBe(3)

  // (5) The new scene field and the two new barrel imports flow cleanly.
  expect(errors, `page/console errors: ${errors.join(' | ')}`).toEqual([])
})
