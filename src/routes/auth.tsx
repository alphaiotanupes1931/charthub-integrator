import { createFileRoute, useNavigate, useSearch, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { signUpConfirmed } from "@/lib/auth.functions";
import { strongPasswordSchema } from "@/lib/api-security";
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
  banned: z.string().optional(),
  force: z.string().optional(),
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

const signInSchema = z.object({
  email: z.string().trim().email("Enter a valid email").max(255),
  password: z.string().min(1, "Password is required").max(72),
});

const signUpSchema = z.object({
  email: z.string().trim().email("Enter a valid email").max(255),
  password: strongPasswordSchema,
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
  const [showPassword, setShowPassword] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [resetMode, setResetMode] = useState(false);
  const [resetSent, setResetSent] = useState(false);

  useEffect(() => {
    if (search.banned === "1") {
      toast.error("This account has been suspended. Contact support if you believe this is a mistake.");
    }
  }, [search.banned]);

  // Already signed in? Bounce to redirect target (honoring any pending invite).
  useEffect(() => {
    let cancelled = false;
    if (search.force === "1") {
      supabase.auth.signOut().catch(() => {});
      return () => { cancelled = true; };
    }
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
  }, [navigate, search.force, search.redirect]);

  async function onResetSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg(null);
    const parsed = z.string().trim().email("Enter a valid email").max(255).safeParse(email);
    if (!parsed.success) {
      setErrorMsg(parsed.error.issues[0]?.message ?? "Invalid email");
      return;
    }
    setBusy(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(parsed.data, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (error) throw error;
      setResetSent(true);
      toast.success("Password reset email sent");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Could not send reset email";
      setErrorMsg(msg);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg(null);
    const schema = mode === "signup" ? signUpSchema : signInSchema;
    const parsed = schema.safeParse({ email, password });
    if (!parsed.success) {
      const m = parsed.error.issues[0]?.message ?? "Invalid input";
      setErrorMsg(m);
      toast.error(m);
      return;
    }
    // Pre-create an Audio element inside the user gesture so .play() will
    // be allowed after we receive the ElevenLabs MP3 bytes. Mobile Safari
    // requires the element to actually start playing inside the gesture, so
    // we prime it with a tiny silent WAV and immediately call .play().
    let welcomeAudio: HTMLAudioElement | null = null;
    const muted = isWelcomeBackMuted();
    if (!muted && typeof window !== "undefined" && typeof Audio !== "undefined") {
      welcomeAudio = new Audio();
      welcomeAudio.preload = "auto";
      // 1-frame silent WAV - primes the element so a later src swap can play.
      welcomeAudio.src =
        "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=";
      welcomeAudio.play().then(() => welcomeAudio?.pause()).catch(() => {});
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
      if (!muted) {
        try {
          let recap: string;
          if (mode === "signup") {
            const name = spokenName(null, parsed.data.email);
            recap = `Hi ${name}, welcome to TradeMind. Make sure to complete your profile and pick your coach so I can tailor your feedback. I am here whenever you have questions - just click the chatbot in the bottom right corner and I will jump in.`;
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
      }
      let target = search.redirect || "/dashboard";
      try {
        const pending = localStorage.getItem("trademind.pendingInvite");
        if (pending) target = `/invite/${pending}`;
        localStorage.removeItem(WELCOME_BACK_REQUEST_KEY);
      } catch { /* ignore */ }
      navigate({ to: target, replace: true });
    } catch (err: unknown) {
      let msg = err instanceof Error ? err.message : "Authentication failed";
      if (/invalid login credentials/i.test(msg)) {
        msg = "Incorrect email or password. Please try again.";
      } else if (/user already registered|already exists/i.test(msg)) {
        msg = "An account with this email already exists. Try signing in instead.";
      }
      setErrorMsg(msg);
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
            {resetMode ? "Reset your password" : mode === "signin" ? "Sign in" : "Create your account"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {resetMode
              ? "Enter your email and we'll send you a reset link."
              : mode === "signin"
              ? "Welcome back. Pick up where you left off."
              : "Track trades, talk to your AI coach, build your edge."}
          </p>

          {resetMode ? (
            resetSent ? (
              <div className="mt-5 space-y-3">
                <div className="rounded-md border border-border bg-muted/40 p-3 text-sm text-foreground">
                  Check your inbox for a reset link sent to <strong>{email}</strong>. It may take a minute, and check spam.
                </div>
                <Button type="button" className="w-full" variant="outline" onClick={() => { setResetMode(false); setResetSent(false); setErrorMsg(null); }}>
                  Back to sign in
                </Button>
              </div>
            ) : (
              <form onSubmit={onResetSubmit} className="mt-5 space-y-3">
                <div>
                  <label className="text-xs font-medium text-muted-foreground" htmlFor="reset-email">Email</label>
                  <input
                    id="reset-email"
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="mt-1 w-full h-10 rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus:border-primary/50"
                    required
                  />
                </div>
                {errorMsg && (
                  <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                    {errorMsg}
                  </div>
                )}
                <Button type="submit" className="w-full" disabled={busy}>
                  {busy ? "Sending..." : "Send reset link"}
                </Button>
                <button
                  type="button"
                  onClick={() => { setResetMode(false); setErrorMsg(null); }}
                  className="block w-full text-center text-xs text-muted-foreground hover:text-foreground"
                >
                  Back to sign in
                </button>
              </form>
            )
          ) : (
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
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-muted-foreground" htmlFor="password">Password</label>
                  {mode === "signin" && (
                    <button
                      type="button"
                      onClick={() => { setResetMode(true); setErrorMsg(null); }}
                      className="text-xs text-primary hover:underline"
                    >
                      Forgot password?
                    </button>
                  )}
                </div>
                <div className="relative mt-1">
                  <input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    autoComplete={mode === "signin" ? "current-password" : "new-password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full h-10 rounded-md border border-border bg-background px-3 pr-10 text-sm focus:outline-none focus:border-primary/50"
                    minLength={mode === "signup" ? 12 : 1}
                    maxLength={72}
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute inset-y-0 right-0 flex items-center px-3 text-muted-foreground hover:text-foreground"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    tabIndex={-1}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                {mode === "signup" && (
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    At least 12 characters, with a number and a special character.
                  </p>
                )}
              </div>
              {errorMsg && (
                <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                  {errorMsg}
                </div>
              )}
              <Button type="submit" className="w-full" disabled={busy}>
                {busy ? "Please wait..." : mode === "signin" ? "Sign in" : "Create account"}
              </Button>
            </form>
          )}

          {!resetMode && (
            <div className="mt-4 text-center text-xs text-muted-foreground">
              {mode === "signin" ? (
                <>
                  Need an account?{" "}
                  <button onClick={() => { setMode("signup"); setErrorMsg(null); }} className="text-primary hover:underline">
                    Create one
                  </button>
                </>
              ) : (
                <>
                  Already have an account?{" "}
                  <button onClick={() => { setMode("signin"); setErrorMsg(null); }} className="text-primary hover:underline">
                    Sign in
                  </button>
                </>
              )}
            </div>
          )}
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
