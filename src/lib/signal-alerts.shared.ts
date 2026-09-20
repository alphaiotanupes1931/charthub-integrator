// Pure rules for the hourly scan alert.
//
// Kept separate from the cron route and the UI so the decision "does this setup
// deserve to ping this trader" is testable without network, database or clock.

export const ALERT_GRADES = ["A+", "A", "B"] as const;
export type AlertMinGrade = (typeof ALERT_GRADES)[number];

const RANK: Record<string, number> = { "A+": 4, A: 3, B: 2, C: 1, "NO ENTRY": 0 };

export function normalizeMinGrade(raw: unknown): AlertMinGrade {
  const v = typeof raw === "string" ? raw.trim().toUpperCase() : "";
  return v === "A+" || v === "B" ? (v as AlertMinGrade) : "A";
}

/** True when a scan grade is good enough for the trader's minimum. */
export function gradeMeetsMin(grade: string, min: AlertMinGrade): boolean {
  const g = RANK[grade.trim().toUpperCase()] ?? 0;
  return g > 0 && g >= RANK[min]!;
}

/** True when a direction is tradeable (an actual side, not a wait). */
export function isTradeableBias(bias: string): boolean {
  const b = bias.trim().toLowerCase();
  return b === "long" || b === "short";
}

/**
 * The hour (0-23) in the trader's own timezone. Falls back to UTC when the
 * timezone string is not one the runtime knows.
 */
export function hourInZone(at: Date, timezone: string): number {
  try {
    const s = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "2-digit",
      hour12: false,
    }).format(at);
    const n = Number.parseInt(s, 10);
    return Number.isFinite(n) ? n % 24 : at.getUTCHours();
  } catch {
    return at.getUTCHours();
  }
}

/**
 * Quiet hours are a half-open window [from, to) in local time and may wrap
 * midnight. from === to means "never quiet".
 */
export function inQuietHours(at: Date, timezone: string, from: number, to: number): boolean {
  if (from === to) return false;
  const h = hourInZone(at, timezone);
  return from < to ? h >= from && h < to : h >= from || h < to;
}

/** One alert per model, symbol, direction and candle close. */
export function alertDedupeKey(input: {
  modelId: string;
  symbol: string;
  bias: string;
  barCloseIso: string;
}): string {
  return `signal:${input.modelId}:${input.symbol}:${input.bias.toLowerCase()}:${input.barCloseIso}`;
}

export type AlertPlanLike = {
  grade: string;
  bias: string;
  entry: number | null;
  stop: number | null;
  tp1: number | null;
  confidence: number;
};

export type AlertDecision =
  | { alert: true }
  | { alert: false; reason: string };

/**
 * The full gate: real direction, grade good enough, prices present, entry still
 * reachable (the caller supplies the staleness read), and not inside quiet hours.
 */
export function decideAlert(input: {
  plan: AlertPlanLike;
  minGrade: AlertMinGrade;
  stale: boolean;
  staleReason?: string | null;
  quiet: boolean;
  /**
   * Already alerting on a better-graded setup in the same direction on an
   * instrument that moves with this one. Three US index shorts in one hour is one
   * trade taken three times, so only the best of the family is sent.
   */
  correlated?: boolean;
}): AlertDecision {
  if (!isTradeableBias(input.plan.bias)) return { alert: false, reason: "no direction yet" };
  if (!gradeMeetsMin(input.plan.grade, input.minGrade)) {
    return { alert: false, reason: `grade ${input.plan.grade} below ${input.minGrade}` };
  }
  const { entry, stop, tp1 } = input.plan;
  if (entry == null || stop == null || tp1 == null) return { alert: false, reason: "incomplete levels" };
  if (input.stale) return { alert: false, reason: input.staleReason ?? "entry already gone" };
  if (input.correlated) return { alert: false, reason: "same bet as a better-graded correlated setup" };
  if (input.quiet) return { alert: false, reason: "quiet hours" };
  return { alert: true };
}

/** The notification a passing setup becomes. */
export function formatAlert(input: {
  modelName: string;
  symbol: string;
  plan: AlertPlanLike;
  decimals?: number;
}): { title: string; body: string } {
  const side = input.plan.bias.trim().toLowerCase() === "long" ? "BUY" : "SELL";
  const d = input.decimals ?? 5;
  const px = (n: number | null) => (n == null ? "—" : n.toFixed(d).replace(/0+$/, "").replace(/\.$/, ""));
  return {
    title: `${input.plan.grade} · ${side} ${input.symbol}`,
    body:
      `${input.modelName}: entry ${px(input.plan.entry)}, stop ${px(input.plan.stop)}, ` +
      `first target ${px(input.plan.tp1)} · confidence ${Math.round(input.plan.confidence)}%`,
  };
}
