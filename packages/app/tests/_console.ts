/**
 * Reading what the app TOLD THE USER, off the Console panel (#1443).
 *
 * ─── WHY THIS FILE EXISTS ───────────────────────────────────────────────────────
 * Three roll specs each carried their own copy of a `warnCount` helper that read a
 * `title` attribute off the status bar's console chip. `718c9bb3` retired the
 * status bar and did not touch them, so all three went on asking for an element
 * that no longer exists — six tests, each burning a full 30s timeout, for months.
 *
 * Both vitest gates stayed green the whole time, and the browser leg failed by
 * TIMEOUT rather than by assertion, so the run just took six minutes longer and
 * exited 1 at the end. Nothing pointed at the cause.
 *
 * The helper lives here, once, so the next surface retirement breaks in ONE place
 * and says so.
 *
 * ─── WHY THE CONSOLE ROWS AND NOT THE BADGE ─────────────────────────────────────
 * The chip's replacement is the unread badge on the Console's activity-bar button
 * (`[data-panel-badge="console"]`, already read by `console-badge.spec.ts`). It
 * would work, and it is the wrong instrument here:
 *
 *   1. It counts errors AND warnings in one number, so "one more unread thing
 *      appeared" cannot be told from "the refusal was reported".
 *   2. It is a count and nothing else. The old assertion could only ever say a
 *      number moved; it could not say the message named the right gesture.
 *   3. It is UNREAD work, cleared by opening the panel — so a delta read around a
 *      gesture is measuring the user's attention as much as the app's output.
 *
 * The Console rows carry the level, the runtime and the text, which is what the
 * property under test is actually about: a refused roll gesture is REPORTED, and
 * the report says which gesture. `timeline-refusal-reported.spec.ts` established
 * this shape for the same class of refusal (#1414); this is that shape, shared.
 *
 * ⚠ AND THE COUNT IS NOW ABSOLUTE, NOT A DELTA. The old helper read a delta
 * because the chip's number mixed every warning in the session, boot's included.
 * Filtering to `runtime="stave"` removes the need: boot's own logging is the
 * engine's, and the app raises no `stave` warning of its own until a gesture is
 * refused. That is asserted, not assumed — every `expectNoRefusal` arm below is
 * exactly that control, and it runs on the same fixture as its refused twin.
 */
import { expect, type Locator, type Page } from '@playwright/test'

/**
 * Rows the APP raised as warnings — `runtime: 'stave'` is what
 * `PianoRollGrid.reportRefusal` and `lib/writeRefusal` both stamp, and it is what
 * separates a refused gesture from the engine's own boot chatter.
 *
 * ⚠ Only meaningful once {@link openConsole} has run — the panel renders nothing
 * while it is closed, so an un-opened panel reports zero rows for every query.
 */
export function staveWarnings(page: Page): Locator {
  return page.locator('[data-testid="console-row"][data-runtime="stave"][data-level="warn"]')
}

/**
 * Open the Console panel from the activity bar and wait for it to render.
 *
 * Call it AFTER the gesture and after the document assertions: the panel is a
 * side region, so opening it narrows the editor and moves every roll cell.
 */
export async function openConsole(page: Page): Promise<void> {
  await page.locator('[data-activity-bar] [data-panel-id="console"]').click()
  await expect(page.locator('[data-testid="console-panel"]')).toBeVisible({ timeout: 10_000 })
}

/**
 * The refused gesture said so, exactly once, and named itself.
 *
 * `phrase` is the gesture's own words from `reportRefusal` ("Couldn't add that
 * note"). Asserting it is what stops this from passing on any warning that
 * happened to be raised for some other reason.
 */
export async function expectRefusalReported(
  page: Page,
  phrase: string,
  outcome: string = 'left unchanged',
): Promise<void> {
  await openConsole(page)
  await expect(staveWarnings(page), 'a refused gesture must tell the user it did not happen')
    .toHaveCount(1, { timeout: 10_000 })
  await expect(staveWarnings(page).first()).toContainText(phrase)
  // The refusal explains itself rather than only naming the gesture — the
  // sentence is the whole reason `warn` was chosen over a silent snap-back.
  //
  // ⚠ THE OUTCOME CLAUSE IS A PARAMETER BECAUSE ONE REFUSAL DOES NOT LEAVE THE DOCUMENT
  // ALONE (#1452). A move drag whose drop cell the writer declines has usually already
  // written accepted frames, so the note stands at the last one — not where it was
  // grabbed. "left unchanged" is the default because it is true of every other refusal,
  // and asserting it is what stops this from passing on a message that names the right
  // gesture and then describes a resting place the note is not in.
  await expect(staveWarnings(page).first()).toContainText(outcome)
}

/**
 * The accepted gesture stayed quiet.
 *
 * ⚠ THIS IS THE CONTROL, not a second pin. Without it "exactly one warning"
 * above is satisfied by reporting that is simply always on, and the specs would
 * still be green with the refusal path deleted.
 */
export async function expectNoRefusalReported(page: Page): Promise<void> {
  await openConsole(page)
  await expect(staveWarnings(page), 'an accepted gesture must stay quiet').toHaveCount(0)
}
