import { createFileRoute } from "@tanstack/react-router";
import type Stripe from "stripe";

function subscriptionIdOf(event: Stripe.Event): string | null {
  const obj = event.data.object as unknown as Record<string, unknown>;
  if (typeof obj["subscription"] === "string") return obj["subscription"] as string;
  const nested = obj["subscription"] as { id?: string } | null | undefined;
  if (nested?.id) return nested.id;
  if (event.type.startsWith("customer.subscription.") && typeof obj["id"] === "string") {
    return obj["id"] as string;
  }
  return null;
}

export const Route = createFileRoute("/api/public/stripe-webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const signature = request.headers.get("stripe-signature");
        const secret = process.env["STRIPE_WEBHOOK_SECRET"];
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

        const SUBSCRIPTION_EVENTS = new Set([
          "customer.subscription.created",
          "customer.subscription.updated",
          "customer.subscription.deleted",
          "customer.subscription.paused",
          "customer.subscription.resumed",
          "customer.subscription.trial_will_end",
          "checkout.session.completed",
          "invoice.payment_succeeded",
          "invoice.payment_failed",
        ]);

        if (!SUBSCRIPTION_EVENTS.has(event.type)) {
          return new Response("ignored", { status: 200 });
        }

        try {
          const { claimEvent, syncSubscription } = await import("@/lib/stripe-sync.server");

          const fresh = await claimEvent({
            id: event.id,
            type: event.type,
            created: event.created,
            subscriptionId: subscriptionIdOf(event),
          });
          if (!fresh) return new Response("duplicate", { status: 200 });

          let sub: Stripe.Subscription | null = null;
          if (event.type.startsWith("customer.subscription.")) {
            // Re-read from Stripe so cancel/resume/period_end reflect current truth,
            // not a payload that may already be superseded.
            const id = (event.data.object as Stripe.Subscription).id;
            sub = await stripe.subscriptions.retrieve(id);
          } else {
            const subId = subscriptionIdOf(event);
            if (subId) sub = await stripe.subscriptions.retrieve(subId);
          }

          if (!sub) return new Response("no subscription on event", { status: 200 });

          const result = await syncSubscription(sub, event.created);
          if (!result.ok) {
            console.warn("[stripe-webhook] unresolved user for subscription", sub.id, event.type);
          }
        } catch (err) {
          console.error("[stripe-webhook] handler error", event.type, err);
          // Release the claim so Stripe's retry is not treated as a duplicate.
          try {
            const { releaseEvent } = await import("@/lib/stripe-sync.server");
            await releaseEvent(event.id);
          } catch { /* best effort */ }
          return new Response("Handler error", { status: 500 });
        }

        return new Response("ok", { status: 200 });
      },
    },
  },
});
