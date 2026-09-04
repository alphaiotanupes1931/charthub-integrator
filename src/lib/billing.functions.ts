import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const tierSchema = z.object({
  tier: z.enum(["basic", "pro", "elite"]),
});

function originFromRequest(): string {
  try {
    const req = getRequest();
    const url = new URL(req.url);
    const proto = req.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
    const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? url.host;
    return `${proto}://${host}`;
  } catch {
    return "https://market-view-villa.lovable.app";
  }
}

export const createCheckoutSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => tierSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { getStripe, getPriceIdForTier } = await import("@/lib/stripe.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const stripe = getStripe();
    const userId = context.userId;
    const email = context.claims?.email as string | undefined;
    const priceId = await getPriceIdForTier(data.tier);

    // Reuse existing customer if we have one
    const { data: existing } = await supabaseAdmin
      .from("subscriptions")
      .select("stripe_customer_id, trial_end")
      .eq("user_id", userId)
      .maybeSingle();

    let customerId = existing?.stripe_customer_id as string | undefined;
    if (!customerId && email) {
      const found = await stripe.customers.list({ email, limit: 1 });
      customerId = found.data[0]?.id;
    }
    if (!customerId) {
      const created = await stripe.customers.create({
        email,
        metadata: { user_id: userId },
      });
      customerId = created.id;
    } else {
      // Ensure metadata mapping exists
      await stripe.customers.update(customerId, { metadata: { user_id: userId } });
    }

    const origin = originFromRequest();
    // Permanent free tier replaces the trial: once the flag is on, checkout is
    // straight to paid. Otherwise only offer a trial if they never had one.
    const { data: flag } = await supabaseAdmin
      .from("app_flags")
      .select("enabled")
      .eq("key", "free_tier_enabled")
      .maybeSingle();
    const freeTierOn = !!flag?.enabled;
    const hasHadTrial = !!existing?.trial_end;
    const offerTrial = !freeTierOn && !hasHadTrial;

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      subscription_data: offerTrial
        ? { trial_period_days: 7, metadata: { user_id: userId } }
        : { metadata: { user_id: userId } },

      success_url: `${origin}/dashboard?checkout=success`,
      cancel_url: `${origin}/pricing?checkout=cancelled`,
      allow_promotion_codes: true,
      client_reference_id: userId,
    });

    return { url: session.url };
  });

