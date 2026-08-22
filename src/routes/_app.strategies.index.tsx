import { createFileRoute, Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { type Level, type Style, type Strategy } from "@/data/strategies";
import { Search, Plus, ChevronDown, BarChart2, TrendingUp, CircleDot, Zap, X, CheckCircle2, Trash2, Pencil, Sparkles } from "lucide-react";
import { toast } from "sonner";
import {
import { useEntitlements } from "@/hooks/useEntitlements";
  type CustomStrategy,
  allStrategies,
  readCustomStrategies,
  saveCustomStrategy,
  deleteCustomStrategy,
  LEVELS,
  STYLES,
  MARKETS,
} from "@/lib/customStrategies";

export const Route = createFileRoute("/_app/strategies/")({
  head: () => ({ meta: [{ title: "Strategies, TradeMind" }] }),
  component: StrategiesPage,
  validateSearch: (s: Record<string, unknown>) => ({ edit: typeof s.edit === "string" ? s.edit : undefined }),
});

const levelColor: Record<Level, string> = {
  Beginner: "bg-bull/15 text-bull border-bull/30",
  Intermediate: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  Advanced: "bg-rose-500/15 text-rose-400 border-rose-500/30",
};

const styleIcon = { Day: CircleDot, Swing: TrendingUp, Scalp: Zap } as const;

const STRAT_KEY = "trademind.activeStrategy";

function StrategiesPage() {
  const ent = useEntitlements();
  // Free accounts see the library titles; the measured win rates are paid (13.2).
  const showStats = ent.allow("strategy_library");
  const [q, setQ] = useState("");
  const [active, setActive] = useState<string | null>(null);
  const [builderOpen, setBuilderOpen] = useState(false);
  const [editing, setEditing] = useState<CustomStrategy | null>(null);
  const [customs, setCustoms] = useState<CustomStrategy[]>([]);
  const navigate = useNavigate({ from: "/strategies" });
  const search = useSearch({ from: "/_app/strategies/" }) as { edit?: string };

  useEffect(() => {
    try { setActive(localStorage.getItem(STRAT_KEY)); } catch { /* ignore */ }
    setCustoms(readCustomStrategies());
  }, []);

  useEffect(() => {
    if (search.edit) {
      const found = readCustomStrategies().find((c) => c.id === search.edit || c.slug === search.edit);
      if (found) {
        setEditing(found);
        setBuilderOpen(true);
      } else {
        navigate({ to: "/strategies", search: {} });
      }
    }
  }, [search.edit]);

  const refreshCustoms = () => setCustoms(readCustomStrategies());

  const select = (name: string) => {
    try { localStorage.setItem(STRAT_KEY, name); } catch { /* ignore */ }
    setActive(name);
    toast.success(`${name} is now your active strategy`);
  };

  const removeCustom = (s: CustomStrategy) => {
    deleteCustomStrategy(s.id);
    if (active === s.name) {
      try { localStorage.removeItem(STRAT_KEY); } catch { /* ignore */ }
      setActive(null);
    }
    refreshCustoms();
    toast.success(`${s.name} deleted`);
  };

  const list = useMemo(() => [...customs, ...allStrategies().filter((s) => !(s as CustomStrategy).custom)], [customs]);
  const filtered = list.filter((s) => s.name.toLowerCase().includes(q.toLowerCase()));

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
            onClick={() => { setEditing(null); setBuilderOpen(true); }}
            className="flex items-center gap-1.5 rounded-xl border border-primary/40 bg-primary/10 px-4 py-2 text-sm font-semibold text-primary hover:bg-primary/20"
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
            className="w-full h-10 rounded-xl border border-border/60 bg-card pl-9 pr-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:border-primary/40"
          />
        </div>
        {["All Assets", "All Styles", "All Levels", "Name A-Z"].map((label) => (
          <button key={label} className="flex items-center gap-2 h-10 rounded-xl border border-border/60 bg-card px-3 text-sm text-muted-foreground min-w-[140px] justify-between">
            {label} <ChevronDown className="h-3.5 w-3.5" />
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filtered.map((s) => {
          const StyleIcon = styleIcon[s.style];
          const isActive = active === s.name;
          const isCustom = (s as CustomStrategy).custom === true;
          return (
            <div
              key={isCustom ? (s as CustomStrategy).id : s.name}
              className={`rounded-xl border bg-card p-5 flex flex-col gap-3 transition-colors ${
                isActive ? "border-primary/60 ring-1 ring-primary/30" : "border-border/60 hover:border-primary/40"
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <h3 className="font-semibold text-base flex items-center gap-2 min-w-0">
                  <span className="truncate">{s.name}</span>
                  {isActive && <CheckCircle2 className="h-3.5 w-3.5 text-primary shrink-0" />}
                  {isCustom && (
                    <span className="inline-flex items-center gap-1 rounded border border-primary/30 bg-primary/10 px-1.5 py-0.5 text-[9px] font-semibold text-primary tracking-tight shrink-0">
                      <Sparkles className="h-2.5 w-2.5" /> Custom
                    </span>
                  )}
                </h3>
                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded border shrink-0 ${levelColor[s.level]}`}>
                  {s.level}
                </span>
              </div>

              <div className="flex flex-wrap gap-1.5">
                <span className="inline-flex items-center gap-1 rounded border border-border/60 bg-background px-2 py-0.5 text-[11px] text-muted-foreground">
                  <StyleIcon className="h-3 w-3" /> {s.style}
                </span>
                {s.markets.map((m) => (
                  <span key={m} className="inline-flex rounded border border-border/60 bg-background px-2 py-0.5 text-[11px] text-muted-foreground">{m}</span>
                ))}
              </div>
              <p className="text-sm text-muted-foreground leading-relaxed line-clamp-4">{s.description}</p>
              <div className="flex items-center gap-5 text-xs pt-2 border-t border-border/50">
                <div className="flex items-center gap-1.5">
                  <BarChart2 className="h-3.5 w-3.5 text-bull" />
                  <span className="font-mono font-semibold text-bull">{showStats ? `${s.winRate}%` : "--"}</span>
                  <span className="text-muted-foreground">Win Rate</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <TrendingUp className="h-3.5 w-3.5 text-primary" />
                  <span className="font-mono font-semibold text-primary">{s.rr}R</span>
                  <span className="text-muted-foreground">Avg R:R</span>
                </div>
              </div>

              <div className="flex items-center gap-2 pt-1 mt-auto">
                <button
                  type="button"
                  onClick={() => { if (!isActive) select(s.name); }}
                  disabled={isActive}
                  className={`flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-sm font-semibold transition ${
                    isActive
                      ? "bg-primary/15 text-primary border border-primary/40 cursor-default"
                      : "bg-primary text-primary-foreground hover:opacity-90"
                  }`}
                >
                  {isActive ? (<><CheckCircle2 className="h-4 w-4" /> Selected</>) : "Select strategy"}
                </button>
                <Link
                  to="/strategies/$strategyId"
                  params={{ strategyId: s.slug }}
                  className="rounded-xl border border-border/60 bg-background px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground hover:border-primary/40"
                >
                  Details
                </Link>
                {isCustom && (
                  <>
                    <button
                      type="button"
                      onClick={() => { setEditing(s as CustomStrategy); setBuilderOpen(true); }}
                      className="h-9 w-9 rounded-xl border border-border/60 bg-card text-muted-foreground hover:text-foreground hover:bg-accent/40 flex items-center justify-center shrink-0"
                      aria-label="Edit custom strategy"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => { if (confirm(`Delete "${s.name}"?`)) removeCustom(s as CustomStrategy); }}
                      className="h-9 w-9 rounded-xl border border-destructive/30 bg-card text-destructive hover:bg-destructive/10 flex items-center justify-center shrink-0"
                      aria-label="Delete custom strategy"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {builderOpen && (
        <StrategyBuilderModal
          editing={editing}
          onClose={() => { setBuilderOpen(false); setEditing(null); navigate({ to: "/strategies", search: {} }); }}
          onSaved={(s) => {
            refreshCustoms();
            setBuilderOpen(false);
            setEditing(null);
            navigate({ to: "/strategies", search: {} });
            toast.success(`${s.name} saved`);
          }}
        />
      )}
    </div>
  );
}

function StrategyBuilderModal({
  editing,
  onClose,
  onSaved,
}: {
  editing: CustomStrategy | null;
  onClose: () => void;
  onSaved: (s: CustomStrategy) => void;
}) {
  const [name, setName] = useState(editing?.name ?? "");
  const [level, setLevel] = useState<Level>(editing?.level ?? "Intermediate");
  const [style, setStyle] = useState<Style>(editing?.style ?? "Day");
  const [markets, setMarkets] = useState<string[]>(editing?.markets ?? ["Forex"]);
  const [description, setDescription] = useState(editing?.description ?? "");
  const [rules, setRules] = useState(editing?.rules ?? "");
  const [winRate, setWinRate] = useState<string>(editing ? String(editing.winRate) : "55");
  const [rr, setRr] = useState<string>(editing ? String(editing.rr) : "2");

  const toggleMarket = (m: string) => {
    setMarkets((prev) => (prev.includes(m) ? prev.filter((x) => x !== m) : [...prev, m]));
  };

  const canSave = name.trim().length > 0 && description.trim().length > 0 && markets.length > 0;

  const submit = () => {
    if (!canSave) return;
    const saved = saveCustomStrategy({
      id: editing?.id,
      name: name.trim(),
      slug: editing?.slug ?? name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, ""),
      level,
      style,
      markets,
      description: description.trim(),
      rules: rules.trim(),
      winRate: Math.max(0, Math.min(100, Number(winRate) || 0)),
      rr: Math.max(0, Number(rr) || 0),
    });
    onSaved(saved);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[90] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-background/80 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full sm:max-w-2xl max-h-[95vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl border border-border/60 bg-card shadow-2xl"
      >
        <div className="flex items-center justify-between p-5 border-b border-border/60">
          <div>
            <div className="text-[11px] tracking-[0.2em] text-muted-foreground">{editing ? "Edit strategy" : "Build a strategy"}</div>
            <h2 className="font-display text-xl font-semibold">Your playbook</h2>
          </div>
          <button onClick={onClose} aria-label="Close" className="h-8 w-8 rounded-xl text-muted-foreground hover:text-foreground hover:bg-accent/40 flex items-center justify-center">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <BuilderField label="Name">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. London Reversal"
              className="w-full rounded-xl border border-border/60 bg-background px-3 py-2 text-sm focus:outline-none focus:border-primary/50"
            />
          </BuilderField>

          <div className="grid grid-cols-2 gap-3">
            <BuilderField label="Level">
              <select value={level} onChange={(e) => setLevel(e.target.value as Level)} className="w-full rounded-xl border border-border/60 bg-background px-3 py-2 text-sm">
                {LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
              </select>
            </BuilderField>
            <BuilderField label="Style">
              <select value={style} onChange={(e) => setStyle(e.target.value as Style)} className="w-full rounded-xl border border-border/60 bg-background px-3 py-2 text-sm">
                {STYLES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </BuilderField>
          </div>

          <BuilderField label="Markets">
            <div className="flex flex-wrap gap-1.5">
              {MARKETS.map((m) => {
                const on = markets.includes(m);
                return (
                  <button
                    key={m}
                    type="button"
                    onClick={() => toggleMarket(m)}
                    className={`rounded border px-2.5 py-1 text-xs transition ${
                      on
                        ? "border-primary/50 bg-primary/15 text-primary"
                        : "border-border/60 bg-background text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {m}
                  </button>
                );
              })}
            </div>
          </BuilderField>

          <BuilderField label="Description">
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="One-paragraph summary of the setup and edge."
              className="w-full rounded-xl border border-border/60 bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:border-primary/50"
            />
          </BuilderField>

          <BuilderField label="Rules (entry, stop, target, sessions, filters)">
            <textarea
              value={rules}
              onChange={(e) => setRules(e.target.value)}
              rows={6}
              placeholder={`Entry: ...\nStop: ...\nTake profit: ...\nSessions: ...\nFilters: ...`}
              className="w-full rounded-xl border border-border/60 bg-background px-3 py-2 text-sm font-mono resize-none focus:outline-none focus:border-primary/50"
            />
          </BuilderField>

          <div className="grid grid-cols-2 gap-3">
            <BuilderField label="Baseline win rate (%)">
              <input inputMode="decimal" value={winRate} onChange={(e) => setWinRate(e.target.value)} className="w-full rounded-xl border border-border/60 bg-background px-3 py-2 text-sm" />
            </BuilderField>
            <BuilderField label="Baseline R:R">
              <input inputMode="decimal" value={rr} onChange={(e) => setRr(e.target.value)} className="w-full rounded-xl border border-border/60 bg-background px-3 py-2 text-sm" />
            </BuilderField>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 p-5 border-t border-border/60">
          <button onClick={onClose} className="rounded-xl px-3 py-2 text-sm text-muted-foreground hover:text-foreground">Cancel</button>
          <button
            disabled={!canSave}
            onClick={submit}
            className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {editing ? "Save changes" : "Save strategy"}
          </button>
        </div>
      </div>
    </div>
  );
}

function BuilderField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="text-[10px] tracking-[0.2em] text-muted-foreground mb-1.5">{label}</div>
      {children}
    </label>
  );
}
