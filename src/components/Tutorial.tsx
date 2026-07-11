import { useEffect, useLayoutEffect, useState } from "react";
import {
  X, ArrowRight, ArrowLeft, Sparkles, LayoutDashboard, NotebookPen, Users,
  BarChart3, Library, Brain, Activity, MessageSquare, Volume2, Lightbulb,
} from "lucide-react";

const STORAGE_KEY = "trademind.tutorial.completed";

export function restartTutorial() {
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
  window.dispatchEvent(new CustomEvent("trademind:tutorial:open"));
}

type Step = {
  icon: typeof LayoutDashboard;
  title: string;
  body: string;
  /** CSS selector for the element to spotlight. Omit for an intro/outro card. */
  target?: string;
  /** Hint about which route to be on. Tour will navigate before showing. */
  route?: string;
};

const STEPS: Step[] = [
  {
    icon: Sparkles,
    title: "Welcome to TradeMind",
    body: "A 60-second guided tour of your AI trading copilot. We'll spotlight key features. Tap Skip anytime.",
  },
  {
    icon: Lightbulb,
    title: "Today's recommendation",
    body: "At the top of your dashboard, TradeMind reads your journal and tells you what's working and what to skip today.",
    target: '[data-tour="recommendation"]',
    route: "/dashboard",
  },
  {
    icon: LayoutDashboard,
    title: "Pick any instrument",
    body: "Change the symbol any time. Gold, indices, FX, crypto - all live data, no placeholders.",
    target: '[data-tour="symbol-picker"]',
    route: "/dashboard",
  },
  {
    icon: Activity,
    title: "Your live chart",
    body: "Toggle on-chart levels: VWAP, POC, S/R, FVG, Liquidity, Order Flow, plus session zones (New York, London, Tokyo, Sydney).",
    target: '[data-tour="chart"]',
    route: "/dashboard",
  },
  {
    icon: Sparkles,
    title: "Run a scan",
    body: "Tap Run scan and the AI grades the current setup against your enabled levels and your journal edge.",
    target: '[data-tour="scan"]',
    route: "/dashboard",
  },
  {
    icon: MessageSquare,
    title: "Your floating AI Coach",
    body: "The bubble opens a coach that reads your live chart and your journal. Speaker icon plays replies aloud in your coach's voice.",
    target: '[data-tour="coach-bubble"]',
    route: "/dashboard",
  },
  {
    icon: Lightbulb,
    title: "'Show me' on the chart",
    body: "In chat, start any question with 'show me' - like 'show me the FVG' or 'show me where to enter'. The AI draws it directly on the chart you're viewing.",
    target: '[data-tour="coach-bubble"]',
    route: "/dashboard",
  },
  {
    icon: NotebookPen,
    title: "Journal every trade",
    body: "Log entries, exits, P&L, and notes. The AI uses your journal to weight every recommendation.",
  },
  {
    icon: Library,
    title: "Strategy library",
    body: "Browse playbooks, tap any card to read the rules, and set one as your active strategy. Every scan is graded against it.",
  },
  {
    icon: Users,
    title: "Invite a trader",
    body: "From the Coach Dashboard, generate a real shareable link. When a trader accepts, you'll see each other's wins, losses, and win rate.",
  },
  {
    icon: BarChart3,
    title: "Analytics & Memory",
    body: "Analytics breaks down performance by symbol, side, and session. Memory stores your corrections so the AI gets sharper about you.",
  },
  {
    icon: Brain,
    title: "You're all set",
    body: "Everything is in the left sidebar. Re-run this tour anytime from the Guide page.",
  },
];

