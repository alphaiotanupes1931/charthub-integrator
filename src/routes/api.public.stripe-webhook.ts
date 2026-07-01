import { createFileRoute } from "@tanstack/react-router";
import type Stripe from "stripe";

async function upsertSubscription(sub: Stripe.Subscription) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { tierFromPrice } = await import("@/lib/stripe.server");

  const price = sub.items.data[0]?.price;
  const tier = tierFromPrice(price);

  // Resolve user_id: prefer subscription metadata, else customer metadata, else email match
  let userId: string | undefined = (sub.metadata?.user_id as string | undefined) || undefined;

  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer?.id;
  if (!userId && customerId) {
    const { getStripe } = await import("@/lib/stripe.server");
    const stripe = getStripe();
    const cust = await stripe.customers.retrieve(customerId);
    if (cust && !("deleted" in cust)) {
      userId = (cust.metadata?.user_id as string | undefined) || undefined;
      if (!userId && cust.email) {
        // Match by email against auth.users
        const { data: users } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 200 });
        const target = users?.users.find(
          (u) => u.email?.toLowerCase() === cust.email!.toLowerCase(),
        );
        if (target) {
          userId = target.id;
          await stripe.customers.update(customerId, {
            metadata: { ...(cust.metadata || {}), user_id: target.id },
          });
        }
      }
    }
  }
  if (!userId) {
    console.warn("[stripe-webhook] could not resolve user for subscription", sub.id);
    return;
  }

  const cpe = (sub as unknown as { current_period_end?: number }).current_period_end;
  await supabaseAdmin.from("subscriptions").upsert(
    {
      user_id: userId,
      stripe_customer_id: customerId ?? null,
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
}

export const Route = createFileRoute("/api/public/stripe-webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const signature = request.headers.get("stripe-signature");
        const secret = process.env.STRIPE_WEBHOOK_SECRET;
        if (!signature || !secret) {
          return new Response("Missing signature or secret", { status: 400 });
        }
        const body = await request.text();

        const { getStripe } = await import("@/lib/stripe.server");
        const stripe = getStripe();

        let event: Stripe.Event;
        try {
          event = await stripe.webhooks.constructEventAsync(body, signature, secret);
        } catch (err) {
          console.error("[stripe-webhook] signature verify failed", err);
          return new Response("Invalid signature", { status: 400 });
        }

        try {
          switch (event.type) {
            case "customer.subscription.created":
            case "customer.subscription.updated":
            case "customer.subscription.deleted": {
              await upsertSubscription(event.data.object as Stripe.Subscription);
              break;
            }
            case "checkout.session.completed": {
              const session = event.data.object as Stripe.Checkout.Session;
              if (session.subscription) {
                const subId =
                  typeof session.subscription === "string"
                    ? session.subscription
                    : session.subscription.id;
                const sub = await stripe.subscriptions.retrieve(subId);
                await upsertSubscription(sub);
              }
              break;
            }
            default:
              break;
          }
        } catch (err) {
          console.error("[stripe-webhook] handler error", err);
          return new Response("Handler error", { status: 500 });
        }

        return new Response("ok", { status: 200 });
      },
    },
  },
});