export const createPortalSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z
      .object({ flow: z.enum(["overview", "payment_method", "invoices"]).optional() })
      .parse(data ?? {}),
  )
  .handler(async ({ data, context }) => {
    const { getStripe } = await import("@/lib/stripe.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const stripe = getStripe();
    const { data: sub } = await supabaseAdmin
      .from("subscriptions")
      .select("stripe_customer_id")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (!sub?.stripe_customer_id) {
      throw new Error("No billing account yet. Start a subscription first.");
    }
    const origin = originFromRequest();
    // The `billing=updated` marker lets Settings re-read membership state on
    // return from Stripe, so users never have to refresh manually.
    const returnUrl = `${origin}/settings?billing=updated&flow=${data.flow ?? "overview"}`;
    const portal = await stripe.billingPortal.sessions.create({
      customer: sub.stripe_customer_id,
      return_url: returnUrl,
      ...(data.flow === "payment_method"
        ? {
            flow_data: {
              type: "payment_method_update" as const,
              after_completion: {
                type: "redirect" as const,
                redirect: { return_url: returnUrl },
              },
            },
          }
        : {}),
    });
    return { url: portal.url };
  });

/**
 * In-app cancellation, so members can end their membership from Settings even
 * when the hosted Stripe portal has no configuration. Cancels at period end so
 * they keep access until the paid period runs out.
 */
export const cancelMySubscription = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z.object({ resume: z.boolean().optional() }).parse(data ?? {}),
  )
  .handler(async ({ data, context }) => {
    const { getStripe } = await import("@/lib/stripe.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const stripe = getStripe();

    const { data: row } = await supabaseAdmin
      .from("subscriptions")
      .select("stripe_subscription_id")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (!row?.stripe_subscription_id) {
      throw new Error("No active subscription to change.");
    }

    const updated = await stripe.subscriptions.update(row.stripe_subscription_id, {
      cancel_at_period_end: !data.resume,
    });
    const cpe = (updated as unknown as { current_period_end?: number }).current_period_end;

    await supabaseAdmin
      .from("subscriptions")
      .update({
        status: updated.status,
        cancel_at_period_end: !!updated.cancel_at_period_end,
        current_period_end: cpe ? new Date(cpe * 1000).toISOString() : null,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", context.userId);

    return {
      cancel_at_period_end: !!updated.cancel_at_period_end,
      status: updated.status,
      current_period_end: cpe ? new Date(cpe * 1000).toISOString() : null,
    };
  });

export const getMySubscription = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("subscriptions")
      .select("tier,status,current_period_end,trial_end,cancel_at_period_end")
      .eq("user_id", context.userId)
      .maybeSingle();
    return data ?? null;
  });

export const syncMySubscriptionFromStripe = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const email = context.claims?.email as string | undefined;
    if (!email) return null;

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { getStripe, tierFromPrice } = await import("@/lib/stripe.server");
    const stripe = getStripe();

    const customers = await stripe.customers.list({ email, limit: 10 });
    let best:
      | {
          user_id: string;
          stripe_customer_id: string | null;
          stripe_subscription_id: string;
          tier: string | null;
          status: string;
          current_period_end: string | null;
          trial_end: string | null;
          cancel_at_period_end: boolean;
          updated_at: string;
        }
      | null = null;

    for (const customer of customers.data) {
      await stripe.customers.update(customer.id, {
        metadata: { ...(customer.metadata || {}), user_id: context.userId },
      });

      const subs = await stripe.subscriptions.list({
        customer: customer.id,
        status: "all",
        limit: 100,
        expand: ["data.items.data.price"],
      });

      for (const sub of subs.data) {
        if (sub.status === "canceled" || sub.status === "incomplete_expired") continue;
        const price = sub.items.data[0]?.price;
        const cpe = (sub as unknown as { current_period_end?: number }).current_period_end;
        const row = {
          user_id: context.userId,
          stripe_customer_id: customer.id,
          stripe_subscription_id: sub.id,
          tier: tierFromPrice(price),
          status: sub.status,
          current_period_end: cpe ? new Date(cpe * 1000).toISOString() : null,
          trial_end: sub.trial_end ? new Date(sub.trial_end * 1000).toISOString() : null,
          cancel_at_period_end: !!sub.cancel_at_period_end,
          updated_at: new Date().toISOString(),
        };
        if (!best || ["active", "trialing"].includes(row.status)) best = row;
        if (best && ["active", "trialing"].includes(best.status)) break;
      }
      if (best && ["active", "trialing"].includes(best.status)) break;
    }

    if (!best) return null;

    const { data, error } = await supabaseAdmin
      .from("subscriptions")
      .upsert(best, { onConflict: "user_id" })
      .select("tier,status,current_period_end,trial_end,cancel_at_period_end")
      .single();
    if (error) throw new Error(error.message);
    return data;
  });

