"use client";

import React from "react";

import { useDisplayMeter, setDisplayMeter } from "../state/displayMeter";
import { BEAT_UNITS, MAX_BEATS_PER_BAR } from "../lib/meter";

/**
 * TimeSignatureControl (#1568) — the meter every readout counts in, next to the
 * transport display that shows the count.
 *
 * ⚠ THE COPY HERE IS LOAD-BEARING. This is a VIEW over cycles: a bar is one
 * cycle whatever the numerator says, so changing the signature changes how the
 * same music is counted and drawn and never what is played or how long a bar
 * lasts. The title text says exactly that, because a control that looks like a
 * DAW's time signature will otherwise be read as one — and the first user who
 * sets 3/4 expecting the music to change is right to call that a bug.
 *
 * ── WHY IT SITS BESIDE THE LCD AND NOT INSIDE IT ─────────────────────────────
 * Logic puts the signature in the same readout as the tempo, which is the shape
 * being followed. But the LCD is a `role="button"` that toggles cycles/bars on
 * click, and interactive controls nested inside a button are both invalid ARIA
 * and a propagation trap — every select click would also flip the units. A
 * sibling in the same slot reads as one cluster without either problem.
 *
 * Two selects rather than a popover with text inputs: the ranges are small and
 * closed (Ableton accepts the same denominators), a select is keyboard- and
 * screen-reader-navigable for free, and there is no half-typed state to
 * validate on the way to a valid one.
 */

const wrap: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 4,
  height: 22,
  padding: "0 6px",
  borderRadius: 4,
  background: "linear-gradient(180deg, #0a0a1a, #05050e)",
  border: "1px solid #01010a",
  boxShadow:
    "inset 0 1px 0 rgba(160,168,255,0.06), inset 0 0 12px rgba(80,90,200,0.14), 0 0 0 1px rgba(120,124,255,0.10), 0 1px 2px rgba(0,0,0,0.6)",
  fontFamily: 'var(--font-mono, ui-monospace, "SF Mono", Menlo, Consolas, monospace)',
};

const label: React.CSSProperties = {
  fontSize: 8,
  letterSpacing: "0.14em",
  color: "#6f6fa0",
  textTransform: "uppercase",
  lineHeight: 1,
};

const select: React.CSSProperties = {
  appearance: "none",
  WebkitAppearance: "none",
  background: "transparent",
  border: "none",
  outline: "none",
  color: "#bcc2ff",
  textShadow: "0 0 6px rgba(150,158,255,0.55)",
  font: "inherit",
  fontSize: 12,
  fontWeight: 600,
  fontVariantNumeric: "tabular-nums",
  cursor: "pointer",
  padding: 0,
  textAlign: "center",
};

const slash: React.CSSProperties = { color: "#6f6fa0", fontSize: 12, fontWeight: 600 };

const BEAT_COUNTS = Array.from({ length: MAX_BEATS_PER_BAR }, (_, i) => i + 1);

export function TimeSignatureControl(): React.ReactElement {
  const meter = useDisplayMeter();

  return (
    <div
      style={wrap}
      data-stave-time-signature
      title="Time signature — how bars and beats are counted and drawn. A bar is always one cycle: this changes the reading, never what is played."
    >
      <span style={label}>Sig</span>
      <select
        style={select}
        aria-label="Beats per bar"
        data-stave-sig-beats
        value={meter.beatsPerBar}
        onChange={(e) => setDisplayMeter(Number(e.target.value), meter.beatUnit)}
      >
        {BEAT_COUNTS.map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </select>
      <span style={slash}>/</span>
      <select
        style={select}
        aria-label="Beat unit"
        data-stave-sig-unit
        value={meter.beatUnit}
        onChange={(e) => setDisplayMeter(meter.beatsPerBar, Number(e.target.value))}
      >
        {BEAT_UNITS.map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </select>
    </div>
  );
}
