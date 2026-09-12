// Transport LCD in the menubar (#857): shown by default, reflects transport
// state, advances position while playing, flips display mode on click, and
// hides behind the Editor Settings toggle (brand returns).
import { test, expect, type Page } from '@playwright/test'

async function boot(page: Page): Promise<void> {
  await page.goto('/')
  await page.locator('[data-bottom-panel="root"]').waitFor({ timeout: 15_000 })
  await page.waitForFunction(
    () => {
      const m = (window as unknown as { monaco?: { editor?: { getEditors?: () => unknown[] } } }).monaco
      return (m?.editor?.getEditors?.()?.length ?? 0) > 0
    },
    { timeout: 15_000 },
  )
}

const LCD = '[data-stave-transport-lcd]'

test('shows by default and reflects transport + mode + settings toggle', async ({ page }) => {
  await boot(page)

  // Default ON: the LCD is present, the brand label is not.
  const lcd = page.locator(LCD)
  await expect(lcd).toBeVisible()
  await expect(page.locator('[data-stave-brand]')).toHaveCount(0)

  // Stopped state before play.
  await expect(lcd).toContainText('STOP')

  // Play → the LCD reads PLAY and the position advances over time.
  await page.locator('[data-testid="strudel-chrome-transport"]').click()
  await expect(lcd).toContainText('PLAY', { timeout: 8000 })
  const pos = page.locator('[data-stave-lcd-pos]')
  const first = await pos.textContent()
  await page.waitForTimeout(700)
  const second = await pos.textContent()
  expect(second, 'position should advance while playing').not.toBe(first)

  // Click the screen flips the display mode (CYC → BAR), which drives both the
  // LCD label and the shared ruler-units preference.
  await expect(lcd).toContainText('CYC')
  await lcd.click()
  await expect(lcd).toContainText('BAR')
  await lcd.click()
  await expect(lcd).toContainText('CYC')

  // Editor Settings toggle hides the LCD and brings the brand back.
  await page.locator('[data-testid="strudel-chrome-transport"]').click() // stop
  await page.getByText('File', { exact: true }).click()
  await page.getByText('Editor Settings...', { exact: true }).click()
  const lcdSwitch = page.locator('[data-testid="setting-menubarLcd"]')
  await expect(lcdSwitch).toBeVisible({ timeout: 5000 })
  await lcdSwitch.click()
  // Close the settings surface (Escape) and verify the swap.
  await page.keyboard.press('Escape')
  await expect(page.locator(LCD)).toHaveCount(0)
  await expect(page.locator('[data-stave-brand]')).toBeVisible()
})

// A document that sets no tempo still HAS one — Strudel's scheduler default.
// The readout must report the tempo the engine is running at, not one recovered
// by matching `setcps(...)` in the source text.
test('tempo readout reflects a document that spells no setcps', async ({ page }) => {
  await boot(page)
  await page.evaluate(() => {
    const m = (window as unknown as { monaco?: { editor?: { getEditors?: () => Array<{ getModel: () => { getLanguageId?: () => string; setValue: (s: string) => void } | null; focus: () => void }> } } }).monaco
    const eds = m?.editor?.getEditors?.() ?? []
    const t = eds.find((e) => e.getModel()?.getLanguageId?.() === 'strudel') ?? eds[0]
    t?.getModel()?.setValue('s("bd sd")')
    t?.focus()
  })
  await page.waitForTimeout(200)

  await page.locator('[data-testid="strudel-chrome-transport"]').click()
  await expect(page.locator(LCD)).toContainText('PLAY', { timeout: 8000 })

  const tempo = page.locator('[data-stave-lcd-tempo]')
  await expect(tempo).toHaveText('0.50', { timeout: 8000 })
})
