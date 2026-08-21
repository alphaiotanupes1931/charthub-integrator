import { useEffect, useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { aiCostSummary } from "@/lib/ai-cost.functions";
import { csvDate, downloadCsv } from "@/lib/csv-export";
import { DailyUsageChart, PerPersonChart } from "@/components/admin/UsageTrendCharts";
import { DateRangeSelector, DEFAULT_RANGE, type AdminRange } from "@/components/admin/DateRangeSelector";



const usd = (n: number) => `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Plain-English AI spend dashboard. Dollars big, technical counts small.
 */
export function AiAveragesPanel({ userCount }: { userCount: number }) {
  const [range, setRange] = useState<AdminRange>(DEFAULT_RANGE);
  const days = range.days;
  const [data, setData] = useState<Awaited<ReturnType<typeof aiCostSummary>> | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    aiCostSummary({ data: { days } })
      .then((res) => { if (!cancelled) setData(res); })
      .catch(() => { if (!cancelled) setData(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [days]);

  const kinds = data?.byKind ?? [];
  const byUser = data?.byUser ?? [];
  const total = kinds.reduce((s, r) => s + Number(r.cost_usd), 0);
  const calls = kinds.reduce((s, r) => s + Number(r.calls), 0);
  const setups = byUser.reduce((s, r) => s + Number(r.graded_setups), 0);
  const activePeople = byUser.filter((r) => Number(r.cost_usd) > 0).length;
  const avgPerActive = activePeople ? total / activePeople : 0;
  const avgPerUser = userCount ? total / userCount : 0;
  const perSetup = setups ? total / setups : 0;
  const perDay = total / days;
  const tokens = kinds.reduce(
    (s, r) => s + Number(r.input_tokens ?? 0) + Number(r.cached_input_tokens ?? 0) + Number(r.output_tokens ?? 0),
    0,
  );

  const cards: Array<{ label: string; value: string; hint: string }> = [
    { label: "AI cost, all users", value: usd(total), hint: range.label },
    { label: "Average per active user", value: usd(avgPerActive), hint: `${activePeople} people used AI` },
    { label: "Average per signup", value: usd(avgPerUser), hint: `${userCount} accounts` },
    { label: "Cost per trade idea", value: usd(perSetup), hint: `${setups.toLocaleString()} graded setups` },
  ];

  const exportCsv = () => {
    downloadCsv(
      `ai-usage-${days}d-${csvDate()}.csv`,
      ["User ID", "Email", "AI calls", "Graded setups", "Cost USD", "Cost per setup USD"],
      byUser.map((r) => [
        r.user_id,
        r.email ?? "",
        r.calls,
        r.graded_setups,
        Number(r.cost_usd).toFixed(4),
        Number(r.cost_per_setup ?? 0).toFixed(4),
      ]),
    );
  };

  return (
    <section className="rounded-2xl border border-border/60 bg-card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 border-b border-border/60">
        <div>
          <h2 className="text-[15px] font-semibold tracking-tight">AI usage in dollars</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">What the AI costs on average across the platform.</p>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <DateRangeSelector value={range} onChange={setRange} />
          <button
            onClick={exportCsv}
            disabled={byUser.length === 0}
            className="ml-2 inline-flex items-center gap-1.5 rounded-full border border-border/60 px-3 py-1 text-[11px] font-medium text-muted-foreground hover:bg-muted disabled:opacity-40"
          >
            <Download className="h-3.5 w-3.5" /> CSV
          </button>
        </div>
      </div>


      {loading ? (
        <div className="flex items-center gap-2 px-5 py-8 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 divide-x divide-y divide-border">
            {cards.map((c) => (
              <div key={c.label} className="p-5">
                <div className="text-xs text-muted-foreground">{c.label}</div>
                <div className="mt-1.5 text-2xl font-semibold tabular-nums">{c.value}</div>
                <div className="mt-1 text-[11px] text-muted-foreground">{c.hint}</div>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 border-t border-border/60 p-5">
            <DailyUsageChart days={days} metric="ai" grouping={range.grouping} rangeLabel={range.label} />
            <PerPersonChart
              title="AI cost per person"
              hint={`Top spenders, ${range.label}`}
              format="usd"
              rows={byUser.map((r) => ({ label: r.email ?? r.user_id.slice(0, 8), value: Number(r.cost_usd) }))}
            />
          </div>
          <div className="px-5 py-3 border-t border-border/60 text-[11px] text-muted-foreground">
            About {usd(perDay)} per day · {calls.toLocaleString()} AI calls · {tokens.toLocaleString()} credits (tokens) used
          </div>

        </>
      )}
    </section>
  );
}
