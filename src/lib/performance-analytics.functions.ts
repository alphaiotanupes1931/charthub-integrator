// Performance analytics: aggregates paper trades, autopilot proposals, and
// stored weekly reports into a single trader-facing view. Journal trades from
// localStorage are merged on the client.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireCapability } from "@/lib/capability-middleware";

export type ServerTrade = {
  id: string;
  symbol: string;
  side: "long" | "short";
  entry: number;
  exit: number;
  stop: number;
  pnl: number;
  grade: string | null;
  reason: string;
  closedAt: string;
};

export type ServerProposal = {
  id: string;
  symbol: string;
  side: "long" | "short";
  entry: number;
  stopLoss: number | null;
  takeProfit: number | null;
  grade: string | null;
  status: string;
  realizedR: number | null;
  createdAt: string;
  decidedAt: string | null;
};

export type WeeklyReportRow = {
  id: string;
  weekEnding: string;
  metrics: WeeklyMetrics;
  lesson: string;
  createdAt: string;
};

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

export type PerformanceAnalytics = {
  paperTrades: ServerTrade[];
  proposals: ServerProposal[];
  weeklyReports: WeeklyReportRow[];
};

function serverTradeFromRow(row: Record<string, unknown>): ServerTrade {
  return {
    id: row.id as string,
    symbol: row.symbol as string,
    side: (row.side as string) === "short" ? "short" : "long",
    entry: Number(row.entry),
    exit: Number(row.exit),
    stop: Number(row.stop),
    pnl: Number(row.pnl),
    grade: (row.grade as string | null) ?? null,
    reason: (row.reason as string | null) ?? "manual",
    closedAt: row.closed_at as string,
  };
}

function serverProposalFromRow(row: Record<string, unknown>): ServerProposal {
  return {
    id: row.id as string,
    symbol: row.symbol as string,
    side: (row.side as string) === "short" ? "short" : "long",
    entry: Number(row.entry),
    stopLoss: row.stop_loss === null ? null : Number(row.stop_loss),
    takeProfit: row.take_profit === null ? null : Number(row.take_profit),
    grade: (row.grade as string | null) ?? null,
    status: (row.status as string) ?? "pending",
    realizedR: row.realized_r === null ? null : Number(row.realized_r),
    createdAt: row.created_at as string,
    decidedAt: (row.decided_at as string | null) ?? null,
  };
}

export const getPerformanceAnalytics = createServerFn({ method: "GET" })
  .middleware([requireCapability("analytics")])
  .handler(async ({ context }): Promise<PerformanceAnalytics> => {
    const [{ data: paperData }, { data: proposalData }, { data: reportData }] = await Promise.all([
      context.supabase
        .from("paper_trades")
        .select("id, symbol, side, entry, exit, stop, pnl, grade, reason, closed_at")
        .eq("user_id", context.userId)
        .order("closed_at", { ascending: false })
        .limit(500),
      context.supabase
        .from("autopilot_proposals")
        .select("id, symbol, side, entry, stop_loss, take_profit, grade, status, realized_r, created_at, decided_at")
        .eq("user_id", context.userId)
        .in("status", ["filled", "approved", "rejected"])
        .order("created_at", { ascending: false })
        .limit(500),
      context.supabase
        .from("weekly_reports")
        .select("id, week_ending, metrics_json, lesson, created_at")
        .eq("user_id", context.userId)
        .order("week_ending", { ascending: false })
        .limit(52),
    ]);

    return {
      paperTrades: (paperData ?? []).map((r) => serverTradeFromRow(r as Record<string, unknown>)),
      proposals: (proposalData ?? []).map((r) => serverProposalFromRow(r as Record<string, unknown>)),
      weeklyReports: (reportData ?? []).map((r) => ({
        id: r.id as string,
        weekEnding: r.week_ending as string,
        metrics: (r.metrics_json as WeeklyMetrics) ?? {
          totalTrades: 0,
          wins: 0,
          losses: 0,
          winRate: 0,
          netPnl: 0,
          netR: 0,
          maxDrawdownPct: 0,
          bestSymbol: null,
          worstSymbol: null,
        },
        lesson: (r.lesson as string) ?? "",
        createdAt: r.created_at as string,
      })),
    };
  });

function endOfWeek(d: Date): string {
  const day = d.getDay(); // 0 = Sunday
  const offset = day === 0 ? 0 : 7 - day;
  const end = new Date(d);
  end.setDate(d.getDate() + offset);
  return `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, "0")}-${String(end.getDate()).padStart(2, "0")}`;
}

