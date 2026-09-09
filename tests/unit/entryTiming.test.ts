import { describe, it, expect } from "vitest";
import { entryTriggerRead, swingStopBeyond } from "@/lib/agents/planner.server";
import type { MarketSnapshot } from "@/lib/agents/types";

const candles = [
  { time: 1, open: 100, high: 101, low: 98, close: 100, volume: 10 },
  { time: 2, open: 100, high: 102, low: 97, close: 101, volume: 10 },
  { time: 3, open: 101, high: 103, low: 99, close: 102, volume: 10 },
  { time: 4, open: 102, high: 104, low: 100, close: 103, volume: 10 },
  { time: 5, open: 103, high: 105, low: 101, close: 104, volume: 10 },
  { time: 6, open: 104, high: 106, low: 102, close: 105, volume: 10 },
];

const snap = (m15: "bullish" | "bearish" | "none", h1: "bullish" | "bearish" | "none") =>
  ({
    ticker: "USD/JPY",
    interval: "15",
    lastPrice: 105,
    fetchedAt: new Date().toISOString(),
    candles,
    stats: { high20: 106, low20: 97, high50: 106, low50: 97, atr14: 2, changePct24h: 0, range20Pct: 1 },
    cisd: { state: "none", level: 0, trigger: 0, proj1: 0, proj2: 0, htfBias: "neutral" },
    sessionsActive: [],
    mtf: {
      h4: { direction: "bullish", trend: "up", keyLevels: { support: [], resistance: [] }, supplyDemand: { supply: [], demand: [] } },
      h1: { structureBreak: h1, reversal: "none", orderBlocks: { bull: [], bear: [] }, fvg: { bull: [], bear: [] }, liquidity: { buyside: [], sellside: [] } },
      m15: { confirmation: m15, reason: "" },
      alignment: "mixed",
    },
  }) as unknown as MarketSnapshot;

describe("entry timing", () => {
  it("is not triggered when neither the 15m nor 1H has turned", () => {
    const r = entryTriggerRead("Long", snap("none", "none"), 2);
    expect(r.triggered).toBe(false);
    expect(r.level).toBeGreaterThan(105);
    expect(r.rule).toMatch(/Not triggered/);
  });

  it("is triggered on 15m confirmation", () => {
    expect(entryTriggerRead("Long", snap("bullish", "none"), 2).triggered).toBe(true);
  });

  it("is triggered on a 1H structure break in the same direction", () => {
    expect(entryTriggerRead("Short", snap("none", "bearish"), 2).triggered).toBe(true);
  });

  it("places a long stop below the recent swing low with a buffer", () => {
    const stop = swingStopBeyond("Long", 103, 2, snap("none", "none"));
    expect(stop).not.toBeNull();
    expect(stop!).toBeLessThan(97);
  });

  it("places a short stop above the recent swing high with a buffer", () => {
    const stop = swingStopBeyond("Short", 103, 2, snap("none", "none"));
    expect(stop!).toBeGreaterThan(106);
  });
});
