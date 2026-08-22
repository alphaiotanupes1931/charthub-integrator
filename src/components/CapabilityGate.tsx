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
 * Wraps a whole page. While entitlements load we render the page, so a paying
 * account never sees a flash of the lock screen.
 */
export function CapabilityGate({ capability, reason, title, body, children }: Props) {
  const ent = useEntitlements();
  const [open, setOpen] = useState(false);

  if (ent.loading || ent.allow(capability)) return <>{children}</>;

  return (
    <div className="max-w-3xl mx-auto py-10">
      <div className="rounded-xl border border-border bg-card p-8 text-center">
        <span className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
          <Lock className="h-5 w-5 text-muted-foreground" />
        </span>
        <h1 className="text-lg font-semibold text-foreground">{title}</h1>
        <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">{body}</p>
        <button
          onClick={() => setOpen(true)}
          className="mt-5 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90"
        >
          See plans
        </button>
      </div>
      <UpgradeModal open={open} onClose={() => setOpen(false)} reason={reason} />
    </div>
  );
}
