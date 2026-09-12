/**
 * Full-song view: point a section at a different PART (#1560) — Playwright
 * observation (AnviDev observe gate).
 *
 * The editor unit arms cover the two primitives (`setArmPattern` on the arrange
 * spelling, `setArmHead` on the pick one) and the list of what may be offered.
 * None of them can say whether a musician can reach any of it: the whole defect
 * this closes was that the mechanics existed and no gesture did. So this drives
 * the real app — select a clip, press `P`, choose from the list that opens, and
 * read the DOCUMENT back.
 *
 * ⚠ THE CLAIM THAT NEEDS A DOCUMENT AND NOT A CANVAS is which arms moved. A
 * returning section is one part arranged twice, and this gesture must move only
 * the section the user clicked — the rename is the op where touching a name
 * necessarily moves every arm that uses it. Two arms naming the same part, one
 * of them re-pointed, is the shape that tells those two apart, and it is read
 * off the source text rather than inferred from the picture.
 */
import { test, expect, type Page } from '@playwright/test'

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control'

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

function strudelSource(page: Page): Promise<string> {
  return page.evaluate(() => {
    const eds = ((window as unknown as { monaco?: { editor?: { getEditors?: () => Array<{ getModel: () => { getLanguageId?: () => string; getValue: () => string } | null }> } } }).monaco?.editor?.getEditors?.()) ?? []
    const t = eds.find((e) => e.getModel()?.getLanguageId?.() === 'strudel') ?? eds[0]
    return t?.getModel()?.getValue() ?? ''
  })
}

/** Wait for the song canvas, then click at `frac` of the grid's width. */
async function selectClipAt(page: Page, frac: number): Promise<ReturnType<Page['locator']>> {
  await page.locator('[data-full-song="root"]').waitFor({ timeout: 10_000 })
  await page.locator('[data-full-song-lane]').first().waitFor({ timeout: 10_000 })
  await page.locator('[data-full-song-canvas]').waitFor({ timeout: 10_000 })
  await page.waitForTimeout(400)
  const grid = page.locator('[data-full-song="grid"]')
  const box = await grid.boundingBox()
  if (!box) throw new Error('no grid box')
  await page.mouse.click(box.x + box.width * frac, box.y + 8)
  await expect(page.locator('[data-full-song="clip-selection"]')).toBeVisible({ timeout: 5_000 })
  return grid
}

test('a returning section is re-pointed on the clicked arm ALONE (arrange)', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console.error: ${m.text()}`)
  })

  await bootShell(page)
  // Arms 0 and 2 both play `bass` — a part arranged twice, which is what a
  // returning chorus is. Re-pointing the LAST one must leave the first exactly
  // as it was.
  //
  // ⚠ THE MIDDLE ARM IS NOT DECORATION. `arrange([2, bass], [2, bass])` repeats
  // every 2 cycles, so the canvas draws ONE cycle-pair and a click at any x
  // lands on arm 0 — measured, after this arm was first written that way and
  // re-pointed the wrong section. A returning section is only addressable when
  // something else sits between its two appearances.
  await typeSongAndEval(page, ['const bass = s("bd")', 'const lead = s("hh")', 'arrange([2, bass], [2, lead], [2, bass])'].join('\n'))
  const grid = await selectClipAt(page, 0.9)
  // ⚠ Scoped to the gesture: the harness types into a LIVE editor, so the
  // runtime genuinely evaluates half-written code on the way in and says so.
  errors.length = 0

  await grid.press('p')

  const chooser = page.locator('[data-full-song="section-part"]')
  await expect(chooser).toBeVisible({ timeout: 5_000 })
  // The list is the document's own parts, and the section's current one is
  // preselected rather than offered as a change.
  expect(await chooser.locator('option').allTextContents()).toEqual(['bass', 'lead'])
  await expect(chooser).toHaveValue('bass')

  await chooser.selectOption('lead')

  await expect.poll(() => strudelSource(page), { timeout: 8_000 }).toContain(
    'arrange([2, bass], [2, lead], [2, lead])',
  )
  const after = await strudelSource(page)
  // eslint-disable-next-line no-console
  console.log(`[#1560] after assign: ${after.split('\n').pop()}`)
  // Arm 0 still plays bass — exactly one `bass` left in the call, beside its
  // declaration. Zero would mean the rename ran; two would mean nothing moved.
  expect(after.match(/\bbass\b/g) ?? []).toHaveLength(2)
  // And the declarations themselves never moved: this is not the rename.
  expect(after).toContain('const bass = s("bd")')
  expect(after).toContain('const lead = s("hh")')

  await page.screenshot({ path: 'test-results/assign-part-arrange.png' })
  expect(errors, `unexpected console/page errors:\n${errors.join('\n')}`).toEqual([])
})

