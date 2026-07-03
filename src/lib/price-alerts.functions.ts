// Authenticated CRUD server functions for user price alerts.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export interface PriceAlertRow {
  id: string;
  symbol: string;
  side: "above" | "below";
  price: number;
  note: string | null;
  active: boolean;
  auto_delete: boolean;
  triggered_at: string | null;
  last_checked_price: number | null;
  last_checked_at: string | null;
  created_at: string;
}

type Ctx = { supabase: SupabaseClient; userId: string };

export const listMyPriceAlerts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as Ctx;
    const { data, error } = await supabase
      .from("price_alerts")
      .select("id, symbol, side, price, note, active, auto_delete, triggered_at, last_checked_price, last_checked_at, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    return { rows: (data ?? []) as unknown as PriceAlertRow[] };
  });

const CreateInput = z.object({
  symbol: z.string().min(1).max(32),
  side: z.enum(["above", "below"]),
  price: z.number().positive(),
  note: z.string().max(280).optional(),
  auto_delete: z.boolean().optional(),
});

export const createPriceAlert = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => CreateInput.parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as Ctx;
    const { data: row, error } = await supabase
      .from("price_alerts")
      .insert({
        user_id: userId,
        symbol: data.symbol.trim().toUpperCase(),
        side: data.side,
        price: data.price,
        note: data.note ?? null,
        auto_delete: data.auto_delete ?? true,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return row as unknown as PriceAlertRow;
  });

const IdInput = z.object({ id: z.string().uuid() });

export const deletePriceAlert = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => IdInput.parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as Ctx;
    const { error } = await supabase.from("price_alerts").delete().eq("id", data.id).eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const togglePriceAlert = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ id: z.string().uuid(), active: z.boolean() }).parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as Ctx;
    const { error } = await supabase
      .from("price_alerts")
      .update({ active: data.active, triggered_at: data.active ? null : undefined })
      .eq("id", data.id)
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
