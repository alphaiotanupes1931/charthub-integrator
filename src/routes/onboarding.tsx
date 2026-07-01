import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { z } from "zod";
import { Copy, Check, Mail } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { LogoLink } from "@/components/LogoLink";
import { generateRecoveryCode } from "@/lib/recoveryCode";

async function hashRecoveryCode(code: string): Promise<string> {
  const bytes = new TextEncoder().encode(code.trim().toUpperCase());
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

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

type Step = "profile" | "recovery" | "confirm-skip";

function OnboardingPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>("profile");
  const [name, setName] = useState("");
  const [source, setSource] = useState("");
  const [busy, setBusy] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const recoveryCode = useMemo(() => generateRecoveryCode(), []);

  useEffect(() => {
    let cancelled = false;
    supabase.auth.getUser().then(({ data }) => {
      if (cancelled) return;
      if (!data.user) { navigate({ to: "/auth", replace: true }); return; }
      setUserId(data.user.id);
      setEmail(data.user.email ?? null);
      supabase.from("profiles").select("onboarded,display_name").eq("id", data.user.id).maybeSingle().then(({ data: p }) => {
        if (cancelled) return;
        if (p?.onboarded) navigate({ to: "/dashboard", replace: true });
        if (p?.display_name) setName(p.display_name);
      });
    });
    return () => { cancelled = true; };
  }, [navigate]);

  function onProfileSubmit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = schema.safeParse({ name, source });
    if (!parsed.success) { toast.error(parsed.error.issues[0]?.message ?? "Invalid"); return; }
    setStep("recovery");
  }

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(recoveryCode);
      setCopied(true);
      toast.success("Recovery code copied");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Couldn't copy. Select and copy manually.");
    }
  }

  function emailToSelf() {
    if (!email) return;
    const subject = encodeURIComponent("Your TradeMind recovery code");
    const body = encodeURIComponent(
      `Keep this safe. You'll use it to recover your TradeMind account if you forget your password.\n\nRecovery code: ${recoveryCode}\n\nDon't share this with anyone.`,
    );
    window.location.href = `mailto:${email}?subject=${subject}&body=${body}`;
  }

  async function finishOnboarding() {
    if (busy) return;
    if (!userId) return;
    const parsed = schema.safeParse({ name, source });
    if (!parsed.success) { toast.error("Missing profile info"); setStep("profile"); return; }
    setBusy(true);
    try {
      const recovery_code_hash = await hashRecoveryCode(recoveryCode);
      const { error } = await supabase.from("profiles").update({
        display_name: parsed.data.name,
        referral_source: parsed.data.source,
        recovery_code_hash,
        onboarded: true,
      }).eq("id", userId);
      if (error) throw error;
      toast.success("Welcome aboard");
      window.location.assign("/dashboard");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Couldn't save your profile";
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4 py-8">
      {busy && (
        <div
          className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-background/70 backdrop-blur-sm"
          aria-live="polite"
          aria-busy="true"
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.preventDefault()}
        >
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <p className="text-sm font-medium text-foreground">Saving your profile...</p>
          <p className="text-xs text-muted-foreground">Please don't close this tab.</p>
        </div>
      )}
      <div className="w-full max-w-md">

        <LogoLink to="/" size="lg" variant="brand" textClassName="text-2xl" className="justify-center mb-8" />
        <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
          {step === "profile" && (
            <>
              <h1 className="text-xl font-semibold">Let's get you set up</h1>
              <p className="mt-1 text-sm text-muted-foreground">Two quick questions before you start.</p>
              <form onSubmit={onProfileSubmit} className="mt-5 space-y-4">
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
                <Button type="submit" className="w-full">Continue</Button>
              </form>
            </>
          )}

          {step === "recovery" && (
            <>
              <h1 className="text-xl font-semibold">Your recovery code</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Save this code somewhere safe. If you ever forget your password, you'll use it together with your email to get back into your account.
              </p>

              <div className="mt-5 rounded-xl border-2 border-primary/40 bg-primary/5 p-4">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Recovery code</div>
                <div className="mt-2 font-mono text-xl sm:text-2xl tracking-widest text-foreground select-all break-all">
                  {recoveryCode}
                </div>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-2">
                <Button type="button" variant="outline" onClick={copyCode} className="gap-2">
                  {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  {copied ? "Copied" : "Copy"}
                </Button>
                <Button type="button" variant="outline" onClick={emailToSelf} className="gap-2">
                  <Mail className="h-4 w-4" /> Email it to me
                </Button>
              </div>

              <div className="mt-5 rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-foreground/80">
                <strong className="text-amber-500">Important:</strong> we don't store this in a way we can show you again. If you lose it and forget your password, you'll need to contact support.
              </div>

              <div className="mt-5 space-y-2">
                <p className="text-sm font-medium text-foreground">Did you write it down?</p>
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    type="button"
                    onClick={finishOnboarding}
                    disabled={busy}
                    className="w-full"
                  >
                    {busy ? "Saving..." : "Yes, continue"}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setStep("confirm-skip")}
                    disabled={busy}
                    className="w-full"
                  >
                    Not yet
                  </Button>
                </div>
              </div>
            </>
          )}

          {step === "confirm-skip" && (
            <>
              <h1 className="text-xl font-semibold">Don't lose this code</h1>
              <p className="mt-2 text-sm text-muted-foreground">
                Without your recovery code, the only way back into your account is the password reset email. We recommend emailing it to yourself so it's safe in your inbox.
              </p>

              <div className="mt-5 rounded-xl border border-border bg-muted/30 p-4">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Recovery code</div>
                <div className="mt-2 font-mono text-lg tracking-widest text-foreground select-all break-all">
                  {recoveryCode}
                </div>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-2">
                <Button type="button" variant="outline" onClick={emailToSelf} className="gap-2">
                  <Mail className="h-4 w-4" /> Email it to me
                </Button>
                <Button type="button" variant="outline" onClick={copyCode} className="gap-2">
                  {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  {copied ? "Copied" : "Copy"}
                </Button>
              </div>

              <div className="mt-5 grid grid-cols-2 gap-2">
                <Button type="button" variant="outline" onClick={() => setStep("recovery")} disabled={busy}>
                  Back
                </Button>
                <Button type="button" onClick={finishOnboarding} disabled={busy}>
                  {busy ? "Saving..." : "I've saved it, continue"}
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
