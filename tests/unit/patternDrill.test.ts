import { describe, expect, it } from "vitest";
import { findPatterns, nameChoices } from "@/lib/pattern-drill";

const b = (i: number, o: number, h: number, l: number, c: number) => ({ time: i, open: o, high: h, low: l, close: c });

describe("pattern drill", () => {
  it("finds a bullish engulfing after a decline", () => {
    const bars = Array.from({ length: 20 }, (_, i) => b(i, 120 - i, 120.5 - i, 118.5 - i, 119 - i));
    bars.push(b(20, 100.5, 100.6, 99.4, 99.6), b(21, 99.4, 101.5, 99.2, 101.2), b(22, 101, 101.5, 100.5, 101.1));
    const p = findPatterns(bars).find((x) => x.name === "Bullish engulfing");
    expect(p?.bias).toBe("bullish");
    expect(p!.highlight[1]).toBeLessThan(p!.window.length);
  });
  it("returns no patterns without data", () => {
    expect(findPatterns(undefined)).toEqual([]);
  });
  it("includes the correct name among four choices", () => {
    for (let s = 0; s < 10; s++) {
      const c = nameChoices("Hammer", s);
      expect(c).toContain("Hammer");
      expect(new Set(c).size).toBe(4);
    }
  });
});
