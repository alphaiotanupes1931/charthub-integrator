import { describe, expect, it } from "vitest";
import { composeGradeCaps, counterBiasPublishable, tickClimax } from "@/lib/spec2";
import { evaluateRails, DEFAULT_AUTOPILOT_SETTINGS } from "@/lib/autopilot.shared";
import { deriveOrderType, orderTypeContradicts } from "@/lib/order-type";
import { analyzeGateVolume } from "@/lib/gate-volume";
import { COACH_INTEGRITY_RULES } from "@/lib/coach-integrity";

const live = { ...DEFAULT_AUTOPILOT_SETTINGS, liveAcknowledged: true, minGrade: "B" as const };
const base = { symbol: "XAU/USD", grade: "A", openPositions: 0 };

describe("spec 2", () => {
  it("caps take the single lowest, never stack, and name the rule", () => {
    const r = composeGradeCaps("A", [{ rule: "fix4_counter_bias", maxGrade: "B" }, { rule: "fix5_context", downgrade: 1 }]);
    expect(r).toEqual({ grade: "B", setBy: "fix4_counter_bias" });
    expect(composeGradeCaps("A+", [{ rule: "x", maxGrade: "C" }, { rule: "y", maxGrade: "B" }]).setBy).toBe("x");
    expect(composeGradeCaps("B", []).setBy).toBeNull();
  });
  it("counter-bias reversals stay internal until 30 resolved at positive R", () => {
    expect(counterBiasPublishable({ resolved: 29, avgR: 0.5 })).toBe(false);
    expect(counterBiasPublishable({ resolved: 30, avgR: 0 })).toBe(false);
    expect(counterBiasPublishable({ resolved: 30, avgR: 0.01 })).toBe(true);
  });
  it("autopilot refuses HOLD, ARMED, INVALIDATED, null grade and counter-bias reversals", () => {
    for (const s of ["HOLD", "ARMED", "INVALIDATED"]) expect(evaluateRails(live, { ...base, gateState: s }).allowed).toBe(false);
    expect(evaluateRails(live, { ...base, grade: null, gateState: "ARMED" }).allowed).toBe(false);
    expect(evaluateRails(live, { ...base, grade: "B", counterBiasReversal: true }).allowed).toBe(false);
    expect(evaluateRails(live, { ...base, gateState: "ACTIVE" }).allowed).toBe(true);
  });
  it("order type is derived both ways: short below market is SELL STOP, not SELL LIMIT", () => {
    expect(deriveOrderType("short", 1.1300, 1.1315)).toBe("SELL STOP");
    expect(orderTypeContradicts("SELL LIMIT", "short", 1.1300, 1.1315)).toBe(true);
    expect(orderTypeContradicts("SELL STOP", "short", 1.1324, 1.1315)).toBe(true);
  });
  it("climax uses a session-matched tick baseline", () => {
    const bars = [
      ...Array.from({ length: 20 }, () => ({ volume: 100, session: "asia" })),
      ...Array.from({ length: 20 }, () => ({ volume: 1000, session: "london" })),
      { volume: 1500, session: "london" },
    ];
    expect(tickClimax(bars, 40).climax).toBe(false); // high vs asia, normal for london
    bars.push({ volume: 2500, session: "london" });
    expect(tickClimax(bars, 41).climax).toBe(true);
  });
  it("coach knows phase letters and tick volume", () => {
    expect(COACH_INTEGRITY_RULES).toContain("D the move to the range boundary");
    expect(COACH_INTEGRITY_RULES).toContain("tick volume");
  });
  it("gate report shows total R change as well as average", () => {
    const rep = analyzeGateVolume([
      { symbol: "X", created_at: "2026-09-01T00:00:00Z", r: 1, sweepPass: true, stalePass: true },
      { symbol: "X", created_at: "2026-09-02T00:00:00Z", r: 2, sweepPass: false, stalePass: true },
    ]);
    expect(rep.deltaVsNone.sweep).toEqual({ avgR: -0.5, totalR: -2 });
  });
});
