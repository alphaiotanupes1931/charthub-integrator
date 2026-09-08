// Layer 3 - Planner. Paperclip-style plan → critique → refine loop (max 2 iterations)
// that consumes a ResearchMemo + MarketSnapshot and produces a concrete TradePlan.

import { generateText, Output, NoObjectGeneratedError } from "ai";
import { z } from "zod";
import { createAiGatewayProvider } from "@/lib/ai-gateway.server";
import type { MarketSnapshot, OrderFlow, ResearchMemo, TradePlan } from "./types";
import { formatOrderFlow } from "./order-flow.server";
import { computeOrderBlocks } from "@/lib/orderBlocks";
import { computeBias } from "./bias-adapter.server";
import { tunedConfigFor } from "../instrument-profile.server";

import {
  readSessionVolume,
  sessionStopAtr,
  readMitigatedEntry,
  timingGateFor,
  assetClassFor,

  type SessionVolumeRead,
  type MitigatedBlockRead,
} from "@/lib/sessionVolume";


const MODEL = "google/gemini-3-flash-preview";

/** Best-effort cost accounting for each planner step. Never blocks a scan. */
async function logPlannerCost(kind: string, usage: unknown, providerMetadata: unknown) {
  try {
    const { logAiCost } = await import("@/lib/ai-cost.server");
    await logAiCost({ kind, model: MODEL, usage: usage as never, providerMetadata: providerMetadata as never });
  } catch { /* cost logging is never fatal */ }
}


