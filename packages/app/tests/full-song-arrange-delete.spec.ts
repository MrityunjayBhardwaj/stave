/**
 * Full-song view: DELETE a clip by selecting it + pressing Delete (#386 /
 * Phase 5c) — Playwright observation (AnviDev observe gate).
 *
 * The unit tests cover the substrate (editor arrange.test.ts: removeArm) and the
 * gesture (FullSongTimeline.test.tsx: select body + Delete → onDeleteClip). This
 * drives the REAL app end-to-end to prove the whole write-back loop works:
 *   click a clip body → select → Delete → remove-arm serializer → registry
 *   write-back → the editor SOURCE loses that arm → the debounced re-eval
 *   republishes the IR → the lane disappears.
 *
 * We TYPE the song (not setValue) so the onChange → file store → IR-snapshot
 * path fires (same reason as the trim spec).
 */
import { test, expect, type Page } from '@playwright/test'

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control'

// Two arms, period 2 + 2 = 4. Arm 0 (bd) spans cycles [0,2) → its body sits in
// the first half of the first lane. Bare patterns so the body isn't obscured.
const ARRANGE_SONG = 'arrange([2, s("bd")], [2, s("hh")])'

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

test('selecting arm 0’s clip and pressing Delete leaves a GAP (silence) in its place', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console.error: ${m.text()}`)
  })

  await bootShell(page)
  await typeSongAndEval(page, ARRANGE_SONG)

  // Song canvas is the only timeline view now (#497/U5) -- wait for it.
  await page.locator('[data-full-song="root"]').waitFor({ timeout: 10_000 })
  await page.locator('[data-full-song-lane]').first().waitFor({ timeout: 10_000 })
  await page.locator('[data-full-song-canvas]').waitFor({ timeout: 10_000 })
  await page.waitForTimeout(400)

  expect(await strudelSource(page)).toContain('arrange([2, s("bd")]')

  // Click arm 0's body (the bd lane, first half = cycle ~1 of 4 → 0.25·W) to
  // select it — well clear of the edges at 0 and 0.5·W so it's a body, not a trim.
  const grid = page.locator('[data-full-song="grid"]')
  const box = await grid.boundingBox()
  if (!box) throw new Error('no grid box')
  const y = box.y + 8 // first (bd) lane row
  await page.mouse.click(box.x + box.width * 0.25, y)
  await expect(page.locator('[data-full-song="clip-selection"]')).toBeVisible({ timeout: 5_000 })

  // Delete the selected clip → its pattern is replaced with `silence`, KEEPING
  // its width (#491 — a gap, not a ripple; later clips stay put). Use grid.press
  // (focuses the widget first) not page.keyboard.press after a mouse.click — the
  // latter dispatches to document.body (P178).
  await grid.press('Delete')

  // The silence-arm edit applied to the model; the debounced re-eval follows.
  // arm 0 becomes `[2, silence]`, arm 1 (hh) unchanged in place.
  await expect.poll(() => strudelSource(page), { timeout: 8_000 }).toContain(
    'arrange([2, silence], [2, s("hh")])',
  )
  // arm 0's bd pattern is gone (replaced by silence); hh stays.
  expect(await strudelSource(page)).not.toContain('s("bd")')

  await page.screenshot({ path: 'test-results/arrange-delete.png' })
  expect(errors, `unexpected console/page errors:\n${errors.join('\n')}`).toEqual([])
})

/**
 * Select arm 0's clip body and send `key` to the focused grid.
 *
 * ⚠ `grid.press`, never `page.keyboard.press` after a `mouse.click` — the latter
 * dispatches to `document.body` and never reaches the widget (P178).
 */
async function selectArm0AndPress(page: Page, key: string): Promise<void> {
  const grid = page.locator('[data-full-song="grid"]')
  const box = await grid.boundingBox()
  if (!box) throw new Error('no grid box')
  // Arm 0 (bd) spans cycles [0,2) of 4 → its body sits at 0.25·W, well clear of
  // the edges at 0 and 0.5·W so this is a body press and not a trim.
  await page.mouse.click(box.x + box.width * 0.25, box.y + 8)
  await expect(page.locator('[data-full-song="clip-selection"]')).toBeVisible({ timeout: 5_000 })
  await grid.press(key)
}

test('ripple delete makes the song SHORTER, where plain Delete leaves it exactly as long', async ({ page }) => {
  // #1460. The claim is not "ripple removes an arm" — it is that Stave now has
  // TWO delete gestures that mean different things, and the only way to say that
  // is to perform both on the same song and show the results differ.
  //
  // Both halves run in ONE test, against one boot and one typed document, so the
  // contrast cannot be an artefact of two page loads.
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console.error: ${m.text()}`)
  })

  await bootShell(page)

  // ── RIPPLE ───────────────────────────────────────────────────────────────
  await typeSongAndEval(page, ARRANGE_SONG)
  await page.locator('[data-full-song="root"]').waitFor({ timeout: 10_000 })
  await page.locator('[data-full-song-lane]').first().waitFor({ timeout: 10_000 })
  await page.locator('[data-full-song-canvas]').waitFor({ timeout: 10_000 })
  await page.waitForTimeout(400)
  expect(await strudelSource(page)).toContain('arrange([2, s("bd")]')

  // ⚠ THE ERROR ASSERTION IS SCOPED TO THE GESTURE, AND HERE IS WHY.
  // `typeSongAndEval` types character by character into a LIVE editor, and the
  // runtime evaluates as it goes — so it genuinely evaluates `arra` on the way to
  // `arrange`, and reports `arra is not defined`. That is a live-coding editor
  // working exactly as designed, not a defect, and it is noise from the harness
  // rather than from anything under test. Clearing here keeps the claim the arm
  // actually makes: THE GESTURE raised nothing.
  errors.length = 0

  await selectArm0AndPress(page, `${MOD}+Shift+Delete`)

  // The arm is GONE and nothing took its place — two arms became one, and the
  // song's total weight fell from 4 cycles to 2.
  await expect.poll(() => strudelSource(page), { timeout: 8_000 }).toBe(
    'arrange([2, s("hh")])',
  )
  const rippled = await strudelSource(page)
  // eslint-disable-next-line no-console
  console.log(`[#1460] after ripple: ${rippled}`)
  // Not merely "bd is gone": a `silence` here would mean the plain gesture ran.
  expect(rippled).not.toContain('silence')

  // ── PLAIN DELETE, the control, on the same song in the same session ───────
  await typeSongAndEval(page, ARRANGE_SONG)
  await page.locator('[data-full-song-canvas]').waitFor({ timeout: 10_000 })
  await page.waitForTimeout(400)
  expect(await strudelSource(page)).toContain('arrange([2, s("bd")]')
  errors.length = 0 // the same typing noise, for the same reason

  await selectArm0AndPress(page, 'Delete')

  // Two arms still, the first one holding silence at its original width. THIS is
  // what makes the reading above mean "ripple", rather than "delete, observed".
  await expect.poll(() => strudelSource(page), { timeout: 8_000 }).toBe(
    'arrange([2, silence], [2, s("hh")])',
  )
  // eslint-disable-next-line no-console
  console.log(`[#1460] after plain delete: ${await strudelSource(page)}`)

  expect(errors, `unexpected console/page errors:\n${errors.join('\n')}`).toEqual([])
})

