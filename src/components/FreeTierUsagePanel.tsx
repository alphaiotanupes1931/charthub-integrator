import { useMemo } from "react";
import { useNavigate } from "@tanstack/react-router";
import { CalendarClock, Gauge, Sparkles } from "lucide-react";
import { useEntitlements } from "@/hooks/useEntitlements";

/** Show an upgrade nudge when the user has this many grades or fewer left. */
const UPGRADE_NUDGE_THRESHOLD = 2;

/**
 * Free-plan usage at a glance: grades used, grades left, and exactly when the
 * allowance resets. Renders nothing for paid or admin accounts (their quota is
 * inactive), so it can be mounted unconditionally.
 */
export function FreeTierUsagePanel({ className = "" }: { className?: string }) {
  const { quota, snapshot, loading } = useEntitlements();
  const navigate = useNavigate();
  const timezone = snapshot?.timezone || "UTC";

  const reset = useMemo(() => nextResetInfo(timezone), [timezone]);

  if (loading || !quota.active) return null;

  const pct = quota.limit > 0 ? Math.min(100, Math.round((quota.used / quota.limit) * 100)) : 0;

  return (
    <div
      data-testid="free-tier-usage"
      className={`rounded-xl border border-border bg-card p-4 ${className}`}
    >
      <div className="flex items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <Gauge className="size-4 text-primary" />
          Free plan usage
        </h3>
        <span
          data-testid="free-tier-remaining"
          className={`font-mono text-sm font-semibold tabular-nums ${
            quota.exhausted ? "text-destructive" : ""
          }`}
        >
          {quota.remaining}/{quota.limit}
        </span>
      </div>

      <p className="mt-1 text-xs text-muted-foreground">
        {quota.exhausted
          ? "You've used all of this month's signal grades."
          : `${quota.remaining} signal ${quota.remaining === 1 ? "grade" : "grades"} left this month.`}
      </p>

      <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full ${quota.exhausted ? "bg-destructive" : "bg-primary"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="mt-1.5 flex items-center justify-between text-[11px] text-muted-foreground">
        <span>{quota.used} used</span>
        <span>{quota.limit} per calendar month</span>
      </div>

      <div
        data-testid="free-tier-reset"
        className="mt-3 flex items-center gap-2 rounded-xl border border-border bg-muted/30 p-3 text-xs text-muted-foreground"
      >
        <CalendarClock className="size-4 shrink-0" />
        <span>
          Resets {reset.label} ({reset.daysAway === 0
            ? "today"
            : reset.daysAway === 1
              ? "tomorrow"
              : `in ${reset.daysAway} days`}
          ), your time zone {timezone}.
        </span>
      </div>

      <button
        type="button"
        onClick={() => navigate({ to: "/pricing" })}
        className="mt-3 w-full rounded-xl bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground"
      >
        Upgrade for unlimited grades
      </button>
    </div>
  );
}

/** First day of next month in the user's zone, plus how far away that is. */
export function nextResetInfo(timezone: string, now: Date = new Date()) {
  const tz = timezone || "UTC";
  let year: number;
  let month: number;
  try {
    const key = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit" }).format(now);
    year = Number(key.slice(0, 4));
    month = Number(key.slice(5, 7));
  } catch {
    year = now.getUTCFullYear();
    month = now.getUTCMonth() + 1;
  }
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const resetUtc = Date.UTC(nextYear, nextMonth - 1, 1);
  const todayUtc = Date.UTC(year, month - 1, dayOfMonth(tz, now));
  const daysAway = Math.max(0, Math.round((resetUtc - todayUtc) / 86_400_000));
  return {
    label: new Date(resetUtc).toLocaleDateString(undefined, {
      timeZone: "UTC",
      month: "long",
      day: "numeric",
      year: "numeric",
    }),
    daysAway,
  };
}

function dayOfMonth(timezone: string, at: Date): number {
  try {
    return Number(new Intl.DateTimeFormat("en-CA", { timeZone: timezone, day: "2-digit" }).format(at));
  } catch {
    return at.getUTCDate();
  }
}
