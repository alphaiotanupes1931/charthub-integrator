// Layer 3 - Planner. Paperclip-style plan → critique → refine loop (max 2 iterations)
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
  if (up.includes("NO ENTRY") || up.includes("WAIT") || up.includes("HOLD")) return "NO ENTRY";
  if (/\bA\+(?=\s|$)|^A\+(?=\s|$)/.test(up)) return "A+";
  if (/\bA[\-]?(?=\s|$)|^A[\-]?(?=\s|$)/.test(up)) return "A";
  if (/\bB[+\-]?(?=\s|$)|^B[+\-]?(?=\s|$)/.test(up)) return "B";
  if (/\bC[+\-]?(?=\s|$)|^C[+\-]?(?=\s|$)/.test(up)) return "C";
  return "NO ENTRY";
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
  try {
    const parsed = JSON.parse(cleaned);
    return PlanSchema.parse(Array.isArray(parsed) ? parsed[0] : parsed);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    try {
      const parsed = JSON.parse(cleaned.slice(start, end + 1));
      return PlanSchema.parse(Array.isArray(parsed) ? parsed[0] : parsed);
    } catch {
      return null;
    }
  }
}

const CritiqueSchema = z.object({
  verdict: z.enum(["approve", "revise"]),
  reason: z.string(),
});

function fallbackPlan(snap: MarketSnapshot, memo: ResearchMemo): z.infer<typeof PlanSchema> {
  return systematicPlan(snap, memo, "Model output was incomplete; using the rule-based scan from current price, ATR, CISD, and consensus.");
}

function systematicPlan(snap: MarketSnapshot, memo: ResearchMemo, thesisPrefix?: string): RawPlan {
  const last = snap.lastPrice || 1;
  const atr = Math.max(snap.stats.atr14 || Math.abs(last) * 0.002, Math.abs(last) * 0.0005);
  const directional = memo.consensus !== "neutral" ? memo.consensus : snap.cisd.state !== "none" ? snap.cisd.state : snap.cisd.htfBias;
  const bias: RawPlan["bias"] = directional === "bullish" ? "Long" : directional === "bearish" ? "Short" : "Neutral";
  const aligned = snap.cisd.state !== "none" && snap.cisd.state === snap.cisd.htfBias;
  const hasTrigger = snap.cisd.state !== "none";
  const confBase = Math.max(memo.consensusConfidence || 0, aligned ? 68 : hasTrigger ? 58 : 42);
  const grade = bias === "Neutral" ? "NO ENTRY" : aligned || (memo.consensus !== "neutral" && hasTrigger) ? "B" : "C";
  const entry = last;
  const stopDist = atr * (grade === "B" ? 1.25 : 1.5);
  const stop = bias === "Short" ? entry + stopDist : entry - stopDist;
  const tp1 = bias === "Short" ? entry - stopDist * 1.5 : entry + stopDist * 1.5;
  const tp2 = bias === "Short" ? entry - stopDist * 3 : entry + stopDist * 3;
  const setup = snap.cisd.state === "none" ? "range structure" : `${snap.cisd.state} CISD`;
  return {
    grade,
    bias,
    confidence: confBase,
    entry,
    stop,
    tp1,
    tp2,
    thesis: `${thesisPrefix ? `${thesisPrefix} ` : ""}${setup} with ${memo.consensus} consensus; ${grade === "NO ENTRY" ? "no directional edge confirmed." : `${bias.toLowerCase()} plan is valid only while price respects ATR-defined risk.`}`,
    invalidation: bias === "Short" ? `Sustained trade above ${fmt(stop, decimalsFor(last))}.` : bias === "Long" ? `Sustained trade below ${fmt(stop, decimalsFor(last))}.` : "Wait for a directional CISD or consensus shift.",
  };
}

