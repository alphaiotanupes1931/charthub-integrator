import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { acceptInvite } from "@/lib/social.functions";
import { supabase } from "@/integrations/supabase/client";
import { Sparkles, Loader2, Check, AlertCircle } from "lucide-react";

export const Route = createFileRoute("/invite/$code")({
  head: () => ({ meta: [{ title: "Trader invite, TradeMind" }] }),
  component: AcceptInvitePage,
});

function AcceptInvitePage() {
  const { code } = Route.useParams();
  const accept = useServerFn(acceptInvite);
  const navigate = useNavigate();
  const [state, setState] = useState<"checking" | "needs_auth" | "accepting" | "ok" | "error">("checking");
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getUser();
      if (!data.user) {
        try { localStorage.setItem("trademind.pendingInvite", code); } catch { /* ignore */ }
        setState("needs_auth");
        return;
      }
      setState("accepting");
      try {
        await accept({ data: { code } });
        try { localStorage.removeItem("trademind.pendingInvite"); } catch { /* ignore */ }
        setState("ok");
        window.setTimeout(() => navigate({ to: "/mentor" }), 1200);
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Could not accept invite");
        setState("error");
      }
    })();
  }, [code, accept, navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-6">
      <div className="max-w-md w-full rounded-2xl border border-border bg-card p-8 text-center">
        <div className="mx-auto h-12 w-12 rounded-xl bg-primary/10 ring-1 ring-primary/30 flex items-center justify-center mb-4">
          <Sparkles className="h-5 w-5 text-primary" />
        </div>
        {state === "checking" || state === "accepting" ? (
          <>
            <h1 className="font-display text-2xl font-semibold mb-2">Joining your trader</h1>
            <Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" />
          </>
        ) : state === "needs_auth" ? (
          <>
            <h1 className="font-display text-2xl font-semibold mb-2">You've been invited</h1>
            <p className="text-sm text-muted-foreground mb-5">
              Sign in or create an account to connect with this trader and share win/loss stats.
            </p>
            <Link
              to="/auth"
              className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
            >
              Continue to sign in
            </Link>
          </>
        ) : state === "ok" ? (
          <>
            <h1 className="font-display text-2xl font-semibold mb-2 flex items-center justify-center gap-2">
              <Check className="h-5 w-5 text-bull" /> Connected
            </h1>
            <p className="text-sm text-muted-foreground">Taking you to your roster…</p>
          </>
        ) : (
          <>
            <h1 className="font-display text-2xl font-semibold mb-2 flex items-center justify-center gap-2">
              <AlertCircle className="h-5 w-5 text-destructive" /> Couldn't accept
            </h1>
            <p className="text-sm text-muted-foreground">{err}</p>
          </>
        )}
      </div>
    </div>
  );
}
