import { describe, it, expect } from "vitest";
import { findTargetLevels, swingLevels, reachAtr } from "@/lib/agents/planner.server";
import type { MarketSnapshot } from "@/lib/agents/types";

/** Up-leg with a clear swing high at 3420 and a pullback, then continuation. */
function snap(over: Partial<MarketSnapshot> = {}): MarketSnapshot {
  const path = [
    3380, 3390, 3400, 3410, 3420, 3405, 3395, 3400, 3408, 3412,
    3416, 3418, 3414, 3410, 3412, 3415, 3417, 3419, 3416, 3418,
  ];
  const candles = path.map((p, i) => ({
    time: i * 900,
    open: p - 1,
    high: p + 2,
    low: p - 2,
    close: p,
    volume: 100,
  }));
  return {
    ticker: "XAU/USD",
    interval: "15",
    source: "oanda",
    lastPrice: 3418,
    candles,
    stats: { high20: 3422, low20: 3378, high50: 3450, low50: 3300, atr14: 10, changePct24h: 1, range20Pct: 1 },
    cisd: { state: "bullish", level: 3400, trigger: 3405, proj1: 3430, proj2: 3450, htfBias: "bullish" },
    sessionsActive: ["London"],
    fetchedAt: new Date().toISOString(),
    mtf: {
      h4: {
        direction: "bullish",
        trend: "up",
        keyLevels: { support: [3300], resistance: [3600] },
        supplyDemand: { supply: [[3620, 3640]], demand: [[3290, 3310]] },
      },
      h1: {
        structureBreak: "bullish",
        reversal: "none",
        orderBlocks: { bull: [], bear: [] },
        fvg: { bull: [], bear: [] },
        liquidity: { buyside: [3470], sellside: [3350] },
      },
      m15: { confirmation: "bullish", reason: "BOS" },
      alignment: "aligned-long",
    },
    ...over,
  } as MarketSnapshot;
}

describe("structure-based targets", () => {
  it("reads swing highs off the scan timeframe", () => {
    const highs = swingLevels(snap(), "high");
    expect(highs.some((h) => Math.abs(h - 3422) < 1)).toBe(true);
  });

  it("puts near-term structure ahead of far higher-timeframe shelves", () => {
    const levels = findTargetLevels("Long", 3410, snap());
    expect(levels.length).toBeGreaterThan(1);
    // Nearest level must be local structure, not the 3600 4H shelf.
    expect(levels[0]).toBeLessThan(3470);
    expect(levels).toContain(3600);
    // Sorted by distance from entry.
    const dists = levels.map((l) => Math.abs(l - 3410));
    expect([...dists].sort((a, b) => a - b)).toEqual(dists);
  });

  it("only returns levels beyond entry on the trade side", () => {
    expect(findTargetLevels("Long", 3410, snap()).every((l) => l > 3410)).toBe(true);
    expect(findTargetLevels("Short", 3410, snap()).every((l) => l < 3410)).toBe(true);
  });

  it("collapses levels that are the same shelf", () => {
    const levels = findTargetLevels("Long", 3410, snap());
    for (let i = 1; i < levels.length; i++) {
      const a = Math.abs(levels[i - 1]! - 3410);
      const b = Math.abs(levels[i]! - 3410);
      expect(Math.abs(b - a)).toBeGreaterThan(a * 0.15);
    }
  });

  it("still works with no higher-timeframe map", () => {
    const levels = findTargetLevels("Long", 3410, snap({ mtf: undefined }));
    expect(levels.length).toBeGreaterThan(0);
  });

  it("allows more travel on higher timeframes", () => {
    expect(reachAtr("15")).toBeLessThan(reachAtr("240"));
    expect(reachAtr("240")).toBeLessThan(reachAtr("D"));
  });
});
