import { createFileRoute, useNavigate, useSearch, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { signUpConfirmed } from "@/lib/auth.functions";
import { redeemRecoveryCode } from "@/lib/recovery.functions";
import { normalizeRecoveryCode } from "@/lib/recoveryCode";
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

const optionalSearchString = z.preprocess(
  (value) => (value == null ? undefined : String(value)),
  z.string().optional(),
);

const searchSchema = z.object({
  redirect: optionalSearchString,
  mode: z.preprocess(
    (value) => (value == null ? undefined : String(value)),
    z.enum(["signin", "signup"]).optional(),
  ),
  banned: optionalSearchString,
  force: optionalSearchString,
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

async function waitForSignedInUser() {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const { data } = await supabase.auth.getSession();
    if (data.session?.user) return data.session.user;
    await new Promise((resolve) => window.setTimeout(resolve, 125));
  }
  throw new Error("Signed in, but the session did not finish loading. Please try again.");
}

function AuthPage() {
  const navigate = useNavigate();
  const search = useSearch({ from: "/auth" });
  const handledForceSignOut = useRef(false);
  const [mode, setMode] = useState<"signin" | "signup">(search.mode ?? "signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  

  const [recoveryMode, setRecoveryMode] = useState(false);
  const [recoveryCode, setRecoveryCodeInput] = useState("");

  useEffect(() => {
    if (search.banned === "1") {
      toast.error("This account has been suspended. Contact support if you believe this is a mistake.");
    }
  }, [search.banned]);

  // Already signed in? Bounce to redirect target (honoring any pending invite).
  useEffect(() => {
    let cancelled = false;
    if (search.force === "1" && !handledForceSignOut.current) {
      handledForceSignOut.current = true;

      const cleanSearch = new URLSearchParams();
      if (search.redirect) cleanSearch.set("redirect", search.redirect);
      if (search.mode) cleanSearch.set("mode", search.mode);
      const cleanPath = `/auth${cleanSearch.toString() ? `?${cleanSearch.toString()}` : ""}`;

      if (typeof window !== "undefined") {
        supabase.auth.signOut({ scope: "local" }).catch(() => {});
        window.history.replaceState(null, "", cleanPath);
      } else {
        navigate({ to: "/auth", search: { redirect: search.redirect, mode: search.mode }, replace: true });
      }

      return () => { cancelled = true; };
    }
    if (search.force === "1") {
      return () => { cancelled = true; };
    }
    supabase.auth.getUser().then(({ data }) => {
      if (cancelled || !data.user) return;
      let target = search.redirect || "/dashboard";
      try {
        const pending = localStorage.getItem("trademind.pendingInvite");
        if (pending) target = `/invite/${pending}`;
      } catch { /* ignore */ }
      if (typeof window !== "undefined") {
        window.location.assign(target);
      } else {
        navigate({ to: target, replace: true });
      }
    });
    return () => { cancelled = true; };
  }, [navigate, search.force, search.redirect]);




  async function onRecoverySubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setErrorMsg(null);
    const parsedEmail = z.string().trim().email("Enter a valid email").max(255).safeParse(email);
    if (!parsedEmail.success) {
      setErrorMsg(parsedEmail.error.issues[0]?.message ?? "Invalid email");
      return;
    }
    const code = normalizeRecoveryCode(recoveryCode);
    if (code.length < 8) {
      setErrorMsg("Enter your recovery code");
      return;
    }
    setBusy(true);
    try {
      const { actionLink } = await redeemRecoveryCode({
        data: {
          email: parsedEmail.data,
          code,
          redirectTo: `${window.location.origin}/reset-password`,
        },
      });
      toast.success("Verified. Opening password reset...");
      window.location.href = actionLink;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Couldn't verify your recovery code";
      setErrorMsg(msg);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  }


  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setErrorMsg(null);
    const schema = mode === "signup" ? signUpSchema : signInSchema;
    const parsed = schema.safeParse({ email, password });
    if (!parsed.success) {
      const m = parsed.error.issues[0]?.message ?? "Invalid input";
      setErrorMsg(m);
      toast.error(m);
      return;
    }
    // Show busy state IMMEDIATELY so the button reacts on click without
    // waiting on audio priming or any other setup work.
    setBusy(true);

    // Pre-create an Audio element inside the user gesture so .play() will
    // be allowed after we receive the ElevenLabs MP3 bytes. Mobile Safari
    // requires the element to actually start playing inside the gesture, so
    // we prime it with a tiny silent WAV and immediately call .play().
    let welcomeAudio: HTMLAudioElement | null = null;
    const muted = isWelcomeBackMuted();
    if (!muted && typeof window !== "undefined" && typeof Audio !== "undefined") {
      welcomeAudio = new Audio();
      welcomeAudio.preload = "auto";
      welcomeAudio.src =
        "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=";
      welcomeAudio.play().then(() => welcomeAudio?.pause()).catch(() => {});
      (window as Window & { __trademindWelcomeAudio?: HTMLAudioElement }).__trademindWelcomeAudio = welcomeAudio;
    }

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

      // Compute target and navigate FIRST. Everything else (welcome recap,
      // TTS) is best-effort and must not block the redirect to the dashboard.
      let target = search.redirect || "/dashboard";
      try {
        const pending = localStorage.getItem("trademind.pendingInvite");
        if (pending) target = `/invite/${pending}`;
        localStorage.removeItem(WELCOME_BACK_REQUEST_KEY);
      } catch { /* ignore */ }

      // Fire-and-forget welcome playback so navigation is never blocked.
      if (!muted) {
        (async () => {
          try {
            let recap: string;
            if (mode === "signup") {
              const name = spokenName(null, parsed.data.email);
              recap = `Hi ${name}, welcome to TradeMind. Make sure to complete your profile and pick your coach so I can tailor your feedback.`;
            } else {
              recap = await Promise.race([
                buildLoginWelcomeRecap(),
                new Promise<string>((resolve) =>
                  window.setTimeout(() => resolve(`Welcome back, ${spokenName(null, parsed.data.email)}. Ready when you are.`), 1200),
                ),
              ]);
            }
            void speakWithElevenLabs(recap, readActiveCoach(), welcomeAudio);
          } catch {
            void speakWithElevenLabs(
              `Welcome back, ${spokenName(null, parsed.data.email)}. Ready when you are.`,
              readActiveCoach(),
              welcomeAudio,
            );
          }
        })();
      }

      // Hard navigation so the protected layout's beforeLoad runs with a
      // freshly-hydrated Supabase session on every host (Vercel + previews).
      if (typeof window !== "undefined") {
        window.location.assign(target);
      } else {
        navigate({ to: target, replace: true });
      }
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
      {busy && (
        <div
          className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-background/70 backdrop-blur-sm"
          aria-live="polite"
          aria-busy="true"
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.preventDefault()}
        >
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <p className="text-sm font-medium text-foreground">
            {recoveryMode ? "Verifying your recovery code..." : mode === "signin" ? "Signing you in..." : "Creating your account..."}
          </p>
          <p className="text-xs text-muted-foreground">Please don't close this tab.</p>
        </div>
      )}
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
            {recoveryMode
              ? "Use your recovery code"
              : mode === "signin"
              ? "Sign in"
              : "Create your account"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {recoveryMode
              ? "Enter the recovery code you saved during onboarding."
              : mode === "signin"
              ? "Welcome back. Pick up where you left off."
              : "Track trades, talk to your AI coach, build your edge."}
          </p>


          {recoveryMode ? (
            <form onSubmit={onRecoverySubmit} className="mt-5 space-y-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground" htmlFor="recovery-email">Email</label>
                <input
                  id="recovery-email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="mt-1 w-full h-10 rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus:border-primary/50"
                  required
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground" htmlFor="recovery-code">Recovery code</label>
                <input
                  id="recovery-code"
                  type="text"
                  autoComplete="off"
                  spellCheck={false}
                  value={recoveryCode}
                  onChange={(e) => setRecoveryCodeInput(e.target.value.toUpperCase())}
                  placeholder="XXXX-XXXX-XXXX-XXXX"
                  className="mt-1 w-full h-10 rounded-md border border-border bg-background px-3 font-mono text-sm tracking-widest focus:outline-none focus:border-primary/50"
                  required
                />
              </div>
              {errorMsg && (
                <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                  {errorMsg}
                </div>
              )}
              <Button type="submit" className="w-full" disabled={busy}>
                {busy ? "Verifying..." : "Continue to reset password"}
              </Button>
              <p className="text-xs text-muted-foreground text-center leading-relaxed">
                If you haven't been assigned a recovery code or have lost it, please email{" "}
                <a href="mailto:marcus@trademindai.ai" className="text-primary hover:underline">
                  marcus@trademindai.ai
                </a>
                .
              </p>
              <button
                type="button"
                onClick={() => { setRecoveryMode(false); setErrorMsg(null); }}
                className="block w-full text-center text-xs text-muted-foreground hover:text-foreground"
              >
                Back to sign in
              </button>
            </form>

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
                      onClick={() => { setRecoveryMode(true); setErrorMsg(null); }}
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
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  if (busy) return;
                  try { sessionStorage.setItem("trademind.adminTesting", "1"); } catch { /* ignore */ }
                  window.location.assign("/dashboard");
                }}
                className="w-full h-10 rounded-md border border-dashed border-border bg-background/40 px-3 text-xs font-medium text-muted-foreground hover:text-foreground hover:border-primary/50 transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Admin testing → Open dashboard
              </button>

            </form>
          )}

          {!recoveryMode && (
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
