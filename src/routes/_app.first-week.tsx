import { PageInstructions } from "@/components/PageInstructions";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useFirstWeek, FIRST_WEEK_TASKS, emitFirstWeekEvent, startFirstWeek } from "@/hooks/useFirstWeek";
import { CheckCircle2, Circle, ArrowRight, Calendar, RotateCcw, Sparkles } from "lucide-react";
import { restartTutorial } from "@/components/Tutorial";

export const Route = createFileRoute("/_app/first-week")({
  head: () => ({
    meta: [
      { title: "First Week — TradeMind" },
      { name: "description", content: "Your guided first week on TradeMind. Complete one small step each day." },
      { property: "og:title", content: "First Week — TradeMind" },
      { property: "og:description", content: "Your guided first week on TradeMind. Complete one small step each day." },
    ],
  }),
  component: FirstWeekPage,
});

function FirstWeekPage() {
  const { active, currentDay, completedCount, completed, progressPct, startedAt, dismiss, toggle } = useFirstWeek();
  const navigate = useNavigate();

  function handleStartTour() {
    try { localStorage.removeItem("trademind.tour.v1.done"); } catch { /* noop */ }
    startFirstWeek();
    navigate({ to: "/dashboard" }).then(() => {
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent("trademind:open-tour"));
        restartTutorial();
      }, 250);
    });
  }

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-6 md:mb-8">
        <h1 className="font-display text-2xl md:text-3xl font-semibold mb-2">Your first week on TradeMind</h1>
        <p className="text-sm text-muted-foreground">
          A seven-day path from your first scan to placing your first practice trade. One step at a time.
        </p>
      </div>
      <PageInstructions className="mb-6" />

      {!active && (
        <div className="rounded-md border border-border bg-card p-5 mb-6">
          <div className="flex items-start gap-4">
            <div className="h-10 w-10 rounded-md bg-primary/10 flex items-center justify-center text-primary shrink-0">
              <Sparkles className="h-5 w-5" />
            </div>
            <div className="flex-1">
              <h2 className="font-semibold text-base mb-1">Start your first week</h2>
              <p className="text-sm text-muted-foreground mb-3">
                Begin the guided onboarding to track your progress and finish with a master certificate.
              </p>
              <button
                onClick={handleStartTour}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-semibold bg-primary text-primary-foreground hover:opacity-90"
              >
                Start tour <ArrowRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>
      )}

      {active && (
        <div className="rounded-md border border-border bg-card p-5 mb-6">
          <div className="flex items-start justify-between gap-4 mb-4">
            <div>
              <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest font-semibold text-muted-foreground mb-1">
                <Calendar className="h-3.5 w-3.5" />
                Day {currentDay} of 7
              </div>
              <div className="text-sm text-muted-foreground">
                Started {startedAt ? new Date(startedAt).toLocaleDateString() : "today"}
              </div>
            </div>
            <button
              onClick={dismiss}
              className="text-xs text-muted-foreground hover:text-foreground underline"
            >
              Hide checklist
            </button>
          </div>

          <div className="mb-1 flex items-center justify-between text-xs">
            <span className="text-muted-foreground">{progressPct}% complete</span>
            <span className="font-semibold text-primary">{completedCount} / {FIRST_WEEK_TASKS.length}</span>
          </div>
          <div className="h-2 rounded-md bg-background overflow-hidden">
            <div className="h-full bg-primary transition-all" style={{ width: `${progressPct}%` }} />
          </div>
        </div>
      )}

      <div className="grid gap-3">
        {FIRST_WEEK_TASKS.map((task) => {
          const done = Boolean(completed[task.id]);
          return (
            <div key={task.id} className={`rounded-md border border-border bg-card p-4 flex items-start gap-4 ${done ? "opacity-70" : ""}`}>
              <div className="mt-0.5 shrink-0">
                {done ? <CheckCircle2 className="h-5 w-5 text-emerald-500" /> : <Circle className="h-5 w-5 text-muted-foreground" />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[10px] uppercase tracking-widest font-semibold text-muted-foreground">Day {task.day}</span>
                  {done && <span className="text-[10px] text-emerald-500 font-medium">Done</span>}
                </div>
                <h3 className={`font-semibold text-sm ${done ? "text-muted-foreground line-through" : ""}`}>{task.label}</h3>
                <p className="text-xs text-muted-foreground mt-0.5">{task.description}</p>
              </div>
              <Link
                to={task.route}
                className="shrink-0 inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-semibold border border-border bg-background hover:border-primary/40"
              >
                {task.cta} <ArrowRight className="h-3 w-3" />
              </Link>
            </div>
          );
        })}
      </div>

      {active && (
        <div className="mt-6 rounded-md border border-border bg-card p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm text-muted-foreground">
              Need to restart? Clicking reset will clear your first-week progress and start the tour again.
            </div>
            <button
              onClick={() => {
                try { localStorage.removeItem("trademind.first-week.v1"); } catch { /* noop */ }
                try { localStorage.removeItem("trademind.tour.v1.done"); } catch { /* noop */ }
                window.location.reload();
              }}
              className="inline-flex items-center gap-1 px-3 py-2 rounded-md text-xs font-medium border border-border bg-background hover:border-primary/40"
            >
              <RotateCcw className="h-3.5 w-3.5" /> Reset
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
