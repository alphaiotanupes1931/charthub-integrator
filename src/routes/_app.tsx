import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { supabase } from "@/integrations/supabase/client";
import { syncMySubscriptionFromStripe } from "@/lib/billing.functions";

const BILLING_ALLOWED_PATHS = ["/pricing", "/settings", "/onboarding"];

async function getHydratedUser() {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const { data, error } = await supabase.auth.getUser();
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
    // Admin-testing bypass: set from the auth page's "Admin testing" button.
    if (typeof window !== "undefined" && sessionStorage.getItem("trademind.adminTesting") === "1") {
      return { user: null };
    }
    const user = await getHydratedUser();

    if (!user) {
      throw redirect({ to: "/auth", search: { redirect: location.href } });
    }

    // Force onboarding for new users
    const { data: prof } = await supabase
      .from("profiles")
      .select("onboarded,banned" as "onboarded")
      .eq("id", user.id)
      .maybeSingle() as { data: { onboarded: boolean; banned?: boolean } | null };

    if (!prof) {
      await supabase.from("profiles").upsert({
        id: user.id,
        email: user.email ?? null,
        display_name: user.user_metadata?.display_name ?? user.email?.split("@")[0] ?? null,
      });
      if (!location.pathname.startsWith("/onboarding")) {
        throw redirect({ to: "/onboarding" });
      }
      return { user };
    }

    if (prof?.banned) {
      await supabase.auth.signOut();
      throw redirect({ to: "/auth", search: { banned: "1" } });
    }
    if (!prof?.onboarded && !location.pathname.startsWith("/onboarding")) {
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

    if (!isAdmin) {
      const { data: sub } = await supabase
        .from("subscriptions")
        .select("status")
        .eq("user_id", user.id)
        .maybeSingle();
      let status = sub?.status ?? null;
      if (status !== "active" && status !== "trialing") {
        try {
          const synced = await syncMySubscriptionFromStripe();
          status = synced?.status ?? status;
        } catch {
          // If the live billing check fails, fall back to the local row.
        }
      }
      const active = status === "active" || status === "trialing";
      const onAllowedPath = BILLING_ALLOWED_PATHS.some((p) =>
        location.pathname.startsWith(p),
      );
      if (!active && !onAllowedPath) {
        throw redirect({ to: "/pricing" });
      }
    }

    return { user };
  },
  component: () => (
    <AppShell>
      <Outlet />
    </AppShell>
  ),
});
