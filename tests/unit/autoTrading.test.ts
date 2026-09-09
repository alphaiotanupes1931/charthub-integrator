import { describe, it, expect } from "vitest";
import { DEFAULT_AUTOPILOT_SETTINGS, evaluateRails, gradeMeets } from "@/lib/autopilot.shared";
import { sizeFromRisk } from "@/lib/auto-trade.server";

const live = { ...DEFAULT_AUTOPILOT_SETTINGS, liveAcknowledged: true, allowedSymbols: [] };

describe("auto trading grade gate", () => {
  it("offers only setups at or above the chosen minimum grade", () => {
    expect(gradeMeets("A+", "A")).toBe(true);
    expect(gradeMeets("A", "A")).toBe(true);
    expect(gradeMeets("B", "A")).toBe(false);
    expect(gradeMeets("B", "B")).toBe(true);
    expect(gradeMeets("NO ENTRY", "B")).toBe(false);
  });

  it("blocks a below-grade setup through the rails too", () => {
    const v = evaluateRails(live, { symbol: "XAU/USD", grade: "C", openPositions: 0, dailyLossPct: 0 });
    expect(v.allowed).toBe(false);
  });

  it("requires the live acknowledgement before anything is placed", () => {
    const v = evaluateRails(
      { ...live, liveAcknowledged: false },
      { symbol: "XAU/USD", grade: "A+", openPositions: 0, dailyLossPct: 0 },
    );
    expect(v.allowed).toBe(false);
    expect(v.reason).toContain("acknowledged");
  });

  it("stops at the open position limit and the daily loss cap", () => {
    expect(evaluateRails(live, { symbol: "EUR/USD", grade: "A", openPositions: 2, dailyLossPct: 0 }).allowed).toBe(false);
    expect(evaluateRails(live, { symbol: "EUR/USD", grade: "A", openPositions: 0, dailyLossPct: 3.2 }).allowed).toBe(false);
    expect(evaluateRails(live, { symbol: "EUR/USD", grade: "A", openPositions: 0, dailyLossPct: 0.4 }).allowed).toBe(true);
  });
});

describe("position sizing from account equity", () => {
  it("risks the configured percentage over the stop distance", () => {
    expect(sizeFromRisk(10_000, 1, 100, 99)).toBe(100);
    expect(sizeFromRisk(10_000, 0.5, 100, 99)).toBe(50);
  });

  it("returns nothing when the account cannot carry one unit", () => {
    expect(sizeFromRisk(50, 0.5, 2000, 1900)).toBeNull();
    expect(sizeFromRisk(10_000, 1, 100, 100)).toBeNull();
    expect(sizeFromRisk(0, 1, 100, 99)).toBeNull();
  });
});
