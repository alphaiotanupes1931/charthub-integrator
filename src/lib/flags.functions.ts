import { createServerFn } from "@tanstack/react-start";

/**
 * Public read of the free-tier flag so marketing copy (landing, pricing, FAQ)
 * flips with the rollout instead of needing a deploy. Returns a single boolean;
 * no user data is involved.
 */
export const getFreeTierFlag = createServerFn({ method: "GET" }).handler(async (): Promise<{ enabled: boolean }> => {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("app_flags")
      .select("enabled")
      .eq("key", "free_tier_enabled")
      .maybeSingle();
    return { enabled: !!data?.enabled };
  } catch {
    return { enabled: false };
  }
});