// Permissive schema: accept strings that look like numbers/enums, then coerce.
// Gemini via the OpenAI-compat gateway does not enforce strict json_schema, so
// slight deviations (extra whitespace, "A+ setup", numbers-as-strings) would
// otherwise trip NoObjectGeneratedError and collapse to the fallback plan.
const PlanSchema = z.object({
  grade: z.string(),
  bias: z.string(),
  confidence: z.coerce.number().optional().default(0),
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

function systematicPlan(
  snap: MarketSnapshot,
  memo: ResearchMemo,
  thesisPrefix?: string,
  forcedBias?: typeof BIASES[number],
): RawPlan {
  const last = snap.lastPrice || 1;
  const atr = Math.max(snap.stats.atr14 || Math.abs(last) * 0.002, Math.abs(last) * 0.0005);
  const mtf = snap.mtf;
  const mtfDir = mtf?.alignment === "aligned-long" ? "bullish"
    : mtf?.alignment === "aligned-short" ? "bearish"
    : mtf?.h4.direction ?? "neutral";
  const directional = mtfDir !== "neutral" ? mtfDir
    : memo.consensus !== "neutral" ? memo.consensus
    : snap.cisd.state !== "none" ? snap.cisd.state
    : snap.cisd.htfBias;
  // The measured direction (resolveDirection) wins when it is supplied: the
  // levels below MUST be built for the same side the card is going to show,
  // otherwise a Short card ships long-shaped entry/stop/targets.
  const bias: typeof BIASES[number] = forcedBias && forcedBias !== "Neutral"
    ? forcedBias
    : directional === "bullish" ? "Long" : directional === "bearish" ? "Short" : "Neutral";
  const aligned = mtf?.alignment === "aligned-long" || mtf?.alignment === "aligned-short";
  const partialAligned = mtf?.alignment === "mixed" && (snap.cisd.state !== "none" || memo.consensus !== "neutral");
  const hasTrigger = snap.cisd.state !== "none";
  const confBase = Math.max(memo.consensusConfidence || 0, aligned ? 80 : partialAligned ? 65 : hasTrigger ? 58 : 42);
  const grade = bias === "Neutral" ? "NO ENTRY"
    : aligned ? "A"
    : partialAligned || (memo.consensus !== "neutral" && hasTrigger) ? "B"
    : "C";
  const entry = last;
  const stopDist = atr * (grade === "A" ? 1.1 : grade === "B" ? 1.25 : 1.5);
  const stop = bias === "Short" ? entry + stopDist : entry - stopDist;
  const tp1 = bias === "Short" ? entry - stopDist * 1.5 : entry + stopDist * 1.5;
  const tp2 = bias === "Short" ? entry - stopDist * 3 : entry + stopDist * 3;
  const setup = mtf ? `MTF ${mtf.alignment} (4H ${mtf.h4.direction}/${mtf.h4.trend}, 1H ${mtf.h1.structureBreak}, 15m ${mtf.m15.confirmation})`
    : snap.cisd.state === "none" ? "range structure" : `${snap.cisd.state} CISD`;
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

// ---------- Evidence-counted conviction ----------
// Every point below comes from a measurable check on the snapshot. Nothing is
// asserted by the model and nothing is floored by grade, so a thin setup reads
// thin instead of "95%".
export function countEvidence(
  snap: MarketSnapshot,
  memo: ResearchMemo,
  grade: typeof GRADES[number],
  bias: typeof BIASES[number],
  rrMultiple: number,
): number {
  if (grade === "NO ENTRY" || bias === "Neutral") return 0;
  const wantBull = bias === "Long";
  let hits = 0;
  let checks = 0;
  const check = (present: boolean, weight = 1) => { checks += weight; if (present) hits += weight; };

  const mtf = snap.mtf;
  // The 4H/1H/15m cascade already determines direction in resolveDirection().
  // Do not count those same votes again as confidence. Conviction must come
  // from confirmation beyond the evidence that selected Long or Short.

  // Higher-timeframe rungs that agree with the trade.
  const ladder = mtf?.ladder ?? [];
  for (const label of ["Monthly", "Weekly", "Daily"]) {
    const rung = ladder.find((r) => r.label === label);
    if (rung) check(rung.bias === (wantBull ? "bullish" : "bearish"));
  }

  // Trigger and analyst consensus.
  check(snap.cisd.state === (wantBull ? "bullish" : "bearish"));
  check(memo.consensus === (wantBull ? "bullish" : "bearish"));

  // Real order flow agreement.
  const of = snap.orderFlow;
  if (of) {
    check(wantBull ? of.cvd > 0 : of.cvd < 0);
    check(wantBull ? of.delta > 0 : of.delta < 0);
    check(wantBull ? of.priceVsPoc !== "below" : of.priceVsPoc !== "above");

  }

  // R:R is constructed by the planner, not observed in the market, so it is a
  // risk-quality gate rather than evidence of directional conviction.
  if (!Number.isFinite(rrMultiple) || rrMultiple < 1.5) return 25;

  if (checks === 0) return 0;
  // Map onto 25-90: no data-driven setup deserves a 100.
  return Math.round(25 + (hits / checks) * 65);
}

// ---------- Deterministic direction ----------
// Same inputs must always give the same read. The model's bias is only a
// tie-breaker; everything else here is measured off the snapshot. This is what
// stops one trader getting "B long" and another "NO ENTRY" on the same chart.
function resolveDirection(
  snap: MarketSnapshot,
  memo: ResearchMemo,
  modelBias: typeof BIASES[number],
): { bias: typeof BIASES[number]; reason: string } {
  const mtf = snap.mtf;
  const votes: { dir: "bullish" | "bearish"; weight: number; label: string }[] = [];
  const vote = (d: string | undefined, weight: number, label: string) => {
    if (d === "bullish") votes.push({ dir: "bullish", weight, label });
    else if (d === "bearish") votes.push({ dir: "bearish", weight, label });
  };

  if (mtf?.alignment === "aligned-long") return { bias: "Long", reason: "MTF aligned long" };
  if (mtf?.alignment === "aligned-short") return { bias: "Short", reason: "MTF aligned short" };

  vote(mtf?.h4.direction, 3, "4H direction");
  vote(mtf?.h1.structureBreak, 2, "1H structure break");
  vote(mtf?.m15.confirmation, 1, "15m confirmation");
  for (const label of ["Monthly", "Weekly", "Daily"]) {
    vote((mtf?.ladder ?? []).find((r) => r.label === label)?.bias, 1, label);
  }
  vote(snap.cisd.state !== "none" ? snap.cisd.state : undefined, 2, "CISD");
  vote(snap.cisd.htfBias, 1, "HTF bias");
  vote(memo.consensus !== "neutral" ? memo.consensus : undefined, 2, "analyst consensus");
  vote(snap.orderFlow?.bias, 1, "order flow");

  const bull = votes.filter((v) => v.dir === "bullish").reduce((s, v) => s + v.weight, 0);
  const bear = votes.filter((v) => v.dir === "bearish").reduce((s, v) => s + v.weight, 0);
  if (bull > bear) return { bias: "Long", reason: `weight of evidence bullish ${bull} to ${bear}` };
  if (bear > bull) return { bias: "Short", reason: `weight of evidence bearish ${bear} to ${bull}` };

  // Nothing structural to lean on: fall back to where price sits in the 20-bar
  // range, then to the model. Only a genuinely flat tape returns Neutral.
  const { high20, low20 } = snap.stats;
  const span = high20 - low20;
  if (span > 0 && Number.isFinite(snap.lastPrice)) {
    const pos = (snap.lastPrice - low20) / span;
    if (pos >= 0.6) return { bias: "Long", reason: "price in the upper third of the 20-bar range" };
    if (pos <= 0.4) return { bias: "Short", reason: "price in the lower third of the 20-bar range" };
  }
  if (modelBias !== "Neutral") return { bias: modelBias, reason: "model read, no measurable structure" };
  return { bias: "Neutral", reason: "no directional evidence" };
}

// ---------- Counter-trend guard ----------
// Shorting into a bullish 4H + Daily (or buying into a bearish one) is a
// counter-trend trade. A 15m flip plus 1H structure is NOT alignment when the
// higher timeframes are still intact, so those setups can never earn a high
// grade unless the higher-timeframe structure itself is already broken with a
// confirmed break in the trade's direction.
export type CounterTrendRead = {
  counterTrend: boolean;
  /** Highest grade the higher-timeframe picture supports. */
  cap: typeof GRADES[number] | null;
  reason: string | null;
};

export function counterTrendRead(
  bias: typeof BIASES[number],
  snap: MarketSnapshot,
): CounterTrendRead {
  const none: CounterTrendRead = { counterTrend: false, cap: null, reason: null };
  if (bias === "Neutral") return none;
  const wanted = bias === "Long" ? "bullish" : "bearish";
  const ladder = snap.mtf?.ladder ?? [];
  const daily = ladder.find((r) => r.label === "Daily");
  const dailyBias = daily?.bias ?? snap.cisd.htfBias;
  const h4Dir = snap.mtf?.h4.direction ?? "neutral";
  const against = (v: string | undefined) => v === (wanted === "bullish" ? "bearish" : "bullish");
  if (!against(dailyBias) || !against(h4Dir)) return none;

  const h4Row = ladder.find((r) => r.label === "4H");
  const htfBroken = h4Row?.structure === wanted || daily?.structure === wanted;
  if (htfBroken) {
    return {
      counterTrend: true,
      cap: "A",
      reason: `Counter-trend ${bias.toLowerCase()} against a ${dailyBias} Daily and ${h4Dir} 4H, but higher-timeframe structure has already broken ${wanted}, so the grade is capped at A.`,
    };
  }
  return {
    counterTrend: true,
    cap: "C",
    reason: `Counter-trend ${bias.toLowerCase()}: the Daily is ${dailyBias} and the 4H is ${h4Dir} with no confirmed higher-timeframe break, so the grade is capped at C no matter how clean the 1H/15m looks. Skip it or cut risk to 0.5R.`,
  };
}

// ---------- Hard-coded Time Frame Combo ----------
// 4H = DIRECTION, 1H = LIQUIDITY, 15m = BOS/ChoCH, 5m = execution.
// This is a gate, not a hint: a setup that fights the 4H direction is NO ENTRY,
// and a setup without 1H liquidity plus a 15m break cannot reach a high grade.
export type ComboGate = {
  /** "NO ENTRY" kills the trade outright; otherwise the highest grade allowed. */
  cap: typeof GRADES[number] | null;
  reason: string | null;
  checks: { h4: boolean; h1: boolean; m15: boolean };
};

export function timeFrameComboGate(
  bias: typeof BIASES[number],
  snap: MarketSnapshot,
): ComboGate {
  if (bias === "Neutral") {
    return { cap: "NO ENTRY", reason: "No 4H direction to trade with.", checks: { h4: false, h1: false, m15: false } };
  }
  const wanted = bias === "Long" ? "bullish" : "bearish";
  const opposite = wanted === "bullish" ? "bearish" : "bullish";
  const m = snap.mtf;
  const ladder = m?.ladder ?? [];
  const h4Row = ladder.find((r) => r.label === "4H");
  const h4Dir = m?.h4.direction ?? h4Row?.bias ?? "neutral";
  const h4Trend = m?.h4.trend ?? h4Row?.trend ?? "range";

  // Step 1 - 4H direction. Trading against it is not a lower grade, it is no trade.
  if (h4Dir === opposite || h4Trend === (wanted === "bullish" ? "down" : "up")) {
    const broken = h4Row?.structure === wanted;
    if (!broken) {
      return {
        cap: "NO ENTRY",
        reason: `Time Frame Combo step 1 failed: the 4H direction is ${h4Dir}/${h4Trend}, so a ${bias.toLowerCase()} here is counter-trend. No entry until the 4H breaks structure ${wanted}.`,
        checks: { h4: false, h1: false, m15: false },
      };
    }
  }
  const h4Ok = h4Dir === wanted;

  // Step 2 - 1H liquidity: a pool to run into or a 1H break/reversal in our direction.
  const liq = m?.h1.liquidity;
  const pools = (bias === "Long" ? liq?.sellside : liq?.buyside) ?? [];
  const h1Ok =
    pools.length > 0 || m?.h1.structureBreak === wanted || m?.h1.reversal === wanted;

  // Step 3 - 15m BOS / ChoCH confirmation.
  const m15 = m?.m15.confirmation ?? "none";
  const m15Ok = m15 === wanted;

  if (m15 === opposite) {
    return {
      cap: "C",
      reason: `Time Frame Combo step 3 failed: the 15m break is ${m15}, against this ${bias.toLowerCase()}. Wait for a 15m BOS/ChoCH in your direction before executing on the 5m.`,
      checks: { h4: h4Ok, h1: h1Ok, m15: false },
    };
  }
  if (!h4Ok || !h1Ok) {
    return {
      cap: "B",
      reason: !h4Ok
        ? `Time Frame Combo: the 4H direction is ${h4Dir} (not clearly ${wanted}), so this caps at B.`
        : `Time Frame Combo step 2 weak: no 1H liquidity pool or 1H break in the ${bias.toLowerCase()} direction yet, so this caps at B.`,
      checks: { h4: h4Ok, h1: h1Ok, m15: m15Ok },
    };
  }
  if (!m15Ok) {
    return {
      cap: "B",
      reason: "Time Frame Combo step 3 pending: no 15m BOS/ChoCH yet, so this caps at B until the 15m confirms.",
      checks: { h4: true, h1: true, m15: false },
    };
  }
  return { cap: null, reason: null, checks: { h4: true, h1: true, m15: true } };
}

// ---------- 1H opposition (mixed alignment) ----------
// A short taken while the 1H is bullish is a mixed-alignment setup, not an
// aligned one. The old grade path only read h1.structureBreak, so a bullish 1H
// trend with a stale bearish break still passed the A test. Mixed alignment
// caps at B; if the 1H has actually broken against us it caps at C.
export function lowerTimeframeOppositionRead(
  bias: typeof BIASES[number],
  snap: MarketSnapshot,
): { cap: typeof GRADES[number] | null; reason: string | null } {
  if (bias === "Neutral") return { cap: null, reason: null };
  const wanted = bias === "Long" ? "bullish" : "bearish";
  const opposite = wanted === "bullish" ? "bearish" : "bullish";
  const row = (snap.mtf?.ladder ?? []).find((r) => r.label === "1H");
  const h1Break = snap.mtf?.h1.structureBreak;
  const trendAgainst = row?.trend === (wanted === "bullish" ? "down" : "up");
  const biasAgainst = row?.bias === opposite;
  const breakAgainst = h1Break === opposite;
  if (!trendAgainst && !biasAgainst && !breakAgainst) return { cap: null, reason: null };
  if (breakAgainst) {
    return {
      cap: "C",
      reason: `The 1H has broken structure ${opposite}, against this ${bias.toLowerCase()}, so the grade is capped at C until the 1H breaks back ${wanted}.`,
    };
  }
  return {
    cap: "B",
    reason: `Mixed alignment: the 1H reads ${row?.bias ?? opposite}/${row?.trend ?? "-"} against this ${bias.toLowerCase()}, so this is a B at best - you would be trading into a 1H bounce. Half size or wait for the 1H to turn.`,
  };
}

// ---------- Order flow opposition ----------
// Structure sets direction over days; flow decides the next few hours. Deeply
// positive delta with a rising CVD on a short is buyers defending the entry, so
// it can no longer sit behind an A grade.
export function orderFlowOppositionRead(
  bias: typeof BIASES[number],
  snap: MarketSnapshot,
): { cap: typeof GRADES[number] | null; reason: string | null } {
  const of = snap.orderFlow;
  if (!of || bias === "Neutral") return { cap: null, reason: null };
  const wanted = bias === "Long" ? "bullish" : "bearish";
  if (of.bias === "neutral" || of.bias === wanted) return { cap: null, reason: null };
  const deltaAgainst = bias === "Long" ? of.delta < 0 : of.delta > 0;
  const cvdAgainst = bias === "Long" ? of.cvdSlope < 0 : of.cvdSlope > 0;
  const outsized = Math.abs(of.delta) > Math.max(1, Math.abs(of.deltaAvg) * 2);
  const strong = !of.estimated && deltaAgainst && cvdAgainst && outsized;
  const side = bias === "Long" ? "sellers" : "buyers";
  if (strong) {
    return {
      cap: "C",
      reason: `Order flow opposes the setup: delta ${of.delta.toFixed(0)} against a ${of.deltaAvg.toFixed(0)} average with CVD ${cvdAgainst ? "moving against you" : "flat"} - ${side} are in control of the entry zone, so the grade is capped at C. Wait for flow to flip ${wanted}.`,
    };
  }
  return {
    cap: "B",
    reason: `Order flow leans ${of.bias} against this ${bias.toLowerCase()} (${side} paying up near the entry), so this caps at B.`,
  };
}


// ---------- Deterministic grade ----------
// Grade is a function of counted evidence, not model sampling. Objective risk
// controls can cap it later, but the model's habitual grade must not flatten
// different instruments into the same result.
export function gradeFromEvidence(
  bias: typeof BIASES[number],
  confidence: number,
  snap: MarketSnapshot,
): typeof GRADES[number] {
  if (bias === "Neutral") return "NO ENTRY";
  const mtf = snap.mtf;
  const m15 = mtf?.m15.confirmation;
  const wantBull = bias === "Long";
  const wanted = wantBull ? "bullish" : "bearish";
  const m15Agrees = m15 === wanted;
  const h4Agrees = mtf?.h4.direction === wanted;
  const h1Agrees = mtf?.h1.structureBreak === wanted;
  const fullyAligned = mtf?.alignment === (wantBull ? "aligned-long" : "aligned-short");

  let grade: typeof GRADES[number];
  // High grades require both a high evidence ratio and named structural
  // agreement. A majority-selected direction by itself cannot earn an A.
  if (confidence >= 84 && fullyAligned && m15Agrees) grade = "A+";
  else if (confidence >= 74 && h4Agrees && h1Agrees) grade = "A";
  else if (confidence >= 58) grade = "B";
  else grade = "C";

  // Missing higher-timeframe data means the counters had little to work with.
  if (!snap.mtf && grade !== "C") grade = "C";

  // Counter-trend setups and the Time Frame Combo are capped last so nothing can
  // lift them back up.
  const order: string[] = ["NO ENTRY", "C", "B", "A", "A+"];
  const ct = counterTrendRead(bias, snap);
  if (ct.cap && order.indexOf(grade) > order.indexOf(ct.cap)) grade = ct.cap;
  const combo = timeFrameComboGate(bias, snap);
  if (combo.cap && order.indexOf(grade) > order.indexOf(combo.cap)) grade = combo.cap;
  return grade;
}



// ---------- Structure-anchored entry refinement ----------
// Instead of parking the entry a flat fraction of ATR under/over price, snap it
// to the nearest real level price is likely to trade back into: 1H order block,
// 1H FVG, 4H demand/supply zone, 4H key level, or resting liquidity. This is
// what makes the fill precise rather than "roughly near price".
type EntryAnchor = { entry: number; zoneFar: number; label: string };

function findEntryAnchor(
  bias: "Long" | "Short",
  last: number,
  atr: number,
  snap: MarketSnapshot,
): EntryAnchor | null {
  const m = snap.mtf;
  const minGap = Math.max(atr * 0.1, last * 0.0003); // must be a real pullback
  const maxGap = atr * 2;
  const cands: EntryAnchor[] = [];

  const pushZone = (z: [number, number], label: string) => {
    const top = Math.max(z[0], z[1]);
    const bottom = Math.min(z[0], z[1]);
    if (!Number.isFinite(top) || !Number.isFinite(bottom) || bottom <= 0) return;
    // Enter at the near edge of the zone, keep the far edge for stop placement.
    if (bias === "Long") cands.push({ entry: top, zoneFar: bottom, label });
    else cands.push({ entry: bottom, zoneFar: top, label });
  };
  const pushLevel = (p: number, label: string) => {
    if (!Number.isFinite(p) || p <= 0) return;
    const pad = atr * 0.25;
    if (bias === "Long") cands.push({ entry: p, zoneFar: p - pad, label });
    else cands.push({ entry: p, zoneFar: p + pad, label });
  };

  if (m) {
    if (bias === "Long") {
      m.h1.orderBlocks.bull.forEach((z) => pushZone(z, "1H bullish order block"));
      m.h1.fvg.bull.forEach((z) => pushZone(z, "1H bullish FVG"));
      m.h4.supplyDemand.demand.forEach((z) => pushZone(z, "4H demand zone"));
      m.h4.keyLevels.support.forEach((p) => pushLevel(p, "4H support"));
      m.h1.liquidity.sellside.forEach((p) => pushLevel(p, "sellside liquidity"));
    } else {
      m.h1.orderBlocks.bear.forEach((z) => pushZone(z, "1H bearish order block"));
      m.h1.fvg.bear.forEach((z) => pushZone(z, "1H bearish FVG"));
      m.h4.supplyDemand.supply.forEach((z) => pushZone(z, "4H supply zone"));
      m.h4.keyLevels.resistance.forEach((p) => pushLevel(p, "4H resistance"));
      m.h1.liquidity.buyside.forEach((p) => pushLevel(p, "buyside liquidity"));
    }
  }
  if (snap.cisd.state !== "none" && snap.cisd.level > 0) {
    pushLevel(snap.cisd.level, "CISD level");
  }

  const valid = cands.filter((c) => {
    const gap = bias === "Long" ? last - c.entry : c.entry - last;
    return gap >= minGap && gap <= maxGap;
  });
  if (!valid.length) return null;
  // Closest to price = highest fill probability while still a real pullback.
  valid.sort((a, b) => Math.abs(last - a.entry) - Math.abs(last - b.entry));
  return valid[0];
}

/**
 * Swing highs/lows on the scan timeframe: 2-bar fractal pivots. These are the
 * levels price has to fight through next, and without them the only structure
 * the planner can see is 4H shelves, which are always far away.
 */
export function swingLevels(snap: MarketSnapshot, want: "high" | "low"): number[] {
  const c = snap.candles;
  if (c.length < 10) return [];
  const out: number[] = [];
  const from = Math.max(2, c.length - 120);
  for (let i = from; i < c.length - 2; i++) {
    const bar = c[i]!;
    if (want === "high") {
      const hi = bar.high;
      if (hi > c[i - 1]!.high && hi > c[i - 2]!.high && hi > c[i + 1]!.high && hi > c[i + 2]!.high) out.push(hi);
    } else {
      const lo = bar.low;
      if (lo < c[i - 1]!.low && lo < c[i - 2]!.low && lo < c[i + 1]!.low && lo < c[i + 2]!.low) out.push(lo);
    }
  }
  return out;
}

/**
 * Every level price must trade through beyond entry, nearest first. Targets are
 * decided by market structure; R multiples only describe the result and are a
 * last resort when an instrument has no mapped structure at all.
 */
export function findTargetLevels(bias: "Long" | "Short", entry: number, snap: MarketSnapshot): number[] {
  const m = snap.mtf;
  const s = snap.stats;
  const pool: number[] = bias === "Long"
    ? [
        // Near-term structure on the timeframe being scanned.
        ...swingLevels(snap, "high"),
        s.high20, s.high50,
        // Higher-timeframe shelves, liquidity and the near edge of supply.
        ...(m ? m.h4.keyLevels.resistance : []),
        ...(m ? m.h1.liquidity.buyside : []),
        ...(m ? m.h4.supplyDemand.supply.map((z) => Math.min(z[0], z[1])) : []),
        ...(m ? m.h1.orderBlocks.bear.map((z) => Math.min(z[0], z[1])) : []),
        ...(m ? m.h1.fvg.bear.map((z) => Math.min(z[0], z[1])) : []),
      ]
    : [
        ...swingLevels(snap, "low"),
        s.low20, s.low50,
        ...(m ? m.h4.keyLevels.support : []),
        ...(m ? m.h1.liquidity.sellside : []),
        ...(m ? m.h4.supplyDemand.demand.map((z) => Math.max(z[0], z[1])) : []),
        ...(m ? m.h1.orderBlocks.bull.map((z) => Math.max(z[0], z[1])) : []),
        ...(m ? m.h1.fvg.bull.map((z) => Math.max(z[0], z[1])) : []),
      ];
  const beyond = pool.filter((p) => Number.isFinite(p) && p > 0 && (bias === "Long" ? p > entry : p < entry));
  const sorted = [...new Set(beyond)].sort((a, b) => Math.abs(a - entry) - Math.abs(b - entry));
  // Collapse clusters: levels within 15% of the nearest one's distance are the
  // same shelf, so they should not both become targets.
  const kept: number[] = [];
  for (const lvl of sorted) {
    const d = Math.abs(lvl - entry);
    if (kept.every((k) => Math.abs(Math.abs(k - entry) - d) > d * 0.15)) kept.push(lvl);
  }
  return kept;
}


/**
 * How far price realistically travels before the setup is stale, in ATR of the
 * scan timeframe. TP1 beyond this is why targets "never get hit": a 4H
 * resistance shelf can sit 4x ATR away and never print inside the hold window.
 */
export function reachAtr(interval: string): number {
  switch (interval) {
    case "1":
    case "5":
    case "15": return 1.3;
    case "30":
    case "60": return 1.5;
    case "240": return 1.8;
    default: return 2.2; // D / W
  }
}


// Sanity-check the model's plan against price/ATR so we don't ship bad pending
// orders. The default scan experience should not hand older traders a breakout
// stop order when price has not actually reached the setup yet.
function sanitizePlan(
  plan: RawPlan,
  snap: MarketSnapshot,
  memo: ResearchMemo,
  forcedBias?: typeof BIASES[number],
  /** Minimum stop distance in ATR multiples. Widened in thin sessions. */
  stopFloorAtr = 0.6,
): RawPlan {

  const last = snap.lastPrice;
  const atr = Math.max(snap.stats.atr14 || Math.abs(last) * 0.002, Math.abs(last) * 0.0005);
  // Same rule as systematicPlan: clamp against the side that will be displayed.
  const bias: typeof BIASES[number] =
    forcedBias && forcedBias !== "Neutral" ? forcedBias : normalizeBias(plan.bias);
  if (bias === "Neutral" || !isFinite(last) || last <= 0) return plan;


  let { entry, stop, tp1, tp2 } = plan;
  if (![entry, stop, tp1, tp2].every((n) => Number.isFinite(n) && n > 0)) {
    // Run the rule-based plan back through this same validator so its flat R
    // multiples still get replaced by real structure.
    return sanitizePlan(
      systematicPlan(snap, memo, "Model returned invalid numbers; using systematic plan.", forcedBias),
      snap, memo, forcedBias, stopFloorAtr,
    );

  }

  const buffer = Math.max(atr * 0.15, last * 0.0005);
  const anchor = findEntryAnchor(bias, last, atr, snap);
  let anchorLabel: string | null = null;
  let structuralStop: number | null = null;

  if (anchor) {
    // 1a. Structure-anchored entry. If the model already picked something within
    // a third of an ATR of the same level, keep the model's price (it may be
    // more precise); otherwise snap to the level.
    const modelIsNear = Math.abs(entry - anchor.entry) <= atr * 0.33
      && (bias === "Long" ? entry <= last - buffer * 0.5 : entry >= last + buffer * 0.5);
    entry = modelIsNear ? entry : anchor.entry;
    anchorLabel = anchor.label;
    // Stop goes just past the far edge of the zone that gave us the entry.
    const pad = Math.max(atr * 0.3, last * 0.0004);
    structuralStop = bias === "Long" ? anchor.zoneFar - pad : anchor.zoneFar + pad;
  } else {
    // 1b. No usable structure: clamp runaway entries and fall back to a
    // pullback offset from price.
    if (Math.abs(entry - last) > atr * 2) {
      entry = bias === "Long" ? last - atr * 0.5 : last + atr * 0.5;
      structuralStop = null;
    }
    if (bias === "Long" && entry > last - buffer) entry = last - buffer;
    else if (bias === "Short" && entry < last + buffer) entry = last + buffer;
  }

  // 2. Longs must still sit below price, shorts above (limit orders only).
  if (bias === "Long" && entry > last - buffer) entry = last - buffer;
  if (bias === "Short" && entry < last + buffer) entry = last + buffer;

  // 3. Stop: prefer the structural stop, else the model's distance, clamped to
  // a sane ATR band so risk is always measurable. The floor is session-aware:
  // thin overnight tape needs 1.2-1.5x ATR, not the 0.6x default.
  const modelStopDist = Math.abs(entry - stop);
  const rawStopDist = structuralStop !== null ? Math.abs(entry - structuralStop) : modelStopDist;
  const floor = Math.max(0.3, stopFloorAtr);
  const stopDist = Math.min(Math.max(rawStopDist, atr * floor), atr * Math.max(2.5, floor + 1));

  stop = bias === "Long" ? entry - stopDist : entry + stopDist;

  // 4. Targets are market structure, not an R multiple. TP1 is the first level
  // price has to fight through that still pays for the risk; TP2 is the next one
  // beyond it. R:R is only reported, never used to place the target. A flat R
  // multiple is the last resort for instruments with no mapped structure.
  const dir = bias === "Long" ? 1 : -1;
  const levels = findTargetLevels(bias, entry, snap);
  const reach = atr * reachAtr(snap.interval);
  // Book just in front of the level, not at it, so the reaction does not eat the fill.
  const skim = Math.max(atr * 0.08, last * 0.0002);
  const minDist = stopDist * 1.0;

  const tp1Level = levels.find((l) => Math.abs(l - entry) - skim >= minDist);
  let targetNote: string;
  let tp1Dist: number;
  if (tp1Level !== undefined) {
    tp1Dist = Math.abs(tp1Level - entry) - skim;
    targetNote = tp1Dist > reach
      ? `TP1 is the next structural level at ${fmt(entry + dir * tp1Dist, decimalsFor(last))}. It sits ${(tp1Dist / atr).toFixed(1)}x ATR away, so this is a swing target: scale out and manage rather than expecting it in one session.`
      : `TP1 is the next structural level at ${fmt(entry + dir * tp1Dist, decimalsFor(last))}, ${(tp1Dist / atr).toFixed(1)}x ATR from entry.`;
  } else {
    // No structure beyond entry pays for the risk: fall back to a reachable
    // measured move and say so plainly.
    tp1Dist = Math.max(minDist, Math.min(stopDist * 1.5, reach));
    targetNote = "No opposing structure sits far enough beyond entry to pay for the risk, so TP1 is a measured move off the stop distance.";
  }
  tp1 = entry + dir * tp1Dist;

  // TP2: the next distinct level beyond TP1. Structure decides the distance, so
  // there is no R cap here; when nothing is mapped it extends by one more leg.
  const tp2Level = levels.find((l) => Math.abs(l - entry) - skim > tp1Dist * 1.2);
  const tp2Dist = tp2Level !== undefined
    ? Math.abs(tp2Level - entry) - skim
    : tp1Dist + Math.max(stopDist, tp1Dist * 0.6);
  tp2 = entry + dir * Math.max(tp2Dist, tp1Dist * 1.15);



  const dec = decimalsFor(last);
  // Once deterministic validation changes an AI-proposed level, the old thesis
  // can no longer be trusted to name the entry anchor. Replace it rather than
  // appending to it, otherwise the same explanation can claim two entries.
  const thesis = anchorLabel
    ? `The planned entry is ${fmt(entry, dec)}, anchored to the ${anchorLabel}. The stop is ${fmt(stop, dec)}, giving ${fmt(stopDist, dec)} of risk (${(stopDist / atr).toFixed(2)}x ATR). ${targetNote} Other mapped zones are supporting structure or invalidation unless they contain ${fmt(entry, dec)}.`
    : `${plan.thesis} ${targetNote}`;


  return { ...plan, entry, stop, tp1, tp2, thesis };
}




function decimalsFor(px: number): number {
  if (px >= 1000) return 2;
  if (px >= 10) return 3;
  if (px >= 1) return 4;
  return 5;
}
const fmt = (n: number, d: number) => n.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });

function fmtRange(r: [number, number]): string { return `[${r[0].toFixed(4)}-${r[1].toFixed(4)}]`; }

function mtfBlock(snap: MarketSnapshot): string {
  const m = snap.mtf;
  if (!m) return "MTF: unavailable";
  const kl = m.h4.keyLevels;
  const sd = m.h4.supplyDemand;
  const ob = m.h1.orderBlocks;
  const fvg = m.h1.fvg;
  const liq = m.h1.liquidity;
  return [
    `MTF cascade (4H → 1H → 15m):`,
    `  4H direction=${m.h4.direction} trend=${m.h4.trend}`,
    `  4H key levels: support=[${kl.support.map((n) => n.toFixed(4)).join(", ")}] resistance=[${kl.resistance.map((n) => n.toFixed(4)).join(", ")}]`,
    `  4H S/D: supply=${sd.supply.map(fmtRange).join(", ") || "none"} demand=${sd.demand.map(fmtRange).join(", ") || "none"}`,
    `  1H structureBreak=${m.h1.structureBreak} reversal=${m.h1.reversal}`,
    `  1H OB: bull=${ob.bull.map(fmtRange).join(", ") || "none"} bear=${ob.bear.map(fmtRange).join(", ") || "none"}`,
    `  1H FVG: bull=${fvg.bull.map(fmtRange).join(", ") || "none"} bear=${fvg.bear.map(fmtRange).join(", ") || "none"}`,
    `  1H liquidity: buyside=[${liq.buyside.map((n) => n.toFixed(4)).join(", ")}] sellside=[${liq.sellside.map((n) => n.toFixed(4)).join(", ")}]`,
    `  15m confirmation=${m.m15.confirmation} (${m.m15.reason})`,
    `  Alignment: ${m.alignment}`,
    m.ladder?.length
      ? [
          "  Full ladder (Monthly → 1m):",
          ...m.ladder.map(
            (r) => `    ${r.label}: bias=${r.bias} trend=${r.trend} structure=${r.structure} range=${r.low.toFixed(4)}-${r.high.toFixed(4)}`,
          ),
        ].join("\n")
      : "",
  ].filter(Boolean).join("\n");
}

const COACH_TONE: Record<string, string> = {
  "The Analyst": "Write the thesis like an institutional desk note: measured, data-led, no hype.",
  "The Disciplinarian": "Write the thesis as rules enforcement: if a rule is unmet, say it plainly and refuse the trade.",
  "The Mentor": "Write the thesis so it teaches the why behind the level, in plain language.",
  "The Minimalist": "Write the thesis in as few words as possible. Only take obvious setups; downgrade anything marginal.",
  "The Psychologist": "Write the thesis with a note on the emotional trap this setup invites (chasing, revenge, fear of missing).",
};

function memoBlock(
  memo: ResearchMemo,
  snap: MarketSnapshot,
  lensDesc?: string,
  strategyDesc?: string,
  perfDesc?: string,
  scoreDesc?: string,
): string {
  const notes = memo.notes.map(n => `- ${n.role.toUpperCase()} (${n.bias}, ${n.confidence}%): ${n.summary}`).join("\n");
  return [
    `Ticker: ${snap.ticker} | Interval: ${snap.interval} | Last: ${snap.lastPrice} | ATR14: ${snap.stats.atr14.toFixed(4)}`,
    `20-bar range: ${snap.stats.low20} - ${snap.stats.high20}`,
    `Consensus: ${memo.consensus} @ ${memo.consensusConfidence}%`,
    mtfBlock(snap),
    formatOrderFlow(snap.orderFlow),
    lensDesc ? `Scan lens focus: ${lensDesc}` : "",
    strategyDesc ? `Active strategy playbook (grade the setup against these rules): ${strategyDesc}` : "The trader has no active strategy selected; grade on structure alone.",
    perfDesc ? `Measured edge of this playbook (from historical backtests on this trader's own settings): ${perfDesc}` : "",
    scoreDesc || "",
    "Analyst notes:",
    notes,
  ].filter(Boolean).join("\n");
}

/** Fire-and-forget metric row. Never blocks or fails a scan. */
async function logBiasMetric(props: Record<string, unknown>) {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("product_events").insert({ event: "scan_bias", props: props as never });
  } catch { /* metrics are best-effort */ }
}

