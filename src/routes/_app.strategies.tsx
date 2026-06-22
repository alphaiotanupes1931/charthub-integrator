import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { type Level, type Style, type Strategy } from "@/data/strategies";
import { Search, Plus, ChevronDown, BarChart2, TrendingUp, CircleDot, Zap, X, CheckCircle2, Trash2, Pencil, Sparkles } from "lucide-react";
import { toast } from "sonner";
import {
  type CustomStrategy,
  allStrategies,
  readCustomStrategies,
  saveCustomStrategy,
  deleteCustomStrategy,
  LEVELS,
  STYLES,
  MARKETS,
} from "@/lib/customStrategies";

export const Route = createFileRoute("/_app/strategies")({
  head: () => ({ meta: [{ title: "Strategies, TradeMind" }] }),
  component: StrategiesPage,
});

const levelColor: Record<Level, string> = {
  Beginner: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  Intermediate: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  Advanced: "bg-rose-500/15 text-rose-400 border-rose-500/30",
};

const styleIcon = { Day: CircleDot, Swing: TrendingUp, Scalp: Zap } as const;

const STRAT_KEY = "trademind.activeStrategy";

function StrategiesPage() {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<Strategy | null>(null);
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    try { setActive(localStorage.getItem(STRAT_KEY)); } catch { /* ignore */ }
  }, []);

  const select = (name: string) => {
    try { localStorage.setItem(STRAT_KEY, name); } catch { /* ignore */ }
    setActive(name);
    toast.success(`${name} is now your active strategy`);
    setOpen(null);
  };

  const filtered = STRATEGIES.filter((s) =>
    s.name.toLowerCase().includes(q.toLowerCase())
  );

  return (
    <div className="p-4 md:p-8 max-w-[1400px] mx-auto">
      <PageHeader
        title="Strategy Library"
        description={
          <>
            A <span className="text-foreground font-semibold">strategy</span> is your trading playbook, entry rules, exit rules, risk management, sessions. Pick one and TradeMind grades every <span className="text-foreground font-semibold">scan signal</span> against your chosen strategy's rules.
          </>
        }
        action={
          <button
            onClick={() => toast.info("Custom strategy builder coming soon")}
            className="flex items-center gap-1.5 rounded-md border border-primary/40 bg-primary/10 px-4 py-2 text-sm font-semibold text-primary hover:bg-primary/20"
          >
            <Plus className="h-4 w-4" /> Create Your Own
          </button>
        }
      />

      {active && (
        <div className="mb-5 rounded-xl border border-primary/40 bg-primary/[0.04] px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm">
            <CheckCircle2 className="h-4 w-4 text-primary" />
            <span className="text-muted-foreground">Active strategy:</span>
            <span className="font-semibold text-foreground">{active}</span>
          </div>
          <button
            onClick={() => { try { localStorage.removeItem(STRAT_KEY); } catch { /* ignore */ } setActive(null); }}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            Clear
          </button>
        </div>
      )}

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
          const isActive = active === s.name;
          return (
            <button
              type="button"
              key={s.name}
              onClick={() => setOpen(s)}
              className={`text-left rounded-xl border bg-card p-5 space-y-3 transition-colors ${
                isActive ? "border-primary/60 ring-1 ring-primary/30" : "border-border hover:border-primary/40"
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <h3 className="font-semibold text-base flex items-center gap-2">
                  {s.name}
                  {isActive && <CheckCircle2 className="h-3.5 w-3.5 text-primary" />}
                </h3>
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
            </button>
          );
        })}
      </div>

      {open && <StrategyModal strategy={open} active={active === open.name} onSelect={select} onClose={() => setOpen(null)} />}
    </div>
  );
}

function StrategyModal({
  strategy: s, active, onSelect, onClose,
}: { strategy: Strategy; active: boolean; onSelect: (name: string) => void; onClose: () => void }) {
  const StyleIcon = styleIcon[s.style];
  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm animate-in fade-in"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-xl rounded-2xl border border-border bg-card shadow-2xl animate-in zoom-in-95 duration-200"
      >
        <button
          onClick={onClose}
          className="absolute right-3 top-3 h-8 w-8 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent/40 flex items-center justify-center"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>
        <div className="p-7 space-y-5">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className={`text-[10px] font-semibold px-2 py-0.5 rounded border ${levelColor[s.level]}`}>{s.level}</span>
              <span className="inline-flex items-center gap-1 rounded border border-border bg-background px-2 py-0.5 text-[11px] text-muted-foreground">
                <StyleIcon className="h-3 w-3" /> {s.style}
              </span>
            </div>
            <h2 className="font-display text-2xl font-semibold tracking-tight">{s.name}</h2>
          </div>

          <p className="text-sm text-muted-foreground leading-relaxed">{s.description}</p>

          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg border border-border bg-background/50 p-4">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Win Rate</div>
              <div className="font-mono text-2xl font-semibold text-emerald-400">{s.winRate}%</div>
            </div>
            <div className="rounded-lg border border-border bg-background/50 p-4">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Avg R:R</div>
              <div className="font-mono text-2xl font-semibold text-primary">{s.rr}R</div>
            </div>
          </div>

          <div>
            <div className="text-xs font-semibold mb-2">Markets</div>
            <div className="flex flex-wrap gap-1.5">
              {s.markets.map((m) => (
                <span key={m} className="rounded border border-border bg-background px-2 py-0.5 text-[11px] text-muted-foreground">{m}</span>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-2">
            <button onClick={onClose} className="text-sm text-muted-foreground hover:text-foreground px-3 py-2">Cancel</button>
            <button
              onClick={() => onSelect(s.name)}
              disabled={active}
              className={`inline-flex items-center gap-1.5 rounded-md px-4 py-2 text-sm font-semibold ${
                active ? "bg-primary/10 text-primary cursor-default" : "bg-primary text-primary-foreground hover:opacity-90"
              }`}
            >
              {active ? <><CheckCircle2 className="h-4 w-4" /> Selected</> : "Use this Strategy"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