function shouldReplaceNoEntry(plan: RawPlan, snap: MarketSnapshot, memo: ResearchMemo): boolean {
  const grade = normalizeGrade(plan.grade);
  if (grade !== "NO ENTRY") return false;
  const hasDirectionalConsensus = memo.consensus !== "neutral" && (memo.consensusConfidence ?? 0) >= 45;
  const hasDirectionalStructure = snap.cisd.state !== "none";
  const modelWantedDirection = normalizeBias(plan.bias) !== "Neutral";
  return hasDirectionalConsensus || (hasDirectionalStructure && modelWantedDirection);
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
    `20-bar range: ${snap.stats.low20} - ${snap.stats.high20}`,
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

  let plan: RawPlan;
  try {
    // Step 1 - draft plan
    const draft = await generateText({
      model: provider(MODEL),
      output: Output.object({ schema: PlanSchema }),
      system: "You are the head trader. Return exactly one flat JSON object, not an array. Produce a concrete plan (entry/stop/tp1/tp2 as raw numbers) grounded in the analyst notes. Grade MUST be one of: A+, A, B, C, NO ENTRY. Bias MUST be Long, Short, or Neutral. Use ATR to size the stop (~1-1.5x ATR). TP1 near 1.5R, TP2 near 3R. Keep thesis under 400 chars and invalidation under 200 chars. Confidence is 0-100. Use grade C for weak but directional setups; use NO ENTRY only when there is no directional trigger, no consensus, and no tradable risk box." + memoryLine,
      prompt: ctx,
    });
    plan = draft.output;
  } catch (e) {
    if (!NoObjectGeneratedError.isInstance(e)) throw e;
    // Salvage: the model likely returned valid JSON that just failed strict
    // schema validation. Try to parse the raw text before giving up.
    const salvaged = salvagePlanFromText(e.text);
    plan = salvaged ?? fallbackPlan(snap, memo);
  }

  // Step 2 - critic (best-effort)
  try {
    const critique = await generateText({
      model: provider(MODEL),
      output: Output.object({ schema: CritiqueSchema }),
      system: "You are the risk manager. Approve the plan if entry/stop/TP are in sensible relation to price (stop within 3x ATR, TPs on the correct side of entry, R:R >= 1.5). Otherwise say revise. Keep reason under 300 chars.",
      prompt: `${ctx}\n\nProposed plan: ${JSON.stringify(plan)}`,
    });

    // Step 3 - refine once if needed
    if (critique.output.verdict === "revise") {
      try {
        const revised = await generateText({
          model: provider(MODEL),
          output: Output.object({ schema: PlanSchema }),
          system: "You are the head trader. Return exactly one flat JSON object, not an array. Revise the previous plan per the risk manager's note. Grade MUST be one of: A+, A, B, C, NO ENTRY. Bias MUST be Long, Short, or Neutral. Keep bias unless the critique explicitly demands a flip. Keep thesis under 400 chars and invalidation under 200 chars.",
          prompt: `${ctx}\n\nPrevious plan: ${JSON.stringify(plan)}\nRisk manager: ${critique.output.reason}`,
        });
        plan = revised.output;
      } catch (e) {
        if (!NoObjectGeneratedError.isInstance(e)) throw e;
        const salvaged = salvagePlanFromText(e.text);
        if (salvaged) plan = salvaged;
        // otherwise keep prior plan
      }
    }
  } catch (e) {
    if (!NoObjectGeneratedError.isInstance(e)) throw e;
    // skip critique step
  }

  let finalPlan = shouldReplaceNoEntry(plan, snap, memo) ? systematicPlan(snap, memo, "AI marked no entry despite directional evidence;") : plan;
  finalPlan = sanitizePlan(finalPlan, snap, memo);
  const grade = normalizeGrade(finalPlan.grade);
  const bias = normalizeBias(finalPlan.bias);
  const dec = decimalsFor(snap.lastPrice || finalPlan.entry || 1);
  const risk = Math.abs(finalPlan.entry - finalPlan.stop) || 1;
  const reward = Math.abs(finalPlan.tp2 - finalPlan.entry);
  const rr = `1 : ${(reward / risk).toFixed(1)}`;
  const isNoEntry = grade === "NO ENTRY";
  const details = `${finalPlan.thesis} Invalidation: ${finalPlan.invalidation}. Manage to break-even at TP1 (${fmt(finalPlan.tp1, dec)}), trail runner to TP2 (${fmt(finalPlan.tp2, dec)}). Risk 0.5-1R of account.`;

  // Backfill confidence: models frequently return 0 or omit the field. Fall
  // back to the analyst-consensus confidence and enforce a per-grade floor
  // so a real setup never displays as 0%.
  const gradeFloor: Record<typeof GRADES[number], number> = {
    "A+": 85, "A": 75, "B": 60, "C": 40, "NO ENTRY": 0,
  };
  const rawModelConf = Number.isFinite(finalPlan.confidence) ? Number(finalPlan.confidence) : 0;
  const modelConf = Math.round(rawModelConf > 0 && rawModelConf <= 1 ? rawModelConf * 100 : rawModelConf);
  const consensusConf = Number.isFinite(memo.consensusConfidence) ? memo.consensusConfidence : 0;
  const confidence = isNoEntry
    ? Math.max(25, Math.min(modelConf || consensusConf || 35, 45))
    : Math.max(modelConf, consensusConf, gradeFloor[grade]);

  return {
    grade,
    bias,
    confidence,
    notes: finalPlan.thesis,
    entry: isNoEntry ? "-" : fmt(finalPlan.entry, dec),
    stop:  isNoEntry ? "-" : fmt(finalPlan.stop,  dec),
    tp1:   isNoEntry ? "-" : fmt(finalPlan.tp1,   dec),
    tp2:   isNoEntry ? "-" : fmt(finalPlan.tp2,   dec),
    rr:    isNoEntry ? "-" : rr,
    details,
    memo,
  };
}