/**
 * Engine grade is a CAP, not the final grade. Our pipeline anchors entries with
 * sanitizePlan()/systematicPlan(), which finds levels the engine's own zone list
 * may not carry, so an engine 'F' from a missing zone must not force NO ENTRY.
 * A neutral engine bias, by contrast, is absolute: that is rule 6.
 */
function capToEngine(
  grade: typeof GRADES[number],
  cap: import("./biasEngine").Grade,
): typeof GRADES[number] {
  const order = ["NO ENTRY", "C", "B", "A", "A+"];
  const capLetter = cap === "F" || cap === "D" ? "C" : cap;
  return order.indexOf(grade) > order.indexOf(capLetter)
    ? (capLetter as typeof GRADES[number])
    : grade;
}

export async function runPlanner(
  apiKey: string,
  snap: MarketSnapshot,
  memo: ResearchMemo,
  lensDesc?: string,
  hermesMemory?: string,
  strategyDesc?: string,
  coach?: string,
  perfDesc?: string,
  scoreDesc?: string,
): Promise<TradePlan> {

  const provider = createAiGatewayProvider(apiKey);

  // Forex Factory calendar feeds the scan decision, not just the chat and the
  // briefings: timing risk is part of whether a setup is worth taking.
  let newsBlock: string | undefined;
  let newsWarning = "";
  try {
    const { calendarContextBlock, fetchCalendar, highImpactAhead, currenciesFor } = await import("@/lib/news.server");
    newsBlock = await calendarContextBlock(snap.ticker);
    const wanted = currenciesFor(snap.ticker);
    // The shared calendar helper includes medium-impact events for display.
    // Only genuinely high-impact releases should reduce a setup's grade.
    const soon = highImpactAhead(await fetchCalendar(), 4).filter(
      (e) => wanted.includes(e.country.toUpperCase()) && /^high$/i.test(e.impact.trim()),
    );
    if (soon.length) {
      const first = soon[0]!;
      const mins = Math.max(0, Math.round((new Date(first.date).getTime() - Date.now()) / 60000));
      newsWarning = ` Timing risk: ${first.country} ${first.impact.toUpperCase()} ${first.title} lands in about ${mins} minutes, so size down or wait for the release to clear.`;
    }
  } catch {
    // calendar unavailable; plan on price structure alone
  }

  // RULE 6: direction is computed here, from the closed candles of this scan,
  // and handed to the model as a block it is not allowed to contradict. Nothing
  // is cached, so a fresh bullish 4H close can never lose to a stale label.
  // Phase 4: the same rules run with this instrument's measured constants when a
  // profile has been measured; unknown or thin-sample symbols keep the
  // conservative shipped defaults.
  let tunedCfg: Awaited<ReturnType<typeof tunedConfigFor>> = null;
  try {
    tunedCfg = await tunedConfigFor(snap.ticker);
  } catch {
    tunedCfg = null;
  }
  const biasRead = computeBias(snap, "A", tunedCfg ?? undefined);
  const ctx = biasRead.contextBlock
    + "\n\n"
    + memoBlock(memo, snap, lensDesc, strategyDesc, perfDesc, scoreDesc)
    + (newsBlock ? `\n\n${newsBlock}` : "");
  const memoryLine = (hermesMemory ? `\n\n${hermesMemory}` : "")
    + (perfDesc ? `\n\nWeight the measured edge: if this playbook has a negative expectancy on this instrument, cap the grade at C and say why. If it has a positive expectancy over 20+ trades, you may keep a high grade when structure agrees.` : "")
    + (coach && COACH_TONE[coach] ? `\n\nCoach voice: you are ${coach}. ${COACH_TONE[coach]}` : "");


  let plan: RawPlan;
  try {
    // Step 1 - draft plan
    const draft = await generateText({
      model: provider(MODEL),
      output: Output.object({ schema: PlanSchema }),
      system: "You are the head trader. Follow the 'How to Analysis' cascade in the memo: 4H sets DIRECTION + TREND + key levels + supply/demand; 1H reads STRUCTURE (breaks, reversal, OB, FVG, liquidity); 15m gives CONFIRMATION. Grade A+ only when MTF alignment is aligned-long/aligned-short AND 15m confirmation matches. Grade A when alignment is aligned-* with weaker 15m. Grade B when 1H structure and 4H direction agree but 15m is neutral. Grade C when there is a 1H trigger but 4H is against or neutral. NO ENTRY when direction, structure, and confirmation all conflict. Return exactly one flat JSON object, not an array. Grade MUST be one of: A+, A, B, C, NO ENTRY. Bias MUST be Long, Short, or Neutral. ENTRY PRECISION IS THE PRIORITY: the entry must be a specific level, not a round guess near price. Anchor it to an actual level in the memo - a 1H bullish/bearish order block edge, a 1H FVG edge, a 4H demand/supply boundary, a 4H key level, or a resting liquidity pool - on the pullback side of Last and within 2x ATR. Place the stop just beyond the FAR edge of that same zone (0.6-2.5x ATR of risk), never a round ATR multiple pulled out of the air. TP1 should be the first opposing level or liquidity pool that pays at least 1.5R; TP2 the next one or 3R. In the thesis, state the exact level name and price you anchored the entry to. No generic wording. If an ECONOMIC CALENDAR block is present, treat a high-impact release inside the next few hours as timing risk: cap the grade at B and say so in the invalidation. ENTRY RULES: default to entering on the pullback side of price. For a Long setup, entry must be at or below Last unless the prompt explicitly asks for a breakout stop order. For a Short setup, entry must be at or above Last. Prefer entries at 1H order blocks, FVGs, or 4H demand/supply that align with bias. Do not default to BUY STOP or SELL STOP. Never place entry more than 2x ATR from current price. Keep thesis under 400 chars and invalidation under 200 chars. Do NOT state a confidence percentage; conviction is counted from the data by the platform, not asserted by you." + memoryLine,
      prompt: ctx,
    });
    plan = draft.output;
    await logPlannerCost("plan-draft", draft.usage, draft.providerMetadata);

  } catch (e) {
    // The model writes the explanation, but it must never be a hard dependency
    // for a market scan. On malformed output, quota, or gateway failure, keep
    // scanning with the deterministic plan built from the real snapshot.
    const salvaged = NoObjectGeneratedError.isInstance(e) ? salvagePlanFromText(e.text) : null;
    plan = salvaged ?? fallbackPlan(snap, memo);
  }

  // Step 2 - critic (best-effort). A draft the model already graded C or
  // NO ENTRY will not become tradable after a risk review, so we skip the
  // critique/revise calls entirely for those and save two model calls per scan.
  const draftGrade = String(plan.grade ?? "").toUpperCase();
  const worthCritiquing = draftGrade === "A+" || draftGrade === "A" || draftGrade === "B";
  if (worthCritiquing) try {
    const critique = await generateText({
      model: provider(MODEL),
      output: Output.object({ schema: CritiqueSchema }),
      system: "You are the risk manager. Approve the plan if entry/stop/TP are in sensible relation to price (stop within 3x ATR, TPs on the correct side of entry, R:R >= 1.5). Otherwise say revise. Keep reason under 300 chars.",
      prompt: `${ctx}\n\nProposed plan: ${JSON.stringify(plan)}`,
    });
    await logPlannerCost("plan-critique", critique.usage, critique.providerMetadata);

    // Step 3 - refine once if needed
    if (critique.output.verdict === "revise") {
      try {
        const revised = await generateText({
          model: provider(MODEL),
          output: Output.object({ schema: PlanSchema }),
          system: "You are the head trader. Return exactly one flat JSON object, not an array. Revise the previous plan per the risk manager's note. Grade MUST be one of: A+, A, B, C, NO ENTRY. Bias MUST be Long, Short, or Neutral. Keep bias unless the critique explicitly demands a flip. Keep thesis under 400 chars and invalidation under 200 chars. For Long, entry must be at or below current price by default. For Short, entry must be at or above current price by default. Do not revise into a stop-entry unless the prompt explicitly asks for a breakout order.",
          prompt: `${ctx}\n\nPrevious plan: ${JSON.stringify(plan)}\nRisk manager: ${critique.output.reason}`,
        });
        plan = revised.output;
        await logPlannerCost("plan-revise", revised.usage, revised.providerMetadata);
      } catch (e) {
        const salvaged = NoObjectGeneratedError.isInstance(e) ? salvagePlanFromText(e.text) : null;
        if (salvaged) plan = salvaged;
        // otherwise keep prior plan
      }
    }
  } catch {
    // Risk-manager wording is best-effort. Deterministic sanitization below
    // still validates entry, stop, targets, direction, grade, and confidence.
  }


  // ---- Deterministic direction + grade ----------------------------------
  // The model used to own both, so two identical scans could come back "B" for
  // one trader and "NO ENTRY" for another purely on sampling luck. Direction and
  // grade are now measured from the snapshot; the model only writes the words.
  // The model no longer gets a vote on direction, not even as a tie-breaker.
  // resolveDirection() stays as the descriptive fallback for the rare scan with
  // no 4H series at all (feed outage), where the engine has nothing to read.
  const engineBias = biasRead.platformBias;
  const resolved = (snap.candles4h?.length ?? 0) >= 20
    ? { bias: engineBias, reason: `bias engine: ${biasRead.result.mtf.reason}` }
    : resolveDirection(snap, memo, "Neutral");

  // ---- Session volume filter -------------------------------------------
  // Measured before the levels are finalised, because the stop floor depends
  // on it: 0.6x ATR in normal conditions, 1.2-1.5x when the session is thin.
  const volRead = readSessionVolume(snap.candles);
  const stopFloorAtr = sessionStopAtr(volRead);

  // Whatever produces the plan, its levels are built for `resolved.bias` — the
  // side the card, the chat text, and the Setup chart all display. Passing the
  // resolved side down is what stops a "Short" card from carrying a long-shaped
  // entry below price with the stop underneath it.
  let finalPlan =
    resolved.bias !== "Neutral" && normalizeBias(plan.bias) !== resolved.bias
      ? systematicPlan(snap, memo, `Direction taken from measured structure (${resolved.reason});`, resolved.bias)
      : plan;
  finalPlan = sanitizePlan(finalPlan, snap, memo, resolved.bias, stopFloorAtr);
  // Last guard: if anything still points the wrong way, rebuild from structure.
  if (resolved.bias !== "Neutral") {
    const wrongStop = resolved.bias === "Long"
      ? finalPlan.stop >= finalPlan.entry
      : finalPlan.stop <= finalPlan.entry;
    const wrongTarget = resolved.bias === "Long"
      ? finalPlan.tp1 <= finalPlan.entry
      : finalPlan.tp1 >= finalPlan.entry;
    if (wrongStop || wrongTarget) {
      finalPlan = sanitizePlan(
        systematicPlan(snap, memo, "Levels rebuilt to match the measured direction;", resolved.bias),
        snap,
        memo,
        resolved.bias,
        stopFloorAtr,
      );
    }
  }


  const bias = resolved.bias;
  const dec = decimalsFor(snap.lastPrice || finalPlan.entry || 1);
  const risk = Math.abs(finalPlan.entry - finalPlan.stop) || 1;
  const reward = Math.abs(finalPlan.tp2 - finalPlan.entry);
  const rr = `1 : ${(reward / risk).toFixed(1)}`;

  // Conviction is counted from evidence that is actually present in the data.
  let confidence = bias === "Neutral" ? 0 : countEvidence(snap, memo, "B", bias, reward / risk);
  let grade = gradeFromEvidence(bias, confidence, snap);
  // Alignment cap from the engine. 4/4 keeps A+ available; 2/4 can never be
  // better than C no matter how confident the narrative sounds.
  grade = capToEngine(grade, biasRead.result.mtf.maxGrade);
  // Calendar risk is measurable and therefore remains a valid hard cap. The
  // user's scorecard cap is applied by the authenticated server-function
  // wrapper after this planner returns.
  if (newsWarning) {
    if (grade === "A+") grade = "A";
    else if (grade === "A") grade = "B";
  }

  // ---- Session filters as hard grade controls ---------------------------
  const warnings: string[] = [];
  const downgradeOne = (g: typeof GRADES[number]): typeof GRADES[number] =>
    g === "A+" ? "A" : g === "A" ? "B" : g === "B" ? "C" : g;

  // Thin overnight tape used to be a hard NO ENTRY. That is what made gold read
  // "no entry" for two days and hid index setups that ran the moment New York
  // opened. It is a timing problem, so the setup keeps its grade path and levels
  // and only carries the window to wait for. Crypto is exempt entirely: a quiet
  // Tokyo hour on a 24/7 market is not thin participation.
  const gate = timingGateFor(snap.ticker, volRead);
  let timingGate: string | null = null;
  if (gate && grade !== "NO ENTRY") {
    timingGate = gate.message;
    grade = downgradeOne(grade);
    warnings.push(timingGate);
  } else if (volRead?.thin && !gate && grade !== "NO ENTRY" && assetClassFor(snap.ticker) !== "crypto") {
    grade = downgradeOne(grade);
    warnings.push(
      `Thin volume - widen stops or reduce size. ${volRead.label}, so the stop was widened to ${stopFloorAtr.toFixed(1)}x ATR and the grade dropped a letter.`,
    );
  }


  // Mitigated order block at the entry: a block price already ran through
  // holds less often, and one tested twice or more usually fails outright.
  let mitigation: MitigatedBlockRead | null = null;
  if (grade !== "NO ENTRY" && bias !== "Neutral") {
    try {
      const blocks = computeOrderBlocks(snap.candles, { max: 10 });
      mitigation = readMitigatedEntry(finalPlan.entry, bias, blocks);
      if (mitigation.warning) {
        warnings.push(mitigation.warning);
        confidence = Math.max(10, confidence - mitigation.confidencePenalty);
        if (mitigation.mitigations >= 2) grade = downgradeOne(grade);
      }
    } catch { /* block detection is best-effort */ }
  }

  // A timing gate is not a broken read: the structure and the levels are still
  // valid, they just should not be executed until the tape wakes up. Blanking
  // them to "-" for hours is what made gold look dead for two days.
  const standDownOnly = !!timingGate && bias !== "Neutral";
  const isNoEntry = grade === "NO ENTRY" && !standDownOnly;



  // Regression metrics for the v3 fix. This change can fail in the opposite
  // direction (everything NEUTRAL), so neutral rate, bias flips, and grade
  // distribution have to be observable per instrument and per day.
  void logBiasMetric({
    symbol: snap.ticker,
    interval: snap.interval,
    bias,
    grade,
    neutral: bias === "Neutral",
    alignment: biasRead.result.mtf.alignmentScore,
    maxGrade: biasRead.result.mtf.maxGrade,
    engineStatus: biasRead.result.status,
    htfOpposed: biasRead.result.mtf.htfOpposed,
    computedAt: new Date(biasRead.result.mtf.computedAt).toISOString(),
  });

  const counterTrend = counterTrendRead(bias, snap);
  const comboGate = timeFrameComboGate(bias, snap);

  // `notes` already carries the thesis ("why take this trade"), so the details
  // block must NOT repeat it. It is the read-out of the evidence itself:
  // market structure, order flow and volume, volatility and levels, then a
  // short takeaway in the active coach's voice, then trade management.
  const dataNote = (snap.mtf
    ? ""
    : " Higher-timeframe data was incomplete on this scan, so the grade is capped at C until the feed fills in.")
    + (counterTrend.reason ? ` ${counterTrend.reason}` : "")
    + (comboGate.reason ? ` ${comboGate.reason}` : "")
    + (warnings.length ? ` ${warnings.join(" ")}` : "")
    + (volRead && !volRead.unavailable && !volRead.thin
      ? ` Session volume is normal (${volRead.label}), so the standard ${stopFloorAtr.toFixed(1)}x ATR minimum stop applies.`
      : "")
    + (volRead?.thin && !volRead.overnightThin
      ? ` Stop widened to ${stopFloorAtr.toFixed(1)}x ATR due to the thin ${volRead.session} session.`
      : "");
  const details = buildDetails(snap, memo, finalPlan, dec, coach, bias, grade, newsWarning, dataNote, volRead);







  // Daily bias sets the day's direction; 4H is the current trend. They can
  // disagree (price rallying up into a daily sell zone), which is exactly what
  // the trader needs to see.
  const ladder = snap.mtf?.ladder ?? [];
  const dailyBias = ladder.find((r) => r.label === "Daily")?.bias ?? snap.cisd.htfBias;
  const currentTrend = ladder.find((r) => r.label === "4H")?.trend ?? snap.mtf?.h4.trend ?? "range";
  const synopsis = buildSynopsis(snap, memo, grade, bias, dailyBias, currentTrend)
    + newsWarning
    + (timingGate ? ` ${timingGate}` : warnings.length ? ` ${warnings[0]}` : "");

  return {
    grade,
    bias,
    confidence,
    notes: finalPlan.thesis + (warnings.length ? ` ${warnings.join(" ")}` : ""),
    entry: isNoEntry ? "-" : fmt(finalPlan.entry, dec),
    stop:  isNoEntry ? "-" : fmt(finalPlan.stop,  dec),
    tp1:   isNoEntry ? "-" : fmt(finalPlan.tp1,   dec),
    tp2:   isNoEntry ? "-" : fmt(finalPlan.tp2,   dec),
    rr:    isNoEntry ? "-" : rr,
    details,
    memo,
    orderFlow: snap.orderFlow,
    dailyBias,
    currentTrend,
    synopsis,
    dataSource: snap.source,
    dataFetchedAt: snap.fetchedAt,
    candleCount: snap.candles.length,
    refPrice: snap.lastPrice,
    counterTrend: counterTrend.counterTrend,
    htfBias: dailyBias,
    warnings: warnings.length ? warnings : undefined,
    sessionVolume: volRead && !volRead.unavailable
      ? {
          session: volRead.session,
          ratio: Number(volRead.ratio.toFixed(2)),
          thin: volRead.thin,
          label: volRead.label,
          stopAtr: stopFloorAtr,
        }
      : undefined,
    mitigatedEntry: mitigation?.mitigated
      ? { mitigations: mitigation.mitigations, warning: mitigation.warning ?? "" }
      : undefined,
  };

}

