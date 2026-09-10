/**
 * Full-song view: DUPLICATE a clip (select + ⌘/Ctrl-D → insert a clone arm,
 * #386 / Phase 5c) — Playwright observation (AnviDev observe gate).
 *
 * Unit tests cover the substrate (editor arrange.test.ts: insertArm) and the
 * gesture (FullSongTimeline.test.tsx: select + ⌘/Ctrl-D → onDuplicateClip). This
 * drives the REAL app end-to-end: select a clip → ⌘-D → the arm's verbatim
 * source is cloned right after it → the re-eval shows the repeated clip.
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

test('selecting arm 0 and pressing ⌘-D inserts a verbatim clone after it', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console.error: ${m.text()}`)
  })

  await bootShell(page)
  await typeSongAndEval(page, 'arrange([2, s("bd")], [2, s("hh")])')

  // Song canvas is the only timeline view now (#497/U5) -- wait for it.
  await page.locator('[data-full-song="root"]').waitFor({ timeout: 10_000 })
  await page.locator('[data-full-song-lane]').first().waitFor({ timeout: 10_000 })
  await page.locator('[data-full-song-canvas]').waitFor({ timeout: 10_000 })
  await page.waitForTimeout(400)

  // Select arm 0 (bd lane, first half = cycle ~1 → 0.25·W); then ⌘/Ctrl-D.
  const grid = page.locator('[data-full-song="grid"]')
  const box = await grid.boundingBox()
  if (!box) throw new Error('no grid box')
  await page.mouse.click(box.x + box.width * 0.25, box.y + 8)
  await expect(page.locator('[data-full-song="clip-selection"]')).toBeVisible({ timeout: 5_000 })
  // `locator.press` focuses the grid first, so the ⌘/Ctrl-D keydown reaches its
  // handler (a bare page.keyboard.press can land on document.body instead).
  await grid.press(`${MOD}+d`)

  // arm 0's `[2, s("bd")]` is cloned right after itself.
  await expect.poll(() => strudelSource(page), { timeout: 8_000 }).toContain(
    'arrange([2, s("bd")], [2, s("bd")], [2, s("hh")])',
  )

  await page.screenshot({ path: 'test-results/arrange-duplicate.png' })
  expect(errors, `unexpected console/page errors:\n${errors.join('\n')}`).toEqual([])
})

test('⌘-I inserts an EMPTY section, where ⌘-D inserts a copy of one that plays', async ({ page }) => {
  // #1461. The claim is the DIFFERENCE, so both gestures run on the same song in
  // one session: duplicate writes CONTENT, insert writes TIME. An arm that only
  // showed insert working would leave "is this just duplicate?" unanswered, and
  // that question is the whole reason the objection on #1347 was raised.
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console.error: ${m.text()}`)
  })

  await bootShell(page)

  const selectArm0 = async (): Promise<ReturnType<Page['locator']>> => {
    const grid = page.locator('[data-full-song="grid"]')
    const box = await grid.boundingBox()
    if (!box) throw new Error('no grid box')
    await page.mouse.click(box.x + box.width * 0.25, box.y + 8)
    await expect(page.locator('[data-full-song="clip-selection"]')).toBeVisible({ timeout: 5_000 })
    return grid
  }

  // ── INSERT ───────────────────────────────────────────────────────────────
  await typeSongAndEval(page, 'arrange([2, s("bd")], [4, s("hh")])')
  await page.locator('[data-full-song="root"]').waitFor({ timeout: 10_000 })
  await page.locator('[data-full-song-lane]').first().waitFor({ timeout: 10_000 })
  await page.locator('[data-full-song-canvas]').waitFor({ timeout: 10_000 })
  await page.waitForTimeout(400)
  // ⚠ Scoped to the gesture: the harness types into a LIVE editor, so the runtime
  // genuinely evaluates `arra` on the way to `arrange` and says so. That is a
  // live-coding editor working as designed, and it is harness noise.
  errors.length = 0

  await (await selectArm0()).press(`${MOD}+i`)

  // A new section, EMPTY, and exactly as wide as the one it follows — the song
  // grew from 6 cycles to 8 and nothing new plays.
  await expect.poll(() => strudelSource(page), { timeout: 8_000 }).toBe(
    'arrange([2, s("bd")], [2, silence], [4, s("hh")])',
  )
  const inserted = await strudelSource(page)
  // eslint-disable-next-line no-console
  console.log(`[#1461] after insert: ${inserted}`)
  // Not a clone: a second `s("bd")` here would mean the duplicate path ran.
  expect(inserted.match(/s\("bd"\)/g) ?? []).toHaveLength(1)

  // ── DUPLICATE, the control, same song and same session ───────────────────
  await typeSongAndEval(page, 'arrange([2, s("bd")], [4, s("hh")])')
  await page.locator('[data-full-song-canvas]').waitFor({ timeout: 10_000 })
  await page.waitForTimeout(400)
  errors.length = 0

  await (await selectArm0()).press(`${MOD}+d`)

  // The same selection, one chord apart, produces a section that PLAYS. This is
  // what makes the reading above mean "empty" rather than "inserted, observed".
  await expect.poll(() => strudelSource(page), { timeout: 8_000 }).toBe(
    'arrange([2, s("bd")], [2, s("bd")], [4, s("hh")])',
  )
  // eslint-disable-next-line no-console
  console.log(`[#1461] after duplicate: ${await strudelSource(page)}`)

  expect(errors, `unexpected console/page errors:\n${errors.join('\n')}`).toEqual([])
})

test('the other spelling inserts the same empty section, in its own vocabulary', async ({ page }) => {
  // #1461 + #1462. A keypress has to mean one thing whichever way the user
  // happened to write their song, so the gesture is only finished when BOTH
  // spellings answer it — and each has to answer in its own grammar: `silence`
  // for an arrange arm, `~` for a pick arm, exactly as their deletes already do.
  //
  // ⚠ The arrange half of this claim is the test above, on a different document.
  // Two spellings cannot be compared inside one document, so this is the one
  // place a pair is split across arms deliberately rather than by omission.
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console.error: ${m.text()}`)
  })

  await bootShell(page)
  await typeSongAndEval(page, '"<verse@2 chorus@2>".pickRestart({verse: s("bd"), chorus: s("hh")})')
  await page.locator('[data-full-song="root"]').waitFor({ timeout: 10_000 })
  await page.locator('[data-full-song-canvas]').waitFor({ timeout: 10_000 })
  await page.waitForTimeout(400)
  errors.length = 0 // typing noise — the claim is about the gesture

  const grid = page.locator('[data-full-song="grid"]')
  const box = await grid.boundingBox()
  if (!box) throw new Error('no grid box')
  await page.mouse.click(box.x + box.width * 0.25, box.y + 8)
  await expect(page.locator('[data-full-song="clip-selection"]')).toBeVisible({ timeout: 5_000 })
  await grid.press(`${MOD}+i`)

  await expect.poll(() => strudelSource(page), { timeout: 8_000 }).toContain(
    '<verse@2 ~@2 chorus@2>',
  )
  const after = await strudelSource(page)
  // eslint-disable-next-line no-console
  console.log(`[#1461] pick spelling: ${after}`)

  // ⚠ THE SECTION OBJECT IS UNTOUCHED, and that is the half worth asserting.
  // `~` is a rest in the selector's own grammar rather than a name that has to
  // resolve, so adding a key would put a pattern in the document nobody asked
  // for — a rename of the song's meaning disguised as an insert.
  expect(after).toContain('.pickRestart({verse: s("bd"), chorus: s("hh")})')

  expect(errors, `unexpected console/page errors:\n${errors.join('\n')}`).toEqual([])
})

test('a NAMED section is gestureable at all — the anchor reaches its arrangement', async ({ page }) => {
  // #1517. Not a duplicate feature test: duplicate is simply the cheapest gesture
  // to prove the ANCHOR with, and every other clip gesture resolves its call from
  // the same number.
  //
  // ⚠ WHY THIS WENT UNSEEN FOR THE WHOLE LIFE OF CLIP GESTURES. Every existing
  // end-to-end arm writes its arms INLINE — `arrange([2, s("bd")], …)` — where the
  // enclosing call really does begin earliest, so the old minimum was right. The
  // moment an arm NAMES a binding declared above the call, the binding's own
  // location is earlier, the anchor lands inside a `const`, and the gesture
  // declines silently and correctly on an anchor that resolves to nothing.
  // Roughly half of all real sections are written this way.
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))

  await bootShell(page)
  await typeSongAndEval(
    page,
    ['const introduction = s("bd")', 'const development = s("hh")', 'arrange([2, introduction], [2, development])'].join('\n'),
  )
  await page.locator('[data-full-song="root"]').waitFor({ timeout: 10_000 })
  await page.locator('[data-full-song-canvas]').waitFor({ timeout: 10_000 })
  await page.waitForTimeout(400)
  errors.length = 0 // typing noise from a live editor

  const grid = page.locator('[data-full-song="grid"]')
  const box = await grid.boundingBox()
  if (!box) throw new Error('no grid box')
  await page.mouse.click(box.x + box.width * 0.25, box.y + 8)
  await expect(page.locator('[data-full-song="clip-selection"]')).toBeVisible({ timeout: 5_000 })
  await grid.press(`${MOD}+d`)

  await expect.poll(() => strudelSource(page), { timeout: 8_000 }).toBe(
    [
      'const introduction = s("bd")',
      'const development = s("hh")',
      'arrange([2, introduction], [2, introduction], [2, development])',
    ].join('\n'),
  )
  // eslint-disable-next-line no-console
  console.log(`[#1517] named section duplicated: ${JSON.stringify(await strudelSource(page))}`)

  expect(errors, `unexpected page errors:\n${errors.join('\n')}`).toEqual([])
})
