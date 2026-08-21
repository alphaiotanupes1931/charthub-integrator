import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const DaysInput = z.object({ days: z.number().int().min(1).max(365).default(30) });

export const aiCostSummary = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => DaysInput.parse(data ?? {}))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const [{ data: summary, error: e1 }, { data: perUser, error: e2 }] = await Promise.all([
      supabase.rpc("admin_ai_cost_summary" as never, { _days: data.days } as never),
      supabase.rpc("admin_ai_cost_per_user" as never, { _days: data.days, _limit: 50 } as never),
    ]);
    if (e1) throw new Error(e1.message);
    if (e2) throw new Error(e2.message);
    return {
      byKind: (summary ?? []) as unknown as Array<{
        kind: string; model: string; calls: number;
        input_tokens: number; cached_input_tokens: number; output_tokens: number; cost_usd: number;
      }>,
      byUser: (perUser ?? []) as unknown as Array<{
        user_id: string; email: string | null; calls: number;
        graded_setups: number; cost_usd: number; cost_per_setup: number;
      }>,
    };
  });
