// Read-only comparison harness for the queued Classic research rules.
//
// Each rule is expressed as a signal filter over the existing deterministic
// backtest engine, so the baseline and the filtered run share identical bars,
// entries, stops, targets, costs and exit rules. Only the filter differs.
//
// Nothing here changes live scanning, grades or stops. It exists to decide
// whether a queued rule earns its place, measured on a held-out window.

import type { BtBar, BtParams, BtResult, BtRunOptions } from "@/lib/backtest/engine";
import type { BarCandle } from "@/lib/barClock";
import { readClassicSessionBias } from "@/lib/classic-session-bias";
import { classifyFairValueGaps, readPocContinuation } from "@/lib/classic-pattern-research";

export const RESEARCH_FILTERS = ["session-bias", "poc-continuation", "breakaway-fvg"] as const;
export type ResearchFilterId = (typeof RESEARCH_FILTERS)[number];

/** Minimum retained trades in a window before a comparison is worth reading. */
export const COMPARISON_SAMPLE_FLOOR = 30;

export type WindowSummary = {
  window: "observation" | "holdout";
  bars: number;
  from: number;
  to: number;
  baseline: RunSummary;
  filtered: RunSummary;
  candidates: number;
  retained: number;
  filteredOutPct: number;
  /** Retained-trade net expectancy minus baseline, in R. */
  deltaExpectancyR: number;
  enoughData: boolean;
  byTag: Array<{ tag: string; trades: number; winRate: number; expectancyR: number }>;
};

export type RunSummary = {
  trades: number;
  wins: number;
  losses: number;
  timeouts: number;
  winRate: number;
  grossExpectancyR: number;
  expectancyR: number;
  avgCostR: number;
  netR: number;
  maxDrawdownPct: number;
  aGradeTrades: number;
  aGradeExpectancyR: number;
};

export type SymbolComparison = {
  symbol: string;
  timeframe: string;
  filter: ResearchFilterId;
  source: string;
  windows: WindowSummary[];
  verdict: string;
};

const hasAll = <T,>(v: T | undefined): v is T => v !== undefined;

export function summarize(result: BtResult): RunSummary {
  const s = result.stats;
  const aGrade = result.trades.filter((t) => t.grade === "A" || t.grade === "A+");
  const aNet = aGrade.reduce((sum, t) => sum + t.r, 0);
  return {
    trades: s.trades,
    wins: s.wins,
    losses: s.losses,
    timeouts: s.timeouts,
    winRate: s.winRate,
    grossExpectancyR: s.grossExpectancyR,
    expectancyR: s.expectancyR,
    avgCostR: s.avgCostR,
    netR: s.netR,
    maxDrawdownPct: s.maxDrawdownPct,
    aGradeTrades: aGrade.length,
    aGradeExpectancyR: aGrade.length ? Math.round((aNet / aGrade.length) * 100) / 100 : 0,
  };
}

/** Chronological 70/30 split. The tail is never used to choose a threshold. */
export function splitChronologically(bars: BtBar[], observationShare = 0.7): { observation: BtBar[]; holdout: BtBar[] } {
  const cut = Math.floor(bars.length * observationShare);
  return { observation: bars.slice(0, cut), holdout: bars.slice(Math.max(0, cut - 260)) };
}

const asBarCandles = (bars: BtBar[]): BarCandle[] => bars as unknown as BarCandle[];

/** Treat every supplied bar as closed: the engine only ever passes history. */
const asOfFor = (bars: BtBar[]): number => ((bars[bars.length - 1]?.time ?? 0) + 86_400) * 1000;

export function buildResearchFilter(id: ResearchFilterId, symbol: string): NonNullable<BtRunOptions["signalFilter"]> {
  if (id === "session-bias") {
    return ({ bars, signal }) => {
      const read = readClassicSessionBias(symbol, asBarCandles(bars.slice(-400)), asOfFor(bars));
      const want = signal.side === "Long" ? "bullish" : "bearish";
      return { accept: read.direction === want, tag: read.pattern };
    };
  }
  if (id === "poc-continuation") {
    return ({ bars, signal }) => {
      const window = bars.slice(-60);
      if (window.length < 40) return { accept: false, tag: "insufficient-bars" };
      const read = readPocContinuation({
        accumulationBars: asBarCandles(window.slice(0, 30)),
        followingBars: asBarCandles(window.slice(30)),
        higherTimeframeBias: signal.side === "Long" ? "bullish" : "bearish",
        asOfMs: asOfFor(bars),
      });
      return { accept: read.status === "confirmed", tag: read.status };
    };
  }
  return ({ bars, signal }) => {
    const window = bars.slice(-40);
    const want = signal.side === "Long" ? "bullish" : "bearish";
    const gaps = classifyFairValueGaps(asBarCandles(window), asOfFor(bars))
      .filter((gap) => gap.direction === want && gap.classification === "breakaway");
    return { accept: gaps.length > 0, tag: gaps.length ? "breakaway" : "none" };
  };
}

