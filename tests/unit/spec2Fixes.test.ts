import { describe, it, expect } from "vitest";
import { detectSweepReversal } from "@/lib/sweep-reversal";
import { readWyckoffContext, wyckoffContextCap } from "@/lib/wyckoff-context";
import { composeGradeCaps } from "@/lib/spec2";
import { COACH_INTEGRITY_RULES } from "@/lib/coach-integrity";

const b = (t: number, o: number, h: number, l: number, c: number) => ({ time: t * 900, open: o, high: h, low: l, close: c });
function sweepSeries() {
  const out = [] as ReturnType<typeof b>[];
  for (let i = 0; i < 20; i++) out.push(b(i, 1.1340 + (i % 2 ? 0.0005 : 0), 1.1350, 1.1330, 1.1340));
  out.push(b(20, 1.1340, 1.1342, 1.1320, 1.1322)); // swing low forms
  out.push(b(21, 1.1322, 1.1335, 1.1315, 1.1330));
  out.push(b(22, 1.1330, 1.1338, 1.1325, 1.1335));
  out.push(b(23, 1.1335, 1.1340, 1.1328, 1.1336));
  out.push(b(24, 1.1336, 1.1337, 1.1318, 1.1320)); // down run
  out.push(b(25, 1.1320, 1.1322, 1.1305, 1.1318)); // sweep below 1.1315, close back
  out.push(b(26, 1.1318, 1.1345, 1.1317, 1.1342)); // body close above CISD 1.1336
  return out;
}

describe("Fix 4 sweep reversal", () => {
  it("arms a long against bearish HTF, flags counter-bias, caps at B, never publishes", () => {
    const r = detectSweepReversal(sweepSeries(), { atr: 0.001, h4: "bearish", h1: "bearish" });
    expect(r.state).toBe("ARMED_LONG");
    expect(r.counterBiasReversal).toBe(true);
    expect(r.rationale).toContain("reversal attempt");
    expect(r.stop!).toBeLessThan(r.sweep!.extreme);
    expect(r.publishable).toBe(false);
    if (!r.structureBreak) expect(r.maxGrade).toBe("B");
  });
  it("invalidates on a body close beyond the extreme", () => {
    const s = sweepSeries(); s[s.length - 1] = b(26, 1.1318, 1.1319, 1.1290, 1.1295);
    expect(detectSweepReversal(s, { atr: 0.001 }).state).toBe("INVALIDATED");
  });
});

describe("Fix 5 context layer", () => {
  it("only uses A-E phase letters and caps opposing setups one letter", () => {
    const bars = [] as ReturnType<typeof b>[];
    for (let i = 0; i < 60; i++) bars.push(b(i, i % 2 ? 106 : 104, i % 2 ? 109 : 110, i % 2 ? 100 : 101, i % 2 ? 104 : 106));
    bars.push(b(60, 102, 103, 96, 102));
    for (let i = 61; i < 80; i++) bars.push(b(i, 102, 104, 101, 103));
    const ctx = readWyckoffContext(bars);
    expect(["A", "B", "C", "D", "E", "unknown"]).toContain(ctx.phase);
    expect(ctx.contextDirection).toBe("long_bias");
    const cap = wyckoffContextCap("Short", ctx)!;
    expect(composeGradeCaps("A", [cap, { rule: "fix4", maxGrade: "B" }])).toEqual({ grade: "B", setBy: cap.rule });
  });
});

describe("Fix 6 guardrails", () => {
  it("coach rules forbid flip under pushback and invented stats", () => {
    expect(COACH_INTEGRITY_RULES).toContain("No reversal without new evidence");
    expect(COACH_INTEGRITY_RULES).toContain("No invented statistics");
  });
});
