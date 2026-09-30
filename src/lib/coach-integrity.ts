// Coach data integrity: every number the coach cites is computed here, in code,
// and handed to the model as fact. The model does no arithmetic of its own.

/** Decimal places for an instrument's quote. EUR/USD shows 5, never 3. */
export function priceDecimals(symbol: string, sample?: number): number {
  const s = symbol.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (/JPY/.test(s)) return 3;
  if (/^(EUR|GBP|AUD|NZD|USD|CAD|CHF)(USD|CAD|CHF|EUR|GBP|AUD|NZD)$/.test(s)) return 5;
  if (/XAU|GOLD/.test(s)) return 2;
  if (/XAG|SILVER/.test(s)) return 3;
  if (/BTC|ETH|NAS|SPX|US30|DE30|WTI|OIL/.test(s)) return 2;
  if (sample != null && isFinite(sample)) return sample >= 100 ? 2 : sample >= 10 ? 3 : 5;
  return 5;
}

export function formatPrice(symbol: string, n: number | null | undefined): string {
  if (typeof n !== "number" || !isFinite(n)) return "-";
  return n.toFixed(priceDecimals(symbol, n));
}

export type RMath = {
  riskPerUnit: number;
  plannedR: number | null;
  slippageR: number;
  realizedR: number | null;
};

/**
 * Planned entry, actual fill, stop, optional exit and target.
 * Slippage is how much worse the fill was than the plan, in planned R.
 * Realized R is measured from the ACTUAL fill against the planned risk.
 * 9/29 check: short plan 1.1324 / stop 1.1342, fill 1.1315, exit 1.1342
 *   -> slippage 0.5R, realized -1.5R.
 */
export function computeRMath(input: {
  side: "long" | "short";
  plannedEntry: number;
  fill?: number | null;
  stop: number;
  exit?: number | null;
  target?: number | null;
}): RMath | null {
  const risk = Math.abs(input.plannedEntry - input.stop);
  if (!isFinite(risk) || risk <= 0) return null;
  const dir = input.side === "long" ? 1 : -1;
  const fill = input.fill ?? input.plannedEntry;
  const round = (x: number) => Math.round(x * 100) / 100;
  const slippageR = round(Math.max(0, dir * (fill - input.plannedEntry)) / risk);
  const realizedR = input.exit != null ? round((dir * (input.exit - fill)) / risk) : null;
  const plannedR = input.target != null ? round((dir * (input.target - input.plannedEntry)) / risk) : null;
  return { riskPerUnit: risk, plannedR, slippageR, realizedR };
}

/** True when the stop sits inside the stated thesis invalidation (stop hit before the idea is wrong). */
export function stopInsideInvalidation(side: "long" | "short", stop: number, invalidation: number | null | undefined): boolean {
  if (invalidation == null || !isFinite(invalidation)) return false;
  return side === "short" ? stop < invalidation : stop > invalidation;
}

export type StopEvent = { tradeId: string | null; at: string };

/**
 * One loss per trade. Repeated "sl hit" messages against the same trade, or with
 * no trade attached, never add a new loss; unbound ones need a clarifying question.
 */
export function dedupStopEvents(events: StopEvent[]): { losses: string[]; needsClarification: number } {
  const seen = new Set<string>();
  let needsClarification = 0;
  for (const e of events) {
    if (!e.tradeId) { needsClarification += 1; continue; }
    seen.add(e.tradeId);
  }
  return { losses: [...seen], needsClarification };
}

/** Consecutive verified losing fills, newest first. Tilt coaching needs >= 3. */
export function verifiedLossStreak(fills: Array<{ realizedR: number | null; closedAt: string | null }>): number {
  let n = 0;
  for (const f of [...fills].filter((f) => f.closedAt).sort((a, b) => (b.closedAt! > a.closedAt! ? 1 : -1))) {
    if (f.realizedR != null && f.realizedR < 0) n += 1;
    else break;
  }
  return n;
}

export type StatLabel = { grade: string; timeframe: string; from: string; to: string; n: number };

export function labelStat(label: StatLabel, text: string): string {
  const small = label.n < 20 ? ", small sample" : "";
  return `${text} [${label.grade}, ${label.timeframe}, ${label.from} to ${label.to}, n=${label.n}${small}]`;
}

export const COACH_INTEGRITY_RULES = `DATA INTEGRITY (non-negotiable):
- Do no arithmetic on prices or R. Only cite R, slippage, P&L and win rates that appear in the data you were given. If a number you need is missing, say it is missing.
- Keep three sources separate and name which one you mean: the trader's executed trades (journal), the trader's scans, and platform-wide signal stats. A scan is never a trade.
- Every stat you cite must carry grade, timeframe, date range and n. If n is under 20, say it is a small sample. Only cite stats for the same grade as the trade being discussed.
- A repeated "sl hit" / "stopped out" with no new fill is not a new loss. Ask which trade they mean before counting anything.
- Only raise loss-streak, revenge-trading or "stop for the day" coaching when the journal shows verified consecutive losing fills. Never escalate from chat messages alone.
- Quote prices at the instrument's full precision (EUR/USD 1.13660, not 1.137).
- Never say "I'll remember this", "I'll carry this forward" or "added to the rulebook". You have no rule store unless one is shown in your context.
- When asked why the system behaved a certain way, answer only from diagnostics you received. Label anything about code structure as a hypothesis for engineering.
- Wyckoff terms: the bearish mirror of a spring is an upthrust / UTAD (Phase C), not "a spring in reverse".
- Wyckoff phase letters are stages inside ONE trading range: A stopping action, B building cause, C the test (spring/UTAD), D the move to the range boundary, E leaving the range. Never map accumulation, markup, distribution and markdown onto letters A-D; those are market-cycle stages, a different thing.
- OANDA volume is tick count (price updates), not traded volume. Say "tick volume" whenever you cite it.
- If a setup's stop sits inside its own stated invalidation, say so plainly.`;
