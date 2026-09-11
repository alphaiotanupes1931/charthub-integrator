// Admin-only controls for the paper-only research bots (Phase 6).
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function assertAdmin(userId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin.rpc("has_role", {
    _user_id: userId,
    _role: "admin",
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden");
}

const BotInput = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1).max(80),
  symbol: z.string().min(1).max(24),
  timeframe: z.string().min(1).max(4).default("60"),
  tradeStyle: z.enum(["scalp", "intraday", "swing"]).default("intraday"),
  minGrade: z.enum(["A+", "A", "B"]).default("A"),
});

export const adminListPaperBots = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [{ data: bots }, { data: trades }, { data: events }] = await Promise.all([
      supabaseAdmin.from("paper_bots").select("*").order("created_at", { ascending: false }),
      supabaseAdmin.from("paper_bot_trades").select("*").order("opened_at", { ascending: false }).limit(100),
      supabaseAdmin.from("paper_bot_events").select("*").order("created_at", { ascending: false }).limit(100),
    ]);
    return { bots: bots ?? [], trades: trades ?? [], events: events ?? [] };
  });

export const adminSavePaperBot = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => BotInput.parse(raw))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const row = {
      name: data.name,
      symbol: data.symbol,
      timeframe: data.timeframe,
      trade_style: data.tradeStyle,
      min_grade: data.minGrade,
      created_by: context.userId,
    };
    if (data.id) {
      const { error } = await supabaseAdmin.from("paper_bots").update(row).eq("id", data.id);
      if (error) throw new Error(error.message);
      return { id: data.id };
    }
    const { data: inserted, error } = await supabaseAdmin.from("paper_bots").insert(row).select("id").single();
    if (error) throw new Error(error.message);
    return { id: inserted.id };
  });

export const adminSetPaperBotStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) =>
    z.object({ id: z.string().uuid(), status: z.enum(["running", "paused"]) }).parse(raw))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("paper_bots").update({ status: data.status }).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Manual single pass — the "run one tick" button in the admin panel. */
export const adminRunPaperBotTick = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => z.object({ id: z.string().uuid() }).parse(raw))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { tickPaperBot } = await import("./paper-bot.server");
    const ran = await tickPaperBot(data.id);
    return { ran };
  });
