import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { validateBosProtection, applySweepGate, REQUIRE_SWEEP_BY_MODEL } from "@/lib/sweep-gate";
import { deriveOrderType, orderTypeContradicts } from "@/lib/order-type";
import { computeRMath, formatPrice, stopInsideInvalidation, dedupStopEvents, verifiedLossStreak } from "@/lib/coach-integrity";
import { analyzeGateVolume } from "@/lib/gate-volume";
import type { BosRead } from "@/lib/protectedStructure";

// 9/29 EUR/USD: bearish break of 1.1332, origin 1.1358, sweep target 1.1366, swept=false.
const bos929: BosRead = {
  kind: "bearish", breakLevel: 1.1332, breakTime: 1, originLevel: 1.1358, originTime: 0,
  priorLevel: 1.1366, swept: false, sweepTime: null, protectedLevel: null, quality: "unprotected", reason: "",
};
const fmt = (n: number) => formatPrice("EUR/USD", n);
const c = (high: number, low: number, close: number, time = 2) => ({ time, open: close, high, low, close });

describe("sweep gate", () => {
  it("9/29 case returns HOLD with sweep level 1.1366 at full precision", () => {
    const g = validateBosProtection({ bos: bos929, side: "short", after: [c(1.1340, 1.1310, 1.1315)], atr: 0.0012, tick: 0.00001, fmt });
    expect(g.state).toBe("HOLD");
    expect(g.gradeAllowed).toBe(false);
    expect(g.watch?.sweepLevel).toBe(1.1366);
    expect(g.rationale).toContain("1.13660");
  });
  it("wick through and close back inside arms, stop beyond extreme plus buffer", () => {
    const g = validateBosProtection({ bos: bos929, side: "short", after: [c(1.1375, 1.1340, 1.1355)], atr: 0.0012, tick: 0.00001, fmt });
    expect(g.state).toBe("ARMED");
    expect(g.sweepExtreme).toBe(1.1375);
    expect(g.sweepStop!).toBeCloseTo(1.1378, 5);
  });
  it("body close above the pool is acceptance, not a sweep", () => {
    const g = validateBosProtection({ bos: bos929, side: "short", after: [c(1.1380, 1.1360, 1.1378)], atr: 0.0012, tick: 0.00001 });
    expect(g.state).toBe("INVALIDATED");
  });
  it("expires after 48 bars with no sweep", () => {
    const after = Array.from({ length: 48 }, (_, i) => c(1.1340, 1.1300, 1.1320, i + 2));
    expect(validateBosProtection({ bos: bos929, side: "short", after, atr: 0.0012, tick: 0.00001 }).state).toBe("INVALIDATED");
  });
  it("protected break proceeds", () => {
    expect(validateBosProtection({ bos: { ...bos929, swept: true, quality: "protected" }, side: "short", after: [], atr: 0.001, tick: 0.00001 }).state).toBe("ACTIVE");
  });
  it("is shadow-only for every model by default", () => {
    expect(Object.values(REQUIRE_SWEEP_BY_MODEL).every((v) => v === false)).toBe(true);
    const g = validateBosProtection({ bos: bos929, side: "short", after: [], atr: 0.001, tick: 0.00001 });
    const plan = { grade: "C", entry: "1.1325", stop: "1.1345", tp1: "1.1297" };
    expect(applySweepGate(plan, g, "classic").plan).toEqual(plan);
  });
  it("planner records the gate on every plan", () => {
    const src = readFileSync("src/lib/agents/planner.server.ts", "utf8");
    expect(src).toContain("sweepGate: shadowSweepGate(bias, snap)");
  });
});

describe("order type", () => {
  it("9/29 scan 1: short entry 9 pips above scan price is a SELL LIMIT", () => {
    expect(deriveOrderType("short", 1.1324, 1.1315, 0.0018)).toBe("SELL LIMIT");
    expect(orderTypeContradicts("SELL STOP", "short", 1.1324, 1.1315, 0.0018)).toBe(true);
  });
  it("full table", () => {
    expect(deriveOrderType("short", 1.1300, 1.1315)).toBe("SELL STOP");
    expect(deriveOrderType("long", 1.1300, 1.1315)).toBe("BUY LIMIT");
    expect(deriveOrderType("long", 1.1330, 1.1315)).toBe("BUY STOP");
  });
});

describe("coach integrity", () => {
  it("R math is computed in code: 0.5R slippage, -1.5R realized", () => {
    const m = computeRMath({ side: "short", plannedEntry: 1.1324, fill: 1.1315, stop: 1.1342, exit: 1.1342 })!;
    expect(m.slippageR).toBe(0.5);
    expect(m.realizedR).toBe(-1.5);
  });
  it("prices keep full precision", () => {
    expect(formatPrice("EUR/USD", 1.1366)).toBe("1.13660");
  });
  it("flags a stop inside the stated invalidation", () => {
    expect(stopInsideInvalidation("short", 1.1342, 1.1357)).toBe(true);
  });
  it("three sl hit messages on one trade are one loss", () => {
    const r = dedupStopEvents([{ tradeId: "t1", at: "a" }, { tradeId: "t1", at: "b" }, { tradeId: null, at: "c" }]);
    expect(r.losses).toEqual(["t1"]);
    expect(r.needsClarification).toBe(1);
  });
  it("loss streak counts only verified fills", () => {
    expect(verifiedLossStreak([{ realizedR: -1, closedAt: "2026-09-29" }, { realizedR: 1, closedAt: "2026-09-28" }])).toBe(1);
  });
});

describe("gate volume", () => {
  it("reports all four scenarios and the overlap", () => {
    const rows = [
      { symbol: "EUR/USD", created_at: "2026-09-01T00:00:00Z", r: 1, sweepPass: true, stalePass: true },
      { symbol: "EUR/USD", created_at: "2026-09-02T00:00:00Z", r: -1, sweepPass: false, stalePass: true },
      { symbol: "EUR/USD", created_at: "2026-09-09T00:00:00Z", r: -1, sweepPass: true, stalePass: false },
      { symbol: "EUR/USD", created_at: "2026-09-10T00:00:00Z", r: -1, sweepPass: false, stalePass: false },
    ];
    const rep = analyzeGateVolume(rows);
    expect(rep.pooled.none.signals).toBe(4);
    expect(rep.pooled.sweep.signals).toBe(2);
    expect(rep.pooled.stale.signals).toBe(2);
    expect(rep.pooled.both.signals).toBe(1);
    expect(rep.overlap).toEqual({ removedBySweepOnly: 1, removedByStaleOnly: 1, removedByBoth: 1 });
    expect(rep.pooled.both.totalR).toBe(1);
    expect(rep.weekly.length).toBe(2);
  });
});
