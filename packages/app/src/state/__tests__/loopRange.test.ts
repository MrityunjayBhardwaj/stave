/**
 * #1570 — the loop-locator store.
 *
 * The arms that matter are the ones separating the range from the flag. A store
 * that kept only the range passes everything about arming and clearing, so
 * those arms certify nothing on their own; the toggle arms are what tell the
 * two designs apart.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  getLoopState,
  setLoopRange,
  setLoopEnabled,
  toggleLoopEnabled,
  clearLoopRange,
  effectiveLoopRange,
  subscribeLoopState,
  __resetLoopStateForTests,
} from "../loopRange";

beforeEach(() => {
  __resetLoopStateForTests();
});

describe("setLoopRange", () => {
  it("arms immediately — drawing a loop does not need a second gesture", () => {
    setLoopRange({ startCycle: 3, cycles: 2 });
    expect(getLoopState()).toEqual({ range: { startCycle: 3, cycles: 2 }, enabled: true });
    expect(effectiveLoopRange()).toEqual({ startCycle: 3, cycles: 2 });
  });

  it("treats a drag that ended where it started as no loop at all", () => {
    setLoopRange({ startCycle: 3, cycles: 0 });
    expect(getLoopState().range).toBeNull();
    expect(effectiveLoopRange()).toBeNull();
  });

  it.each([
    ["a negative length", { startCycle: 3, cycles: -2 }],
    ["a non-finite start", { startCycle: Number.NaN, cycles: 2 }],
    ["a non-finite length", { startCycle: 0, cycles: Number.POSITIVE_INFINITY }],
  ])("refuses %s", (_label, range) => {
    setLoopRange(range);
    expect(getLoopState().range).toBeNull();
  });

  it("clamps a start dragged past the left edge of the song", () => {
    setLoopRange({ startCycle: -4, cycles: 2 });
    expect(getLoopState().range).toEqual({ startCycle: 0, cycles: 2 });
  });
});

describe("the flag and the range are separate state", () => {
  // THE arm. Under a store that kept only the range, switching looping off
  // would have to discard the locators, and turning it back on would find
  // nothing to turn on.
  it("switching looping off keeps the locators where the user put them", () => {
    setLoopRange({ startCycle: 3, cycles: 2 });
    setLoopEnabled(false);

    expect(effectiveLoopRange()).toBeNull(); // the transport runs straight through
    expect(getLoopState().range).toEqual({ startCycle: 3, cycles: 2 }); // …but they are still there

    setLoopEnabled(true);
    expect(effectiveLoopRange()).toEqual({ startCycle: 3, cycles: 2 }); // back, undrawn
  });

  it("toggles both ways from one set of locators", () => {
    setLoopRange({ startCycle: 1, cycles: 4 });
    toggleLoopEnabled();
    expect(getLoopState().enabled).toBe(false);
    toggleLoopEnabled();
    expect(getLoopState().enabled).toBe(true);
    expect(getLoopState().range).toEqual({ startCycle: 1, cycles: 4 });
  });

  it("has nothing to toggle when no locators were ever set", () => {
    toggleLoopEnabled();
    expect(getLoopState()).toEqual({ range: null, enabled: false });
  });

  // The control that separates "switched off" from "cleared": both report the
  // same effective range, and only one of them still remembers the span.
  it("clearing is not the same as switching off", () => {
    setLoopRange({ startCycle: 3, cycles: 2 });
    setLoopEnabled(false);
    const switchedOff = getLoopState().range;

    clearLoopRange();
    expect(effectiveLoopRange()).toBeNull(); // agrees with switched-off…
    expect(getLoopState().range).toBeNull(); // …and differs here
    expect(switchedOff).not.toBeNull();
  });
});

describe("subscription", () => {
  it("notifies on a real change and stays quiet on a no-op write", () => {
    let notifications = 0;
    const stop = subscribeLoopState(() => {
      notifications++;
    });

    setLoopRange({ startCycle: 3, cycles: 2 });
    expect(notifications).toBe(1);

    setLoopRange({ startCycle: 3, cycles: 2 }); // same span, same flag
    expect(notifications).toBe(1);

    setLoopEnabled(false);
    expect(notifications).toBe(2);

    stop();
    setLoopRange({ startCycle: 9, cycles: 1 });
    expect(notifications).toBe(2); // unsubscribed
  });
});
