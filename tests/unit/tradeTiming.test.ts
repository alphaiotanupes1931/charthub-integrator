import { describe, expect, it } from "vitest";
import { classifyTradeStyle, computeTiming } from "@/lib/tradeTiming";
import { entryTriggerRead, reachAtr } from "@/lib/agents/planner.server";
import type { MarketSnapshot } from "@/lib/agents/types";

describe("trade style selection", () => {
  it("uses scalp for fast or unusually volatile lower-timeframe setups", () => {
    expect(classifyTradeStyle({ interval: "5" })).toBe("scalp");
    expect(classifyTradeStyle({ interval: "15", atrPct: 1.1 })).toBe("scalp");
  });

  it("uses intraday for 15m through 1H and swing for 4H or higher", () => {
    expect(classifyTradeStyle({ interval: "15", atrPct: 0.3 })).toBe("intraday");
    expect(classifyTradeStyle({ interval: "60" })).toBe("intraday");
    expect(classifyTradeStyle({ interval: "240" })).toBe("swing");
    expect(classifyTradeStyle({ interval: "D" })).toBe("swing");
  });

  it("honors the trader override and changes the hold window", () => {
    expect(classifyTradeStyle({ interval: "60", tradeStyle: "swing" })).toBe("swing");
    const timing = computeTiming({ symbol: "XAU/USD", interval: "60", bias: "long", entry: 3400, stop: 3380, tp1: 3430, tp2: 3460, tradeStyle: "swing", now: new Date("2026-09-11T14:00:00Z") });
    expect(timing?.tradeStyle).toBe("swing");
    expect(timing?.holdTime).toBe("1 to 5 days");
  });

  it("calibrates target reach for the selected style", () => {
    expect(reachAtr("60", "scalp")).toBeLessThan(reachAtr("60", "intraday"));
    expect(reachAtr("60", "intraday")).toBeLessThan(reachAtr("60", "swing"));
  });

  it("requires confirmation from the execution timeframe for each style", () => {
    const candles = [
      { time: 1, open: 100, high: 101, low: 99, close: 100 },
      { time: 2, open: 100, high: 101, low: 99, close: 100 },
      { time: 3, open: 100, high: 101, low: 99, close: 100 },
      { time: 4, open: 101, high: 103, low: 100, close: 102 },
    ];
    const snap = {
      lastPrice: 102,
      candles,
      candles5m: candles,
      mtf: {
        h1: { structureBreak: "bullish" },
        m15: { confirmation: "bearish" },
      },
    } as MarketSnapshot;
    expect(entryTriggerRead("Long", snap, 1, "scalp").triggered).toBe(true);
    expect(entryTriggerRead("Long", snap, 1, "intraday").triggered).toBe(false);
    expect(entryTriggerRead("Long", snap, 1, "swing").triggered).toBe(true);
  });
});