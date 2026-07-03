// Layer 3 — Planner. Paperclip-style plan → critique → refine loop (max 2 iterations)
// that consumes a ResearchMemo + MarketSnapshot and produces a concrete TradePlan.

import { generateText, Output, NoObjectGeneratedError } from "ai";
import { z } from "zod";
import { createAiGatewayProvider } from "@/lib/ai-gateway.server";
import type { MarketSnapshot, ResearchMemo, TradePlan } from "./types";

const MODEL = "google/gemini-3-flash-preview";

// Permissive schema: accept strings that look like numbers/enums, then coerce.
// Gemini via the OpenAI-compat gateway does not enforce strict json_schema, so
// slight deviations (extra whitespace, "A+ setup", numbers-as-strings) would
// otherwise trip NoObjectGeneratedError and collapse to the fallback plan.
const PlanSchema = z.object({
  grade: z.string(),
  bias: z.string(),
  confidence: z.coerce.number(),
  entry: z.coerce.number(),
  stop: z.coerce.number(),
  tp1: z.coerce.number(),
  tp2: z.coerce.number(),
  thesis: z.string(),
  invalidation: z.string(),
});

type RawPlan = z.infer<typeof PlanSchema>;

const GRADES = ["A+", "A", "B", "C", "NO ENTRY"] as const;
const BIASES = ["Long", "Short", "Neutral"] as const;

function normalizeGrade(g: string): typeof GRADES[number] {
  const up = g.toUpperCase().trim();
  const hit = GRADES.find((x) => up.includes(x));
  return hit ?? "NO ENTRY";
}
function normalizeBias(b: string): typeof BIASES[number] {
  const low = b.toLowerCase();
  if (low.startsWith("long") || low.includes("bull")) return "Long";
  if (low.startsWith("short") || low.includes("bear")) return "Short";
  return "Neutral";
}

function salvagePlanFromText(text: string | undefined): RawPlan | null {
  if (!text) return null;
  // Strip markdown code fences and try to isolate the JSON object.
  const cleaned = text.replace(/```json/gi, "```").replace(/```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(cleaned.slice(start, end + 1));
    return PlanSchema.parse(parsed);
  } catch {
    return null;
  }
}

const CritiqueSchema = z.object({
  verdict: z.enum(["approve", "revise"]),
  reason: z.string(),
});

function fallbackPlan(snap: MarketSnapshot, memo: ResearchMemo): z.infer<typeof PlanSchema> {
  return {
    grade: "NO ENTRY",
    bias: memo.consensus === "bullish" ? "Long" : memo.consensus === "bearish" ? "Short" : "Neutral",
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

  let plan: z.infer<typeof PlanSchema>;
  try {
    // Step 1 — draft plan
    const draft = await generateText({
      model: provider(MODEL),
      output: Output.object({ schema: PlanSchema }),
      system: "You are the head trader. Produce a concrete plan (entry/stop/tp1/tp2 as raw numbers) grounded in the analyst notes. Use ATR to size the stop (~1-1.5x ATR). TP1 near 1.5R, TP2 near 3R. Keep thesis under 400 chars and invalidation under 200 chars. Confidence is 0-100. If consensus is weak or conflicting, use grade C or NO ENTRY." + memoryLine,
      prompt: ctx,
    });
    plan = draft.output;
  } catch (e) {
    if (!NoObjectGeneratedError.isInstance(e)) throw e;
    plan = fallbackPlan(snap, memo);
  }

  // Step 2 — critic (best-effort)
  try {
    const critique = await generateText({
      model: provider(MODEL),
      output: Output.object({ schema: CritiqueSchema }),
      system: "You are the risk manager. Approve the plan if entry/stop/TP are in sensible relation to price (stop within 3x ATR, TPs on the correct side of entry, R:R >= 1.5). Otherwise say revise. Keep reason under 300 chars.",
      prompt: `${ctx}\n\nProposed plan: ${JSON.stringify(plan)}`,
    });

    // Step 3 — refine once if needed
    if (critique.output.verdict === "revise") {
      try {
        const revised = await generateText({
          model: provider(MODEL),
          output: Output.object({ schema: PlanSchema }),
          system: "You are the head trader. Revise the previous plan per the risk manager's note. Keep bias unless the critique explicitly demands a flip. Keep thesis under 400 chars and invalidation under 200 chars.",
          prompt: `${ctx}\n\nPrevious plan: ${JSON.stringify(plan)}\nRisk manager: ${critique.output.reason}`,
        });
        plan = revised.output;
      } catch (e) {
        if (!NoObjectGeneratedError.isInstance(e)) throw e;
        // keep prior plan
      }
    }
  } catch (e) {
    if (!NoObjectGeneratedError.isInstance(e)) throw e;
    // skip critique step
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
