// Loads real history and runs the read-only research comparisons.
import { DEFAULT_PARAMS, runBacktest, type BtBar, type BtParams, type BtRunOptions } from "@/lib/backtest/engine";
import { getHistory } from "@/lib/backtest/history.server";
import type { BacktestTimeframe } from "@/lib/backtest/catalog";
import {
  runComparison,
  type ResearchFilterId,
  type SymbolComparison,
} from "@/lib/classic-research-backtest";

export const SESSION_BIAS_SYMBOLS = ["XAU/USD", "XAG/USD", "EUR/USD", "GBP/USD", "USD/JPY"] as const;

export type ResearchBacktestReport = {
  timeframe: BacktestTimeframe;
  lookback: string;
  filters: ResearchFilterId[];
  comparisons: SymbolComparison[];
  failures: Array<{ symbol: string; error: string }>;
  notes: string[];
};

export async function runClassicResearchBacktest(input: {
  symbols: string[];
  filters: ResearchFilterId[];
  timeframe?: BacktestTimeframe;
  lookback?: string;
  params?: Partial<BtParams>;
}): Promise<ResearchBacktestReport> {
  const timeframe = input.timeframe ?? "60";
  const lookback = input.lookback ?? "2y";
  const params: BtParams = { ...DEFAULT_PARAMS, ...input.params };
  const comparisons: SymbolComparison[] = [];
  const failures: Array<{ symbol: string; error: string }> = [];

  for (const symbol of input.symbols) {
    let bars: BtBar[] = [];
    let source = "";
    try {
      const history = await getHistory(symbol, timeframe, lookback);
      bars = history.bars;
      source = history.source;
    } catch (e) {
      failures.push({ symbol, error: (e as Error).message });
      continue;
    }
    for (const filter of input.filters) {
      comparisons.push(
        runComparison({
          symbol,
          timeframe,
          filter,
          source,
          params,
          bars,
          run: (slice: BtBar[], options?: BtRunOptions) =>
            runBacktest(slice, params, { symbol, timeframe, source }, options),
        }),
      );
    }
  }

  return {
    timeframe,
    lookback,
    filters: input.filters,
    comparisons,
    failures,
    notes: [
      "Baseline and filtered runs share the same bars, entries, stops, targets, costs and exit rules; only the research filter differs.",
      "The final 30% of bars is held out. Read the held-out window, not the observation window.",
      "Nothing here changes live scans, grades or stop placement.",
    ],
  };
}
