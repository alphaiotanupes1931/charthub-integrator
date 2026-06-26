import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/PageHeader";
import { BookOpen, Crosshair, NotebookPen, Brain, Library, Users, Activity, MessageSquare, PlayCircle } from "lucide-react";
import { restartTutorial } from "@/components/Tutorial";

export const Route = createFileRoute("/_app/guide")({
  head: () => ({ meta: [{ title: "Guide, TradeMind" }] }),
  component: GuidePage,
});

const STEPS = [
  { icon: Crosshair,     title: "Run a scan",            body: "Pick an instrument on the Dashboard and run a scan. TradeMind grades the current setup against your chosen strategy." },
  { icon: MessageSquare, title: "Talk to your coach",    body: "The floating bubble (bottom-right) opens an AI Coach that reads your live chart and journal. Toggle the speaker icon to hear answers aloud." },
  { icon: NotebookPen,   title: "Log every trade",       body: "Use the Trade Journal to record entries, exits, P&L and notes. We grade execution and behavior, not just luck." },
  { icon: Library,       title: "Pick a strategy",       body: "Tap any card in the Strategy Library to expand the full breakdown and set it as your active playbook." },
  { icon: Users,         title: "Choose your coach",     body: "Three coach personalities, each with a distinct voice. Preview the voice on the AI Coaches page." },
  { icon: Activity,      title: "Trade from the chart",  body: "Connect your TradeLocker broker in Settings - the Dashboard then lets you open a docked trading floor next to TradeMind so you can execute without leaving the app." },
  { icon: Brain,         title: "Build your memory",     body: "Correct the AI when it's wrong. Those corrections live in Trading Memory and shape every future reply." },
];

function GuidePage() {
  return (
    <div className="p-4 md:p-8 max-w-[1100px] mx-auto">
      <PageHeader
        title="Guide"
        icon={<BookOpen className="h-8 w-8 text-primary" />}
        description="How TradeMind works, end to end."
        action={
          <button
            onClick={restartTutorial}
            className="inline-flex items-center gap-1.5 rounded-md border border-primary/40 bg-primary/10 px-4 py-2 text-sm font-semibold text-primary hover:bg-primary/20"
          >
            <PlayCircle className="h-4 w-4" /> Replay tour
          </button>
        }
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
