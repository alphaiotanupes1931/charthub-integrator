import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { SupabaseClient } from "@supabase/supabase-js";

type Ctx = { supabase: SupabaseClient; userId: string };

async function assertAdmin(context: unknown) {
  const { supabase, userId } = context as Ctx;
  const { data, error } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden");

}

/** Admin panel: current AI credit / budget snapshot. */
export const aiCreditsStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { checkAiCredits } = await import("@/lib/ai-credits.server");
    return checkAiCredits({ notify: true });
  });

const BudgetInput = z.object({
  monthlyBudgetUsd: z.number().min(1).max(100_000),
  lowThresholdPct: z.number().int().min(1).max(90),
});

export const setAiBudget = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => BudgetInput.parse(raw))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabase } = context as Ctx;
    const { error } = await supabase
      .from("ai_budget")
      .update({
        monthly_budget_usd: data.monthlyBudgetUsd,
        low_threshold_pct: data.lowThresholdPct,
      })
      .eq("id", true);
    if (error) throw new Error(error.message);
    const { checkAiCredits } = await import("@/lib/ai-credits.server");
    return checkAiCredits({ notify: false });
  });
