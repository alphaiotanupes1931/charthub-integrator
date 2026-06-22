import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/PageHeader";
import { Brain, Activity, Plus, TrendingUp, TrendingDown, Sparkles } from "lucide-react";

export const Route = createFileRoute("/_app/memory")({
  head: () => ({ meta: [{ title: "Trading Memory, TradeMind" }] }),
  component: MemoryPage,
});

function MemoryPage() {
  return (
    <div className="p-4 md:p-8 max-w-[1400px] mx-auto">
      <PageHeader
        title="My Trading Memory"
        icon={<Brain className="h-9 w-9 text-primary" />}
        description="The AI remembers every win, every loss, and every time it was right or wrong about a setup, so its next read of the chart is sharper than the last."
        action={
          <button className="flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">
            <Activity className="h-4 w-4" /> Log Outcome
          </button>
        }
      />

      <div className="rounded-xl border border-border bg-card p-6 mb-6">
        <h2 className="flex items-center gap-2 font-semibold mb-2">
          <Brain className="h-4 w-4 text-primary" /> What the AI has learned about you
        </h2>
        <p className="text-xs text-muted-foreground mb-4">
          Corrections you've given the AI in chat. Injected into every system prompt so the AI doesn't repeat the same mistake.
        </p>
        <p className="text-sm text-primary/80 italic mb-4">
          No corrections yet. Tell the AI when it's wrong (e.g. "my broker is OANDA, not IC Markets") and TradeMind will remember.
        </p>
        <button className="flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm text-muted-foreground hover:text-foreground">
          <Plus className="h-4 w-4" /> Add a correction manually
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <StatCard
          icon={<TrendingUp className="h-4 w-4 text-emerald-400" />}
          label="Wins logged"
          value="0"
          hint="Trades that closed in profit"
        />
        <StatCard
          icon={<TrendingDown className="h-4 w-4 text-destructive" />}
          label="Losses logged"
          value="0"
          hint="Trades that closed at a loss"
        />
        <StatCard
          icon={<Sparkles className="h-4 w-4 text-primary" />}
          label="AI accuracy"
          value="—"
          hint="How often the AI's grade matched the outcome"
        />
      </div>

      <div className="rounded-xl border border-border bg-card p-6">
        <h2 className="flex items-center gap-2 font-semibold mb-2">
          <Sparkles className="h-4 w-4 text-primary" /> AI calls, scored against reality
        </h2>
        <p className="text-xs text-muted-foreground mb-4">
          Every time you mark a trade a win or a loss, TradeMind cross-references the AI's original grade. Patterns the AI gets right get reinforced; patterns it gets wrong get down-weighted in future reads.
        </p>
        <p className="text-sm text-muted-foreground italic">
          No AI calls scored yet. Log a trade outcome from the journal to start building the feedback loop.
        </p>
      </div>
    </div>
  );
}

function StatCard({ icon, label, value, hint }: { icon: React.ReactNode; label: string; value: string; hint: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className="font-display text-4xl mt-3">{value}</div>
      <div className="text-xs text-muted-foreground mt-2">{hint}</div>
    </div>
  );
}
