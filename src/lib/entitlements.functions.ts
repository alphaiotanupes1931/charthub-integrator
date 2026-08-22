import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { consumeGradeFlow, type QuotaStore } from "@/lib/quota-flow";
import {
  FREE_GRADES_PER_MONTH,
  monthKey,
  quotaView,
  resolveEntitlements,
  scanCacheKey,
  shouldConsumeGrade,
  type Entitlements,
  type QuotaView,
  type ScanOutcome,
} from "@/lib/entitlements";

export type EntitlementSnapshot = {
  entitlements: Entitlements;
  quota: QuotaView;
  month: string;
  timezone: string;
  journalledTrades: number;
};

/**
 * Everything the client needs to gate itself, resolved server-side in one call.
 * Paid and admin accounts come back with an inactive quota, so no quota UI or
 * paywall can render for them.
 */
export const getEntitlements = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<EntitlementSnapshot> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const userId = context.userId;

    const [{ data: flag }, { data: subscription }, { data: adminRow }, { data: prefs }] = await Promise.all([
      supabaseAdmin.from("app_flags").select("enabled").eq("key", "free_tier_enabled").maybeSingle(),
      supabaseAdmin.from("subscriptions").select("status,tier,trial_end").eq("user_id", userId).maybeSingle(),
      supabaseAdmin.from("user_roles").select("role").eq("user_id", userId).eq("role", "admin").maybeSingle(),
      supabaseAdmin.from("briefing_prefs").select("timezone").eq("user_id", userId).maybeSingle(),
    ]);

    const timezone = prefs?.timezone || "UTC";
    const entitlements = resolveEntitlements({
      flagEnabled: !!flag?.enabled,
      isAdmin: !!adminRow,
      subscription: subscription
        ? { status: subscription.status, tier: subscription.tier, trialEnd: subscription.trial_end }
        : null,
    });

    const month = monthKey(timezone);
    let used = 0;
    if (entitlements.freeTierActive) {
      const { data: quotaRow } = await supabaseAdmin
        .from("free_tier_quota")
        .select("grades_used")
        .eq("user_id", userId)
        .eq("month", month)
        .maybeSingle();
      used = quotaRow?.grades_used ?? 0;
    }

    // Their own trade count is the Analytics preview hook (§6), so it travels
    // with the snapshot rather than needing a second round trip.
    const { count } = await supabaseAdmin
      .from("journal_trades")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId);

    return {
      entitlements,
      quota: quotaView(entitlements, used),
      month,
      timezone,
      journalledTrades: count ?? 0,
    };
  });

export type ConsumeResult = {
  charged: boolean;
  quota: QuotaView;
  reason: "not_free_tier" | "not_chargeable" | "charged" | "limit_reached";
};

/**
 * Called after a scan has produced its answer, never before: a failure, timeout
 * or cached repeat must not cost the user a grade (§4).
 */
export const consumeGrade = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { outcome: ScanOutcome["kind"]; symbol?: string; timeframe?: string; methodology?: string }) => input)
  .handler(async ({ data, context }): Promise<ConsumeResult> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const userId = context.userId;

    const [{ data: flag }, { data: subscription }, { data: adminRow }, { data: prefs }] = await Promise.all([
      supabaseAdmin.from("app_flags").select("enabled").eq("key", "free_tier_enabled").maybeSingle(),
      supabaseAdmin.from("subscriptions").select("status,tier,trial_end").eq("user_id", userId).maybeSingle(),
      supabaseAdmin.from("user_roles").select("role").eq("user_id", userId).eq("role", "admin").maybeSingle(),
      supabaseAdmin.from("briefing_prefs").select("timezone").eq("user_id", userId).maybeSingle(),
    ]);

    const timezone = prefs?.timezone || "UTC";
    const entitlements = resolveEntitlements({
      flagEnabled: !!flag?.enabled,
      isAdmin: !!adminRow,
      subscription: subscription
        ? { status: subscription.status, tier: subscription.tier, trialEnd: subscription.trial_end }
        : null,
    });
    // Same pipeline the e2e tests drive, backed here by the real tables.
    const store: QuotaStore = {
      readUsed: async (month) => {
        const { data: row } = await supabaseAdmin
          .from("free_tier_quota")
          .select("grades_used")
          .eq("user_id", userId)
          .eq("month", month)
          .maybeSingle();
        return row?.grades_used ?? 0;
      },
      readCacheEntry: async (key) => {
        const { data: row } = await supabaseAdmin
          .from("scan_cache")
          .select("created_at")
          .eq("user_id", userId)
          .eq("cache_key", key)
          .maybeSingle();
        return row ? { createdAt: row.created_at } : null;
      },
      writeCacheEntry: async (key) => {
        await supabaseAdmin
          .from("scan_cache")
          .upsert({ user_id: userId, cache_key: key, result: {}, created_at: new Date().toISOString() });
      },
      increment: async (month, limit) => {
        const { error } = await supabaseAdmin.rpc("consume_free_grade", {
          _user_id: userId,
          _month: month,
          _limit: limit,
          _timezone: timezone,
        });
        return { error: !!error };
      },
    };

    return consumeGradeFlow({
      entitlements,
      timezone,
      store,
      input: data,
      limit: FREE_GRADES_PER_MONTH,
    });
  });

/** Admin switch for the whole change — flipping it off restores prior behaviour. */
export const setFreeTierFlag = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { enabled: boolean }) => input)
  .handler(async ({ data, context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Forbidden");
    const { error } = await context.supabase.rpc("admin_set_flag", { _key: "free_tier_enabled", _enabled: data.enabled });
    if (error) throw new Error(error.message);
    return { enabled: data.enabled };
  });
