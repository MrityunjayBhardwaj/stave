import { test, expect, type Page } from '@playwright/test'

import { bootApp, seedCode } from './_appBoot'
import { readInk, firstMark } from './_waveformInk'

/**
 * The instrument for #1506 — a take draws its waveform on the Song timeline.
 *
 * Every other test of this feature runs against a recording mock context, which
 * reports that a fill was REQUESTED. That is a different question from whether
 * anything reached a screen, and the difference is not academic here: the first
 * version of this feature drew the whole waveform invisibly, in the bar's own
 * colour at the bar's own opacity, and eleven green geometry arms said nothing.
 * So this spec reads pixels back off the real canvas.
 *
 * ## What is measured, and what it does not isolate
 *
 * The fixture is a one-second take that is LOUD for its first half and SILENT
 * for its second. The measurement is a RATIO of two readings inside a single
 * canvas snapshot — the height of saturated lane ink in the loud quarter of the
 * mark against the same reading in the silent quarter. Never an absolute pixel
 * count: a canvas is a device, and a stroke does not cover the columns you asked
 * for.
 *
 * The ratio establishes that what is drawn TRACKS THE AUDIO'S AMPLITUDE, in the
 * right place, at the right scale. It does not establish that the shape is the
 * correct waveform of that sample — a rendering that drew any loud-then-quiet
 * envelope would satisfy it. That is deliberate: the exact envelope is the pure
 * `computePeaks` arithmetic, tested exhaustively where it can be tested exactly.
 *
 * ## Why it reloads
 *
 * The warm-up that makes a take visible before it is played hangs off project
 * load. Importing and then reloading is the real path, not a shortcut around it.
 */

interface AssetRecord {
  id: string
  name: string
  blobHash: string
  mime: string
  duration?: number
}

interface PageProbe {
  reset(): Promise<void>
  import(
    base64: string,
    mime: string,
    filename: string,
    existing?: AssetRecord[],
  ): Promise<{ record: AssetRecord; isFirstReference: boolean; written: boolean }>
  docAdd(record: AssetRecord): Promise<void>
  docList(): Promise<AssetRecord[]>
  inSoundMap(name: string): boolean
}

/**
 * Reached by cast rather than by a `declare global`. Three specs already declare
 * this window property with their own local `PageProbe`, and each additional
 * declaration is another duplicate-identifier error in the type-check; the cast
 * keeps this file from adding a fourth.
 */
type ProbeWindow = Window & { __staveAssetProbe?: PageProbe }

const SAMPLE_RATE = 44100
/** One second: long enough to occupy a readable share of a mark at any tempo. */
const TOTAL_FRAMES = SAMPLE_RATE

/**
 * A mono 16-bit WAV whose first half is a full-scale tone and whose second half
 * is digital silence.
 *
 * The asymmetry IS the instrument. A uniform tone would draw the same block a
 * plain bar draws, and the reading could not tell the feature from its absence.
 */
function loudThenSilentWav(): string {
  const data = Buffer.alloc(TOTAL_FRAMES * 2)
  const half = TOTAL_FRAMES / 2
  for (let i = 0; i < half; i++) {
    // 220 Hz at 0.9 full scale — loud, and periodic enough that every drawn
    // column of the loud half contains both a peak and a trough.
    const v = Math.sin((2 * Math.PI * 220 * i) / SAMPLE_RATE) * 0.9
    data.writeInt16LE(Math.round(v * 32767), i * 2)
  }
  // The remaining frames stay zero.

  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + data.length, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20) // PCM
  header.writeUInt16LE(1, 22) // mono
  header.writeUInt32LE(SAMPLE_RATE, 24)
  header.writeUInt32LE(SAMPLE_RATE * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36)
  header.writeUInt32LE(data.length, 40)
  return Buffer.concat([header, data]).toString('base64')
}

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control'

/**
 * How much of ONE lit mark's interior the overlay COVERS.
 *
 * ⚠ Reads `[data-full-song-overlay]` — the SECOND surface. The base canvas keeps
 * the waveform intact under either behaviour, so measuring it answers a
 * different question than this one; that mistake is what made the first attempt
 * at this measurement read as reassuring (#1508).
 *
 * Isolates the FIRST contiguous run of painted columns rather than bounding the
 * whole overlay. Two marks lighting at once would put the empty gap between them
 * inside a global bounding box, and an interior that is mostly gap reads as
 * "uncovered" no matter which way the mark is drawn — the arm would pass for a
 * reason that has nothing to do with the fix.
 */
