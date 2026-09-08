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
      const { sendRawEmail, logEmailSend } = await import("@/lib/email-raw.server");
      for (const to of recipients) {
        try {
          const result = await sendRawEmail({
            to,
            subject: mail.subject,
            html: mail.html,
            text: mail.text,
            label: "platform_status",
            idempotencyKey: `status:${stamp}:${to}`,
          });
          await logEmailSend(supabaseAdmin as never, {
            template_name: "platform_status",
            recipient_email: to,
            status: result.sent ? "sent" : "suppressed",
          });
          if (result.sent) emailed += 1;
        } catch (e) {
          const message = (e as Error).message;
          await logEmailSend(supabaseAdmin as never, {
            template_name: "platform_status",
            recipient_email: to,
            status: "failed",
            error_message: message.slice(0, 1000),
          });
          console.error("[status] email send failed", (e as Error).message);
          // A 429 asks us to back off before the next recipient.
          const retryAfter = (e as { retryAfterSeconds?: number | null }).retryAfterSeconds;
          if (typeof retryAfter === "number" && retryAfter > 0) {
            await new Promise((r) => setTimeout(r, Math.min(retryAfter, 30) * 1000));
          }
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
  .inputValidator((data) => z.object({ days: z.number().int().min(1).max(365).default(30) }).parse(data ?? {}))
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
    const VISION_MULTIPLIER = 3;
    const costRows = costRes.data ?? [];
    const totalCost = costRows.reduce((s, r) => s + Number(r.cost_usd ?? 0), 0);
    const avgCall = costRows.length ? totalCost / costRows.length : 0;
    const estCostPerImage = Number((avgCall * VISION_MULTIPLIER).toFixed(6));

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

    const imageCost = Number((totalImages * estCostPerImage).toFixed(4));
    // Income is reported from Stripe in the money panels, not from this usage read.
    const grossMonthly = 0;

    return {
      days: data.days,
      rows,
      totals: {
        images: totalImages,
        requests: totalRequests,
        est_cost_usd: imageCost,
        est_cost_per_image: estCostPerImage,
      },
      breakdown: {
        total_ai_cost_usd: Number(totalCost.toFixed(4)),
        ai_calls: costRows.length,
        avg_call_usd: Number(avgCall.toFixed(6)),
        vision_multiplier: VISION_MULTIPLIER,
        image_cost_usd: imageCost,
        image_share_pct: totalCost > 0 ? Number(((imageCost / totalCost) * 100).toFixed(1)) : 0,
        text_cost_usd: Number(Math.max(0, totalCost - imageCost).toFixed(4)),
        cost_per_read_usd: estCostPerImage,
        reads_per_dollar: estCostPerImage > 0 ? Math.floor(1 / estCostPerImage) : 0,
        gross_monthly_usd: Number(grossMonthly.toFixed(2)),
        real_profit_usd: Number((grossMonthly - totalCost).toFixed(2)),
      },
    };
  });

/**
 * Daily trend series for the admin usage charts: AI spend/calls per day and
 * screenshot reads per day, over the same day window as the tables.
 */
export const adminUsageTrends = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ days: z.number().int().min(1).max(365).default(30) }).parse(data ?? {}))
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

/**
 * Real billed Anthropic cost for this month, straight from Anthropic's own
 * cost report, next to our in-app token estimate so the two can be compared.
 */
export const adminAnthropicCost = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.userId);
    const { anthropicMonthToDate } = await import("@/lib/anthropic-usage.server");
    return await anthropicMonthToDate();
  });
