import { describe, expect, it } from "vitest";
import {
  analyzeRegimeSplit,
  barsBefore,
  conditionsAtEmission,
  regimeAtEmission,
  type TaggedSignal,
} from "@/lib/regime-split.server";
import type { ReplayBar } from "@/lib/signal-replay";

function series(n: number, start: number, step: number): ReplayBar[] {
  const bars: ReplayBar[] = [];
  let price = start;
  for (let i = 0; i < n; i++) {
    price += step;
    bars.push({
      time: 1_700_000_000 + i * 3600,
      high: price + 1,
      low: price - 1,
      close: price,
    });
  }
  return bars;
}

const at = (bars: ReplayBar[], i: number) => new Date(bars[i]!.time * 1000).toISOString();

describe("regime reconstruction", () => {
  it("never reads a bar after the filing time", () => {
    const bars = series(100, 100, 0.5);
    const cut = barsBefore(bars, at(bars, 40));
    expect(cut).toHaveLength(41);
    expect(cut[cut.length - 1]!.time).toBe(bars[40]!.time);
  });

  it("returns null when there is not enough history", () => {
    const bars = series(30, 100, 0.5);
    expect(regimeAtEmission(bars, at(bars, 29), "60")).toBeNull();
  });

  it("keeps volume and depth neutral because history does not store them", () => {
    const bars = series(120, 100, 0.5);
    const c = conditionsAtEmission(bars, at(bars, 119), "60")!;
    expect(c.volRatio).toBe(1);
    expect(c.depth).toBe("normal");
  });

  it("calls a rising market a trend, not a range", () => {
    const bars = series(120, 100, 0.6);
    const c = conditionsAtEmission(bars, at(bars, 119), "60")!;
    expect(c.trend).toBe("up");
    expect(regimeAtEmission(bars, at(bars, 119), "60")).toMatch(/trend/);
  });

  it("never reconstructs breakout-expansion, which needs volume", () => {
    const bars = series(150, 100, 0.8);
    for (let i = 60; i < 150; i++) {
      expect(regimeAtEmission(bars, at(bars, i), "60")).not.toBe("breakout-expansion");
    }
  });
});

function row(over: Partial<TaggedSignal>): TaggedSignal {
  return {
    id: Math.random().toString(36).slice(2),
    symbol: "XAUUSD",
    timeframe: "60",
    grade: "B",
    bias: "Bullish",
    status: "target",
    r: 1,
    created_at: "2026-01-01T00:00:00.000Z",
    regime: "trend-continuation",
    ...over,
  };
}

describe("regime split report", () => {
  it("reports untagged signals instead of dropping them silently", () => {
    const rep = analyzeRegimeSplit([row({}), row({ regime: null })]);
    expect(rep.tagged).toBe(1);
    expect(rep.untagged).toBe(1);
    expect(rep.notes.some((n) => n.includes("could not be tagged"))).toBe(true);
  });

  it("refuses a verdict below the sample floor", () => {
    const rep = analyzeRegimeSplit([
      ...Array.from({ length: 5 }, () => row({ regime: "trend-continuation" })),
      ...Array.from({ length: 5 }, () => row({ regime: "quiet-chop", status: "stop", r: -1 })),
    ]);
    expect(rep.spread).toBeNull();
    expect(rep.verdict).toContain("Regime gating stays off");
  });

  it("computes hit rate and average R per regime", () => {
    const rep = analyzeRegimeSplit([
      ...Array.from({ length: 30 }, (_, i) =>
        row({ regime: "trend-continuation", status: i < 15 ? "target" : "stop", r: i < 15 ? 2 : -1 }),
      ),
    ]);
    const cell = rep.byRegime[0]!;
    expect(cell.decided).toBe(30);
    expect(cell.hitRate).toBe(50);
    expect(cell.avgR).toBeCloseTo(0.5, 5);
    expect(cell.enoughData).toBe(true);
    expect(cell.hitRate95).not.toBeNull();
  });

  it("compares the best and worst powered regimes", () => {
    const rep = analyzeRegimeSplit([
      ...Array.from({ length: 40 }, (_, i) =>
        row({ regime: "trend-continuation", status: i < 30 ? "target" : "stop", r: i < 30 ? 2 : -1 }),
      ),
      ...Array.from({ length: 40 }, (_, i) =>
        row({ regime: "quiet-chop", status: i < 5 ? "target" : "stop", r: i < 5 ? 2 : -1 }),
      ),
    ]);
    expect(rep.spread?.best).toBe("trend-continuation");
    expect(rep.spread?.worst).toBe("quiet-chop");
    expect(rep.spread!.avgRGap).toBeGreaterThan(0);
    expect(rep.verdict).toContain("shadow trial");
  });

  it("splits A grades separately from the pooled record", () => {
    const rep = analyzeRegimeSplit([
      row({ grade: "A", regime: "trend-pullback" }),
      row({ grade: "C", regime: "trend-pullback", status: "stop", r: -1 }),
    ]);
    expect(rep.aGradeByRegime[0]!.decided).toBe(1);
    expect(rep.overall.decided).toBe(2);
  });
});
