import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_app")({
  ssr: false,
  beforeLoad: async ({ location }) => {
    const { data: sessionData } = await supabase.auth.getSession();
    const { data, error } = sessionData.session
      ? await supabase.auth.getUser()
      : { data: { user: null }, error: null };
    const user = data.user ?? sessionData.session?.user ?? null;

    if (error || !user) {
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
    return { user };
  },
  component: () => (
    <AppShell>
      <Outlet />
    </AppShell>
  ),
});
