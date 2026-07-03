// Public entry point for the 3-layer research stack.
// L1: getSnapshot   L2: runResearch   L3: runPlanner (+ Hermes memory)

import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/react-start/server";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";
import { getSnapshot } from "./market-data.server";
import { runResearch } from "./research.server";
import { runPlanner } from "./planner.server";
import { formatLessonsForPrompt, type HermesLessonRow } from "./hermes.server";
import type { TradePlan } from "./types";

const Input = z.object({
  ticker: z.string().min(1).max(20),
  interval: z.string().min(1).max(4),
  lensDesc: z.string().max(500).optional(),
});

export const runResearchPlan = createServerFn({ method: "POST" })
  .inputValidator((raw: unknown) => Input.parse(raw))
  .handler(async ({ data }): Promise<TradePlan> => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) {
      return {
        grade: "NO ENTRY",
        bias: "Neutral",
        confidence: 0,
        notes: "The AI research service is temporarily unavailable. Please try again shortly.",
        entry: "—", stop: "—", tp1: "—", tp2: "—", rr: "—",
        details: "Our analysis engine is offline for maintenance. Your charts and data are unaffected — scans will resume automatically once the service is back.",
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

    // Load Hermes memory relevant to this ticker / lens.
    let hermesPrompt = "";
    try {
      const auth = getRequestHeader("authorization") ?? getRequestHeader("Authorization");
      const token = auth?.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : null;
      if (token) {
        const supabase = createClient<Database>(
          process.env.SUPABASE_URL!,
          process.env.SUPABASE_PUBLISHABLE_KEY!,
          {
            auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
            global: { headers: { Authorization: `Bearer ${token}` } },
          },
        );
        const { data: userData } = await supabase.auth.getUser(token);
        const userId = userData.user?.id;
        if (userId) {
          const topics = [data.ticker, "general", data.lensDesc?.split(":")[0] ?? ""].filter(Boolean);
          const { data: lessons } = await supabase
            .from("hermes_lessons")
            .select("id,user_id,scope,topic,lesson,weight,created_at")
            .or(`user_id.eq.${userId},user_id.is.null`)
            .in("topic", topics)
            .order("weight", { ascending: false })
            .order("created_at", { ascending: false })
            .limit(8);
          hermesPrompt = formatLessonsForPrompt((lessons ?? []) as HermesLessonRow[]);
        }
      }
    } catch { /* memory is best-effort */ }

    const memo = await runResearch(apiKey, snap);
    const plan = await runPlanner(apiKey, snap, memo, data.lensDesc, hermesPrompt || undefined);
    return plan;
  });
