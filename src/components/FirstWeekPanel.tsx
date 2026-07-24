import { useFirstWeek, FIRST_WEEK_TASKS } from "@/hooks/useFirstWeek";
import { Link } from "@tanstack/react-router";
import { X, CheckCircle2, Circle, ArrowRight, Calendar } from "lucide-react";

export function FirstWeekPanel() {
  const { active, currentDay, completedCount, progressPct, nextTask, upcoming, dismissed, dismiss } = useFirstWeek();

  if (!active || dismissed) return null;

  return (
    <div className="rounded-md border border-border bg-card p-4 mb-4">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest font-semibold text-muted-foreground mb-1">
            <Calendar className="h-3.5 w-3.5" />
            Day {currentDay} of 7
          </div>
          <h3 className="font-display text-base font-semibold">Your first week on TradeMind</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Complete one small step each day. You can skip ahead, but the order is designed to build confidence.
          </p>
        </div>
        <button
          onClick={dismiss}
          aria-label="Hide first-week checklist"
          className="shrink-0 h-7 w-7 rounded-md border border-border bg-background text-muted-foreground hover:text-foreground flex items-center justify-center"
          title="Hide"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="mb-4">
        <div className="flex items-center justify-between text-xs mb-1.5">
          <span className="text-muted-foreground">{progressPct}% complete</span>
          <span className="text-primary font-semibold">
            {completedCount} / {FIRST_WEEK_TASKS.length}
          </span>
        </div>
        <div className="h-1.5 rounded-md bg-background overflow-hidden">
          <div className="h-full bg-primary transition-all" style={{ width: `${progressPct}%` }} />
        </div>
      </div>

      {nextTask && (
        <div className="rounded-md border border-primary/30 bg-primary/5 p-3 mb-3">
          <div className="text-[10px] uppercase tracking-widest font-semibold text-primary mb-1">Next step</div>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="font-semibold text-sm">{nextTask.label}</div>
              <div className="text-xs text-muted-foreground mt-0.5">{nextTask.description}</div>
            </div>
            <Link
              to={nextTask.route}
              className="shrink-0 inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-semibold bg-primary text-primary-foreground hover:opacity-90"
            >
              {nextTask.cta} <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
        </div>
      )}

      {upcoming.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-[10px] uppercase tracking-widest font-semibold text-muted-foreground">Coming up</div>
          {upcoming.map((t) => (
            <div key={t.id} className="flex items-center gap-2.5 text-sm">
              <Circle className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <span className="text-foreground/80">{t.label}</span>
              <span className="ml-auto text-[10px] text-muted-foreground">Day {t.day}</span>
            </div>
          ))}
        </div>
      )}

      {upcoming.length === 0 && nextTask === null && (
        <div className="flex items-center gap-2 text-sm text-bull">
          <CheckCircle2 className="h-4 w-4" />
          All first-week tasks complete. You are ready to trade with the full platform.
        </div>
      )}
    </div>
  );
}

export function FirstWeekMiniPill({ onClick }: { onClick?: () => void }) {
  const { active, currentDay, progressPct, dismissed } = useFirstWeek();
  if (!active || dismissed) return null;
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-2 rounded-md border border-primary/30 bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary hover:bg-primary/15"
    >
      <Calendar className="h-3 w-3" />
      Day {currentDay} · {progressPct}%
    </button>
  );
}
