/**
 * Mixer tab — #381. The first write-back panel, end-to-end proof of the spine.
 *
 * Observes (AnviDev: verify AND observe) that dragging a knob:
 *   - changes ONLY the numeric literal it targets (the mini-notation and the
 *     rest of the statement stay byte-identical — surgical text edit);
 *   - is a single undo step (one Ctrl-Z reverts the whole drag).
 *
 * Audio update on edit rides the existing live-mode re-eval (content change →
 * debounced evaluate) and is exercised manually, not asserted here.
 */
import { test, expect, type Page } from '@playwright/test'

async function boot(page: Page): Promise<void> {
  await page.goto('/')
  await page.locator('[data-bottom-panel="root"]').waitFor({ timeout: 15_000 })
  // Wait for Monaco to mount a Strudel editor before driving it.
  await page.waitForFunction(
    () => {
      const m = (window as unknown as { monaco?: { editor?: { getEditors?: () => unknown[] } } })
        .monaco
      return (m?.editor?.getEditors?.()?.length ?? 0) > 0
    },
    { timeout: 15_000 },
  )
}

async function setStrudelCode(page: Page, code: string): Promise<void> {
  const ok = await page.evaluate((c) => {
    const monaco = (window as unknown as { monaco?: { editor?: { getEditors?: () => unknown[] } } })
      .monaco
    const editors = (monaco?.editor?.getEditors?.() ?? []) as Array<{
      getModel: () => { getLanguageId?: () => string; setValue: (s: string) => void } | null
      focus: () => void
      setPosition: (p: { lineNumber: number; column: number }) => void
    }>
    const target =
      editors.find((e) => e.getModel()?.getLanguageId?.() === 'strudel') ?? editors[0]
    if (!target) return false
    target.getModel()?.setValue(c)
    target.setPosition({ lineNumber: 1, column: 1 })
    target.focus()
    return true
  }, code)
  expect(ok).toBe(true)
  await page.waitForTimeout(150)
}

async function strudelValue(page: Page): Promise<string> {
  return page.evaluate(() => {
    const monaco = (window as unknown as { monaco?: { editor?: { getEditors?: () => unknown[] } } })
      .monaco
    const editors = (monaco?.editor?.getEditors?.() ?? []) as Array<{
      getModel: () => { getLanguageId?: () => string; getValue: () => string } | null
    }>
    const target =
      editors.find((e) => e.getModel()?.getLanguageId?.() === 'strudel') ?? editors[0]
    return target?.getModel()?.getValue() ?? ''
  })
}

async function undo(page: Page): Promise<void> {
  await page.evaluate(() => {
    const monaco = (window as unknown as { monaco?: { editor?: { getEditors?: () => unknown[] } } })
      .monaco
    const editors = (monaco?.editor?.getEditors?.() ?? []) as Array<{
      getModel: () => { getLanguageId?: () => string } | null
      trigger: (source: string, id: string, payload: unknown) => void
    }>
    const target =
      editors.find((e) => e.getModel()?.getLanguageId?.() === 'strudel') ?? editors[0]
    target?.trigger('test', 'undo', null)
  })
  await page.waitForTimeout(50)
}

async function openMixer(page: Page) {
  const drawer = page.locator('[data-bottom-panel="root"]')
  await drawer.locator('[data-bottom-panel="toggle"]').click()
  await drawer.locator('role=tab[name="Pattern"]').click()
  return drawer
}

/** drag the drawer taller so the inspector's knob grid is fully on-screen. Since
 *  the channel strip moved to a horizontal bar atop the inspector (#600), the
 *  knob grid sits lower; a raw-mouse knob drag (unlike `.click()`, which
 *  auto-scrolls) needs the knob in the visible panel. */
async function enlargeDrawer(page: Page): Promise<void> {
  const handle = page.locator('[data-bottom-panel="resize-handle"]')
  const hb = await handle.boundingBox()
  if (!hb) return
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2)
  await page.mouse.down()
  await page.mouse.move(hb.x + hb.width / 2, hb.y - 320, { steps: 10 })
  await page.mouse.up()
  await page.waitForTimeout(150)
}

