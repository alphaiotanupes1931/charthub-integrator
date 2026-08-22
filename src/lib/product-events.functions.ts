import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Funnel events for the permanent free tier (§11 of the spec). */
export type ProductEventName =
  | "free_grade_used"
  | "free_quota_exhausted"
  | "paywall_shown"
  | "paywall_dismissed"
  | "upgrade_cta_clicked"
  | "analytics_preview_viewed"
  | "checkout_started";

export type ProductEventProps = Record<string, string | number | boolean | null>;

/**
 * Single write path for product analytics. Server-side so the numbers can't be
 * spoofed from the client and so the enrichment fields the spec asks for
 * (days_on_free, grades_used_lifetime, journalled_trade_count) are always the
 * real ones rather than whatever the page happened to have in state.
 */
export const trackProductEvent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { event: ProductEventName; props?: ProductEventProps }) => input)
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const userId = context.userId;

    const [{ data: profile }, { data: quota }, { count }] = await Promise.all([
      supabaseAdmin.from("profiles").select("created_at").eq("id", userId).maybeSingle(),
      supabaseAdmin
        .from("free_tier_quota")
        .select("lifetime_grades")
        .eq("user_id", userId)
        .order("month", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabaseAdmin
        .from("journal_trades")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId),
    ]);

    const createdAt = profile?.created_at ? new Date(profile.created_at).getTime() : null;
    const daysOnFree = createdAt
      ? Math.max(0, Math.floor((Date.now() - createdAt) / 86_400_000))
      : null;

    await supabaseAdmin.from("product_events").insert({
      user_id: userId,
      event: data.event,
      props: {
        ...(data.props ?? {}),
        days_on_free: daysOnFree,
        grades_used_lifetime: quota?.lifetime_grades ?? 0,
        journalled_trade_count: count ?? 0,
      },
    });

    return { ok: true };
  });
