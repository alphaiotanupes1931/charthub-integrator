import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const upsertSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1).max(120),
  email: z.string().max(200).nullable().optional(),
  monthlyAmountCents: z.number().int().min(0).max(100_000_00),
  note: z.string().max(300).nullable().optional(),
  active: z.boolean().default(true),
});

export const listManualRevenue = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("manual_revenue")
      .select("id,name,email,monthly_amount_cents,note,active,updated_at")
      .order("monthly_amount_cents", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const upsertManualRevenue = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => upsertSchema.parse(data))
  .handler(async ({ data, context }) => {
    const row = {
      name: data.name,
      email: data.email ?? null,
      monthly_amount_cents: data.monthlyAmountCents,
      note: data.note ?? null,
      active: data.active,
    };
    const query = data.id
      ? context.supabase.from("manual_revenue").update(row).eq("id", data.id)
      : context.supabase.from("manual_revenue").insert(row);
    const { data: saved, error } = await query
      .select("id,name,email,monthly_amount_cents,note,active,updated_at")
      .single();
    if (error) throw new Error(error.message);
    return saved;
  });

export const deleteManualRevenue = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ id: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("manual_revenue")
      .delete()
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
