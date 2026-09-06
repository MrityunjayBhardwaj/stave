/**
 * A pick-spelled song's section names reach the canvas (#1467) — Playwright observation.
 *
 * The sibling of `full-song-section-names.spec.ts`, for the OTHER spelling of an
 * arrangement. That one proves `arrange([2, introduction], …)` captions its
 * clips; this one proves `"<introduction@2 …>".pickRestart({introduction, …})`
 * does too, which it did not until the structural walk started carrying a
 * `NamedPick` entry's `keyLoc` out as the arm's range.
 *
 * The method is that spec's, unchanged and for its reasons: canvas text cannot
 * be queried from the DOM and OCR is not a test, so the two documents below are
 * IDENTICAL IN EVERY WAY THAT DRAWS — same tempo, same samples, same two
 * sections, same boundaries, same marks — and differ only in how long the
 * section names are. The extra ink in the long-named run IS the caption.
 *
 * ⚠ WHAT MAKES THIS ARM MEAN SOMETHING is that before the fix both runs drew
 * `§1` / `§2`, so the ink difference was zero. Reverting the walk turns this red
 * and leaves its arrange-spelling sibling green — which is the whole point of
 * having both: one spelling's caption arm cannot see the other's regression.
 */
import { test, expect, type Page } from '@playwright/test'

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control'

/** Long names, pick spelling. Two sections, 2 cycles each. */
const LONG_NAMES = [
  'const introduction = s("bd")',
  'const development = s("hh")',
  '"<introduction@2 development@2>".pickRestart({introduction, development})',
].join('\n')

/** The SAME music, one-character names. */
const SHORT_NAMES = [
  'const a = s("bd")',
  'const b = s("hh")',
  '"<a@2 b@2>".pickRestart({a, b})',
].join('\n')

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
    () =>
      ((window as unknown as { monaco?: { editor?: { getEditors?: () => unknown[] } } }).monaco
        ?.editor?.getEditors?.()?.length ?? 0) > 0,
    { timeout: 20_000 },
  )
}

/** The strudel editor's current text — read back so a typing artefact cannot be
 *  mistaken for a product result. Monaco auto-closes brackets and quotes, and a
 *  document that accumulated a stray `)` parses to something else entirely while
 *  still drawing SOMETHING. */
async function modelText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const eds =
      (
        window as unknown as {
          monaco?: {
            editor?: {
              getEditors?: () => Array<{ getModel: () => { getValue: () => string; getLanguageId?: () => string } | null }>
            }
          }
        }
      ).monaco?.editor?.getEditors?.() ?? []
    const t = eds.find((e) => e.getModel()?.getLanguageId?.() === 'strudel') ?? eds[0]
    return t?.getModel()?.getValue() ?? ''
  })
}

/** TYPE the song — a programmatic setValue does not update the file store the
 *  IR snapshot is parsed from. */
async function typeSongAndEval(page: Page, code: string): Promise<void> {
  await page.evaluate(() => {
    const eds =
      (
        window as unknown as {
          monaco?: {
            editor?: {
              getEditors?: () => Array<{
                getModel: () => { getLanguageId?: () => string } | null
                focus: () => void
              }>
            }
          }
        }
      ).monaco?.editor?.getEditors?.() ?? []
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

interface Reading {
  readonly ink: number
  readonly distinctColumns: number
  readonly lanes: number
  readonly canvasW: number
  readonly canvasH: number
}

async function read(page: Page, code: string, label: string): Promise<Reading> {
  await typeSongAndEval(page, code)

  // The instrument before the product: if Monaco's auto-closing turned the typed
  // song into a different document, everything below is measuring that instead.
  const typed = await modelText(page)
  expect(
    typed.replace(/\s+/g, ' ').trim(),
    `[${label}] the editor does not hold the song that was typed — measuring a typing artefact`,
  ).toBe(code.replace(/\s+/g, ' ').trim())

  await page.locator('[data-full-song="root"]').waitFor({ timeout: 10_000 })
  await page.locator('[data-full-song-lane]').first().waitFor({ timeout: 10_000 })
  await page.locator('[data-full-song-canvas]').waitFor({ timeout: 10_000 })
  await page.waitForTimeout(500)

  const lanes = await page.locator('[data-full-song-lane]').count()
  const band = await page.locator('[data-full-song-canvas]').evaluate((el) => {
    const c = el as HTMLCanvasElement
    const ctx = c.getContext('2d')!
    const W = c.width
    const yBand = c.height
    const img = ctx.getImageData(0, 0, W, yBand).data
    let ink = 0
    const cols = new Set<number>()
    for (let x = 0; x < W; x++) {
      let sum = 0
      for (let y = 0; y < yBand; y++) {
        const i = (y * W + x) * 4
        sum += img[i]! + img[i + 1]! + img[i + 2]!
      }
      cols.add(sum)
      ink += sum
    }
    return { ink, distinctColumns: cols.size, canvasW: W, canvasH: yBand }
  })

  const reading: Reading = { ...band, lanes }
  // eslint-disable-next-line no-console
  console.log(
    `[#1467 ${label}] PRECONDITION — lanes: ${reading.lanes}, canvas ${reading.canvasW}x${reading.canvasH}, ` +
      `distinct columns: ${reading.distinctColumns}, ink: ${reading.ink}`,
  )
  expect(reading.canvasH, `[${label}] canvas has no height — nothing can be observed`).toBeGreaterThan(8)
  expect(reading.lanes, `[${label}] no lane rendered — nothing to caption`).toBeGreaterThan(0)
  expect(
    reading.distinctColumns,
    `[${label}] flat column profile — the canvas drew nothing, so any ink comparison below is meaningless`,
  ).toBeGreaterThan(1)
  return reading
}

test('a pick-spelled section puts its name on the canvas', async ({ page }) => {
  test.setTimeout(120_000)
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console.error: ${m.text()}`)
  })

  await bootShell(page)

  // The harness proves it can see a change in the MUSIC before it is trusted to
  // report the absence of one in the CAPTIONS — the trap the sibling spec's
  // header documents at length.
  const sparse = await read(page, '"<a@2 b@2>".pickRestart({a: s("bd"), b: s("hh")})', 'CONTROL sparse')
  const dense = await read(page, '"<a@2 b@2>".pickRestart({a: s("bd*16"), b: s("hh*16")})', 'CONTROL dense')
  // eslint-disable-next-line no-console
  console.log(`[#1467] CONTROL sparse=${sparse.ink} dense=${dense.ink} delta=${dense.ink - sparse.ink}`)
  expect(
    dense.ink,
    `the harness cannot see a change in the MUSIC (sparse=${sparse.ink}, dense=${dense.ink}) — it is not observing the canvas, so nothing it says about captions means anything`,
  ).not.toBe(sparse.ink)

  const short = await read(page, SHORT_NAMES, 'short names')
  const long = await read(page, LONG_NAMES, 'long names')

  // eslint-disable-next-line no-console
  console.log(`[#1467] ink  short=${short.ink}  long=${long.ink}  delta=${long.ink - short.ink}`)

  expect(
    long.ink,
    `the long-named sections drew no more ink than the short-named ones — a pick-spelled song's captions are not on the canvas (short=${short.ink}, long=${long.ink})`,
  ).toBeGreaterThan(short.ink)

  expect(errors, `page errors while drawing captions: ${errors.join(' | ')}`).toEqual([])
})