export const listSubscribers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: isAdmin } = await supabaseAdmin.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Forbidden");

    const { getStripe, tierFromPrice } = await import("@/lib/stripe.server");
    const stripe = getStripe();

    const rows: Array<{
      email: string | null;
      status: string;
      tier: string | null;
      amount: number;
      currency: string;
      current_period_end: number;
      cancel_at_period_end: boolean;
      customer_id: string;
      subscription_id: string;
    }> = [];

    let startingAfter: string | undefined;
    let mrr = 0;
    for (let i = 0; i < 10; i++) {
      const batch = await stripe.subscriptions.list({
        status: "all",
        limit: 100,
        starting_after: startingAfter,
        expand: ["data.customer", "data.items.data.price"],
      });
      for (const sub of batch.data) {
        if (sub.status === "canceled" || sub.status === "incomplete_expired") continue;
        const price = sub.items.data[0]?.price;
        const cust = sub.customer as import("stripe").default.Customer | null;
        const email = cust && !("deleted" in cust) ? cust.email : null;
        const amount = price?.unit_amount ?? 0;
        if (sub.status === "active" || sub.status === "trialing") mrr += amount;
        rows.push({
          email,
          status: sub.status,
          tier: tierFromPrice(price),
          amount,
          currency: price?.currency ?? "usd",
          current_period_end: (sub as unknown as { current_period_end: number }).current_period_end,
          cancel_at_period_end: sub.cancel_at_period_end,
          customer_id: typeof sub.customer === "string" ? sub.customer : sub.customer?.id ?? "",
          subscription_id: sub.id,
        });
      }
      if (!batch.has_more) break;
      startingAfter = batch.data[batch.data.length - 1]?.id;
      if (!startingAfter) break;
    }

    return { subscribers: rows, mrr_cents: mrr, currency: "usd" };
  });

// Admin-triggered: pull every Stripe subscription and upsert to DB, matching
// customers to existing users by metadata.user_id or email. Useful once after
// wiring Stripe to grant access to pre-existing subscribers.
export const syncSubscribersFromStripe = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: isAdmin } = await supabaseAdmin.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Forbidden");

    const { getStripe, tierFromPrice } = await import("@/lib/stripe.server");
    const stripe = getStripe();

    // Preload all users once for email matching
    const { data: usersPage } = await supabaseAdmin.auth.admin.listUsers({
      page: 1,
      perPage: 1000,
    });
    const emailToId = new Map<string, string>();
    for (const u of usersPage?.users ?? []) {
      if (u.email) emailToId.set(u.email.toLowerCase(), u.id);
    }

    let synced = 0;
    let unmatched = 0;
    let startingAfter: string | undefined;

    for (let i = 0; i < 20; i++) {
      const batch = await stripe.subscriptions.list({
        status: "all",
        limit: 100,
        starting_after: startingAfter,
        expand: ["data.customer", "data.items.data.price"],
      });
      for (const sub of batch.data) {
        if (sub.status === "canceled" || sub.status === "incomplete_expired") continue;

        const cust = sub.customer as import("stripe").default.Customer | null;
        const custId = typeof sub.customer === "string" ? sub.customer : sub.customer?.id;
        let userId: string | undefined =
          (sub.metadata?.user_id as string | undefined) ||
          (cust && !("deleted" in cust)
            ? (cust.metadata?.user_id as string | undefined)
            : undefined);
        if (!userId && cust && !("deleted" in cust) && cust.email) {
          userId = emailToId.get(cust.email.toLowerCase());
          if (userId && custId) {
            await stripe.customers.update(custId, {
              metadata: { ...(cust.metadata || {}), user_id: userId },
            });
          }
        }
        if (!userId) {
          unmatched++;
          continue;
        }

        const price = sub.items.data[0]?.price;
        const tier = tierFromPrice(price);
        const cpe = (sub as unknown as { current_period_end?: number }).current_period_end;

        await supabaseAdmin.from("subscriptions").upsert(
          {
            user_id: userId,
            stripe_customer_id: custId ?? null,
            stripe_subscription_id: sub.id,
            tier,
            status: sub.status,
            current_period_end: cpe ? new Date(cpe * 1000).toISOString() : null,
            trial_end: sub.trial_end ? new Date(sub.trial_end * 1000).toISOString() : null,
            cancel_at_period_end: !!sub.cancel_at_period_end,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "user_id" },
        );
        synced++;
      }
      if (!batch.has_more) break;
      startingAfter = batch.data[batch.data.length - 1]?.id;
      if (!startingAfter) break;
    }

    return { synced, unmatched };
  });

/**
 * Admin-only: reconcile Stripe price objects with the tier amounts published on
 * /pricing (USD monthly), archiving any wrong-currency or stale price.
 */
