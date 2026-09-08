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
import { colorForAutomation } from '../src/components/musicalTimeline/colors'

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


/** Two automated parameters on ONE lane — the #1485 case. Both periods are slow
 *  enough to resolve as curves at the default zoom rather than as bands. */
const TWO_PARAM_SONG = 's("bd*2").cutoff(saw.slow(4).range(200, 2000)).pan(sine.slow(3))'

/** `#rrggbb` → `[r, g, b]`. */
const rgbOf = (hex: string): [number, number, number] => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
]

/**
 * Count pixels matching each EXPECTED curve colour.
 *
 * ⚠ The expected colours are read from the app's own `colorForAutomation`
 * rather than written down here. A hardcoded hex would keep passing after the
 * palette changed, which is the failure mode where a test outlives the thing it
 * describes — and it would also let a probe "find" a colour the app never draws.
 */
async function countColours(page: Page, wanted: [number, number, number][]) {
  return page.locator('[data-full-song-canvas]').evaluate(
    (el, want: number[][]) => {
      const c = el as HTMLCanvasElement
      const ctx = c.getContext('2d')!
      const img = ctx.getImageData(0, 0, c.width, c.height).data
      const counts = want.map(() => 0)
      for (let i = 0; i < img.length; i += 4) {
        for (let k = 0; k < want.length; k++) {
          // Tolerance covers the stroke's antialiased edge; the core pixels of a
          // 1.5px line land on the exact value.
          if (
            Math.abs(img[i] - want[k][0]) <= 12 &&
            Math.abs(img[i + 1] - want[k][1]) <= 12 &&
            Math.abs(img[i + 2] - want[k][2]) <= 12
          ) counts[k]++
        }
      }
      return counts
    },
    wanted.map((w) => [...w]),
  )
}

