/**
 * What `.speed` and `.stretch` each do to a take — the standing instrument
 * behind the vocal phase's pitch-correction gate (#1529, part of #1352).
 *
 * ─── WHY THIS IS A SPEC AND NOT A PARAGRAPH ─────────────────────────────────
 * The bounce-path work learned this the expensive way: a figure whose probe was
 * thrown away is a claim nothing can contradict, so it survives being wrong.
 * Every number in #1529 comes from this file, and the arms below are what stop
 * those numbers from quietly rotting.
 *
 * ⚠ SOME ARMS ASSERT A CURRENT SHORTFALL ON PURPOSE. If upstream ever replaces
 * the peak shifter, the pitch-error arms go RED. That redness is the
 * NOTIFICATION, not a failure — reopen the gate, re-read the numbers, and
 * re-point the arms at the new behaviour rather than widening them.
 *
 * ─── WHAT IT SETTLES ────────────────────────────────────────────────────────
 * #1352's Phase 4 says "Pitch correction is `.speed()`, time-align is
 * `.stretch()`". Grounded in the installed engine, it is the other way round:
 *
 *   `.speed(v)`   -> `playbackRate` on the AudioBufferSourceNode
 *                    (superdough@1.3.0 sampler.mjs:34-36). Varispeed: pitch and
 *                    duration move together.
 *   `.stretch(v)` -> an FX node, `phase-vocoder-processor` with
 *                    `pitchFactor: v` (superdough.mjs:627-630), which is phaze:
 *                    it shifts SPECTRAL PEAKS and advances its time cursor by
 *                    the OLA hop, unchanged (worklets.mjs:624-646, shiftPeaks at
 *                    :692). It never touches playbackRate, so it CANNOT change
 *                    duration.
 *                    ⚠ `pitchFactor = max(0, v + 1)` (worklets.mjs:630), so the
 *                    IDENTITY VALUE IS 0, not 1 — and a negative v is first
 *                    scaled by 0.25 (:627-629). `-2` is an octave down, `+1` an
 *                    octave up.
 *
 * Upstream's own doc block for `stretch` is a verbatim copy of `speed`'s —
 * "Changes the speed of sample playback… negative numbers play the sample
 * backwards" (@strudel/core controls.mjs:2387-2396) — and the implementation
 * contradicts it on every clause. That copy-paste is where the swapped sentence
 * came from, which is why this file states the grounding rather than the claim.
 *
 * ─── THE CONTROLS, and why each is here ─────────────────────────────────────
 * `.speed(2)` is not decoration. A control has to be able to FAIL for the reason
 * the measurement can fail: if the duration measure cannot see `.speed(2)` halve
 * the take, then it cannot see `.stretch` PRESERVE it either, and the headline
 * would rest on an instrument that only ever returns 1.000. `.stretch(0)` is the
 * identity floor — if the vocoder is not transparent at pitchFactor 1, nothing
 * from the shifted arms is attributable to the shift. Both were break-tested:
 * see the notes at each assertion for which arms flipped and which did not.
 *
 * ─── WHAT THIS DOES NOT ISOLATE ─────────────────────────────────────────────
 * The subjects are synthesised tones, so ground truth is exact — but they say
 * NOTHING about formant preservation on a real voice, transient smearing on
 * consonants, or how any of it sounds. The gate's perceptual half needs a sung
 * take; this measures the mechanism, its identity floor, its pitch accuracy and
 * its spectral cleanliness.
 */
import { test, expect, type Page } from '@playwright/test'

test.use({
  launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] },
})

// ---------------------------------------------------------------------------
// The subject — a known tone, built here so ground truth is not inferred
// ---------------------------------------------------------------------------

const TONE_HZ = 220
const TONE_SECONDS = 2
const TONE_SR = 48000

/** The vocoder's own FFT — `BUFFERED_BLOCK_SIZE`, superdough worklets.mjs:581. */
const VOCODER_FFT = 2048

/**
 * Three subjects, each earning its place:
 *  - `sinetone`  one partial: the clean read of pitch and duration.
 *  - `sawtone`   many partials: the artefact budget, and the shape a voice has.
 *  - `lowtone`   110 Hz: a male vocal fundamental, and the discriminating case
 *                for the bin-quantisation mechanism (see the last assertion).
 */
const SUBJECTS = [
  { kind: 'sine', hz: 220, name: 'sinetone' },
  { kind: 'saw', hz: 220, name: 'sawtone' },
  { kind: 'sine', hz: 110, name: 'lowtone' },
] as const

