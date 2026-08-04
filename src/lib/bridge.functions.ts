// Desktop bridge: IBKR Client Portal Gateway and NinjaTrader have no cloud REST
// API, so orders for those venues are queued here and a small local bridge
// process the trader runs on their own machine claims and fills them.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const BRIDGE_VENUES = ["interactivebrokers", "ninjatrader"] as const;

const QueueInput = z.object({
  venue: z.enum(BRIDGE_VENUES),
  symbol: z.string().min(1).max(30),
  side: z.enum(["buy", "sell"]),
  orderType: z.enum(["market", "limit", "stop"]).default("market"),
  quantity: z.coerce.number().positive(),
  price: z.coerce.number().optional(),
  stopLoss: z.coerce.number().optional(),
  takeProfit: z.coerce.number().optional(),
  accountId: z.string().max(60).optional(),
});

export type BridgeOrder = {
  id: string;
  venue: string;
  symbol: string;
  side: string;
  orderType: string;
  quantity: number;
  price: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  accountId: string | null;
  status: string;
  brokerOrderId: string | null;
  error: string | null;
  createdAt: string;
};

export const getBridgeToken = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ token: string; lastSeenAt: string | null }> => {
    const existing = await context.supabase
      .from("bridge_tokens")
      .select("token, last_seen_at")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (existing.data) {
      return { token: existing.data.token as string, lastSeenAt: (existing.data.last_seen_at as string | null) ?? null };
    }
    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    const token = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    const { error } = await context.supabase
      .from("bridge_tokens")
      .insert({ user_id: context.userId, token });
    if (error) throw new Error(error.message);
    return { token, lastSeenAt: null };
  });

export const rotateBridgeToken = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ token: string }> => {
    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    const token = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    const { error } = await context.supabase
      .from("bridge_tokens")
      .upsert({ user_id: context.userId, token, last_seen_at: null } as never, { onConflict: "user_id" });
    if (error) throw new Error(error.message);
    return { token };
  });

export const queueBridgeOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => QueueInput.parse(raw))
  .handler(async ({ data, context }): Promise<{ ok: true; id: string }> => {
    const { data: inserted, error } = await context.supabase
      .from("bridge_orders")
      .insert({
        user_id: context.userId,
        venue: data.venue,
        symbol: data.symbol,
        side: data.side,
        order_type: data.orderType,
        quantity: data.quantity,
        price: data.price ?? null,
        stop_loss: data.stopLoss ?? null,
        take_profit: data.takeProfit ?? null,
        account_id: data.accountId ?? null,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { ok: true, id: inserted.id as string };
  });

export const listBridgeOrders = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<BridgeOrder[]> => {
    const { data, error } = await context.supabase
      .from("bridge_orders")
      .select("*")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    return (data ?? []).map((o) => ({
      id: o.id as string,
      venue: o.venue as string,
      symbol: o.symbol as string,
      side: o.side as string,
      orderType: o.order_type as string,
      quantity: Number(o.quantity),
      price: o.price === null ? null : Number(o.price),
      stopLoss: o.stop_loss === null ? null : Number(o.stop_loss),
      takeProfit: o.take_profit === null ? null : Number(o.take_profit),
      accountId: (o.account_id as string | null) ?? null,
      status: o.status as string,
      brokerOrderId: (o.broker_order_id as string | null) ?? null,
      error: (o.error as string | null) ?? null,
      createdAt: o.created_at as string,
    }));
  });

export const cancelBridgeOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => z.object({ id: z.string().uuid() }).parse(raw))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("bridge_orders")
      .update({ status: "cancelled", completed_at: new Date().toISOString() })
      .eq("id", data.id)
      .eq("user_id", context.userId)
      .eq("status", "queued");
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });
