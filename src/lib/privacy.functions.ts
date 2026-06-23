import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * GDPR data export: returns a JSON dump of everything we hold for the signed-in user.
 * Trade journal lives in the browser's localStorage and is not included here.
 */
export const exportMyData = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;

    const [profile, threads, messages, invites, connections, aiUsage, roles] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", userId).maybeSingle(),
      supabase.from("chat_threads").select("*").eq("user_id", userId),
      supabase.from("chat_messages").select("*").eq("user_id", userId),
      supabase.from("trader_invites").select("*").eq("inviter_id", userId),
      supabase.from("trader_connections").select("*").or(`user_a.eq.${userId},user_b.eq.${userId}`),
      supabase.from("ai_usage").select("*").eq("user_id", userId),
      supabase.from("user_roles").select("*").eq("user_id", userId),
    ]);

    return {
      exportedAt: new Date().toISOString(),
      userId,
      profile: profile.data ?? null,
      chatThreads: threads.data ?? [],
      chatMessages: messages.data ?? [],
      traderInvites: invites.data ?? [],
      traderConnections: connections.data ?? [],
      aiUsage: aiUsage.data ?? [],
      roles: roles.data ?? [],
      note: "Trade journal entries are stored locally in your browser and are not included in this export.",
    };
  });

/**
 * GDPR right to be forgotten: deletes the signed-in user from auth.users.
 * All public schema rows referencing the user cascade-delete automatically.
 */
export const deleteMyAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