/**
 * One short paragraph explaining why this grade was given, built from the
 * actual numbers rather than generic strength/weakness bullets.
 */
function buildSynopsis(
  snap: MarketSnapshot,
  memo: ResearchMemo,
  grade: string,
  bias: string,
  dailyBias: string,
  currentTrend: string,
): string {
  const l = snap.mtf?.ladder ?? [];
  const rung = (label: string) => l.find((r) => r.label === label);
  const of = snap.orderFlow;
  const parts: string[] = [];

  const monthly = rung("Monthly");
  const weekly = rung("Weekly");
  if (monthly && weekly) parts.push(`Monthly is ${monthly.bias} and weekly is ${weekly.bias}`);
  parts.push(`the daily bias for today is ${dailyBias}`);
  parts.push(`the 4H trend is ${currentTrend}`);

  const h1 = snap.mtf?.h1;
  if (h1 && h1.structureBreak !== "none") parts.push(`the 1H broke structure to the ${h1.structureBreak === "bullish" ? "upside" : "downside"}`);
  else parts.push("the 1H has not broken structure yet");

  const m15 = snap.mtf?.m15;
  if (m15) parts.push(m15.confirmation === "none" ? "the 15m has not confirmed" : `the 15m confirms ${m15.confirmation}`);

  if (of) {
    parts.push(
      `order flow shows ${of.buyPct.toFixed(0)}% buy volume with CVD ${of.cvdSlope >= 0 ? "rising" : "falling"}, price ${of.priceVsPoc} the point of control, and a ${of.depth} book`,
    );
  }

  const conflict =
    (dailyBias === "bullish" && currentTrend === "down") || (dailyBias === "bearish" && currentTrend === "up");
  const tail = conflict
    ? " Daily bias and the current 4H trend disagree, so price is likely travelling into the level rather than away from it. Wait for the 15m to confirm before committing."
    : grade === "NO ENTRY"
      ? " Nothing lines up cleanly enough to justify risk right now."
      : ` That is why this reads as a ${grade} ${bias.toLowerCase()}.`;

  return `${parts.join(", ")}.${tail} Analyst consensus: ${memo.consensus}.`;
}

