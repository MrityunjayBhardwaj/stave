/**
 * Ruler — the 28px cycle ruler that sits above the tracks body
 * (Phase 20-02 visual polish, DV-09).
 *
 * Audience: MUSICIAN. Vocabulary: only "CYCLES" caption + numeric
 * cycle labels (0/1/2 across the 2-cycle window). All other text
 * lives in MusicalTimeline.tsx's status line.
 *
 * Layout (mockup-literal, DV-02):
 *   ┌─────────────┬─────────────────────────────────────────────┐
 *   │  CYCLES     │  ▼              tick row                   │
 *   │  (gutter)   │  └ cycle labels: 0   1   2                 │
 *   │  90px       │  └ minor ticks at 1/4 cycle when ≥200px    │
 *   │  28px high  │                                             │
 *   └─────────────┴─────────────────────────────────────────────┘
 *
 * Width: ResizeObserver on the ruler-area inner div (mirrors
 * MusicalTimeline.tsx's pattern for the grid). Hide minor ticks
 * when measured width < 200px (Trap 4).
 *
 * currentCycle is a prop, not derived (DV-10). Parent's rAF loop
 * is the single source of truth.
 *
 * No zoom buttons (DV-06). Gutter shows "CYCLES" caption only.
 */
'use client'

import * as React from 'react'
import { useEffect, useRef, useState } from 'react'
import { useDisplayMeter } from '../../state/displayMeter'

import {
  WINDOW_CYCLES,
  cycleToPlayheadX,
} from './timeAxis'

export interface RulerProps {
  readonly currentCycle: number | null
  readonly gridContentWidth: number
}

const TOPBAR_HEIGHT = 28
const GUTTER_WIDTH = 90
const MINOR_TICK_HIDE_THRESHOLD = 200

export function Ruler(props: RulerProps): React.ReactElement {
  const { currentCycle, gridContentWidth } = props
  // The app-wide time signature (#1568) — the same one the song ruler and the
  // transport readout count in, so the live window cannot drift from them.
  const meter = useDisplayMeter()
  const rulerAreaRef = useRef<HTMLDivElement>(null)
  const [rulerAreaWidth, setRulerAreaWidth] = useState(0)

  useEffect(() => {
    const el = rulerAreaRef.current
    if (!el) return
    if (typeof ResizeObserver === 'undefined') {
      setRulerAreaWidth(el.clientWidth ?? 0)
      return
    }
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0
      setRulerAreaWidth(Math.max(0, w))
    })
    ro.observe(el)
    setRulerAreaWidth(el.clientWidth ?? 0)
    return () => ro.disconnect()
  }, [])

  // Major ticks at integer cycle boundaries: 0, 1, ..., WINDOW_CYCLES.
  const majorTicks: ReadonlyArray<{ cycleIdx: number; x: number; label: string }> =
    Array.from({ length: WINDOW_CYCLES + 1 }).map((_, i) => ({
      cycleIdx: i,
      x: (i / WINDOW_CYCLES) * rulerAreaWidth,
      label: String(i),
    }))

  // Minor ticks at the meter's beat divisions, EXCLUDING positions that
  // coincide with major ticks.
  const minorTicks: ReadonlyArray<{ key: string; x: number }> =
    rulerAreaWidth >= MINOR_TICK_HIDE_THRESHOLD
      ? Array.from({ length: WINDOW_CYCLES }).flatMap((_, cycleIdx) =>
          Array.from({ length: meter.beatsPerBar - 1 }).map((__, beatIdxMinusOne) => {
            const beatIdx = beatIdxMinusOne + 1 // 1..beatsPerBar-1
            const cycle = cycleIdx + beatIdx / meter.beatsPerBar
            return {
              key: `${cycleIdx}-${beatIdx}`,
              x: (cycle / WINDOW_CYCLES) * rulerAreaWidth,
            }
          }),
        )
      : []

  // Playhead X — same math as the grid below uses, so they align.
  const playheadX = cycleToPlayheadX(currentCycle, {
    gridContentWidth: rulerAreaWidth,
  })
  const playheadVisible = currentCycle != null && Number.isFinite(currentCycle)

  return (
    <div
      data-musical-timeline="ruler"
      style={styles.topbar}
    >
      <div
        data-musical-timeline="ruler-gutter"
        style={styles.gutter}
      >
        <span style={styles.caption}>CYCLES</span>
      </div>
      <div
        data-musical-timeline="ruler-area"
        ref={rulerAreaRef}
        style={styles.area}
      >
        {/* Major ticks + cycle labels */}
        {rulerAreaWidth > 0 &&
          majorTicks.map(({ cycleIdx, x, label }) => (
            <React.Fragment key={`major-${cycleIdx}`}>
              <div
                data-musical-timeline-ruler-major={cycleIdx}
                style={{ ...styles.majorTick, left: x }}
              />
              <div
                data-musical-timeline-ruler-label={cycleIdx}
                style={{ ...styles.cycleLabel, left: x }}
              >
                {label}
              </div>
            </React.Fragment>
          ))}
        {/* Minor ticks (hidden < 200px — Trap 4) */}
        {minorTicks.map(({ key, x }) => (
          <div
            key={`minor-${key}`}
            data-musical-timeline-ruler-minor={key}
            style={{ ...styles.minorTick, left: x }}
          />
        ))}
        {/* Playhead arrowhead — DV-10: parent owns currentCycle */}
        {playheadVisible && (
          <div
            data-musical-timeline="ruler-playhead-arrow"
            style={{ ...styles.playheadArrow, left: playheadX }}
          />
        )}
      </div>
    </div>
  )
}

