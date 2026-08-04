// Client-safe catalog for the backtester UI and validators.

export const BACKTEST_SYMBOLS = [
  "XAU/USD",
  "XAG/USD",
  "NAS100",
  "SPX500",
  "US30",
  "WTI Oil",
  "EUR/USD",
  "GBP/USD",
  "USD/JPY",
  "BTC/USD",
  "ETH/USD",
  "XRP/USD",
] as const;

export const BACKTEST_TIMEFRAMES = ["15", "60", "240", "D"] as const;
export type BacktestTimeframe = (typeof BACKTEST_TIMEFRAMES)[number];

export const TIMEFRAME_LABEL: Record<BacktestTimeframe, string> = {
  "15": "15 minute",
  "60": "1 hour",
  "240": "4 hour",
  D: "Daily",
};
