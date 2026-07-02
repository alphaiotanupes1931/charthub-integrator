import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const getDashboardGateSnapshot = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const userId = context.userId;
    const email = context.claims?.email as string | undefined;

    let profileCreated = false;
    let { data: profile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("onboarded,banned")
      .eq("id", userId)
      .maybeSingle();

    if (profileError) throw new Error(profileError.message);

    if (!profile) {
      const { data: createdProfile, error: createError } = await supabaseAdmin
        .from("profiles")
        .upsert({
          id: userId,
          email: email ?? null,
          display_name: email?.split("@")[0] ?? null,
        })
        .select("onboarded,banned")
        .single();

      if (createError) throw new Error(createError.message);
      profile = createdProfile;
      profileCreated = true;
    }

    const [{ data: adminRow }, { data: subscription }] = await Promise.all([
      supabaseAdmin
        .from("user_roles")
        .select("role")
        .eq("user_id", userId)
        .eq("role", "admin")
        .maybeSingle(),
      supabaseAdmin
        .from("subscriptions")
        .select("status")
        .eq("user_id", userId)
        .maybeSingle(),
    ]);

    return {
      profile,
      profileCreated,
      isAdmin: !!adminRow,
      subscriptionStatus: subscription?.status ?? null,
    };
  });