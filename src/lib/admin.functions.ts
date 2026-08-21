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

/**
 * Screenshot ("image read") usage per person over a day window, plus an
 * estimated dollar cost per read derived from real chat spend.
 * Admins are exempt from the daily image allowance, so they are flagged here.
 */
export const adminImageUsage = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ days: z.number().int().min(1).max(90).default(30) }).parse(data ?? {}))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const since = new Date(Date.now() - data.days * 86_400_000).toISOString().slice(0, 10);

    const [usageRes, profilesRes, adminsRes, costRes] = await Promise.all([
      supabaseAdmin.from("ai_usage").select("user_id, day, count, image_count").gte("day", since),
      supabaseAdmin.from("profiles").select("id, email, display_name"),
      supabaseAdmin.from("user_roles").select("user_id").eq("role", "admin"),
      supabaseAdmin.from("ai_cost_log").select("cost_usd, input_tokens, created_at").gte("created_at", new Date(Date.now() - data.days * 86_400_000).toISOString()),
    ]);
    if (usageRes.error) throw new Error(usageRes.error.message);

    const emails = new Map(
      (profilesRes.data ?? []).map((p) => [p.id as string, { email: p.email as string | null, name: p.display_name as string | null }]),
    );
    const adminIds = new Set((adminsRes.data ?? []).map((r) => r.user_id as string));

    const byUser = new Map<string, { images: number; requests: number; activeDays: number; lastDay: string | null }>();
    let totalImages = 0;
    let totalRequests = 0;
    for (const row of usageRes.data ?? []) {
      const uid = row.user_id as string;
      const images = Number(row.image_count ?? 0);
      const requests = Number(row.count ?? 0);
      totalImages += images;
      totalRequests += requests;
      const cur = byUser.get(uid) ?? { images: 0, requests: 0, activeDays: 0, lastDay: null as string | null };
      cur.images += images;
      cur.requests += requests;
      cur.activeDays += 1;
      const day = String(row.day);
      if (!cur.lastDay || day > cur.lastDay) cur.lastDay = day;
      byUser.set(uid, cur);
    }

    // Estimated cost of one screenshot read: average cost of an AI call in the
    // window, scaled up because vision calls carry a much larger input payload.
    const costRows = costRes.data ?? [];
    const totalCost = costRows.reduce((s, r) => s + Number(r.cost_usd ?? 0), 0);
    const avgCall = costRows.length ? totalCost / costRows.length : 0;
    const estCostPerImage = Number((avgCall * 3).toFixed(6));

    const rows = Array.from(byUser, ([user_id, v]) => ({
      user_id,
      email: emails.get(user_id)?.email ?? null,
      name: emails.get(user_id)?.name ?? null,
      is_admin: adminIds.has(user_id),
      images: v.images,
      requests: v.requests,
      active_days: v.activeDays,
      last_day: v.lastDay,
      est_cost_usd: Number((v.images * estCostPerImage).toFixed(4)),
    })).sort((a, b) => b.images - a.images);

    return {
      days: data.days,
      rows,
      totals: {
        images: totalImages,
        requests: totalRequests,
        est_cost_usd: Number((totalImages * estCostPerImage).toFixed(4)),
        est_cost_per_image: estCostPerImage,
      },
    };
  });

/**
 * Daily trend series for the admin usage charts: AI spend/calls per day and
 * screenshot reads per day, over the same day window as the tables.
 */
export const adminUsageTrends = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ days: z.number().int().min(1).max(90).default(30) }).parse(data ?? {}))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const sinceMs = Date.now() - data.days * 86_400_000;
    const sinceDay = new Date(sinceMs).toISOString().slice(0, 10);

    const [costRes, usageRes] = await Promise.all([
      supabaseAdmin.from("ai_cost_log").select("cost_usd, created_at").gte("created_at", new Date(sinceMs).toISOString()),
      supabaseAdmin.from("ai_usage").select("day, count, image_count").gte("day", sinceDay),
    ]);
    if (costRes.error) throw new Error(costRes.error.message);
    if (usageRes.error) throw new Error(usageRes.error.message);

    const aiMap = new Map<string, { cost_usd: number; calls: number }>();
    for (const r of costRes.data ?? []) {
      const day = String(r.created_at).slice(0, 10);
      const cur = aiMap.get(day) ?? { cost_usd: 0, calls: 0 };
      cur.cost_usd += Number(r.cost_usd ?? 0);
      cur.calls += 1;
      aiMap.set(day, cur);
    }

    const imgMap = new Map<string, { images: number; requests: number }>();
    for (const r of usageRes.data ?? []) {
      const day = String(r.day).slice(0, 10);
      const cur = imgMap.get(day) ?? { images: 0, requests: 0 };
      cur.images += Number(r.image_count ?? 0);
      cur.requests += Number(r.count ?? 0);
      imgMap.set(day, cur);
    }

    // Emit a continuous series so gaps read as zero instead of collapsing.
    const aiByDay: Array<{ day: string; cost_usd: number; calls: number }> = [];
    const imagesByDay: Array<{ day: string; images: number; requests: number }> = [];
    for (let i = data.days - 1; i >= 0; i--) {
      const day = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10);
      const a = aiMap.get(day);
      const b = imgMap.get(day);
      aiByDay.push({ day, cost_usd: Number((a?.cost_usd ?? 0).toFixed(4)), calls: a?.calls ?? 0 });
      imagesByDay.push({ day, images: b?.images ?? 0, requests: b?.requests ?? 0 });
    }

    return { days: data.days, aiByDay, imagesByDay };
  });
