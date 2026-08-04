// Local bridge endpoint. A small process on the trader's own machine polls this
// with its bridge token, claims queued orders for IBKR Client Portal Gateway or
// NinjaTrader, and reports the fill back.
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const ReportSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(["filled", "failed", "cancelled"]),
  brokerOrderId: z.string().max(120).optional(),
  error: z.string().max(500).optional(),
});

async function authorize(request: Request) {
  const token = request.headers.get("x-bridge-token")?.trim();
  if (!token || token.length < 24) return null;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("bridge_tokens")
    .select("user_id")
    .eq("token", token)
    .maybeSingle();
  if (!data) return null;
  await supabaseAdmin
    .from("bridge_tokens")
    .update({ last_seen_at: new Date().toISOString() })
    .eq("token", token);
  return { userId: data.user_id as string, supabaseAdmin };
}

export const Route = createFileRoute("/api/public/bridge")({
  server: {
    handlers: {
      // Claim queued orders for this trader.
      GET: async ({ request }) => {
        const auth = await authorize(request);
        if (!auth) return new Response("unauthorized", { status: 401 });
        const { data, error } = await auth.supabaseAdmin
          .from("bridge_orders")
          .select("*")
          .eq("user_id", auth.userId)
          .eq("status", "queued")
          .order("created_at", { ascending: true })
          .limit(10);
        if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
        const orders = data ?? [];
        if (orders.length > 0) {
          await auth.supabaseAdmin
            .from("bridge_orders")
            .update({ status: "claimed", claimed_at: new Date().toISOString() })
            .in("id", orders.map((o) => o.id as string));
        }
        return Response.json({
          ok: true,
          orders: orders.map((o) => ({
            id: o.id,
            venue: o.venue,
            symbol: o.symbol,
            side: o.side,
            orderType: o.order_type,
            quantity: Number(o.quantity),
            price: o.price === null ? null : Number(o.price),
            stopLoss: o.stop_loss === null ? null : Number(o.stop_loss),
            takeProfit: o.take_profit === null ? null : Number(o.take_profit),
            accountId: o.account_id,
          })),
        });
      },
      // Report the outcome of a claimed order.
      POST: async ({ request }) => {
        const auth = await authorize(request);
        if (!auth) return new Response("unauthorized", { status: 401 });
        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return Response.json({ ok: false, error: "invalid json" }, { status: 400 });
        }
        const parsed = ReportSchema.safeParse(body);
        if (!parsed.success) {
          return Response.json({ ok: false, error: "invalid payload" }, { status: 400 });
        }
        const { error } = await auth.supabaseAdmin
          .from("bridge_orders")
          .update({
            status: parsed.data.status,
            broker_order_id: parsed.data.brokerOrderId ?? null,
            error: parsed.data.error ?? null,
            completed_at: new Date().toISOString(),
          })
          .eq("id", parsed.data.id)
          .eq("user_id", auth.userId);
        if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
        return Response.json({ ok: true });
      },
    },
  },
});
