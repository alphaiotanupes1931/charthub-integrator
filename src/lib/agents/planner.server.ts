// Layer 3 - Planner. Paperclip-style plan → critique → refine loop (max 2 iterations)
// that consumes a ResearchMemo + MarketSnapshot and produces a concrete TradePlan.

import { generateText, Output, NoObjectGeneratedError } from "ai";
import { z } from "zod";
import { createAiGatewayProvider } from "@/lib/ai-gateway.server";
import type { MarketSnapshot, ResearchMemo, TradePlan } from "./types";
import { formatOrderFlow } from "./order-flow.server";

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

function systematicPlan(snap: MarketSnapshot, memo: ResearchMemo, thesisPrefix?: string): RawPlan {
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
  const bias: RawPlan["bias"] = directional === "bullish" ? "Long" : directional === "bearish" ? "Short" : "Neutral";
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

// Pick the first opposing level/liquidity pool beyond entry as a realistic TP1,
// so targets sit where price actually reacts rather than at a flat 1.5R.
function findTargetLevel(bias: "Long" | "Short", entry: number, snap: MarketSnapshot): number | null {
  const m = snap.mtf;
  if (!m) return null;
  const pool = bias === "Long"
    ? [...m.h4.keyLevels.resistance, ...m.h1.liquidity.buyside, ...m.h4.supplyDemand.supply.map((z) => Math.min(z[0], z[1]))]
    : [...m.h4.keyLevels.support, ...m.h1.liquidity.sellside, ...m.h4.supplyDemand.demand.map((z) => Math.max(z[0], z[1]))];
  const beyond = pool.filter((p) => Number.isFinite(p) && p > 0 && (bias === "Long" ? p > entry : p < entry));
  if (!beyond.length) return null;
  return bias === "Long" ? Math.min(...beyond) : Math.max(...beyond);
}

// Sanity-check the model's plan against price/ATR so we don't ship bad pending
// orders. The default scan experience should not hand older traders a breakout
// stop order when price has not actually reached the setup yet.
function sanitizePlan(plan: RawPlan, snap: MarketSnapshot, memo: ResearchMemo): RawPlan {
  const last = snap.lastPrice;
  const atr = Math.max(snap.stats.atr14 || Math.abs(last) * 0.002, Math.abs(last) * 0.0005);
  const bias = normalizeBias(plan.bias);
  if (bias === "Neutral" || !isFinite(last) || last <= 0) return plan;

  let { entry, stop, tp1, tp2 } = plan;
  if (![entry, stop, tp1, tp2].every((n) => Number.isFinite(n) && n > 0)) {
    return systematicPlan(snap, memo, "Model returned invalid numbers; using systematic plan.");
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
  // a sane ATR band so risk is always measurable.
  const modelStopDist = Math.abs(entry - stop);
  const rawStopDist = structuralStop !== null ? Math.abs(entry - structuralStop) : modelStopDist;
  const stopDist = Math.min(Math.max(rawStopDist, atr * 0.6), atr * 2.5);
  stop = bias === "Long" ? entry - stopDist : entry + stopDist;

  // 4. Targets: use the first opposing structure level if it pays at least 1.2R,
  // otherwise fall back to fixed R multiples.
  const levelTarget = findTargetLevel(bias, entry, snap);
  const levelR = levelTarget !== null ? Math.abs(levelTarget - entry) / stopDist : 0;
  if (bias === "Long") {
    tp1 = levelTarget !== null && levelR >= 1.2 && levelR <= 4
      ? levelTarget
      : entry + stopDist * 1.5;
    tp2 = Math.max(tp1 + stopDist * 1.2, entry + stopDist * 3);
  } else {
    tp1 = levelTarget !== null && levelR >= 1.2 && levelR <= 4
      ? levelTarget
      : entry - stopDist * 1.5;
    tp2 = Math.min(tp1 - stopDist * 1.2, entry - stopDist * 3);
  }

  const dec = decimalsFor(last);
  const thesis = anchorLabel
    ? `${plan.thesis} Entry refined to the ${anchorLabel} at ${fmt(entry, dec)}; stop sits ${fmt(stopDist, dec)} beyond it (${(stopDist / atr).toFixed(2)}x ATR).`
    : plan.thesis;

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

  const ctx = memoBlock(memo, snap, lensDesc, strategyDesc, perfDesc, scoreDesc) + (newsBlock ? `\n\n${newsBlock}` : "");
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
  const resolved = resolveDirection(snap, memo, normalizeBias(plan.bias));

  let finalPlan =
    resolved.bias !== "Neutral" && normalizeBias(plan.bias) !== resolved.bias
      ? systematicPlan(snap, memo, `Direction taken from measured structure (${resolved.reason});`)
      : plan;
  finalPlan = sanitizePlan(finalPlan, snap, memo);

  const bias = resolved.bias;
  const dec = decimalsFor(snap.lastPrice || finalPlan.entry || 1);
  const risk = Math.abs(finalPlan.entry - finalPlan.stop) || 1;
  const reward = Math.abs(finalPlan.tp2 - finalPlan.entry);
  const rr = `1 : ${(reward / risk).toFixed(1)}`;

  // Conviction is counted from evidence that is actually present in the data.
  const confidence = bias === "Neutral" ? 0 : countEvidence(snap, memo, "B", bias, reward / risk);
  let grade = gradeFromEvidence(bias, confidence, snap);
  // Calendar risk is measurable and therefore remains a valid hard cap. The
  // user's scorecard cap is applied by the authenticated server-function
  // wrapper after this planner returns.
  if (newsWarning) {
    if (grade === "A+") grade = "A";
    else if (grade === "A") grade = "B";
  }
  const isNoEntry = grade === "NO ENTRY";

  // `notes` already carries the thesis ("why take this trade"), so the details
  // block must NOT repeat it. It is the read-out of the evidence itself:
  // market structure, order flow and volume, volatility and levels, then a
  // short takeaway in the active coach's voice, then trade management.
  const dataNote = snap.mtf
    ? ""
    : " Higher-timeframe data was incomplete on this scan, so the grade is capped at C until the feed fills in.";
  const details = buildDetails(snap, memo, finalPlan, dec, coach, bias, grade, newsWarning, dataNote);





  // Daily bias sets the day's direction; 4H is the current trend. They can
  // disagree (price rallying up into a daily sell zone), which is exactly what
  // the trader needs to see.
  const ladder = snap.mtf?.ladder ?? [];
  const dailyBias = ladder.find((r) => r.label === "Daily")?.bias ?? snap.cisd.htfBias;
  const currentTrend = ladder.find((r) => r.label === "4H")?.trend ?? snap.mtf?.h4.trend ?? "range";
  const synopsis = buildSynopsis(snap, memo, grade, bias, dailyBias, currentTrend) + newsWarning;

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
    orderFlow: snap.orderFlow,
    dailyBias,
    currentTrend,
    synopsis,
    dataSource: snap.source,
    dataFetchedAt: snap.fetchedAt,
    candleCount: snap.candles.length,
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
    const ob = bias === "Short" ? h1.orderBlocks.bear[0] : h1.orderBlocks.bull[0];
    const fvg = bias === "Short" ? h1.fvg.bear[0] : h1.fvg.bull[0];
    structure.push(
      `1H structure break is ${h1.structureBreak}, reversal signal ${h1.reversal}, nearest ${bias === "Short" ? "bearish" : "bullish"} order block ${ob ? `${fmt(ob[0], dec)}-${fmt(ob[1], dec)}` : "none"} and FVG ${fvg ? `${fmt(fvg[0], dec)}-${fmt(fvg[1], dec)}` : "none"}.`,
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
    sections.push(`Order flow and volume: ${flow.join(" ")} Net order-flow bias is ${of.bias}.`);
  } else {
    sections.push("Order flow and volume: no volume data was published for this instrument on this timeframe, so the grade leans entirely on structure.");
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
