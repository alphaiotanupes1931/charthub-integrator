import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { CheckCircle2, Circle, ArrowRight } from "lucide-react";
import { readWeek, writeWeek, type SavedWeek } from "@/lib/trader-profile/draft";
import { TRADER_TYPES, type TraderTypeId } from "@/lib/trader-profile/config";
import { track } from "@/lib/product-events";

/** The 5-day plan picked for the trader's type, shown above the standard first-week tasks. */
export function TraderWeekPanel() {
  const [week, setWeek] = useState<SavedWeek | null>(null);
  useEffect(() => { setWeek(readWeek()); }, []);
  if (!week) {
    return (
      <div className="rounded-xl border border-border/60 bg-card p-4 mb-6 flex items-center justify-between gap-3">
        <div className="text-sm text-muted-foreground">Get a 5-day plan built around how you trade.</div>
        <Link to="/trader-type" className="shrink-0 text-xs font-semibold text-primary hover:underline">Find your trader type</Link>
      </div>
    );
  }
  const typeName = TRADER_TYPES[week.type as TraderTypeId]?.name ?? "Your plan";
  function toggle(day: number) {
    if (!week) return;
    const done = { ...week.done, [day]: !week.done[day] };
    const next = { ...week, done };
    setWeek(next);
    writeWeek(next);
    if (done[day]) track("first_week_day_completed", { day, trader_type: week.type });
  }
  return (
    <div className="rounded-xl border border-primary/30 bg-card p-5 mb-6">
      <div className="text-xs text-muted-foreground">Your plan as {typeName}</div>
      <div className="mt-3 grid gap-2">
        {week.tasks.map((t) => {
          const done = !!week.done[t.day];
          return (
            <div key={t.day} className="flex items-center gap-3">
              <button onClick={() => toggle(t.day)} aria-label={done ? "Mark not done" : "Mark done"}>
                {done ? <CheckCircle2 className="h-5 w-5 text-primary" /> : <Circle className="h-5 w-5 text-muted-foreground" />}
              </button>
              <span className="text-xs text-muted-foreground w-10 shrink-0">Day {t.day}</span>
              <span className={`flex-1 text-sm ${done ? "line-through text-muted-foreground" : ""}`}>{t.label}</span>
              <Link to={t.route} className="text-xs text-primary inline-flex items-center gap-1 hover:underline">Go <ArrowRight className="h-3 w-3" /></Link>
            </div>
          );
        })}
      </div>
    </div>
  );
}
