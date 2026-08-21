import { useEffect, useState } from "react";
import { Download, Loader2, Image as ImageIcon } from "lucide-react";
import { adminImageUsage } from "@/lib/admin.functions";
import { csvDate, downloadCsv } from "@/lib/csv-export";
import { DailyUsageChart, PerPersonChart } from "@/components/admin/UsageTrendCharts";



const usd = (n: number) => `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Screenshot (chart image) usage per person. Dollars first, counts small.
 * Admins have no screenshot allowance, so their limit column reads "no limit".
 */
export function ImageUsagePanel({ imageCap = 5 }: { imageCap?: number }) {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<Awaited<ReturnType<typeof adminImageUsage>> | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    adminImageUsage({ data: { days } })
      .then((res) => { if (!cancelled) setData(res); })
      .catch(() => { if (!cancelled) setData(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [days]);

  const rows = data?.rows ?? [];
  const totals = data?.totals;
  const people = rows.filter((r) => r.images > 0).length;

  const cards = [
    { label: "Image cost", value: totals ? usd(totals.est_cost_usd) : "-", hint: `${totals?.images ?? 0} screenshot reads` },
    { label: "Cost per read", value: totals ? `$${totals.est_cost_per_image.toFixed(4)}` : "-", hint: "Estimated from real AI spend" },
    { label: "People reading charts", value: String(people), hint: `Last ${days} days` },
  ];

  const exportCsv = () => {
    downloadCsv(
      `image-usage-${days}d-${csvDate()}.csv`,
      ["User ID", "Name", "Email", "Admin", "Screenshot reads", "Est cost USD", "Last read"],
      rows.map((r) => [
        r.user_id,
        r.name ?? "",
        r.email ?? "",
        r.is_admin ? "yes" : "no",
        r.images,
        Number(r.est_cost_usd).toFixed(4),
        r.last_day ?? "",
      ]),
    );
  };

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-sm font-medium">
          <ImageIcon className="h-4 w-4 text-muted-foreground" /> Image usage
        </h2>
        <div className="flex items-center gap-1">
          {[7, 30, 90].map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`rounded-full border px-3 py-1 text-[11px] font-medium ${d === days ? "border-foreground bg-foreground text-background" : "border-border/60 text-muted-foreground hover:bg-muted"}`}
            >
              {d}d
            </button>
          ))}
          <button
            onClick={exportCsv}
            disabled={rows.length === 0}
            className="ml-2 inline-flex items-center gap-1.5 rounded-full border border-border/60 px-3 py-1 text-[11px] font-medium text-muted-foreground hover:bg-muted disabled:opacity-40"
          >
            <Download className="h-3.5 w-3.5" /> CSV
          </button>
        </div>
      </div>


      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {cards.map((c) => (
          <div key={c.label} className="rounded-2xl border border-border/60 bg-card p-5">
            <div className="text-xs text-muted-foreground">{c.label}</div>
            <div className="mt-2 text-3xl font-semibold tabular-nums">{c.value}</div>
            <div className="mt-1 text-[11px] text-muted-foreground">{c.hint}</div>
          </div>
        ))}
      </div>

      {data?.breakdown && (
        <div className="rounded-2xl border border-border/60 bg-card p-5">
          <div className="text-sm font-medium">Where the image money goes</div>
          <div className="mt-1 text-[11px] text-muted-foreground">
            Last {days} days. Screenshot cost is estimated from real AI spend, so it always ties back to the same dollars.
          </div>

          <dl className="mt-4 divide-y divide-border text-sm">
            {[
              { k: "Total AI cost (all calls)", v: usd(data.breakdown.total_ai_cost_usd), s: `${data.breakdown.ai_calls} calls` },
              { k: "Average cost per AI call", v: `$${data.breakdown.avg_call_usd.toFixed(4)}`, s: "Text and vision blended" },
              { k: "Cost per screenshot read", v: `$${data.breakdown.cost_per_read_usd.toFixed(4)}`, s: `Average call x ${data.breakdown.vision_multiplier} for the image payload` },
              { k: "Total image cost", v: usd(data.breakdown.image_cost_usd), s: `${totals?.images ?? 0} reads - ${data.breakdown.image_share_pct}% of all AI spend` },
              { k: "Everything else (text chat)", v: usd(data.breakdown.text_cost_usd), s: "AI spend that is not screenshot reads" },
            ].map((r) => (
              <div key={r.k} className="flex items-start justify-between gap-4 py-2.5">
                <div>
                  <div>{r.k}</div>
                  <div className="text-[11px] text-muted-foreground">{r.s}</div>
                </div>
                <div className="tabular-nums font-medium whitespace-nowrap">{r.v}</div>
              </div>
            ))}
          </dl>

          <div className="mt-4 rounded-xl border border-border/60 bg-muted/40 p-4">
            <div className="text-xs text-muted-foreground">How it feeds into real profit</div>
            <div className="mt-2 grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
              <div>
                <div className="text-[11px] text-muted-foreground">Money in (monthly)</div>
                <div className="mt-0.5 text-xl font-semibold tabular-nums">{usd(data.breakdown.gross_monthly_usd)}</div>
              </div>
              <div>
                <div className="text-[11px] text-muted-foreground">Minus all AI cost</div>
                <div className="mt-0.5 text-xl font-semibold tabular-nums">-{usd(data.breakdown.total_ai_cost_usd)}</div>
              </div>
              <div>
                <div className="text-[11px] text-muted-foreground">Real profit</div>
                <div className={`mt-0.5 text-xl font-semibold tabular-nums ${data.breakdown.real_profit_usd < 0 ? "text-destructive" : ""}`}>
                  {usd(data.breakdown.real_profit_usd)}
                </div>
              </div>
            </div>
            <div className="mt-3 text-[11px] text-muted-foreground">
              Images are {data.breakdown.image_share_pct}% of that AI cost, so every {data.breakdown.reads_per_dollar || 0} screenshot
              reads costs about $1 of profit.
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <DailyUsageChart days={days} metric="images" />
        <PerPersonChart
          title="Screenshot reads per person"
          hint={`Top readers, last ${days} days`}
          format="count"
          loading={loading}
          rows={rows.map((r) => ({
            label: r.name ?? r.email ?? r.user_id.slice(0, 8),
            value: r.images,
            isAdmin: r.is_admin,
          }))}
        />
      </div>



      <div className="rounded-2xl border border-border/60 bg-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <th className="px-5 py-2 text-left font-medium">Person</th>
                <th className="px-4 py-2 text-right font-medium">Image cost</th>
                <th className="px-4 py-2 text-right font-medium">Reads / daily limit</th>
                <th className="px-5 py-2 text-right font-medium">Last read</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading ? (
                <tr><td colSpan={4} className="px-5 py-6 text-muted-foreground"><Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> Loading</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={4} className="px-5 py-6 text-muted-foreground">No screenshot reads yet.</td></tr>
              ) : rows.map((r) => (
                <tr key={r.user_id}>
                  <td className="px-5 py-3">
                    <div className="font-medium flex items-center gap-2">
                      {r.name ?? r.email ?? "Unknown"}
                      {r.is_admin && (
                        <span className="rounded-full border border-border/60 bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                          Admin
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground truncate max-w-[240px]">{r.email ?? "-"}</div>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums font-medium">{usd(r.est_cost_usd)}</td>
                  <td className="px-4 py-3 text-right tabular-nums font-medium">
                    {r.images}
                    <span className="text-xs font-normal text-muted-foreground">
                      {r.is_admin ? " / no limit" : ` / ${imageCap} a day`}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-right text-muted-foreground tabular-nums">{r.last_day ?? "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="px-5 py-3 border-t border-border/60 text-[11px] text-muted-foreground">
          Screenshot reads cost more than plain chat because the whole chart image is sent to the model. Admin accounts have no
          daily cap.
        </div>
      </div>
    </section>
  );
}