function computeWeeklyMetrics(trades: ServerTrade[]): WeeklyMetrics {
  if (trades.length === 0) {
    return {
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
  }

  const sorted = [...trades].sort((a, b) => new Date(a.closedAt).getTime() - new Date(b.closedAt).getTime());
  const wins = sorted.filter((t) => t.pnl > 0);
  const losses = sorted.filter((t) => t.pnl < 0);
  const netPnl = sorted.reduce((s, t) => s + t.pnl, 0);

  let peak = 0;
  let maxDD = 0;
  let running = 0;
  for (const t of sorted) {
    running += t.pnl;
    if (running > peak) peak = running;
    const dd = peak - running;
    if (dd > maxDD) maxDD = dd;
  }

  const bySymbol = new Map<string, number>();
  for (const t of sorted) {
    bySymbol.set(t.symbol, (bySymbol.get(t.symbol) ?? 0) + t.pnl);
  }
  const symbolRows = Array.from(bySymbol.entries()).sort((a, b) => b[1] - a[1]);

  return {
    totalTrades: sorted.length,
    wins: wins.length,
    losses: losses.length,
    winRate: sorted.length ? (wins.length / sorted.length) * 100 : 0,
    netPnl,
    netR: 0, // R-multiple requires risk per trade; paper trades do not store unit risk consistently.
    maxDrawdownPct: peak > 0 ? (maxDD / peak) * 100 : 0,
    bestSymbol: symbolRows[0]?.[0] ?? null,
    worstSymbol: symbolRows.length > 1 ? symbolRows[symbolRows.length - 1]![0] : null,
  };
}

export const generateWeeklyReport = createServerFn({ method: "POST" })
  .middleware([requireCapability("analytics")])
  .inputValidator((raw: unknown) =>
    z
      .object({
        weekEnding: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      })
      .parse(raw),
  )
  .handler(async ({ data, context }): Promise<WeeklyReportRow> => {
    const start = new Date(data.weekEnding);
    start.setDate(start.getDate() - 6);
    const startIso = start.toISOString().slice(0, 10);

    const { data: trades } = await context.supabase
      .from("paper_trades")
      .select("id, symbol, side, entry, exit, stop, pnl, grade, reason, closed_at")
      .eq("user_id", context.userId)
      .gte("closed_at", `${startIso}T00:00:00Z`)
      .lte("closed_at", `${data.weekEnding}T23:59:59Z`)
      .order("closed_at", { ascending: true });

    const metrics = computeWeeklyMetrics((trades ?? []).map((r) => serverTradeFromRow(r as Record<string, unknown>)));

    let lesson = "No trades closed this week.";
    if (metrics.totalTrades > 0) {
      if (metrics.winRate >= 60 && metrics.netPnl > 0) {
        lesson = `Strong week: ${metrics.winRate.toFixed(0)}% win rate and +${metrics.netPnl.toFixed(2)}. Keep doing what worked.`;
      } else if (metrics.netPnl < 0) {
        lesson = `Down week. Focus on setup quality and size down until edge returns.`;
      } else {
        lesson = `Flat to slightly positive week. Review your worst symbol and tighten entries.`;
      }
      if (metrics.worstSymbol) {
        lesson += ` Worst performer: ${metrics.worstSymbol}.`;
      }
    }

    const { data: inserted, error } = await context.supabase
      .from("weekly_reports")
      .upsert(
        {
          user_id: context.userId,
          week_ending: data.weekEnding,
          metrics_json: metrics as never,
          lesson,
        },
        { onConflict: "user_id,week_ending" },
      )
      .select("id, week_ending, metrics_json, lesson, created_at")
      .single();
    if (error) throw new Error(error.message);

    return {
      id: inserted.id as string,
      weekEnding: inserted.week_ending as string,
      metrics: (inserted.metrics_json as WeeklyMetrics) ?? metrics,
      lesson: inserted.lesson as string,
      createdAt: inserted.created_at as string,
    };
  });

export const deleteWeeklyReport = createServerFn({ method: "POST" })
  .middleware([requireCapability("analytics")])
  .inputValidator((raw: unknown) => z.object({ id: z.string().uuid() }).parse(raw))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("weekly_reports")
      .delete()
      .eq("id", data.id)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });
