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
import { formatPerfForPrompt } from "@/lib/strategy-perf.shared";

import type { TradePlan } from "./types";
import { classifyTradeStyle, type TradeStyle } from "@/lib/tradeTiming";
import { SCANNER_METHODOLOGY_VERSION } from "@/lib/scanner-methodology";

export const runResearchPlan = createServerFn({ method: "POST" })
  .inputValidator((raw: unknown) => z.object({
    ticker: z.string().min(1).max(20),
    interval: z.string().min(1).max(4),
    lensDesc: z.string().max(500).optional(),
    strategyDesc: z.string().max(800).optional(),
    strategyId: z.string().max(80).optional(),
    /** True when the trader let the platform pick the playbook. */
    autoStrategy: z.boolean().optional(),
    tradeStyle: z.enum(["scalp", "intraday", "swing"]).optional(),
    coach: z.string().max(60).optional(),
    journalPerf: z.string().max(300).optional(),
  }).parse(raw))
  .handler(async ({ data }): Promise<TradePlan> => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) {
      return {
        methodologyVersion: SCANNER_METHODOLOGY_VERSION,
        grade: "NO ENTRY",
        bias: "Neutral",
        confidence: 0,
        notes: "The AI research service is temporarily unavailable. Please try again shortly.",
        entry: "-", stop: "-", tp1: "-", tp2: "-", rr: "-",
        details: "Our analysis engine is offline for maintenance. Your charts and data are unaffected - scans will resume automatically once the service is back.",
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
        methodologyVersion: SCANNER_METHODOLOGY_VERSION,
        grade: "NO ENTRY",
        bias: "Neutral",
        confidence: 0,
        notes: "Market data unavailable for this instrument right now.",
        entry: "-", stop: "-", tp1: "-", tp2: "-", rr: "-",
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

    // Auto strategy: read live conditions and pick the playbook ourselves, so
    // the trader is told what is being used instead of having to choose.
    let strategyDesc = data.strategyDesc;
    let autoPick: { name: string; slug: string; regime: string; reason: string } | undefined;
    if (data.autoStrategy) {
      const { autoStrategyForSnapshot } = await import("./strategy-auto.server");
      const { regimeLabel } = await import("@/lib/strategyAuto");
      const { pick, desc } = autoStrategyForSnapshot(snap);
      strategyDesc = desc;
      autoPick = { name: pick.name, slug: pick.slug, regime: regimeLabel(pick.regime), reason: pick.reason };
    }
    const atrPct = snap.lastPrice > 0 ? (snap.stats.atr14 / snap.lastPrice) * 100 : 0;
    const tradeStyle: TradeStyle = classifyTradeStyle({
      interval: snap.interval,
      atrPct,
      aligned: snap.mtf?.alignment === "aligned-long" || snap.mtf?.alignment === "aligned-short",
      tradeStyle: data.tradeStyle,
    });

    // Load Hermes memory relevant to this ticker / lens.
    let hermesPrompt = "";
    let costUserId: string | null = null;

    let perfDesc = "";
    let scoreDesc = "";
    let gradeCap: "A+" | "A" | "B" | "C" | null = null;
    let capReason: string | null = null;
    // The account's chosen analysis model ("classic" | "focus") routes the
    // planner: The Trading Channel gets its own deterministic engine and
    // rulebook, untouched by the Classic library.
    let modelId: import("@/lib/analysis-models").AnalysisModelId = "classic";
    // Applies only if the plan that comes back is itself counter-trend.
    let counterCap: "A+" | "A" | "B" | "C" | null = null;
    let counterCapReason: string | null = null;
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
        costUserId = userId ?? null;

        if (userId) {
          const { normalizeAnalysisModel } = await import("@/lib/analysis-models");
          const { data: modelRow } = await supabase
            .from("profiles")
            .select("analysis_model")
            .eq("id", userId)
            .maybeSingle();
          modelId = normalizeAnalysisModel((modelRow as { analysis_model?: string } | null)?.analysis_model);

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

          // Strategy performance loop: the measured edge of this playbook on
          // this instrument feeds straight into how the planner grades.
          if (data.strategyId) {
            const { data: perf } = await supabase
              .from("strategy_performance")
              .select("strategy_id,symbol,timeframe,trades,win_rate,expectancy_r,net_r,max_drawdown_pct")
              .eq("user_id", userId)
              .eq("strategy_id", data.strategyId)
              .order("updated_at", { ascending: false })
              .limit(6);
            const rows = (perf ?? []).map((r) => ({
              strategyId: r.strategy_id as string,
              symbol: r.symbol as string,
              timeframe: r.timeframe as string,
              trades: Number(r.trades),
              winRate: Number(r.win_rate),
              expectancyR: Number(r.expectancy_r),
              netR: Number(r.net_r),
              maxDrawdownPct: Number(r.max_drawdown_pct),
            }));
            const sameSymbol = rows.filter((r) => r.symbol === data.ticker);
            perfDesc = formatPerfForPrompt(sameSymbol.length ? sameSymbol : rows);
          }

          // Actual execution record on this symbol (paper/live) also shapes the
          // scanner's confidence; a playbook that backtests well but loses live
          // should get a warning.
          const { data: paper } = await supabase
            .from("paper_trades")
            .select("symbol,pnl,side,size,entry,exit")
            .eq("user_id", userId)
            .eq("symbol", data.ticker)
            .order("closed_at", { ascending: false })
            .limit(50);
          if (paper && paper.length > 0) {
            const trades = paper.length;
            const wins = paper.filter((t) => Number(t.pnl) > 0).length;
            const winRate = Math.round((wins / trades) * 100);
            const netPnl = paper.reduce((sum, t) => sum + Number(t.pnl), 0);
            const paperLine = `Paper execution on ${data.ticker}: ${trades} trades, ${winRate}% win rate, net P&L ${netPnl >= 0 ? "+" : ""}${netPnl.toFixed(2)}.`;
            perfDesc = perfDesc ? `${perfDesc} | ${paperLine}` : paperLine;
          }

          // Scoreboard feedback: what past scans on this instrument actually
          // did. This both informs the prompt and caps the final grade.
          try {
            const { scoreEvidenceFor } = await import("@/lib/signal-evidence.server");
            const ev = await scoreEvidenceFor(
              supabase as never,
              userId,
              data.ticker,
              data.strategyId,
            );
            if (ev.prompt) scoreDesc = ev.prompt;
            gradeCap = ev.cap;
            capReason = ev.reason;
            counterCap = ev.counterCap ?? null;
            counterCapReason = ev.counterReason ?? null;
          } catch { /* scoreboard feedback is best-effort */ }

          // If the user just passed a journal-performance summary, fold it in.
          if (data.journalPerf) {
            perfDesc = perfDesc ? `${perfDesc} | ${data.journalPerf}` : data.journalPerf;
          }
        }
      }
    } catch { /* memory is best-effort */ }

    const { withAiCostUser } = await import("@/lib/ai-cost.server");
    const { memo, plan } = await withAiCostUser(costUserId, async () => {
      const memo = await runResearch(apiKey, snap);
      const plan = await runPlanner(
        apiKey,
        snap,
        memo,
        data.lensDesc,
        hermesPrompt || undefined,
        strategyDesc,
        data.coach,
        perfDesc || undefined,
        scoreDesc || undefined,
        tradeStyle,
        modelId,
      );
      return { memo, plan };
    });
    void memo;


    // Hard self-correction: the measured record outranks the model's own
    // opinion of the setup, so the grade is clamped after the fact too.
    const useCounter = Boolean(plan.counterTrend && counterCap);
    if (gradeCap || useCounter) {
      const { applyGradeCap } = await import("@/lib/signal-evidence.server");
      // Worst applicable cap wins; the counter-trend record only bites when
      // this particular setup is fighting the higher timeframes.
      let capped = applyGradeCap(plan.grade, gradeCap);
      let effectiveReason = capped !== plan.grade ? capReason : null;
      if (useCounter) {
        const c2 = applyGradeCap(capped, counterCap);
        if (c2 !== capped) effectiveReason = counterCapReason;
        capped = c2;
      }
      if (capped !== plan.grade) {
        return {
          ...plan,
          autoStrategy: autoPick,
          tradeStyle,
          grade: capped as TradePlan["grade"],
          details: effectiveReason ? `${plan.details} ${effectiveReason}` : plan.details,
        };
      }
    }
    return { ...plan, ...(autoPick ? { autoStrategy: autoPick } : {}), tradeStyle };
  });

