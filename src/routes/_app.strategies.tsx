import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { STRATEGIES, type Level } from "@/data/strategies";
import { Search, Plus, ChevronDown, BarChart2, TrendingUp, CircleDot, Zap } from "lucide-react";

export const Route = createFileRoute("/_app/strategies")({
  head: () => ({ meta: [{ title: "Strategies — TradeMind" }] }),
  component: StrategiesPage,
});

const levelColor: Record<Level, string> = {
  Beginner: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  Intermediate: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  Advanced: "bg-rose-500/15 text-rose-400 border-rose-500/30",
};

const styleIcon = { Day: CircleDot, Swing: TrendingUp, Scalp: Zap } as const;

function StrategiesPage() {
  const [q, setQ] = useState("");
  const filtered = STRATEGIES.filter((s) =>
    s.name.toLowerCase().includes(q.toLowerCase())
  );

  return (
    <div className="p-4 md:p-8 max-w-[1400px] mx-auto">
      <PageHeader
        title="Strategy Library"
        description={
          <>
            A <span className="text-foreground font-semibold">strategy</span> is your trading playbook — entry rules, exit rules, risk management, sessions. Pick one and TradeMind grades every <span className="text-foreground font-semibold">scan signal</span> against your chosen strategy's rules so you can see whether you're sticking to your plan or freelancing.
          </>
        }
        action={
          <button className="flex items-center gap-1.5 rounded-md border border-primary/40 bg-primary/10 px-4 py-2 text-sm font-semibold text-primary">
            <Plus className="h-4 w-4" /> Create Your Own
          </button>
        }
      />

      <div className="flex flex-wrap gap-3 mb-6">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search strategies..."
            className="w-full h-10 rounded-md border border-border bg-card pl-9 pr-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:border-primary/40"
          />
        </div>
        {["All Assets", "All Styles", "All Levels", "Name A-Z"].map((label) => (
          <button key={label} className="flex items-center gap-2 h-10 rounded-md border border-border bg-card px-3 text-sm text-muted-foreground min-w-[140px] justify-between">
            {label} <ChevronDown className="h-3.5 w-3.5" />
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filtered.map((s) => {
          const StyleIcon = styleIcon[s.style];
          return (
            <div key={s.name} className="rounded-xl border border-border bg-card p-5 space-y-3 hover:border-primary/40 transition-colors cursor-pointer">
              <div className="flex items-start justify-between gap-2">
                <h3 className="font-semibold text-base">{s.name}</h3>
                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded border ${levelColor[s.level]}`}>
                  {s.level}
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <span className="inline-flex items-center gap-1 rounded border border-border bg-background px-2 py-0.5 text-[11px] text-muted-foreground">
                  <StyleIcon className="h-3 w-3" /> {s.style}
                </span>
                {s.markets.map((m) => (
                  <span key={m} className="inline-flex rounded border border-border bg-background px-2 py-0.5 text-[11px] text-muted-foreground">{m}</span>
                ))}
              </div>
              <p className="text-sm text-muted-foreground leading-relaxed line-clamp-4">{s.description}</p>
              <div className="flex items-center gap-5 text-xs pt-2 border-t border-border/50">
                <div className="flex items-center gap-1.5">
                  <BarChart2 className="h-3.5 w-3.5 text-emerald-400" />
                  <span className="font-mono font-semibold text-emerald-400">{s.winRate}%</span>
                  <span className="text-muted-foreground">Win Rate</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <TrendingUp className="h-3.5 w-3.5 text-primary" />
                  <span className="font-mono font-semibold text-primary">{s.rr}R</span>
                  <span className="text-muted-foreground">Avg R:R</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
