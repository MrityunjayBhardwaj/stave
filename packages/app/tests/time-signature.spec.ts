/**
 * The time signature reaches every readout that counts in it (#1568).
 *
 * The unit tests prove the arithmetic in 3/4. They cannot prove the WIRING: for
 * as long as every consumer is 4, a consumer that reads the live meter and one
 * that quietly kept a constant are indistinguishable. Only a meter that is NOT 4
 * tells them apart, and only the running app shows whether the store actually
 * reaches them.
 *
 * So this drives the real control and reads two surfaces that are wired
 * separately: the transport readout (React, via a ref inside a rAF loop) and the
 * song ruler's beat ticks (DOM, re-rendered from the store). The lane beat grid
 * is the third consumer; it only draws inside an EXPANDED lane, and it shares
 * `songAxis`'s numerator with the ruler, so it is covered by unit tests rather
 * than by a second opening gesture here.
 */
import { test, expect, type Page } from '@playwright/test'

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control'

async function boot(page: Page): Promise<void> {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('stave:bottomPanel.height', '320')
      localStorage.setItem('stave:bottomPanel.open', 'true')
      localStorage.setItem('stave:bottomPanel.activeTabId', 'musical-timeline')
    } catch {
      /* ignore */
    }
  })
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await page.locator('[data-bottom-panel="root"]').waitFor({ timeout: 20_000 })
  await page.waitForFunction(
    () => {
      const m = (window as unknown as { monaco?: { editor?: { getEditors?: () => unknown[] } } }).monaco
      return (m?.editor?.getEditors?.()?.length ?? 0) > 0
    },
    { timeout: 20_000 },
  )
  // The editor's content is a CONTROLLED value fed by an async project load;
  // seeding before it lands lets it overwrite the code (#872).
  await page.waitForFunction(
    () => {
      const m = (window as unknown as { monaco?: { editor?: { getEditors?: () => Array<{ getModel: () => { getValue?: () => string } | null }> } } }).monaco
      const eds = m?.editor?.getEditors?.() ?? []
      return eds.some((e) => (e.getModel()?.getValue?.()?.length ?? 0) > 0)
    },
    { timeout: 20_000 },
  )
}

async function evalCode(page: Page, code: string): Promise<void> {
  const ok = await page.evaluate((c) => {
    const monaco = (window as unknown as { monaco?: { editor?: { getEditors?: () => unknown[] } } }).monaco
    const editors = (monaco?.editor?.getEditors?.() ?? []) as Array<{
      getModel: () => { getLanguageId?: () => string; setValue: (s: string) => void } | null
      focus: () => void
    }>
    const target = editors.find((e) => e.getModel()?.getLanguageId?.() === 'strudel') ?? editors[0]
    if (!target) return false
    target.getModel()?.setValue(c)
    target.focus()
    return true
  }, code)
  expect(ok).toBe(true)
  await page.waitForTimeout(150)
  await page.keyboard.press(`${MOD}+Enter`)
}

const beatTicks = (page: Page) => page.locator('[data-full-song-tick="beat"]')

test('setting 3/4 moves the readout and the ruler together', async ({ page }) => {
  await boot(page)
  // No `setcps` anywhere: the scheduler runs at its default 0.5 cps, so the BPM
  // arithmetic below is over a tempo the test did not have to set.
  await evalCode(page, '$: note("<c3 e3 g3 a3>")')
  await page.locator('[data-full-song="root"]').waitFor({ timeout: 10_000 })

  // BARS vocabulary — one click on the readout, which is also what puts beat
  // ticks on the song ruler.
  const lcd = page.locator('[data-stave-transport-lcd]')
  await lcd.click()
  await expect(lcd).toContainText('BAR')

  // ── 4/4 ────────────────────────────────────────────────────────────────────
  const tempo = page.locator('[data-stave-lcd-tempo]')
  await expect(tempo).toHaveText('120', { timeout: 8000 }) // 0.5 cps × 60 × 4 quarters

  const ticksInFour = await beatTicks(page).count()
  // CONTROL ARM: if the ruler is drawing no beat ticks at all (too zoomed out
  // for them to be legible), the comparison below would hold trivially and say
  // nothing. A zero here is instrument failure, not a passing property.
  expect(ticksInFour, 'the ruler is drawing no beat ticks to compare').toBeGreaterThan(0)

  // ── 3/4 — the real gesture, on the real control ────────────────────────────
  await page.locator('[data-stave-sig-beats]').selectOption('3')

  // The same music, counted in three: three quarter notes to the same bar, so
  // each is longer and the quarter-note tempo reads slower. Nothing was re-evaluated.
  await expect(tempo).toHaveText('90', { timeout: 8000 })

  // And the ruler subdivides the same bars two ways instead of three.
  await expect
    .poll(() => beatTicks(page).count(), { timeout: 8000 })
    .toBe(Math.round((ticksInFour * 2) / 3))

  // The beat digit never exceeds the meter. Sampled while the transport runs,
  // because a stopped readout shows dashes and would agree with anything.
  const beats = new Set<string>()
  for (let i = 0; i < 16; i++) {
    const pos = (await page.locator('[data-stave-lcd-pos]').textContent()) ?? ''
    const beat = /^\d{3}\.(\d)\.\d$/.exec(pos)?.[1]
    if (beat) beats.add(beat)
    await page.waitForTimeout(120)
  }
  // CONTROL ARM again: one sample, or none, cannot show a digit staying in range.
  expect([...beats].sort(), 'the readout never advanced — nothing was sampled').not.toEqual([])
  expect(beats.size, 'the position did not move while sampling').toBeGreaterThan(1)
  expect([...beats].sort()).not.toContain('4')
})
