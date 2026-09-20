import { describe, expect, it } from "vitest";
import { DEFAULT_PARAMS, runBacktest, type BtBar } from "@/lib/backtest/engine";

function bars(): BtBar[] {
  return Array.from({ length: 500 }, (_, i) => {
    const close = 100 + i * 0.03 + Math.sin(i / 5);
    return { time: 1_700_000_000 + i * 3600, open: close - 0.1, high: close + 0.4, low: close - 0.4, close, volume: 100 + (i % 7) * 10 };
  });
}

describe("read-only backtest signal filters", () => {
  it("leaves baseline results byte-equivalent when no filter is supplied", () => {
    const data = bars();
    const a = runBacktest(data, DEFAULT_PARAMS, { symbol: "EUR/USD", timeframe: "60", source: "test" });
    const b = runBacktest(data, DEFAULT_PARAMS, { symbol: "EUR/USD", timeframe: "60", source: "test" });
    expect(b).toEqual(a);
    expect(a.filterStats).toBeUndefined();
  });

  it("can reject candidates without changing their entry or outcome arithmetic", () => {
    const result = runBacktest(
      bars(),
      { ...DEFAULT_PARAMS, minGrade: "C", trendFilter: false },
      { symbol: "EUR/USD", timeframe: "60", source: "test" },
      { signalFilter: () => ({ accept: false }) },
    );
    expect(result.filterStats?.candidates).toBeGreaterThan(0);
    expect(result.filterStats?.retained).toBe(0);
    expect(result.trades).toHaveLength(0);
  });
});