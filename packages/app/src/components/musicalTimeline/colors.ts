/**
 * colors — stem-aware track-color fallback (Phase 20-02 DV-04).
 *
 * The mockup's Variant A panel uses 4 stem-family colors derived
 * from the design tokens at artifacts/daw-level1-mockup.html:18-22:
 *   --stem-drums:  #f97316  (orange)
 *   --stem-bass:   #06b6d4  (cyan)
 *   --stem-pad:    #10b981  (green)
 *   --stem-melody: #a78bfa  (purple)
 *
 * Match precedence (DV-11): drums → bass → pad → melody. First match
 * wins. Fallback (no match) returns melody/purple — chosen so that an
 * unrecognized sample lands in the most-musical visual register
 * rather than a neutral gray.
 *
 * Match input: `event.s ?? trackId`. Sample name (when present)
 * outranks trackId because users author with `s("bd")` and the
 * trackId is often a synthetic dedupe of the sample.
 *
 * `evt.color` per-event override is honored at the call site (D-06
 * user-override) — `MusicalTimeline.tsx`'s
 * `evt.color ?? trackColorFromStem(...)` chain. This module owns
 * only the fallback.
 *
 * Phase 20-02 (T-02). Replaces the PR #92 hash-based fallback.
 */

/** Stem palette literals — copied verbatim from the mockup tokens. */
export const STEM_DRUMS = '#f97316'
export const STEM_BASS = '#06b6d4'
export const STEM_PAD = '#10b981'
export const STEM_MELODY = '#a78bfa'
export const STEM_FALLBACK = STEM_MELODY // DV-04 — fallback equals melody.

/**
 * Stem regex precedence (DV-11). Order matters — first match wins.
 * Each pattern is anchored with `^` so prefixes match without
 * accidentally hitting embedded substrings (e.g. `pre-bd` should
 * not match `bd`).
 */
const STEM_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  // Drums.
  [/^(?:bd|hh|sd|cp|hat|kick|snare|drum|perc|ride|crash|tom)/i, STEM_DRUMS],
  // Bass.
  [/^(?:bass|sub|808)/i,                                          STEM_BASS],
  // Pads.
  [/^(?:pad|pads)/i,                                               STEM_PAD],
  // Melody / lead / synth / piano / keys / guitar.
  [/^(?:lead|melody|synth|piano|keys|guitar)/i,                    STEM_MELODY],
] as const

/**
 * Map a track to its stem color.
 *
 * @deprecated Phase 20-11 — use paletteForTrack(trackIndexOf(trackId), sample)
 * instead. This shim is preserved for back-compat during the 20-11 → 20-12
 * chrome migration. Existing callers (chord-progression demo files, tests)
 * keep working until 20-12 retires this. New call sites SHOULD route through
 * paletteForTrack/trackIndexOf.
 *
 * @param trackId  the row's stable track id (never null — '$default'
 *                 is the sentinel from groupEventsByTrack)
 * @param sample   optional first-seen sample name from the row's
 *                 events (`event.s`). Outranks `trackId` for matching.
 * @returns        a hex color string from the stem palette, or
 *                 STEM_FALLBACK if no pattern matches.
 */
export function trackColorFromStem(
  trackId: string,
  sample?: string,
): string {
  const candidate = sample ?? trackId
  for (const [pattern, color] of STEM_PATTERNS) {
    if (pattern.test(candidate)) return color
  }
  return STEM_FALLBACK
}

/**
 * MIRROR (V-track-1, #579): the palette path below — `TRACK_PALETTE_32`,
 * `trackIndexOf`, `paletteForTrack` (and `stemHueGroup`) — is duplicated in the
 * editor-canonical `packages/editor/src/visualEdit/trackColor.ts` so the Mixer
 * can colour strips by the SAME algorithm (the editor can't import this app
 * file, and this app file can't import the editor barrel — P172). Keep the two
 * in sync: `trackColor.drift.test.ts` fails loudly if they diverge. The editor's
 * `colorForTrack(key)` === the Timeline's `paletteForTrack(trackIndexOf(key), key)`.
 *
 * Phase 20-11 D-03 — TRACK_PALETTE_32. Placeholder palette.
 * 4 stem hues × 8 lightness/saturation steps each — 32 cells total.
 * Exact swatches finalised in 20-12 design-system pass; this v1 keeps the
 * stem-family hue-group convention from 20-02 (drums/bass/pad/melody)
 * layered into 32 cells.
 *
 * Allocation: index `i` → stem-family `i % 4`, shade `Math.floor(i / 4)`.
 * paletteForTrack composes with stemHueGroup(sample) to bias auto-allocated
 * trackIndex toward the sample-derived hue family.
 */
export const TRACK_PALETTE_32: readonly string[] = [
  // Drums (orange family) — 8 lightness steps
  '#fed7aa', '#fdba74', '#fb923c', '#f97316', '#ea580c', '#c2410c', '#9a3412', '#7c2d12',
  // Bass (cyan family) — 8 lightness steps
  '#a5f3fc', '#67e8f9', '#22d3ee', '#06b6d4', '#0891b2', '#0e7490', '#155e75', '#164e63',
  // Pad (green family) — 8 lightness steps
  '#a7f3d0', '#6ee7b7', '#34d399', '#10b981', '#059669', '#047857', '#065f46', '#064e3b',
  // Melody (purple family) — 8 lightness steps
  '#ddd6fe', '#c4b5fd', '#a78bfa', '#8b5cf6', '#7c3aed', '#6d28d9', '#5b21b6', '#4c1d95',
] as const

