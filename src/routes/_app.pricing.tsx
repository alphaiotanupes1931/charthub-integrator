import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useSuspenseQuery } from "@tanstack/react-query";
import { Check, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import {
  createCheckoutSession,
  getMySubscription,
} from "@/lib/billing.functions";

export const Route = createFileRoute("/_app/pricing")({
  head: () => ({ meta: [{ title: "Choose your plan, TradeMind" }] }),
  component: PricingPage,
});

const PLANS = [
  {
    id: "basic" as const,
    name: "Basic",
    price: 49,
    features: [
      "1 instrument",
      "Generic AI coach",
      "Trade journal",
      "Web access",
    ],
    popular: false,
  },
  {
    id: "pro" as const,
    name: "Pro",
    price: 97,
    features: [
      "5 instruments",
      "All 5 AI coaches",
      "Pattern detection",
      "Voice coach",
      "Broker integration",
      "Mobile app",
    ],
    popular: true,
  },
  {
    id: "elite" as const,
    name: "Elite",
    price: 197,
    features: [
      "Unlimited instruments",
      "Custom strategies",
      "Priority scans",
      "1:1 onboarding",
      "Direct support",
    ],
    popular: false,
  },
];

function PricingPage() {
  const checkout = useServerFn(createCheckoutSession);
  const getSub = useServerFn(getMySubscription);
  const [loading, setLoading] = useState<string | null>(null);

  const { data: sub } = useSuspenseQuery({
    queryKey: ["my-subscription"],
    queryFn: () => getSub(),
    staleTime: 30_000,
  });

  const status = sub?.status ?? null;
  const hasHadTrial = !!sub?.trial_end;
  const inactive =
    status && !["active", "trialing"].includes(status);

  async function start(tier: "basic" | "pro" | "elite") {
    setLoading(tier);
    try {
      const { url } = await checkout({ data: { tier } });
      if (url) window.location.assign(url);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not start checkout");
      setLoading(null);
    }
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-12">
      <div className="text-center mb-10">
        <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card/60 px-3 py-1 text-xs text-muted-foreground mb-4">
          <Sparkles className="w-3 h-3" />
          {hasHadTrial ? "Reactivate your subscription" : "7-day free trial on any plan"}
        </div>
        <h1 className="font-display text-4xl sm:text-5xl font-medium tracking-tight">
          Choose your plan
        </h1>
        <p className="text-muted-foreground mt-3 max-w-xl mx-auto">
          {inactive
            ? "Your subscription is inactive. Pick a plan to keep using TradeMind."
            : "Start free for 7 days. Cancel anytime from your billing portal."}
        </p>
      </div>

      <div className="grid md:grid-cols-3 gap-6">
        {PLANS.map((p) => (
          <div
            key={p.id}
            className={`relative rounded-2xl border p-8 flex flex-col ${
              p.popular
                ? "border-primary bg-primary/5"
                : "border-border bg-card/40"
            }`}
          >
            {p.popular && (
              <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-primary px-3 py-1 text-[10px] font-medium tracking-wider uppercase text-primary-foreground">
                Most popular
              </div>
            )}
            <div className="text-sm font-medium tracking-[0.2em] uppercase text-muted-foreground">
              {p.name}
            </div>
            <div className="mt-4 flex items-baseline">
              <span className="text-2xl text-muted-foreground">$</span>
              <span className="font-display text-5xl font-medium">{p.price}</span>
              <span className="text-sm text-muted-foreground ml-1">/month</span>
            </div>
            <ul className="mt-6 space-y-3 flex-1">
              {p.features.map((f) => (
                <li key={f} className="flex items-start gap-2 text-sm">
                  <Check className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                  <span>{f}</span>
                </li>
              ))}
            </ul>
            <button
              type="button"
              onClick={() => start(p.id)}
              disabled={loading !== null}
              className={`mt-8 h-11 rounded-lg font-medium text-sm transition-colors ${
                p.popular
                  ? "bg-primary text-primary-foreground hover:bg-primary/90"
                  : "bg-foreground text-background hover:bg-foreground/90"
              } disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2`}
            >
              {loading === p.id ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : hasHadTrial ? (
                "Subscribe"
              ) : (
                "Start 7-day free trial"
              )}
            </button>
          </div>
        ))}
      </div>

      <p className="text-center text-xs text-muted-foreground mt-8">
        Secured by Stripe. Cancel anytime.{" "}
        <Link to="/settings" className="underline">
          Back to settings
        </Link>
      </p>
    </div>
  );
}
