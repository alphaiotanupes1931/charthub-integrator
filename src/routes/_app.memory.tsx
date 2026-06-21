import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/PageHeader";
import { Brain, Activity, Plus, Lightbulb, AlertTriangle, BookOpen, ArrowRight } from "lucide-react";

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
        description={
          <>
            Your AI coach remembers every lesson, pattern, and session to give you smarter guidance.
            <div className="mt-3">
              <button className="rounded-md border border-border bg-card px-3 py-1.5 text-xs">View Analytics →</button>
            </div>
          </>
        }
        action={
          <button className="flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">
            <Activity className="h-4 w-4" /> Log Session
          </button>
        }
      />

      <div className="rounded-xl border border-border bg-card p-6 mb-6">
        <h2 className="flex items-center gap-2 font-semibold mb-2">
          <Brain className="h-4 w-4 text-primary" /> What the AI has learned about you
        </h2>
        <p className="text-xs text-muted-foreground mb-4">
          These are corrections you've given the AI in chat. They're injected into every system prompt so the AI won't repeat the same mistake. Pause or delete any that no longer apply.
        </p>
        <p className="text-sm text-primary/80 italic mb-4">
          No corrections yet. When you tell the AI it's wrong (e.g. "actually, my broker is OANDA"), TradeMind saves the correction here and stops repeating the mistake.
        </p>
        <button className="flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm text-muted-foreground hover:text-foreground">
          <Plus className="h-4 w-4" /> Add a correction manually
        </button>
      </div>

      <div className="rounded-xl border border-primary/30 bg-primary/[0.03] p-6 mb-6">
        <h2 className="flex items-center gap-2 font-semibold mb-4">
          <Lightbulb className="h-4 w-4 text-primary" /> AI Recommendations
        </h2>
        <div className="rounded-md border border-border bg-card p-4">
          <div className="text-sm font-semibold mb-1">Today's Recommendation</div>
          <p className="text-sm text-muted-foreground">
            Start logging your sessions and lessons, TradeMind AI gets smarter with every entry.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="rounded-xl border border-border bg-card p-5">
          <h3 className="flex items-center gap-2 font-semibold mb-2">
            <AlertTriangle className="h-4 w-4 text-amber-400" /> Pattern Summary
          </h3>
          <p className="text-sm text-muted-foreground mb-4">
            No patterns logged yet. Patterns surface once you've logged a few lessons, repeat behaviors get tagged and tracked here.
          </p>
          <button className="flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-xs">
            Log a lesson <ArrowRight className="h-3 w-3" />
          </button>
        </div>
        <div className="rounded-xl border border-border bg-card p-5">
          <h3 className="flex items-center gap-2 font-semibold mb-2">
            <BookOpen className="h-4 w-4 text-primary" /> Recent Lessons (0)
          </h3>
          <p className="text-sm text-muted-foreground mb-4">
            No lessons logged yet. Lessons capture what you learned from a trade, wins, losses, and the rules you broke. They feed the pattern tracker above.
          </p>
          <button className="flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-xs">
            Open the journal <ArrowRight className="h-3 w-3" />
          </button>
        </div>
      </div>
    </div>
  );
}
