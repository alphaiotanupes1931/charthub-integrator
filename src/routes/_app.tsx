import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { supabase } from "@/integrations/supabase/client";
import { logGate } from "@/lib/gateLog";

const GATE_STEP_TIMEOUT_MS = 12_000;

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
    const user = await getHydratedUser();
    if (!user) {
      throw redirect({ to: "/auth", search: { redirect: location.href, mode: "signin" } });
    }
    return { user };
  },

  component: () => (
    <AppShell>
      <Outlet />
    </AppShell>
  ),
});
