import { describe, it, expect } from "vitest";
import { computeOrderFlow } from "@/lib/agents/order-flow.server";
import { gradeFromEvidence } from "@/lib/agents/planner.server";
import type { Candle, OrderFlow } from "@/lib/agents/types";

// 40 rising bars that close near their highs (bullish cumulative read), then a
// final bar that dumps hard into its low: the live delta contradicts the CVD.
function conflictedCandles(): Candle[] {
  const bars: Candle[] = [];
  for (let i = 0; i < 40; i++) {
    const base = 100 + i;
    bars.push({ time: i, open: base, high: base + 1, low: base - 0.1, close: base + 0.9, volume: 1000 });
  }
  const base = 140;
  bars.push({ time: 41, open: base + 3, high: base + 3.2, low: base - 3, close: base - 2.9, volume: 9000 });
  return bars;
}

const withFlow = (of: OrderFlow) =>
  ({
    lastPrice: 100,
    orderFlow: of,
    cisd: { htfBias: "bullish" },
    mtf: {
      h4: { direction: "bullish", trend: "up", keyLevels: { support: [], resistance: [] }, supplyDemand: { supply: [], demand: [] } },
      h1: { structureBreak: "none", reversal: "none", orderBlocks: { bull: [], bear: [] }, fvg: { bull: [], bear: [] }, liquidity: { buyside: [], sellside: [] } },
      m15: { confirmation: "bullish", reason: "with trend" },
      alignment: "aligned",
      ladder: [
        { label: "Daily", interval: "D", bias: "bullish", trend: "up", structure: "bullish", last: 100, high: 101, low: 99, changePct: 0.2, bars: 200 },
        { label: "4H", interval: "240", bias: "bullish", trend: "up", structure: "bullish", last: 100, high: 101, low: 99, changePct: 0.1, bars: 200 },
      ],
    },
  }) as never;

describe("order flow delta conflict", () => {
  it("flags the conflict and reports flow as neutral, not bullish", () => {
    const of = computeOrderFlow(conflictedCandles())!;
    expect(of.delta).toBeLessThan(0);
    expect(of.deltaConflict).toBe(true);
    expect(of.bias).toBe("neutral");
  });

  it("keeps a contradicted flow from backing an A grade", () => {
    const of = computeOrderFlow(conflictedCandles())!;
    const grade = gradeFromEvidence("Long", 95, withFlow(of));
    expect(["A", "A+"]).not.toContain(grade);
  });

  it("leaves agreeing flow untouched", () => {
    const clean = conflictedCandles().slice(0, 40);
    const of = computeOrderFlow(clean)!;
    expect(of.deltaConflict).toBe(false);
  });
});
