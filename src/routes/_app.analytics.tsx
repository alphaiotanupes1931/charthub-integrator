import { createFileRoute, Link } from "@tanstack/react-router";
import { PageHeader } from "@/components/PageHeader";
import { BarChart3, Bot, MessageSquare } from "lucide-react";

export const Route = createFileRoute("/_app/analytics")({
  head: () => ({ meta: [{ title: "Analytics — TradeMind" }] }),
  component: AnalyticsPage,
});

const QUESTIONS = [
  "What's my biggest weakness?",
  "Which instrument am I most profitable on?",
  "How can I improve my win rate?",
  "What's my best trading pattern?",
];

function AnalyticsPage() {
  return (
    <div className="p-4 md:p-8 max-w-[1400px] mx-auto">
      <PageHeader title="Analytics" description="Your trading performance at a glance" />

      <div className="rounded-xl border border-border bg-card p-12 mb-6 text-center space-y-4">
        <BarChart3 className="h-10 w-10 mx-auto text-muted-foreground" />
        <h3 className="text-lg font-semibold">No data yet</h3>
        <p className="text-sm text-muted-foreground max-w-md mx-auto">
          Log your first trade in the journal to start seeing performance analytics, win rates, and AI-driven insights here.
        </p>
        <Link to="/journal" className="inline-flex rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">
          Go to Journal
        </Link>
      </div>

      <div className="rounded-xl border border-border bg-card p-6">
        <h2 className="flex items-center gap-2 text-lg font-semibold mb-6">
          <MessageSquare className="h-5 w-5" /> Ask AI About Your Performance
        </h2>
        <div className="text-center space-y-4 py-6">
          <Bot className="h-10 w-10 mx-auto text-muted-foreground" />
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            Ask questions about your trading performance and I'll analyze your data.
          </p>
          <div className="flex flex-wrap justify-center gap-2 pt-2">
            {QUESTIONS.map((q) => (
              <button key={q} className="rounded-md border border-primary/30 bg-primary/5 px-3 py-1.5 text-xs text-primary hover:bg-primary/10">
                {q}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
