import { describe, expect, it } from "vitest";
import type { BtBar, BtResult, BtTrade } from "@/lib/backtest/engine";
import {
  COMPARISON_SAMPLE_FLOOR,
  buildResearchFilter,
  compareWindow,
  splitChronologically,
  summarize,
  tagBreakdown,
  verdictFor,
} from "@/lib/classic-research-backtest";

const bar = (i: number, close: number): BtBar => ({
  time: 1_700_000_000 + i * 3600,
  open: close,
  high: close + 1,
  low: close - 1,
  close,
  volume: 100,
});

const bars = Array.from({ length: 1000 }, (_, i) => bar(i, 100 + i * 0.1));

const trade = (over: Partial<BtTrade> = {}): BtTrade => ({
  id: 1,
  side: "Long",
  grade: "B",
  score: 4,
  reasons: [],
  session: "London",
  entryTime: 0,
  exitTime: 0,
  entry: 100,
  stop: 99,
  target: 102,
  exit: 102,
  r: 1,
  grossR: 1.1,
  costR: 0.1,
  outcome: "win",
  holdBars: 4,
  balanceAfter: 10_100,
  ...over,
});

const result = (trades: BtTrade[], stats: Partial<BtResult["stats"]> = {}, filterStats?: BtResult["filterStats"]): BtResult => ({
  symbol: "EUR/USD",
  timeframe: "60",
  source: "test",
  barCount: bars.length,
  from: bars[0].time,
  to: bars[bars.length - 1].time,
  params: {} as BtResult["params"],
  stats: {
    trades: trades.length,
    wins: trades.filter((t) => t.r > 0).length,
    losses: trades.filter((t) => t.r <= 0).length,
    timeouts: 0,
    winRate: 50,
    expectancyR: 0.1,
    netR: 1,
    grossExpectancyR: 0.2,
    grossNetR: 2,
    avgCostR: 0.1,
    avgWinR: 1,
    avgLossR: -1,
    profitFactor: 1.2,
    maxDrawdownPct: 5,
    maxConsecutiveLosses: 3,
    avgHoldBars: 4,
    returnPct: 1,
    benchmarkPct: 1,
    ...stats,
  },
  trades,
  equity: [],
  byGrade: [],
  bySide: [],
  bySession: [],
  byMonth: [],
  notes: [],
  filterStats,
});

describe("split and summary", () => {
  it("holds out the final portion of the bars chronologically", () => {
    const { observation, holdout } = splitChronologically(bars);
    expect(observation[0].time).toBe(bars[0].time);
    expect(observation.length).toBe(700);
    expect(holdout[holdout.length - 1].time).toBe(bars[bars.length - 1].time);
    // Holdout carries warm-up bars so indicators are defined, but its own
    // decision window starts after the observation cut.
    expect(holdout.length).toBeGreaterThan(300);
  });

  it("reports A and A+ trades on their own denominator", () => {
    const s = summarize(result([trade({ grade: "A", r: 1 }), trade({ grade: "A+", r: -1 }), trade({ grade: "C", r: 2 })]));
    expect(s.aGradeTrades).toBe(2);
    expect(s.aGradeExpectancyR).toBe(0);
  });

  it("breaks results down by the filter tag that admitted each trade", () => {
    const rows = tagBreakdown(result([
      trade({ filterTag: "london-reversal", r: 1 }),
      trade({ filterTag: "london-reversal", r: -1 }),
      trade({ filterTag: "new-york-reversal", r: 2 }),
    ]));
    expect(rows[0]).toMatchObject({ tag: "london-reversal", trades: 2, winRate: 50, expectancyR: 0 });
    expect(rows[1]).toMatchObject({ tag: "new-york-reversal", expectancyR: 2 });
  });
});

describe("comparison", () => {
  const baseline = result(Array.from({ length: 100 }, () => trade()), { expectancyR: 0.05 });
  const filtered = result(Array.from({ length: 40 }, () => trade({ filterTag: "x" })), { expectancyR: 0.3 }, { candidates: 100, retained: 40 });

  it("measures how much was filtered out and the expectancy difference", () => {
    const w = compareWindow("holdout", bars, baseline, filtered);
    expect(w.candidates).toBe(100);
    expect(w.retained).toBe(40);
    expect(w.filteredOutPct).toBe(60);
    expect(w.deltaExpectancyR).toBe(0.25);
    expect(w.enoughData).toBe(true);
  });

  it("refuses a verdict when the held-out sample is under the floor", () => {
    const thin = result(Array.from({ length: 5 }, () => trade()), { expectancyR: 0.9 }, { candidates: 50, retained: 5 });
    const verdict = verdictFor([
      compareWindow("observation", bars, baseline, filtered),
      compareWindow("holdout", bars, baseline, thin),
    ]);
    expect(verdict).toContain(`of ${COMPARISON_SAMPLE_FLOOR}`);
  });

  it("calls a worse held-out result education only", () => {
    const worse = result(Array.from({ length: 50 }, () => trade()), { expectancyR: -0.2 }, { candidates: 100, retained: 50 });
    const verdict = verdictFor([
      compareWindow("observation", bars, baseline, filtered),
      compareWindow("holdout", bars, baseline, worse),
    ]);
    expect(verdict).toMatch(/education only/);
  });

  it("only endorses a forward trial when both windows improve", () => {
    const verdict = verdictFor([
      compareWindow("observation", bars, baseline, filtered),
      compareWindow("holdout", bars, baseline, filtered),
    ]);
    expect(verdict).toMatch(/forward shadow trial/);
  });
});

describe("filters", () => {
  const signal = { side: "Long" as const, grade: "B" as const, score: 4, reasons: [], withTrend: true, htfAligned: true, extensionAtr: 0 };

  it("session bias rejects instruments outside the approved set", () => {
    const filter = buildResearchFilter("session-bias", "NAS100");
    expect(filter({ bars, signal }).accept).toBe(false);
  });

  it("poc continuation refuses to judge without enough bars", () => {
    const filter = buildResearchFilter("poc-continuation", "EUR/USD");
    expect(filter({ bars: bars.slice(0, 20), signal })).toEqual({ accept: false, tag: "insufficient-bars" });
  });

  it("breakaway gap filter rejects a series with no gaps", () => {
    const filter = buildResearchFilter("breakaway-fvg", "EUR/USD");
    expect(filter({ bars, signal })).toEqual({ accept: false, tag: "none" });
  });
});
