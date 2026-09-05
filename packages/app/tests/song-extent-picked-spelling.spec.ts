/**
 * The SAME song written two ways is the same song (#1427).
 *
 * ─── WHY THIS EXISTS ────────────────────────────────────────────────────────────
 * `songExtent` gave a definite end to `arrange(...)` and called a weighted section
 * timeline a loop:
 *
 *   arrange([4, intro], [8, verse], [4, outro])            -> arranged, 16 cycles
 *   "<intro@4 verse@8 outro@4>".pickRestart({…})           -> loop
 *
 * Both describe one 16-cycle piece. The second got no Cycle/Loop toggle (#1388),
 * playback that never stopped on its own, and a bounce that did not know how long
 * the song was (#1373) — while parsing completely, with every section and weight
 * present in the IR, on a form `pickControl/` (#463) already draws and serializes.
 *
 * The reasoning that produced it was sound and half-applied: a `Cycle` repeats
 * every cycle, so it loops. True — and equally true of `arrange`, which is
 * `timeCat(...).slow(Σweight)`, itself a weighted sequence that loops. The definite
 * end was never a fact about `arrange()`; it is Stave reading a finite weighted
 * sequence of sections AS a song, applied to one of two spellings of that.
 *
 * ─── WHY A BROWSER ARM AND NOT ONLY THE UNIT ONES ───────────────────────────────
 * `songExtent.test.ts` pins the walk's semantics against synthetic IR — including
 * the max-over-tracks rule and the two negative arms that keep the scope narrow.
 * What it cannot see is whether the verdict is ever REACHED: the extent is measured
 * on EVAL, so a document that merely sits in the buffer has none. That was observed
 * here, not reasoned about — a first draft of this arm read the toggle without
 * evaluating and got zero for `arrange(...)` too, which is the known-good spelling.
 * A silence arm is worth nothing until a case known to speak has spoken beside it.
 *
 * ⚠ THE CORPUS CANNOT SPEAK FOR THIS ONE. The 150-document archive on a dev machine
 * holds no `NamedPick` over a weighted `Cycle` at all, so the `songExtent` census
 * is unchanged by the fix — it is the no-widening control here, not the evidence.
 * The evidence is this file and the unit arms.
 */
import { test, expect, type Page } from '@playwright/test'

/** `setcps(120/240)` — one cycle is 2s. */
const CYCLE_SECONDS = 2
/** 4 + 8 + 4, whichever way it is spelled. */
const SONG_CYCLES = 16
const SONG_SECONDS = SONG_CYCLES * CYCLE_SECONDS // 32
/** Well past the end, so "it stopped" and "we stopped watching" cannot be confused. */
const WATCH_SECONDS = 44
const SAMPLE_MS = 250

const HEAD = `setcps(120/240)
const intro = s("bd ~ ~ ~").bank("RolandTR909").gain(0.25)
const verse = s("bd*2 sd*2").bank("RolandTR909")
const outro = s("bd ~ ~ ~").bank("RolandTR909").gain(0.25)
`

/** Spelling A — the one that always had an end. */
const ARRANGED = `${HEAD}arrange([4, intro], [8, verse], [4, outro])
`

/**
 * Spelling B — the same song as a weighted section timeline, over the SAME three
 * section consts. Sharing `HEAD` is what makes "one song, two spellings" a fact
 * about the document rather than about two documents that happen to be 16 cycles.
 *
 * ⚠ WRITTEN `key: value`, NOT `{ intro, verse, outro }`, AND THAT IS NOT A STYLE
 * CHOICE (#1456). The ES shorthand does not parse to a `NamedPick` at all — it
 * falls back to an opaque `Code`, so the document is a `loop` no matter what this
 * file's subject does. A first draft used the shorthand and read `picked: 0` while
 * `arranged: 1`, which looks exactly like the fix not working. It is a separate,
 * pre-existing gap in the object-literal reader; when #1456 lands, the shorthand
 * belongs here as a third positive row.
 */
const PICKED = `${HEAD}"<intro@4 verse@8 outro@4>".pickRestart({ intro: intro, verse: verse, outro: outro })
`

/**
 * The narrow guard, in the app. A bare alternation carries no weights, so nothing
 * in it says the author meant an ending — and being wrong towards `arranged`
 * truncates a bounce, while being wrong towards `loop` costs nothing.
 */
const UNWEIGHTED = `${HEAD}"<intro verse outro>".pickRestart({ intro: intro, verse: verse, outro: outro })
`

/** No arrangement anywhere — the shape most real documents have. */
const LOOP_DOC = `setcps(120/240)
s("bd*2 sd*2").bank("RolandTR909")
`

async function boot(page: Page): Promise<void> {
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await page.locator('[data-workspace-shell="root"]').waitFor({ timeout: 15000 })
  await page.locator('.monaco-editor').first().waitFor({ timeout: 15000 })
  await page.waitForFunction(
    () => {
      const m = (window as unknown as { monaco?: { editor?: { getEditors?: () => unknown[] } } }).monaco
      return (m?.editor?.getEditors?.()?.length ?? 0) > 0
    },
    { timeout: 15_000 },
  )
}

async function setStrudelCode(page: Page, code: string): Promise<void> {
  const ok = await page.evaluate((c) => {
    const monaco = (window as unknown as { monaco?: { editor?: { getEditors?: () => unknown[] } } }).monaco
    const editors = (monaco?.editor?.getEditors?.() ?? []) as Array<{
      getModel: () => { getLanguageId?: () => string; setValue: (s: string) => void } | null
      focus: () => void
      setPosition: (p: { lineNumber: number; column: number }) => void
    }>
    const target = editors.find((e) => e.getModel()?.getLanguageId?.() === 'strudel') ?? editors[0]
    if (!target) return false
    target.getModel()?.setValue(c)
    target.setPosition({ lineNumber: 1, column: 1 })
    target.focus()
    return true
  }, code)
  expect(ok).toBe(true)
  await page.waitForTimeout(400)
}

