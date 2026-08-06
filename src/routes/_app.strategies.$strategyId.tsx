import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { findStrategyBySlug, deleteCustomStrategy, type CustomStrategy } from "@/lib/customStrategies";
import { type Strategy } from "@/data/strategies";
import { ArrowLeft, CheckCircle2, CircleDot, Pencil, Trash2, TrendingUp, Zap, BarChart2, BookOpen, ShieldAlert, Target, Clock, Layers } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/strategies/$strategyId")({
  head: () => ({ meta: [{ title: "Strategy Details | TradeMind" }] }),
  component: StrategyDetailPage,
});

const levelColor = {
  Beginner: "bg-bull/15 text-bull border-bull/30",
  Intermediate: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  Advanced: "bg-rose-500/15 text-rose-400 border-rose-500/30",
} as const;

const styleIcon = { Day: CircleDot, Swing: TrendingUp, Scalp: Zap } as const;

const STRAT_KEY = "trademind.activeStrategy";

const SECTION_ICON: Record<string, React.ReactNode> = {
  Setup: <Layers className="h-4 w-4" />,
  Bias: <BookOpen className="h-4 w-4" />,
  Entry: <Target className="h-4 w-4" />,
  "Stop & Targets": <ShieldAlert className="h-4 w-4" />,
  "Stop & Exit": <ShieldAlert className="h-4 w-4" />,
  Risk: <BarChart2 className="h-4 w-4" />,
  Sessions: <Clock className="h-4 w-4" />,
  Invalidations: <ShieldAlert className="h-4 w-4" />,
  "System 1 (Short term)": <Layers className="h-4 w-4" />,
  "System 2 (Long term)": <Layers className="h-4 w-4" />,
  "Position Sizing": <BarChart2 className="h-4 w-4" />,
};

