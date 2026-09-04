import { useEffect } from "react";
import { Link } from "@tanstack/react-router";
import { X } from "lucide-react";
import { track } from "@/lib/product-events";

type Props = {
  open: boolean;
  onClose: () => void;
  /** Which surface asked for the upgrade — drives the headline and copy. */
  reason: "grades" | "analytics" | "coaches" | "signals" | "autopilot" | "academy" | "broker";
  used?: number;
  limit?: number;
};

const COPY: Record<Props["reason"], { title: string; body: string }> = {
  grades: {
    title: "You've used your 2 free grades today",
    body: "Your journal, risk calculator, alerts and Academy basics stay free. Upgrade for unlimited signal grades, or come back on the 1st when your grades reset.",
  },
  analytics: {
    title: "Analytics is part of the paid plan",
    body: "Your trades are being recorded and nothing is lost. Upgrade to see win rate, expectancy and the patterns behind your results.",
  },
  coaches: {
    title: "This coach is part of the paid plan",
    body: "The Analyst stays free. Upgrade to unlock the full coaching layer and trading memory across your sessions.",
  },
  signals: {
    title: "The signal engine is part of the paid plan",
    body: "Upgrade to get scanned setups across every instrument, plus the strategy library win rates behind them.",
  },
  autopilot: {
    title: "Autopilot is part of the Elite plan",
    body: "Upgrade to Elite to send graded setups straight to your broker with your own risk rails in place.",
  },
  academy: {
    title: "This module is part of the paid plan",
    body: "Academy basics and flashcards are free forever. Upgrade for the full curriculum.",
  },
  broker: {
    title: "Broker execution is part of the paid plan",
    body: "Upgrade to place and manage trades from your setups without leaving the app.",
  },
};

/**
 * Shown at the moment of intent — the 4th grade, opening Analytics — never as an
 * interstitial before the user has tried to do the thing (§5).
 */
export function UpgradeModal({ open, onClose, reason, used, limit }: Props) {
  useEffect(() => {
    if (open) track("paywall_shown", { reason, used: used ?? null, limit: limit ?? null });
  }, [open, reason, used, limit]);

  if (!open) return null;
  const copy = COPY[reason];
  const dismiss = () => {
    track("paywall_dismissed", { reason });
    onClose();
  };
  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" data-testid="upgrade-modal" data-reason={reason}>
      <div className="w-full max-w-md rounded-t-2xl border border-border bg-card p-6 sm:rounded-xl">
        <div className="flex items-start justify-between gap-4">
          <h2 className="text-base font-semibold text-foreground" data-testid="upgrade-title">{copy.title}</h2>
          <button onClick={dismiss} className="rounded-full p-1 text-muted-foreground hover:bg-accent" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>

        {typeof used === "number" && typeof limit === "number" && (
          <p className="mt-3 font-mono text-xs text-muted-foreground">{used} of {limit} used today</p>
        )}

        <p className="mt-3 text-sm leading-relaxed text-muted-foreground" data-testid="upgrade-body">{copy.body}</p>

        <div className="mt-6 flex flex-col gap-2">
          <Link
            to="/pricing"
            onClick={() => {
              track("upgrade_cta_clicked", { reason });
              onClose();
            }}
            data-testid="upgrade-primary-cta"
            className="inline-flex h-10 items-center justify-center rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground hover:opacity-90"
          >
            See plans
          </Link>
          <button
            onClick={dismiss}
            data-testid="upgrade-secondary-cta"
            className="inline-flex h-10 items-center justify-center rounded-lg border border-border px-4 text-sm font-medium text-foreground hover:bg-accent"
          >
            Keep using the free plan
          </button>
        </div>
      </div>
    </div>
  );
}
