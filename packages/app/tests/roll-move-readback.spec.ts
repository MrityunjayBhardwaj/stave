/**
 * A move the cheap rule takes and readback refuses goes HOME, and says so (#1453, #1342).
 *
 * ─── WHY THIS EXISTS ────────────────────────────────────────────────────────────
 * A move drag writes on every pointermove under the cheap spelling rule, and gates
 * once at the drop. So the gate's job is to UNDO a lossy write, not to prevent one
 * — and it was not doing it. Observed before the fix: the drag below wrote
 *
 *   <[11@4, ~ ~ ~ 12] [~ 11 10 9] [11@4] [10 9 10 8] [7@4] [6 7 8 6] [7@4] [7@4]>
 *
 * byte-for-byte the cheap rule's output, a document that does not read back — and
 * raised nothing. The mid-drag frame left the document unparseable, which nulled
 * the panel's live model, which made `mutate` return before running the callback
 * that computes the refusal. The gate was disabled by the write it exists to undo.
 *
 * ─── WHY A BROWSER TEST, AND WHY THIS FIXTURE ───────────────────────────────────
 * The corpus arms call the writer directly, so they stay green while the PANEL
 * fails to act on the verdict — which is exactly what happened. The distinction
 * only exists in the gesture.
 *
 * The fixture is not constructed: sweeping the corpus with the ±1 step / ±1
 * semitone ask set gives 14 gate-only refusals in 20,587 asks over 595 units. Two
 * of the five documents holding them put the grabbed note at a FRACTIONAL start
 * (`cell 38:11.5`), which a whole-step grid cell cannot address. This one carries
 * six reachable ones and 53 accepted asks, so the refusal and its control share a
 * document and a grabbed note.
 *
 * ⚠ THE ACCEPTED TWIN IS NOT DECORATION. "The document is unchanged" is also what a
 * drag that never reached the writer looks like, and a cheap-refused drop produces
 * it too. The twin grabs the SAME note and differs only in the target column.
 */
import { test, expect, type Page } from '@playwright/test'
import { bootApp, seedCode, editorValue } from './_appBoot'
import { expectRefusalReported, expectNoRefusalReported } from './_console'

const CODE = '$: n("<11 [12 11 10 9] 11 [10 9 10 8] 7 [6 7 8 6] 7 7>")'
/** the accepted twin: the same grabbed note, one column the other way */
const ACCEPTED = '$: n("<11 [~ [11,12] 10 9] 11 [10 9 10 8] 7 [6 7 8 6] 7 7>")'

const GRAB = '12:4'
const REFUSED_TO = '12:3' // cheap rule takes it; readback refuses
const ACCEPTED_TO = '12:5' // both take it

async function openRoll(page: Page, code: string) {
  await bootApp(page, { drawer: { tabId: 'pattern', height: 520 } })
  await seedCode(page, code)
  const grid = page.locator('[data-bottom-panel-tab="piano-roll"]')
  await expect(grid, `the roll must open for ${code}`).toHaveCount(1)
  return grid
}

/** Centre of a roll cell. Fails loudly — an un-addressable cell means the fixture moved. */
async function cell(page: Page, key: string): Promise<{ x: number; y: number }> {
  const loc = page.locator(`[data-bottom-panel-tab="piano-roll"] [data-roll-cell="${key}"]`)
  await expect(loc, `roll cell ${key} must be drawn`).toHaveCount(1)
  const b = await loc.boundingBox()
  if (!b) throw new Error(`roll cell ${key} has no box`)
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 }
}

async function drag(page: Page, from: string, to: string): Promise<void> {
  const f = await cell(page, from)
  const t = await cell(page, to)
  await page.mouse.move(f.x, f.y)
  await page.mouse.down()
  await page.mouse.move(t.x, t.y, { steps: 8 })
  await page.mouse.up()
}

test.describe('a move refused by readback goes home, and is reported (#1453)', () => {
  test('the gate-only drag leaves the document byte-identical', async ({ page }) => {
    await openRoll(page, CODE)
    await drag(page, GRAB, REFUSED_TO)

    // The bytes, and the whole document — not "the note is back". The failure wrote a
    // spelling that reopens holding different notes, and it serialized perfectly well.
    await expect.poll(() => editorValue(page), { timeout: 5000 }).toBe(CODE)

    await expectRefusalReported(page, "Couldn't move that note there")
  })

  test('the accepted twin still writes, and reports nothing', async ({ page }) => {
    await openRoll(page, CODE)
    await drag(page, GRAB, ACCEPTED_TO)

    // PRECONDITION as much as assertion: without it, "no warning" would be satisfied
    // by a drag that never reached the writer — which is the reading that would let
    // the bug above pass as a working gate.
    await expect.poll(() => editorValue(page), { timeout: 5000 }).toBe(ACCEPTED)

    await expectNoRefusalReported(page)
  })
})
