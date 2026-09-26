// Per-instrument stop distance.
//
// The planner used to size the stop off the grade alone: A 1.1x ATR, B 1.25x,
// C 1.5x. That was the single biggest leak. It gave the setups we call best the
// least room, and it assumed every market breathes at the same multiple of its
// own ATR, which the sweep in `stop-width-per-instrument.server.ts` shows is not
// true - on 823 resolved 1H signals, every market with a usable sample paid
// better with a wider stop, and the best width differed by market.
//
// Measured net expectancy after costs, TP1 scaled so planned R:R stayed constant:
//
//   market    filed   1.0    1.25   1.5    1.75   2.0    2.5   chosen
//   XAU/USD   -0.35  -0.29  -0.22  -0.21  -0.26  -0.25  -0.19   1.5
//   NAS100    +0.06  -0.27  -0.14  +0.13  +0.23  +0.19  +0.24   1.75
//   USD/JPY   -0.31  -0.33  -0.24  -0.27  -0.14  -0.15  +0.03   2.5
//   SPX500    -0.11  -0.36  -0.02  +0.04  -0.06  -0.06  +0.07   2.5
//   WTI       +0.03  -0.20  +0.03  +0.19  +0.17  +0.19  +0.31   2.5
//   US30      +0.31  +0.23  +0.45  +0.49  +0.68  +0.64  +0.55   1.75
//   GBP/USD   -0.13  -0.29  -0.20  -0.30  -0.28  -0.17  -0.33   2.0
//   XAG/USD   -0.54  -0.54  -0.55  -0.45  -0.40  -0.32  -0.02   2.5
//   EUR/USD   -0.40  -0.44  -0.33  -0.18  -0.26  -0.19  -0.09   2.5
//
// Where two widths were within 0.02R of each other the tighter one is chosen, so
// less capital is risked for the same measured result. Markets under the 30-trade
// floor (XRP) get no constant and keep the shared default.
//
// BTC and ETH were measured separately on two years of hourly bars through the
// backtest engine (costs included, 70/30 observation/held-out split):
//
//   market   grade  1.25   1.5    1.75   2.0    2.5    3.0   (held-out net R)
//   BTC/USD  B+     -0.06  -0.01  -0.02  +0.01  +0.06  +0.00
//   BTC/USD  A+     -0.00  +0.05  +0.05  +0.06  +0.06  +0.05
//   ETH/USD  B+     -0.13  -0.13  -0.06  -0.11  -0.20  -0.19
//   ETH/USD  A+     -0.10  -0.12  -0.02  -0.02  -0.17  -0.17
//
// BTC: 2.0x was best in the observation window and positive held-out for both
// grade sets. ETH: only ~8 months of hourly history was available and no width
// was positive held-out; 1.75x lost least, so it is pinned there explicitly.
//
// This is in-sample on the signals filed so far, so it is a correction of a known
// mechanical bias, not a claim of edge. Grades are deliberately left alone: stop
// room is measured, grade ordering is not, and only one of them should move at a
// time.

/** Applied when a market has no measured constant yet. */
export const DEFAULT_STOP_MULT = 1.75;

/** Never tighter or wider than this, whatever a future measurement says. */
export const MIN_STOP_MULT = 1.25;
export const MAX_STOP_MULT = 3;

/** Measured best stop width in ATR(14), keyed by normalised market name. */
export const MEASURED_STOP_MULT: Record<string, number> = {
  XAUUSD: 1.5,
  NAS100: 1.75,
  USDJPY: 2.5,
  SPX500: 2.5,
  WTICOUSD: 2.5,
  US30: 1.75,
  GBPUSD: 2,
  XAGUSD: 2.5,
  EURUSD: 2.5,
  BTCUSD: 2,
  ETHUSD: 1.75,
};

/** "XAU/USD", "XAU_USD" and "xauusd" are the same market. */
export function normalizeStopSymbol(symbol: string): string {
  return symbol.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

const ALIASES: Record<string, string> = {
  WTIUSD: "WTICOUSD",
  WTIOIL: "WTICOUSD",
  USOIL: "WTICOUSD",
  GOLD: "XAUUSD",
  SILVER: "XAGUSD",
  NASDAQ100: "NAS100",
  DOW: "US30",
  BTCUSDT: "BTCUSD",
  ETHUSDT: "ETHUSD",
  BITCOIN: "BTCUSD",
  ETHEREUM: "ETHUSD",
};

/**
 * Stop distance in ATR(14) for this market. Grade is accepted so callers read
 * naturally, but it no longer changes the answer: giving the best-graded setups
 * the tightest stop is the behaviour this replaces.
 */
export function stopMultipleFor(symbol: string, _grade?: string): number {
  const key = normalizeStopSymbol(symbol);
  const resolved = ALIASES[key] ?? key;
  const measured = MEASURED_STOP_MULT[resolved];
  const mult = measured ?? DEFAULT_STOP_MULT;
  return Math.min(MAX_STOP_MULT, Math.max(MIN_STOP_MULT, mult));
}

/** True when the width came from this market's own resolved trades. */
export function hasMeasuredStop(symbol: string): boolean {
  const key = normalizeStopSymbol(symbol);
  return (ALIASES[key] ?? key) in MEASURED_STOP_MULT;
}
