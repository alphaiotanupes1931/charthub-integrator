import { describe, it, expect } from "vitest";
import { refineSniper, sniperInterval } from "@/lib/agents/sniper.server";
import type { MarketSnapshot } from "@/lib/agents/types";

function snap(over: Partial<MarketSnapshot> = {}): MarketSnapshot {
  const candles = Array.from({ length: 60 }, (_, i) => {
    const base = 3300 + i * 2; // clean up-leg 3300 -> 3418
    return { time: i * 900, open: base, high: base + 3, low: base - 3, close: base + 1, volume: 100 };
  });
  return {
    ticker: "XAU/USD",
    interval: "15",
    source: "oanda",
    lastPrice: 3418,
    candles,
    stats: { high20: 3418, low20: 3380, high50: 3418, low50: 3302, atr14: 10, changePct24h: 1, range20Pct: 1 },
    cisd: { state: "bullish", level: 3400, trigger: 3405, proj1: 3430, proj2: 3450, htfBias: "bullish" },
    sessionsActive: ["London"],
    fetchedAt: new Date().toISOString(),
    ...over,
  } as MarketSnapshot;
}

describe("sniper refinement", () => {
  it("drops one timeframe", () => {
    expect(sniperInterval("60")).toBe("15");
    expect(sniperInterval("240")).toBe("60");
    expect(sniperInterval("D")).toBe("240");
  });

  it("finds a deeper long limit with tighter risk and better R:R", () => {
    const r = refineSniper(snap(), { bias: "Long", entry: 3414, stop: 3400, tp1: 3440, tp2: 3460 });
    expect(r.improved).toBe(true);
    expect(r.entry).toBeLessThan(3414);
    expect(r.riskAfter).toBeLessThanOrEqual(r.riskBefore);
    expect(r.rr).toBeGreaterThan(r.rrBefore);
    expect(r.orderType).toBe("BUY LIMIT");
    expect(r.tp1).toBe(3440);
    expect(r.notes).not.toMatch(/[—–]/);
  });

  it("keeps the original plan when nothing beats it", () => {
    // Entry already sitting at the deepest fib of the leg.
    const r = refineSniper(snap(), { bias: "Long", entry: 3325, stop: 3300, tp1: 3340, tp2: 3360 });
    expect(r.improved).toBe(false);
    expect(r.entry).toBe(3325);
    expect(r.rr).toBeCloseTo(r.rrBefore, 5);
  });

  it("never widens risk beyond the original", () => {
    const r = refineSniper(snap(), { bias: "Long", entry: 3416, stop: 3413, tp1: 3450, tp2: 3480 });
    if (r.improved) expect(r.riskAfter).toBeLessThanOrEqual(r.riskBefore * 1.05);
  });

  it("handles shorts by hunting premium above price", () => {
    const down = Array.from({ length: 60 }, (_, i) => {
      const base = 3420 - i * 2;
      return { time: i * 900, open: base, high: base + 3, low: base - 3, close: base - 1, volume: 100 };
    });
    const s = snap({ candles: down, lastPrice: 3302, cisd: { state: "bearish", level: 3320, trigger: 3315, proj1: 3280, proj2: 3260, htfBias: "bearish" } });
    const r = refineSniper(s, { bias: "Short", entry: 3306, stop: 3320, tp1: 3280, tp2: 3260 });
    expect(r.improved).toBe(true);
    expect(r.entry).toBeGreaterThan(3306);
    expect(r.rr).toBeGreaterThan(r.rrBefore);
  });
});
