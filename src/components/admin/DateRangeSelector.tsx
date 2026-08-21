/**
 * Shared date range + grouping control for the admin tabs.
 * One place decides how far back we look and whether totals are shown
 * day by day or rolled up per month.
 */
export type Grouping = "day" | "month";

export type AdminRange = {
  /** Days of history to pull. */
  days: number;
  /** Daily bars or monthly roll-up. */
  grouping: Grouping;
  /** Plain-English label, e.g. "last 30 days". */
  label: string;
};

const PRESETS: Array<{ key: string; days: number; label: string; short: string }> = [
  { key: "7d", days: 7, label: "last 7 days", short: "7d" },
  { key: "30d", days: 30, label: "last 30 days", short: "30d" },
  { key: "90d", days: 90, label: "last 90 days", short: "90d" },
  { key: "6m", days: 180, label: "last 6 months", short: "6m" },
  { key: "12m", days: 365, label: "last 12 months", short: "12m" },
];

export function monthToDateRange(): AdminRange {
  const days = Math.max(1, new Date().getDate());
  return { days, grouping: "day", label: "this month so far" };
}

export const DEFAULT_RANGE: AdminRange = { days: 30, grouping: "day", label: "last 30 days" };

/** Roll a day-keyed series up to month keys (YYYY-MM) when grouping is monthly. */
export function groupSeries<T extends { day: string }>(
  rows: T[],
  grouping: Grouping,
  sumKeys: Array<keyof T>,
): T[] {
  if (grouping === "day") return rows;
  const out = new Map<string, T>();
  for (const row of rows) {
    const key = String(row.day).slice(0, 7);
    const cur = out.get(key);
    if (!cur) {
      out.set(key, { ...row, day: key });
      continue;
    }
    for (const k of sumKeys) {
      (cur as Record<string, unknown>)[k as string] = Number(cur[k] ?? 0) + Number(row[k] ?? 0);
    }
  }
  return Array.from(out.values()).sort((a, b) => a.day.localeCompare(b.day));
}

export function DateRangeSelector({
  value,
  onChange,
  showGrouping = true,
}: {
  value: AdminRange;
  onChange: (r: AdminRange) => void;
  showGrouping?: boolean;
}) {
  const mtd = monthToDateRange();
  const isMtd = value.label === mtd.label;

  return (
    <div className="flex flex-wrap items-center gap-1">
      {PRESETS.map((p) => {
        const active = !isMtd && value.days === p.days;
        return (
          <button
            key={p.key}
            onClick={() => onChange({ ...value, days: p.days, label: p.label })}
            className={`rounded-full border px-3 py-1 text-[11px] font-medium ${active ? "border-foreground bg-foreground text-background" : "border-border/60 text-muted-foreground hover:bg-muted"}`}
          >
            {p.short}
          </button>
        );
      })}
      <button
        onClick={() => onChange({ ...value, days: mtd.days, label: mtd.label })}
        className={`rounded-full border px-3 py-1 text-[11px] font-medium ${isMtd ? "border-foreground bg-foreground text-background" : "border-border/60 text-muted-foreground hover:bg-muted"}`}
      >
        This month
      </button>

      {showGrouping && (
        <div className="ml-2 flex items-center rounded-full border border-border/60 p-0.5">
          {(["day", "month"] as const).map((g) => (
            <button
              key={g}
              onClick={() => onChange({ ...value, grouping: g })}
              className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium ${value.grouping === g ? "bg-muted text-foreground" : "text-muted-foreground"}`}
            >
              {g === "day" ? "Daily" : "Monthly"}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