/**
 * 16-bit mono PCM WAV: `TONE_SECONDS` at `TONE_HZ`, 0.9 FS.
 *
 * `sine` has exactly one partial — the easiest possible subject for a
 * peak-shifting vocoder, and the right one for reading pitch and duration.
 * `saw` is band-limited (harmonics summed to 20 kHz, so nothing aliases and the
 * expected spectrum is known exactly) and is the subject the artefact budget
 * needs: a voice is many partials, and a peak shifter's error is in how it
 * places the ones it does not resolve.
 */
function toneWavBase64(kind: 'sine' | 'saw', hz: number): string {
  const frames = TONE_SR * TONE_SECONDS
  const data = Buffer.alloc(frames * 2)
  const partials = kind === 'sine' ? 1 : Math.floor(20000 / hz)
  let norm = 0
  for (let k = 1; k <= partials; k++) norm += 1 / k
  for (let i = 0; i < frames; i++) {
    let v = 0
    for (let k = 1; k <= partials; k++) {
      v += Math.sin((2 * Math.PI * hz * k * i) / TONE_SR) / k
    }
    v = (v / norm) * 0.9
    data.writeInt16LE(Math.round(v * 32767), i * 2)
  }
  const h = Buffer.alloc(44)
  h.write('RIFF', 0)
  h.writeUInt32LE(36 + data.length, 4)
  h.write('WAVE', 8)
  h.write('fmt ', 12)
  h.writeUInt32LE(16, 16)
  h.writeUInt16LE(1, 20)
  h.writeUInt16LE(1, 22)
  h.writeUInt32LE(TONE_SR, 24)
  h.writeUInt32LE(TONE_SR * 2, 28)
  h.writeUInt16LE(2, 32)
  h.writeUInt16LE(16, 34)
  h.write('data', 36)
  h.writeUInt32LE(data.length, 40)
  return Buffer.concat([h, data]).toString('base64')
}

// ---------------------------------------------------------------------------
// Reading the render
// ---------------------------------------------------------------------------

/** Minimal 16-bit PCM WAV reader — enough to measure, not a decoder. */
function readWav(b64: string): { sampleRate: number; mono: Float64Array } {
  const buf = Buffer.from(b64, 'base64')
  const channels = buf.readUInt16LE(22)
  const sampleRate = buf.readUInt32LE(24)
  let off = 12
  while (off + 8 <= buf.length && buf.toString('ascii', off, off + 4) !== 'data') {
    off += 8 + buf.readUInt32LE(off + 4)
  }
  const start = off + 8
  const size = buf.readUInt32LE(off + 4)
  const total = Math.floor(size / 2)
  const mono = new Float64Array(Math.floor(total / channels))
  for (let i = 0; i < mono.length; i++) {
    let acc = 0
    for (let c = 0; c < channels; c++) acc += buf.readInt16LE(start + (i * channels + c) * 2) / 32768
    mono[i] = acc / channels
  }
  return { sampleRate, mono }
}

function peak(x: Float64Array): number {
  let p = 0
  for (const v of x) if (Math.abs(v) > p) p = Math.abs(v)
  return p
}

/** In-place iterative radix-2 FFT (re/im). Length must be a power of two. */
function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      ;[re[i], re[j]] = [re[j], re[i]]
      ;[im[i], im[j]] = [im[j], im[i]]
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len
    const wr = Math.cos(ang)
    const wi = Math.sin(ang)
    for (let i = 0; i < n; i += len) {
      let cr = 1
      let ci = 0
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k]
        const ui = im[i + k]
        const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci
        const vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr
        re[i + k] = ur + vr
        im[i + k] = ui + vi
        re[i + k + len / 2] = ur - vr
        im[i + k + len / 2] = ui - vi
        const ncr = cr * wr - ci * wi
        ci = cr * wi + ci * wr
        cr = ncr
      }
    }
  }
}

const FRAME = 4096

/** Hann-windowed magnitude spectrum, averaged over frames across `[a, b)`. */
function spectrum(mono: Float64Array, a: number, b: number): Float64Array {
  const mag = new Float64Array(FRAME / 2)
  let frames = 0
  for (let off = a; off + FRAME <= b; off += FRAME / 2) {
    const re = new Float64Array(FRAME)
    const im = new Float64Array(FRAME)
    for (let i = 0; i < FRAME; i++) {
      re[i] = mono[off + i] * 0.5 * (1 - Math.cos((2 * Math.PI * i) / FRAME))
    }
    fft(re, im)
    for (let k = 0; k < FRAME / 2; k++) mag[k] += Math.hypot(re[k], im[k])
    frames++
  }
  if (frames === 0) return mag
  for (let k = 0; k < mag.length; k++) mag[k] /= frames
  return mag
}