test('the same gesture re-points a section of the OTHER spelling, and the object stays put', async ({ page }) => {
  // #1462's rule: a keypress means one thing whichever way the song is written.
  // Here the two spellings write different bytes for the same intent — the arm
  // is an expression on one side and a name resolving into an object on the
  // other — so "same gesture" has to be observed, not assumed from the routing.
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console.error: ${m.text()}`)
  })

  await bootShell(page)
  await typeSongAndEval(
    page,
    [
      'const verse = s("bd")',
      'const chorus = s("hh")',
      '"<verse@2 chorus@2>".pickRestart({verse, chorus})',
    ].join('\n'),
  )
  const grid = await selectClipAt(page, 0.75)
  errors.length = 0

  await grid.press('p')
  const chooser = page.locator('[data-full-song="section-part"]')
  await expect(chooser).toBeVisible({ timeout: 5_000 })
  expect(await chooser.locator('option').allTextContents()).toEqual(['verse', 'chorus'])

  await chooser.selectOption('verse')

  await expect.poll(() => strudelSource(page), { timeout: 8_000 }).toContain('"<verse@2 verse@2>"')
  const after = await strudelSource(page)
  // eslint-disable-next-line no-console
  console.log(`[#1560] after assign (pick): ${after.split('\n').pop()}`)
  // ⚠ The SECTION OBJECT is byte-verbatim. Rewriting it would have renamed a
  // section instead of re-pointing one, which is the neighbouring op.
  expect(after).toContain('.pickRestart({verse, chorus})')

  await page.screenshot({ path: 'test-results/assign-part-pick.png' })
  expect(errors, `unexpected console/page errors:\n${errors.join('\n')}`).toEqual([])
})

test('with nothing to offer the chooser SAYS so, and Escape writes nothing', async ({ page }) => {
  // ⚠ The distinction this arm exists for: a gesture that declined and a gesture
  // that does not exist look identical from the outside. A song written with no
  // named parts has nowhere to point a section — the chooser still opens and
  // says that, rather than the keypress doing nothing at all.
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console.error: ${m.text()}`)
  })

  await bootShell(page)
  const song = 'arrange([2, s("bd")], [2, s("hh")])'
  await typeSongAndEval(page, song)
  const grid = await selectClipAt(page, 0.25)
  errors.length = 0

  await grid.press('p')
  const chooser = page.locator('[data-full-song="section-part"]')
  await expect(chooser).toBeVisible({ timeout: 5_000 })
  const options = await chooser.locator('option').allTextContents()
  // eslint-disable-next-line no-console
  console.log(`[#1560] options with no parts: ${JSON.stringify(options)}`)
  expect(options).toContain('no other parts in this song')
  // The section plays an inline expression, which has no name to preselect — the
  // ordinal the clip already draws is shown instead of a guess at the music.
  expect(options.some((o) => o.includes('(expression)'))).toBe(true)

  await chooser.press('Escape')
  await expect(chooser).toBeHidden({ timeout: 5_000 })
  await page.waitForTimeout(600)
  expect(await strudelSource(page)).toBe(song)

  expect(errors, `unexpected console/page errors:\n${errors.join('\n')}`).toEqual([])
})
