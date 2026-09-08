import { describe, it, expect } from "vitest";
import { nearTermOverrideRead } from "@/lib/agents/planner.server";
import type { MarketSnapshot } from "@/lib/agents/types";

// Short setup where the 1H, the 15m and real order flow all read bullish.
const shortWithBullishNearTerm = (h4Trend: "down" | "range"): MarketSnapshot => ({
  ticker: "USD/JPY", interval: "60", lastPrice: 153.9, candles: [], source: "yahoo",
  mtf: {
    alignment: "mixed",
    h4: { direction: "bearish", trend: h4Trend },
    h1: { structureBreak: "bullish" },
    m15: { confirmation: "bullish", reason: "t" },
    ladder: [
      { label: "4H", bias: "bearish", trend: h4Trend },
      { label: "1H", bias: "bullish", trend: "up" },
      { label: "15m", bias: "bullish", trend: "up" },
    ],
  },
  orderFlow: { bias: "bullish", delta: 6900, deltaAvg: 800, cvdSlope: 4, estimated: false },
} as unknown as MarketSnapshot);

describe("nearTermOverrideRead", () => {
  it("flips to the near-term side when the 4H is not trending against it", () => {
    const r = nearTermOverrideRead("Short", shortWithBullishNearTerm("range"));
    expect(r.bias).toBe("Long");
    expect(r.reason).toContain("near-term override");
  });

  it("stands aside when the 4H still trends with the original side", () => {
    const r = nearTermOverrideRead("Short", shortWithBullishNearTerm("down"));
    expect(r.bias).toBe("Neutral");
  });

  it("does nothing when the near-term reads agree with the bias", () => {
    const snap = shortWithBullishNearTerm("range");
    expect(nearTermOverrideRead("Long", snap).bias).toBeNull();
  });

  it("ignores estimated order flow", () => {
    const snap = shortWithBullishNearTerm("range") as unknown as { orderFlow: { estimated: boolean } };
    snap.orderFlow.estimated = true;
    expect(nearTermOverrideRead("Short", snap as unknown as MarketSnapshot).bias).toBeNull();
  });
});