/** Peak bin, parabolically interpolated, in Hz. 0 when the window is silent. */
function fundamental(mag: Float64Array, sr: number): number {
  let best = 1
  for (let k = 2; k < mag.length - 1; k++) if (mag[k] > mag[best]) best = k
  if (mag[best] <= 0) return 0
  const l = mag[best - 1]
  const c = mag[best]
  const r = mag[best + 1]
  const denom = l - 2 * c + r
  const shift = denom === 0 ? 0 : (0.5 * (l - r)) / denom
  return ((best + shift) * sr) / FRAME
}

/**
 * Fraction of 20 Hz–15 kHz energy lying within ±2 bins of a harmonic of `f0`.
 * 1 − this is the artefact budget: energy the source cannot account for.
 *
 * ⚠ ±2 bins, not ±3. At FRAME=4096 / 48 kHz a Hann main lobe is ~4 bins wide,
 * so a ±3 band swallows the lobe AND its skirts and returns 1.0000 for
 * everything — which the first run of this probe did for every arm including
 * the shifted one. A metric that cannot come back dirty is not a measurement,
 * which is why the `crush` arm below exists to prove this one can.
 */
function tonalFraction(mag: Float64Array, sr: number, f0: number): number {
  if (f0 <= 0) return 0
  const bin = (hz: number): number => Math.round((hz * FRAME) / sr)
  const lo = bin(20)
  const hi = Math.min(mag.length - 1, bin(15000))
  const wanted = new Set<number>()
  for (let h = 1; f0 * h <= 15000; h++) {
    const centre = bin(f0 * h)
    for (let d = -2; d <= 2; d++) if (centre + d >= lo && centre + d <= hi) wanted.add(centre + d)
  }
  let tonal = 0
  let total = 0
  for (let k = lo; k <= hi; k++) {
    const e = mag[k] * mag[k]
    total += e
    if (wanted.has(k)) tonal += e
  }
  return total > 0 ? tonal / total : 0
}

/**
 * Audible span, in seconds, inside `[a, b)`, measured against the ARM'S OWN
 * peak — never an absolute floor, so a quieter arm is not read as a shorter one.
 */
function audibleSpan(mono: Float64Array, a: number, b: number, sr: number): number {
  let p = 0
  for (let i = a; i < b; i++) if (Math.abs(mono[i]) > p) p = Math.abs(mono[i])
  if (p === 0) return 0
  const floor = p * 0.05
  let first = -1
  let last = -1
  for (let i = a; i < b; i++) {
    if (Math.abs(mono[i]) > floor) {
      if (first < 0) first = i
      last = i
    }
  }
  return first < 0 ? 0 : (last - first) / sr
}

// ---------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------

interface SpikeOutcome {
  ok: boolean
  error?: string
  workletOk?: boolean
  haps?: number
  wav?: string
}

async function openApp(page: Page): Promise<void> {
  await page.addInitScript(() => {
    ;(window as unknown as { __STAVE_E2E__: boolean }).__STAVE_E2E__ = true
  })
  await page.goto('/')
  await page.waitForFunction(
    () =>
      Boolean((window as unknown as { __staveBounceProbe?: unknown }).__staveBounceProbe) &&
      Boolean((window as unknown as { __staveAssetProbe?: unknown }).__staveAssetProbe),
    undefined,
    { timeout: 60_000 },
  )
}

/**
 * Wait until superdough's live `soundMap` is published on `globalThis`.
 *
 * It is a superdough module singleton that nothing publishes on its own — the
 * engine assigns it at init. Checking `inSoundMap` before that lands reads
 * `false` for a registration that in fact succeeded, which is what the first
 * run of this probe did (`tone:true:false`).
 */
async function soundMapPublished(page: Page): Promise<void> {
  await page.waitForFunction(
    () => Boolean((globalThis as unknown as { soundMap?: { get?: () => unknown } }).soundMap?.get),
    undefined,
    { timeout: 90_000 },
  )
}

