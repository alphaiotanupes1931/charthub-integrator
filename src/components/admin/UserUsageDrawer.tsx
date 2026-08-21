import { useEffect, useState } from "react";
import { Loader2, X } from "lucide-react";
import { adminImageUsage } from "@/lib/admin.functions";
import { listManualRevenue } from "@/lib/revenue.functions";

const usd = (n: number) => `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export type DrawerUser = {
  id: string;
  email: string | null;
  display_name: string | null;
  role?: string | null;
};

export type DrawerAiSpend = { cost_usd: number; calls: number; graded_setups?: number } | undefined;

/**
 * Per-person money detail: what they pay, what their AI chat and screenshot
 * reads cost, and what is left over for that one account.
 */
export function UserUsageDrawer({
  user,
  aiSpend,
  onClose,
}: {
  user: DrawerUser;
  aiSpend: DrawerAiSpend;
  onClose: () => void;
}) {
  const [images, setImages] = useState<Awaited<ReturnType<typeof adminImageUsage>> | null>(null);
  const [pays, setPays] = useState<number | null>(null);

  useEffect(() => {
    adminImageUsage({ data: { days: 30 } })
      .then(setImages)
      .catch(() => setImages(null));
    listManualRevenue()
      .then((rows) => {
        const email = (user.email ?? "").trim().toLowerCase();
        const match = (rows ?? []).find(
          (r) => r.active && (r.email ?? "").trim().toLowerCase() === email && email !== "",
        );
        setPays(match ? Number(match.monthly_amount_cents) / 100 : 0);
      })
      .catch(() => setPays(0));
  }, [user.id, user.email]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const isAdmin = (user.role ?? "user") === "admin";
  const row = images?.rows.find((r) => r.user_id === user.id);
  const aiCost = Number(aiSpend?.cost_usd ?? 0);
  const imageCost = Number(row?.est_cost_usd ?? 0);
  const loading = images === null || pays === null;
  const profit = (pays ?? 0) - aiCost - imageCost;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button aria-label="Close" onClick={onClose} className="absolute inset-0 bg-background/70 backdrop-blur-sm" />
      <aside className="relative z-10 h-full w-full max-w-[420px] overflow-y-auto border-l border-border/60 bg-card p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-sm font-semibold tracking-tight flex items-center gap-2">
              {user.display_name ?? user.email ?? "Unknown"}
              {isAdmin && (
                <span className="rounded-full border border-border/60 bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Admin
                </span>
              )}
            </div>
            <div className="mt-0.5 text-xs text-muted-foreground break-all">{user.email ?? "-"}</div>
          </div>
          <button
            onClick={onClose}
            className="rounded-xl border border-border/60 p-1.5 text-muted-foreground hover:bg-muted"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {loading ? (
          <div className="mt-8 flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading usage
          </div>
        ) : (
          <>
            <div className="mt-5 grid grid-cols-2 gap-3">
              <Stat label="Pays / mo" value={pays ? usd(pays) : "Free"} />
              <Stat label="AI chat cost" value={usd(aiCost)} hint={`${Number(aiSpend?.calls ?? 0).toLocaleString()} calls`} />
              <Stat
                label="Screenshot cost"
                value={usd(imageCost)}
                hint={`${Number(row?.images ?? 0).toLocaleString()} reads${isAdmin ? ", no limit" : ""}`}
              />
              <Stat
                label="You keep"
                value={usd(profit)}
                tone={profit < 0 ? "bad" : profit > 0 ? "good" : "flat"}
              />
            </div>

            <dl className="mt-5 divide-y divide-border rounded-2xl border border-border/60">
              <Line label="AI requests, 30 days" value={Number(row?.requests ?? 0).toLocaleString()} />
              <Line label="Graded setups" value={Number(aiSpend?.graded_setups ?? 0).toLocaleString()} />
              <Line label="Active days" value={Number(row?.active_days ?? 0).toLocaleString()} />
              <Line label="Last screenshot read" value={row?.last_day ?? "Never"} />
              <Line label="Total AI spend" value={usd(aiCost + imageCost)} />
            </dl>

            <p className="mt-4 text-[11px] text-muted-foreground">
              Screenshot cost is estimated at {usd(images?.totals.est_cost_per_image ?? 0)} per read, based on real
              spend over the last 30 days. Profit is what they pay minus both AI numbers.
            </p>
          </>
        )}
      </aside>
    </div>
  );
}

function Stat({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "good" | "bad" | "flat" }) {
  const cls = tone === "bad" ? "text-destructive" : tone === "good" ? "text-bull" : "";
  return (
    <div className="rounded-2xl border border-border/60 bg-background p-4">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className={`mt-1 text-xl font-semibold tabular-nums ${cls}`}>{value}</div>
      {hint && <div className="mt-0.5 text-[11px] text-muted-foreground">{hint}</div>}
    </div>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between px-4 py-2.5 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="tabular-nums font-medium">{value}</dd>
    </div>
  );
}
