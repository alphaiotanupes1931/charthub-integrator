// Admin-only Stripe plan debug. Shows, for any account, the saved subscription
// status, the live Stripe price it maps to, the tier that resolves from it, and
// the remaining grade quota — so a gating complaint is one lookup, not a guess.
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Search, RefreshCw, AlertTriangle, Copy } from "lucide-react";
import { adminPlanDebug, type PlanDebugSnapshot } from "@/lib/billing.functions";

function usd(cents: number | null, currency: string | null) {
  if (cents == null) return "-";
  const code = (currency ?? "usd").toUpperCase();
  return `${(cents / 100).toLocaleString(undefined, { style: "currency", currency: code })}`;
}

function when(iso: string | null) {
  if (!iso) return "-";
  const t = Date.parse(iso);
  return Number.isFinite(t) ? new Date(t).toLocaleString() : "-";
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-border/50 py-2 last:border-0">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={`text-xs text-right ${mono ? "font-mono break-all" : "font-medium"}`}>{value}</span>
    </div>
  );
}

export function PlanDebugPanel() {
  const run = useServerFn(adminPlanDebug);
  const [query, setQuery] = useState("");
  const [snap, setSnap] = useState<PlanDebugSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function lookup(target?: string) {
    setLoading(true);
    setErr(null);
    try {
      const value = (target ?? query).trim();
      const res = await run({ data: value ? { email: value } : {} });
      setSnap(res);
    } catch (e) {
      setSnap(null);
      setErr(e instanceof Error ? e.message : "Lookup failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="rounded-xl border border-border bg-card p-4 md:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">Stripe plan debug</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Saved status, live Stripe price, resolved tier and remaining quota for one account.
          </p>
        </div>
        {snap && (
          <button
            onClick={() => lookup(snap.user.email ?? "")}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-semibold hover:bg-muted disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
          </button>
        )}
      </div>

      <form
        className="mt-3 flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void lookup();
        }}
      >
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Account email (blank = your own account)"
          className="min-w-[240px] flex-1 rounded-full border border-border bg-background px-3.5 py-1.5 text-xs outline-none focus:border-foreground/40"
        />
        <button
          type="submit"
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-full bg-foreground px-3.5 py-1.5 text-xs font-semibold text-background disabled:opacity-50"
        >
          <Search className="h-3.5 w-3.5" /> {loading ? "Looking up..." : "Look up"}
        </button>
      </form>

      {err && (
        <div className="mt-3 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">{err}</div>
      )}

      {snap && (
        <div className="mt-4 space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="rounded-full bg-muted px-2.5 py-1 font-semibold">{snap.user.email ?? snap.user.id}</span>
            <span className="rounded-full bg-foreground px-2.5 py-1 font-semibold uppercase text-background">
              {snap.resolved.tier}
            </span>
            <span className="rounded-full border border-border px-2.5 py-1">
              {snap.resolved.isPaid ? "Paid" : "Not paid"}
            </span>
            {snap.isAdmin && <span className="rounded-full border border-border px-2.5 py-1">Admin override</span>}
            {snap.resolved.onLegacyTrial && <span className="rounded-full border border-border px-2.5 py-1">Legacy trial</span>}
            <span className="rounded-full border border-border px-2.5 py-1">
              Free tier flag {snap.freeTierFlag ? "on" : "off"}
            </span>
          </div>

          {snap.mismatches.length > 0 && (
            <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2.5">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-destructive">
                <AlertTriangle className="h-3.5 w-3.5" /> Stripe and saved state disagree
              </div>
              <ul className="mt-1.5 space-y-1 text-xs text-destructive">
                {snap.mismatches.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="grid gap-4 md:grid-cols-3">
            <div className="rounded-lg border border-border p-3">
              <div className="text-xs font-semibold">Saved subscription</div>
              <div className="mt-2">
                {snap.db ? (
                  <>
                    <Row label="Status" value={snap.db.status ?? "none"} />
                    <Row label="Tier" value={snap.db.tier ?? "none"} />
                    <Row label="Renews / ends" value={when(snap.db.current_period_end)} />
                    <Row label="Cancel at period end" value={snap.db.cancel_at_period_end ? "yes" : "no"} />
                    <Row label="Trial end" value={when(snap.db.trial_end)} />
                    <Row label="Customer" value={snap.db.stripe_customer_id ?? "-"} mono />
                    <Row label="Subscription" value={snap.db.stripe_subscription_id ?? "-"} mono />
                    <Row label="Last synced" value={when(snap.db.updated_at)} />
                  </>
                ) : (
                  <p className="text-xs text-muted-foreground">No subscription row — this account resolves to Free.</p>
                )}
              </div>
            </div>

            <div className="rounded-lg border border-border p-3">
              <div className="flex items-center justify-between">
                <div className="text-xs font-semibold">Live Stripe</div>
                {snap.stripe?.priceId && (
                  <button
                    onClick={() => navigator.clipboard?.writeText(snap.stripe!.priceId!)}
                    className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
                  >
                    <Copy className="h-3 w-3" /> priceId
                  </button>
                )}
              </div>
              <div className="mt-2">
                {snap.stripe ? (
                  <>
                    <Row label="Status" value={snap.stripe.status} />
                    <Row label="Price ID" value={snap.stripe.priceId ?? "-"} mono />
                    <Row label="Lookup key" value={snap.stripe.lookupKey ?? "-"} mono />
                    <Row label="Plan tier from price" value={snap.stripe.tier ?? "unrecognised"} />
                    <Row
                      label="Amount"
                      value={`${usd(snap.stripe.amountCents, snap.stripe.currency)} / ${snap.stripe.interval ?? "-"}`}
                    />
                    <Row label="Cancel at period end" value={snap.stripe.cancelAtPeriodEnd ? "yes" : "no"} />
                    <Row label="Current period end" value={when(snap.stripe.currentPeriodEnd)} />
                    <Row label="Subscription" value={snap.stripe.subscriptionId} mono />
                  </>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    {snap.stripeError ?? "No Stripe subscription found for this account."}
                  </p>
                )}
              </div>
            </div>

            <div className="rounded-lg border border-border p-3">
              <div className="text-xs font-semibold">Quota and access</div>
              <div className="mt-2">
                <Row
                  label="Grade quota"
                  value={snap.quota.active ? `${snap.quota.remaining} of ${snap.quota.limit} left` : "Unlimited"}
                />
                <Row label="Used this month" value={snap.quota.active ? String(snap.quota.used) : "n/a"} />
                <Row label="Quota month" value={`${snap.quota.month} (${snap.quota.timezone})`} />
                <Row label="Exhausted" value={snap.quota.active && snap.quota.exhausted ? "yes" : "no"} />
                <Row label="Coaches" value={String(snap.resolved.coachAllowance)} />
              </div>
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {snap.resolved.capabilities.map((c) => (
                  <span key={c} className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium">
                    {c.replace(/_/g, " ")}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