export function tagBreakdown(result: BtResult): WindowSummary["byTag"] {
  const map = new Map<string, { trades: number; wins: number; net: number }>();
  for (const trade of result.trades) {
    const tag = trade.filterTag ?? "untagged";
    const row = map.get(tag) ?? { trades: 0, wins: 0, net: 0 };
    row.trades += 1;
    if (trade.r > 0) row.wins += 1;
    row.net += trade.r;
    map.set(tag, row);
  }
  return [...map.entries()]
    .map(([tag, row]) => ({
      tag,
      trades: row.trades,
      winRate: Math.round((row.wins / row.trades) * 1000) / 10,
      expectancyR: Math.round((row.net / row.trades) * 100) / 100,
    }))
    .sort((a, b) => b.trades - a.trades);
}

export function compareWindow(
  window: WindowSummary["window"],
  bars: BtBar[],
  baseline: BtResult,
  filtered: BtResult,
): WindowSummary {
  const base = summarize(baseline);
  const withFilter = summarize(filtered);
  const candidates = filtered.filterStats?.candidates ?? 0;
  const retained = filtered.filterStats?.retained ?? 0;
  return {
    window,
    bars: bars.length,
    from: bars[0]?.time ?? 0,
    to: bars[bars.length - 1]?.time ?? 0,
    baseline: base,
    filtered: withFilter,
    candidates,
    retained,
    filteredOutPct: candidates ? Math.round(((candidates - retained) / candidates) * 1000) / 10 : 0,
    deltaExpectancyR: Math.round((withFilter.expectancyR - base.expectancyR) * 100) / 100,
    enoughData: withFilter.trades >= COMPARISON_SAMPLE_FLOOR,
    byTag: tagBreakdown(filtered),
  };
}

/**
 * Plain-language read of a comparison. Deliberately conservative: a rule only
 * "earns a forward trial" when the held-out window improves on the baseline with
 * a sample above the floor.
 */
export function verdictFor(windows: WindowSummary[]): string {
  const holdout = windows.find((w) => w.window === "holdout");
  const observation = windows.find((w) => w.window === "observation");
  if (!hasAll(holdout) || !hasAll(observation)) return "Incomplete run: both windows are required.";
  if (!holdout.enoughData) {
    return `Not enough held-out trades (${holdout.filtered.trades} of ${COMPARISON_SAMPLE_FLOOR}) to judge the rule.`;
  }
  if (holdout.deltaExpectancyR <= 0) {
    return `Held out, the filter made results worse (${holdout.deltaExpectancyR}R per trade). Keep it as education only.`;
  }
  if (observation.deltaExpectancyR <= 0) {
    return `Held-out improvement of ${holdout.deltaExpectancyR}R did not appear in the earlier window, so treat it as noise for now.`;
  }
  return `Improved by ${holdout.deltaExpectancyR}R per trade on held-out bars with ${holdout.filtered.trades} trades: earns a forward shadow trial.`;
}

export type ComparisonInput = {
  symbol: string;
  timeframe: string;
  filter: ResearchFilterId;
  source: string;
  params: BtParams;
  bars: BtBar[];
  run: (bars: BtBar[], options?: BtRunOptions) => BtResult;
};

export function runComparison(input: ComparisonInput): SymbolComparison {
  const { observation, holdout } = splitChronologically(input.bars);
  const signalFilter = buildResearchFilter(input.filter, input.symbol);
  const windows: WindowSummary[] = [
    compareWindow("observation", observation, input.run(observation), input.run(observation, { signalFilter })),
    compareWindow("holdout", holdout, input.run(holdout), input.run(holdout, { signalFilter })),
  ];
  return {
    symbol: input.symbol,
    timeframe: input.timeframe,
    filter: input.filter,
    source: input.source,
    windows,
    verdict: verdictFor(windows),
  };
}
