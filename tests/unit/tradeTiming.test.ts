import { describe, expect, it } from "vitest";
import { classifyTradeStyle, computeTiming } from "@/lib/tradeTiming";

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
});