// Weekly review automation. The same metrics the Analytics page computes, but
// run on a schedule for every trader with closed paper trades in the week, so a
// report is waiting on Monday without anyone pressing a button.
import { createNotification } from "@/lib/notifications.server";

export type WeeklyMetrics = {
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  netPnl: number;
  netR: number;
  maxDrawdownPct: number;
  bestSymbol: string | null;
  worstSymbol: string | null;
};

type TradeRow = { symbol: string; pnl: number; closed_at: string };

// Sunday-ending week that contains the given date, as YYYY-MM-DD.
export function weekEndingFor(d: Date): string {
  const day = d.getUTCDay();
  const end = new Date(d);
  end.setUTCDate(d.getUTCDate() + (day === 0 ? 0 : 7 - day));
  return end.toISOString().slice(0, 10);
}

// The week that just closed, relative to "now".
export function lastCompletedWeekEnding(now = new Date()): string {
  const d = new Date(now);
  d.setUTCDate(d.getUTCDate() - 7);
  return weekEndingFor(d);
}

export function computeMetrics(trades: TradeRow[]): WeeklyMetrics {
  const empty: WeeklyMetrics = {
    totalTrades: 0,
    wins: 0,
    losses: 0,
    winRate: 0,
    netPnl: 0,
    netR: 0,
    maxDrawdownPct: 0,
    bestSymbol: null,
    worstSymbol: null,
  };
  if (trades.length === 0) return empty;

  const sorted = [...trades].sort(
    (a, b) => new Date(a.closed_at).getTime() - new Date(b.closed_at).getTime(),
  );
  const wins = sorted.filter((t) => Number(t.pnl) > 0).length;
  const losses = sorted.filter((t) => Number(t.pnl) < 0).length;
  const netPnl = sorted.reduce((s, t) => s + Number(t.pnl), 0);

  let peak = 0;
  let running = 0;
  let maxDD = 0;
  for (const t of sorted) {
    running += Number(t.pnl);
    if (running > peak) peak = running;
    if (peak - running > maxDD) maxDD = peak - running;
  }

  const bySymbol = new Map<string, number>();
  for (const t of sorted) bySymbol.set(t.symbol, (bySymbol.get(t.symbol) ?? 0) + Number(t.pnl));
  const ranked = Array.from(bySymbol.entries()).sort((a, b) => b[1] - a[1]);

  return {
    totalTrades: sorted.length,
    wins,
    losses,
    winRate: (wins / sorted.length) * 100,
    netPnl,
    netR: 0,
    maxDrawdownPct: peak > 0 ? (maxDD / peak) * 100 : 0,
    bestSymbol: ranked[0]?.[0] ?? null,
    worstSymbol: ranked.length > 1 ? ranked[ranked.length - 1]![0] : null,
  };
}

export function lessonFor(m: WeeklyMetrics): string {
  if (m.totalTrades === 0) return "No trades closed this week.";
  const parts: string[] = [];
  if (m.winRate >= 60 && m.netPnl > 0) {
    parts.push(`Strong week: ${m.winRate.toFixed(0)}% win rate on ${m.totalTrades} trades, net ${m.netPnl.toFixed(2)}.`);
  } else if (m.netPnl < 0) {
    parts.push(`Down week: net ${m.netPnl.toFixed(2)} across ${m.totalTrades} trades. Size down and raise your setup bar.`);
  } else {
    parts.push(`Flat week: net ${m.netPnl.toFixed(2)} across ${m.totalTrades} trades.`);
  }
  if (m.maxDrawdownPct > 25) {
    parts.push(`Peak-to-trough drawdown hit ${m.maxDrawdownPct.toFixed(0)}%, which points at position size rather than setup choice.`);
  }
  if (m.bestSymbol) parts.push(`Best instrument: ${m.bestSymbol}.`);
  if (m.worstSymbol && m.worstSymbol !== m.bestSymbol) parts.push(`Worst: ${m.worstSymbol}.`);
  return parts.join(" ");
}

export type WeeklyRunSummary = { weekEnding: string; traders: number; reports: number };

// Generates (or refreshes) the report for every trader who closed a trade in the
// week. Idempotent: reruns overwrite the same week row.
export async function runWeeklyReviewForAll(weekEnding: string): Promise<WeeklyRunSummary> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const start = new Date(`${weekEnding}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() - 6);
  const startIso = `${start.toISOString().slice(0, 10)}T00:00:00Z`;
  const endIso = `${weekEnding}T23:59:59Z`;

  const { data: trades, error } = await supabaseAdmin
    .from("paper_trades")
    .select("user_id, symbol, pnl, closed_at")
    .gte("closed_at", startIso)
    .lte("closed_at", endIso)
    .limit(20_000);
  if (error) throw new Error(error.message);

  const byUser = new Map<string, TradeRow[]>();
  for (const row of trades ?? []) {
    const uid = row.user_id as string;
    const list = byUser.get(uid) ?? [];
    list.push({ symbol: row.symbol as string, pnl: Number(row.pnl), closed_at: row.closed_at as string });
    byUser.set(uid, list);
  }

  let reports = 0;
  for (const [userId, rows] of byUser) {
    const metrics = computeMetrics(rows);
    const lesson = lessonFor(metrics);
    const { error: upsertError } = await supabaseAdmin.from("weekly_reports").upsert(
      {
        user_id: userId,
        week_ending: weekEnding,
        metrics_json: metrics as never,
        lesson,
      } as never,
      { onConflict: "user_id,week_ending" },
    );
    if (upsertError) continue;
    reports += 1;
    try {
      await createNotification({
        userId,
        kind: "info",
        title: `Weekly review ready, week ending ${weekEnding}`,
        body: lesson,
        url: "/analytics",
      });
    } catch {
      // a failed notification should not lose the report
    }
  }

  return { weekEnding, traders: byUser.size, reports };
}
