// Pure rules for the two retention emails: the 8 AM New York morning picks and
// the 6 PM New York "scanner wins" recap.
import { localHour, tradingDay } from "@/lib/daily-profit.shared";

export const MORNING_BRIEF_HOUR = 8;
export const SCANNER_WINS_HOUR = 18;
/** Grades good enough to put in the morning email. */
export const MORNING_GRADES = ["A+", "A", "B"] as const;
export const MORNING_MAX_PICKS = 3;
/** How far back the morning email looks for fresh setups. */
export const MORNING_LOOKBACK_HOURS = 12;

export type RetentionKind = "morning_brief" | "scanner_wins";

export function retentionKindAt(at: Date): RetentionKind | null {
  const h = localHour(at);
  if (h === MORNING_BRIEF_HOUR) return "morning_brief";
  if (h === SCANNER_WINS_HOUR) return "scanner_wins";
  return null;
}

/** Saturday is closed for every market we scan; skip it. */
export function isQuietDay(at: Date): boolean {
  const wd = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short" }).format(at);
  return wd === "Sat";
}

export type SetupRow = {
  symbol: string;
  grade: string;
  bias: string;
  entry: number | null;
  stop: number | null;
  tp1: number | null;
  confidence: number | null;
  created_at: string;
};

/** Best A+/A/B setups from the last 12 hours, one per instrument, highest grade then conviction. */
export function pickMorningSetups(rows: SetupRow[], now: Date): SetupRow[] {
  const cutoff = now.getTime() - MORNING_LOOKBACK_HOURS * 3600_000;
  const rank = (g: string) => (MORNING_GRADES as readonly string[]).indexOf(g);
  const ok = rows.filter(
    (r) => rank(r.grade) >= 0 && r.entry != null && r.stop != null && r.tp1 != null && new Date(r.created_at).getTime() >= cutoff,
  );
  ok.sort((a, b) => rank(a.grade) - rank(b.grade) || (b.confidence ?? 0) - (a.confidence ?? 0));
  const seen = new Set<string>();
  const out: SetupRow[] = [];
  for (const r of ok) {
    if (seen.has(r.symbol)) continue;
    seen.add(r.symbol);
    out.push(r);
    if (out.length >= MORNING_MAX_PICKS) break;
  }
  return out;
}

export type ResolvedRow = {
  symbol: string;
  bias: string;
  grade: string | null;
  status: string;
  realized_r: number | null;
  resolved_at: string | null;
};

export type Win = { symbol: string; bias: string; grade: string | null; r: number };

/** Setups that hit target on `day` (New York date), one per instrument and direction. */
export function scannerWinsForDay(rows: ResolvedRow[], day: string): Win[] {
  const best = new Map<string, Win>();
  for (const r of rows) {
    if (r.status !== "target" || !r.resolved_at) continue;
    if (tradingDay(new Date(r.resolved_at)) !== day) continue;
    const key = `${r.symbol}|${r.bias}`;
    const rv = Math.round((r.realized_r ?? 0) * 10) / 10;
    const prev = best.get(key);
    if (!prev || rv > prev.r) best.set(key, { symbol: r.symbol, bias: r.bias, grade: r.grade, r: rv });
  }
  return [...best.values()].sort((a, b) => b.r - a.r);
}

/** No wins, no email. */
export function shouldSendWins(wins: Win[]): boolean {
  return wins.length > 0;
}