/**
 * The "Details" block behind a scan. This is deliberately NOT the thesis - it
 * reads out the evidence the grade was measured from (market structure, order
 * flow, volume, volatility and levels), then closes with one takeaway written
 * in the active coach's voice and the management rules.
 */
function buildDetails(
  snap: MarketSnapshot,
  memo: ResearchMemo,
  plan: RawPlan,
  dec: number,
  coach: string | undefined,
  bias: string,
  grade: string,
  newsWarning: string,
  dataNote: string,
  volRead?: SessionVolumeRead | null,
): string {

  const l = snap.mtf?.ladder ?? [];
  const rung = (label: string) => l.find((r) => r.label === label);
  const of = snap.orderFlow;
  const atr = snap.stats.atr14;
  const last = snap.lastPrice;
  const sections: string[] = [];

  // 1. Market structure, top down.
  const structure: string[] = [];
  const ladderLine = (["Weekly", "Daily", "4H", "1H", "15m"] as const)
    .map((label) => {
      const r = rung(label);
      return r ? `${label} ${r.bias}/${r.trend}` : null;
    })
    .filter(Boolean)
    .join(", ");
  if (ladderLine) structure.push(`Timeframes read ${ladderLine}.`);
  const h4 = snap.mtf?.h4;
  if (h4) {
    const sup = h4.keyLevels.support[0];
    const res = h4.keyLevels.resistance[0];
    structure.push(
      `4H direction is ${h4.direction} in a ${h4.trend}, nearest 4H support ${sup != null ? fmt(sup, dec) : "n/a"} and resistance ${res != null ? fmt(res, dec) : "n/a"}.`,
    );
    const demand = h4.supplyDemand.demand[0];
    const supply = h4.supplyDemand.supply[0];
    if (demand || supply) {
      structure.push(
        `Active zones: demand ${demand ? `${fmt(demand[0], dec)}-${fmt(demand[1], dec)}` : "none mapped"}, supply ${supply ? `${fmt(supply[0], dec)}-${fmt(supply[1], dec)}` : "none mapped"}.`,
      );
    }
  }
  const h1 = snap.mtf?.h1;
  if (h1) {
    const orderBlocks = bias === "Short" ? h1.orderBlocks.bear : h1.orderBlocks.bull;
    const ob = [...orderBlocks].sort((a, b) => {
      const distance = (z: [number, number]) => {
        const lo = Math.min(z[0], z[1]);
        const hi = Math.max(z[0], z[1]);
        return plan.entry < lo ? lo - plan.entry : plan.entry > hi ? plan.entry - hi : 0;
      };
      return distance(a) - distance(b);
    })[0];
    const fvg = bias === "Short" ? h1.fvg.bear[0] : h1.fvg.bull[0];
    const obLo = ob ? Math.min(ob[0], ob[1]) : null;
    const obHi = ob ? Math.max(ob[0], ob[1]) : null;
    const entryInOb = obLo !== null && obHi !== null && plan.entry >= obLo && plan.entry <= obHi;
    const obRole = ob
      ? entryInOb
        ? `The planned entry ${fmt(plan.entry, dec)} is inside that order block.`
        : `The planned entry is ${fmt(plan.entry, dec)}, so this order block is supporting or invalidation structure, not the entry zone.`
      : "";
    structure.push(
      `1H structure break is ${h1.structureBreak}, reversal signal ${h1.reversal}, nearest ${bias === "Short" ? "bearish" : "bullish"} order block ${ob ? `${fmt(obLo ?? ob[0], dec)}-${fmt(obHi ?? ob[1], dec)}` : "none"} and FVG ${fvg ? `${fmt(fvg[0], dec)}-${fmt(fvg[1], dec)}` : "none"}. ${obRole}`,
    );
    const buyside = h1.liquidity.buyside[0];
    const sellside = h1.liquidity.sellside[0];
    if (buyside != null || sellside != null) {
      structure.push(
        `Resting liquidity sits ${buyside != null ? `above at ${fmt(buyside, dec)}` : "above: none"} and ${sellside != null ? `below at ${fmt(sellside, dec)}` : "below: none"}.`,
      );
    }
  }
  const m15 = snap.mtf?.m15;
  if (m15) structure.push(`15m confirmation: ${m15.confirmation === "none" ? "not yet" : m15.confirmation}${m15.reason ? ` (${m15.reason})` : ""}.`);
  if (structure.length) sections.push(`Market structure: ${structure.join(" ")}`);

  // 2. Order flow and volume, from the real metrics.
  const sessionLine = volRead
    ? volRead.unavailable
      ? ` ${volRead.label}, so session participation could not be checked.`
      : ` Session check: ${volRead.label} over the last ${volRead.bars} ${volRead.session} bars${volRead.thin ? " - thin conditions, so levels hold less often and stops need room." : " - normal participation for this session."}`
    : "";
  if (of) {
    const flow = [
      `Delta is ${of.delta >= 0 ? "+" : ""}${of.delta.toFixed(0)} against a ${of.deltaAvg.toFixed(0)} average and CVD is ${of.cvdSlope >= 0 ? "rising" : "falling"}, so ${of.cvdSlope >= 0 ? "buyers" : "sellers"} are the ones paying up over the last ${of.bars} bars.`,
      `Volume splits ${of.buyPct.toFixed(0)}% buy / ${(100 - of.buyPct).toFixed(0)}% sell, last bar traded ${of.lastVolRatio.toFixed(2)}x its average, and the book reads ${of.depth}.`,
      `Point of control ${of.poc.toLocaleString()} with the value area ${of.valueAreaLow.toLocaleString()} to ${of.valueAreaHigh.toLocaleString()}; price is ${of.priceVsPoc} it, which is ${of.priceVsPoc === "above" ? "where longs get accepted and shorts get squeezed" : of.priceVsPoc === "below" ? "where sellers keep control until price reclaims value" : "balance, so expect chop until one side commits"}.`,
      of.stackedSide !== "none"
        ? `There are ${of.stackedImbalances} stacked ${of.stackedSide} imbalances, an aggressive-${of.stackedSide === "buy" ? "buyer" : "seller"} footprint that usually gets revisited.`
        : "No stacked imbalances, so no obvious aggressive footprint to lean on.",
      of.estimated
        ? "This feed does not publish volume for the instrument, so these figures come from bar range and close position - treat them as directional, not exact."
        : "",
    ].filter(Boolean);
    sections.push(`Order flow and volume: ${flow.join(" ")} Net order-flow bias is ${of.bias}.${sessionLine}`);
  } else {
    sections.push(`Order flow and volume: no volume data was published for this instrument on this timeframe, so the grade leans entirely on structure.${sessionLine}`);
  }


  // 3. Volatility and level geometry, in ATR terms the trader can size with.
  const inAtr = (a: number, b: number) => (atr > 0 ? `${(Math.abs(a - b) / atr).toFixed(1)}x ATR` : "n/a");
  sections.push(
    `Volatility and geometry: ATR14 is ${fmt(atr, dec)} (${last > 0 ? ((atr / last) * 100).toFixed(2) : "0"}% of price) and the 20-bar range is ${fmt(snap.stats.low20, dec)} to ${fmt(snap.stats.high20, dec)}. Entry sits ${inAtr(plan.entry, last)} from spot, the stop is ${inAtr(plan.entry, plan.stop)} of risk, TP1 is ${inAtr(plan.entry, plan.tp1)} away and TP2 ${inAtr(plan.entry, plan.tp2)}. Sessions live: ${snap.sessionsActive.join(", ") || "none"}.`,
  );

  // 4. One takeaway in the active coach's voice.
  sections.push(`${coach ?? "The Analyst"}'s read: ${coachStory(coach, snap, of, grade, bias, memo)}`);

  // 5. Management, unchanged rules.
  sections.push(
    `Management: invalidation is ${plan.invalidation} Move to break-even at TP1 (${fmt(plan.tp1, dec)}), trail the runner to TP2 (${fmt(plan.tp2, dec)}), risk 0.5-1R of the account.${newsWarning}${dataNote}`,
  );

  return sections.join("\n\n");
}

