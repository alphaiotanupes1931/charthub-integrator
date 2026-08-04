// Client-safe helpers for the strategy performance loop.
export type StrategyPerfSummary = {
  strategyId: string;
  symbol: string;
  timeframe: string;
  trades: number;
  winRate: number;
  expectancyR: number;
  netR: number;
  maxDrawdownPct: number;
};

export function formatPerfForPrompt(rows: StrategyPerfSummary[]): string {
  if (rows.length === 0) return "";
  return rows
    .slice(0, 4)
    .map(
      (r) =>
        `${r.symbol} ${r.timeframe}: ${r.trades} trades, ${r.winRate}% win rate, ${r.expectancyR}R expectancy, ${r.netR}R net, ${r.maxDrawdownPct}% max drawdown`,
    )
    .join(" | ");
}

export function edgeVerdict(row: StrategyPerfSummary | null): "untested" | "thin" | "positive" | "negative" {
  if (!row || row.trades === 0) return "untested";
  if (row.trades < 15) return "thin";
  return row.expectancyR > 0 ? "positive" : "negative";
}