test('the plain Delete chord is NOT widened by adding Shift when ripple is unavailable', async ({ page }) => {
  // The guard, stated as its own arm because ordering guards are invisible.
  //
  // The plain-delete branch matches `Delete`/`Backspace` with no modifier check,
  // so before #1460 the ripple chord reached it and cleared the clip in place —
  // the same fall-through that had ⌘⇧D quietly duplicating (#1421). Here the
  // chord is pressed with a clip selected and must produce the RIPPLE result, not
  // the gap result; if the ordering were wrong this arm reads `[2, silence]`.
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))

  await bootShell(page)
  await typeSongAndEval(page, ARRANGE_SONG)
  await page.locator('[data-full-song-canvas]').waitFor({ timeout: 10_000 })
  await page.waitForTimeout(400)
  errors.length = 0 // typing noise, as above — the claim is about the gesture

  await selectArm0AndPress(page, `${MOD}+Shift+Backspace`)

  // Backspace as well as Delete — the plain branch accepts both, so the ripple
  // branch has to accept both or the chord means one thing on one key and
  // something else on the other.
  await expect.poll(() => strudelSource(page), { timeout: 8_000 }).toBe(
    'arrange([2, s("hh")])',
  )

  expect(errors, `unexpected console/page errors:\n${errors.join('\n')}`).toEqual([])
})