async function isPlaying(page: Page): Promise<boolean> {
  const label = await page.getByTestId('strudel-chrome-transport').textContent()
  return (label ?? '').includes('Stop')
}

/**
 * Evaluate, and WAIT to be playing.
 *
 * ⚠ THE EXTENT IS MEASURED ON EVAL, WHICH IS WHY THIS IS NOT OPTIONAL — a document
 * that has only been typed into the buffer has no extent, and every arm below would
 * read a confident zero.
 */
async function pressPlay(page: Page): Promise<void> {
  const mod = process.platform === 'darwin' ? 'Meta' : 'Control'
  await page.locator('.monaco-editor').first().click()
  await page.keyboard.press(`${mod}+Enter`)
  await expect(
    page.getByTestId('strudel-chrome-transport'),
    'the transport never started — nothing below would prove anything',
  ).toContainText('Stop', { timeout: 60_000 })
}

async function stopIfPlaying(page: Page): Promise<void> {
  if (await isPlaying(page)) await page.getByTestId('strudel-chrome-transport').click()
  await page.waitForTimeout(300)
}

async function watchTransport(page: Page, seconds: number, label: string) {
  const t0 = Date.now()
  const samples: string[] = []
  let stoppedAtS: number | null = null

  const startedPlaying = await isPlaying(page)
  // eslint-disable-next-line no-console
  console.log(
    `[#1427 ${label}] PRECONDITION — playing at t=0: ${startedPlaying}; ` +
      `loop toggle present: ${await page.getByTestId('strudel-chrome-loop-toggle').count()}; ` +
      `watching ${seconds}s at ${SAMPLE_MS}ms`,
  )
  expect(startedPlaying, `[${label}] not playing when the watch began — the watch proves nothing`).toBe(true)

  while ((Date.now() - t0) / 1000 < seconds) {
    await page.waitForTimeout(SAMPLE_MS)
    const t = (Date.now() - t0) / 1000
    const playing = await isPlaying(page)
    samples.push(`${t.toFixed(1)}s:${playing ? '▶' : '■'}`)
    if (!playing && stoppedAtS === null) stoppedAtS = t
  }
  const profile = samples.join(' ')
  // eslint-disable-next-line no-console
  console.log(`[#1427 ${label}] stoppedAtS=${stoppedAtS} profile=${profile}`)
  return { stoppedAtS, profile }
}

test.use({
  // The extent is read off the document, but the POSITION comes from the running
  // scheduler — and a suspended AudioContext never advances it.
  launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] },
})

test.describe('#1427 — a weighted section timeline is a song', () => {
  test('both spellings are offered an ending, and neither negative is', async ({ page }) => {
    test.setTimeout(180_000)
    await boot(page)

    // All four in ONE run on ONE page: the two positives are only meaningful
    // beside negatives taken under identical conditions.
    const seen: Record<string, number> = {}
    for (const [label, code] of [
      ['arranged', ARRANGED],
      ['picked', PICKED],
      ['unweighted', UNWEIGHTED],
      ['loop', LOOP_DOC],
    ] as const) {
      await setStrudelCode(page, code)
      await pressPlay(page)
      seen[label] = await page.getByTestId('strudel-chrome-loop-toggle').count()
      await stopIfPlaying(page)
    }

    // eslint-disable-next-line no-console
    console.log(`[#1427] loop-toggle by spelling: ${JSON.stringify(seen)}`)

    expect(
      seen,
      'the two spellings of one song must agree, and neither negative may be offered an end',
    ).toEqual({ arranged: 1, picked: 1, unweighted: 0, loop: 0 })
  })

  test('the picked spelling stops at its own end once asked to', async ({ page }) => {
    // The affordance appearing is not the promise; STOPPING is. The extent has to
    // be measured AND reach the watcher, and only the running app shows both.
    test.setTimeout(180_000)
    await boot(page)
    await setStrudelCode(page, PICKED)
    await pressPlay(page)

    const toggle = page.getByTestId('strudel-chrome-loop-toggle')
    await expect(
      toggle,
      'no end-behaviour toggle — the section timeline was not recognised as a song',
    ).toBeVisible()
    // #1396 — it starts LOOPING. Ask for an ending, then expect one.
    await expect(toggle).toHaveAttribute('data-loop', 'on')
    await toggle.click()
    await expect(toggle).toHaveAttribute('data-loop', 'off')

    const { stoppedAtS, profile } = await watchTransport(page, WATCH_SECONDS, 'picked')

    expect(stoppedAtS, `still playing after ${WATCH_SECONDS}s — profile: ${profile}`).not.toBeNull()
    // At the END, not early. Stopping at 2s satisfies "it stopped" and is as
    // broken as never stopping.
    expect(
      stoppedAtS!,
      `stopped at ${stoppedAtS}s, expected near ${SONG_SECONDS}s — profile: ${profile}`,
    ).toBeGreaterThan(SONG_SECONDS - CYCLE_SECONDS)
    expect(
      stoppedAtS!,
      `stopped at ${stoppedAtS}s, expected near ${SONG_SECONDS}s — profile: ${profile}`,
    ).toBeLessThan(SONG_SECONDS + 2 * CYCLE_SECONDS)
  })
})
