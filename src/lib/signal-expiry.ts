// How long a filed signal is given to work before it is called expired.
//
// The clock used to be one number per timeframe: 72 hours on the 1H for every
// market. Measured time-to-resolution says that is wrong in both directions.
// Covering 90% of resolutions needs 83 bars on NAS100 and 85 on WTI, but only 28
// on US30 and 39 on SPX500 — so the same 72-hour clock was cutting some trades off
// while still alive and keeping others open long after they were dead.
//
// The figures below are the measured 90th percentile of bars-to-resolution on the
// 1H, from markets with at least 20 resolved signals, plus 25% headroom so a live
// trade is not closed at the exact edge of the distribution. Markets with a thin
// sample are NOT given a number the data cannot support: they keep the
// conservative per-timeframe default.

/** Measured 90th-percentile bars to resolution on the 1H, sample >= 20. */
const MEASURED_P90_BARS_1H: Record<string, number> = {
  NAS100: 83,
  "WTI Oil": 85,
  "XAG/USD": 70,
  "USD/JPY": 53,
  "XAU/USD": 43,
  SPX500: 39,
  "GBP/USD": 39,
  US30: 28,
};

/** Headroom past the 90th percentile, so the clock is not set at the edge. */
const HEADROOM = 1.25;

/** Fallback clock per history timeframe, used where measurement is too thin. */
const DEFAULT_EXPIRY_HOURS: Record<string, number> = {
  "15": 24,
  "60": 72,
  "240": 240,
  D: 720,
};

/** Hours one bar of a history timeframe covers. */
const BAR_HOURS: Record<string, number> = { "15": 0.25, "60": 1, "240": 4, D: 24 };

export type ExpiryPolicy = {
  hours: number;
  /** "measured" when this market's own resolved signals set the clock. */
  basis: "measured" | "default";
};

/**
 * The clock for one market and history timeframe.
 *
 * Only the 1H is measured, because that is where the sample lives. Other
 * timeframes keep the conservative default rather than inheriting a converted
 * number, which would be a guess dressed up as a measurement.
 */
export function expiryPolicy(symbol: string, historyTimeframe: string): ExpiryPolicy {
  const fallback = DEFAULT_EXPIRY_HOURS[historyTimeframe] ?? 72;
  if (historyTimeframe !== "60") return { hours: fallback, basis: "default" };
  const bars = MEASURED_P90_BARS_1H[symbol];
  if (!bars) return { hours: fallback, basis: "default" };
  const barHours = BAR_HOURS[historyTimeframe] ?? 1;
  return { hours: Math.round(bars * barHours * HEADROOM), basis: "measured" };
}

/** Just the hours, for callers that do not care where the number came from. */
export function expiryHoursFor(symbol: string, historyTimeframe: string): number {
  return expiryPolicy(symbol, historyTimeframe).hours;
}