test('two automated parameters on one lane draw in different colours', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console.error: ${m.text()}`) })

  await bootShell(page)

  const wanted: [number, number, number][] = [
    rgbOf(colorForAutomation('cutoff')),
    rgbOf(colorForAutomation('pan')),
  ]
  // The two parameters must actually be given different colours, or this whole
  // observation is checking one colour twice.
  expect(wanted[0], 'cutoff and pan hash to the same palette slot — pick different params for this arm')
    .not.toEqual(wanted[1])

  // ── CONTROL ARM: ONE automated parameter keeps the lane's theme colour, so
  //    NEITHER per-parameter hue should appear. This is what separates "the
  //    hues are drawn" from "the probe matches the lane's ordinary furniture".
  await typeSongAndEval(page, AUTOMATED_SONG)
  await page.locator('[data-full-song-canvas]').waitFor({ timeout: 10_000 })
  await page.waitForTimeout(500)
  const control = await countColours(page, wanted)

  // ── The same lane, with a SECOND automated parameter.
  await typeSongAndEval(page, TWO_PARAM_SONG)
  await page.locator('[data-full-song-canvas]').waitFor({ timeout: 10_000 })
  await page.waitForTimeout(500)
  const both = await countColours(page, wanted)

  expect(
    Math.max(...control),
    `a per-parameter hue is on the canvas for a SINGLE-automation document, so this probe proves nothing: ${JSON.stringify(control)}`,
  ).toBeLessThan(20)

  expect(both[0], `no cutoff-coloured curve: ${JSON.stringify(both)}`).toBeGreaterThan(40)
  expect(both[1], `no pan-coloured curve: ${JSON.stringify(both)}`).toBeGreaterThan(40)

  expect(errors, `page/console errors: ${errors.join(' | ')}`).toEqual([])
})

/** Same parameter, same rate, same bounds — only the KIND differs, so the dash
 *  is the sole variable between these two arms (#1486). */
const FAITHFUL_SONG = 's("bd*2").cutoff(sine.slow(4).range(200, 2000))'
const FABRICATED_SONG = 's("bd*2").cutoff(perlin.slow(4).range(200, 2000))'

/**
 * How much of the curve's horizontal extent is actually painted.
 *
 * A solid stroke marks very nearly every x column it spans; a dashed one leaves
 * regular gaps, so the same span is painted in fewer columns. Measuring the
 * RATIO rather than a pixel count keeps this independent of canvas width, zoom
 * and how tall the curve happens to be.
 */
async function readCoverage(page: Page) {
  return page.locator('[data-full-song-canvas]').evaluate((el) => {
    const c = el as HTMLCanvasElement
    const ctx = c.getContext('2d')!
    const { width: W, height: H } = c
    const img = ctx.getImageData(0, 0, W, H).data
    const xs = new Set<number>()
    let minX = Infinity
    let maxX = -Infinity
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4
        const r = img[i], g = img[i + 1], b = img[i + 2]
        // The same blue-dominant detector the first test's control arm proves
        // fires on the curve and not on the lane's furniture.
        if (b > 120 && b - r > 45 && b - g > 20) {
          xs.add(x)
          if (x < minX) minX = x
          if (x > maxX) maxX = x
        }
      }
    }
    const span = maxX >= minX ? maxX - minX + 1 : 0
    return { columns: xs.size, span, coverage: span > 0 ? xs.size / span : 0 }
  })
}

test('a fabricated curve is drawn dashed, a faithful one solid', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console.error: ${m.text()}`) })

  await bootShell(page)

  await typeSongAndEval(page, FAITHFUL_SONG)
  await page.locator('[data-full-song-canvas]').waitFor({ timeout: 10_000 })
  await page.waitForTimeout(500)
  const solid = await readCoverage(page)

  await typeSongAndEval(page, FABRICATED_SONG)
  await page.locator('[data-full-song-canvas]').waitFor({ timeout: 10_000 })
  await page.waitForTimeout(500)
  const dashed = await readCoverage(page)

  // REPORT BEFORE ASSERTING: a tripped expectation must not take the two
  // measurements with it, or a failure says only "it was wrong", not "by how
  // much" — which is the difference between a bound to fix and a rule to rethink.
  // eslint-disable-next-line no-console
  console.log(`  faithful ${JSON.stringify(solid)}\n  fabricated ${JSON.stringify(dashed)}`)

  // Both arms must actually have drawn something, or the comparison below is
  // between two kinds of nothing.
  expect(solid.span, `no faithful curve on the canvas: ${JSON.stringify(solid)}`).toBeGreaterThan(50)
  expect(dashed.span, `no fabricated curve on the canvas: ${JSON.stringify(dashed)}`).toBeGreaterThan(50)

  /**
   * ⚠ A RATIO OF TWO READINGS IN ONE RUN, never an absolute coverage.
   *
   * A solid stroke does NOT mark 100% of the columns it spans — measured at
   * 0.88 for a plain `sine`, because the detector needs a blue-dominant pixel
   * and the antialiased edge of a steep segment does not always produce one.
   * An absolute bound would therefore encode this machine's antialiasing, and
   * the first threshold written here (`> 0.9`) failed for exactly that reason.
   * Comparing the two arms cancels it: same parameter, same rate, same bounds,
   * same canvas, same run.
   *
   * ⚠ THE DASH IS NOT THE ONLY VARIABLE, and this arm should not be read as
   * though it were. `perlin`'s contour is more erratic than `sine`'s, so some of
   * the drop is shape rather than stroke — measured 0.88 against 0.32, a gap far
   * wider than the dash alone accounts for. What isolates the dash is the unit
   * test (`drawTimeline.automation.test.ts`), which asserts the dash array is
   * set for stochastic kinds and empty for every faithful one. THIS arm answers
   * the different question that one cannot: whether it reaches real pixels as a
   * visibly broken stroke. Neither is sufficient alone.
   */
  expect(
    dashed.coverage,
    `a perlin curve is no more broken up than a sine one, so nothing on screen ` +
      `says it is indicative: ${JSON.stringify({ solid, dashed })}`,
  ).toBeLessThan(solid.coverage * 0.85)

  expect(errors, `page/console errors: ${errors.join(' | ')}`).toEqual([])
})

/** Read the Strudel document back out of Monaco — the artefact an edit has to
 *  reach. A green unit test proves the edit was BUILT; only this proves it
 *  landed. */
async function readDoc(page: Page): Promise<string> {
  return page.evaluate(() => {
    const eds = ((window as unknown as { monaco?: { editor?: { getEditors?: () => Array<{ getModel: () => { getValue: () => string; getLanguageId?: () => string } | null }> } } }).monaco?.editor?.getEditors?.()) ?? []
    const t = eds.find((e) => e.getModel()?.getLanguageId?.() === 'strudel') ?? eds[0]
    return t?.getModel()?.getValue() ?? ''
  })
}

/** Click at a canvas-relative point. */
async function clickCanvasAt(page: Page, x: number, y: number): Promise<void> {
  const box = await page.locator('[data-full-song-canvas]').boundingBox()
  if (!box) throw new Error('no canvas')
  await page.mouse.click(box.x + x, box.y + y)
}

