import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { LogoLink } from "@/components/LogoLink";

export const Route = createFileRoute("/onboarding")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Welcome, TradeMind" },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: OnboardingPage,
});

const SOURCES = [
  "Twitter / X",
  "YouTube",
  "Instagram",
  "TikTok",
  "Reddit",
  "Discord",
  "Friend / Referral",
  "Google Search",
  "Other",
];

const schema = z.object({
  name: z.string().trim().min(2, "Enter your full name").max(80),
  source: z.string().min(1, "Pick one"),
});

function OnboardingPage() {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [source, setSource] = useState("");
  const [busy, setBusy] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    supabase.auth.getUser().then(({ data }) => {
      if (cancelled) return;
      if (!data.user) { navigate({ to: "/auth", replace: true }); return; }
      setUserId(data.user.id);
      supabase.from("profiles").select("onboarded,display_name").eq("id", data.user.id).maybeSingle().then(({ data: p }) => {
        if (cancelled) return;
        if (p?.onboarded) navigate({ to: "/dashboard", replace: true });
        if (p?.display_name) setName(p.display_name);
      });
    });
    return () => { cancelled = true; };
  }, [navigate]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = schema.safeParse({ name, source });
    if (!parsed.success) { toast.error(parsed.error.issues[0]?.message ?? "Invalid"); return; }
    if (!userId) return;
    setBusy(true);
    const { error } = await supabase.from("profiles").upsert({
      id: userId,
      display_name: parsed.data.name,
      referral_source: parsed.data.source,
      onboarded: true,
    });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Welcome aboard");
    navigate({ to: "/dashboard", replace: true });
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-md">
        <div className="flex items-center justify-center gap-2.5 mb-8">
          <img src={logoAsset.url} alt="TradeMind" className="h-12 w-12 object-contain" />
          <span className="font-display text-2xl font-semibold tracking-tight">
            <span className="text-foreground">Trade</span>
            <span className="text-gold-gradient">Mind</span>
          </span>
        </div>
        <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
          <h1 className="text-xl font-semibold">Let's get you set up</h1>
          <p className="mt-1 text-sm text-muted-foreground">Two quick questions before you start.</p>

          <form onSubmit={onSubmit} className="mt-5 space-y-4">
            <div>
              <label className="text-xs font-medium text-muted-foreground" htmlFor="name">Your name</label>
              <input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="First and last"
                className="mt-1 w-full h-10 rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus:border-primary/50"
                maxLength={80}
                required
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">How did you find us?</label>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {SOURCES.map((s) => {
                  const active = source === s;
                  return (
                    <button
                      type="button"
                      key={s}
                      onClick={() => setSource(s)}
                      className={`h-10 rounded-md border px-3 text-sm font-medium transition text-left ${
                        active ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground"
                      }`}
                    >
                      {s}
                    </button>
                  );
                })}
              </div>
            </div>
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? "Saving..." : "Continue"}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