export function Tutorial() {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);

  useEffect(() => {
    try {
      if (!localStorage.getItem(STORAGE_KEY)) {
        const t = window.setTimeout(() => setOpen(true), 400);
        return () => window.clearTimeout(t);
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    const onOpen = () => { setStep(0); setOpen(true); };
    window.addEventListener("trademind:tutorial:open", onOpen);
    return () => window.removeEventListener("trademind:tutorial:open", onOpen);
  }, []);

  const s = STEPS[step];

  // Navigate to the step's route if specified
  useEffect(() => {
    if (!open || !s?.route) return;
    if (typeof window !== "undefined" && window.location.pathname !== s.route) {
      window.history.pushState({}, "", s.route);
      window.dispatchEvent(new PopStateEvent("popstate"));
    }
  }, [open, s]);

  // Measure the spotlight target
  useLayoutEffect(() => {
    if (!open || !s?.target) { setRect(null); return; }
    let raf = 0;
    const measure = () => {
      const el = document.querySelector(s.target!) as HTMLElement | null;
      if (!el) { raf = window.requestAnimationFrame(measure); return; }
      el.scrollIntoView({ block: "center", behavior: "smooth" });
      window.setTimeout(() => {
        const r = el.getBoundingClientRect();
        setRect(r);
      }, 250);
    };
    raf = window.requestAnimationFrame(measure);
    const onResize = () => {
      const el = document.querySelector(s.target!) as HTMLElement | null;
      if (el) setRect(el.getBoundingClientRect());
    };
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onResize, true);
    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onResize, true);
    };
  }, [open, s]);

  const close = (completed: boolean) => {
    try { localStorage.setItem(STORAGE_KEY, completed ? "completed" : "skipped"); } catch { /* ignore */ }
    setOpen(false);
    setRect(null);
  };

  if (!open || !s) return null;

  const Icon = s.icon;
  const isLast = step === STEPS.length - 1;
  const isFirst = step === 0;
  const hasSpotlight = !!s.target && !!rect;

  // Position the card near the spotlight, or center if no target
  const cardStyle: React.CSSProperties = (() => {
    if (!hasSpotlight || !rect) return {};
    const pad = 16;
    const cardW = 380;
    const cardH = 260;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    // Prefer placing below the target, fallback above
    const below = rect.bottom + pad + cardH < vh;
    const top = below ? rect.bottom + pad : Math.max(pad, rect.top - cardH - pad);
    const left = Math.min(Math.max(pad, rect.left + rect.width / 2 - cardW / 2), vw - cardW - pad);
    return { top, left, width: cardW };
  })();

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="tutorial-title" className="fixed inset-0 z-[100]">
      {/* Spotlight overlay using box-shadow trick */}
      {hasSpotlight && rect ? (
        <div
          className="fixed pointer-events-none transition-all duration-300"
          style={{
            top: rect.top - 8,
            left: rect.left - 8,
            width: rect.width + 16,
            height: rect.height + 16,
            borderRadius: 12,
            boxShadow: "0 0 0 9999px rgba(0,0,0,0.72)",
            outline: "2px solid hsl(var(--primary))",
            outlineOffset: 2,
          }}
        />
      ) : (
        <div className="fixed inset-0 bg-background/80 backdrop-blur-sm" />
      )}

      {/* Card */}
      <div
        className={`fixed rounded-2xl border border-border bg-card shadow-2xl animate-in fade-in zoom-in-95 duration-200 ${
          hasSpotlight ? "" : "left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[min(420px,calc(100vw-2rem))]"
        }`}
        style={hasSpotlight ? cardStyle : undefined}
      >
        <button
          onClick={() => close(false)}
          aria-label="Skip tutorial"
          className="absolute right-3 top-3 h-8 w-8 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent/40 flex items-center justify-center transition"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="flex items-center justify-center h-10 w-10 rounded-lg bg-primary/10 ring-1 ring-primary/30">
              <Icon className="h-5 w-5 text-primary" />
            </div>
            <div className="text-[11px] font-medium uppercase tracking-[0.2em] text-muted-foreground">
              Step {step + 1} of {STEPS.length}
            </div>
          </div>

          <h2 id="tutorial-title" className="font-display text-xl font-semibold tracking-tight mb-2">
            {s.title}
          </h2>
          <p className="text-sm text-muted-foreground leading-relaxed">{s.body}</p>

          <div className="flex items-center gap-1.5 mt-5">
            {STEPS.map((_, i) => (
              <div
                key={i}
                className={`h-1 rounded-full transition-all ${
                  i === step ? "w-6 bg-primary" : i < step ? "w-3 bg-primary/40" : "w-3 bg-border"
                }`}
              />
            ))}
          </div>

          <div className="flex items-center justify-between gap-3 mt-5">
            <button onClick={() => close(false)} className="text-sm text-muted-foreground hover:text-foreground transition">
              Skip
            </button>
            <div className="flex items-center gap-2">
              {!isFirst && (
                <button
                  onClick={() => setStep((s) => s - 1)}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-2 text-sm font-medium hover:border-primary/50 transition"
                >
                  <ArrowLeft className="h-3.5 w-3.5" /> Back
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
                  Continue <ArrowRight className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export { Volume2 };
