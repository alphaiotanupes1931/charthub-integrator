import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { X, MessageCircle, LineChart, BookOpen, FlaskConical, Send, ArrowRight, ArrowLeft } from "lucide-react";
import { startFirstWeek, emitFirstWeekEvent } from "@/hooks/useFirstWeek";
import { shouldShowTour, markTourSeen } from "@/lib/tourFlag";

const KEY = "trademind.tour.v1.done";

type Step = {
  title: string;
  body: string;
  icon: React.ComponentType<{ className?: string }>;
  cta: { to: string; label: string };
};

const STEPS: Step[] = [
  {
    title: "Welcome to TradeMind",
    body: "A quick 60-second tour of the parts you'll use most. You can close this at any time and reopen it from Settings.",
    icon: LineChart,
    cta: { to: "/dashboard", label: "Go to Dashboard" },
  },
  {
    title: "Ask the Chat coach",
    body: "The Chat tab is where you ask questions in plain English. It reads the chart, explains setups, and shows entries, stops, and targets with a grade.",
    icon: MessageCircle,
    cta: { to: "/dashboard", label: "Open Chat" },
  },
  {
    title: "Trade Journal",
    body: "Log every trade with your mental state. The journal auto-fills entries from scans and tracks P&L so you can see what's working.",
    icon: BookOpen,
    cta: { to: "/journal", label: "Open Journal" },
  },
  {
    title: "Auto Trading",
    body: "Connect your broker, then switch Auto Trading on from the home page. Every qualifying setup asks you first, and the trade is managed after it fills.",
    icon: FlaskConical,
    cta: { to: "/broker", label: "Connect broker" },
  },
  {
    title: "Discord notifications",
    body: "Get morning and evening briefings, A/A+ signals, and price alerts sent to Discord. Setup takes 2 minutes.",
    icon: Send,
    cta: { to: "/discord", label: "Set up Discord" },
  },
];

export function OnboardingTour() {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (typeof window === "undefined") return;
    let cancelled = false;
    if (window.location.pathname === "/dashboard") {
      void shouldShowTour([KEY]).then((show) => {
        if (cancelled || !show) return;
        startFirstWeek();
        setOpen(true);
      });
    }
    const openHandler = () => { setStep(0); setOpen(true); };
    window.addEventListener("trademind:open-tour", openHandler);
    return () => {
      cancelled = true;
      window.removeEventListener("trademind:open-tour", openHandler);
    };
  }, []);

  function close() {
    setOpen(false);
    try { localStorage.setItem(KEY, "1"); } catch { /* noop */ }
    void markTourSeen();
    startFirstWeek();
    emitFirstWeekEvent("tour-done");
  }

  if (!open) return null;

  const s = STEPS[step];
  const Icon = s.icon;
  const last = step === STEPS.length - 1;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-background/80 backdrop-blur-sm px-4">
      <div className="w-full max-w-md rounded-2xl border border-border/60 bg-card shadow-2xl">
        <div className="flex items-start justify-between p-5 pb-3">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-2xl bg-primary/15 text-primary flex items-center justify-center">
              <Icon className="h-5 w-5" />
            </div>
            <div>
              <div className="text-[10px] tracking-tight font-semibold text-muted-foreground">
                Step {step + 1} of {STEPS.length}
              </div>
              <div className="font-display text-lg font-semibold">{s.title}</div>
            </div>
          </div>
          <button
            onClick={close}
            aria-label="Close tour"
            className="p-1.5 rounded-xl text-muted-foreground hover:text-foreground hover:bg-background/60"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-5 pb-4 text-sm text-muted-foreground leading-relaxed">
          {s.body}
        </div>

        <div className="px-5 pb-3">
          <div className="h-1 w-full rounded-full bg-background overflow-hidden">
            <div
              className="h-full bg-primary transition-all"
              style={{ width: `${((step + 1) / STEPS.length) * 100}%` }}
            />
          </div>
        </div>

        <div className="p-5 pt-3 flex items-center justify-between gap-2">
          <button
            onClick={() => setStep((n) => Math.max(0, n - 1))}
            disabled={step === 0}
            className="inline-flex items-center gap-1 px-3 py-2 rounded-xl text-xs font-medium border border-border/60 bg-card hover:border-primary/40 disabled:opacity-40"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Back
          </button>

          <div className="flex items-center gap-2">
            <Link
              to={s.cta.to}
              onClick={close}
              className="hidden sm:inline-flex items-center gap-1 px-3 py-2 rounded-xl text-xs font-medium border border-primary/40 text-primary hover:bg-primary/10"
            >
              {s.cta.label}
            </Link>
            {last ? (
              <button
                onClick={close}
                className="inline-flex items-center gap-1 px-4 py-2 rounded-xl text-sm font-semibold bg-primary text-primary-foreground hover:bg-primary/90"
              >
                Finish tour
              </button>
            ) : (
              <button
                onClick={() => setStep((n) => Math.min(STEPS.length - 1, n + 1))}
                className="inline-flex items-center gap-1 px-4 py-2 rounded-xl text-sm font-semibold bg-primary text-primary-foreground hover:bg-primary/90"
              >
                Next <ArrowRight className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>

        <button
          onClick={close}
          className="w-full py-2 text-[11px] text-muted-foreground hover:text-foreground border-t border-border/60"
        >
          Skip tour
        </button>
      </div>
    </div>
  );
}
