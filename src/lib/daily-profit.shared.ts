// Pure rules for the daily profit email: which day a close belongs to, the
// day's realized P&L, and when the end-of-day send window is open.

export const PROFIT_EMAIL_TZ = "America/New_York";
/** Local hour (in PROFIT_EMAIL_TZ) when the day's recap goes out: 5 PM New York close. */
export const PROFIT_EMAIL_HOUR = 17;

/** YYYY-MM-DD for the instant in the given timezone. */
export function tradingDay(at: Date, tz = PROFIT_EMAIL_TZ): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

export function localHour(at: Date, tz = PROFIT_EMAIL_TZ): number {
  const h = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hourCycle: "h23" }).format(at);
  return Number(h) % 24;
}

export function isSendWindow(at: Date): boolean {
  return localHour(at) === PROFIT_EMAIL_HOUR;
}

export type CloseLike = { symbol: string; realizedPL: number; closedAt: string | null };

export type DaySummary = {
  pnl: number;
  trades: number;
  wins: number;
  best: { symbol: string; pnl: number } | null;
};

/** Sum the closes that landed on `day` (New York date). */
export function summarizeDay(closes: CloseLike[], day: string): DaySummary {
  const today = closes.filter((c) => c.closedAt && tradingDay(new Date(c.closedAt)) === day);
  let best: DaySummary["best"] = null;
  for (const c of today) if (!best || c.realizedPL > best.pnl) best = { symbol: c.symbol, pnl: c.realizedPL };
  const pnl = Math.round(today.reduce((s, c) => s + c.realizedPL, 0) * 100) / 100;
  return { pnl, trades: today.length, wins: today.filter((c) => c.realizedPL > 0).length, best };
}

/** Only a net-positive day earns an email. */
export function shouldSendProfitEmail(summary: DaySummary): boolean {
  return summary.trades > 0 && summary.pnl > 0;
}
