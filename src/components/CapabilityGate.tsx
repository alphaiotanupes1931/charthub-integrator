import { useState, type ReactNode } from "react";
import { Lock } from "lucide-react";
import { UpgradeModal } from "@/components/UpgradeModal";
import { useEntitlements } from "@/hooks/useEntitlements";
import type { Capability } from "@/lib/entitlements";

type Props = {
  capability: Capability;
  reason: "grades" | "analytics" | "coaches" | "signals" | "autopilot" | "academy" | "broker";
  title: string;
  body: string;
  children: ReactNode;
};

/**
 * Wraps a whole page. While entitlements are still resolving we render a neutral
 * placeholder rather than the page: a paying account never sees a flash of the
 * lock screen, and a free account never mounts the paid page long enough to fire
 * its gated requests (those come back 403 and used to crash the page before the
 * lock could appear).
 */
export function CapabilityGate({ capability, reason, title, body, children }: Props) {
  const ent = useEntitlements();
  const [open, setOpen] = useState(false);

  if (ent.loading) {
    return (
      <div className="max-w-3xl mx-auto py-10" data-testid="capability-gate-loading" aria-busy="true">
        <div className="h-32 animate-pulse rounded-xl border border-border bg-card" />
      </div>
    );
  }

  if (ent.allow(capability)) return <>{children}</>;


  return (
    <div className="max-w-3xl mx-auto py-10" data-testid="capability-lock" data-capability={capability}>
      <div className="rounded-xl border border-border bg-card p-8 text-center">
        <span className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
          <Lock className="h-5 w-5 text-muted-foreground" />
        </span>
        <h1 className="text-lg font-semibold text-foreground" data-testid="lock-title">{title}</h1>
        <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted-foreground" data-testid="lock-body">{body}</p>
        <button
          onClick={() => setOpen(true)}
          data-testid="lock-cta"
          className="mt-5 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90"
        >
          See plans
        </button>
      </div>
      <UpgradeModal open={open} onClose={() => setOpen(false)} reason={reason} />
    </div>
  );
}
