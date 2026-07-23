import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { BarChart3, Bot, MessageSquare, TrendingUp, TrendingDown, Target, Activity, HeartPulse, Calendar, Flame } from "lucide-react";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid,
  BarChart, Bar, Cell, ScatterChart, Scatter, ZAxis,
} from "recharts";

export const Route = createFileRoute("/_app/analytics")({
  head: () => ({ meta: [{ title: "Analytics, TradeMind" }] }),
  component: AnalyticsPage,
});

type Side = "Long" | "Short";
type Trade = {
  id: string; date: string; timeframe: string; symbol: string; side: Side;
  entry: number; exit: number; stop: number; size: number; notes: string; createdAt: number;
};
type Mental = { date: string; score: 1|2|3|4|5; mood?: string; createdAt: number };

const STORAGE_KEY = "trademind.journal.trades.v1";
const MENTAL_KEY = "trademind.mental.v1";

function loadTrades(): Trade[] {
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
function pnl(t: Trade) { return (t.exit - t.entry) * (t.side === "Long" ? 1 : -1) * (t.size || 1); }
function rr(t: Trade): number | null {
  const risk = Math.abs(t.entry - t.stop);
  if (!risk || !isFinite(risk)) return null;
  const dir = t.side === "Long" ? 1 : -1;
  return ((t.exit - t.entry) * dir) / risk;
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

function AnalyticsPage() {
  const navigate = useNavigate();
  const [trades, setTrades] = useState<Trade[]>([]);
  const [mental, setMental] = useState<Mental[]>([]);
  useEffect(() => { setTrades(loadTrades()); setMental(loadMental()); }, []);

  const stats = useMemo(() => {
    if (trades.length === 0) return null;
    const sorted = [...trades].sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt);
    let equity = 0;
    const curve = sorted.map((t) => { equity += pnl(t); return { date: t.date, equity: Number(equity.toFixed(2)) }; });
    const pnls = sorted.map(pnl);
    const wins = pnls.filter((p) => p > 0);
    const losses = pnls.filter((p) => p < 0);
    const rrs = sorted.map(rr).filter((v): v is number => v !== null && isFinite(v));

    // Per-symbol
    const bySymbol = new Map<string, { n: number; pnl: number; wins: number }>();
    for (const t of sorted) {
      const s = bySymbol.get(t.symbol) ?? { n: 0, pnl: 0, wins: 0 };
      s.n++; s.pnl += pnl(t); if (pnl(t) > 0) s.wins++;
      bySymbol.set(t.symbol, s);
    }
    const perSymbol = Array.from(bySymbol.entries())
      .map(([symbol, v]) => ({ symbol, pnl: Number(v.pnl.toFixed(2)), n: v.n, winRate: (v.wins / v.n) * 100 }))
      .sort((a, b) => b.pnl - a.pnl);

    // Streaks
    let maxWinStreak = 0, maxLossStreak = 0, curW = 0, curL = 0;
    for (const p of pnls) {
      if (p > 0) { curW++; curL = 0; maxWinStreak = Math.max(maxWinStreak, curW); }
      else if (p < 0) { curL++; curW = 0; maxLossStreak = Math.max(maxLossStreak, curL); }
      else { curW = 0; curL = 0; }
    }

    // Day of week
    const byDow = new Map<number, { n: number; pnl: number; wins: number }>();
    for (const t of sorted) {
      const d = new Date(t.date + "T12:00:00Z").getUTCDay();
      const s = byDow.get(d) ?? { n: 0, pnl: 0, wins: 0 };
      s.n++; s.pnl += pnl(t); if (pnl(t) > 0) s.wins++;
      byDow.set(d, s);
    }
    const perDow = Array.from({ length: 7 }, (_, i) => {
      const v = byDow.get(i);
      return { day: DOW_LABELS[i], pnl: Number((v?.pnl ?? 0).toFixed(2)), n: v?.n ?? 0, winRate: v && v.n ? (v.wins / v.n) * 100 : 0 };
    });
    const dayWithTrades = perDow.filter((d) => d.n > 0);
    const bestDay = dayWithTrades.slice().sort((a, b) => b.pnl - a.pnl)[0];
    const worstDay = dayWithTrades.slice().sort((a, b) => a.pnl - b.pnl)[0];

    // Mental correlation
    const mentalMap = new Map(mental.map((m) => [m.date, m.score]));
    const mentalScatter: Array<{ score: number; pnl: number; symbol: string }> = [];
    const byScore = new Map<number, { n: number; pnl: number; wins: number }>();
    for (const t of sorted) {
      const score = mentalMap.get(t.date);
      if (!score) continue;
      const p = pnl(t);
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
    // Expectancy per trade
    const expectancy = winRate * avgWin + (1 - winRate) * avgLoss;

    // Peak / drawdown
    let peak = -Infinity, maxDD = 0;
    for (const p of curve) {
      if (p.equity > peak) peak = p.equity;
      const dd = peak - p.equity;
      if (dd > maxDD) maxDD = dd;
    }

    return {
      total: sorted.length,
      wins: wins.length,
      losses: losses.length,
      winRate: winRate * 100,
      netPnl: pnls.reduce((a, b) => a + b, 0),
      avgWin, avgLoss,
      avgRR: rrs.length ? rrs.reduce((a, b) => a + b, 0) / rrs.length : 0,
      profitFactor: losses.length
        ? Math.abs(winSum / lossSum)
        : wins.length ? Infinity : 0,
      expectancy,
      maxDD,
      maxWinStreak, maxLossStreak,
      curve,
      perSymbol,
      perDow, bestDay, worstDay,
      mentalScatter, perMentalScore,
    };
  }, [trades, mental]);

  const ask = (q: string) => navigate({ to: "/dashboard", search: { ask: q } as never });

  if (!stats) {
    return (
      <div className="p-4 md:p-8 max-w-[1400px] mx-auto">
        <PageHeader title="Analytics" description="Your trading performance at a glance" />
        <div className="rounded-xl border border-border bg-card p-12 text-center space-y-4">
          <BarChart3 className="h-10 w-10 mx-auto text-muted-foreground" />
          <h3 className="text-lg font-semibold">No data yet</h3>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            Log your first trade in the journal to start seeing performance analytics.
          </p>
          <Link to="/journal" className="inline-flex rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">Go to Journal</Link>
        </div>
      </div>
    );
  }

  const kpis = [
    { label: "Net P&L", value: `${stats.netPnl >= 0 ? "+" : ""}${stats.netPnl.toFixed(2)}`, icon: stats.netPnl >= 0 ? TrendingUp : TrendingDown, positive: stats.netPnl >= 0 },
    { label: "Win Rate", value: `${stats.winRate.toFixed(1)}%`, icon: Target, positive: stats.winRate >= 50 },
    { label: "Avg R:R", value: stats.avgRR ? stats.avgRR.toFixed(2) : "-", icon: Activity, positive: stats.avgRR >= 1 },
    { label: "Profit Factor", value: isFinite(stats.profitFactor) ? stats.profitFactor.toFixed(2) : "inf", icon: BarChart3, positive: stats.profitFactor >= 1 },
    { label: "Expectancy", value: `${stats.expectancy >= 0 ? "+" : ""}${stats.expectancy.toFixed(2)}`, icon: Activity, positive: stats.expectancy >= 0 },
    { label: "Max Drawdown", value: `-${stats.maxDD.toFixed(2)}`, icon: TrendingDown, positive: false },
    { label: "Win Streak", value: String(stats.maxWinStreak), icon: Flame, positive: true },
    { label: "Loss Streak", value: String(stats.maxLossStreak), icon: Flame, positive: false },
    { label: "Total Trades", value: String(stats.total), icon: BarChart3, positive: true },
    { label: "W / L", value: `${stats.wins} / ${stats.losses}`, icon: Target, positive: stats.wins >= stats.losses },
  ];

  return (
    <div className="p-4 md:p-8 max-w-[1400px] mx-auto space-y-6">
      <PageHeader title="Analytics" description="Your trading performance at a glance" />

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        {kpis.map((k) => {
          const Icon = k.icon;
          return (
            <div key={k.label} className="rounded-xl border border-border bg-card p-4">
              <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                <Icon className="h-3.5 w-3.5" /> {k.label}
              </div>
              <div className={`text-xl font-semibold ${k.positive ? "text-bull" : "text-red-500"}`}>{k.value}</div>
            </div>
          );
        })}
      </div>

      <div className="rounded-xl border border-border bg-card p-6">
        <h2 className="text-sm font-semibold mb-4">Equity Curve</h2>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={stats.curve}>
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

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="rounded-xl border border-border bg-card p-6">
          <h2 className="text-sm font-semibold mb-4">P&L by Instrument</h2>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stats.perSymbol}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="symbol" stroke="hsl(var(--muted-foreground))" fontSize={11} />
                <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} />
                <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }} />
                <Bar dataKey="pnl">
                  {stats.perSymbol.map((s, i) => (
                    <Cell key={i} fill={s.pnl >= 0 ? "hsl(142 71% 45%)" : "hsl(0 72% 51%)"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card p-6">
          <h2 className="flex items-center gap-2 text-sm font-semibold mb-4"><Calendar className="h-4 w-4" /> P&L by Day of Week</h2>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stats.perDow}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="day" stroke="hsl(var(--muted-foreground))" fontSize={11} />
                <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} />
                <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }} />
                <Bar dataKey="pnl">
                  {stats.perDow.map((d, i) => (
                    <Cell key={i} fill={d.pnl >= 0 ? "hsl(142 71% 45%)" : "hsl(0 72% 51%)"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          {stats.bestDay && stats.worstDay && (
            <div className="mt-3 flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Best: <span className="text-bull font-semibold">{stats.bestDay.day}</span> ({stats.bestDay.pnl >= 0 ? "+" : ""}{stats.bestDay.pnl})</span>
              <span className="text-muted-foreground">Worst: <span className="text-red-500 font-semibold">{stats.worstDay.day}</span> ({stats.worstDay.pnl >= 0 ? "+" : ""}{stats.worstDay.pnl})</span>
            </div>
          )}
        </div>
      </div>

      {stats.mentalScatter.length > 0 && (
        <div className="rounded-xl border border-border bg-card p-6">
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
                <div key={m.score} className="flex items-center justify-between rounded-md border border-border/60 px-3 py-2 text-sm">
                  <div className="font-medium">Score {m.score}</div>
                  <div className="flex items-center gap-4 text-xs text-muted-foreground">
                    <span>{m.n} trades</span>
                    <span>{m.n ? `${m.winRate.toFixed(0)}% win` : "-"}</span>
                    <span className={m.avgPnl >= 0 ? "text-bull font-semibold" : "text-red-500 font-semibold"}>
                      {m.n ? `avg ${m.avgPnl >= 0 ? "+" : ""}${m.avgPnl}` : "no data"}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="rounded-xl border border-border bg-card p-6">
        <h2 className="text-sm font-semibold mb-4">Instrument Breakdown</h2>
        <div className="space-y-2 max-h-64 overflow-auto">
          {stats.perSymbol.map((s) => (
            <div key={s.symbol} className="flex items-center justify-between rounded-md border border-border/60 px-3 py-2 text-sm">
              <div className="font-medium">{s.symbol}</div>
              <div className="flex items-center gap-4 text-xs text-muted-foreground">
                <span>{s.n} trades</span>
                <span>{s.winRate.toFixed(0)}% win</span>
                <span className={s.pnl >= 0 ? "text-bull font-semibold" : "text-red-500 font-semibold"}>
                  {s.pnl >= 0 ? "+" : ""}{s.pnl.toFixed(2)}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card p-6">
        <h2 className="flex items-center gap-2 text-sm font-semibold mb-4">
          <MessageSquare className="h-4 w-4" /> Ask AI About Your Performance
        </h2>
        <div className="flex flex-wrap gap-2">
          {QUESTIONS.map((q) => (
            <button
              key={q}
              onClick={() => ask(q)}
              className="rounded-md border border-primary/30 bg-primary/5 px-3 py-1.5 text-xs text-primary hover:bg-primary/10"
            >
              <Bot className="h-3 w-3 inline mr-1" />{q}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
