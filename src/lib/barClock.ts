// Bar completion clock.
//
// Every price feed the scanner reads (OANDA, Binance, TwelveData, Yahoo) returns
// the bar that is still forming as its last row. Grading structure off that bar
// is what makes a signal fire one to two bars before a human following the same
// rules would enter: the "close beyond the level" it reads has not happened yet
// and can vanish before the candle prints.
//
// This module decides, from the data alone, whether the last row is closed. The
// bar length is measured from the series itself (median spacing of recent bars)
// rather than the requested interval string, so it works for every provider and
// for monthly/weekly bars where the length is not a fixed number of seconds.

export type BarCandle = { time: number; open: number; high: number; low: number; close: number; volume?: number };

/** Median spacing between recent bars, in seconds. 0 when it cannot be measured. */
export function barSeconds(candles: Pick<BarCandle, "time">[]): number {
  if (candles.length < 3) return 0;
  const diffs: number[] = [];
  for (let i = candles.length - 1; i > 0 && diffs.length < 30; i--) {
    const d = candles[i].time - candles[i - 1].time;
    if (d > 0) diffs.push(d);
  }
  if (!diffs.length) return 0;
  diffs.sort((a, b) => a - b);
  return diffs[Math.floor(diffs.length / 2)];
}

/**
 * Split a series into the bars that have closed and the bar still forming.
 *
 * A bar is treated as forming while its own window still contains "now". A small
 * tolerance covers feed clock skew, so a bar that closed a second ago is not
 * held back for a whole extra interval.
 */
export function splitForming<T extends Pick<BarCandle, "time">>(
  candles: T[],
  nowMs: number = Date.now(),
): { closed: T[]; forming: T | null } {
  if (candles.length < 4) return { closed: candles, forming: null };
  const step = barSeconds(candles);
  if (!step) return { closed: candles, forming: null };
  const last = candles[candles.length - 1];
  const skew = Math.min(Math.max(step * 0.02, 2), 60);
  const closesAt = (last.time + step) * 1000;
  if (closesAt - skew * 1000 > nowMs) {
    return { closed: candles.slice(0, -1), forming: last };
  }
  return { closed: candles, forming: null };
}

/** Closed bars only. Used everywhere structure and grading are decided. */
export function closedBars<T extends Pick<BarCandle, "time">>(candles: T[], nowMs?: number): T[] {
  return splitForming(candles, nowMs).closed;
}

/** Seconds until the current bar closes; 0 when the last bar is already closed. */
export function secondsToBarClose(candles: Pick<BarCandle, "time">[], nowMs: number = Date.now()): number {
  const { forming } = splitForming(candles, nowMs);
  const step = barSeconds(candles);
  if (!forming || !step) return 0;
  return Math.max(0, Math.round(((forming.time + step) * 1000 - nowMs) / 1000));
}
