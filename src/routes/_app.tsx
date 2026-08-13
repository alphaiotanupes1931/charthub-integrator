import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { supabase } from "@/integrations/supabase/client";
import { logGate } from "@/lib/gateLog";

const GATE_STEP_TIMEOUT_MS = 12_000;

function GatePending() {
  return (
    <div className="min-h-screen bg-background text-foreground flex items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-2xl border border-border/60 bg-card p-6 text-center shadow-sm">
        <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        <h1 className="mt-4 text-lg font-semibold">Opening your dashboard</h1>
        <p className="mt-2 text-sm text-muted-foreground">Checking your session and access.</p>
      </div>
    </div>
  );
}

function GateError({ error }: { error: Error }) {
  const msg = error?.message ?? "";
  const isChunkError = /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|ChunkLoadError/i.test(msg);

  // Stale-deploy self-heal: the browser is holding an old index.html pointing at
  // a JS chunk hash that no longer exists on the server. One hard reload pulls
  // the fresh index.html and its new chunk map.
  if (typeof window !== "undefined" && isChunkError) {
    const RELOAD_KEY = "trademind.chunkReload";
    try {
      const last = Number(sessionStorage.getItem(RELOAD_KEY) || "0");
      if (Date.now() - last > 10_000) {
        sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
        window.location.reload();
      }
    } catch { /* ignore */ }
  }

  return (
    <div className="min-h-screen bg-background text-foreground flex items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-2xl border border-border/60 bg-card p-6 text-center shadow-sm">
        <h1 className="text-lg font-semibold">
          {isChunkError ? "Updating to the latest version…" : "Dashboard access did not load"}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {isChunkError
            ? "A new version just shipped. Reloading now to pick it up."
            : (msg || "Your session could not be checked. Please sign in again.")}
        </p>
        <div className="mt-5 flex flex-col gap-2">
          {!isChunkError && (
            <a className="inline-flex h-10 items-center justify-center rounded-2xl bg-primary px-4 text-sm font-semibold text-primary-foreground" href="/auth?mode=signin&redirect=%2Fdashboard">
              Sign in again
            </a>
          )}
          <button className="inline-flex h-10 items-center justify-center rounded-2xl border border-border/60 px-4 text-sm font-medium" onClick={() => window.location.reload()}>
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
    // Admin testing bypass — set from the auth page's "Admin testing" button.
    if (typeof window !== "undefined") {
      try {
        if (sessionStorage.getItem("trademind.adminTesting") === "1") {
          return {
            user: {
              id: "00000000-0000-0000-0000-000000000000",
              email: "admin-test@trademind.local",
              user_metadata: { display_name: "Admin Tester" },
              app_metadata: {},
              aud: "authenticated",
              created_at: new Date().toISOString(),
            } as unknown as Awaited<ReturnType<typeof getHydratedUser>>,
          };
        }
      } catch { /* ignore */ }
    }
    const user = await getHydratedUser();
    if (!user) {
      throw redirect({ to: "/auth", search: { redirect: location.href, mode: "signin" } });
    }
    // Temporary-password accounts must choose a new password before they can
    // use the app.
    const { data: profile } = await supabase
      .from("profiles")
      .select("must_change_password,email")
      .eq("id", user.id)
      .maybeSingle();
    // Keep the profile email in step with the confirmed auth email. Legacy
    // username accounts were created with a placeholder address, and username
    // sign-in resolves through this column, so a stale value would lock them out
    // after they add their real email in settings.
    if (user.email && profile && profile.email?.toLowerCase() !== user.email.toLowerCase()) {
      await supabase.from("profiles").update({ email: user.email }).eq("id", user.id);
    }
    if (profile?.must_change_password) {
      throw redirect({ to: "/reset-password" });
    }
    return { user };
  },

  component: () => (
    <AppShell>
      <Outlet />
    </AppShell>
  ),
});
