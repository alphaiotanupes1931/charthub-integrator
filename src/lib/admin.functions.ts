import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function assertAdmin(userId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin.rpc("has_role", {
    _user_id: userId,
    _role: "admin",
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden");
}

export const adminReferralStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin.rpc("admin_referral_stats");
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const adminUsersOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin.rpc("admin_users_overview");
    if (error) throw new Error(error.message);
    return data ?? [];
  });

/** Today's per-user AI requests and screenshot reads, for the admin panel. */
export const adminUsageToday = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.userId);
    // The RPC re-checks has_role(auth.uid()), so it must run as the signed-in admin.
    const { data, error } = await context.supabase.rpc("admin_usage_today");
    if (error) throw new Error(error.message);
    return (data ?? []) as Array<{ user_id: string; requests: number; screenshots: number }>;
  });

export const adminSetPlatformStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z.object({
      level: z.enum(["operational", "degraded", "down"]),
      message: z.string().min(1).max(500),
    }).parse(data),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error } = await supabaseAdmin.rpc("admin_set_platform_status", {
      _level: data.level,
      _message: data.message,
    });
    if (error) throw new Error(error.message);
    return row;
  });
