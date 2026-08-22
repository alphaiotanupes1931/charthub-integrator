import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  BarChart3, Bot, MessageSquare, TrendingUp, TrendingDown, Target, Activity, HeartPulse, Calendar, Flame, Trash2, Sparkles, Lock,
} from "lucide-react";
import { useEntitlements } from "@/hooks/useEntitlements";
import { guarded } from "@/lib/query-guard";
import { toast } from "sonner";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid,
  BarChart, Bar, Cell, ScatterChart, Scatter, ZAxis,
} from "recharts";
import {
  getPerformanceAnalytics,
  generateWeeklyReport,
  deleteWeeklyReport,
  type ServerTrade,
  type WeeklyReportRow,
} from "@/lib/performance-analytics.functions";

export const Route = createFileRoute("/_app/analytics")({
  head: () => ({
    meta: [
      { title: "Analytics, TradeMind" },
      { name: "description", content: "Unified trading performance analytics: journal, paper trades, autopilot, and weekly reports." },
      { property: "og:title", content: "Analytics, TradeMind" },
      { property: "og:description", content: "Unified trading performance analytics." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AnalyticsPage,
});

// Local journal trade shape (kept in sync with _app.journal.tsx).
type Side = "Long" | "Short";
type LocalTrade = {
  id: string;
  date: string;
  timeframe: string;
  symbol: string;
  side: Side;
  entry: number;
  exit: number;
  stop: number;
  size: number;
  notes: string;
  createdAt: number;
};
type Mental = { date: string; score: 1 | 2 | 3 | 4 | 5; mood?: string; createdAt: number };

const STORAGE_KEY = "trademind.journal.trades.v1";
const MENTAL_KEY = "trademind.mental.v1";

function loadLocalTrades(): LocalTrade[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}
function loadMental(): Mental[] {
  try {
    const raw = localStorage.getItem(MENTAL_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}
function localPnl(t: LocalTrade) {
  return (t.exit - t.entry) * (t.side === "Long" ? 1 : -1) * (t.size || 1);
}
function localRr(t: LocalTrade): number | null {
  const risk = Math.abs(t.entry - t.stop);
  if (!risk || !isFinite(risk)) return null;
  const dir = t.side === "Long" ? 1 : -1;
  return ((t.exit - t.entry) * dir) / risk;
}

function serverTradeToLocal(t: ServerTrade): LocalTrade {
  return {
    id: t.id,
    date: t.closedAt.slice(0, 10),
    timeframe: "D",
    symbol: t.symbol,
    side: t.side === "short" ? "Short" : "Long",
    entry: t.entry,
    exit: t.exit,
    stop: t.stop,
    size: 1,
    notes: t.reason,
    createdAt: new Date(t.closedAt).getTime(),
  };
}

const DOW_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const QUESTIONS = [
  "What's my biggest weakness?",
  "Which instrument am I most profitable on?",
  "How can I improve my win rate?",
  "What's my best trading pattern?",
  "Do I trade better when my mental score is high?",
  "Which day of the week do I perform worst?",
];

function endOfWeek(d: Date): string {
  const day = d.getDay();
  const offset = day === 0 ? 0 : 7 - day;
  const end = new Date(d);
  end.setDate(d.getDate() + offset);
  return `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, "0")}-${String(end.getDate()).padStart(2, "0")}`;
}

function AnalyticsPage() {
  const navigate = useNavigate();
  const ent = useEntitlements();

  const qc = useQueryClient();
  const [trades] = useState<LocalTrade[]>(() => loadLocalTrades());
  const [mental] = useState<Mental[]>(() => loadMental());
  const [serverTab, setServerTab] = useState<"journal" | "paper" | "autopilot">("journal");

  const getAnalytics = useServerFn(getPerformanceAnalytics);
  const generateReport = useServerFn(generateWeeklyReport);
  const removeReport = useServerFn(deleteWeeklyReport);

  const analytics = useQuery({
    queryKey: ["performanceAnalytics"],
    // Free accounts get a 403 here; guarded() makes that an error instead of
    // data so the blurred preview renders rather than crashing on the body.
    queryFn: () => guarded(getAnalytics()),
    enabled: ent.loading || ent.allow("analytics"),
    retry: false,
  });

  const reportMutation = useMutation({
    mutationFn: ({ weekEnding }: { weekEnding: string }) => generateReport({ data: { weekEnding } }),
    onSuccess: () => { toast.success("Weekly report saved"); qc.invalidateQueries({ queryKey: ["performanceAnalytics"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: ({ id }: { id: string }) => removeReport({ data: { id } }),
    onSuccess: () => { toast.success("Report deleted"); qc.invalidateQueries({ queryKey: ["performanceAnalytics"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const mergedTrades = useMemo(() => {
    const server: LocalTrade[] = (Array.isArray(analytics.data?.paperTrades) ? analytics.data.paperTrades : []).map(serverTradeToLocal);
    const all = [...trades, ...server].sort((a, b) => a.createdAt - b.createdAt);
    return all;
  }, [trades, analytics.data?.paperTrades]);

  const stats = useMemo(() => {
    if (mergedTrades.length === 0) return null;
    const sorted = [...mergedTrades].sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt);
    let equity = 0;
    const curve = sorted.map((t) => { equity += localPnl(t); return { date: t.date, equity: Number(equity.toFixed(2)) }; });
    const pnls = sorted.map(localPnl);
    const wins = pnls.filter((p) => p > 0);
    const losses = pnls.filter((p) => p < 0);
    const rrs = sorted.map(localRr).filter((v): v is number => v !== null && isFinite(v));

    const bySymbol = new Map<string, { n: number; pnl: number; wins: number }>();
    for (const t of sorted) {
      const s = bySymbol.get(t.symbol) ?? { n: 0, pnl: 0, wins: 0 };
      s.n++; s.pnl += localPnl(t); if (localPnl(t) > 0) s.wins++;
      bySymbol.set(t.symbol, s);
    }
    const perSymbol = Array.from(bySymbol.entries())
      .map(([symbol, v]) => ({ symbol, pnl: Number(v.pnl.toFixed(2)), n: v.n, winRate: (v.wins / v.n) * 100 }))
      .sort((a, b) => b.pnl - a.pnl);

    let maxWinStreak = 0, maxLossStreak = 0, curW = 0, curL = 0;
    for (const p of pnls) {
      if (p > 0) { curW++; curL = 0; maxWinStreak = Math.max(maxWinStreak, curW); }
      else if (p < 0) { curL++; curW = 0; maxLossStreak = Math.max(maxLossStreak, curL); }
      else { curW = 0; curL = 0; }
    }

    const byDow = new Map<number, { n: number; pnl: number; wins: number }>();
    for (const t of sorted) {
      const d = new Date(t.date + "T12:00:00Z").getUTCDay();
      const s = byDow.get(d) ?? { n: 0, pnl: 0, wins: 0 };
      s.n++; s.pnl += localPnl(t); if (localPnl(t) > 0) s.wins++;
      byDow.set(d, s);
    }
    const perDow = Array.from({ length: 7 }, (_, i) => {
      const v = byDow.get(i);
      return { day: DOW_LABELS[i], pnl: Number((v?.pnl ?? 0).toFixed(2)), n: v?.n ?? 0, winRate: v && v.n ? (v.wins / v.n) * 100 : 0 };
    });
    const dayWithTrades = perDow.filter((d) => d.n > 0);
    const bestDay = dayWithTrades.slice().sort((a, b) => b.pnl - a.pnl)[0];
    const worstDay = dayWithTrades.slice().sort((a, b) => a.pnl - b.pnl)[0];

    const mentalMap = new Map(mental.map((m) => [m.date, m.score]));
    const mentalScatter: Array<{ score: number; pnl: number; symbol: string }> = [];
    const byScore = new Map<number, { n: number; pnl: number; wins: number }>();
    for (const t of sorted) {
      const score = mentalMap.get(t.date);
      if (!score) continue;
      const p = localPnl(t);
      mentalScatter.push({ score, pnl: Number(p.toFixed(2)), symbol: t.symbol });
      const s = byScore.get(score) ?? { n: 0, pnl: 0, wins: 0 };
      s.n++; s.pnl += p; if (p > 0) s.wins++;
      byScore.set(score, s);
    }
    const perMentalScore = Array.from({ length: 5 }, (_, i) => {
      const v = byScore.get(i + 1);
      return { score: i + 1, avgPnl: v && v.n ? Number((v.pnl / v.n).toFixed(2)) : 0, n: v?.n ?? 0, winRate: v && v.n ? (v.wins / v.n) * 100 : 0 };
    });

    const winSum = wins.reduce((a, b) => a + b, 0);
    const lossSum = losses.reduce((a, b) => a + b, 0);
    const winRate = wins.length / sorted.length;
    const avgWin = wins.length ? winSum / wins.length : 0;
    const avgLoss = losses.length ? lossSum / losses.length : 0;
    const expectancy = winRate * avgWin + (1 - winRate) * avgLoss;

    let peak = -Infinity, maxDD = 0;
    for (const p of curve) {
      if (p.equity > peak) peak = p.equity;
      const dd = peak - p.equity;
      if (dd > maxDD) maxDD = dd;
    }

    // Autopilot proposal summary
    const proposals = analytics.data?.proposals ?? [];
    const proposalFilled = proposals.filter((p) => p.status === "filled");
    const proposalWins = proposalFilled.filter((p) => (p.realizedR ?? 0) > 0);
    const proposalNetR = proposalFilled.reduce((s, p) => s + (p.realizedR ?? 0), 0);

    return {
      total: sorted.length,
      wins: wins.length,
      losses: losses.length,
      winRate: winRate * 100,
      netPnl: pnls.reduce((a, b) => a + b, 0),
      avgWin, avgLoss,
      avgRR: rrs.length ? rrs.reduce((a, b) => a + b, 0) / rrs.length : 0,
      profitFactor: losses.length ? Math.abs(winSum / lossSum) : wins.length ? Infinity : 0,
      expectancy,
      maxDD,
      maxWinStreak, maxLossStreak,
      curve,
      perSymbol,
      perDow, bestDay, worstDay,
      mentalScatter, perMentalScore,
      proposalCount: proposals.length,
      proposalFilled: proposalFilled.length,
      proposalWinRate: proposalFilled.length ? (proposalWins.length / proposalFilled.length) * 100 : 0,
      proposalNetR,
    };
  }, [mergedTrades, mental, analytics.data?.proposals]);

  const ask = (q: string) => navigate({ to: "/dashboard", search: { ask: q } as never });

  const handleGenerateReport = () => {
    reportMutation.mutate({ weekEnding: endOfWeek(new Date()) });
  };

  // A denied or failed request can resolve to a shape without these arrays, so
  // every read stays optional - the preview must never crash the page.
  const hasAnyData = mergedTrades.length > 0 || (analytics.data?.proposals?.length ?? 0) > 0;

  // Free plan: a real preview, not an empty locked page. The trade count is the
  // user's actual count so it's obvious the data is being kept, and the numbers
  // behind the blur are their own - unblurring is the whole upgrade.
  if (!ent.loading && !ent.allow("analytics")) {
    return (
      <div className="p-4 md:p-8 max-w-[1400px] mx-auto space-y-6" data-testid="analytics-preview">
        <PageHeader title="Analytics" description="Your trading performance at a glance" />

        <div className="rounded-xl border border-border/60 bg-card p-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <Lock className="h-4 w-4" /> Analytics is part of the paid plan
              </div>
              <p className="mt-2 max-w-lg text-sm text-muted-foreground">
                {mergedTrades.length > 0
                  ? `You have ${mergedTrades.length} ${mergedTrades.length === 1 ? "trade" : "trades"} recorded. Nothing is lost while you're on the free plan, and your win rate, expectancy and drawdown are ready the moment you upgrade.`
                  : "Log trades in your journal for free and they'll be waiting here. Upgrade any time to see win rate, expectancy and drawdown."}
              </p>
            </div>
            <div className="flex gap-2">
              <Link to="/journal" className="inline-flex items-center rounded-xl border border-border px-4 py-2 text-sm font-medium">Go to Journal</Link>
              <Link to="/pricing" data-testid="analytics-preview-cta" className="inline-flex items-center rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">See plans</Link>
            </div>
          </div>
        </div>

        <div className="relative">
          <div aria-hidden data-testid="analytics-preview-blur" className="pointer-events-none select-none blur-[6px] opacity-60">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
              {["Net P&L", "Win Rate", "Avg R:R", "Profit Factor", "Expectancy", "Max Drawdown", "Win Streak", "Loss Streak", "Total Trades", "W / L"].map((label) => (
                <div key={label} className="rounded-xl border border-border/60 bg-card p-4">
                  <div className="mb-1 text-xs text-muted-foreground">{label}</div>
                  <div className="text-lg font-semibold text-foreground">--</div>
                </div>
              ))}
            </div>
            <div className="mt-3 h-52 rounded-xl border border-border/60 bg-card" />
          </div>
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="rounded-full border border-border bg-background/90 px-3 py-1 text-xs font-medium text-muted-foreground">
              Unlocks with any paid plan
            </span>
          </div>
        </div>
      </div>
    );
  }



  if (!hasAnyData) {
    return (
      <div className="p-4 md:p-8 max-w-[1400px] mx-auto">
        <PageHeader title="Analytics" description="Your trading performance at a glance" />
        <div className="rounded-xl border border-border/60 bg-card p-12 text-center space-y-4">

          <BarChart3 className="h-10 w-10 mx-auto text-muted-foreground" />
          <h3 className="text-lg font-semibold">No data yet</h3>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            Log your first trade in the journal, run a paper trade, or let Autopilot execute a signal to start seeing performance analytics.
          </p>
          <Link to="/journal" className="inline-flex rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">Go to Journal</Link>
        </div>
      </div>
    );
  }

  const kpis = [
    { label: "Net P&L", value: `${stats?.netPnl ?? 0 >= 0 ? "+" : ""}${(stats?.netPnl ?? 0).toFixed(2)}`, icon: stats?.netPnl ?? 0 >= 0 ? TrendingUp : TrendingDown, positive: (stats?.netPnl ?? 0) >= 0 },
    { label: "Win Rate", value: `${(stats?.winRate ?? 0).toFixed(1)}%`, icon: Target, positive: (stats?.winRate ?? 0) >= 50 },
    { label: "Avg R:R", value: stats?.avgRR ? stats.avgRR.toFixed(2) : "-", icon: Activity, positive: (stats?.avgRR ?? 0) >= 1 },
    { label: "Profit Factor", value: isFinite(stats?.profitFactor ?? 0) ? (stats?.profitFactor ?? 0).toFixed(2) : "inf", icon: BarChart3, positive: (stats?.profitFactor ?? 0) >= 1 },
    { label: "Expectancy", value: `${(stats?.expectancy ?? 0) >= 0 ? "+" : ""}${(stats?.expectancy ?? 0).toFixed(2)}`, icon: Activity, positive: (stats?.expectancy ?? 0) >= 0 },
    { label: "Max Drawdown", value: `-${(stats?.maxDD ?? 0).toFixed(2)}`, icon: TrendingDown, positive: false },
    { label: "Win Streak", value: String(stats?.maxWinStreak ?? 0), icon: Flame, positive: true },
    { label: "Loss Streak", value: String(stats?.maxLossStreak ?? 0), icon: Flame, positive: false },
    { label: "Total Trades", value: String(stats?.total ?? 0), icon: BarChart3, positive: true },
    { label: "W / L", value: `${stats?.wins ?? 0} / ${stats?.losses ?? 0}`, icon: Target, positive: (stats?.wins ?? 0) >= (stats?.losses ?? 0) },
  ];

  const proposalKpis = [
    { label: "Autopilot proposals", value: String(stats?.proposalCount ?? 0) },
    { label: "Filled", value: String(stats?.proposalFilled ?? 0) },
    { label: "Win rate", value: `${(stats?.proposalWinRate ?? 0).toFixed(0)}%` },
    { label: "Net R", value: `${(stats?.proposalNetR ?? 0) >= 0 ? "+" : ""}${(stats?.proposalNetR ?? 0).toFixed(2)}R` },
  ];

  return (
    <div className="p-4 md:p-8 max-w-[1400px] mx-auto space-y-6">
      <PageHeader title="Analytics" description="Your trading performance at a glance" />


      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        {kpis.map((k) => {
          const Icon = k.icon;
          return (
            <div key={k.label} className="rounded-xl border border-border/60 bg-card p-4">
              <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                <Icon className="h-3.5 w-3.5" /> {k.label}
              </div>
              <div className={`text-xl font-semibold ${k.positive ? "text-bull" : "text-destructive"}`}>{k.value}</div>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 rounded-xl border border-border/60 bg-card p-6">
          <h2 className="text-sm font-semibold mb-4">Equity Curve</h2>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={stats?.curve ?? []}>
                <defs>
                  <linearGradient id="eq" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="date" stroke="hsl(var(--muted-foreground))" fontSize={11} />
                <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} />
                <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }} />
                <Area type="monotone" dataKey="equity" stroke="hsl(var(--primary))" fill="url(#eq)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-xl border border-border/60 bg-card p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Weekly Reports</h2>
            <button
              onClick={handleGenerateReport}
              disabled={reportMutation.isPending}
              className="inline-flex items-center gap-1.5 rounded-xl border border-border/60 bg-background px-2.5 py-1.5 text-[11px] font-medium hover:border-primary/40 disabled:opacity-50"
            >
              <Sparkles className="h-3 w-3" />
              {reportMutation.isPending ? "Saving…" : "Generate this week"}
            </button>
          </div>
          <WeeklyReportsList reports={analytics.data?.weeklyReports ?? []} onDelete={(id) => deleteMutation.mutate({ id })} />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="rounded-xl border border-border/60 bg-card p-6">
          <h2 className="text-sm font-semibold mb-4">P&L by Instrument</h2>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stats?.perSymbol ?? []}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="symbol" stroke="hsl(var(--muted-foreground))" fontSize={11} />
                <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} />
                <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }} />
                <Bar dataKey="pnl">
                  {(stats?.perSymbol ?? []).map((s, i) => (
                    <Cell key={i} fill={s.pnl >= 0 ? "hsl(142 71% 45%)" : "hsl(0 72% 51%)"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-xl border border-border/60 bg-card p-6">
          <h2 className="flex items-center gap-2 text-sm font-semibold mb-4"><Calendar className="h-4 w-4" /> P&L by Day of Week</h2>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stats?.perDow ?? []}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="day" stroke="hsl(var(--muted-foreground))" fontSize={11} />
                <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} />
                <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }} />
                <Bar dataKey="pnl">
                  {(stats?.perDow ?? []).map((d, i) => (
                    <Cell key={i} fill={d.pnl >= 0 ? "hsl(142 71% 45%)" : "hsl(0 72% 51%)"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          {stats?.bestDay && stats?.worstDay && (
            <div className="mt-3 flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Best: <span className="text-bull font-semibold">{stats.bestDay.day}</span> ({stats.bestDay.pnl >= 0 ? "+" : ""}{stats.bestDay.pnl})</span>
              <span className="text-muted-foreground">Worst: <span className="text-destructive font-semibold">{stats.worstDay.day}</span> ({stats.worstDay.pnl >= 0 ? "+" : ""}{stats.worstDay.pnl})</span>
            </div>
          )}
        </div>
      </div>

      {stats?.mentalScatter.length && stats.mentalScatter.length > 0 ? (
        <div className="rounded-xl border border-border/60 bg-card p-6">
          <h2 className="flex items-center gap-2 text-sm font-semibold mb-1"><HeartPulse className="h-4 w-4" /> Mental State vs P&L</h2>
          <p className="text-xs text-muted-foreground mb-4">Each dot is a trade. X = your mental score that day (1 low, 5 great). Y = trade P&L.</p>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <ScatterChart>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis type="number" dataKey="score" domain={[0.5, 5.5]} ticks={[1, 2, 3, 4, 5]} stroke="hsl(var(--muted-foreground))" fontSize={11} />
                  <YAxis type="number" dataKey="pnl" stroke="hsl(var(--muted-foreground))" fontSize={11} />
                  <ZAxis range={[60, 60]} />
                  <Tooltip cursor={{ strokeDasharray: "3 3" }} contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }} />
                  <Scatter data={stats.mentalScatter}>
                    {stats.mentalScatter.map((p, i) => (
                      <Cell key={i} fill={p.pnl >= 0 ? "hsl(142 71% 45%)" : "hsl(0 72% 51%)"} />
                    ))}
                  </Scatter>
                </ScatterChart>
              </ResponsiveContainer>
            </div>
            <div className="space-y-1">
              {stats.perMentalScore.map((m) => (
                <div key={m.score} className="flex items-center justify-between rounded-xl border border-border/60 px-3 py-2 text-sm">
                  <div className="font-medium">Score {m.score}</div>
                  <div className="flex items-center gap-4 text-xs text-muted-foreground">
                    <span>{m.n} trades</span>
                    <span>{m.n ? `${m.winRate.toFixed(0)}% win` : "-"}</span>
                    <span className={m.avgPnl >= 0 ? "text-bull font-semibold" : "text-destructive font-semibold"}>
                      {m.n ? `avg ${m.avgPnl >= 0 ? "+" : ""}${m.avgPnl}` : "no data"}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      <div className="rounded-xl border border-border/60 bg-card p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold">Instrument Breakdown</h2>
          <div className="inline-flex rounded-xl border border-border/60 p-0.5">
            {(["journal", "paper", "autopilot"] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setServerTab(tab)}
                className={`px-2.5 py-1 text-[11px] font-medium capitalize rounded transition ${serverTab === tab ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground"}`}
              >
                {tab}
              </button>
            ))}
          </div>
        </div>
        <div className="space-y-2 max-h-64 overflow-auto">
          {serverTab === "autopilot" && (analytics.data?.proposals ?? []).map((p) => (
            <div key={p.id} className="flex items-center justify-between rounded-xl border border-border/60 px-3 py-2 text-sm">
              <div className="font-medium">{p.symbol} <span className="text-xs text-muted-foreground">{p.side} · {p.grade ?? "no grade"}</span></div>
              <div className="flex items-center gap-4 text-xs text-muted-foreground">
                <span>{p.status}</span>
                <span className={p.realizedR != null && p.realizedR >= 0 ? "text-bull font-semibold" : "text-destructive font-semibold"}>
                  {p.realizedR != null ? `${p.realizedR >= 0 ? "+" : ""}${p.realizedR.toFixed(2)}R` : "pending"}
                </span>
              </div>
            </div>
          ))}
          {serverTab !== "autopilot" && stats?.perSymbol.map((s) => (
            <div key={s.symbol} className="flex items-center justify-between rounded-xl border border-border/60 px-3 py-2 text-sm">
              <div className="font-medium">{s.symbol}</div>
              <div className="flex items-center gap-4 text-xs text-muted-foreground">
                <span>{s.n} trades</span>
                <span>{s.winRate.toFixed(0)}% win</span>
                <span className={s.pnl >= 0 ? "text-bull font-semibold" : "text-destructive font-semibold"}>
                  {s.pnl >= 0 ? "+" : ""}{s.pnl.toFixed(2)}
                </span>
              </div>
            </div>
          ))}
          {serverTab !== "autopilot" && stats?.perSymbol.length === 0 && (
            <p className="text-sm text-muted-foreground">No {serverTab} trades available.</p>
          )}
          {serverTab === "autopilot" && (analytics.data?.proposals?.length ?? 0) === 0 && (
            <p className="text-sm text-muted-foreground">No autopilot proposals yet.</p>
          )}
        </div>
      </div>

      {(stats?.proposalCount ?? 0) > 0 && (
        <div className="rounded-xl border border-border/60 bg-card p-6">
          <h2 className="text-sm font-semibold mb-4">Autopilot Summary</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {proposalKpis.map((k) => (
              <div key={k.label} className="rounded-xl border border-border/60 p-3">
                <div className="text-[10px] tracking-tight text-muted-foreground">{k.label}</div>
                <div className="text-lg font-semibold">{k.value}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="rounded-xl border border-border/60 bg-card p-6">
        <h2 className="flex items-center gap-2 text-sm font-semibold mb-4">
          <MessageSquare className="h-4 w-4" /> Ask AI About Your Performance
        </h2>
        <div className="flex flex-wrap gap-2">
          {QUESTIONS.map((q) => (
            <button
              key={q}
              onClick={() => ask(q)}
              className="rounded-xl border border-primary/30 bg-primary/5 px-3 py-1.5 text-xs text-primary hover:bg-primary/10"
            >
              <Bot className="h-3 w-3 inline mr-1" />{q}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function WeeklyReportsList({ reports, onDelete }: { reports: WeeklyReportRow[]; onDelete: (id: string) => void }) {
  if (reports.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No weekly reports yet. Generate one to capture a Sunday snapshot of your week.
      </p>
    );
  }
  return (
    <div className="space-y-2 max-h-64 overflow-auto">
      {reports.map((r) => (
        <div key={r.id} className="rounded-xl border border-border/60 p-3 text-sm">
          <div className="flex items-center justify-between">
            <span className="font-medium">Week ending {r.weekEnding}</span>
            <button
              onClick={() => onDelete(r.id)}
              className="text-muted-foreground hover:text-destructive"
              aria-label="Delete report"
              title="Delete report"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
            <span>{r.metrics.totalTrades} trades</span>
            <span>{r.metrics.winRate.toFixed(0)}% win</span>
            <span className={r.metrics.netPnl >= 0 ? "text-bull" : "text-destructive"}>
              {r.metrics.netPnl >= 0 ? "+" : ""}{r.metrics.netPnl.toFixed(2)}
            </span>
          </div>
          <p className="mt-1.5 text-xs text-foreground/80">{r.lesson}</p>
        </div>
      ))}
    </div>
  );
}