async function litMarkCoverage(
  page: Page,
): Promise<{ painted: number; cols: number; interior: number; covered: number }> {
  return page.evaluate(() => {
    const NONE = { painted: 0, cols: 0, interior: 0, covered: 0 }
    const c = document.querySelector('[data-full-song-overlay]') as HTMLCanvasElement | null
    if (!c) return NONE
    const ctx = c.getContext('2d')
    if (!ctx || c.width === 0) return NONE
    const { width, height } = c
    const d = ctx.getImageData(0, 0, width, height).data
    const alphaAt = (x: number, y: number) => d[(y * width + x) * 4 + 3]

    let painted = 0
    const colPainted: number[] = []
    for (let x = 0; x < width; x++) {
      let n = 0
      for (let y = 0; y < height; y++) if (alphaAt(x, y) > 10) n++
      colPainted.push(n)
      painted += n
    }
    // First contiguous run of inked columns = one mark.
    let x0 = -1
    let x1 = -1
    for (let x = 0; x < width; x++) {
      if (colPainted[x] > 0) {
        if (x0 < 0) x0 = x
        x1 = x
      } else if (x0 >= 0) break
    }
    if (x0 < 0) return { painted, cols: 0, interior: 0, covered: 0 }

    let y0 = height
    let y1 = -1
    for (let x = x0; x <= x1; x++) {
      for (let y = 0; y < height; y++) {
        if (alphaAt(x, y) > 10) {
          if (y < y0) y0 = y
          if (y > y1) y1 = y
        }
      }
    }
    // Inset by the GLOW PAD alone, so the region measured is the mark's own rows
    // right out to its edge. The pad is 2 CSS px and the core ring lies inside
    // that same band, so the painted bounding box is set by the glow alone —
    // insetting by more than 2 skips the mark's outermost row, which is exactly
    // where ink that covers a full-scale peak would sit. Two earlier versions of
    // this inset (4, then 3) each read a clean 0 while the outer row was being
    // painted. Backing-store px, since the canvas is DPR-scaled.
    const dpr = Math.max(1, Math.round(width / Math.max(1, c.clientWidth)))
    const pad = 2 * dpr
    const ix0 = x0 + pad
    const ix1 = x1 - pad
    const iy0 = y0 + pad
    const iy1 = y1 - pad
    if (ix1 <= ix0 || iy1 <= iy0) return { painted, cols: x1 - x0 + 1, interior: 0, covered: 0 }
    let interior = 0
    let covered = 0
    for (let y = iy0; y <= iy1; y++) {
      for (let x = ix0; x <= ix1; x++) {
        interior++
        if (alphaAt(x, y) > 178) covered++ // 0.7 x 255 — the lit CORE's own floor
      }
    }
    return { painted, cols: x1 - x0 + 1, interior, covered }
  })
}

async function bootWithTimeline(page: Page): Promise<void> {
  await bootApp(page, { e2eHooks: true, drawer: { tabId: 'musical-timeline' } })
  await page.waitForFunction(() => Boolean((window as ProbeWindow).__staveAssetProbe), { timeout: 30_000 })
}

test.describe('a take is visible on the Song timeline', () => {
  test('its drawn shape follows the take’s own loud and silent halves', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))

    await bootWithTimeline(page)
    await page.evaluate(() => (window as ProbeWindow).__staveAssetProbe!.reset())

    // Import the take and record it in the project, exactly as saving one does.
    const wav = loudThenSilentWav()
    const record = await page.evaluate(async (base64) => {
      const p = (window as ProbeWindow).__staveAssetProbe!
      const res = await p.import(base64, 'audio/wav', 'take_1.wav', await p.docList())
      await p.docAdd(res.record)
      return res.record
    }, wav)
    expect(record.name).toBe('take_1')

    // The code that plays it, then a reload — which is what registers the
    // project's assets AND warms them, the path a real session takes.
    await seedCode(page, '$: s("take_1")')
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.waitForFunction(() => Boolean((window as ProbeWindow).__staveAssetProbe), { timeout: 30_000 })
    await page.waitForFunction(() => (window as ProbeWindow).__staveAssetProbe!.inSoundMap('take_1'), undefined, {
      timeout: 30_000,
    })
    await page.locator('[data-full-song-canvas]').waitFor({ timeout: 20_000 })

    // A tall row so the shape has amplitude to spend. The DEFAULT row height is
    // covered by a unit arm; here the point is the pixels, and a 30px mark makes
    // the reading unambiguous rather than marginal.
    await page.evaluate(() => {
      try {
        localStorage.setItem('stave:musicalTimeline.subRowHeight', '48')
      } catch {
        /* ignore */
      }
    })
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.locator('[data-full-song-canvas]').waitFor({ timeout: 20_000 })
    await page.waitForFunction(() => (window as ProbeWindow).__staveAssetProbe!.inSoundMap('take_1'), undefined, {
      timeout: 30_000,
    })

    // Wait for ink to actually arrive — the warm-up is async, and its whole job
    // is to make the canvas repaint once the decode lands.
    await expect
      .poll(async () => (await readInk(page)).columns.filter((n) => n > 0).length, {
        timeout: 30_000,
      })
      .toBeGreaterThan(20)

    const profile = await readInk(page)
    const mark = firstMark(profile)
    expect(mark.length).toBeGreaterThan(20)

    // The claim, as a ratio of two readings inside ONE snapshot: the mark's own
    // full height against the quietest column drawn inside it. A bar-only
    // rendering is flat, so every column is the full height and the ratio is 1.
    // A waveform of a take that is loud and then silent must reach both.
    const tallest = Math.max(...mark)
    const quietest = Math.min(...mark.filter((n) => n > 0))

    // eslint-disable-next-line no-console
    console.log(`[#1506] tallest=${tallest} quietest=${quietest} ratio=${(tallest / quietest).toFixed(2)}`)
    expect(tallest / quietest).toBeGreaterThan(3)

    // …and the quiet columns are in the mark's FIRST half, where this take's
    // silence actually is — not merely somewhere convenient.
    const quietestIndex = mark.indexOf(quietest)
    expect(quietestIndex).toBeLessThan(mark.length / 2)

    expect(errors).toEqual([])
  })

  test('while it sounds, the lit mark outlines the shape instead of covering it', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))

    await bootWithTimeline(page)
    await page.evaluate(() => (window as ProbeWindow).__staveAssetProbe!.reset())

    const wav = loudThenSilentWav()
    await page.evaluate(async (base64) => {
      const p = (window as ProbeWindow).__staveAssetProbe!
      const res = await p.import(base64, 'audio/wav', 'take_1.wav', await p.docList())
      await p.docAdd(res.record)
    }, wav)

    await seedCode(page, '$: s("take_1")')
    await page.evaluate(() => {
      try {
        localStorage.setItem('stave:musicalTimeline.subRowHeight', '48')
      } catch {
        /* ignore */
      }
    })
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.waitForFunction(() => Boolean((window as ProbeWindow).__staveAssetProbe), { timeout: 30_000 })
    await page.waitForFunction(() => (window as ProbeWindow).__staveAssetProbe!.inSoundMap('take_1'), undefined, {
      timeout: 30_000,
    })
    await page.locator('[data-full-song-canvas]').waitFor({ timeout: 20_000 })

    // PRECONDITION, asserted rather than assumed: the base canvas really is
    // drawing a shape here. Without this the coverage reading below would be
    // measuring a lit mark that has no waveform to hide, and would pass.
    await expect
      .poll(async () => firstMark(await readInk(page)).length, { timeout: 30_000 })
      .toBeGreaterThan(20)

    // Play. A CLICK first — a programmatic focus carries no user gesture and the
    // transport then reports no position, so nothing ever lights (#885).
    await page.locator('.monaco-editor').first().click()
    await page.keyboard.press(`${MOD}+Enter`)
    await page.locator('[data-full-song-overlay]').waitFor({ timeout: 20_000 })

    // Wait until a mark is actually lit AND is wide enough to have an interior.
    await expect
      .poll(async () => (await litMarkCoverage(page)).cols, {
        timeout: 20_000,
        message: 'the overlay never lit a mark wide enough to measure',
      })
      .toBeGreaterThan(20)

    const lit = await litMarkCoverage(page)
    // eslint-disable-next-line no-console
    console.log(
      `[#1508] painted=${lit.painted} cols=${lit.cols} interior=${lit.interior} covered=${lit.covered} ` +
        `coverage=${(lit.covered / Math.max(1, lit.interior)).toFixed(3)}`,
    )

    // The light is still THERE — this is the half that fails if the fix simply
    // stopped drawing, which would "pass" a coverage test perfectly.
    expect(lit.painted).toBeGreaterThan(0)
    expect(lit.interior).toBeGreaterThan(0)
    // …and it covers NOTHING. Zero rather than a ratio, because the three cases
    // were measured and a ratio cannot separate them: over this 229x30 mark the
    // covered count reads 0 with the rings outside, 448 with a 1px border drawn
    // ON the mark, and 6750 when the mark is filled. As a fraction of the
    // interior that middle case is 0.066 — under any threshold loose enough to
    // be safe, and it is a real defect. The count is what discriminates.
    expect(lit.covered).toBe(0)

    await page.screenshot({ path: 'test-results/take-waveform-lit-outline.png' })
    expect(errors).toEqual([])
  })
})