export const syncStripePrices = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: isAdmin } = await supabaseAdmin.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Forbidden");
    const { syncPlanPrices } = await import("@/lib/stripe.server");
    return { prices: await syncPlanPrices() };
  });

export type PlanDebugSnapshot = {
  user: { id: string; email: string | null };
  freeTierFlag: boolean;
  isAdmin: boolean;
  db: {
    status: string | null;
    tier: string | null;
    current_period_end: string | null;
    trial_end: string | null;
    cancel_at_period_end: boolean;
    stripe_customer_id: string | null;
    stripe_subscription_id: string | null;
    updated_at: string | null;
  } | null;
  stripe: {
    subscriptionId: string;
    status: string;
    priceId: string | null;
    lookupKey: string | null;
    tier: string | null;
    amountCents: number | null;
    currency: string | null;
    interval: string | null;
    cancelAtPeriodEnd: boolean;
    currentPeriodEnd: string | null;
  } | null;
  stripeError: string | null;
  resolved: { tier: string; isPaid: boolean; onLegacyTrial: boolean; gradeLimit: number | null; capabilities: string[]; coachAllowance: number };
  quota: { active: boolean; used: number; limit: number; remaining: number; exhausted: boolean; month: string; timezone: string };
  mismatches: string[];
};

/**
 * Admin-only plan debug: the DB subscription row, the live Stripe price it maps
 * to, the tier that resolves from it, and the remaining grade quota — side by
 * side so a gating complaint can be diagnosed in one look. Defaults to the
 * calling admin; pass an email or user id to inspect another account.
 */
