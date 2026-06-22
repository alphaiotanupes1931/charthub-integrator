import { createFileRoute, useNavigate, useSearch, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { signUpConfirmed } from "@/lib/auth.functions";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import logoAsset from "@/assets/logo.png.asset.json";
import { readActiveCoach, readJournal } from "@/lib/chat-client";
import {
  buildWelcomeBackRecap,
  isWelcomeBackMuted,
  latestJournalTrade,
  speakWithElevenLabs,
  spokenName,
  WELCOME_BACK_REQUEST_KEY,
  WELCOME_BACK_SESSION_KEY,
  type JournalTrade,
} from "@/lib/welcomeBack";

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

async function buildLoginWelcomeRecap() {
  const [{ data: userData }, { data: profile }, { data: thread }] = await Promise.all([
    supabase.auth.getUser(),
    supabase.from("profiles").select("display_name,email").maybeSingle(),
    supabase.from("chat_threads").select("id,title,updated_at").order("updated_at", { ascending: false }).limit(1).maybeSingle(),
  ]);

  let lastAssistant: string | null = null;
  let lastUser: string | null = null;
  if (thread?.id) {
    const { data: msgs } = await supabase
      .from("chat_messages")
      .select("role,parts,created_at")
      .eq("thread_id", thread.id)
      .order("created_at", { ascending: false })
      .limit(8);
    for (const m of msgs ?? []) {
      const parts = (m.parts ?? []) as Array<{ type: string; text?: string }>;
      const text = parts.filter((p) => p.type === "text" && p.text).map((p) => p.text!).join(" ").trim();
      if (!text) continue;
      if (!lastAssistant && m.role === "assistant") lastAssistant = text;
      if (!lastUser && m.role === "user") lastUser = text;
      if (lastAssistant && lastUser) break;
    }
  }

  const name = spokenName(profile?.display_name, profile?.email ?? userData.user?.email ?? null);
  const trades = readJournal() as JournalTrade[];
  return buildWelcomeBackRecap(name, latestJournalTrade(trades), lastAssistant, thread?.title ?? null, lastUser);
}

function AuthPage() {
  const navigate = useNavigate();
  const search = useSearch({ from: "/auth" });
  const [mode, setMode] = useState<"signin" | "signup">(search.mode ?? "signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  // Already signed in? Bounce to redirect target (honoring any pending invite).
  useEffect(() => {
    let cancelled = false;
    supabase.auth.getUser().then(({ data }) => {
      if (cancelled || !data.user) return;
      let target = search.redirect || "/dashboard";
      try {
        const pending = localStorage.getItem("trademind.pendingInvite");
        if (pending) target = `/invite/${pending}`;
      } catch { /* ignore */ }
      navigate({ to: target, replace: true });
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
    // Pre-create an Audio element inside the user gesture so .play() will
    // be allowed after we receive the ElevenLabs MP3 bytes.
    let welcomeAudio: HTMLAudioElement | null = null;
    if (typeof window !== "undefined" && typeof Audio !== "undefined") {
      welcomeAudio = new Audio();
      (window as Window & { __trademindWelcomeAudio?: HTMLAudioElement }).__trademindWelcomeAudio = welcomeAudio;
    }
    setBusy(true);
    try {
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword(parsed.data);
        if (error) throw error;
        toast.success("Signed in");
      } else {
        await signUpConfirmed({ data: parsed.data });
        const { error } = await supabase.auth.signInWithPassword(parsed.data);
        if (error) throw error;
        toast.success("Account created");
      }
      // Claim the welcome slot IMMEDIATELY so the post-nav WelcomeBackGreeter
      // does not also start its own playback (which caused two overlapping voices).
      try { sessionStorage.setItem(WELCOME_BACK_SESSION_KEY, "1"); } catch { /* ignore */ }
      try {
        let recap: string;
        if (mode === "signup") {
          const name = spokenName(null, parsed.data.email);
          recap = `Hi ${name}, welcome to TradeMind. Make sure to complete your profile and pick your coach so I can tailor your feedback. I am here whenever you have questions — just click the chatbot in the bottom right corner and I will jump in.`;
        } else {
          recap = await Promise.race([
            buildLoginWelcomeRecap(),
            new Promise<string>((resolve) =>
              window.setTimeout(() => resolve(`Welcome back, ${spokenName(null, parsed.data.email)}. Ready when you are.`), 1600),
            ),
          ]);
        }
        // Fire-and-forget: don't block navigation on TTS fetch.
        void speakWithElevenLabs(recap, readActiveCoach(), welcomeAudio);
      } catch {
        void speakWithElevenLabs(
          `Welcome back, ${spokenName(null, parsed.data.email)}. Ready when you are.`,
          readActiveCoach(),
          welcomeAudio,
        );
      }
      let target = search.redirect || "/dashboard";
      try {
        const pending = localStorage.getItem("trademind.pendingInvite");
        if (pending) target = `/invite/${pending}`;
        localStorage.removeItem(WELCOME_BACK_REQUEST_KEY);
      } catch { /* ignore */ }
      navigate({ to: target, replace: true });
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
