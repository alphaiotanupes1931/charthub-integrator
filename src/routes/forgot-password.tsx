import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { KeyRound, MailCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { requestPasswordReset } from "@/lib/username-auth.functions";
import logoAsset from "@/assets/logo.png.asset.json";

export const Route = createFileRoute("/forgot-password")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Trouble signing in, TradeMind" },
      {
        name: "description",
        content: "Reset your TradeMind password. Enter your email or username and we'll send you a secure reset link.",
      },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: ForgotPasswordPage,
});

function ForgotPasswordPage() {
  const [identifier, setIdentifier] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !identifier.trim()) return;
    setBusy(true);
    try {
      await requestPasswordReset({
        data: {
          identifier: identifier.trim(),
          redirectTo: `${window.location.origin}/reset-password`,
        },
      });
      setSent(true);
    } catch {
      toast.error("Could not send the reset link. Try again in a moment.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-sm">
        <Link to="/" className="flex items-center justify-center gap-2.5 mb-8">
          <img src={logoAsset.url} alt="TradeMind" className="h-12 w-12 object-contain" />
          <span className="font-display text-2xl font-semibold tracking-tight">
            <span className="text-foreground">Trade</span>
            <span className="text-gold-gradient">Mind</span>
          </span>
        </Link>

        <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
          <div className="flex flex-col items-center text-center">
            <div className="flex h-20 w-20 items-center justify-center rounded-full border-2 border-border">
              {sent ? <MailCheck className="h-8 w-8 text-primary" /> : <KeyRound className="h-8 w-8 text-foreground" />}
            </div>
            <h1 className="mt-4 text-base font-semibold text-foreground">
              {sent ? "Check your email" : "Trouble signing in?"}
            </h1>
            <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
              {sent
                ? "If an account matches what you entered, a password reset link is on its way. The link expires in 1 hour."
                : "Enter your email or username and we'll send you a link to get back into your account."}
            </p>
          </div>

          {sent ? (
            <div className="mt-6 space-y-3">
              <Button className="w-full" onClick={() => setSent(false)}>
                Send another link
              </Button>
              <Link
                to="/auth"
                className="block text-center text-sm font-semibold text-primary hover:underline"
              >
                Back to sign in
              </Link>
            </div>
          ) : (
            <form onSubmit={onSubmit} className="mt-6 space-y-4">
              <input
                id="identifier"
                type="text"
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                placeholder="Email or username"
                className="w-full h-11 rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus:border-primary/50"
                required
              />
              <Button type="submit" className="w-full" disabled={busy || !identifier.trim()}>
                {busy ? "Sending..." : "Send login link"}
              </Button>

              <Link
                to="/auth"
                search={{ mode: "signin" }}
                className="block text-center text-sm text-muted-foreground hover:text-foreground"
              >
                Can't reset your password?
              </Link>

              <div className="flex items-center gap-3">
                <span className="h-px flex-1 bg-border" />
                <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">or</span>
                <span className="h-px flex-1 bg-border" />
              </div>

              <Link
                to="/auth"
                search={{ mode: "signup" }}
                className="block text-center text-sm font-semibold text-foreground hover:underline"
              >
                Create a new account
              </Link>
            </form>
          )}
        </div>

        <Link
          to="/auth"
          className="mt-4 flex h-11 items-center justify-center rounded-2xl border border-border bg-card text-sm font-semibold text-foreground"
        >
          Back to sign in
        </Link>
      </div>
    </div>
  );
}
