import { quotaLabel, type QuotaView } from "@/lib/entitlements";

/**
 * Visible from the first grade onward (§5) so the count is never a surprise at
 * the limit. Renders nothing at all for paid accounts.
 */
export function QuotaBadge({ quota, className = "" }: { quota: QuotaView; className?: string }) {
  const label = quotaLabel(quota);
  if (!label) return null;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium ${
        quota.exhausted
          ? "border-destructive/40 bg-destructive/10 text-destructive"
          : "border-border bg-accent/50 text-muted-foreground"
      } ${className}`}
      title="Free plan includes 3 signal grades each calendar month"
    >
      <span className="font-mono tabular-nums">{quota.remaining}/{quota.limit}</span>
      <span>grades left today</span>
    </span>
  );
}
