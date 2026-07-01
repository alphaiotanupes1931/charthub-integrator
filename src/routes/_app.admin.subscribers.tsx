import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useSuspenseQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { RefreshCw } from "lucide-react";
import { listSubscribers, syncSubscribersFromStripe } from "@/lib/billing.functions";

export const Route = createFileRoute("/_app/admin/subscribers")({
  head: () => ({ meta: [{ title: "Subscribers, TradeMind Admin" }] }),
  component: SubscribersPage,
});

function money(cents: number, currency: string) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(cents / 100);
}

function SubscribersPage() {
  const list = useServerFn(listSubscribers);
  const sync = useServerFn(syncSubscribersFromStripe);
  const qc = useQueryClient();
  const [syncing, setSyncing] = useState(false);
  const { data } = useSuspenseQuery({
    queryKey: ["admin-subscribers"],
    queryFn: () => list(),
    staleTime: 60_000,
  });

  const rows = data.subscribers;
  const active = rows.filter((r) => r.status === "active" || r.status === "trialing");

  async function runSync() {
    setSyncing(true);
    try {
      const res = await sync();
      toast.success(`Synced ${res.synced} · Unmatched ${res.unmatched}`);
      await qc.invalidateQueries({ queryKey: ["admin-subscribers"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-medium">Subscribers</h1>
          <p className="text-sm text-muted-foreground mt-1">Pulled live from Stripe.</p>
        </div>
        <button
          type="button"
          onClick={runSync}
          disabled={syncing}
          className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm hover:bg-muted disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${syncing ? "animate-spin" : ""}`} />
          {syncing ? "Syncing…" : "Sync from Stripe"}
        </button>
      </div>


      <div className="grid grid-cols-3 gap-4 mt-6">
        <div className="rounded-xl border border-border bg-card/40 p-4">
          <div className="text-xs text-muted-foreground">Active + trialing</div>
          <div className="font-display text-2xl mt-1">{active.length}</div>
        </div>
        <div className="rounded-xl border border-border bg-card/40 p-4">
          <div className="text-xs text-muted-foreground">MRR (active + trialing)</div>
          <div className="font-display text-2xl mt-1">
            {money(data.mrr_cents, data.currency)}
          </div>
        </div>
        <div className="rounded-xl border border-border bg-card/40 p-4">
          <div className="text-xs text-muted-foreground">Total tracked</div>
          <div className="font-display text-2xl mt-1">{rows.length}</div>
        </div>
      </div>

      <div className="mt-8 rounded-xl border border-border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/40">
            <tr>
              <th className="text-left px-3 py-2 font-medium">Email</th>
              <th className="text-left px-3 py-2 font-medium">Plan</th>
              <th className="text-left px-3 py-2 font-medium">Status</th>
              <th className="text-left px-3 py-2 font-medium">Amount</th>
              <th className="text-left px-3 py-2 font-medium">Renews</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="text-center text-muted-foreground py-8">
                  No subscribers yet.
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.subscription_id} className="border-t border-border">
                <td className="px-3 py-2">{r.email ?? "—"}</td>
                <td className="px-3 py-2 capitalize">{r.tier ?? "—"}</td>
                <td className="px-3 py-2">
                  <span
                    className={`inline-block rounded px-2 py-0.5 text-xs ${
                      r.status === "active"
                        ? "bg-green-500/15 text-green-500"
                        : r.status === "trialing"
                        ? "bg-blue-500/15 text-blue-400"
                        : "bg-red-500/15 text-red-500"
                    }`}
                  >
                    {r.status}
                    {r.cancel_at_period_end ? " (cancelling)" : ""}
                  </span>
                </td>
                <td className="px-3 py-2">
                  {money(r.amount, r.currency)}
                </td>
                <td className="px-3 py-2 text-muted-foreground">
                  {r.current_period_end
                    ? new Date(r.current_period_end * 1000).toLocaleDateString()
                    : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