/** The same evidence, told as a story in each coach's voice. */
function coachStory(
  coach: string | undefined,
  snap: MarketSnapshot,
  of: OrderFlow | undefined,
  grade: string,
  bias: string,
  memo: ResearchMemo,
): string {
  const dir = bias.toLowerCase();
  const flow = of ? `${of.buyPct.toFixed(0)}% buy volume, CVD ${of.cvdSlope >= 0 ? "rising" : "falling"}, price ${of.priceVsPoc} the point of control` : "no published volume";
  const aligned = snap.mtf?.alignment ?? "none";
  const confirm = snap.mtf?.m15.confirmation ?? "none";
  switch (coach) {
    case "The Disciplinarian":
      return grade === "NO ENTRY" || confirm === "none"
        ? `The checklist is not complete. Alignment is ${aligned} and the 15m confirmation is ${confirm}, so there is no trade to take yet. You do not get to front-run your own rules because the chart looks interesting.`
        : `Alignment is ${aligned}, the 15m has confirmed, and flow shows ${flow}. That clears the checklist for a ${dir}. One entry, one stop, no averaging, and you are done for the session once it is placed.`;
    case "The Mentor":
      return `Notice the order of operations here: the higher timeframes set the ${dir === "neutral" ? "context" : dir} bias, the 1H gave you the structure, and only then does flow (${flow}) tell you whether real money agrees. That sequence is why this is a ${grade} rather than a guess - practice reading it in that order and the grade becomes obvious before you look at it.`;
    case "The Minimalist":
      return grade === "A+" || grade === "A"
        ? `Clean ${dir}. Aligned, confirmed, flow agrees. Take it or leave it.`
        : `Marginal. ${aligned} alignment, ${confirm} confirmation. Skip it.`;
    case "The Psychologist":
      return grade === "NO ENTRY"
        ? `The trap here is the need to do something. With ${aligned} alignment and ${confirm} confirmation, any entry is boredom wearing a thesis. Sit on your hands and note what you felt while reading this.`
        : `The setup is real, and so is the emotional trap: ${of && of.lastVolRatio > 1.5 ? "that volume spike invites you to chase the move instead of waiting at your level" : "the slow build here invites you to move your stop closer just to feel safer"}. Decide your risk before the entry triggers, not after.`;
    default:
      return `Measured, the evidence stacks like this: alignment ${aligned}, 15m ${confirm}, flow ${flow}, analyst consensus ${memo.consensus} at ${memo.consensusConfidence}%. That combination is what prints a ${grade} ${dir}, and it is the flow leg that would degrade first if this fails.`;
  }
}