export const adminPlanDebug = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ email: z.string().trim().optional(), userId: z.string().uuid().optional() }).parse(input ?? {}),
  )
  .handler(async ({ data, context }): Promise<PlanDebugSnapshot> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: callerIsAdmin } = await supabaseAdmin.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!callerIsAdmin) throw new Error("Forbidden");

    const { resolveEntitlements, quotaView, dayKey } = await import("@/lib/entitlements");

    // Resolve which account we are inspecting.
    let userId = data.userId ?? context.userId;
    let email: string | null = (context.claims?.email as string | undefined) ?? null;
    if (data.email) {
      const wanted = data.email.toLowerCase();
      const { data: page } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 });
      const found = page?.users.find((u) => u.email?.toLowerCase() === wanted);
      if (!found) throw new Error(`No account found for ${data.email}`);
      userId = found.id;
      email = found.email ?? null;
    } else if (data.userId) {
      const { data: got } = await supabaseAdmin.auth.admin.getUserById(data.userId);
      email = got?.user?.email ?? null;
    }

    const [{ data: flag }, { data: row }, { data: adminRow }, { data: prefs }] = await Promise.all([
      supabaseAdmin.from("app_flags").select("enabled").eq("key", "free_tier_enabled").maybeSingle(),
      supabaseAdmin
        .from("subscriptions")
        .select(
          "status,tier,current_period_end,trial_end,cancel_at_period_end,stripe_customer_id,stripe_subscription_id,updated_at",
        )
        .eq("user_id", userId)
        .maybeSingle(),
      supabaseAdmin.from("user_roles").select("role").eq("user_id", userId).eq("role", "admin").maybeSingle(),
      supabaseAdmin.from("briefing_prefs").select("timezone").eq("user_id", userId).maybeSingle(),
    ]);

    const isAdmin = !!adminRow;
    const entitlements = resolveEntitlements({
      flagEnabled: !!flag?.enabled,
      isAdmin,
      subscription: row ? { status: row.status, tier: row.tier, trialEnd: row.trial_end } : null,
    });

    const timezone = prefs?.timezone || "UTC";
    const month = dayKey(timezone);
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
    const quota = quotaView(entitlements, used);

    // Live Stripe read: the price object is the ground truth for the tier.
    let stripe: PlanDebugSnapshot["stripe"] = null;
    let stripeError: string | null = null;
    try {
      const { getStripe, tierFromPrice } = await import("@/lib/stripe.server");
      const client = getStripe();
      let sub: import("stripe").default.Subscription | null = null;

      if (row?.stripe_subscription_id) {
        sub = await client.subscriptions.retrieve(row.stripe_subscription_id, {
          expand: ["items.data.price"],
        });
      } else {
        const customerId =
          row?.stripe_customer_id ??
          (email ? (await client.customers.list({ email, limit: 1 })).data[0]?.id : undefined);
        if (customerId) {
          const list = await client.subscriptions.list({
            customer: customerId,
            status: "all",
            limit: 10,
            expand: ["data.items.data.price"],
          });
          sub =
            list.data.find((s) => s.status === "active" || s.status === "trialing" || s.status === "past_due") ??
            list.data[0] ??
            null;
        }
      }

      if (sub) {
        const price = sub.items.data[0]?.price ?? null;
        const cpe = (sub as unknown as { current_period_end?: number }).current_period_end;
        stripe = {
          subscriptionId: sub.id,
          status: sub.status,
          priceId: price?.id ?? null,
          lookupKey: price?.lookup_key ?? null,
          tier: tierFromPrice(price),
          amountCents: price?.unit_amount ?? null,
          currency: price?.currency ?? null,
          interval: price?.recurring?.interval ?? null,
          cancelAtPeriodEnd: !!sub.cancel_at_period_end,
          currentPeriodEnd: cpe ? new Date(cpe * 1000).toISOString() : null,
        };
      }
    } catch (e) {
      stripeError = e instanceof Error ? e.message : "Stripe lookup failed";
    }

    // Anything here means the DB row and Stripe disagree, which is what causes
    // "I paid but it still gates me" reports.
    const mismatches: string[] = [];
    if (stripe && row) {
      if (stripe.status !== row.status) mismatches.push(`Status: Stripe ${stripe.status} vs saved ${row.status ?? "none"}`);
      const savedTier = row.tier ?? null;
      if (stripe.tier !== savedTier && !["canceled", "incomplete_expired", "unpaid"].includes(stripe.status)) {
        mismatches.push(`Tier: Stripe ${stripe.tier ?? "unknown price"} vs saved ${savedTier ?? "none"}`);
      }
      if (stripe.cancelAtPeriodEnd !== row.cancel_at_period_end) mismatches.push("Scheduled cancellation flag differs");
      if (stripe.currency && stripe.currency !== "usd") mismatches.push(`Price currency is ${stripe.currency.toUpperCase()}, not USD`);
      if (stripe.interval && stripe.interval !== "month") mismatches.push(`Price interval is ${stripe.interval}, not month`);
      if (!stripe.tier) mismatches.push("Stripe price has no recognised plan lookup key");
    } else if (stripe && !row) {
      mismatches.push("Stripe has a subscription but nothing is saved for this account");
    } else if (!stripe && row?.status && !["canceled", "incomplete_expired", "unpaid"].includes(row.status)) {
      mismatches.push(`Saved status ${row.status} but no matching Stripe subscription was found`);
    }

    return {
      user: { id: userId, email },
      freeTierFlag: !!flag?.enabled,
      isAdmin,
      db: row
        ? {
            status: row.status ?? null,
            tier: row.tier ?? null,
            current_period_end: row.current_period_end ?? null,
            trial_end: row.trial_end ?? null,
            cancel_at_period_end: !!row.cancel_at_period_end,
            stripe_customer_id: row.stripe_customer_id ?? null,
            stripe_subscription_id: row.stripe_subscription_id ?? null,
            updated_at: row.updated_at ?? null,
          }
        : null,
      stripe,
      stripeError,
      resolved: {
        tier: entitlements.tier,
        isPaid: entitlements.isPaid,
        onLegacyTrial: entitlements.onLegacyTrial,
        gradeLimit: entitlements.gradeLimit,
        capabilities: entitlements.capabilities,
        coachAllowance: entitlements.coachAllowance,
      },
      quota: { ...quota, remaining: Number.isFinite(quota.remaining) ? quota.remaining : -1, month, timezone },
      mismatches,
    };
  });
