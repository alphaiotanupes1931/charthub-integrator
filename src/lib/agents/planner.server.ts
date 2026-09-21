// Layer 3 - Planner. Paperclip-style plan → critique → refine loop (max 2 iterations)
// that consumes a ResearchMemo + MarketSnapshot and produces a concrete TradePlan.

import { generateText, Output, NoObjectGeneratedError } from "ai";
import { z } from "zod";
import { runScanModel } from "./scan-model.server";
import type { MarketSnapshot, OrderFlow, ResearchMemo, TradePlan } from "./types";
import type { TradeStyle } from "@/lib/tradeTiming";
import { SCANNER_METHODOLOGY_VERSION } from "@/lib/scanner-methodology";
import { formatOrderFlow } from "./order-flow.server";
import { computeOrderBlocks } from "@/lib/orderBlocks";
import { computeBias } from "./bias-adapter.server";
import type { AnalysisModelId } from "@/lib/analysis-models";
import { focusAnalysis, focusContextBlock } from "@/lib/analysis-models/focus-engine";
import { photonAnalysis, photonContextBlock } from "@/lib/analysis-models/photon-engine";
import { jablonskiAnalysis, jablonskiContextBlock } from "@/lib/analysis-models/jablonski-engine";
import { tunedConfigFor, profileHintFor } from "../instrument-profile.server";
import { stopMultipleFor } from "@/lib/stop-placement";


import {
  readSessionVolume,
  sessionStopAtr,
  readMitigatedEntry,
  timingGateFor,
  assetClassFor,

  type SessionVolumeRead,
  type MitigatedBlockRead,
} from "@/lib/sessionVolume";


