import { describe, expect, it } from "vitest";
import { computeOrderBlocks, rankOrderBlocks, type ObCandle } from "@/lib/orderBlocks";

function bullishBreak(): ObCandle[] {
  return [
    { time: 1, open: 100, high: 102, low: 99, close: 101 },
    { time: 2, open: 101, high: 103, low: 100, close: 102 },
    { time: 3, open: 102, high: 104, low: 101, close: 103 },
    { time: 4, open: 103, high: 105, low: 102, close: 104 },
    { time: 5, open: 104, high: 106, low: 101, close: 102 },
    { time: 6, open: 102, high: 112, low: 102, close: 111 },
    { time: 7, open: 111, high: 114, low: 109, close: 113 },
    { time: 8, open: 113, high: 116, low: 112, close: 115 },
    { time: 9, open: 115, high: 118, low: 114, close: 117 },
  ];
}

describe("institutional order blocks", () => {
  it("uses the last opposing candle before displacement and keeps it fresh until price intersects it", () => {
    const blocks = computeOrderBlocks(bullishBreak(), { swing: 2, max: 6 });
    const block = blocks.find((candidate) => candidate.kind === "bullish");
    expect(block).toBeDefined();
    expect(block?.time).toBe(5);
    expect(block?.mitigations).toBe(0);
    expect(block?.strength).toBeGreaterThan(1);
  });

  it("ranks fresh aligned displacement with swept liquidity above a worn block", () => {
    const fresh = { kind: "bullish" as const, top: 102, bot: 100, time: 10, mitigatedTime: null, mitigated: false, mitigations: 0, strength: 1.8, breakLevel: 110 };
    const worn = { ...fresh, top: 104, bot: 102, time: 11, mitigatedTime: 12, mitigated: true, mitigations: 2, strength: 0.7, breakLevel: 108 };
    const ranked = rankOrderBlocks([worn, fresh], { bias: "bullish", price: 112, atr: 10, h4Direction: "bullish", sweptLiquidity: [110.5] });
    expect(ranked[0]?.time).toBe(10);
    expect(ranked[0]?.qualityLabel).toBe("high");
    expect(ranked[0]?.liquiditySweep).toBe(true);
  });
});