/** Import the tone as an asset and register it, so `s(name)` plays it. */
async function installTone(page: Page, b64: string, name: string): Promise<string> {
  return page.evaluate(async ([wav, sound]) => {
    const p = (
      window as unknown as {
        __staveAssetProbe: {
          reset(): Promise<void>
          import(
            b: string,
            m: string,
            f: string,
            e?: unknown,
          ): Promise<{ record: { name: string } }>
          register(r: unknown): Promise<boolean>
          inSoundMap(n: string): boolean
        }
      }
    ).__staveAssetProbe
    const { record } = await p.import(wav as string, 'audio/wav', `${sound}.wav`)
    const ok = await p.register(record)
    return `${record.name}:${ok}:${p.inSoundMap(record.name)}`
  }, [b64, name] as const)
}

function render(page: Page, code: string, secs: number): Promise<SpikeOutcome> {
  return page.evaluate(
    ([c, s]) =>
      (
        window as unknown as {
          __staveBounceProbe: {
            offlineSuperdough(code: string, secs: number): Promise<SpikeOutcome>
          }
        }
      ).__staveBounceProbe.offlineSuperdough(c as string, s as number),
    [code, secs] as const,
  ) as Promise<SpikeOutcome>
}

// ---------------------------------------------------------------------------
// The measurement
// ---------------------------------------------------------------------------

/**
 * cps is 0.5, so one cycle is 2 s and `"~ tone"` puts the ONLY onset in the
 * render at t = 1.0 s. That placement is deliberate twice over: it leaves the
 * whole 2 s take inside a 4 s render, and it keeps the onset clear of
 * superdough's `t = t - 0.04` stretch pre-roll (superdough.mjs:446-450), which
 * at t = 0 would push the event before `currentTime` and drop it silently.
 */
const RENDER_SECONDS = 4

/**
 * Every arm, and what each is FOR. Two of the seven are controls that must be
 * able to come back wrong, which is the only thing that makes the other five
 * readable:
 *
 *  - `speed(2)` is the DURATION discriminator. If the duration measure cannot
 *    see this arm halve the take, then "stretch preserves duration" is a
 *    reading from an instrument that only ever returns 1.000.
 *  - `crush(4)` is the ARTEFACT discriminator. A bitcrusher fills the spectrum
 *    with energy the source cannot account for, so it MUST come back dirty. If
 *    it does not, the artefact column is blind and no verdict rests on it.
 *  - `stretch(0)` is the identity floor: pitchFactor 1. If the vocoder is not
 *    transparent here, nothing from the shifted arms is attributable to the shift.
 */
type Arm = { key: string; chain: string; role: string; want: number }
const ARMS: readonly Arm[] = [
  { key: 'baseline', chain: '', want: 1, role: 'the take, untouched' },
  { key: '.stretch(0)', chain: '.stretch(0)', want: 1, role: 'identity floor — pitchFactor 1' },
  { key: '.stretch(1)', chain: '.stretch(1)', want: 2, role: 'pitchFactor 2 — an octave up' },
  { key: '.stretch(0.5)', chain: '.stretch(0.5)', want: 1.5, role: 'pitchFactor 1.5 — a fifth, NOT bin-aligned' },
  { key: '.stretch(-2)', chain: '.stretch(-2)', want: 0.5, role: 'pitchFactor 0.5 — an octave DOWN (neg x0.25)' },
  { key: '.speed(2)', chain: '.speed(2)', want: 2, role: 'CONTROL: duration must halve' },
  { key: '.crush(4)', chain: '.crush(4)', want: 1, role: 'the metric is blind to HARMONIC distortion — by design' },
  { key: '+detuned', chain: '', want: 1, role: 'CONTROL: artefact column must go dirty' },
]

/**
 * The artefact control, and why it is not the obvious one.
 *
 * The first attempt was `.crush(4)`, and it came back 0.0006 on a sine — which
 * reads as "the metric is blind" and is not. `tonalFraction` counts energy that
 * is NOT on a harmonic of the observed f0; quantising a periodic signal is
 * HARMONIC distortion, landing exactly on those harmonics, so a bitcrusher
 * cannot move this metric however dirty it sounds. The control was wrong for
 * the metric, not the metric wrong. ⚠ Swapping controls until one passes is
 * fishing; this one is chosen from the metric's definition — a second voice a
 * FIFTH above and 10 dB down puts real energy at 1.5x f0, which is on no
 * harmonic of f0, so a metric that can see inharmonic energy MUST see it.
 * `.crush(4)` stays in the table as the recorded negative result.
 */
