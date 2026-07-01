import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { supabase } from "@/integrations/supabase/client";

const BILLING_ALLOWED_PATHS = ["/pricing", "/settings", "/onboarding"];

export const Route = createFileRoute("/_app")({
  ssr: false,
  beforeLoad: async ({ location }) => {
    const { data: sessionData } = await supabase.auth.getSession();
    const user = sessionData.session?.user ?? null;

    if (!user) {
      throw redirect({ to: "/auth", search: { redirect: location.href } });
    }
    // Force onboarding for new users
    const { data: prof } = await supabase
      .from("profiles")
      .select("onboarded,banned" as "onboarded")
      .eq("id", user.id)
      .maybeSingle() as { data: { onboarded: boolean; banned?: boolean } | null };
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
      const status = sub?.status ?? null;
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
