/**
 * The song's tree comes from the PARSER, not from the debugger (#1558).
 *
 * `parseStrudelStages.ts` is a parallel reimplementation of `parseStrudel`'s
 * decisions, kept in sync by hand, and it exists only so the IR Inspector can
 * show a parse in steps. But `MusicalTimeline` analyses `snapshot.ir` — so
 * until #1558 the song depended on a debugging affordance, and #1553 proved
 * what that costs: a chain dropped in `runChainAppliedStage` took `.sound()`,
 * `.gain()`, `.room()` and `.lpf()` off six archive documents, one of which
 * kept 7 of its 66 notes.
 *
 * ## ⚠ WHY THIS TEST INJECTS SENTINELS INSTEAD OF PARSING ANYTHING
 *
 * Because the property is PROVENANCE, and provenance is not observable from the
 * output. Measured over all 558 archive documents:
 *
 *   - the two final trees are BYTE-IDENTICAL (corpus parity 0/558 since #1553
 *     and #1476), and
 *   - NEITHER carries any of the five stage-only fields (`unresolvedChain`,
 *     `chainOffset`, `dollarStart`, `dollarEnd`, `trackLabel`) — 0 of 558 on
 *     both sides.
 *
 * So there is no assertion over a real tree that can say which implementation
 * produced it. A test that parsed a document and compared trees would pass just
 * as happily after someone "simplified" this back to the staged output — it
 * would be green and meaningless. Handing in two distinguishable sentinels and
 * asking which one came back is the only arrangement that can fail for the
 * right reason.
 *
 * That is also why `buildStrudelPasses` takes its deps at all. The seam is not
 * decoration; it is the test's only purchase on the invariant.
 */
import { describe, it, expect, vi } from "vitest";
import {
  buildStrudelPasses,
  FINAL_PASS_NAME,
  type NamedPass,
  type StrudelPassDeps,
} from "../strudelPasses";
import type { PatternIR } from "@stave/editor";

/** Two trees that are trivially distinguishable — unlike the real ones. */
const FROM_STAGES = { tag: "Code", code: "STAGED" } as unknown as PatternIR;
const FROM_PARSER = { tag: "Code", code: "PARSED" } as unknown as PatternIR;

function deps(over: Partial<StrudelPassDeps> = {}): StrudelPassDeps {
  return {
    runStages: () => [
      { name: "RAW", ir: FROM_STAGES },
      { name: "MINI-EXPANDED", ir: FROM_STAGES },
      { name: "CHAIN-APPLIED", ir: FROM_STAGES },
    ],
    parse: () => FROM_PARSER,
    ...over,
  };
}

describe("#1558 — the final pass is the parser's, not the staged pipeline's", () => {
  it("takes the FINAL tree from the parser even when the stages disagree", () => {
    const passes = buildStrudelPasses('$: s("bd, cp").gain(.5)', deps());
    const final = passes[passes.length - 1];
    expect(final.ir).toBe(FROM_PARSER);
    // The thing #1553 did — the staged tree reaching the song — must not happen.
    expect(final.ir).not.toBe(FROM_STAGES);
  });

  it("passes the real source to the parser, not the staged seed", () => {
    const parse = vi.fn(() => FROM_PARSER);
    const code = '$: note("c e g").sound("piano")';
    buildStrudelPasses(code, deps({ parse }));
    expect(parse).toHaveBeenCalledWith(code);
  });

  it("still produces four passes, with the intermediates left to the stages", () => {
    const passes = buildStrudelPasses("$: s(\"bd\")", deps());
    expect(passes).toHaveLength(4);
    expect(passes.map((p) => p.name)).toEqual([
      "RAW",
      "MINI-EXPANDED",
      "CHAIN-APPLIED",
      FINAL_PASS_NAME,
    ]);
    // The Inspector's intermediate tabs are still the staged pipeline's — this
    // change does not bypass the debugger, it stops the song depending on it.
    expect(passes.slice(0, 3).every((p) => p.ir === FROM_STAGES)).toBe(true);
  });

  it("keeps the name the Inspector persists by", () => {
    // IRInspectorPanel restores the selected tab BY NAME (RESEARCH §3.2), so
    // renaming this silently resets every user's selected tab.
    expect(FINAL_PASS_NAME).toBe("Parsed");
  });

  it("supports the `ir` alias the snapshot contract requires", () => {
    // `IRSnapshot.ir` is documented as an alias of `passes[last].ir` and
    // publishers MUST keep them in sync (irInspector.ts:27). The call site
    // derives `finalIR` that way; this pins that the last entry is the one to
    // take, so a future append here cannot silently change what `ir` means.
    const passes: NamedPass[] = buildStrudelPasses("$: s(\"bd\")", deps());
    expect(passes[passes.length - 1].name).toBe(FINAL_PASS_NAME);
  });
});
