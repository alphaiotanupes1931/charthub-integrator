// Public entry point for the 3-layer research stack.
// L1: getSnapshot   L2: runResearch   L3: runPlanner
//
// Auth: `requireSupabaseAuth`. Admin bypass on the shared 5/day scan cap is
// enforced upstream in the chat route; this fn is called *in addition* to the
// coach chat, so we keep it lightweight and let cost show up on the AI bill.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getSnapshot } from "./market-data.server";
import { runResearch } from "./research.server";
import { runPlanner } from "./planner.server";
import type { TradePlan } from "./types";

const Input = z.object({
  ticker: z.string().min(1).max(20),
  interval: z.string().min(1).max(4),
  lensDesc: z.string().max(500).optional(),
});

export const runResearchPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => Input.parse(raw))
  .handler(async ({ data }): Promise<TradePlan> => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("LOVABLE_API_KEY not configured");

    const snap = await getSnapshot(data.ticker, data.interval);
    if (snap.source === "unavailable" || snap.candles.length < 20) {
      return {
        grade: "NO ENTRY",
        bias: "Neutral",
        confidence: 0,
        notes: "Market data unavailable for this instrument right now.",
        entry: "—", stop: "—", tp1: "—", tp2: "—", rr: "—",
        details: "The data layer could not fetch enough candles to run the research agents. Try again in a minute or switch to a different timeframe.",
        memo: {
          ticker: data.ticker,
          interval: data.interval,
          generatedAt: new Date().toISOString(),
          notes: [],
          consensus: "neutral",
          consensusConfidence: 0,
        },
      };
    }

    const memo = await runResearch(apiKey, snap);
    const plan = await runPlanner(apiKey, snap, memo, data.lensDesc);
    return plan;
  });
