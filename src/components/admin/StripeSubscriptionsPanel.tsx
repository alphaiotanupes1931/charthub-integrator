import { useEffect, useState } from "react";
import { Loader2, RefreshCw, CreditCard } from "lucide-react";
import { listSubscribers } from "@/lib/billing.functions";

type Data = Awaited<ReturnType<typeof listSubscribers>>;
type Row = Data["subscribers"][number];

const money = (cents: number, currency = "usd") =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase() }).format(
    cents / 100,
  );

export function StripeSubscriptionsPanel({
  onMrrChange,
}: {
  onMrrChange?: (mrrCents: number) => void;
}) {
  const [data, setData] = useState<Data | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setBusy(true);
    try {
      const res = (await listSubscribers()) as Data;
      setData(res);
      onMrrChange?.(res.mrr_cents);
      setErr(null);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rows: Row[] = data?.subscribers ?? [];
  const active = rows.filter((r) => r.status === "active" || r.status === "trialing");
  const trialing = rows.filter((r) => r.status === "trialing");
  const cancelling = active.filter((r) => r.cancel_at_period_end);
  const pastDue = rows.filter((r) => r.status === "past_due" || r.status === "unpaid");
  const arr = (data?.mrr_cents ?? 0) * 12;
  const arpu = active.length ? Math.round((data?.mrr_cents ?? 0) / active.length) : 0;
  const churnRisk = active.length ? (cancelling.length / active.length) * 100 : 0;

  const byTier = new Map<string, { count: number; cents: number }>();
  for (const r of active) {
    const key = r.tier ?? "unknown";
    const prev = byTier.get(key) ?? { count: 0, cents: 0 };
    byTier.set(key, { count: prev.count + 1, cents: prev.cents + r.amount });
  }

  return (
    <section className="rounded-2xl border border-border/60 bg-card p-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <CreditCard className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold tracking-tight">Stripe subscriptions</h2>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-full border border-border/60 px-3 py-1.5 text-xs font-semibold hover:bg-muted disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {err && <div className="mt-3 text-xs text-destructive">{err}</div>}

      {data === null && !err ? (
        <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Pulling live from Stripe…
        </div>
      ) : (
        <>
          <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-3">
            <Stat label="Active subscriptions" value={String(active.length)} sub={`${trialing.length} trialing`} />
            <Stat label="Stripe MRR" value={money(data?.mrr_cents ?? 0, data?.currency)} sub={`${money(arr, data?.currency)} ARR`} />
            <Stat label="Average per subscriber" value={money(arpu, data?.currency)} sub="Active plus trialing" />
            <Stat
              label="Cancelling at period end"
              value={String(cancelling.length)}
              sub={`${churnRisk.toFixed(1)}% of active`}
            />
          </div>

          {pastDue.length > 0 && (
            <div className="mt-3 rounded-xl border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              {pastDue.length} subscription{pastDue.length === 1 ? "" : "s"} past due or unpaid, worth{" "}
              {money(pastDue.reduce((s, r) => s + r.amount, 0), data?.currency)} per month.
            </div>
          )}

          {byTier.size > 0 && (
            <div className="mt-4 rounded-xl border border-border/60 divide-y divide-border">
              {[...byTier.entries()]
                .sort((a, b) => b[1].cents - a[1].cents)
                .map(([tier, v]) => (
                  <div key={tier} className="flex items-center justify-between px-3 py-2 text-sm">
                    <span className="capitalize">{tier}</span>
                    <span className="text-muted-foreground tabular-nums">
                      {v.count} · {money(v.cents, data?.currency)}/mo
                    </span>
                  </div>
                ))}
            </div>
          )}

          <div className="mt-4 overflow-x-auto rounded-xl border border-border/60">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs text-muted-foreground">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">Email</th>
                  <th className="text-left px-3 py-2 font-medium">Plan</th>
                  <th className="text-left px-3 py-2 font-medium">Status</th>
                  <th className="text-right px-3 py-2 font-medium">Per month</th>
                  <th className="text-left px-3 py-2 font-medium">Renews</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">
                      No Stripe subscriptions yet.
                    </td>
                  </tr>
                )}
                {rows
                  .slice()
                  .sort((a, b) => b.amount - a.amount)
                  .map((r) => (
                    <tr key={r.subscription_id} className="border-t border-border/60">
                      <td className="px-3 py-2">{r.email ?? "-"}</td>
                      <td className="px-3 py-2 capitalize">{r.tier ?? "-"}</td>
                      <td className="px-3 py-2 text-xs">
                        {r.status}
                        {r.cancel_at_period_end ? " (cancelling)" : ""}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{money(r.amount, r.currency)}</td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {r.current_period_end
                          ? new Date(r.current_period_end * 1000).toLocaleDateString()
                          : "-"}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-border/60 bg-background/40 p-3">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      {sub && <div className="mt-0.5 text-[11px] text-muted-foreground">{sub}</div>}
    </div>
  );
}
