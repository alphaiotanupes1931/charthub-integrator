import { describe, expect, it } from "vitest";
import { applyChartPattern, detectChartPattern, type PatternRead } from "@/lib/detector/chart-patterns";
import type { ObCandle } from "@/lib/orderBlocks";

// Build candles that walk through the given price path (linear between points).
function path(points: number[], stepsPer = 6): ObCandle[] {
  const out: ObCandle[] = [];
  let t = 0;
  for (let k = 0; k < points.length - 1; k++) {
    for (let s = 0; s < stepsPer; s++) {
      const o = points[k]! + ((points[k + 1]! - points[k]!) * s) / stepsPer;
      const c = points[k]! + ((points[k + 1]! - points[k]!) * (s + 1)) / stepsPer;
      out.push({ time: t++ * 3600, open: o, close: c, high: Math.max(o, c) + 0.1, low: Math.min(o, c) - 0.1 });
    }
  }
  return out;
}

describe("chart pattern detector", () => {
  it("finds a confirmed double top once price closes under the neckline", () => {
    const r = detectChartPattern(path([100, 102, 101, 110, 104, 110, 103]));
    expect(r?.name).toBe("Double top");
    expect(r?.direction).toBe("bearish");
    expect(r?.status).toBe("confirmed");
  });
  it("flags a double bottom as forming before the neckline breaks", () => {
    const r = detectChartPattern(path([110, 108, 109, 100, 106, 100, 104]));
    expect(r?.name).toBe("Double bottom");
    expect(r?.status).toBe("forming");
  });
  it("finds head and shoulders", () => {
    const r = detectChartPattern(path([100, 102, 101, 106, 103, 110, 103, 106, 101]));
    expect(r?.name).toBe("Head and shoulders");
    expect(r?.status).toBe("confirmed");
  });
});

describe("chart pattern grade nudge", () => {
  const read = (direction: PatternRead["direction"], status: PatternRead["status"]): PatternRead =>
    ({ name: "Double top", direction, status, trigger: 1, invalidation: 2, endTime: 0, text: "" });
  it("lifts B to A when a confirmed pattern agrees and no cap binds", () => {
    expect(applyChartPattern("B", "Short", read("bearish", "confirmed"), false)).toEqual({ grade: "A", action: "up" });
  });
  it("never lifts past A", () => {
    expect(applyChartPattern("A", "Short", read("bearish", "confirmed"), false).action).toBe("none");
  });
  it("does not lift when another cap binds", () => {
    expect(applyChartPattern("B", "Short", read("bearish", "confirmed"), true).action).toBe("none");
  });
  it("drops one letter when a confirmed pattern opposes the trade, never below C", () => {
    expect(applyChartPattern("B", "Long", read("bearish", "confirmed"), false).grade).toBe("C");
    expect(applyChartPattern("C", "Long", read("bearish", "confirmed"), false).grade).toBe("C");
  });
  it("forming patterns do not move the grade", () => {
    expect(applyChartPattern("B", "Short", read("bearish", "forming"), false).action).toBe("none");
  });
});

import { patternTradeLevels } from "@/lib/detector/chart-patterns";
import { TRADE_MANAGEMENT_RULES_PROMPT } from "@/lib/trade-management-rules.shared";

describe("new patterns and breakout levels", () => {
  it("finds a rising wedge as bearish", () => {
    const r = detectChartPattern(path([100, 110, 106, 114, 112, 117, 116, 119, 118], 5));
    expect(r?.name).toBe("Rising wedge");
    expect(r?.direction).toBe("bearish");
  });
  it("finds a falling wedge as bullish", () => {
    const r = detectChartPattern(path([120, 110, 114, 106, 108, 103, 104, 101, 102], 5));
    expect(r?.name).toBe("Falling wedge");
    expect(r?.direction).toBe("bullish");
  });
  it("finds a rectangle as neutral while inside the box", () => {
    const r = detectChartPattern(path([100, 110, 100, 110, 100, 110, 100, 105], 5));
    expect(r?.name).toBe("Rectangle");
    expect(r?.direction).toBe("neutral");
  });
  it("short breakout levels: stop above, target below, at least 1.5R", () => {
    const lv = patternTradeLevels({ name: "Double top", direction: "bearish", status: "confirmed", trigger: 100, invalidation: 110, endTime: 0, text: "" });
    expect(lv).toEqual({ side: "Short", entry: 100, stop: 110, target: 85, rr: 1.5 });
  });
  it("uses the measured move when it is bigger than 1.5R", () => {
    const lv = patternTradeLevels({ name: "Cup and handle", direction: "bullish", status: "confirmed", trigger: 100, invalidation: 96, endTime: 0, text: "", height: 20 });
    expect(lv?.target).toBe(120);
    expect(lv?.rr).toBe(5);
  });
  it("gives no levels to a neutral pattern", () => {
    expect(patternTradeLevels({ name: "Rectangle", direction: "neutral", status: "forming", trigger: 110, invalidation: 100, endTime: 0, text: "" })).toBeNull();
  });
  it("coach rules say a short with price above entry is drawdown", () => {
    expect(TRADE_MANAGEMENT_RULES_PROMPT).toContain("SHORT profit = entry - price");
  });
});
