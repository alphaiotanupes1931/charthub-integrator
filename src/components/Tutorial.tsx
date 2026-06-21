import { useEffect, useState } from "react";
import { X, ArrowRight, ArrowLeft, Sparkles, LayoutDashboard, NotebookPen, Users, BarChart3 } from "lucide-react";

const STORAGE_KEY = "trademind.tutorial.completed";

type Step = {
  icon: typeof LayoutDashboard;
  title: string;
  body: string;
};

const STEPS: Step[] = [
  {
    icon: Sparkles,
    title: "Welcome to TradeMind",
    body: "Your AI trading copilot. Let's take 30 seconds to show you around so you can hit the ground running.",
  },
  {
    icon: LayoutDashboard,
    title: "Your Dashboard",
    body: "Pick any instrument, choose a timeframe, and hit Run scan to get an AI-graded breakdown of the current setup.",
  },
  {
    icon: NotebookPen,
    title: "Journal every trade",
    body: "Log entries, exits, and your thinking. TradeMind builds a memory of your edge and your leaks over time.",
  },
  {
    icon: Users,
    title: "Coaches when you need them",
    body: "Chat with specialised AI coaches, or use the Voice Coach for hands-free reviews mid-session.",
  },
  {
    icon: BarChart3,
    title: "You're all set",
    body: "Analytics and Trading Memory unlock as you trade. Anything is reachable from the left sidebar.",
  },
];

export function Tutorial() {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);

  useEffect(() => {
    try {
      if (!localStorage.getItem(STORAGE_KEY)) {
        // small delay so the app paints first
        const t = window.setTimeout(() => setOpen(true), 400);
        return () => window.clearTimeout(t);
      }
    } catch {
      // ignore
    }
  }, []);

  const close = (completed: boolean) => {
    try {
      localStorage.setItem(STORAGE_KEY, completed ? "completed" : "skipped");
    } catch {
      // ignore
    }
    setOpen(false);
  };

  if (!open) return null;

  const s = STEPS[step];
  const Icon = s.icon;
  const isLast = step === STEPS.length - 1;
  const isFirst = step === 0;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="tutorial-title"
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm animate-in fade-in"
    >
      <div className="relative w-full max-w-md rounded-2xl border border-border bg-card shadow-2xl animate-in zoom-in-95 duration-200">
        <button
          onClick={() => close(false)}
          aria-label="Skip tutorial"
          className="absolute right-3 top-3 h-8 w-8 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent/40 flex items-center justify-center transition"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="p-7 sm:p-8">
          <div className="flex items-center justify-center h-14 w-14 rounded-xl bg-primary/10 ring-1 ring-primary/30 mb-5">
            <Icon className="h-6 w-6 text-primary" />
          </div>

          <div className="text-[11px] font-medium uppercase tracking-[0.2em] text-muted-foreground mb-2">
            Step {step + 1} of {STEPS.length}
          </div>
          <h2 id="tutorial-title" className="font-display text-2xl font-semibold tracking-tight mb-2.5">
            {s.title}
          </h2>
          <p className="text-sm text-muted-foreground leading-relaxed">{s.body}</p>

          {/* Progress dots */}
          <div className="flex items-center gap-1.5 mt-6">
            {STEPS.map((_, i) => (
              <div
                key={i}
                className={`h-1 rounded-full transition-all ${
                  i === step ? "w-6 bg-primary" : i < step ? "w-3 bg-primary/40" : "w-3 bg-border"
                }`}
              />
            ))}
          </div>

          {/* Actions */}
          <div className="flex items-center justify-between gap-3 mt-7">
            <button
              onClick={() => close(false)}
              className="text-sm text-muted-foreground hover:text-foreground transition"
            >
              Skip
            </button>
            <div className="flex items-center gap-2">
              {!isFirst && (
                <button
                  onClick={() => setStep((s) => s - 1)}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-2 text-sm font-medium hover:border-primary/50 transition"
                >
                  <ArrowLeft className="h-3.5 w-3.5" />
                  Back
                </button>
              )}
              {isLast ? (
                <button
                  onClick={() => close(true)}
                  className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 transition"
                >
                  Get started
                </button>
              ) : (
                <button
                  onClick={() => setStep((s) => s + 1)}
                  className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 transition"
                >
                  Continue
                  <ArrowRight className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
