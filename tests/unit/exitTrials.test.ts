import { describe, it, expect } from "vitest";
import { replayBreakevenAt1R, widenForCost, replayMinStopWidth } from "@/lib/exit-trials";

const created = "2026-01-01T00:00:00.000Z";
const t0 = Date.parse(created) / 1000;
const bar = (n: number, high: number, low: number) => ({ time: t0 + n * 3600, high, low, close: (high + low) / 2 });
const sig = { bias: "Long", entry: 100, stop: 98, tp1: 106, created_at: created };

describe("exit trials", () => {
  it("moves to breakeven after +1R and scores 0 on the return", () => {
    const r = replayBreakevenAt1R(sig, [bar(1, 100.5, 99.8), bar(2, 102.5, 100.5), bar(3, 101, 97)]);
    expect(r).toEqual({ status: "breakeven", r: 0 });
  });
  it("still takes the full loss before +1R", () => {
    expect(replayBreakevenAt1R(sig, [bar(1, 100.5, 99.8), bar(2, 101, 97)])?.r).toBe(-1);
  });
  it("does not arm breakeven on the same bar it reaches +1R", () => {
    expect(replayBreakevenAt1R(sig, [bar(1, 102.5, 97)])?.r).toBe(-1);
  });
  it("counts the target when reached", () => {
    expect(replayBreakevenAt1R(sig, [bar(1, 100.5, 99.8), bar(2, 106.5, 101)])?.r).toBe(3);
  });
  it("widens a tight EUR/USD stop and keeps R:R", () => {
    const s = { bias: "Short", entry: 1.1, stop: 1.1005, tp1: 1.099, created_at: created };
    const w = widenForCost(s, "EUR/USD", 0.1);
    expect(w.stop - w.entry).toBeCloseTo(0.002, 6);
    expect((w.entry - w.tp1) / (w.stop - w.entry)).toBeCloseTo(2, 6);
  });
  it("leaves a wide stop alone", () => {
    const s = { bias: "Long", entry: 1.1, stop: 1.095, tp1: 1.11, created_at: created };
    expect(widenForCost(s, "EUR/USD")).toEqual(s);
    expect(replayMinStopWidth(s, [bar(1, 1.1001, 1.0999), bar(2, 1.111, 1.1)], "EUR/USD")?.r).toBe(2);
  });
});
