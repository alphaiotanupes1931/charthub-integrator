import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/PageHeader";
import { BookOpen, Crosshair, NotebookPen, Brain, Mic } from "lucide-react";

export const Route = createFileRoute("/_app/guide")({
  head: () => ({ meta: [{ title: "Guide, TradeMind" }] }),
  component: GuidePage,
});

const STEPS = [
  {
    icon: Crosshair,
    title: "Run a scan",
    body: "Pick an instrument on the Dashboard and run a scan. TradeMind grades the current setup against your chosen strategy.",
  },
  {
    icon: NotebookPen,
    title: "Log every trade",
    body: "Use the Trade Journal to record entries, exits, and P&L. We score execution and behavior, not just whether you got lucky.",
  },
  {
    icon: Brain,
    title: "Train your AI memory",
    body: "Correct the AI when it's wrong. Those corrections are saved and injected into every future response.",
  },
  {
    icon: Mic,
    title: "Talk it out",
    body: "Use Voice Coach to think out loud before pulling the trigger. Same coaching personality, audio side.",
  },
];

function GuidePage() {
  return (
    <div className="p-4 md:p-8 max-w-[1100px] mx-auto">
      <PageHeader
        title="Guide"
        icon={<BookOpen className="h-8 w-8 text-primary" />}
        description="How TradeMind works, end to end. Four steps to a measurable trading edge."
      />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {STEPS.map(({ icon: Icon, title, body }, i) => (
          <div key={title} className="rounded-xl border border-border bg-card p-5">
            <div className="flex items-center gap-3 mb-3">
              <div className="h-9 w-9 rounded-lg bg-primary/10 border border-primary/30 flex items-center justify-center">
                <Icon className="h-4 w-4 text-primary" />
              </div>
              <div className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">Step {i + 1}</div>
            </div>
            <h3 className="font-semibold mb-1">{title}</h3>
            <p className="text-sm text-muted-foreground leading-relaxed">{body}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