// Phase 20-12 wave-ε — Ruler adopts theme CSS vars (PV43). Mockup
// values preserved as fallbacks for isolated mounts (storybook, unit
// tests without globals.css). Sibling of MusicalTimeline.tsx — δ-8
// missed this surface; ε-1 closes the gap so Ruler tracks light mode
// alongside the rest of the chrome.

const styles = {
  topbar: {
    height: TOPBAR_HEIGHT,
    minHeight: TOPBAR_HEIGHT,
    background: 'var(--bg-panel, #14141f)',
    borderBottom: '1px solid var(--border-subtle, rgba(255,255,255,0.08))',
    display: 'flex',
    alignItems: 'stretch',
    fontFamily:
      'var(--font-mono), ui-monospace, monospace',
    fontSize: 10,
    color: 'var(--text-tertiary, rgba(255,255,255,0.4))',
  },
  gutter: {
    width: GUTTER_WIDTH,
    flexShrink: 0,
    borderRight: '1px solid var(--border-subtle, rgba(255,255,255,0.08))',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'flex-end',
    padding: '0 8px',
  },
  caption: {
    letterSpacing: '0.1em',
    textTransform: 'uppercase' as const,
  },
  area: {
    flex: 1,
    position: 'relative' as const,
    overflow: 'hidden',
  },
  majorTick: {
    position: 'absolute' as const,
    top: 0,
    bottom: 8,
    width: 1,
    background: 'var(--text-tertiary, rgba(255,255,255,0.4))',
    pointerEvents: 'none' as const,
  },
  minorTick: {
    position: 'absolute' as const,
    bottom: 0,
    height: 6,
    width: 1,
    background: 'var(--text-muted, rgba(255,255,255,0.18))',
    pointerEvents: 'none' as const,
  },
  cycleLabel: {
    position: 'absolute' as const,
    bottom: 4,
    transform: 'translateX(2px)',
    color: 'var(--text-body, #e2e8f0)',
    fontSize: 10,
    pointerEvents: 'none' as const,
  },
  playheadArrow: {
    position: 'absolute' as const,
    top: 4,
    width: 0,
    height: 0,
    borderLeft: '5px solid transparent',
    borderRight: '5px solid transparent',
    borderTop: '7px solid var(--text-primary, rgba(255,255,255,0.55))',
    transform: 'translateX(-5px)',
    pointerEvents: 'none' as const,
  },
} satisfies Record<string, React.CSSProperties>
