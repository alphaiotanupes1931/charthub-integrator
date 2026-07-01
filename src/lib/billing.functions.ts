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
    // Only offer trial if user has never had one before
    const hasHadTrial = !!existing?.trial_end;

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      subscription_data: hasHadTrial
        ? { metadata: { user_id: userId } }
        : { trial_period_days: 7, metadata: { user_id: userId } },
      success_url: `${origin}/dashboard?checkout=success`,
      cancel_url: `${origin}/pricing?checkout=cancelled`,
      allow_promotion_codes: true,
      client_reference_id: userId,
    });

    return { url: session.url };
  });

export const createPortalSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
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
    const portal = await stripe.billingPortal.sessions.create({
      customer: sub.stripe_customer_id,
      return_url: `${origin}/settings`,
    });
    return { url: portal.url };
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
