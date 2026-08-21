import { useEffect, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { adminAnthropicCost } from "@/lib/admin.functions";

const usd = (n: number) => `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

type Report = Awaited<ReturnType<typeof adminAnthropicCost>>;

/**
 * The number Anthropic actually bills this month, pulled from their own cost
 * report, next to our in-app token estimate so they can be compared directly.
 */
export function AnthropicBilledCost() {
  const [data, setData] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    adminAnthropicCost()
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const diff = data?.differenceUsd ?? 0;

  return (
    <section className="rounded-2xl border border-border/60 bg-card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 border-b border-border/60">
        <div>
          <h2 className="text-[15px] font-semibold tracking-tight">What Anthropic actually billed</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Straight from Anthropic's cost report for this calendar month.
          </p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-full border border-border/60 px-3 py-1 text-[11px] font-medium text-muted-foreground hover:bg-muted disabled:opacity-40"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
        </button>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 px-5 py-8 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Checking Anthropic
        </div>
      ) : !data ? (
        <div className="px-5 py-6 text-sm text-muted-foreground">Could not reach Anthropic just now.</div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 divide-x divide-y divide-border">
            <div className="p-5">
              <div className="text-xs text-muted-foreground">Billed by Anthropic, this month</div>
              <div className="mt-1.5 text-2xl font-semibold tabular-nums">
                {data.configured ? usd(data.monthToDateUsd) : "Not connected"}
              </div>
              <div className="mt-1 text-[11px] text-muted-foreground">
                {data.configured ? `Today: ${usd(data.todayUsd)}` : "Add an Anthropic admin key to see this"}
              </div>
            </div>
            <div className="p-5">
              <div className="text-xs text-muted-foreground">Our in-app estimate</div>
              <div className="mt-1.5 text-2xl font-semibold tabular-nums">{usd(data.loggedEstimateUsd)}</div>
              <div className="mt-1 text-[11px] text-muted-foreground">Counted from tokens we logged per call</div>
            </div>
            <div className="p-5">
              <div className="text-xs text-muted-foreground">Difference</div>
              <div className="mt-1.5 text-2xl font-semibold tabular-nums">
                {data.configured ? `${diff >= 0 ? "+" : "-"}${usd(Math.abs(diff))}` : "-"}
              </div>
              <div className="mt-1 text-[11px] text-muted-foreground">
                {data.configured
                  ? diff >= 0
                    ? "Anthropic billed more than we estimated"
                    : "We estimated more than Anthropic billed"
                  : "Needs the billed number first"}
              </div>
            </div>
          </div>

          {data.error ? (
            <div className="border-t border-border/60 px-5 py-3 text-[11px] text-muted-foreground">{data.error}</div>
          ) : null}

          {data.buckets.length > 0 ? (
            <div className="border-t border-border/60 px-5 py-4">
              <div className="text-xs text-muted-foreground mb-2">Billed per day</div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] tabular-nums">
                {data.buckets.map((b) => (
                  <span key={b.day} className="text-muted-foreground">
                    {b.day.slice(5)} <span className="text-foreground">{usd(b.amountUsd)}</span>
                  </span>
                ))}
              </div>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
