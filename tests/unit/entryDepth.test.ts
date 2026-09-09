import { describe, it, expect } from "vitest";
import { findEntryAnchor } from "@/lib/agents/planner.server";
import type { MarketSnapshot } from "@/lib/agents/types";

/** Snapshot with a shallow level right at price and a real zone below it. */
function snap(over: Partial<MarketSnapshot> = {}): MarketSnapshot {
  const candles = Array.from({ length: 30 }, (_, i) => ({
    time: i * 900,
    open: 3410,
    high: 3414,
    low: 3406,
    close: 3412,
    volume: 100,
  }));
  return {
    ticker: "XAU/USD",
    interval: "15",
    source: "oanda",
    lastPrice: 3418,
    candles,
    stats: { high20: 3422, low20: 3378, high50: 3450, low50: 3300, atr14: 10, changePct24h: 1, range20Pct: 1 },
    cisd: { state: "none", level: 0, trigger: 0, proj1: 0, proj2: 0, htfBias: "bullish" },
    sessionsActive: ["London"],
    fetchedAt: new Date().toISOString(),
    mtf: {
      h4: {
        direction: "bullish",
        trend: "up",
        keyLevels: { support: [3417], resistance: [3600] },
        supplyDemand: { supply: [], demand: [[3404, 3410]] },
      },
      h1: {
        structureBreak: "bullish",
        reversal: "none",
        orderBlocks: { bull: [], bear: [] },
        fvg: { bull: [], bear: [] },
        liquidity: { buyside: [], sellside: [] },
      },
      m15: { confirmation: "bullish", reason: "BOS" },
      alignment: "aligned-long",
    },
    ...over,
  } as MarketSnapshot;
}

describe("entry depth", () => {
  it("ignores a level sitting on top of price and uses the real zone", () => {
    const a = findEntryAnchor("Long", 3418, 10, snap());
    expect(a).not.toBeNull();
    // 3417 support is only 0.1x ATR away: that is a market order, not a limit.
    expect(a!.entry).toBeLessThanOrEqual(3418 - 4);
    expect(a!.label).toContain("demand");
  });

  it("returns nothing when every level is glued to price", () => {
    const s = snap({
      mtf: {
        ...snap().mtf!,
        h4: {
          direction: "bullish",
          trend: "up",
          keyLevels: { support: [3417.5], resistance: [3600] },
          supplyDemand: { supply: [], demand: [] },
        },
      },
    } as Partial<MarketSnapshot>);
    expect(findEntryAnchor("Long", 3418, 10, s)).toBeNull();
  });
});
