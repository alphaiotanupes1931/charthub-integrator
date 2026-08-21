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
    const { data, error } = await context.supabase.rpc("admin_referral_stats");
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const adminUsersOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.userId);
    const { data, error } = await context.supabase.rpc("admin_users_overview");
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
      notifyUsers: z.boolean().optional(),
    }).parse(data),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error } = await context.supabase.rpc("admin_set_platform_status", {
      _level: data.level,
      _message: data.message,
    });
    if (error) throw new Error(error.message);

    let emailed = 0;
    if (data.notifyUsers) {
      const { buildStatusEmail } = await import("@/lib/platform-status-email.server");
      const mail = buildStatusEmail(data.level, data.message);
      const { data: people } = await supabaseAdmin
        .from("profiles")
        .select("email")
        .not("email", "is", null)
        .eq("banned", false);
      const recipients = Array.from(
        new Set(((people ?? []) as Array<{ email: string | null }>).map((p) => p.email).filter((e): e is string => !!e)),
      );
      const stamp = Date.now();
      for (const to of recipients) {
        try {
          const messageId = crypto.randomUUID();
          await supabaseAdmin.from("email_send_log").insert({
            message_id: messageId,
            template_name: "platform_status",
            recipient_email: to,
            status: "pending",
          });
          const { error: qErr } = await supabaseAdmin.rpc("enqueue_email" as never, {
            queue_name: "transactional_emails",
            payload: {
              message_id: messageId,
              to,
              from: "TradeMind <noreply@notify.reeddigitalgroup.com>",
              sender_domain: "notify.reeddigitalgroup.com",
              subject: mail.subject,
              html: mail.html,
              text: mail.text,
              purpose: "transactional",
              idempotency_key: `status:${stamp}:${to}`,
              unsubscribe_token: `platform-status:${to}`,
              label: "platform_status",
              queued_at: new Date().toISOString(),
            },
          } as never);
          if (qErr) throw new Error(qErr.message);
          emailed += 1;
        } catch (e) {
          console.error("[status] email enqueue failed", to, (e as Error).message);
        }
      }
    }

    return { row, emailed };
  });
