// Server-only: maps Stripe subscription state onto the Supabase subscriptions row.
import type Stripe from "stripe";

export type SubscriptionSyncResult =
  | { ok: true; userId: string; status: string; tier: string | null; skipped?: "stale" }
  | { ok: false; reason: "no_user" };

function unixToIso(value: number | null | undefined): string | null {
  return typeof value === "number" && value > 0 ? new Date(value * 1000).toISOString() : null;
}

/** Period end moved from the subscription to its items in newer Stripe API versions. */
export function readPeriodEnd(sub: Stripe.Subscription): string | null {
  const top = (sub as unknown as { current_period_end?: number }).current_period_end;
  if (typeof top === "number" && top > 0) return unixToIso(top);
  const itemEnds = sub.items?.data
    ?.map((i) => (i as unknown as { current_period_end?: number }).current_period_end)
    .filter((v): v is number => typeof v === "number" && v > 0);
  if (itemEnds && itemEnds.length) return unixToIso(Math.max(...itemEnds));
  return unixToIso((sub as unknown as { cancel_at?: number }).cancel_at);
}

/** Stripe stops billing on these; entitlements must fall back to the free tier. */
const DEAD_STATUSES = new Set(["canceled", "incomplete_expired", "unpaid"]);

export async function resolveUserId(sub: Stripe.Subscription): Promise<string | undefined> {
  const fromSub = (sub.metadata?.user_id as string | undefined) || undefined;
  if (fromSub) return fromSub;

  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer?.id;
  if (!customerId) return undefined;

  const { getStripe } = await import("@/lib/stripe.server");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const stripe = getStripe();

  const cust = await stripe.customers.retrieve(customerId);
  if (!cust || "deleted" in cust) return undefined;

  const fromCust = (cust.metadata?.user_id as string | undefined) || undefined;
  if (fromCust) return fromCust;
  if (!cust.email) return undefined;

  const { data: users } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 200 });
  const target = users?.users.find((u) => u.email?.toLowerCase() === cust.email!.toLowerCase());
  if (!target) return undefined;

  // Cache the mapping so later events resolve without a user scan.
  await stripe.customers.update(customerId, {
    metadata: { ...(cust.metadata || {}), user_id: target.id },
  });
  return target.id;
}

/**
 * Writes Stripe subscription state into Supabase.
 * `eventCreatedAt` (Stripe event `created`, seconds) guards against out-of-order
 * deliveries overwriting newer state.
 */
export async function syncSubscription(
  sub: Stripe.Subscription,
  eventCreatedAt?: number,
): Promise<SubscriptionSyncResult> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { tierFromPrice } = await import("@/lib/stripe.server");

  const userId = await resolveUserId(sub);
  if (!userId) return { ok: false, reason: "no_user" };

  const eventIso = unixToIso(eventCreatedAt);
  if (eventIso) {
    const { data: existing } = await supabaseAdmin
      .from("subscriptions")
      .select("last_event_at")
      .eq("user_id", userId)
      .maybeSingle();
    const prev = existing?.last_event_at ? Date.parse(existing.last_event_at) : 0;
    if (prev && prev > Date.parse(eventIso)) {
      return { ok: true, userId, status: sub.status, tier: null, skipped: "stale" };
    }
  }

  const tier = tierFromPrice(sub.items.data[0]?.price);
  const dead = DEAD_STATUSES.has(sub.status);
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer?.id;

  await supabaseAdmin.from("subscriptions").upsert(
    {
      user_id: userId,
      stripe_customer_id: customerId ?? null,
      stripe_subscription_id: sub.id,
      // Dropping the tier is what moves entitlements back to the free plan.
      tier: dead ? null : tier,
      status: sub.status,
      current_period_end: dead ? null : readPeriodEnd(sub),
      trial_end: dead ? null : unixToIso(sub.trial_end),
      cancel_at_period_end: dead ? false : !!sub.cancel_at_period_end,
      last_event_at: eventIso ?? new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );

  return { ok: true, userId, status: sub.status, tier: dead ? null : tier };
}

/** Returns false when this Stripe event id was already applied. */
export async function claimEvent(event: {
  id: string;
  type: string;
  created: number;
  subscriptionId?: string | null;
}): Promise<boolean> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { error } = await supabaseAdmin.from("stripe_webhook_events").insert({
    event_id: event.id,
    event_type: event.type,
    stripe_subscription_id: event.subscriptionId ?? null,
    event_created_at: unixToIso(event.created),
  });
  if (error) {
    // 23505 = unique violation: this delivery is a replay.
    if (error.code === "23505") return false;
    throw error;
  }
  return true;
}
