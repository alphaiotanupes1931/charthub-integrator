import { describe, expect, it } from "vitest";
import { obEntryShadow } from "@/lib/ob-entry-shadow";
import type { ObCandle } from "@/lib/orderBlocks";

function series(): ObCandle[] {
  const base: ObCandle[] = [
    { time: 1, open: 100, high: 102, low: 99, close: 101 },
    { time: 2, open: 101, high: 103, low: 100, close: 102 },
    { time: 3, open: 102, high: 104, low: 101, close: 103 },
    { time: 4, open: 103, high: 105, low: 102, close: 104 },
    { time: 5, open: 104, high: 106, low: 101, close: 102 },
    { time: 6, open: 102, high: 112, low: 102, close: 111 },
  ];
  for (let t = 7; t <= 20; t++) base.push({ time: t, open: 111 + t * 0.3, high: 113 + t * 0.3, low: 110 + t * 0.3, close: 112 + t * 0.3 });
  return base;
}

describe("order-block entry shadow", () => {
  it("puts a long entry at the 1H order block, not at the break, with the stop past the block", () => {
    const r = obEntryShadow({ bias: "Long", lastPrice: 118, atr: 3, candles1h: series(), candles15m: [], liveEntry: 112 });
    expect(r).not.toBeNull();
    expect(r!.source).toBe("1H");
    expect(r!.entry).toBeLessThan(112);
    expect(r!.stop).toBeLessThan(r!.h1.bot);
  });

  it("returns no entry when there is no 1H order block", () => {
    expect(obEntryShadow({ bias: "Short", lastPrice: 118, atr: 3, candles1h: series(), candles15m: [] })).toBeNull();
  });
});
