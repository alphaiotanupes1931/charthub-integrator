import { readClassicSessionBias, type SessionBiasPattern } from "@/lib/classic-session-bias";
import { DEFAULT_PARAMS, runBacktest, type BtBar, type BtResult } from "./engine";

export const SESSION_BIAS_SYMBOLS = ["XAU/USD", "XAG/USD", "EUR/USD", "GBP/USD", "USD/JPY"] as const;

export type SessionBiasComparison = {
  symbol: string;
  splitTime: number;
  baseline: BtResult;
  filtered: BtResult;
  observation: { baseline: BtResult; filtered: BtResult };
  heldOut: { baseline: BtResult; filtered: BtResult };
  candidates: number;
  retained: number;
  filteredPct: number;
  byPattern: Array<{ pattern: SessionBiasPattern; trades: number; winRate: number; expectancyR: number; netR: number }>;
};

function run(symbol: string, bars: BtBar[], filtered: boolean): BtResult {
  return runBacktest(
    bars,
    DEFAULT_PARAMS,
    { symbol, timeframe: "60", source: "shadow-session-bias" },
    filtered
      ? {
          signalFilter: ({ bars: visible, signal }) => {
            const read = readClassicSessionBias(symbol, visible, (visible[visible.length - 1].time + 3600) * 1000);
            const agrees = (signal.side === "Long" && read.direction === "bullish")
              || (signal.side === "Short" && read.direction === "bearish");
            return { accept: agrees, tag: agrees ? read.pattern : undefined };
          },
        }
      : undefined,
  );
}

function patternRows(result: BtResult) {
  const patterns: SessionBiasPattern[] = ["london-reversal", "london-continuation", "new-york-reversal"];
  return patterns.map((pattern) => {
    const trades = result.trades.filter((trade) => trade.filterTag === pattern);
    const wins = trades.filter((trade) => trade.r > 0).length;
    const netR = trades.reduce((sum, trade) => sum + trade.r, 0);
    return {
      pattern,
      trades: trades.length,
      winRate: trades.length ? Math.round((wins / trades.length) * 1000) / 10 : 0,
      expectancyR: trades.length ? Math.round((netR / trades.length) * 100) / 100 : 0,
      netR: Math.round(netR * 100) / 100,
    };
  });
}

export function compareClassicSessionBias(symbol: string, bars: BtBar[]): SessionBiasComparison {
  const splitIndex = Math.max(210, Math.floor(bars.length * 0.7));
  const splitTime = bars[splitIndex]?.time ?? 0;
  const observationBars = bars.slice(0, splitIndex);
  const heldOutBars = bars.slice(Math.max(0, splitIndex - 210));
  const baseline = run(symbol, bars, false);
  const filtered = run(symbol, bars, true);
  const candidates = filtered.filterStats?.candidates ?? 0;
  const retained = filtered.filterStats?.retained ?? filtered.stats.trades;
  return {
    symbol,
    splitTime,
    baseline,
    filtered,
    observation: { baseline: run(symbol, observationBars, false), filtered: run(symbol, observationBars, true) },
    heldOut: { baseline: run(symbol, heldOutBars, false), filtered: run(symbol, heldOutBars, true) },
    candidates,
    retained,
    filteredPct: candidates ? Math.round((1 - retained / candidates) * 1000) / 10 : 0,
    byPattern: patternRows(filtered),
  };
}