const DETUNED = (sound: string): string =>
  `stack(s("~ ${sound}"), s("~ ${sound}").speed(1.5).gain(0.3))`

interface Reading {
  f0: number
  span: number
  tonal: number
  peak: number
}

async function measureArms(
  page: Page,
  sound: string,
): Promise<{ sr: number; read: Record<string, Reading> }> {
  const out: Record<string, Reading> = {}
  let observedSr = 0
  for (const arm of ARMS) {
    const code = arm.key === '+detuned' ? DETUNED(sound) : `s("~ ${sound}")${arm.chain}`
    const res = await render(page, code, RENDER_SECONDS)
    if (!res.ok) throw new Error(`${sound} ${arm.key}: render failed (${res.workletOk}): ${res.error}`)
    const { sampleRate, mono } = readWav(res.wav!)
    observedSr = sampleRate
    // The take runs [1.0, 3.0). Analysis stays inside it on both sides: past the
    // onset transient, and short of the next cycle's onset at 3.0.
    const a = Math.floor(1.05 * sampleRate)
    const b = Math.floor(2.95 * sampleRate)
    const mag = spectrum(mono, a, b)
    const f0 = fundamental(mag, sampleRate)
    out[arm.key] = {
      f0,
      span: audibleSpan(mono, a, b, sampleRate),
      tonal: tonalFraction(mag, sampleRate, f0),
      peak: peak(mono.subarray(a, b)),
    }
  }
  return { sr: observedSr, read: out }
}

/**
 * The model, evaluated rather than remembered: what pitch the vocoder will
 * actually land on for a partial at `hz` shifted by `pitchFactor`.
 *
 * `shiftPeaks` rounds the shifted peak to an INTEGER bin — `fround(peakIndex *
 * pitchFactor)` with `fround = floor(x + 0.5)` (worklets.mjs:28, :697) — and
 * translates the whole region of influence by that same integer, so every bin
 * keeps its offset from the peak. Hence
 *
 *     achieved = (round(peakBin x pitchFactor) + delta) x binWidth
 *
 * ⚠ `binWidth` is `sr / 2048`, and `sr` is the DEVICE's rate, not a constant.
 * An earlier version of this file printed `sr=48000` as a literal and asserted
 * predictions computed at 48 kHz; a run that rendered at 44.1 kHz moved every
 * reading and flipped the sign on one of them. Everything below reads the rate
 * off the rendered WAV.
 */
function predictedHz(hz: number, sr: number, pitchFactor: number): number {
  const binWidth = sr / VOCODER_FFT
  const exact = hz / binWidth
  const peakBin = Math.round(exact) // findPeaks takes the maximum-magnitude bin
  const delta = exact - peakBin
  return (Math.floor(peakBin * pitchFactor + 0.5) + delta) * binWidth
}

function report(sound: string, hz: number, sr: number, m: Record<string, Reading>): void {
  const base = m['baseline']
  // NEAREST bin, not floor: `findPeaks` takes the maximum-magnitude bin, and a
  // partial at 4.693 bins peaks at bin 5. Getting this wrong flips the sign of
  // every prediction below — it did, once.
  const bin = Math.round(hz / (sr / VOCODER_FFT))
  console.log(
    `[G-V3] subject=${sound} input=${hz}Hz ${TONE_SECONDS}s sr=${sr} ` +
      `peakBin=${bin} (bin width ${(sr / VOCODER_FFT).toFixed(2)}Hz, delta=${(hz / (sr / VOCODER_FFT) - bin).toFixed(3)})`,
  )
  console.table(
    ARMS.map((arm) => ({
      arm: arm.key,
      peak: m[arm.key].peak.toFixed(4),
      'f0 Hz': m[arm.key].f0.toFixed(1),
      'f0 x': base.f0 > 0 ? (m[arm.key].f0 / base.f0).toFixed(3) : 'n/a',
      'want f0 x': arm.want.toFixed(3),
      'err cents':
        base.f0 > 0 && m[arm.key].f0 > 0
          ? (1200 * Math.log2(m[arm.key].f0 / base.f0 / arm.want)).toFixed(0)
          : 'n/a',
      'duration x': base.span > 0 ? (m[arm.key].span / base.span).toFixed(3) : 'n/a',
      'artefact 1-tonal': (1 - m[arm.key].tonal).toFixed(4),
      role: arm.role,
    })),
  )
}

