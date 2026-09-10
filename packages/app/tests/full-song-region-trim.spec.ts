/**
 * Full-song view: TRIM A REGION by dragging a sample mark's own edge (#1527) —
 * Playwright observation (AnviDev observe gate).
 *
 * The unit tests cover the write decision (editor `regionTrim.test.ts`) and the
 * gesture geometry (`regionEdge.test.ts`, `FullSongTimeline.test.tsx`). None of
 * them can see whether the whole loop closes in a browser, and this feature has
 * more links than most:
 *
 *   drag a mark edge → lane anchors → `detectChunk` → the chunk AGREES with what
 *   the engine says the mark plays → `regionTrimEdit` → registry write-back →
 *   the editor SOURCE gains `.begin(…)` → the debounced re-eval republishes the
 *   IR → the mark redraws playing the slice it now names.
 *
 * The link this exists for is the third one. The anchor check is the difference
 * between writing to the expression the user grabbed and writing to a shared
 * binding it happens to point at, and no unit test drives real anchors.
 *
 * We TYPE the song (not setValue) so the onChange → file store → IR-snapshot
 * path fires, as the sibling arrange specs do.
 */
import { test, expect, type Page } from '@playwright/test'
// ⚠ SHARED, not copied (#1443) — the same console reader every refusal spec uses.
import { openConsole, staveWarnings } from './_console'

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control'

/**
 * ONE voice, TWO marks, no region controls — the append path, which is the one
 * 544 of the archive's 558 documents would take.
 *
 * One voice on purpose: an expanded multi-voice lane splits into per-voice
 * sub-rows and the mark's Y stops being the row's centre line.
 */
const TAKE_SONG = '$: s("bd bd")'

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

function strudelSource(page: Page): Promise<string> {
  return page.evaluate(() => {
    const eds =
      (
        window as unknown as {
          monaco?: {
            editor?: {
              getEditors?: () => Array<{
                getModel: () => { getLanguageId?: () => string; getValue: () => string } | null
              }>
            }
          }
        }
      ).monaco?.editor?.getEditors?.() ?? []
    const t = eds.find((e) => e.getModel()?.getLanguageId?.() === 'strudel') ?? eds[0]
    return t?.getModel()?.getValue() ?? ''
  })
}

/** Expand the first lane — the gesture is inert on a collapsed one by design. */
async function expandFirstLane(page: Page): Promise<{ y: number }> {
  const lane = page.locator('[data-full-song-lane]').first()
  await lane.waitFor({ timeout: 10_000 })
  const caret = page.locator('[data-full-song-lane-expand]').first()
  await caret.click()
  await expect(lane).toHaveAttribute('data-expanded', 'true', { timeout: 5_000 })
  await page.waitForTimeout(300)
  const box = await lane.boundingBox()
  if (!box) throw new Error('no lane box after expanding')
  // The mark sits on the band's centre line, and a single-voice percussive band
  // is centred in its row — so the row's own middle is the mark's middle.
  return { y: box.y + box.height / 2 }
}