/** Best-effort cost accounting for each planner step. Never blocks a scan. */
async function logPlannerCost(kind: string, model: string, usage: unknown, providerMetadata: unknown) {
  try {
    const { logAiCost } = await import("@/lib/ai-cost.server");
    await logAiCost({ kind, model, usage: usage as never, providerMetadata: providerMetadata as never });
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
  // Stop room is per market, measured on this market's own resolved trades, not
  // per grade: see stop-placement.ts. The old grade ladder gave A setups the
  // least room, which is where most of the loss was coming from.
  const stopDist = atr * stopMultipleFor(snap.ticker, grade);

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

/**
 * True when there is a real structural zone in the trade's direction on the 1H
 * (order block, FVG) or a 4H demand/supply zone. This is the difference between
 * "the tape happens to point this way" and "there is a place to enter from".
 */
export function hasAlignedZone(bias: typeof BIASES[number], snap: MarketSnapshot): boolean {
  if (bias === "Neutral") return false;
  const m = snap.mtf;
  if (!m) return false;
  const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
  const long = bias === "Long";
  const obs = arr(long ? m.h1?.orderBlocks?.bull : m.h1?.orderBlocks?.bear);
  const fvgs = arr(long ? m.h1?.fvg?.bull : m.h1?.fvg?.bear);
  const zones = arr(long ? m.h4?.supplyDemand?.demand : m.h4?.supplyDemand?.supply);
  return obs.length > 0 || fvgs.length > 0 || zones.length > 0;
}

/**
 * A counter-move on the 1H/15m inside an intact 4H trend is a pullback - which
 * is the entry the methodology is built around, not a reason to hold the grade
 * at C. This returns true only when the 4H still agrees with the trade and
 * there is an aligned zone for price to trade back into.
 */
export function isAlignedPullback(bias: typeof BIASES[number], snap: MarketSnapshot): boolean {
  if (bias === "Neutral") return false;
  const m = snap.mtf;
  if (!m) return false;
  const want = bias === "Long" ? "bullish" : "bearish";
  const h4Agrees = m.h4?.direction === want || m.h4?.trend === (bias === "Long" ? "up" : "down");
  return h4Agrees && hasAlignedZone(bias, snap);
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

  // Confirmation quality. These are not the votes that chose the direction:
  // they measure whether the top-down picture actually lines up behind the
  // trade (4H direction with a 1H break in the same direction, a 15m
  // confirmation, and a real aligned zone to enter from). Without them an
  // otherwise textbook aligned pullback scored the same as a coin flip, which
  // is why almost every scan landed on C.
  if (mtf) {
    const want = wantBull ? "bullish" : "bearish";
    check(mtf.h4.direction === want && mtf.h1.structureBreak === want, 2);
    check(mtf.m15.confirmation === want, 1);
    check(hasAlignedZone(bias, snap), 1);
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
    pools.length > 0 ||
    m?.h1.structureBreak === wanted ||
    m?.h1.reversal === wanted ||
    // A fresh aligned OB/FVG is itself the 1H location the method waits for.
    // Requiring a same-direction break before counting that location turned
    // every active pullback into a failed step and forced otherwise valid
    // setups to C before the 15m had a chance to confirm.
    hasAlignedZone(bias, snap);

  // Step 3 - 15m BOS / ChoCH confirmation.
  const m15 = m?.m15.confirmation ?? "none";
  const m15Ok = m15 === wanted;

  if (m15 === opposite) {
    // A 15m break against an intact 4H trend, with an aligned zone to trade
    // back into, is the pullback itself. That is the entry this method is built
    // on, so it waits for confirmation at B rather than being written off at C.
    const pullback = h4Ok && h1Ok && isAlignedPullback(bias, snap);
    return {
      cap: pullback ? "B" : "C",
      reason: pullback
        ? `Time Frame Combo step 3 pending: the 15m is breaking ${m15}, which is the pullback into your ${bias.toLowerCase()} zone while the 4H still reads ${h4Dir}/${h4Trend}. Held at B until the 15m turns ${wanted} - that turn is your execution trigger.`
        : `Time Frame Combo step 3 failed: the 15m break is ${m15}, against this ${bias.toLowerCase()}. Wait for a 15m BOS/ChoCH in your direction before executing on the 5m.`,
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

// ---------- Protected low / high (break of structure quality) ----------
// A break of structure only counts when the low (long) or high (short) that
// produced the broken swing had itself swept liquidity. If it did not, the stops
// beyond it are untouched and price normally goes and collects them first: that
// is the break that looks perfect and stops the trader out. Those setups cannot
// be an A.
export function protectedStructureRead(
  bias: typeof BIASES[number],
  snap: MarketSnapshot,
): { cap: typeof GRADES[number] | null; reason: string | null } {
  if (bias === "Neutral") return { cap: null, reason: null };
  const bos = snap.mtf?.h1.bos;
  if (!bos) return { cap: null, reason: null };
  const wanted = bias === "Long" ? "bullish" : "bearish";
  if (bos.kind !== wanted) return { cap: null, reason: null };
  if (bos.quality === "protected") return { cap: null, reason: null };
  const side = bias === "Long" ? "low" : "high";
  const where = bias === "Long" ? "below" : "above";
  return {
    cap: "C",
    reason: `Bad break of structure: the 1H ${side} at ${bos.originLevel} expanded without sweeping the ${side} at ${bos.priorLevel ?? "the prior swing"} first, so that liquidity is still resting ${where} it. There is no protected ${side} to hide the stop behind, so this caps at C - wait for the sweep, then the break.`,
  };
}

/** One sentence for the written plan describing the break of structure quality. */
export function bosThesisNote(
  bias: typeof BIASES[number],
  snap: MarketSnapshot,
): string | null {
  const bos = snap.mtf?.h1.bos;
  if (!bos) return null;
  const wanted = bias === "Long" ? "bullish" : bias === "Short" ? "bearish" : null;
  if (wanted && bos.kind !== wanted) return null;
  return bos.reason;
}

/**
 * Stop level that covers the protected low/high left by the 1H break, when the
 * break agrees with the trade and the level sits the right side of entry.
 */
export function protectedStopBeyond(
  bias: typeof BIASES[number],
  entry: number,
  atr: number,
  snap: MarketSnapshot,
): number | null {
  const bos = snap.mtf?.h1.bos;
  if (!bos || bos.quality !== "protected" || bos.protectedLevel === null) return null;
  const wanted = bias === "Long" ? "bullish" : "bearish";
  if (bos.kind !== wanted) return null;
  const pad = Math.max(atr * 0.25, Math.abs(entry) * 0.0003);
  if (bias === "Long") return bos.protectedLevel < entry ? bos.protectedLevel - pad : null;
  return bos.protectedLevel > entry ? bos.protectedLevel + pad : null;
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
    // Same principle: inside an intact 4H trend with an aligned zone, a 1H
    // counter-break is the retracement leg, not a broken thesis.
    if (isAlignedPullback(bias, snap)) {
      return {
        cap: "B",
        reason: `The 1H has broken ${opposite} into your ${bias.toLowerCase()} zone while the 4H still reads ${snap.mtf?.h4.direction}/${snap.mtf?.h4.trend}. That is the retracement, so this is a B - take it on the turn back ${wanted}, not before.`,
      };
    }
    return {
      cap: "C",
      reason: `The 1H has broken structure ${opposite}, against this ${bias.toLowerCase()}, and the 4H is not backing the trade, so the grade is capped at C until the 1H breaks back ${wanted}.`,
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
  const opposedFlow = wanted === "bullish" ? "bearish" : "bullish";
  if (of.bias !== opposedFlow) return { cap: null, reason: null };
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

// ---------- Delta expanding against the position ----------
// The losing USD/JPY A-grade short had delta +4.5K expanding to +6.9K while the
// cumulative read was still labelled bearish, so `orderFlowOppositionRead` (which
// keys off that label) stayed silent. Expanding delta against the trade is a
// warning in its own right: buyers absorbing into a level is what precedes the
// reversal. This read ignores the label and looks only at the numbers.
export function deltaAgainstPositionRead(
  bias: typeof BIASES[number],
  snap: MarketSnapshot,
): { cap: typeof GRADES[number] | null; reason: string | null } {
  const of = snap.orderFlow;
  if (!of || bias === "Neutral") return { cap: null, reason: null };
  const against = bias === "Long" ? of.delta < 0 : of.delta > 0;
  if (!against) return { cap: null, reason: null };
  const cvdAgainst = bias === "Long" ? of.cvdSlope < 0 : of.cvdSlope > 0;
  if (!cvdAgainst) return { cap: null, reason: null };
  // Scaled against this instrument's own average delta, so one rule works on
  // an index, a currency pair and gold alike.
  const ratio = Math.abs(of.delta) / Math.max(1, Math.abs(of.deltaAvg));
  if (ratio < 1.5) return { cap: null, reason: null };
  const side = bias === "Long" ? "sellers" : "buyers";
  const shape = `delta ${of.delta > 0 ? "+" : ""}${of.delta.toFixed(0)} (${ratio.toFixed(1)}x its own average) with CVD ${of.cvdSlope > 0 ? "rising" : "falling"}`;
  if (ratio >= 3 && !of.estimated) {
    return {
      cap: "C",
      reason: `Order flow warning: ${shape} - ${side} are stepping in aggressively against this ${bias.toLowerCase()}, which is absorption, not confirmation. Capped at C. If delta keeps expanding against you after entry, get out rather than waiting for the stop.`,
    };
  }
  return {
    cap: "B",
    reason: `Order flow warning: ${shape} against this ${bias.toLowerCase()}, so this caps at B. ${side.charAt(0).toUpperCase() + side.slice(1)} are paying up into your entry - size down and cut it if delta keeps expanding their way.`,
  };
}

// ---------- Stale higher-timeframe data ----------
// A 4H candle closing after the data was pulled can flip the whole structure
// (a bearish-to-bullish change of character). Grading a short off a 4H that no
// longer exists is exactly how the USD/JPY trade was invalidated before it
// started, so a scan built on pre-close data cannot carry a high grade.
const H4_MS = 4 * 60 * 60 * 1000;
export function staleHigherTimeframeRead(
  snap: MarketSnapshot,
  now: number = Date.now(),
): { cap: typeof GRADES[number] | null; reason: string | null } {
  const fetched = Date.parse(snap.fetchedAt ?? "");
  if (!Number.isFinite(fetched)) return { cap: null, reason: null };
  // 4H candles close on the UTC 4-hour grid.
  const lastClose = Math.floor(now / H4_MS) * H4_MS;
  if (fetched >= lastClose) return { cap: null, reason: null };
  const closedAt = new Date(lastClose).toISOString().slice(11, 16);
  const mins = Math.round((now - fetched) / 60000);
  return {
    cap: "C",
    reason: `Data freshness warning: a 4H candle closed at ${closedAt} UTC, after this scan's data was pulled ${mins} minutes ago. The 4H structure behind this grade may already have flipped, so the grade is capped at C - re-scan before risking anything on it.`,
  };
}

// ---------- Trend / fade / reversal classifier ----------
// The trader was told "A grade" on what was structurally a fade: 4H bearish,
// 1H bullish. An A means everything agrees. Naming the setup type sets the right
// expectation and forces the opposite scenario to be spelled out.
export type SetupTypeRead = {
  type: "trend" | "fade" | "reversal";
  cap: typeof GRADES[number] | null;
  reason: string | null;
  /** Level that kills the thesis and turns the opposite side into the trade. */
  flipLevel: number | null;
};

export function setupTypeRead(bias: typeof BIASES[number], snap: MarketSnapshot): SetupTypeRead {
  const none: SetupTypeRead = { type: "trend", cap: null, reason: null, flipLevel: null };
  const m = snap.mtf;
  if (bias === "Neutral" || !m) return none;
  const wanted = bias === "Long" ? "bullish" : "bearish";
  const opposite = wanted === "bullish" ? "bearish" : "bullish";
  const h1 = m.ladder?.find((r) => r.label === "1H");
  const h1Opposes =
    h1?.bias === opposite || h1?.trend === (opposite === "bullish" ? "up" : "down") || m.h1?.structureBreak === opposite;
  const h4Opposes = m.h4?.direction === opposite || m.h4?.trend === (opposite === "bullish" ? "up" : "down");

  // 4H itself has turned against the side we were about to trade: a reversal
  // setup, and shorting into a fresh bullish 4H change of character (or the
  // mirror) is never an A.
  if (h4Opposes) {
    return {
      type: "reversal",
      cap: "C",
      flipLevel: null,
      reason: `Setup type: reversal. The 4H itself now reads ${m.h4?.direction}/${m.h4?.trend}, against this ${bias.toLowerCase()}, so the structure this grade was built on has changed character. Capped at C - wait for the 4H to break back ${wanted}.`,
    };
  }
  if (!h1Opposes) return none;

  // Level that kills the fade: the nearest opposing structure beyond price.
  const last = Number(snap.lastPrice) || 0;
  const cands: number[] = [];
  // Feeds can deliver a partial ladder, so every branch is read defensively.
  const nums = (v: unknown): number[] => (Array.isArray(v) ? (v as number[]) : []);
  const zones = (v: unknown): Array<[number, number]> => (Array.isArray(v) ? (v as Array<[number, number]>) : []);
  if (bias === "Short") {
    nums(m.h4?.keyLevels?.resistance).forEach((p) => cands.push(p));
    zones(m.h1?.orderBlocks?.bear).forEach((z) => cands.push(Math.max(z[0], z[1])));
    nums(m.h1?.liquidity?.buyside).forEach((p) => cands.push(p));
  } else {
    nums(m.h4?.keyLevels?.support).forEach((p) => cands.push(p));
    zones(m.h1?.orderBlocks?.bull).forEach((z) => cands.push(Math.min(z[0], z[1])));
    nums(m.h1?.liquidity?.sellside).forEach((p) => cands.push(p));
  }
  const beyond = cands.filter((p) => Number.isFinite(p) && p > 0 && (bias === "Short" ? p > last : p < last));
  beyond.sort((a, b) => Math.abs(a - last) - Math.abs(b - last));
  const flipLevel = beyond[0] ?? null;
  const d = decimalsFor(last);
  const otherSide = bias === "Short" ? "long" : "short";
  const levelText = flipLevel
    ? `If the 1H closes ${bias === "Short" ? "above" : "below"} ${flipLevel.toFixed(d)} and holds, the ${bias.toLowerCase()} thesis is dead and a ${otherSide} becomes the higher-probability trade - be ready to reverse or exit rather than sitting in it.`
    : `If the 1H holds its ${opposite} push, the ${bias.toLowerCase()} thesis is dead and the ${otherSide} becomes the higher-probability trade.`;

  return {
    type: "fade",
    cap: "B",
    flipLevel,
    reason: `Setup type: counter-trend fade, not a trend trade. The 4H is ${m.h4?.direction} but the 1H reads ${h1?.bias ?? opposite}/${h1?.trend ?? "-"}, so this only works if the 1H push fails. B at best: half size, tighter management. ${levelText}`,
  };
}

// ---------- Near-term override (flip or stand aside) ----------
// The losing A-grade short had the 1H bullish, the 15m bearish only by stale
// label, and delta firmly positive. Capping the grade was not enough: a setup
// where the 1H, the 15m and real order flow all oppose the higher-timeframe
// side is not a trade on that side at all. If the 4H is not actively trending
// with the original side, the near-term side IS the trade (the stop that got
// hit was the other side's target). If the 4H is trending with the original
// side, the two are fighting and the honest answer is no entry.
export function nearTermOverrideRead(
  bias: typeof BIASES[number],
  snap: MarketSnapshot,
): { bias: typeof BIASES[number] | null; reason: string | null } {
  if (bias === "Neutral") return { bias: null, reason: null };
  const mtf = snap.mtf;
  const of = snap.orderFlow;
  if (!mtf || !of || of.estimated) return { bias: null, reason: null };

  const wanted = bias === "Long" ? "bullish" : "bearish";
  const opposite = wanted === "bullish" ? "bearish" : "bullish";
  const oppositeBias: typeof BIASES[number] = bias === "Long" ? "Short" : "Long";
  const oppTrend = opposite === "bullish" ? "up" : "down";

  const rows = mtf.ladder ?? [];
  const h1 = rows.find((r) => r.label === "1H");
  const h4 = rows.find((r) => r.label === "4H");

  const h1Opposes = h1?.bias === opposite || h1?.trend === oppTrend;
  const m15Opposes = mtf.m15.confirmation === opposite || rows.find((r) => r.label === "15m")?.trend === oppTrend;
  const flowOpposes =
    of.bias === opposite &&
    (opposite === "bullish" ? of.delta > 0 && of.cvdSlope > 0 : of.delta < 0 && of.cvdSlope < 0);

  if (!(h1Opposes && m15Opposes && flowOpposes)) return { bias: null, reason: null };

  const h4WithOriginal = h4?.trend === (wanted === "bullish" ? "up" : "down");
  if (h4WithOriginal) {
    return {
      bias: "Neutral",
      reason: `no entry: the 4H still trends ${wanted} but the 1H, the 15m and order flow all read ${opposite} - the two sides are fighting, so neither side is worth risk here.`,
    };
  }
  return {
    bias: oppositeBias,
    reason: `near-term override: the 1H, the 15m and live order flow all read ${opposite} while the 4H is not trending ${wanted}, so the trade is the ${oppositeBias.toLowerCase()} side, not the ${bias.toLowerCase()}.`,
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
  const alignedZone = hasAlignedZone(bias, snap);
  const fullyAligned = mtf?.alignment === (wantBull ? "aligned-long" : "aligned-short");

  let grade: typeof GRADES[number];
  // High grades require both a high evidence ratio and named structural
  // agreement. A majority-selected direction by itself cannot earn an A.
  if (confidence >= 84 && fullyAligned && m15Agrees) grade = "A+";
  else if (confidence >= 74 && h4Agrees && h1Agrees) grade = "A";
  // A valid pullback setup is structurally a B while it waits for the 15m turn.
  // Monthly/weekly context, a neutral analyst memo, or an unfinished live bar
  // can lower confidence without erasing an intact 4H direction plus a real
  // aligned entry zone. Genuine opposition is still applied by the hard caps
  // below and can reduce this to C or NO ENTRY.
  // The shortcut never applies at the floor score of 25, which is what a failing
  // reward-to-risk (or zero positive evidence) returns: those stay C.
  else if (confidence >= 58 || (confidence > 25 && h4Agrees && alignedZone)) grade = "B";
  else grade = "C";

  // Missing higher-timeframe data means the counters had little to work with.
  if (!snap.mtf && grade !== "C") grade = "C";

  // Counter-trend setups and the Time Frame Combo are capped last so nothing can
  // lift them back up.
  const order: string[] = ["NO ENTRY", "C", "B", "A", "A+"];
  for (const c of collectGradeCaps(bias, snap)) {
    if (order.indexOf(grade) > order.indexOf(c.cap)) grade = c.cap as typeof GRADES[number];
  }
  return grade;
}

/** One reason the grade was held down, in the order the caps are applied. */
export type GradeCapReason = {
  /** Short label the trader can scan, e.g. "1H against the 4H". */
  label: string;
  /** Best grade this check allows. */
  cap: typeof GRADES[number];
  /** Full plain-language explanation with the numbers behind it. */
  reason: string;
  /** True when this check is the one holding the final grade where it is. */
  binding?: boolean;
};

/**
 * Every deterministic cap that fired on this scan, with its own reason. This is
 * the answer to "why does it keep showing C": each entry is a rule that was
 * triggered by the data, and the lowest one sets the grade.
 */
export function collectGradeCaps(
  bias: typeof BIASES[number],
  snap: MarketSnapshot,
): GradeCapReason[] {
  const out: GradeCapReason[] = [];
  const push = (label: string, r: { cap: typeof GRADES[number] | null; reason: string | null }) => {
    if (r.cap && r.reason) out.push({ label, cap: r.cap, reason: r.reason });
  };
  if (!snap.mtf) {
    out.push({
      label: "Higher-timeframe data incomplete",
      cap: "C",
      reason: "The 4H/1H/15m ladder did not come back on this scan, so there was nothing to grade the setup against and it is held at C until the feed fills in.",
    });
  }
  push("Counter-trend setup", counterTrendRead(bias, snap));
  push("Time Frame Combo gate", timeFrameComboGate(bias, snap));
  push("1H against the higher timeframes", lowerTimeframeOppositionRead(bias, snap));
  push("Break of structure quality", protectedStructureRead(bias, snap));
  push("Order flow opposing the setup", orderFlowOppositionRead(bias, snap));
  push("Delta expanding against the position", deltaAgainstPositionRead(bias, snap));
  push("Setup type", setupTypeRead(bias, snap));
  push("Stale 4H data", staleHigherTimeframeRead(snap));
  if (snap.orderFlow?.deltaConflict) {
    out.push({
      label: "Order flow contradicts itself",
      cap: "B",
      reason: "The live bar's delta is pushing against the cumulative volume delta, so the flow is not confirming anything and cannot sit behind an A.",
    });
  }
  return out;
}




// ---------- Structure-anchored entry refinement ----------
// Instead of parking the entry a flat fraction of ATR under/over price, snap it
// to the nearest real level price is likely to trade back into: 1H order block,
// 1H FVG, 4H demand/supply zone, 4H key level, or resting liquidity. This is
// what makes the fill precise rather than "roughly near price".
type EntryAnchor = {
  entry: number;
  zoneFar: number;
  label: string;
  top?: number;
  bottom?: number;
  quality?: number;
  qualityLabel?: "high" | "medium" | "low";
  distanceAtr?: number;
};

/**
 * The last real swing beyond entry on the scanned timeframe, plus a volatility
 * buffer. A stop that sits in front of this level is the "stop was in a bad
 * place" failure: price only has to take the swing to remove you.
 */
export function swingStopBeyond(
  bias: "Long" | "Short",
  entry: number,
  atr: number,
  snap: MarketSnapshot,
): number | null {
  const c = Array.isArray(snap.candles) ? snap.candles.slice(-24) : [];
  if (c.length < 6) return null;
  const pad = Math.max(atr * 0.35, Math.abs(entry) * 0.0006);
  if (bias === "Long") {
    const lows = c.map((k) => Number(k.low)).filter((n) => Number.isFinite(n) && n > 0 && n < entry);
    if (!lows.length) return null;
    return Math.min(...lows) - pad;
  }
  const highs = c.map((k) => Number(k.high)).filter((n) => Number.isFinite(n) && n > entry);
  if (!highs.length) return null;
  return Math.max(...highs) + pad;
}

/**
 * Confirmation gate. The setup can be structurally valid and still be too early:
 * until the lower timeframes actually turn, entering is a guess. When nothing has
 * confirmed we return the price that has to trade before the plan is live.
 */
export type EntryTriggerRead = { triggered: boolean; level: number | null; rule: string | null };

export function entryTriggerRead(
  bias: "Long" | "Short" | "Neutral",
  snap: MarketSnapshot,
  atr: number,
  tradeStyle?: TradeStyle,
  /**
   * The planned entry price. Six live trades in a row were taken far too early
   * because a confirmed lower timeframe was reported as "triggered" while price
   * was still an ATR away from the entry zone. When the entry is known, price
   * has to actually reach it before the plan is live.
   */
  plannedEntry?: number | null,
): EntryTriggerRead {
  if (bias === "Neutral") return { triggered: false, level: null, rule: null };
  const wanted = bias === "Long" ? "bullish" : "bearish";
  const m = snap.mtf;
  const m15 = m?.m15?.confirmation;
  const h1Break = m?.h1?.structureBreak;
  const lowerTimeframeConfirmed = (candles: MarketSnapshot["candles"], direction: typeof wanted) => {
    if (candles.length < 4) return false;
    const closed = candles.slice(-4);
    const first = closed[0];
    const last = closed[closed.length - 1];
    if (!first || !last) return false;
    return direction === "bullish"
      ? last.close > first.high && last.close > last.open
      : last.close < first.low && last.close < last.open;
  };
  const styleConfirmed = tradeStyle === "scalp"
    ? lowerTimeframeConfirmed(snap.candles5m ?? snap.candles15m ?? [], wanted)
    : tradeStyle === "swing"
      ? h1Break === wanted
      : tradeStyle === "intraday"
        ? m15 === wanted
        : m15 === wanted || h1Break === wanted;

  // Distance gate. Runs before the confirmation read, because "the 15m turned"
  // is not permission to buy a price the plan never asked you to buy.
  const entry = Number(plannedEntry);
  if (Number.isFinite(entry) && entry > 0 && Number.isFinite(snap.lastPrice)) {
    const tol = Math.max(atr * 0.1, Math.abs(snap.lastPrice) * 0.0002);
    const reached = bias === "Long" ? snap.lastPrice <= entry + tol : snap.lastPrice >= entry - tol;
    if (!reached) {
      const away = Math.abs(snap.lastPrice - entry);
      const awayAtr = atr > 0 ? away / atr : 0;
      return {
        triggered: false,
        level: entry,
        rule: `Not at the entry yet: price is ${awayAtr.toFixed(2)}x ATR (${away.toPrecision(4)}) ${
          bias === "Long" ? "above" : "below"
        } the ${entry} entry. Leave a limit order at the entry or wait for the pullback. Buying${
          bias === "Short" ? "/selling" : ""
        } here is early and gives you a worse price with a wider stop.`,
      };
    }
  }

  if (styleConfirmed) {
    return {
      triggered: true,
      level: null,
      rule: tradeStyle === "scalp"
        ? "Trigger met: the 5m has displaced in the direction of the scalp."
        : tradeStyle === "swing"
          ? "Trigger met: the 1H has broken structure in the direction of the swing."
          : m15 === wanted
            ? "Trigger met: the 15m has confirmed in the direction of the intraday setup."
            : "Trigger met: the 1H has broken structure in the direction of the setup.",
    };
  }
  const c = Array.isArray(snap.candles) ? snap.candles : [];
  const ref = c.length >= 2 ? c[c.length - 2] : c[c.length - 1];
  const skim = Math.max(atr * 0.05, Math.abs(snap.lastPrice) * 0.0002);
  const level = ref
    ? bias === "Long"
      ? Number(ref.high) + skim
      : Number(ref.low) - skim
    : null;
  const dir = bias === "Long" ? "above" : "below";
  return {
    triggered: false,
    level: Number.isFinite(level as number) && (level as number) > 0 ? (level as number) : null,
    rule: `Not triggered yet: the ${tradeStyle === "scalp" ? "5m" : tradeStyle === "swing" ? "1H" : "15m"} has not turned ${wanted}. The plan only becomes valid once price closes ${dir} ${
      level && Number.isFinite(level) ? level : "the last swing"
    } on the ${snap.interval} chart. Taking it before that is early.`,
  };
}

export function findEntryAnchor(
  bias: "Long" | "Short",
  last: number,
  atr: number,
  snap: MarketSnapshot,
): EntryAnchor | null {
  const m = snap.mtf;
  // A limit that sits a tenth of an ATR from price is a market order wearing a
  // limit's clothes: it fills instantly at the worst price in the leg. A real
  // pullback entry has to be a meaningful discount/premium to spot.
  const minGap = Math.max(atr * 0.4, last * 0.0008);
  // Preferred depth: this is where a retracement actually pays, so anchors at
  // least this far away win over anything shallower.
  const goodGap = Math.max(atr * 0.6, last * 0.0012);
  const maxGap = atr * 2.2;
  const cands: (EntryAnchor & { tier: number })[] = [];


  // tier 0 = a real zone (order block / FVG / supply-demand): price has to trade
  // into it, so the fill is a discount. tier 1 = a bare level, which is weaker.
  const pushZone = (z: [number, number], label: string, quality?: number, qualityLabel?: "high" | "medium" | "low", distanceAtr?: number) => {
    const top = Math.max(z[0], z[1]);
    const bottom = Math.min(z[0], z[1]);
    if (!Number.isFinite(top) || !Number.isFinite(bottom) || bottom <= 0) return;
    // Enter at the near edge of the zone, keep the far edge for stop placement.
    const tier = label.includes("1H") && label.includes("order block")
      ? qualityLabel === "high" ? -2 : -1
      : 0;
    if (bias === "Long") cands.push({ entry: top, zoneFar: bottom, top, bottom, label, quality, qualityLabel, distanceAtr, tier });
    else cands.push({ entry: bottom, zoneFar: top, top, bottom, label, quality, qualityLabel, distanceAtr, tier });
  };
  const pushLevel = (p: number, label: string) => {
    if (!Number.isFinite(p) || p <= 0) return;
    const pad = atr * 0.25;
    if (bias === "Long") cands.push({ entry: p, zoneFar: p - pad, label, tier: 1 });
    else cands.push({ entry: p, zoneFar: p + pad, label, tier: 1 });
  };

  if (m) {
    const wanted = bias === "Long" ? "bullish" : "bearish";
    const ranked = (m.h1.orderBlockDetails ?? [])
      .filter((block) => block.kind === wanted)
      .sort((a, b) => b.quality - a.quality || a.distanceAtr - b.distanceAtr);
    ranked.forEach((block) => pushZone(
      [block.bot, block.top],
      `1H ${wanted} order block`,
      block.quality,
      block.qualityLabel,
      block.distanceAtr,
    ));
    if (bias === "Long") {
      if (!ranked.length) m.h1.orderBlocks.bull.forEach((z) => pushZone(z, "1H bullish order block"));
      m.h1.fvg.bull.forEach((z) => pushZone(z, "1H bullish FVG"));
      m.h4.supplyDemand.demand.forEach((z) => pushZone(z, "4H demand zone"));
      m.h4.keyLevels.support.forEach((p) => pushLevel(p, "4H support"));
      m.h1.liquidity.sellside.forEach((p) => pushLevel(p, "sellside liquidity"));
    } else {
      if (!ranked.length) m.h1.orderBlocks.bear.forEach((z) => pushZone(z, "1H bearish order block"));
      m.h1.fvg.bear.forEach((z) => pushZone(z, "1H bearish FVG"));
      m.h4.supplyDemand.supply.forEach((z) => pushZone(z, "4H supply zone"));
      m.h4.keyLevels.resistance.forEach((p) => pushLevel(p, "4H resistance"));
      m.h1.liquidity.buyside.forEach((p) => pushLevel(p, "buyside liquidity"));
    }
  }
  if (snap.cisd.state !== "none" && snap.cisd.level > 0) {
    pushLevel(snap.cisd.level, "CISD level");
  }

  const gapOf = (c: EntryAnchor) => (bias === "Long" ? last - c.entry : c.entry - last);
  const valid = cands.filter((c) => {
    const gap = gapOf(c);
    return gap >= minGap && gap <= maxGap;
  });
  if (!valid.length) return null;
  // Prefer a zone over a bare level, then the shallowest anchor that is still a
  // genuine retracement. Anything shallower than goodGap is only used when
  // nothing deeper exists.
  const rank = (c: EntryAnchor & { tier: number }) => {
    const gap = gapOf(c);
    const qualityBonus = c.quality == null ? 0 : (100 - c.quality) / 10;
    return c.tier * 100 + qualityBonus + (gap >= goodGap ? 0 : 10) + gap / Math.max(atr, 1e-9);
  };
  valid.sort((a, b) => rank(a) - rank(b));
  const best = valid[0]!;
  return {
    entry: best.entry,
    zoneFar: best.zoneFar,
    label: best.label,
    top: best.top,
    bottom: best.bottom,
    quality: best.quality,
    qualityLabel: best.qualityLabel,
    distanceAtr: best.distanceAtr ?? Number((gapOf(best) / Math.max(atr, 1e-9)).toFixed(2)),
  };
}


/**
 * Swing highs/lows on the scan timeframe: 2-bar fractal pivots. These are the
 * levels price has to fight through next, and without them the only structure
 * the planner can see is 4H shelves, which are always far away.
 */
function swingLevelsFromCandles(c: MarketSnapshot["candles"], want: "high" | "low"): number[] {
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

export function swingLevels(snap: MarketSnapshot, want: "high" | "low"): number[] {
  return swingLevelsFromCandles(snap.candles, want);
}

/**
 * Every level price must trade through beyond entry, nearest first. Targets are
 * decided by market structure; R multiples only describe the result and are a
 * last resort when an instrument has no mapped structure at all.
 */
export function findTargetLevels(
  bias: "Long" | "Short",
  entry: number,
  snap: MarketSnapshot,
  tradeStyle: TradeStyle = "intraday",
): number[] {
  const m = snap.mtf;
  const s = snap.stats;
  const executionCandles = tradeStyle === "scalp"
    ? snap.candles5m ?? snap.candles15m ?? snap.candles
    : tradeStyle === "swing"
      ? snap.candles1h ?? snap.candles
      : snap.candles15m ?? snap.candles;
  const pool: number[] = bias === "Long"
    ? [
        // Near-term structure on the timeframe being scanned.
        ...swingLevelsFromCandles(executionCandles, "high"),
        s.high20, s.high50,
        // Higher-timeframe shelves, liquidity and the near edge of supply.
        ...(m ? m.h4.keyLevels.resistance : []),
        ...(m ? m.h1.liquidity.buyside : []),
        ...(m ? m.h4.supplyDemand.supply.map((z) => Math.min(z[0], z[1])) : []),
        ...(m ? m.h1.orderBlocks.bear.map((z) => Math.min(z[0], z[1])) : []),
        ...(m ? m.h1.fvg.bear.map((z) => Math.min(z[0], z[1])) : []),
      ]
    : [
        ...swingLevelsFromCandles(executionCandles, "low"),
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
export function reachAtr(interval: string, tradeStyle?: TradeStyle): number {
  if (tradeStyle === "scalp") return 1.15;
  if (tradeStyle === "intraday") return 1.6;
  if (tradeStyle === "swing") return 3.5;
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
  tradeStyle: TradeStyle = "intraday",
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
      snap, memo, forcedBias, stopFloorAtr, tradeStyle,
    );

  }

  // Minimum distance a limit order must sit from spot. A 0.15x-ATR buffer fills
  // instantly at market price, which is the "limit was too shallow" complaint.
  const buffer = Math.max(atr * 0.4, last * 0.0008);
  const anchor = findEntryAnchor(bias, last, atr, snap);
  let anchorLabel: string | null = null;
  let structuralStop: number | null = null;

  if (anchor) {
    // 1a. Structure-anchored entry. Keep the model's price only when it is at the
    // same level AND is itself a real pullback; otherwise snap to the level.
    const modelIsNear = Math.abs(entry - anchor.entry) <= atr * 0.33
      && (bias === "Long" ? entry <= last - buffer : entry >= last + buffer);
    entry = modelIsNear ? entry : anchor.entry;
    anchorLabel = anchor.label;
    // Stop goes just past the far edge of the zone that gave us the entry.
    const pad = Math.max(atr * 0.3, last * 0.0004);
    structuralStop = bias === "Long" ? anchor.zoneFar - pad : anchor.zoneFar + pad;
  } else {
    // 1b. No usable structure: clamp runaway entries and fall back to a
    // pullback offset from price.
    if (Math.abs(entry - last) > atr * 2.2 || Math.abs(entry - last) < buffer) {
      entry = bias === "Long" ? last - Math.max(atr * 0.5, buffer) : last + Math.max(atr * 0.5, buffer);
      structuralStop = null;
    }
  }

  // 2. Longs must still sit below price, shorts above, by at least the minimum
  // pullback distance (limit orders only — never a disguised market order).
  if (bias === "Long" && entry > last - buffer) entry = last - buffer;
  if (bias === "Short" && entry < last + buffer) entry = last + buffer;


  // 3. Stop: it has to sit BEYOND the swing that invalidates the idea, not a
  // tight ATR fraction from entry. We take the widest of (a) the zone stop,
  // (b) the model's distance and (c) the last real swing beyond entry, each
  // with a volatility buffer, then clamp to a band wide enough to hold that
  // swing. The floor is session-aware: thin overnight tape needs more room.
  const modelStopDist = Math.abs(entry - stop);
  const zoneStopDist = structuralStop !== null ? Math.abs(entry - structuralStop) : 0;
  const swingStop = swingStopBeyond(bias, entry, atr, snap);
  const swingStopDist = swingStop !== null ? Math.abs(entry - swingStop) : 0;
  // A protected low/high is the level that actually defends the trade: the swing
  // that formed AFTER liquidity was swept. When the 1H break left one behind on
  // our side, the stop must cover it.
  const protectedStop = protectedStopBeyond(bias, entry, atr, snap);
  const protectedStopDist = protectedStop !== null ? Math.abs(entry - protectedStop) : 0;
  const rawStopDist = Math.max(zoneStopDist, swingStopDist, protectedStopDist, zoneStopDist ? 0 : modelStopDist);
  const floor = Math.max(0.3, stopFloorAtr);
  // Cap generously so a genuine swing stop is never pulled in front of the swing.
  const cap = atr * Math.max(3.2, floor + 1.8);
  const stopDist = Math.min(Math.max(rawStopDist || modelStopDist, atr * floor), cap);

  stop = bias === "Long" ? entry - stopDist : entry + stopDist;

  // 4. Targets are market structure, not an R multiple. TP1 is the first level
  // price has to fight through that still pays for the risk; TP2 is the next one
  // beyond it. R:R is only reported, never used to place the target. A flat R
  // multiple is the last resort for instruments with no mapped structure.
  const dir = bias === "Long" ? 1 : -1;
  const levels = findTargetLevels(bias, entry, snap, tradeStyle);
  const reach = atr * reachAtr(snap.interval, tradeStyle);
  // Book just in front of the level, not at it, so the reaction does not eat the fill.
  const skim = Math.max(atr * 0.08, last * 0.0002);
  const minDist = stopDist * (tradeStyle === "scalp" ? 0.8 : tradeStyle === "swing" ? 1.2 : 1.0);

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
  const bosNote = bosThesisNote(bias, snap);
  const thesis = (anchorLabel
    ? `The planned entry is ${fmt(entry, dec)}, anchored to the ${anchorLabel}. The stop is ${fmt(stop, dec)}, giving ${fmt(stopDist, dec)} of risk (${(stopDist / atr).toFixed(2)}x ATR). ${targetNote} Other mapped zones are supporting structure or invalidation unless they contain ${fmt(entry, dec)}.`
    : `${plan.thesis} ${targetNote}`) + (bosNote ? ` ${bosNote}` : "");


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
  tradeStyle: TradeStyle = "intraday",
  modelId: AnalysisModelId = "classic",
): Promise<TradePlan> {


  // Forex Factory calendar feeds the scan decision, not just the chat and the
  // briefings: timing risk is part of whether a setup is worth taking.
  let newsBlock: string | undefined;
  let newsWarning = "";
  let news48Warning = "";
  try {
    const { calendarContextBlock, fetchCalendar, highImpactAhead, currenciesFor } = await import("@/lib/news.server");
    newsBlock = await calendarContextBlock(snap.ticker);
    const wanted = currenciesFor(snap.ticker);
    // The shared calendar helper includes medium-impact events for display.
    // Only genuinely high-impact releases should reduce a setup's grade.
    const cal = await fetchCalendar();
    const soon = highImpactAhead(cal, 4).filter(
      (e) => wanted.includes(e.country.toUpperCase()) && /^high$/i.test(e.impact.trim()),
    );
    const within48 = highImpactAhead(cal, 48).filter(
      (e) => wanted.includes(e.country.toUpperCase()) && /^high$/i.test(e.impact.trim()),
    );
    if (!soon.length && within48.length) {
      const e = within48[0]!;
      const hrs = Math.max(1, Math.round((new Date(e.date).getTime() - Date.now()) / 3600000));
      news48Warning = `News risk: ${e.country} HIGH ${e.title} drops in about ${hrs} hours, so this grade is knocked down one letter. If you are not at TP1 before the release, flatten or cut size - do not hold through high-impact data with full risk.`;
    }
    if (soon.length) {
      const first = soon[0]!;
      const mins = Math.max(0, Math.round((new Date(first.date).getTime() - Date.now()) / 60000));
      newsWarning = ` Timing risk: ${first.country} ${first.impact.toUpperCase()} ${first.title} lands in about ${mins} minutes, so size down or wait for the release to clear.`;
    }
  } catch {
    // calendar unavailable; plan on price structure alone
  }

  // ---- Model routing: The Trading Channel ---------------------------------
  // Model 2 is fed ONLY the Trading Channel rulebook. Its read comes from its
  // own deterministic engine over closed bars (focus-engine.ts); the Classic
  // bias engine, order-block cascade and AI-written levels below do not apply.
  if (modelId === "focus") {
    const focusBars = (snap.candles1h?.length ? snap.candles1h : snap.candles)
      .map((c) => ({ time: c.time, open: c.open, high: c.high, low: c.low, close: c.close }));
    const read = focusAnalysis(focusBars);
    const fDec = decimalsFor(snap.lastPrice || read.lastPrice || 1);
    let fGrade: TradePlan["grade"] = read.grade;
    const fWarnings: string[] = [];
    if (newsWarning && (fGrade === "A" || fGrade === "B")) {
      fGrade = "B";
      fWarnings.push(`High-impact news inside the hold window caps this at B.${newsWarning}`);
    }
    if (news48Warning) fWarnings.push(news48Warning);
    const isNoEntryF = fGrade === "NO ENTRY" || read.entry == null;
    const trendWord = read.trend === "up" ? "bullish" : read.trend === "down" ? "bearish" : "neutral";
    return {
      methodologyVersion: read.rulebookVersion,
      grade: fGrade,
      bias: read.bias,
      confidence: fGrade === "A" ? 80 : fGrade === "B" ? 60 : fGrade === "C" ? 40 : 0,
      notes: `${read.note}${fWarnings.length ? ` ${fWarnings.join(" ")}` : ""}`,
      entry: isNoEntryF ? "-" : fmt(read.entry!, fDec),
      stop: isNoEntryF ? "-" : fmt(read.stop!, fDec),
      tp1: isNoEntryF ? "-" : fmt(read.tp1!, fDec),
      tp2: "-",
      rr: isNoEntryF || read.rr == null ? "-" : `1 : ${read.rr.toFixed(1)}`,
      details: focusContextBlock(read, snap.ticker, snap.interval),
      memo,
      orderFlow: snap.orderFlow,
      dailyBias: trendWord,
      currentTrend: read.trend === "none" ? "range" : read.trend,
      synopsis: read.note,
      dataSource: snap.source,
      dataFetchedAt: snap.fetchedAt,
      candleCount: snap.candles.length,
      refPrice: snap.lastPrice,
      counterTrend: false,
      warnings: fWarnings.length ? fWarnings : undefined,
      tradeStyle,
    };
  }

  // ---- Model routing: Photon Trading ---------------------------------------
  // Model 3 is fed ONLY the Photon market-structure rulebook. Its read comes
  // from its own deterministic engine over closed bars (photon-engine.ts); the
  // Classic bias engine, order-block cascade and AI-written levels below do not
  // apply.
  if (modelId === "photon") {
    const photonBars = (snap.candles1h?.length ? snap.candles1h : snap.candles)
      .map((c) => ({ time: c.time, open: c.open, high: c.high, low: c.low, close: c.close }));
    const read = photonAnalysis(photonBars);
    const pDec = decimalsFor(snap.lastPrice || read.lastPrice || 1);
    let pGrade: TradePlan["grade"] = read.grade;
    const pWarnings: string[] = [];
    if (newsWarning && (pGrade === "A" || pGrade === "B")) {
      pGrade = "B";
      pWarnings.push(`High-impact news inside the hold window caps this at B.${newsWarning}`);
    }
    if (news48Warning) pWarnings.push(news48Warning);
    const isNoEntryP = pGrade === "NO ENTRY" || read.entry == null;
    const trendWord = read.swingTrend === "up" ? "bullish" : read.swingTrend === "down" ? "bearish" : "neutral";
    return {
      methodologyVersion: read.rulebookVersion,
      grade: pGrade,
      bias: read.bias,
      confidence: pGrade === "A" ? 80 : pGrade === "B" ? 60 : pGrade === "C" ? 40 : 0,
      notes: `${read.note}${pWarnings.length ? ` ${pWarnings.join(" ")}` : ""}`,
      entry: isNoEntryP ? "-" : fmt(read.entry!, pDec),
      stop: isNoEntryP ? "-" : fmt(read.stop!, pDec),
      tp1: isNoEntryP ? "-" : fmt(read.tp1!, pDec),
      tp2: "-",
      rr: isNoEntryP || read.rr == null ? "-" : `1 : ${read.rr.toFixed(1)}`,
      details: photonContextBlock(read, snap.ticker, snap.interval),
      memo,
      orderFlow: snap.orderFlow,
      dailyBias: trendWord,
      currentTrend: read.swingTrend === "none" ? "range" : read.swingTrend,
      synopsis: read.note,
      dataSource: snap.source,
      dataFetchedAt: snap.fetchedAt,
      candleCount: snap.candles.length,
      refPrice: snap.lastPrice,
      counterTrend: false,
      warnings: pWarnings.length ? pWarnings : undefined,
      tradeStyle,
    };
  }

  // ---- Model routing: Eric Jablonski ---------------------------------------
  // Model 4 is fed ONLY the opening-range rulebook and decides on closed
  // 15-minute bars (jablonski-engine.ts). The Classic bias engine, order-block
  // cascade and AI-written levels below do not apply.
  if (modelId === "jablonski") {
    const jBars = (snap.candles15m?.length ? snap.candles15m : snap.candles)
      .map((c) => ({ time: c.time, open: c.open, high: c.high, low: c.low, close: c.close }));
    const read = jablonskiAnalysis(jBars, snap.ticker);
    const jDec = decimalsFor(snap.lastPrice || read.lastPrice || 1);
    let jGrade: TradePlan["grade"] = read.grade;
    const jWarnings: string[] = [];
    if (newsWarning && (jGrade === "A" || jGrade === "B")) {
      jGrade = "B";
      jWarnings.push(`High-impact news inside the hold window caps this at B.${newsWarning}`);
    }
    if (news48Warning) jWarnings.push(news48Warning);
    const isNoEntryJ = jGrade === "NO ENTRY" || read.entry == null;
    const trendWordJ = read.bias === "Long" ? "bullish" : read.bias === "Short" ? "bearish" : "neutral";
    return {
      methodologyVersion: read.rulebookVersion,
      grade: jGrade,
      bias: read.bias,
      confidence: jGrade === "A" ? 80 : jGrade === "B" ? 60 : jGrade === "C" ? 40 : 0,
      notes: `${read.note}${jWarnings.length ? ` ${jWarnings.join(" ")}` : ""}`,
      entry: isNoEntryJ ? "-" : fmt(read.entry!, jDec),
      stop: isNoEntryJ ? "-" : fmt(read.stop!, jDec),
      tp1: isNoEntryJ ? "-" : fmt(read.tp1!, jDec),
      tp2: "-",
      rr: isNoEntryJ || read.rr == null ? "-" : `1 : ${read.rr.toFixed(2)}`,
      details: jablonskiContextBlock(read, snap.ticker, snap.interval),
      memo,
      orderFlow: snap.orderFlow,
      dailyBias: trendWordJ,
      currentTrend: read.bias === "Neutral" ? "range" : read.bias === "Long" ? "up" : "down",
      synopsis: read.note,
      dataSource: snap.source,
      dataFetchedAt: snap.fetchedAt,
      candleCount: snap.candles.length,
      refPrice: snap.lastPrice,
      counterTrend: false,
      warnings: jWarnings.length ? jWarnings : undefined,
      tradeStyle,
    };
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
  let profileHint: Awaited<ReturnType<typeof profileHintFor>> = null;
  try {
    profileHint = await profileHintFor(snap.ticker);
  } catch {
    profileHint = null;
  }
  const biasRead = computeBias(snap, "A", tunedCfg ?? undefined, profileHint);
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
    const draft = await runScanModel(apiKey, async (model, modelLabel) => {
      const out = await generateText({
      model,
      output: Output.object({ schema: PlanSchema }),
      system: "You are the head trader. Follow the 'How to Analysis' cascade in the memo: 4H sets DIRECTION + TREND + key levels + supply/demand; 1H reads STRUCTURE (breaks, reversal, OB, FVG, liquidity); 15m gives CONFIRMATION. Grade A+ only when MTF alignment is aligned-long/aligned-short AND 15m confirmation matches. Grade A when alignment is aligned-* with weaker 15m. Grade B when 1H structure and 4H direction agree but 15m is neutral. Grade C when there is a 1H trigger but 4H is against or neutral. NO ENTRY when direction, structure, and confirmation all conflict. Return exactly one flat JSON object, not an array. Grade MUST be one of: A+, A, B, C, NO ENTRY. Bias MUST be Long, Short, or Neutral. ENTRY PRECISION IS THE PRIORITY: the entry must be a specific level, not a round guess near price. Anchor it to an actual level in the memo - a 1H bullish/bearish order block edge, a 1H FVG edge, a 4H demand/supply boundary, a 4H key level, or a resting liquidity pool - on the pullback side of Last and within 2x ATR. Place the stop just beyond the FAR edge of that same zone (0.6-2.5x ATR of risk), never a round ATR multiple pulled out of the air. TP1 should be the first opposing level or liquidity pool that pays at least 1.5R; TP2 the next one or 3R. In the thesis, state the exact level name and price you anchored the entry to. No generic wording. If an ECONOMIC CALENDAR block is present, treat a high-impact release inside the next few hours as timing risk: cap the grade at B and say so in the invalidation. ENTRY RULES: default to entering on the pullback side of price. For a Long setup, entry must be at or below Last unless the prompt explicitly asks for a breakout stop order. For a Short setup, entry must be at or above Last. Prefer entries at 1H order blocks, FVGs, or 4H demand/supply that align with bias. Do not default to BUY STOP or SELL STOP. Never place entry more than 2x ATR from current price. Keep thesis under 400 chars and invalidation under 200 chars. Do NOT state a confidence percentage; conviction is counted from the data by the platform, not asserted by you." + memoryLine,
      prompt: ctx,
    });
      await logPlannerCost("plan-draft", modelLabel, out.usage, out.providerMetadata);
      return out.output;
    });
    plan = draft;

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
    const critique = await runScanModel(apiKey, async (model, modelLabel) => {
      const out = await generateText({
      model,
      output: Output.object({ schema: CritiqueSchema }),
      system: "You are the risk manager. Approve the plan if entry/stop/TP are in sensible relation to price (stop within 3x ATR, TPs on the correct side of entry, R:R >= 1.5). Otherwise say revise. Keep reason under 300 chars.",
      prompt: `${ctx}\n\nProposed plan: ${JSON.stringify(plan)}`,
    });
      await logPlannerCost("plan-critique", modelLabel, out.usage, out.providerMetadata);
      return out.output;
    });

    // Step 3 - refine once if needed
    if (critique.verdict === "revise") {
      try {
        const revised = await runScanModel(apiKey, async (model, modelLabel) => {
          const out = await generateText({
          model,
          output: Output.object({ schema: PlanSchema }),
          system: "You are the head trader. Return exactly one flat JSON object, not an array. Revise the previous plan per the risk manager's note. Grade MUST be one of: A+, A, B, C, NO ENTRY. Bias MUST be Long, Short, or Neutral. Keep bias unless the critique explicitly demands a flip. Keep thesis under 400 chars and invalidation under 200 chars. For Long, entry must be at or below current price by default. For Short, entry must be at or above current price by default. Do not revise into a stop-entry unless the prompt explicitly asks for a breakout order.",
          prompt: `${ctx}\n\nPrevious plan: ${JSON.stringify(plan)}\nRisk manager: ${critique.reason}`,
        });
          await logPlannerCost("plan-revise", modelLabel, out.usage, out.providerMetadata);
          return out.output;
        });
        plan = revised;
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
  const rawResolved = (snap.candles4h?.length ?? 0) >= 20
    ? { bias: engineBias, reason: `bias engine: ${biasRead.result.mtf.reason}` }
    : resolveDirection(snap, memo, "Neutral");
  // Near-term override: when the 1H, the 15m and the order flow ALL point the
  // other way, the old code still printed the higher-timeframe side and let the
  // trader short into a bid. Either the near-term side is the trade (when the 4H
  // is not trending against it) or there is no trade at all - never a fighting
  // one. This is the "why wasn't it a buy where the stop was" case.
  const nearTerm = nearTermOverrideRead(rawResolved.bias, snap);
  const resolved = nearTerm.bias
    ? { bias: nearTerm.bias, reason: nearTerm.reason ?? rawResolved.reason }
    : rawResolved;


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
  finalPlan = sanitizePlan(finalPlan, snap, memo, resolved.bias, stopFloorAtr, tradeStyle);
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
        tradeStyle,
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
  // A high-impact release inside the expected hold window is a hard cap at B,
  // not a one-letter nudge: an A on the card told the trader to hold full risk
  // into CPI, and the stop-hunt before the number is what took the trade out.
  if (newsWarning && (grade === "A+" || grade === "A")) grade = "B";

  // ---- Session filters as hard grade controls ---------------------------
  const warnings: string[] = [];
  const downgradeOne = (g: typeof GRADES[number]): typeof GRADES[number] =>
    g === "A+" ? "A" : g === "A" ? "B" : g === "B" ? "C" : g;

  // FIX 5: a high-impact release inside two days is real event risk even when it
  // is not imminent, so it costs one letter and is stated plainly.
  if (news48Warning) {
    grade = downgradeOne(grade);
    warnings.push(news48Warning);
  }

  // Thin overnight tape used to be a hard NO ENTRY. That is what made gold read
  // "no entry" for two days and hid index setups that ran the moment New York
  // opened. It is a timing problem, so the setup keeps its grade path and levels
  // and only carries the window to wait for. Crypto is exempt entirely: a quiet
  // Tokyo hour on a 24/7 market is not thin participation.
  const gate = timingGateFor(snap.ticker, volRead);
  let timingGate: string | null = null;
  if (gate && grade !== "NO ENTRY") {
    timingGate = gate.message;
    warnings.push(timingGate);
  } else if (volRead?.thin && !gate && grade !== "NO ENTRY" && assetClassFor(snap.ticker) !== "crypto") {
    warnings.push(
      `Thin volume - widen stops or reduce size. ${volRead.label}, so the stop was widened to ${stopFloorAtr.toFixed(1)}x ATR.`,
    );
  }


  // Mitigated order block at the entry: a block price already ran through
  // holds less often, and one tested twice or more usually fails outright.
  let mitigation: MitigatedBlockRead | null = null;
  if (grade !== "NO ENTRY" && bias !== "Neutral") {
    try {
      const blocks = computeOrderBlocks(snap.candles1h?.length ? snap.candles1h : snap.candles, { max: 10 });
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
  const ltfRead = lowerTimeframeOppositionRead(bias, snap);
  const flowRead = orderFlowOppositionRead(bias, snap);
  const deltaRead = deltaAgainstPositionRead(bias, snap);
  const setupRead = setupTypeRead(bias, snap);
  const staleRead = staleHigherTimeframeRead(snap);
  const selectedEntryZone = bias === "Neutral"
    ? null
    : findEntryAnchor(
        bias,
        snap.lastPrice,
        Math.max(snap.stats.atr14 || Math.abs(snap.lastPrice) * 0.002, Math.abs(snap.lastPrice) * 0.0005),
        snap,
      );

  // A means a fully formed top-down setup, not simply a high evidence count.
  // Without a fresh, high-quality 1H block the trade may still be valid, but it
  // cannot be presented as the sniper-grade setup Marcus expects from A.
  if ((grade === "A+" || grade === "A") && selectedEntryZone?.qualityLabel !== "high") {
    grade = "B";
    warnings.push(
      selectedEntryZone
        ? `The selected 1H order block scores ${selectedEntryZone.quality ?? 0}/100 (${selectedEntryZone.qualityLabel ?? "unrated"}), so A is unavailable. Wait for a fresh displacement-backed 1H block with 15m confirmation.`
        : "No valid 1H order block anchors this entry, so A is unavailable. Wait for a fresh displacement-backed 1H block with 15m confirmation.",
    );
  }

  // Full "why is this grade what it is" breakdown: every deterministic cap that
  // fired, plus the engine alignment cap, news risk and session timing, with the
  // binding one marked so the trader sees which single rule is holding it down.
  const gradeCaps: GradeCapReason[] = collectGradeCaps(bias, snap);
  const engineMax = biasRead.result.mtf.maxGrade;
  if (engineMax === "B" || engineMax === "C" || engineMax === "D" || engineMax === "F") {
    gradeCaps.push({
      label: "Timeframe alignment",
      cap: engineMax === "B" ? "B" : "C",
      reason: `Only ${biasRead.result.mtf.alignmentScore} of the 4 higher timeframes agree with this ${bias.toLowerCase()}, so the alignment cap allows ${engineMax === "B" ? "B" : "C"} at best.`,
    });
  }
  if (newsWarning) {
    gradeCaps.push({
      label: "High-impact news inside the hold window",
      cap: "B",
      reason: newsWarning.trim(),
    });
  }
  if (news48Warning) gradeCaps.push({ label: "Event risk within 48 hours", cap: grade, reason: `${news48Warning} This costs one grade letter.` });
  if (timingGate) gradeCaps.push({ label: "Session timing", cap: grade, reason: `${timingGate} This is an execution wait, not a lower-quality structure grade.` });
  if (mitigation?.warning) gradeCaps.push({ label: "Entry zone already tested", cap: grade, reason: mitigation.warning });
  if (selectedEntryZone?.qualityLabel !== "high") {
    gradeCaps.push({
      label: "1H order-block quality",
      cap: "B",
      reason: selectedEntryZone
        ? `The selected 1H zone scores ${selectedEntryZone.quality ?? 0}/100 (${selectedEntryZone.qualityLabel ?? "unrated"}). A requires a fresh, displacement-backed 1H order block aligned with the 4H.`
        : "No valid 1H order block anchors the entry. A requires a fresh, displacement-backed 1H order block aligned with the 4H.",
    });
  }
  const capOrder: string[] = ["NO ENTRY", "C", "B", "A", "A+"];
  for (const c of gradeCaps) c.binding = c.cap === grade && capOrder.indexOf(c.cap) <= capOrder.indexOf(grade);

  const triggerRead = entryTriggerRead(
    bias,
    snap,
    Math.max(snap.stats.atr14 || Math.abs(snap.lastPrice) * 0.002, Math.abs(snap.lastPrice) * 0.0005),
    tradeStyle,
    isNoEntry ? null : finalPlan.entry,
  );
  const setupFlags = [
    setupRead.type === "fade" ? "COUNTER_TREND_FADE" : null,
    setupRead.type === "reversal" ? "HTF_REVERSAL" : null,
    deltaRead.cap ? "ORDER_FLOW_AGAINST_POSITION" : null,
    staleRead.cap ? "STALE_DATA_4H_CANDLE_CLOSED" : null,
    news48Warning ? "HIGH_IMPACT_NEWS_RISK" : null,
    !triggerRead.triggered && bias !== "Neutral" ? "NOT_TRIGGERED_YET" : null,
  ].filter((f): f is string => Boolean(f));

  // `notes` already carries the thesis ("why take this trade"), so the details
  // block must NOT repeat it. It is the read-out of the evidence itself:
  // market structure, order flow and volume, volatility and levels, then a
  // short takeaway in the active coach's voice, then trade management.
  const dataNote = (snap.mtf
    ? ""
    : " Higher-timeframe data was incomplete on this scan, so the grade is capped at C until the feed fills in.")
    + (nearTerm.bias && nearTerm.reason ? ` Direction check - ${nearTerm.reason}` : "")
    + (counterTrend.reason ? ` ${counterTrend.reason}` : "")

    + (comboGate.reason ? ` ${comboGate.reason}` : "")
    + (ltfRead.reason ? ` ${ltfRead.reason}` : "")
    + (flowRead.reason ? ` ${flowRead.reason}` : "")
    + (deltaRead.reason ? ` ${deltaRead.reason}` : "")
    + (setupRead.reason ? ` ${setupRead.reason}` : "")
    + (staleRead.reason ? ` ${staleRead.reason}` : "")
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
    // The opposite scenario has to be stated up front, not buried: this is what
    // the trader needed on the USD/JPY fade that stopped out.
    + (setupRead.reason ? ` ${setupRead.reason}` : "")
    + (staleRead.reason ? ` ${staleRead.reason}` : "")
    + (!triggerRead.triggered && triggerRead.rule ? ` ${triggerRead.rule}` : "")
    + newsWarning
    + (timingGate ? ` ${timingGate}` : warnings.length ? ` ${warnings[0]}` : "");

  // ---- Scanner Program v1, in shadow -----------------------------------
  // The program scores six evidence families instead of counting sixteen ticks,
  // and assigns a band by percentile with a sample gate. It does NOT publish the
  // grade yet: it records what it would have said next to what was published, so
  // the drop in signal volume is measured before any trader sees it. Failures
  // here can never affect the scan.
  // Awaited, not fired and forgotten: the server runtime cancels pending work once
  // the response is sent, which is why the shadow table was still empty after this
  // shipped. The whole calibration plan depends on these rows existing.
  if (bias !== "Neutral" && !isNoEntry) {
    await (async () => {
      try {
        const bos = snap.mtf?.h1.bos;
        const { toProgramInput } = await import("@/lib/scanner/adapter");
        const { runScannerProgram, recordProgramScore } = await import("@/lib/scanner/program.server");
        const result = await runScannerProgram(toProgramInput({
          symbol: snap.ticker,
          timeframe: snap.interval,
          bias,
          lastPrice: snap.lastPrice,
          entry: finalPlan.entry,
          stop: finalPlan.stop,
          tp1: finalPlan.tp1,
          ladder,
          h4Direction: snap.mtf?.h4.direction,
          h4Trend: snap.mtf?.h4.trend,
          h1StructureBreak: snap.mtf?.h1.structureBreak,
          m15Confirmation: snap.mtf?.m15.confirmation,
          cisdState: snap.cisd.state,
          closed4hCandles: snap.candles.length,
          entryZoneQuality: selectedEntryZone?.quality ?? null,
          hasOrderBlock: !!selectedEntryZone,
          hasHtfZone: hasAlignedZone(bias, snap),
          protectedBreak: bos ? bos.quality === "protected" : null,
          sweptLiquidity: bos ? bos.quality === "protected" : undefined,
          cvd: snap.orderFlow?.cvd ?? null,
          delta: snap.orderFlow?.delta ?? null,
          priceVsPoc: snap.orderFlow?.priceVsPoc ?? null,
          volumeRatio: volRead?.ratio ?? null,
          thinVolume: volRead?.thin,
          newsInHoldWindow: !!newsWarning,
          news48h: !!news48Warning,
          staleHtf: !!staleRead.cap,
          triggered: triggerRead.triggered,
          targetRoomOk: true,
        }));
        await recordProgramScore({
          result,
          timeframe: snap.interval,
          bias,
          publishedGrade: grade,
          shadow: true,
        });
      } catch { /* shadow scoring must never affect a scan */ }
    })();
  }

  return {
    methodologyVersion: SCANNER_METHODOLOGY_VERSION,
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
    trendRelation: classifyTrendRelation({
      bias,
      dailyBias,
      h4Direction: snap.mtf?.h4.direction ?? currentTrend,
    }),
    gradeCaps: gradeCaps.length ? gradeCaps : undefined,

    setupType: setupRead.type,
    flipLevel: setupRead.flipLevel ?? undefined,
    triggered: bias === "Neutral" ? undefined : triggerRead.triggered,
    triggerLevel: triggerRead.level ?? undefined,
    triggerRule: triggerRead.rule ?? undefined,
    flags: setupFlags.length ? setupFlags : undefined,
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
    entryZone: selectedEntryZone?.top != null && selectedEntryZone.bottom != null
      ? {
          label: selectedEntryZone.label,
          top: selectedEntryZone.top,
          bottom: selectedEntryZone.bottom,
          quality: selectedEntryZone.quality ?? 0,
          qualityLabel: selectedEntryZone.qualityLabel ?? "low",
          distanceAtr: selectedEntryZone.distanceAtr ?? 0,
        }
      : undefined,
    tradeStyle,
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
      of.deltaConflict
        ? `Delta is ${of.delta >= 0 ? "+" : ""}${of.delta.toFixed(0)} against a ${of.deltaAvg.toFixed(0)} average while CVD over the last ${of.bars} bars is ${of.cvdSlope >= 0 ? "rising" : "falling"} - the live bar and the cumulative read disagree, so flow is confirming nothing here and cannot be counted as support for this side.`
        : `Delta is ${of.delta >= 0 ? "+" : ""}${of.delta.toFixed(0)} against a ${of.deltaAvg.toFixed(0)} average and CVD is ${of.cvdSlope >= 0 ? "rising" : "falling"}, so ${of.delta >= 0 ? "buyers" : "sellers"} are the ones paying up on the live bar over the last ${of.bars} bars.`,
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