test('what `.speed` and `.stretch` each do to a take, measured', async ({ page }) => {
  test.setTimeout(300_000)
  await openApp(page)
  await soundMapPublished(page)

  for (const s of SUBJECTS) {
    const installed = await installTone(page, toneWavBase64(s.kind, s.hz), s.name)
    expect(installed.endsWith(':true:true'), `${s.name} did not register: ${installed}`).toBe(true)
  }

  const read: Record<string, Record<string, Reading>> = {}
  let sr = 0
  for (const s of SUBJECTS) {
    const m = await measureArms(page, s.name)
    read[s.name] = m.read
    sr = m.sr
  }
  for (const s of SUBJECTS) report(s.name, s.hz, sr, read[s.name])
  const sine = read['sinetone']
  const saw = read['sawtone']

  // Nothing rendered silent — a silent arm still prints a number for every ratio.
  for (const arm of ARMS) {
    for (const s of SUBJECTS) {
      expect(read[s.name][arm.key].peak, `${s.name} ${arm.key} rendered silent`).toBeGreaterThan(0.01)
    }
  }

  // ── The two controls, asserted, because a measurement whose instrument is
  //    not proved is prose. These are about the PROBE, not about the product.
  expect(
    sine['.speed(2)'].span / sine['baseline'].span,
    'the duration measure cannot see .speed(2) halve the take — it cannot see stretch preserve it either',
  ).toBeLessThan(0.7)
  expect(
    1 - sine['+detuned'].tonal,
    'the artefact measure cannot see a partial off the harmonic series — it is blind',
  ).toBeGreaterThan(0.01)

  // The instrument's OWN error, so the shift errors below can be told from it:
  // a known 220.000 Hz input read back through the same FFT + interpolation.
  console.log(
    `[G-V3] instrument error: known 220.000 Hz read as ${sine['baseline'].f0.toFixed(3)} Hz ` +
      `(${(((sine['baseline'].f0 - 220) / 220) * 100).toFixed(2)}%)`,
  )

  // ── THE MODEL, ASSERTED AS A MODEL ────────────────────────────────────────
  // Not "the error is about -36 cents" — that is a fact about one device's
  // sample rate, and hardcoding it is exactly what broke this file once. The
  // assertion is the FORMULA, evaluated at the rate this run actually rendered
  // at. It is a much sharper claim: it has to be right for every subject, every
  // shift, and every device rate simultaneously.
  //
  // ⚠ Break-tested by making the `.stretch(1)` arm not shift at all: the
  // per-arm assertions below go red. A sign-only test does NOT — it cannot tell
  // a 38-cent miss from no shift whatever — which is why these compare against
  // a predicted VALUE and not against zero.
  const PITCH_FACTOR: Record<string, number> = {
    '.stretch(0)': 1,
    '.stretch(1)': 2,
    '.stretch(0.5)': 1.5,
    '.stretch(-2)': 0.5,
  }
  for (const s of SUBJECTS) {
    for (const [arm, pf] of Object.entries(PITCH_FACTOR)) {
      const want = predictedHz(s.hz, sr, pf)
      const got = read[s.name][arm].f0
      const err = 1200 * Math.log2(got / want)
      console.log(
        `[G-V3] ${s.name} ${arm}: want ${want.toFixed(1)}Hz got ${got.toFixed(1)}Hz (${err.toFixed(0)} cents), ` +
          `vs an ideal ${(s.hz * pf).toFixed(1)}Hz = ${(1200 * Math.log2(got / (s.hz * pf))).toFixed(0)} cents off`,
      )
      expect(
        Math.abs(err),
        `${s.name} ${arm} is not where bin-quantisation says it should be`,
      ).toBeLessThan(20)
    }
  }

  // And the gate's own finding: against the pitch actually ASKED for, the miss
  // is far outside anything correction could use. Asserting the CURRENT
  // shortfall on purpose — if upstream replaces the peak shifter this goes red,
  // and that is the notification to reopen the gate.
  const askedError = (name: string, arm: string, pf: number): number =>
    Math.abs(1200 * Math.log2(read[name][arm].f0 / (SUBJECTS.find((x) => x.name === name)!.hz * pf)))
  const worst = Math.max(
    askedError('sinetone', '.stretch(1)', 2),
    askedError('sinetone', '.stretch(-2)', 0.5),
    askedError('lowtone', '.stretch(1)', 2),
  )
  console.log(`[G-V3] worst miss against the pitch asked for: ${worst.toFixed(0)} cents`)
  expect(worst, 'the shifter got accurate — reopen gate G-V3').toBeGreaterThan(10)
})
