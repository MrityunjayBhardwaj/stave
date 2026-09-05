/**
 * A move drop the writer declines is REPORTED, and the note keeps its ground (#1452).
 *
 * ─── WHY THIS EXISTS ────────────────────────────────────────────────────────────
 * `reportRefusal("Couldn't move that note there")` existed and could not fire for
 * the ordinary case. A move drag judges every frame with the cheap spelling rule
 * and records `askedPitch`/`askedStart` only for frames that were ACCEPTED — so
 * the commit-time re-run could only ever re-ask a target the cheap rule had
 * already taken, and the message was reachable solely for the 14-in-20,587 class
 * the readback gate refuses (`roll-move-readback.spec.ts`, #1453).
 *
 * The ordering is not the bug and must not be "fixed": recording the ask above the
 * decline check is what broke the accepted-position semantics in #1325/#1326. What
 * was missing is that NOTHING recorded that the pointer had ever been over the cell
 * the user released on. Not a missing check — a missing record.
 *
 * ─── THE TWO FACTS, AND WHY BOTH ARMS ARE HERE ──────────────────────────────────
 * "The drop was declined" and "we stand at the last accepted frame" are both true,
 * and a declined move can rest in either of two places:
 *
 *   no frame ever landed   -> the note never moved      -> "left unchanged"
 *   some frame landed      -> the note is STRANDED at   -> "stayed at the last
 *                             the last accepted spot        spot it could go"
 *
 * One sentence for both would name a resting place the note is not in, so each has
 * its own arm and each pins its own clause.
 *
 * ─── THE FIXTURE WAS MEASURED ───────────────────────────────────────────────────
 * Sweeping every cell for this grabbed note (each frame is judged from the fixed
 * gesture base, so one sweep is the whole verdict map) gives 13 declined cells of
 * 208 — the entire column 7 — and 194 accepted. That is what makes both arms
 * drivable on ONE document: a drop straight onto column 7 never lands a frame, and
 * a drop that goes by way of any other column lands several first.
 *
 * ⚠ THE STRANDED ARM PINS THE INVARIANT, NOT THE BYTES. Which accepted frame is
 * last depends on how the pointer was interpolated, so asserting a literal document
 * would pin the mouse path rather than the property. What must hold is that the
 * commit changed nothing: the document at release is the document after release.
 */
import { test, expect, type Page } from '@playwright/test'
import { bootApp, seedCode, editorValue } from './_appBoot'
import { expectRefusalReported, expectNoRefusalReported } from './_console'

const CODE = '$: note("- - - <b3 [b3 b3]>")'

const GRAB = '59:6'
const DECLINED = '60:7' // column 7 — the writer takes no drop here
const VIA_ACCEPTED = '59:5' // any other column; the cheap rule takes it
const ACCEPTED_TO = '59:4' // the control: a drop that lands and stays

async function openRoll(page: Page): Promise<void> {
  await bootApp(page, { drawer: { tabId: 'pattern', height: 520 } })
  await seedCode(page, CODE)
  await expect(
    page.locator('[data-bottom-panel-tab="piano-roll"]'),
    `the roll must open for ${CODE}`,
  ).toHaveCount(1)
}

/** Centre of a roll cell. Fails loudly — an un-addressable cell means the fixture moved. */
async function cell(page: Page, key: string): Promise<{ x: number; y: number }> {
  const loc = page.locator(`[data-bottom-panel-tab="piano-roll"] [data-roll-cell="${key}"]`)
  await expect(loc, `roll cell ${key} must be drawn`).toHaveCount(1)
  const b = await loc.boundingBox()
  if (!b) throw new Error(`roll cell ${key} has no box`)
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 }
}

/** The cells currently telling the user the drop will not be taken. */
function refusedCells(page: Page) {
  return page.locator('[data-bottom-panel-tab="piano-roll"] [data-roll-drop-refused="true"]')
}

test.describe('a declined move drop is reported (#1452)', () => {
  test('a drop with no accepted frame reports, and leaves the document alone', async ({ page }) => {
    await openRoll(page)

    const f = await cell(page, GRAB)
    const t = await cell(page, DECLINED)
    await page.mouse.move(f.x, f.y)
    await page.mouse.down()
    await page.mouse.move(t.x, t.y, { steps: 8 })

    // The refusal is said BEFORE the fact too, on the cell under the pointer — and
    // only there. A grid-wide marking would be the offer-time gate this panel
    // explicitly cannot afford.
    await expect(refusedCells(page), 'the declined cell says so while the pointer is on it')
      .toHaveCount(1)
    await expect(refusedCells(page)).toHaveAttribute('data-roll-cell', DECLINED)

    await page.mouse.up()

    // Every frame of this drag was declined, so nothing was ever written.
    await expect.poll(() => editorValue(page), { timeout: 5000 }).toBe(CODE)
    await expect(refusedCells(page), 'the marking is a drag state, not a document state')
      .toHaveCount(0)

    await expectRefusalReported(page, "Couldn't move that note there", 'left unchanged')
  })

  test('a drop that strands the note reports where the note actually is', async ({ page }) => {
    await openRoll(page)

    const f = await cell(page, GRAB)
    const via = await cell(page, VIA_ACCEPTED)
    const t = await cell(page, DECLINED)
    await page.mouse.move(f.x, f.y)
    await page.mouse.down()
    await page.mouse.move(via.x, via.y, { steps: 4 })

    // PRECONDITION: a frame has to have LANDED, or this is the arm above wearing a
    // longer mouse path, and the clause it pins would be the wrong one to expect.
    await expect
      .poll(() => editorValue(page), { timeout: 5000 })
      .not.toBe(CODE)

    await page.mouse.move(t.x, t.y, { steps: 4 })
    await expect(refusedCells(page)).toHaveAttribute('data-roll-cell', DECLINED)
    const atRelease = await editorValue(page)

    await page.mouse.up()

    // ⚠ THE POINT OF THE WHOLE ISSUE. The declined drop is reported AND the note holds
    // the last accepted position — #1325/#1326's ruling. A commit that "helpfully" went
    // home, or re-ran the refused target, would change these bytes.
    await expect.poll(() => editorValue(page), { timeout: 5000 }).toBe(atRelease)
    expect(atRelease, 'the stranded note is not where it was grabbed').not.toBe(CODE)

    await expectRefusalReported(
      page,
      "Couldn't move that note there",
      'stayed at the last spot it could go',
    )
  })

  test('an accepted drop on the same fixture writes, and stays quiet', async ({ page }) => {
    await openRoll(page)

    const f = await cell(page, GRAB)
    const t = await cell(page, ACCEPTED_TO)
    await page.mouse.move(f.x, f.y)
    await page.mouse.down()
    await page.mouse.move(t.x, t.y, { steps: 8 })
    // The control has to be silent on the cell as well as in the Console, or the
    // marking above is satisfied by an attribute that is simply always on.
    await expect(refusedCells(page), 'an accepted target must not be marked').toHaveCount(0)
    await page.mouse.up()

    // PRECONDITION as much as assertion: "no warning" is also what a drag that never
    // reached the writer looks like — which is exactly the state the two arms above
    // are about.
    await expect
      .poll(() => editorValue(page), { timeout: 5000 })
      .not.toBe(CODE)

    await expectNoRefusalReported(page)
  })
})
