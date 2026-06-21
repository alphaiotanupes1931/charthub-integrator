import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/PageHeader";
import { Bot, BarChart2, Target, GraduationCap, CheckCircle2, Volume2, Sparkles } from "lucide-react";

export const Route = createFileRoute("/_app/coaches")({
  head: () => ({ meta: [{ title: "AI Coaches — TradeMind" }] }),
  component: CoachesPage,
});

const COACHES = [
  {
    name: "The Analyst",
    subtitle: "Data-Driven Performance Optimizer",
    icon: BarChart2,
    iconBg: "bg-blue-500/20 text-blue-300",
    description:
      "Numbers don't lie. The Analyst breaks down your trading performance with surgical precision — win rates, R:R ratios, edge statistics, and pattern recognition across your data.",
    tone: "Precise & Analytical",
    strengths: ["Statistical analysis", "Pattern recognition", "Performance metrics", "Edge calculation"],
    bestFor: "Data-oriented traders who want to optimize performance through numbers and statistics",
  },
  {
    name: "The Disciplinarian",
    subtitle: "Rule Enforcer & Accountability Partner",
    icon: Target,
    iconBg: "bg-rose-500/20 text-rose-300",
    description:
      "No excuses, no shortcuts. The Disciplinarian holds you to your trading plan with zero tolerance for rule-breaking. Every deviation is tracked, every excuse challenged.",
    tone: "Strict & Direct",
    strengths: ["Rule enforcement", "Accountability tracking", "Breaking bad habits", "Building discipline routines"],
    bestFor: "Traders who struggle with discipline, revenge trading, or breaking their own rules",
  },
  {
    name: "The Mentor",
    subtitle: "Experienced Guide & Strategy Teacher",
    icon: GraduationCap,
    iconBg: "bg-purple-500/20 text-purple-300",
    description:
      "A patient, seasoned trader who's been through it all. The Mentor shares wisdom from decades of market experience, guiding you through concepts with real-world context.",
    tone: "Warm & Patient",
    strengths: ["Teaching through experience", "Building confidence", "Strategy development", "Long-term growth mindset"],
    bestFor: "Newer traders or those wanting a supportive, wisdom-driven coaching experience",
  },
];

function CoachesPage() {
  return (
    <div className="p-8 max-w-[1400px] mx-auto">
      <PageHeader
        title="AI Coach Library"
        description={
          <>
            Pick the coaching personality that matches how you want to be coached. Your choice shapes the <span className="text-foreground font-semibold">tone, framing, and style</span> of every AI response on the Dashboard chat. The same personality also drives the voice on the <span className="text-foreground font-semibold">Voice Coach</span> page when you talk to TradeMind out loud.
          </>
        }
      />

      {/* Active Generic coach banner */}
      <div className="rounded-xl border-2 border-primary/60 bg-primary/[0.03] p-6 mb-8">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="h-11 w-11 rounded-lg bg-muted flex items-center justify-center">
              <Bot className="h-6 w-6 text-muted-foreground" />
            </div>
            <div>
              <h3 className="font-display text-2xl font-semibold">Generic AI Coach</h3>
              <p className="text-sm text-muted-foreground">Standard Trading Assistant</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Free</span>
            <span className="inline-flex items-center gap-1 rounded border border-primary/40 bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
              <CheckCircle2 className="h-3 w-3" /> Active
            </span>
          </div>
        </div>
        <p className="text-sm text-muted-foreground mb-4">
          Basic AI coaching without a specialized personality. Available to all users.
        </p>
        <div className="rounded-md border border-primary/30 bg-primary/5 px-4 py-2 text-sm flex items-center gap-2 text-primary/90">
          <CheckCircle2 className="h-4 w-4" /> Currently Active
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {COACHES.map((c) => {
          const Icon = c.icon;
          return (
            <div key={c.name} className="rounded-xl border border-border bg-card p-5 space-y-4 flex flex-col">
              <div className="flex items-center gap-3">
                <div className={`h-12 w-12 rounded-lg flex items-center justify-center ${c.iconBg}`}>
                  <Icon className="h-6 w-6" />
                </div>
                <div>
                  <h3 className="font-display text-xl font-semibold">{c.name}</h3>
                  <p className="text-xs text-muted-foreground">{c.subtitle}</p>
                </div>
              </div>
              <p className="text-sm text-muted-foreground leading-relaxed flex-1">{c.description}</p>
              <div className="flex items-center gap-2 text-xs">
                <Volume2 className="h-3.5 w-3.5 text-muted-foreground" /> <span className="text-muted-foreground">Tone:</span>
                <span className="rounded border border-border bg-background px-2 py-0.5 text-foreground">{c.tone}</span>
              </div>
              <div>
                <div className="flex items-center gap-1.5 text-xs mb-2">
                  <Sparkles className="h-3.5 w-3.5 text-primary" /> <span className="font-semibold">Strengths</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {c.strengths.map((s) => (
                    <span key={s} className="rounded border border-border bg-background px-2 py-0.5 text-[11px]">{s}</span>
                  ))}
                </div>
              </div>
              <div className="rounded-md border border-border bg-background/50 p-3 text-xs">
                <span className="font-semibold">Best for: </span>
                <span className="text-muted-foreground">{c.bestFor}</span>
              </div>
              <button className="w-full rounded-md bg-primary py-2 text-sm font-semibold text-primary-foreground hover:opacity-90">
                Select Coach
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