// FNV-1a 32-bit. Per RESEARCH G5: locally scoped (not imported from
// collect.ts:fnv1a — keeps presentation directionally clean from IR).
function fnv1a32(str: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h = (h ^ str.charCodeAt(i)) >>> 0
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h >>> 0
}

// Stem-family classifier — internal, mirrors STEM_PATTERNS regex
// precedence (DV-11) but returns an index 0..3 (drums|bass|pad|melody).
function stemHueGroup(sample?: string): number {
  if (!sample) return 3   // unknown → melody slot (matches STEM_FALLBACK)
  for (let i = 0; i < STEM_PATTERNS.length; i++) {
    if (STEM_PATTERNS[i][0].test(sample)) return i
  }
  return 3
}

/**
 * Phase 20-11 — map a (trackIndex, sampleHint) to a palette slot.
 * trackIndex: 0-based — `d1` → 0, `d2` → 1, `d33` → 0 (mod 32 wrap).
 * sampleHint: optional first event's `evt.s` for stem-family bias.
 *
 * Allocation: each track gets a base slot derived from trackIndex,
 * biased by the sample's stem hue family — `(trackIndex * 4 + hueGroup) % 32`.
 * Two tracks at adjacent indices visit different hue families before
 * cycling back; consecutive tracks visually distinguishable.
 */
export function paletteForTrack(trackIndex: number, sampleHint?: string): string {
  const hueGroup = stemHueGroup(sampleHint)
  const slot = (((trackIndex * 4 + hueGroup) % 32) + 32) % 32   // safe mod for negative
  return TRACK_PALETTE_32[slot]
}

/**
 * Phase 20-11 — map a trackId string to a stable 0..31 index.
 * Auto-name shape (`d1`..`d{N}`): parse digit, return N-1 mod 32.
 * Custom name (.p("custom")): FNV-1a 32-bit hash mod 32. Acceptable
 * for v1; 20-12 lands user-pickable color UI for custom names.
 */
export function trackIndexOf(trackId: string): number {
  const m = trackId.match(/^d(\d+)$/)
  if (m) {
    const n = parseInt(m[1], 10)
    if (n >= 1) return ((n - 1) % 32 + 32) % 32
  }
  return fnv1a32(trackId) % 32
}

/**
 * THE canonical track colour from its key — the composed call the Timeline made
 * inline (`paletteForTrack(trackIndexOf(key), key)`). MIRROR of the editor's
 * `trackColor.colorForTrack` (V-track-1); `trackColor.drift.test.ts` guards them.
 */
export function colorForTrack(key: string): string {
  return paletteForTrack(trackIndexOf(key), key)
}

/** A track's resolved visual identity — name + colour from one canonical key.
 *  MIRROR of the editor's `trackColor.TrackIdentity` (V-track-1). */
export interface TrackIdentity {
  readonly key: string
  readonly name: string
  /** `customColor ?? colorForTrack(key)` (V-track-2, #581). */
  readonly color: string
}

/**
 * THE track-identity resolver — MIRROR of the editor's `trackColor.trackIdentity`
 * (V-track-1, #579). Both views (Mixer strip + Song Timeline lane) resolve colour
 * through this ONE function so they can't diverge. Phase D (V-track-2, #581): the
 * optional `customColor` layers a per-track user override on the deterministic
 * palette — `customColor ?? colorForTrack(key)`. The override is persisted per
 * file in the `TrackMeta` Yjs store keyed by the display name (this `key`), never
 * written to the source. `trackColor.drift.test.ts` asserts this mirror matches
 * the editor copy for both the default and the override path.
 */
export function trackIdentity(key: string, customColor?: string): TrackIdentity {
  return { key, name: key, color: customColor ?? colorForTrack(key) }
}

/**
 * Automation-curve hues, keyed by PARAMETER (#1485).
 *
 * A lane can carry several automated parameters — 47 corpus documents automate
 * `pan` and 76 automate `cutoff`, and a track doing both is ordinary. Drawn in
 * one colour they are three identical lines sharing a band, and since every
 * curve is normalised to its OWN range there is no positional cue either: a
 * curve near the top of the band is not "the high one", it is whichever signal
 * happens to be near its own maximum. The stacked bounds captions name three
 * parameters and tie none of them to a line.
 *
 * ⚠ DELIBERATELY NOT `TRACK_PALETTE_32`. Reusing the track palette is the
 * obvious "reuse the solved problem" move and it collides: an automation curve
 * is drawn INSIDE a lane, over that lane's own marks, so a `cutoff` curve
 * landing on a neighbouring track's swatch reads as belonging to that track.
 * What is genuinely reused is the solved part — `fnv1a32`, a stable string to
 * slot — over a palette of its own.
 *
 * Chosen to stay legible over both the light and dark row fills the timeline
 * draws, and to be distinguishable from each other at 1.5px stroke width, which
 * is what a curve is.
 */
export const AUTOMATION_PALETTE: readonly string[] = [
  '#8cc8ff', // blue — the family's original single colour, kept as slot 0
  '#f0a3c8', // pink
  '#8ce8b4', // green
  '#ffd08a', // amber
  '#c9a8ff', // violet
  '#6fe3e3', // teal
  '#ff9e8a', // salmon
  '#d6e08c', // olive
]

/**
 * A parameter's stable curve colour.
 *
 * Keyed on the parameter name rather than on its position in the lane, so
 * `cutoff` is the same colour in every track and across redraws — a lane
 * gaining a second automation must not recolour the first, or the hue means
 * "how many curves are here" instead of "which parameter is this".
 */
export function colorForAutomation(paramKey: string): string {
  return AUTOMATION_PALETTE[fnv1a32(paramKey) % AUTOMATION_PALETTE.length]
}
