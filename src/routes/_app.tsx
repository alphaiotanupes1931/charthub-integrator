import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { supabase } from "@/integrations/supabase/client";
import { syncMySubscriptionFromStripe } from "@/lib/billing.functions";
import { logGate } from "@/lib/gateLog";

const BILLING_ALLOWED_PATHS = ["/pricing", "/settings", "/onboarding"];

async function getHydratedUser() {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const { data, error } = await supabase.auth.getUser();
    logGate({
      step: "hydrate-attempt",
      attempt,
      hasUser: !!data.user,
      error: error?.message,
    });
    if (!error && data.user) return data.user;

    const { data: sessionData } = await supabase.auth.getSession();
    if (sessionData.session?.user) return sessionData.session.user;

    await new Promise((resolve) => window.setTimeout(resolve, 125));
  }
  return null;
}

export const Route = createFileRoute("/_app")({
  ssr: false,
  beforeLoad: async ({ location }) => {
    logGate({ step: "start", pathname: location.pathname, href: location.href });

    // Admin-testing bypass: set from the auth page's "Admin testing" button.
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
    logGate({ step: "hydrated", userId: user.id, email: user.email ?? null, attempts: 0 });

    // Force onboarding for new users
    const { data: prof } = await supabase
      .from("profiles")
      .select("onboarded,banned" as "onboarded")
      .eq("id", user.id)
      .maybeSingle() as { data: { onboarded: boolean; banned?: boolean } | null };

    logGate({
      step: "profile",
      found: !!prof,
      onboarded: prof?.onboarded,
      banned: prof?.banned,
    });

    if (!prof) {
      await supabase.from("profiles").upsert({
        id: user.id,
        email: user.email ?? null,
        display_name: user.user_metadata?.display_name ?? user.email?.split("@")[0] ?? null,
      });
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
    const { data: adminRow } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .eq("role", "admin")
      .maybeSingle();
    const isAdmin = !!adminRow;
    logGate({ step: "role", isAdmin });

    if (!isAdmin) {
      const { data: sub } = await supabase
        .from("subscriptions")
        .select("status")
        .eq("user_id", user.id)
        .maybeSingle();
      let status = sub?.status ?? null;
      let synced: string | null | undefined;
      if (status !== "active" && status !== "trialing") {
        try {
          const s = await syncMySubscriptionFromStripe();
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
        localStatus: sub?.status ?? null,
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

    logGate({ step: "allow", pathname: location.pathname });
    return { user };
  },
  component: () => (
    <AppShell>
      <Outlet />
    </AppShell>
  ),
});
