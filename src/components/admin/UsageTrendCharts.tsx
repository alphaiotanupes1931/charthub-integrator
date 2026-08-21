import { useEffect, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Loader2 } from "lucide-react";
import { adminUsageTrends } from "@/lib/admin.functions";
import { groupSeries, type Grouping } from "@/components/admin/DateRangeSelector";

const usd = (n: number) => `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const shortDay = (d: string) =>
  d.length === 7
    ? new Date(`${d}-01T00:00:00Z`).toLocaleDateString(undefined, { month: "short", year: "2-digit", timeZone: "UTC" })
    : d.slice(5).replace("-", "/");

function Frame({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-border/60 bg-card p-5">
      <div className="mb-3">
        <div className="text-sm font-medium">{title}</div>
        {hint && <div className="mt-0.5 text-[11px] text-muted-foreground">{hint}</div>}
      </div>
      <div className="h-52">{children}</div>
    </div>
  );
}

const AXIS = { stroke: "hsl(var(--muted-foreground))", fontSize: 11 } as const;
const TOOLTIP = {
  contentStyle: {
    background: "hsl(var(--popover))",
    border: "1px solid hsl(var(--border))",
    borderRadius: 12,
    fontSize: 12,
    color: "hsl(var(--popover-foreground))",
  },
  labelStyle: { color: "hsl(var(--muted-foreground))" },
} as const;

/** Daily (or monthly) bars: AI dollars or screenshot reads over the window. */
export function DailyUsageChart({
  days,
  metric,
  grouping = "day",
  rangeLabel,
}: {
  days: number;
  metric: "ai" | "images";
  grouping?: Grouping;
  rangeLabel?: string;
}) {
  const [data, setData] = useState<Awaited<ReturnType<typeof adminUsageTrends>> | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    adminUsageTrends({ data: { days: Math.min(days, 365) } })
      .then((res) => { if (!cancelled) setData(res); })
      .catch(() => { if (!cancelled) setData(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [days]);

  const isAi = metric === "ai";
  const raw = (isAi ? data?.aiByDay : data?.imagesByDay) ?? [];
  const key = isAi ? "cost_usd" : "images";
  const rows = groupSeries(raw as Array<Record<string, unknown> & { day: string }>, grouping, [key, isAi ? "calls" : "requests"]);
  const byMonth = grouping === "month";
  const window = rangeLabel ?? `last ${days} days`;

  return (
    <Frame
      title={isAi ? (byMonth ? "AI cost by month" : "AI cost by day") : byMonth ? "Screenshot reads by month" : "Screenshot reads by day"}
      hint={isAi ? `Dollars spent each ${byMonth ? "month" : "day"}, ${window}` : `Chart images read each ${byMonth ? "month" : "day"}, ${window}`}
    >

      {loading ? (
        <div className="flex h-full items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading
        </div>
      ) : rows.length === 0 ? (
        <div className="flex h-full items-center text-sm text-muted-foreground">No usage yet.</div>
      ) : (
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 4, right: 8, left: -12, bottom: 0 }}>
            <CartesianGrid stroke="hsl(var(--border))" vertical={false} />
            <XAxis dataKey="day" tickFormatter={shortDay} tickLine={false} axisLine={false} {...AXIS} minTickGap={16} />
            <YAxis
              tickLine={false}
              axisLine={false}
              {...AXIS}
              tickFormatter={(v: number) => (isAi ? `$${Number(v).toFixed(2)}` : String(v))}
            />
            <Tooltip
              {...TOOLTIP}
              formatter={(v) => [isAi ? usd(Number(v)) : `${Number(v)} reads`, isAi ? "AI cost" : "Reads"]}
            />
            <Bar dataKey={key} fill="hsl(var(--foreground))" radius={[3, 3, 0, 0]} maxBarSize={22} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </Frame>
  );
}

export type PersonBar = { label: string; value: number; isAdmin?: boolean };

/** Horizontal bars: top people by dollars or reads. */
export function PerPersonChart({
  title,
  hint,
  rows,
  loading,
  format,
  limit = 8,
}: {
  title: string;
  hint?: string;
  rows: PersonBar[];
  loading?: boolean;
  format: "usd" | "count";
  limit?: number;
}) {
  const top = [...rows].filter((r) => r.value > 0).sort((a, b) => b.value - a.value).slice(0, limit);
  const fmt = (v: number) => (format === "usd" ? usd(v) : String(v));

  return (
    <Frame title={title} hint={hint}>
      {loading ? (
        <div className="flex h-full items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading
        </div>
      ) : top.length === 0 ? (
        <div className="flex h-full items-center text-sm text-muted-foreground">Nothing to chart yet.</div>
      ) : (
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={top} layout="vertical" margin={{ top: 4, right: 12, left: 8, bottom: 0 }}>
            <CartesianGrid stroke="hsl(var(--border))" horizontal={false} />
            <XAxis
              type="number"
              tickLine={false}
              axisLine={false}
              {...AXIS}
              tickFormatter={(v: number) => (format === "usd" ? `$${Number(v).toFixed(2)}` : String(v))}
            />
            <YAxis type="category" dataKey="label" width={120} tickLine={false} axisLine={false} {...AXIS} />
            <Tooltip {...TOOLTIP} formatter={(v) => [fmt(Number(v)), format === "usd" ? "Cost" : "Reads"]} />
            <Bar dataKey="value" radius={[0, 3, 3, 0]} maxBarSize={18}>
              {top.map((r) => (
                <Cell key={r.label} fill={r.isAdmin ? "hsl(var(--muted-foreground))" : "hsl(var(--foreground))"} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </Frame>
  );
}
