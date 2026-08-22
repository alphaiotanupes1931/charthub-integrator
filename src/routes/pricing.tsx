import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Check, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { LogoLink } from "@/components/LogoLink";
import { supabase } from "@/integrations/supabase/client";
import { createCheckoutSession } from "@/lib/billing.functions";
import { useFreeTierFlag } from "@/hooks/useFreeTierFlag";

export const Route = createFileRoute("/pricing")({
  ssr: false,
  head: () => ({ meta: [{ title: "Choose your plan, TradeMind" }] }),
  component: PricingPage,
});

const PLANS = [
  {
    id: "basic" as const,
    name: "Basic",
    price: 49,
    features: ["1 instrument", "Generic AI coach", "Trade journal", "Web access"],
    popular: false,
  },
  {
    id: "pro" as const,
    name: "Pro",
    price: 97,
    features: ["5 instruments", "All 5 AI coaches", "Pattern detection", "Voice coach", "Broker integration", "Mobile app"],
    popular: true,
  },
  {
    id: "elite" as const,
    name: "Elite",
    price: 197,
    features: ["Unlimited instruments", "Custom strategies", "Priority scans", "1:1 onboarding", "Direct support"],
    popular: false,
  },
];

function PricingPage() {
  const checkout = useServerFn(createCheckoutSession);
  const [userReady, setUserReady] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const freeTier = useFreeTierFlag();
  const [hasHadTrial, setHasHadTrial] = useState(false);
  const [inactive, setInactive] = useState(false);
  const [loading, setLoading] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    supabase.auth.getUser().then(async ({ data }) => {
      if (cancelled) return;
      const user = data.user;
      setSignedIn(!!user);
      if (user) {
        const { data: sub } = await supabase
          .from("subscriptions")
          .select("status,trial_end")
          .eq("user_id", user.id)
          .maybeSingle();
        if (!cancelled) {
          const status = sub?.status ?? null;
          setHasHadTrial(!!sub?.trial_end);
          setInactive(!!status && !["active", "trialing"].includes(status));
        }
      }
      if (!cancelled) setUserReady(true);
    });
    return () => { cancelled = true; };
  }, []);

  async function start(tier: "basic" | "pro" | "elite") {
    setLoading(tier);
    try {
      if (!signedIn) {
        window.location.assign(`/auth?mode=signup&redirect=${encodeURIComponent("/pricing")}`);
        return;
      }
      const { url } = await checkout({ data: { tier } });
      if (url) window.location.assign(url);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not start checkout");
      setLoading(null);
    }
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border/60 bg-background/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
          <LogoLink to="/" size="lg" variant="brand" glow />
          <div className="flex items-center gap-2">
            {signedIn ? (
              <Button asChild variant="outline" size="sm">
                <Link to="/dashboard">Dashboard</Link>
              </Button>
            ) : (
              <Button asChild variant="outline" size="sm">
                <Link to="/auth">Sign in</Link>
              </Button>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-12">
        <div className="mb-10 text-center">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-border/60 bg-card/60 px-3 py-1 text-xs text-muted-foreground">
            <Sparkles className="h-3 w-3" />
            {freeTier ? "Free plan available, upgrade anytime" : hasHadTrial ? "Reactivate your subscription" : "7-day free trial on any plan"}
          </div>
          <h1 className="font-display text-4xl font-medium tracking-tight sm:text-5xl">Choose your plan</h1>
          <p className="mx-auto mt-3 max-w-xl text-muted-foreground">
            {inactive
              ? "Your subscription is inactive. Pick a plan to keep using TradeMind."
              : freeTier
                ? "The free plan gives you 3 signal grades a month, plus journal and Academy basics forever. Upgrade for the coaching layer and analytics."
                : "Start free for 7 days. Cancel anytime from your billing portal."}
          </p>
          {!signedIn && userReady && (
            <p className="mx-auto mt-3 max-w-xl text-xs text-muted-foreground">
              You can choose a plan now. We will ask you to create an account before checkout.
            </p>
          )}
        </div>

        <div className={`grid gap-6 ${freeTier ? "md:grid-cols-2 lg:grid-cols-4" : "md:grid-cols-3"}`}>
          {freeTier && (
            <div className="relative flex flex-col rounded-2xl border border-border/60 bg-card/40 p-8">
              <div className="text-sm font-medium uppercase tracking-[0.2em] text-muted-foreground">Free</div>
              <div className="mt-4 flex items-baseline">
                <span className="text-2xl text-muted-foreground">$</span>
                <span className="font-display text-5xl font-medium">0</span>
                <span className="ml-1 text-sm text-muted-foreground">/month</span>
              </div>
              <ul className="mt-6 flex-1 space-y-3">
                {[
                  "3 signal grades a month",
                  "Trade journal, unlimited trades",
                  "Risk calculator",
                  "Price alerts",
                  "Academy basics, first 3 modules",
                  "Flashcards and community",
                ].map((f) => (
                  <li key={f} className="flex items-start gap-2 text-sm">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
              <Link
                to="/auth"
                search={{ mode: "signup" } as never}
                className="mt-8 flex h-11 items-center justify-center rounded-2xl border border-border bg-transparent text-sm font-medium hover:bg-muted/50"
              >
                Create free account
              </Link>
            </div>
          )}
          {PLANS.map((p) => (
            <div

              key={p.id}
              className={`relative flex flex-col rounded-2xl border p-8 ${p.popular ? "border-primary bg-primary/5" : "border-border/60 bg-card/40"}`}
            >
              {p.popular && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-primary px-3 py-1 text-[10px] font-medium tracking-tight text-primary-foreground">
                  Most popular
                </div>
              )}
              <div className="text-sm font-medium uppercase tracking-[0.2em] text-muted-foreground">{p.name}</div>
              <div className="mt-4 flex items-baseline">
                <span className="text-2xl text-muted-foreground">$</span>
                <span className="font-display text-5xl font-medium">{p.price}</span>
                <span className="ml-1 text-sm text-muted-foreground">/month</span>
              </div>
              <ul className="mt-6 flex-1 space-y-3">
                {p.features.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-sm">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                onClick={() => start(p.id)}
                disabled={loading !== null}
                className={`mt-8 flex h-11 items-center justify-center gap-2 rounded-2xl text-sm font-medium transition-colors ${
                  p.popular ? "bg-primary text-primary-foreground hover:bg-primary/90" : "bg-foreground text-background hover:bg-foreground/90"
                } disabled:cursor-not-allowed disabled:opacity-50`}
              >
                {loading === p.id ? <Loader2 className="h-4 w-4 animate-spin" /> : freeTier || hasHadTrial ? "Subscribe" : "Start 7-day free trial"}
              </button>
            </div>
          ))}
        </div>

        <p className="mt-8 text-center text-xs text-muted-foreground">
          Secured by Stripe. Cancel anytime. {signedIn ? <Link to="/settings" className="underline">Back to settings</Link> : <Link to="/" className="underline">Back home</Link>}
        </p>
      </main>
    </div>
  );
}