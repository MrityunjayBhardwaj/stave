/**
 * trackId — the SINGLE rule that turns a track's source label into its stable
 * IR identity (`trackId`), shared by both parse paths (`parseStrudel` and the
 * staged `parseStrudelStages`).
 *
 * Two properties, both load-bearing for the Song timeline's lane identity:
 *
 *  1. MUTE-INVARIANT (#737). Mute is a `_` prefix on the label (`$:`→`_$:`,
 *     `drums:`→`_drums:`, design §6.4 / writeStrip.ts). The marker is a DISPLAY
 *     concern — orthogonal to identity — so it is stripped here before the id is
 *     derived. Without the strip, every muted `_$:` collapses onto the single id
 *     `_$` (all anon muted tracks become ONE lane) and a muted `_drums:` becomes
 *     a NEW lane `_drums` instead of staying `drums` — the track loses its place.
 *     Stripping mirrors the DISPLAY deriver `labelAtOffset` (trackLabel.ts:47),
 *     so identity and display agree (closes the P235 laneKey-carries-`_` trap).
 *
 *  2. ANON → POSITIONAL. `$:` (bare label `$`, and thus muted `_$:` after the
 *     strip) keeps the synthetic `d{index+1}` numbering, so existing multi-`$:`
 *     tunes are byte-identical and each anon track owns a distinct positional
 *     lane. A real `name:` label becomes the id verbatim.
 *
 * `index` is the track's 0-based position among the `$:`/`name:` statements
 * (single-track callers pass 0 → `d1`). PURE — no IR, no barrel — so it stays
 * out of the vitest CJS-`gifenc` trap (P172) and is freely unit-testable.
 */
export function trackIdFromLabel(label: string | undefined, index: number): string {
  const bare = label && label.startsWith('_') ? label.slice(1) : label
  return bare && bare !== '$' ? bare : `d${index + 1}`
}

/**
 * Is this label's track MUTED? (#1488)
 *
 * The other half of the same fact `trackIdFromLabel` above deliberately throws
 * away. Identity must not carry the marker — a muted `_drums:` is still the
 * `drums` lane — but "does this track sound?" is a real question with real
 * consumers, and until this existed the only way to answer it was to read the
 * character at the statement's source offset, which meant handing the document
 * text to anything that needed to know.
 *
 * Lives here, beside the strip, so the two readings of the `_` prefix can never
 * disagree about what a mute marker is.
 *
 * ⚠ A statement with NO label cannot be muted — muting is a prefix ON a label,
 * so a bare `s("bd*4")` has nothing to prefix. `undefined` is therefore false,
 * not unknown (`trackOrder.ts` measured that across every spelling).
 */
export function isMutedLabel(label: string | undefined): boolean {
  return label !== undefined && label.startsWith('_')
}