function StrategyDetailPage() {
  const { strategyId } = Route.useParams();
  const navigate = useNavigate();
  const [strategy, setStrategy] = useState<Strategy | CustomStrategy | null>(null);
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    try { setActive(localStorage.getItem(STRAT_KEY)); } catch { /* ignore */ }
    setStrategy(findStrategyBySlug(strategyId));
  }, [strategyId]);

  if (!strategy) {
    return (
      <div className="p-4 md:p-8 max-w-[1200px] mx-auto">
        <PageHeader title="Strategy not found" description="That strategy doesn't exist in the library." />
        <Link to="/strategies" search={{ edit: undefined }} className="inline-flex items-center gap-2 text-sm text-primary hover:underline mt-4">
          <ArrowLeft className="h-4 w-4" /> Back to library
        </Link>
      </div>
    );
  }

  const isCustom = (strategy as CustomStrategy).custom === true;
  const custom = isCustom ? (strategy as CustomStrategy) : null;
  const StyleIcon = styleIcon[strategy.style];
  const isActive = active === strategy.name;

  const select = () => {
    try { localStorage.setItem(STRAT_KEY, strategy.name); } catch { /* ignore */ }
    setActive(strategy.name);
    toast.success(`${strategy.name} is now your active strategy`);
  };

  const remove = () => {
    if (!custom) return;
    if (!confirm(`Delete "${custom.name}"?`)) return;
    deleteCustomStrategy(custom.id);
    if (active === custom.name) {
      try { localStorage.removeItem(STRAT_KEY); } catch { /* ignore */ }
    }
    toast.success(`${custom.name} deleted`);
    navigate({ to: "/strategies", search: { edit: undefined } });
  };

  const playbook = strategy.playbook ?? [];

  return (
    <div className="p-4 md:p-8 max-w-[1200px] mx-auto">
      <Link to="/strategies" search={{ edit: undefined }} className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-4">
        <ArrowLeft className="h-4 w-4" /> Back to library
      </Link>

      <PageHeader
        title={strategy.name}
        description={strategy.description}
        action={
          <div className="flex items-center gap-2">
            {custom && (
              <>
                <Link
                  to="/strategies"
                  search={{ edit: custom.id }}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-accent/40"
                >
                  <Pencil className="h-4 w-4" /> Edit
                </Link>
                <button
                  onClick={remove}
                  className="inline-flex items-center gap-1.5 rounded-md border border-destructive/30 px-3 py-2 text-sm text-destructive hover:bg-destructive/10"
                >
                  <Trash2 className="h-4 w-4" /> Delete
                </button>
              </>
            )}
            <button
              onClick={select}
              disabled={isActive}
              className={`inline-flex items-center gap-1.5 rounded-md px-4 py-2 text-sm font-semibold ${
                isActive ? "bg-primary/10 text-primary cursor-default" : "bg-primary text-primary-foreground hover:opacity-90"
              }`}
            >
              {isActive ? <><CheckCircle2 className="h-4 w-4" /> Active</> : "Use this Strategy"}
            </button>
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-2 mb-6">
        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded border ${levelColor[strategy.level]}`}>
          {strategy.level}
        </span>
        <span className="inline-flex items-center gap-1 rounded border border-border bg-card px-2 py-0.5 text-[11px] text-muted-foreground">
          <StyleIcon className="h-3 w-3" /> {strategy.style}
        </span>
        {strategy.markets.map((m) => (
          <span key={m} className="inline-flex rounded border border-border bg-card px-2 py-0.5 text-[11px] text-muted-foreground">
            {m}
          </span>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-6">
        <div className="space-y-6">
          <section className="rounded-xl border border-border bg-card p-6">
            <h2 className="text-lg font-semibold mb-3">How it works</h2>
            <div className="space-y-4 text-sm text-muted-foreground leading-relaxed">
              {(strategy.longDescription ?? strategy.description)
                .split(/\n{2,}/)
                .map((para, i) => (
                  <p key={i}>{para}</p>
                ))}
            </div>
          </section>

          {(strategy as CustomStrategy).custom && (strategy as CustomStrategy).rules && (
            <section className="rounded-xl border border-border bg-card p-6">
              <h2 className="text-lg font-semibold mb-3">Custom rules</h2>
              <pre className="whitespace-pre-wrap text-sm text-muted-foreground bg-background/50 border border-border rounded-lg p-4 font-mono leading-relaxed">
                {(strategy as CustomStrategy).rules}
              </pre>
            </section>
          )}

          {playbook.length > 0 && (
            <section>
              <h2 className="text-lg font-semibold mb-4">Complete playbook & rules</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {playbook.map((section) => (
                  <div key={section.title} className="rounded-xl border border-border bg-card p-5">
                    <div className="flex items-center gap-2 mb-3">
                      <span className="text-primary">{SECTION_ICON[section.title] ?? <BookOpen className="h-4 w-4" />}</span>
                      <h3 className="text-sm font-semibold">{section.title}</h3>
                    </div>
                    <ul className="space-y-2">
                      {section.items.map((item, i) => (
                        <li key={i} className="text-sm text-muted-foreground leading-relaxed flex gap-2">
                          <span className="text-primary mt-1 shrink-0">-</span>
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>

        <aside className="space-y-4">
          <div className="rounded-xl border border-border bg-card p-5">
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1">Win Rate</div>
            <div className="font-mono text-3xl font-semibold text-bull">{strategy.winRate}%</div>
          </div>
          <div className="rounded-xl border border-border bg-card p-5">
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1">Average R:R</div>
            <div className="font-mono text-3xl font-semibold text-primary">{strategy.rr}R</div>
          </div>
          <div className="rounded-xl border border-border bg-card p-5">
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-3">Best markets</div>
            <div className="flex flex-wrap gap-1.5">
              {strategy.markets.map((m) => (
                <span key={m} className="inline-flex rounded border border-border bg-background px-2 py-1 text-xs text-muted-foreground">
                  {m}
                </span>
              ))}
            </div>
          </div>
          <div className="rounded-xl border border-border bg-card p-5">
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-3">Style</div>
            <div className="text-sm text-foreground flex items-center gap-2">
              <StyleIcon className="h-4 w-4 text-primary" /> {strategy.style} trading
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
