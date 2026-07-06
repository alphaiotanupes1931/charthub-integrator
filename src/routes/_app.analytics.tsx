import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { BarChart3, Bot, MessageSquare, TrendingUp, TrendingDown, Target, Activity } from "lucide-react";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid,
  BarChart, Bar, Cell,
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

const STORAGE_KEY = "trademind.journal.trades.v1";

function loadTrades(): Trade[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
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

const QUESTIONS = [
  "What's my biggest weakness?",
  "Which instrument am I most profitable on?",
  "How can I improve my win rate?",
  "What's my best trading pattern?",
];

function AnalyticsPage() {
  const navigate = useNavigate();
  const [trades, setTrades] = useState<Trade[]>([]);
  useEffect(() => { setTrades(loadTrades()); }, []);

  const stats = useMemo(() => {
    if (trades.length === 0) return null;
    const sorted = [...trades].sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt);
    let equity = 0;
    const curve = sorted.map((t) => { equity += pnl(t); return { date: t.date, equity: Number(equity.toFixed(2)) }; });
    const pnls = sorted.map(pnl);
    const wins = pnls.filter((p) => p > 0);
    const losses = pnls.filter((p) => p < 0);
    const rrs = sorted.map(rr).filter((v): v is number => v !== null && isFinite(v));
    const bySymbol = new Map<string, { n: number; pnl: number; wins: number }>();
    for (const t of sorted) {
      const s = bySymbol.get(t.symbol) ?? { n: 0, pnl: 0, wins: 0 };
      s.n++; s.pnl += pnl(t); if (pnl(t) > 0) s.wins++;
      bySymbol.set(t.symbol, s);
    }
    const perSymbol = Array.from(bySymbol.entries())
      .map(([symbol, v]) => ({ symbol, pnl: Number(v.pnl.toFixed(2)), n: v.n, winRate: (v.wins / v.n) * 100 }))
      .sort((a, b) => b.pnl - a.pnl);

    return {
      total: sorted.length,
      wins: wins.length,
      losses: losses.length,
      winRate: (wins.length / sorted.length) * 100,
      netPnl: pnls.reduce((a, b) => a + b, 0),
      avgWin: wins.length ? wins.reduce((a, b) => a + b, 0) / wins.length : 0,
      avgLoss: losses.length ? losses.reduce((a, b) => a + b, 0) / losses.length : 0,
      avgRR: rrs.length ? rrs.reduce((a, b) => a + b, 0) / rrs.length : 0,
      profitFactor: losses.length
        ? Math.abs(wins.reduce((a, b) => a + b, 0) / losses.reduce((a, b) => a + b, 0))
        : wins.length ? Infinity : 0,
      curve,
      perSymbol,
    };
  }, [trades]);

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
    { label: "Profit Factor", value: isFinite(stats.profitFactor) ? stats.profitFactor.toFixed(2) : "∞", icon: BarChart3, positive: stats.profitFactor >= 1 },
    { label: "Total Trades", value: String(stats.total), icon: BarChart3, positive: true },
    { label: "W / L", value: `${stats.wins} / ${stats.losses}`, icon: Target, positive: stats.wins >= stats.losses },
  ];

  return (
    <div className="p-4 md:p-8 max-w-[1400px] mx-auto space-y-6">
      <PageHeader title="Analytics" description="Your trading performance at a glance" />

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {kpis.map((k) => {
          const Icon = k.icon;
          return (
            <div key={k.label} className="rounded-xl border border-border bg-card p-4">
              <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                <Icon className="h-3.5 w-3.5" /> {k.label}
              </div>
              <div className={`text-xl font-semibold ${k.positive ? "text-emerald-500" : "text-red-500"}`}>{k.value}</div>
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
          <h2 className="text-sm font-semibold mb-4">Instrument Breakdown</h2>
          <div className="space-y-2 max-h-64 overflow-auto">
            {stats.perSymbol.map((s) => (
              <div key={s.symbol} className="flex items-center justify-between rounded-md border border-border/60 px-3 py-2 text-sm">
                <div className="font-medium">{s.symbol}</div>
                <div className="flex items-center gap-4 text-xs text-muted-foreground">
                  <span>{s.n} trades</span>
                  <span>{s.winRate.toFixed(0)}% win</span>
                  <span className={s.pnl >= 0 ? "text-emerald-500 font-semibold" : "text-red-500 font-semibold"}>
                    {s.pnl >= 0 ? "+" : ""}{s.pnl.toFixed(2)}
                  </span>
                </div>
              </div>
            ))}
          </div>
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
