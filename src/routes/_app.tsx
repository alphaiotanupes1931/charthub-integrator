import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_app")({
  ssr: false,
  beforeLoad: async ({ location }) => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) {
      throw redirect({ to: "/auth", search: { redirect: location.href } });
    }
    // Force onboarding for new users
    const { data: prof } = await supabase
      .from("profiles")
      .select("onboarded,banned" as "onboarded")
      .eq("id", data.user.id)
      .maybeSingle() as { data: { onboarded: boolean; banned?: boolean } | null };
    if ((prof as { banned?: boolean } | null)?.banned) {
      await supabase.auth.signOut();
      throw redirect({ to: "/auth", search: { banned: "1" } });
    }
    if (!prof?.onboarded && !location.pathname.startsWith("/onboarding")) {
      throw redirect({ to: "/onboarding" });
    }
    return { user: data.user };
  },
  component: () => (
    <AppShell>
      <Outlet />
    </AppShell>
  ),
});
