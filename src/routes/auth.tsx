import { createFileRoute, useNavigate, useSearch, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { signUpConfirmed } from "@/lib/auth.functions";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import logoAsset from "@/assets/logo.png.asset.json";

const searchSchema = z.object({
  redirect: z.string().optional(),
  mode: z.enum(["signin", "signup"]).optional(),
});

export const Route = createFileRoute("/auth")({
  validateSearch: (s) => searchSchema.parse(s),
  ssr: false,
  head: () => ({
    meta: [
      { title: "Sign in, TradeMind" },
      { name: "description", content: "Sign in to your TradeMind account to access your AI trading coach, journal, and analytics." },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: AuthPage,
});

const credSchema = z.object({
  email: z.string().trim().email("Enter a valid email").max(255),
  password: z.string().min(8, "Password must be at least 8 characters").max(72),
});

function AuthPage() {
  const navigate = useNavigate();
  const search = useSearch({ from: "/auth" });
  const [mode, setMode] = useState<"signin" | "signup">(search.mode ?? "signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  // Already signed in? Bounce to redirect target.
  useEffect(() => {
    let cancelled = false;
    supabase.auth.getUser().then(({ data }) => {
      if (!cancelled && data.user) {
        navigate({ to: search.redirect || "/dashboard", replace: true });
      }
    });
    return () => { cancelled = true; };
  }, [navigate, search.redirect]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = credSchema.safeParse({ email, password });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Invalid input");
      return;
    }
    setBusy(true);
    try {
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword(parsed.data);
        if (error) throw error;
        toast.success("Signed in");
      } else {
        const { error } = await supabase.auth.signUp({
          email: parsed.data.email,
          password: parsed.data.password,
          options: { emailRedirectTo: window.location.origin },
        });
        if (error) throw error;
        toast.success("Account created");
      }
      navigate({ to: search.redirect || "/dashboard", replace: true });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Authentication failed";
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        <Link to="/" className="flex items-center justify-center gap-2.5 mb-8">
          <img src={logoAsset.url} alt="TradeMind" className="h-12 w-12 object-contain" />
          <span className="font-display text-2xl font-semibold tracking-tight">
            <span className="text-foreground">Trade</span>
            <span className="text-gold-gradient">Mind</span>
          </span>
        </Link>

        <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
          <h1 className="text-xl font-semibold text-foreground">
            {mode === "signin" ? "Sign in" : "Create your account"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {mode === "signin"
              ? "Welcome back. Pick up where you left off."
              : "Track trades, talk to your AI coach, build your edge."}
          </p>

          <form onSubmit={onSubmit} className="mt-5 space-y-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground" htmlFor="email">Email</label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1 w-full h-10 rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus:border-primary/50"
                required
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground" htmlFor="password">Password</label>
              <input
                id="password"
                type="password"
                autoComplete={mode === "signin" ? "current-password" : "new-password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1 w-full h-10 rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus:border-primary/50"
                minLength={8}
                maxLength={72}
                required
              />
              {mode === "signup" && (
                <p className="mt-1 text-[11px] text-muted-foreground">At least 8 characters.</p>
              )}
            </div>
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? "Please wait..." : mode === "signin" ? "Sign in" : "Create account"}
            </Button>
          </form>

          <div className="mt-4 text-center text-xs text-muted-foreground">
            {mode === "signin" ? (
              <>
                Need an account?{" "}
                <button onClick={() => setMode("signup")} className="text-primary hover:underline">
                  Create one
                </button>
              </>
            ) : (
              <>
                Already have an account?{" "}
                <button onClick={() => setMode("signin")} className="text-primary hover:underline">
                  Sign in
                </button>
              </>
            )}
          </div>
        </div>

        <div className="mt-6 text-center">
          <Link to="/" className="text-xs text-muted-foreground hover:text-foreground">
            ← Back to home
          </Link>
        </div>
      </div>
    </div>
  );
}
