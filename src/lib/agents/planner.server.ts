// Layer 3 — Planner. Paperclip-style plan → critique → refine loop (max 2 iterations)
// that consumes a ResearchMemo + MarketSnapshot and produces a concrete TradePlan.

import { generateText, Output, NoObjectGeneratedError } from "ai";
import { z } from "zod";
import { createAiGatewayProvider } from "@/lib/ai-gateway.server";
import type { MarketSnapshot, ResearchMemo, TradePlan } from "./types";

const MODEL = "google/gemini-3-flash-preview";

const PlanSchema = z.object({
  grade: z.enum(["A+", "A", "B", "C", "NO ENTRY"]),
  bias: z.enum(["Long", "Short", "Neutral"]),
  confidence: z.number(),
  entry: z.number(),
  stop: z.number(),
  tp1: z.number(),
  tp2: z.number(),
  thesis: z.string(),
  invalidation: z.string(),
});

const CritiqueSchema = z.object({
  verdict: z.enum(["approve", "revise"]),
  reason: z.string(),
});

function fallbackPlan(snap: MarketSnapshot, memo: ResearchMemo): z.infer<typeof PlanSchema> {
  return {
    grade: "NO ENTRY",
    bias: memo.consensus === "Long" ? "Long" : memo.consensus === "Short" ? "Short" : "Neutral",
    confidence: memo.consensusConfidence ?? 0,
    entry: snap.lastPrice,
    stop: snap.lastPrice,
    tp1: snap.lastPrice,
    tp2: snap.lastPrice,
    thesis: "Model did not return a structured plan; standing down until confluence is clearer.",
    invalidation: "Any decisive move against the consensus bias.",
  };
}

function decimalsFor(px: number): number {
  if (px >= 1000) return 2;
  if (px >= 10) return 3;
  if (px >= 1) return 4;
  return 5;
}
const fmt = (n: number, d: number) => n.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });

function memoBlock(memo: ResearchMemo, snap: MarketSnapshot, lensDesc?: string): string {
  const notes = memo.notes.map(n => `- ${n.role.toUpperCase()} (${n.bias}, ${n.confidence}%): ${n.summary}`).join("\n");
  return [
    `Ticker: ${snap.ticker} | Interval: ${snap.interval} | Last: ${snap.lastPrice} | ATR14: ${snap.stats.atr14.toFixed(4)}`,
    `20-bar range: ${snap.stats.low20} – ${snap.stats.high20}`,
    `Consensus: ${memo.consensus} @ ${memo.consensusConfidence}%`,
    lensDesc ? `Scan lens focus: ${lensDesc}` : "",
    "Analyst notes:",
    notes,
  ].filter(Boolean).join("\n");
}

export async function runPlanner(
  apiKey: string,
  snap: MarketSnapshot,
  memo: ResearchMemo,
  lensDesc?: string,
  hermesMemory?: string,
): Promise<TradePlan> {
  const provider = createAiGatewayProvider(apiKey);
  const ctx = memoBlock(memo, snap, lensDesc);
  const memoryLine = hermesMemory ? `\n\n${hermesMemory}` : "";

  // Step 1 — draft plan
  const draft = await generateText({
    model: provider(MODEL),
    output: Output.object({ schema: PlanSchema }),
    system: "You are the head trader. Produce a concrete plan (entry/stop/tp1/tp2 as raw numbers) grounded in the analyst notes. Use ATR to size the stop (~1-1.5x ATR). TP1 near 1.5R, TP2 near 3R. If consensus is weak or conflicting, use grade C or NO ENTRY." + memoryLine,
    prompt: ctx,
  });
  let plan = draft.output;

  // Step 2 — critic
  const critique = await generateText({
    model: provider(MODEL),
    output: Output.object({ schema: CritiqueSchema }),
    system: "You are the risk manager. Approve the plan if entry/stop/TP are in sensible relation to price (stop within 3x ATR, TPs on the correct side of entry, R:R >= 1.5). Otherwise say revise.",
    prompt: `${ctx}\n\nProposed plan: ${JSON.stringify(plan)}`,
  });

  // Step 3 — refine once if needed
  if (critique.output.verdict === "revise") {
    const revised = await generateText({
      model: provider(MODEL),
      output: Output.object({ schema: PlanSchema }),
      system: "You are the head trader. Revise the previous plan per the risk manager's note. Keep bias unless the critique explicitly demands a flip.",
      prompt: `${ctx}\n\nPrevious plan: ${JSON.stringify(plan)}\nRisk manager: ${critique.output.reason}`,
    });
    plan = revised.output;
  }

  const dec = decimalsFor(snap.lastPrice || plan.entry || 1);
  const risk = Math.abs(plan.entry - plan.stop) || 1;
  const reward = Math.abs(plan.tp2 - plan.entry);
  const rr = `1 : ${(reward / risk).toFixed(1)}`;
  const isNoEntry = plan.grade === "NO ENTRY";
  const details = `${plan.thesis} Invalidation: ${plan.invalidation}. Manage to break-even at TP1 (${fmt(plan.tp1, dec)}), trail runner to TP2 (${fmt(plan.tp2, dec)}). Risk 0.5-1R of account.`;

  return {
    grade: plan.grade,
    bias: plan.bias,
    confidence: Math.round(plan.confidence),
    notes: plan.thesis,
    entry: isNoEntry ? "—" : fmt(plan.entry, dec),
    stop:  isNoEntry ? "—" : fmt(plan.stop,  dec),
    tp1:   isNoEntry ? "—" : fmt(plan.tp1,   dec),
    tp2:   isNoEntry ? "—" : fmt(plan.tp2,   dec),
    rr:    isNoEntry ? "—" : rr,
    details,
    memo,
  };
}