test('dragging a mark’s left edge writes .begin into the source', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console.error: ${m.text()}`)
  })

  await bootShell(page)
  await typeSongAndEval(page, TAKE_SONG)

  await page.locator('[data-full-song="root"]').waitFor({ timeout: 10_000 })
  await page.locator('[data-full-song-canvas]').waitFor({ timeout: 10_000 })
  const { y } = await expandFirstLane(page)

  // The document starts with no region at all — the state the append path needs.
  expect(await strudelSource(page)).toBe(TAKE_SONG)
  expect(await strudelSource(page)).not.toContain('.begin(')

  const grid = page.locator('[data-full-song="grid"]')
  const box = await grid.boundingBox()
  if (!box) throw new Error('no grid box')

  // ⚠ THE GRID'S CYCLE SPAN IS READ, NOT ASSUMED, and the first version of this
  // test assumed it. `$: s("bd bd")` is one cycle of content, but the view spans
  // the analysed horizon — so the second mark is NOT at 0.5·W and is NOT 0.5·W
  // wide, and a drag sized for that lands past the end of the file and clamps.
  // The value came back 0.99 (`end` − the minimum span) rather than ~0.5: the
  // mechanism was right and the arithmetic around it was wrong, which is a
  // failure mode a unit test with its own fixture geometry cannot produce.
  const cycles = await page.locator('[data-full-song-tick="major"]').count()
  expect(cycles, 'the ruler must report the span this drag is scaled against').toBeGreaterThan(0)
  const pxPerCycle = box.width / cycles
  const markW = pxPerCycle * 0.5 // each hap of `bd bd` is half a cycle
  // The second mark starts half a cycle in.
  const grabX = box.x + markW + 1
  const travel = Math.min(markW, 120)
  const dropX = grabX + travel
  // What the implementation should produce: travel over the drag scale, which is
  // the mark's own width floored at REGION_DRAG_SPAN_PX (160).
  const expected = travel / Math.max(markW, 160)
  await page.mouse.move(grabX, y)
  await page.mouse.down()
  await page.mouse.move(grabX + travel / 2, y, { steps: 4 })
  await page.mouse.move(dropX, y, { steps: 4 })

  // The ghost is the drag's only feedback — a region is a fraction of a file and
  // nothing else on screen reads it off. Asserted DURING the drag, because it is
  // gone by pointer-up.
  await expect(page.locator('[data-full-song="region-edge"]')).toBeVisible()

  await page.mouse.up()

  // The append landed and the re-eval followed.
  await expect.poll(() => strudelSource(page), { timeout: 8_000 }).toMatch(/\.begin\(0?\.\d+\)/)
  const after = await strudelSource(page)
  // Surgical: the original expression is intact and the call is appended to it.
  expect(after.startsWith('$: s("bd bd")')).toBe(true)
  const value = Number(after.match(/\.begin\((0?\.\d+)\)/)?.[1])
  // The PREDICTED value, not a range that any clamp would satisfy: within a
  // couple of pixels' worth of pointer rounding of travel ÷ the drag scale.
  // A clamp firing would show up here as 0 or 0.99, both far outside it.
  expect(
    Math.abs(value - expected),
    `expected ~${expected.toFixed(3)} from ${travel.toFixed(0)}px over a ${markW.toFixed(0)}px mark, got ${value}`,
  ).toBeLessThan(0.05)

  await page.screenshot({ path: 'test-results/region-trim.png' })
  expect(errors, `unexpected console/page errors:\n${errors.join('\n')}`).toEqual([])
})

test('a second drag REPLACES the literal rather than appending a second call', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console.error: ${m.text()}`)
  })

  await bootShell(page)
  // Starts WITH a region, so this drives the replace path — the other half of
  // the write decision, and the one that has to leave every other byte alone.
  await typeSongAndEval(page, '$: s("bd bd").begin(0.5).gain(0.8)')

  await page.locator('[data-full-song="root"]').waitFor({ timeout: 10_000 })
  await page.locator('[data-full-song-canvas]').waitFor({ timeout: 10_000 })
  const { y } = await expandFirstLane(page)

  const grid = page.locator('[data-full-song="grid"]')
  const box = await grid.boundingBox()
  if (!box) throw new Error('no grid box')

  // Same geometry discipline as above — the span is read off the ruler.
  const cycles = await page.locator('[data-full-song-tick="major"]').count()
  const markW = (box.width / Math.max(1, cycles)) * 0.5
  const grabX = box.x + markW + 1
  const travel = Math.min(markW, 100)
  await page.mouse.move(grabX, y)
  await page.mouse.down()
  await page.mouse.move(grabX - travel / 2, y, { steps: 4 })
  await page.mouse.move(grabX - travel, y, { steps: 4 })
  await page.mouse.up()

  await expect
    .poll(() => strudelSource(page), { timeout: 8_000 })
    .not.toContain('.begin(0.5)')
  const after = await strudelSource(page)
  // ONE `.begin`, not two — the replace path, not a second append.
  expect(after.match(/\.begin\(/g)?.length).toBe(1)
  // Everything downstream of it untouched.
  expect(after).toContain('.gain(0.8)')
  expect(after.startsWith('$: s("bd bd").begin(')).toBe(true)

  expect(errors, `unexpected console/page errors:\n${errors.join('\n')}`).toEqual([])
})

test('a PATTERNED region declines VISIBLY, and leaves the document alone', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console.error: ${m.text()}`)
  })

  await bootShell(page)
  // 5 of the 16 `.begin` call sites the archive exposes are quoted mini
  // patterns. A drag must not overwrite one — and, because the mark snaps back
  // on its own, "declined" and "the drag never took" look identical unless the
  // decline says so. That is the whole arm.
  const PATTERNED = '$: s("bd bd").begin("<0 0.5>")'
  await typeSongAndEval(page, PATTERNED)

  await page.locator('[data-full-song="root"]').waitFor({ timeout: 10_000 })
  await page.locator('[data-full-song-canvas]').waitFor({ timeout: 10_000 })
  const { y } = await expandFirstLane(page)

  const grid = page.locator('[data-full-song="grid"]')
  const box = await grid.boundingBox()
  if (!box) throw new Error('no grid box')
  const cycles = await page.locator('[data-full-song-tick="major"]').count()
  const markW = (box.width / Math.max(1, cycles)) * 0.5
  const grabX = box.x + markW + 1
  await page.mouse.move(grabX, y)
  await page.mouse.down()
  await page.mouse.move(grabX + markW / 2, y, { steps: 4 })
  await page.mouse.move(grabX + markW, y, { steps: 4 })
  await page.mouse.up()
  await page.waitForTimeout(1200)

  // Byte-identical: the pattern the user wrote is still exactly what it was.
  expect(await strudelSource(page)).toBe(PATTERNED)

  // And it SAID so, where the user can find it.
  await openConsole(page)
  await expect(staveWarnings(page)).toHaveCount(1)
  const text = (await staveWarnings(page).first().innerText()).toLowerCase()
  expect(text).toContain('was not applied')
  expect(text).toContain('pattern')

  expect(errors, `unexpected console/page errors:\n${errors.join('\n')}`).toEqual([])
})