test.describe('Mixer (#381)', () => {
  test('shows a knob per numeric chain arg; gain/pan are strip-owned (#575)', async ({ page }) => {
    await boot(page)
    await setStrudelCode(page, '$: s("bd").gain(0.6).pan(0.2).lpf(800).room(0.4)')
    const drawer = await openMixer(page)
    await expect(drawer.locator('[data-knob="lpf"]')).toHaveCount(1)
    await expect(drawer.locator('[data-knob="room"]')).toHaveCount(1)
    // gain + pan live on the strip fader / pan row — never an auto-knob here.
    await expect(drawer.locator('[data-knob="gain"]')).toHaveCount(0)
    await expect(drawer.locator('[data-knob="pan"]')).toHaveCount(0)
  })

  test('dragging a knob changes only the literal, in one undo step', async ({ page }) => {
    await boot(page)
    const original = '$: s("bd").room(0.4)'
    await setStrudelCode(page, original)
    const drawer = await openMixer(page)
    await enlargeDrawer(page)
    const slider = drawer.locator('[data-knob="room"] [role="slider"]')
    await expect(slider).toHaveCount(1)

    // Drag the dial upward → room increases.
    const box = await slider.boundingBox()
    if (!box) throw new Error('no knob box')
    const cx = box.x + box.width / 2
    const cy = box.y + box.height / 2
    await page.mouse.move(cx, cy)
    await page.mouse.down()
    await page.mouse.move(cx, cy - 40, { steps: 8 })
    await page.mouse.up()
    await page.waitForTimeout(80)

    // Only the literal changed — everything around `room(<n>)` is byte-identical.
    // (Assert on the document, not the slider's aria, which can lag a render
    // behind the final write.)
    const after = await strudelValue(page)
    const match = after.match(/^\$: s\("bd"\)\.room\((\d*\.?\d+)\)$/)
    expect(match, `unexpected doc after drag: ${after}`).not.toBeNull()
    expect(Number(match![1])).toBeGreaterThan(0.4)
    // The knob readout reconciles with the literal it wrote (no one-step lag).
    await expect(slider).toHaveAttribute('aria-valuenow', match![1])

    // One undo reverts the WHOLE drag (not just the last increment).
    await undo(page)
    expect(await strudelValue(page)).toBe(original)
  })

  test('quick-transform toggles an effect on, then off, surfacing/removing its knob (#390)', async ({
    page,
  }) => {
    await boot(page)
    await setStrudelCode(page, '$: s("bd")')
    const drawer = await openMixer(page)
    const room = drawer.locator('[data-mixer-transform="room"]')
    // a bare pattern shows the transform row even with no knobs yet
    await expect(room).toHaveCount(1)

    // click ON: appends the effect, surfaces its knob, marks the toggle pressed
    await room.click()
    await page.waitForTimeout(80)
    expect(await strudelValue(page)).toBe('$: s("bd").room(0.4)')
    await expect(drawer.locator('[data-knob="room"]')).toHaveCount(1)
    await expect(room).toHaveAttribute('aria-pressed', 'true')

    // click OFF (#390 toggle): removes the call AND its knob; doc back to bare
    await room.click()
    await page.waitForTimeout(80)
    expect(await strudelValue(page)).toBe('$: s("bd")')
    await expect(drawer.locator('[data-knob="room"]')).toHaveCount(0)
    await expect(room).toHaveAttribute('aria-pressed', 'false')
  })

  test('gain never surfaces a drawer knob — the strip fader owns it (scalar/per-column/signal) (#575)', async ({
    page,
  }) => {
    await boot(page)
    const drawer = await openMixer(page)
    // scalar
    await setStrudelCode(page, '$: s("bd").gain(0.5)')
    await expect(drawer.locator('[data-knob="gain"]')).toHaveCount(0)
    // per-column managed (what a cell drag writes) — the strip fader rescales it
    // proportionally (mixer-strips.spec covers the fader); the drawer shows nothing.
    await setStrudelCode(page, '$: s("bd*8").gain("1 1 1 1 0.625 1 1 1")')
    await expect(drawer.locator('[data-knob="gain"]')).toHaveCount(0)
    // signal
    await setStrudelCode(page, '$: s("bd*8").gain(sine)')
    await expect(drawer.locator('[data-knob="gain"]')).toHaveCount(0)
  })

  test('＋More menu adds an effect; search filters (#575)', async ({ page }) => {
    await boot(page)
    await setStrudelCode(page, '$: s("bd")')
    const drawer = await openMixer(page)
    // The inspector grew a "Slots" row (#601), so in the short default drawer the
    // transforms row (with ＋More) sits at the fold; enlarge first so the button is
    // on-screen and the portaled menu isn't dismissed by an auto-scroll-into-view.
    await enlargeDrawer(page)
    await drawer.locator('[data-mixer-add-effect]').click()
    // the popover is portaled to <body> (escapes the drawer's overflow clip)
    const menu = page.locator('[data-mixer-add-effect-menu]')
    await expect(menu).toBeVisible()
    // search narrows to the bitcrush entry; reverb (room) drops out
    await menu.locator('[data-mixer-add-effect-search]').fill('crush')
    await expect(menu.locator('[data-mixer-add-effect-item="crush"]')).toBeVisible()
    await expect(menu.locator('[data-mixer-add-effect-item="room"]')).toHaveCount(0)
    await menu.locator('[data-mixer-add-effect-item="crush"]').click()
    await page.waitForTimeout(80)
    expect(await strudelValue(page)).toBe('$: s("bd").crush(8)')
    await expect(drawer.locator('[data-knob="crush"]')).toHaveCount(1)
  })

  /**
   * The take controls, end to end in the real app (#1530).
   *
   * The catalog entry and the range live in the editor's unit tests, which
   * render the menu component directly — that says the DATA is right, not that
   * the running Mixer reaches it. This arm drives the real button.
   *
   * ⚠ `aria-valuemin` is the assertion that matters. `.stretch` is a pitch
   * shift whose identity value is 0 and whose downward shifts are NEGATIVE;
   * before it had a range-table entry the dial fell through to 0..1, so unison
   * read as the minimum and every downward shift was unreachable. A `toHaveCount`
   * on the knob would have passed the whole time.
   */
  test('＋More adds a Pitch shift whose dial reaches BELOW unison (#1530)', async ({ page }) => {
    await boot(page)
    await setStrudelCode(page, '$: s("bd")')
    const drawer = await openMixer(page)
    await enlargeDrawer(page)
    await drawer.locator('[data-mixer-add-effect]').click()
    const menu = page.locator('[data-mixer-add-effect-menu]')
    await expect(menu).toBeVisible()
    await menu.locator('[data-mixer-add-effect-search]').fill('pitch')
    await menu.locator('[data-mixer-add-effect-item="stretch"]').click()
    await page.waitForTimeout(80)
    expect(await strudelValue(page)).toBe('$: s("bd").stretch(1)')
    const slider = drawer.locator('[data-knob="stretch"] [role="slider"]').first()
    await expect(slider).toHaveAttribute('aria-valuemin', '-2')
    await expect(slider).toHaveAttribute('aria-valuemax', '1')
  })

  test('scrolling the ＋More list keeps the menu open (does not self-dismiss)', async ({
    page,
  }) => {
    await boot(page)
    await setStrudelCode(page, '$: s("bd").lpf(800).room(0.4)')
    const drawer = await openMixer(page)
    await enlargeDrawer(page)
    await drawer.locator('[data-mixer-add-effect]').click()
    const menu = page.locator('[data-mixer-add-effect-menu]')
    await expect(menu).toBeVisible()

    // Real gesture: hover the (overflowing) catalog and wheel-scroll it. The
    // menu closes on ANCESTOR scroll but must survive its own list scroll —
    // otherwise the long tail is unbrowsable.
    const box = await menu.boundingBox()
    if (!box) throw new Error('no menu box')
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.wheel(0, 160)
    await page.waitForTimeout(150)
    await expect(menu).toBeVisible()
  })

  test('the menu marks an aliased call active (.cutoff → Low-pass) (#575)', async ({ page }) => {
    await boot(page)
    await setStrudelCode(page, '$: s("bd").cutoff(900)')
    const drawer = await openMixer(page)
    await enlargeDrawer(page)

    // Wait for the strip to have BOUND to our code before opening the menu.
    // `openMixer` only clicks the tab — it does not wait for the strip to bind,
    // so a click issued too early opens nothing and the item assertion then fails
    // with a bare "element not found". The knob carries the method the CODE used
    // (`cutoff`); the menu is what maps it to its canonical Low-pass entry — which
    // is the aliasing this test is actually about.
    await expect(drawer.locator('[data-knob="cutoff"]')).toHaveCount(1)

    await drawer.locator('[data-mixer-add-effect]').click()
    const menu = page.locator('[data-mixer-add-effect-menu]')
    await expect(menu).toBeVisible()
    await expect(menu.locator('[data-mixer-add-effect-item="lpf"]')).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  test('the × on a knob removes that effect; sibling byte-identical (#575)', async ({ page }) => {
    await boot(page)
    await setStrudelCode(page, '$: s("bd").lpf(800).room(0.4)')
    const drawer = await openMixer(page)
    await expect(drawer.locator('[data-knob="lpf"]')).toHaveCount(1)
    await drawer.locator('[data-knob="lpf"] [data-knob-remove="lpf"]').click()
    await page.waitForTimeout(80)
    expect(await strudelValue(page)).toBe('$: s("bd").room(0.4)')
    await expect(drawer.locator('[data-knob="lpf"]')).toHaveCount(0)
  })

  test('standby when the cursor is not in an editable chunk', async ({ page }) => {
    await boot(page)
    await setStrudelCode(page, '// just a comment')
    const drawer = await openMixer(page)
    await expect(drawer.locator('[data-bottom-panel-tab="mixer-standby"]')).toHaveCount(1)
  })
})