/**
 * ⚠ MELODIC ON PURPOSE, and the reason is a real limit rather than a test
 * convenience. A single-voice PERCUSSIVE lane is 22px expanded (25px collapsed),
 * so its automation band is 16px — under the 22px floor a caption needs, and no
 * caption is painted there at any zoom. Observed, not assumed: the canvas stayed
 * 25px tall through the expand gesture and a full sweep of click points opened
 * nothing. A melodic lane gets four sub-rows (88px), which is where the bounds
 * are actually reachable today.
 */
const MELODIC_AUTOMATED_SONG = 'note("c3 e3 g3 b3").cutoff(saw.slow(4).range(200, 2000))'

test('a bound retyped on the caption reaches the document (#1464 Stage 2)', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console.error: ${m.text()}`)
  })

  await bootShell(page)
  await typeSongAndEval(page, MELODIC_AUTOMATED_SONG)
  await page.locator('[data-full-song-canvas]').waitFor({ timeout: 10_000 })
  await page.waitForTimeout(500)

  const editor = page.locator('[data-full-song="automation-bound"]')

  // ── (0) COLLAPSED: there is no caption, so there is nothing to click. This is
  //    the control arm for the whole gesture — without it, "an input appeared"
  //    could mean the hit-test fires anywhere on the lane.
  await clickCanvasAt(page, 40, 8)
  await page.waitForTimeout(200)
  expect(await editor.count(), 'a collapsed lane has no caption, so no editor may open').toBe(0)

  // ── EXPAND. Double-click is the app's own expand gesture; it must still work
  //    over a lane that has no caption yet, which is the case that would break
  //    if the new guard were too broad.
  const box = await page.locator('[data-full-song-canvas]').boundingBox()
  if (!box) throw new Error('no canvas')
  await page.mouse.dblclick(box.x + 200, box.y + 8)
  await page.waitForTimeout(800)
  // The expand is what makes the caption exist at all — assert it happened
  // rather than letting a silent no-op become "the caption was unreachable".
  const grew = await page.locator('[data-full-song-canvas]').evaluate((el) => (el as HTMLCanvasElement).height)
  expect(grew, 'the lane did not expand, so no caption could be painted').toBeGreaterThan(60)

  // ── FIND THE HIGH BOUND BY OBSERVATION, not by assuming a glyph width. Walk
  //    the caption line and let the app say which field each x belongs to; the
  //    input's own value is the answer. A hardcoded x would pin this test to a
  //    font that may not be installed on the machine running it.
  let found: { x: number; value: string } | null = null
  for (let x = 6; x <= 140 && !found; x += 3) {
    await clickCanvasAt(page, x, 8)
    await page.waitForTimeout(90)
    if (await editor.count()) {
      const value = await editor.inputValue()
      if (value === '2000') found = { x, value }
      else await page.keyboard.press('Escape')
      await page.waitForTimeout(60)
    }
  }
  expect(found, 'no caption field reading "2000" was reachable along the caption line').not.toBeNull()

  // ── (1) THE EDITOR OPENED ON THE FIELD THAT WAS CLICKED.
  expect(await editor.inputValue()).toBe('2000')

  // ── (2) THE EDIT REACHES THE DOCUMENT.
  const before = await readDoc(page)
  expect(before).toContain('.range(200, 2000)')
  await page.keyboard.press(`${MOD}+A`)
  await page.keyboard.type('3000')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(600)

  const after = await readDoc(page)
  expect(after, `the retyped bound did not reach the document. before=${before} after=${after}`)
    .toContain('.range(200,3000)')
  // The rest of the document is untouched — only the range leg moved.
  expect(after).toContain('note("c3 e3 g3 b3").cutoff(saw.slow(4)')

  // ── (3) THE EDITOR CLOSES on commit rather than lingering over the lane.
  expect(await editor.count()).toBe(0)

  // ── (4) ESCAPE WRITES NOTHING. Re-open the same field, type, abandon.
  await clickCanvasAt(page, found!.x, 8)
  await page.waitForTimeout(200)
  if (await editor.count()) {
    await page.keyboard.press(`${MOD}+A`)
    await page.keyboard.type('9999')
    await page.keyboard.press('Escape')
    await page.waitForTimeout(400)
    expect(await readDoc(page), 'Escape wrote to the document').not.toContain('9999')
  }

  expect(errors, `page/console errors: ${errors.join(' | ')}`).toEqual([])
})

