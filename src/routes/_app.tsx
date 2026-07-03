import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { supabase } from "@/integrations/supabase/client";
import { getDashboardGateSnapshot } from "@/lib/access-gate.functions";
import { syncMySubscriptionFromStripe } from "@/lib/billing.functions";
import { logGate } from "@/lib/gateLog";

const BILLING_ALLOWED_PATHS = ["/pricing", "/settings", "/onboarding"];
const GATE_STEP_TIMEOUT_MS = 12_000;

function isTimeoutError(error: unknown, label?: string) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const expected = label ? `${label} timed out` : "timed out";
  return message.toLowerCase().includes(expected.toLowerCase());
}

function GatePending() {
  return (
    <div className="min-h-screen bg-background text-foreground flex items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-6 text-center shadow-sm">
        <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        <h1 className="mt-4 text-lg font-semibold">Opening your dashboard</h1>
        <p className="mt-2 text-sm text-muted-foreground">Checking your session and access.</p>
      </div>
    </div>
  );
}

function GateError({ error }: { error: Error }) {
  return (
    <div className="min-h-screen bg-background text-foreground flex items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-6 text-center shadow-sm">
        <h1 className="text-lg font-semibold">Dashboard access did not load</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {error.message || "Your session could not be checked. Please sign in again."}
        </p>
        <div className="mt-5 flex flex-col gap-2">
          <a className="inline-flex h-10 items-center justify-center rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground" href="/auth?mode=signin&redirect=%2Fdashboard">
            Sign in again
          </a>
          <button className="inline-flex h-10 items-center justify-center rounded-lg border border-border px-4 text-sm font-medium" onClick={() => window.location.reload()}>
            Refresh
          </button>
        </div>
      </div>
    </div>
  );
}

async function withTimeout<T>(promise: PromiseLike<T>, label: string, ms = GATE_STEP_TIMEOUT_MS): Promise<T> {
  let timeoutId: number | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = window.setTimeout(() => reject(new Error(`${label} timed out`)), ms);
  });
  try {
    return await Promise.race([Promise.resolve(promise), timeout]);
  } finally {
    if (timeoutId) window.clearTimeout(timeoutId);
  }
}

async function getHydratedUser() {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const { data: sessionData } = await withTimeout(
      supabase.auth.getSession(),
      "local session check",
      1_000,
    ).catch(() => ({ data: { session: null } }));
    if (sessionData.session?.user) {
      logGate({
        step: "hydrate-attempt",
        attempt,
        hasUser: true,
      });
      return sessionData.session.user;
    }

    const { data, error } = await withTimeout(
      supabase.auth.getUser(),
      "session check",
      1_500,
    ).catch((err) => ({ data: { user: null }, error: err as Error }));
    logGate({
      step: "hydrate-attempt",
      attempt,
      hasUser: !!data.user,
      error: error?.message,
    });
    if (!error && data.user) return data.user;

    await new Promise((resolve) => window.setTimeout(resolve, 125));
  }
  return null;
}

export const Route = createFileRoute("/_app")({
  ssr: false,
  pendingMs: 0,
  pendingMinMs: 300,
  pendingComponent: GatePending,
  errorComponent: ({ error }) => <GateError error={error instanceof Error ? error : new Error("Dashboard access failed")} />,
  beforeLoad: async ({ location }) => {
    // AUTH TEMPORARILY DISABLED for testing — bypass all gates.
    logGate({ step: "admin-testing-bypass" });
    return { user: null };
    // eslint-disable-next-line no-unreachable
    if (typeof window !== "undefined" && sessionStorage.getItem("trademind.adminTesting") === "1") {
      logGate({ step: "admin-testing-bypass" });
      return { user: null };
    }


    const user = await getHydratedUser();

    if (!user) {
      logGate({ step: "hydrate-failed", attempts: 12 });
      logGate({ step: "redirect", to: "/auth", reason: "no-session-after-hydration" });
      throw redirect({ to: "/auth", search: { redirect: location.href } });
    }
    logGate({ step: "hydrated", userId: user!.id, email: user!.email ?? null, attempts: 0 });

    let gateSoftFailed = false;
    const gateSnapshot = await withTimeout(getDashboardGateSnapshot(), "access check", 12_000).catch((err) => {
      gateSoftFailed = true;
      logGate({ step: "access-check-soft-failed", message: err instanceof Error ? err.message : String(err) });
      if (isTimeoutError(err, "access check")) {
        logGate({ step: "profile-timeout-soft-allow", message: err instanceof Error ? err.message : String(err) });
      }
      return {
        profile: { onboarded: true, banned: false },
        profileCreated: false,
        isAdmin: false,
        subscriptionStatus: null,
      };
    });

    const prof = gateSnapshot.profile;

    logGate({
      step: "profile",
      found: !!prof,
      onboarded: prof?.onboarded,
      banned: prof?.banned,
    });

    if (gateSnapshot.profileCreated) {
      logGate({ step: "profile-created" });
      if (!location.pathname.startsWith("/onboarding")) {
        logGate({ step: "redirect", to: "/onboarding", reason: "no-profile-row" });
        throw redirect({ to: "/onboarding" });
      }
      return { user };
    }

    if (prof?.banned) {
      await supabase.auth.signOut();
      logGate({ step: "redirect", to: "/auth", reason: "banned" });
      throw redirect({ to: "/auth", search: { banned: "1" } });
    }
    if (!prof?.onboarded && !location.pathname.startsWith("/onboarding")) {
      logGate({ step: "redirect", to: "/onboarding", reason: "not-onboarded" });
      throw redirect({ to: "/onboarding" });
    }

    // Admins bypass paywall
    const isAdmin = gateSnapshot.isAdmin;
    logGate({ step: "role", isAdmin });

    if (!isAdmin) {
      // If the access check itself failed, don't force-boot a possibly-paying user to /pricing.
      if (gateSoftFailed) {
        logGate({ step: "subscription-skip-soft-fail" });
      } else {
        let status = gateSnapshot.subscriptionStatus;
        let synced: string | null | undefined;
        if (status !== "active" && status !== "trialing") {
          try {
            const s = await withTimeout(
              syncMySubscriptionFromStripe(),
              "billing sync",
              4_500,
            );
            synced = s?.status ?? null;
            status = synced ?? status;
          } catch (err) {
            synced = `error:${(err as Error)?.message ?? "unknown"}`;
            // Fall back to the local row.
          }
        }
        const active = status === "active" || status === "trialing";
        logGate({
          step: "subscription",
          localStatus: gateSnapshot.subscriptionStatus,
          syncedStatus: synced,
          active,
        });
        const onAllowedPath = BILLING_ALLOWED_PATHS.some((p) =>
          location.pathname.startsWith(p),
        );
        if (!active && !onAllowedPath) {
          logGate({ step: "redirect", to: "/pricing", reason: `inactive-subscription:${status ?? "none"}` });
          throw redirect({ to: "/pricing" });
        }
      }
    }


    logGate({ step: "allow", pathname: location.pathname });
    return { user };
  },
  component: () => (
    <AppShell>
      <Outlet />
    </AppShell>
  ),
});
