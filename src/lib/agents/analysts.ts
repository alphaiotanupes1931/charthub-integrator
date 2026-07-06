// Layer 2 - analyst personas. Each returns an AnalystNote.
// Technical / Sentiment / Macro use the AI gateway; Risk is pure code.

import { generateText, Output, NoObjectGeneratedError } from "ai";
import { z } from "zod";
import { createAiGatewayProvider } from "@/lib/ai-gateway.server";
import type { AnalystNote, MarketSnapshot } from "./types";

const MODEL = "google/gemini-3-flash-preview";

// No .min/.max bounds - schema-level constraints cause NoObjectGeneratedError
// when the model exceeds them, collapsing every analyst to neutral/0 and
// forcing the planner into NO ENTRY. Bounds are stated in the prompt and
// clamped in code below.
const NoteSchema = z.object({
  bias: z.unknown().optional(),
  confidence: z.unknown().optional(),
  confidence_score: z.unknown().optional(),
  summary: z.unknown().optional(),
  analysis: z.unknown().optional(),
  keyLevels: z.unknown().optional(),
  levels: z.unknown().optional(),
}).passthrough();

type RawNote = z.infer<typeof NoteSchema>;

function textOf(v: unknown): string {
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return v.map(textOf).filter(Boolean).join(" ");
  if (v && typeof v === "object") return Object.values(v as Record<string, unknown>).map(textOf).filter(Boolean).join(" ");
  return "";
}

function normalizeBias(raw: unknown, snap: MarketSnapshot): AnalystNote["bias"] {
  const text = textOf(raw).toLowerCase();
  const bullish = /bull|long|upside|risk-on|strength/.test(text);
  const bearish = /bear|short|downside|risk-off|weakness|reversal/.test(text);
  if (bullish && !bearish) return "bullish";
  if (bearish && !bullish) return "bearish";
  if (snap.cisd.state === "bullish" && snap.cisd.htfBias === "bullish") return "bullish";
  if (snap.cisd.state === "bearish" && snap.cisd.htfBias === "bearish") return "bearish";
  if (snap.cisd.state !== "none") return snap.cisd.state;
  return "neutral";
}

function normalizeConfidence(raw: unknown, bias: AnalystNote["bias"], body: string, snap: MarketSnapshot): number {
  const parsed = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw.replace(/[^0-9.\-]/g, "")) : NaN;
  if (Number.isFinite(parsed)) {
    const scaled = parsed > 0 && parsed <= 1 ? parsed * 100 : parsed;
    return Math.max(0, Math.min(100, Math.round(scaled)));
  }
  const low = body.toLowerCase();
  if (/strong|decisive|confirmed|clear/.test(low)) return bias === "neutral" ? 45 : 72;
  if (/moderate|developing|potential/.test(low)) return bias === "neutral" ? 40 : 62;
  if (/weak|conflicting|mixed|thin/.test(low)) return bias === "neutral" ? 35 : 52;
  if (snap.cisd.state !== "none") return snap.cisd.state === snap.cisd.htfBias ? 68 : 56;
  return bias === "neutral" ? 35 : 55;
}

function extractSummary(raw: RawNote): string {
  const direct = textOf(raw.summary).trim();
  if (direct) return direct.slice(0, 600);
  const body = textOf(raw.analysis || raw).trim();
  return (body || "Analyst read generated from the current market snapshot.").slice(0, 600);
}

function extractLevels(raw: RawNote): number[] | undefined {
  const nums: number[] = [];
  const visit = (v: unknown) => {
    if (nums.length >= 6) return;
    if (typeof v === "number" && Number.isFinite(v)) nums.push(v);
    else if (typeof v === "string") {
      const n = Number(v.replace(/[^0-9.\-]/g, ""));
      if (Number.isFinite(n)) nums.push(n);
    } else if (Array.isArray(v)) v.forEach(visit);
    else if (v && typeof v === "object") Object.values(v as Record<string, unknown>).forEach(visit);
  };
  visit(raw.keyLevels ?? raw.levels);
  return nums.length ? nums.slice(0, 6) : undefined;
}

function salvageNoteFromText(text: string | undefined): RawNote | null {
  if (!text) return null;
  const cleaned = text.replace(/```json/gi, "```").replace(/```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try { return NoteSchema.parse(JSON.parse(cleaned.slice(start, end + 1))); }
  catch { return null; }
}

function buildContext(snap: MarketSnapshot): string {
  return [
    `Symbol: ${snap.ticker} | Interval: ${snap.interval} | Source: ${snap.source}`,
    `Last: ${snap.lastPrice} | 24h change: ${snap.stats.changePct24h.toFixed(2)}%`,
    `Range20: ${snap.stats.low20} - ${snap.stats.high20} (${snap.stats.range20Pct.toFixed(2)}%)`,
    `Range50: ${snap.stats.low50} - ${snap.stats.high50}`,
    `ATR14: ${snap.stats.atr14.toFixed(4)}`,
    `CISD: state=${snap.cisd.state} htf=${snap.cisd.htfBias} level=${snap.cisd.level} trigger=${snap.cisd.trigger} proj1=${snap.cisd.proj1}`,
    `Sessions active: ${snap.sessionsActive.join(", ") || "off-hours"}`,
    `Fetched: ${snap.fetchedAt}`,
  ].join("\n");
}

async function askAnalyst(apiKey: string, system: string, snap: MarketSnapshot): Promise<Omit<AnalystNote, "role">> {
  const provider = createAiGatewayProvider(apiKey);
  let output: RawNote;
  try {
    const result = await generateText({
      model: provider(MODEL),
      output: Output.object({ schema: NoteSchema }),
      system: `${system} Return exactly one flat JSON object with keys: bias (bullish, bearish, or neutral), confidence (0-100), summary (one sentence), keyLevels (numbers). Do not nest the answer.`,
      prompt: buildContext(snap),
    });
    output = result.output;
  } catch (e) {
    if (!NoObjectGeneratedError.isInstance(e)) throw e;
    output = salvageNoteFromText(e.text) ?? { bias: snap.cisd.state, confidence: snap.cisd.state === "none" ? 35 : 55, summary: e.text ?? "Analyst output could not be structured." };
  }
  const body = textOf(output);
  const bias = normalizeBias(output.bias ?? output, snap);
  const confidence = normalizeConfidence(output.confidence ?? output.confidence_score, bias, body, snap);
  return { bias, confidence, summary: extractSummary(output), keyLevels: extractLevels(output) };
}

export async function technicalAnalyst(apiKey: string, snap: MarketSnapshot): Promise<AnalystNote> {
  const note = await askAnalyst(
    apiKey,
    "You are a technical analyst. Use only the numeric context provided (price, ranges, ATR, CISD, HTF bias). No fluff. Give a directional read with 2-3 concrete levels.",
    snap,
  );
  return { role: "technical", ...note };
}

export async function macroAnalyst(apiKey: string, snap: MarketSnapshot): Promise<AnalystNote> {
  const note = await askAnalyst(
    apiKey,
    "You are a macro analyst. Infer likely macro drivers for this symbol given the recent range and 24h change. Note DXY / yields / risk-on-off implication in one sentence. Keep confidence modest unless the move is decisive.",
    snap,
  );
  return { role: "macro", ...note };
}

export async function sentimentAnalyst(apiKey: string, snap: MarketSnapshot): Promise<AnalystNote> {
  // No live news feed yet - treat momentum + range compression as a proxy.
  const note = await askAnalyst(
    apiKey,
    "You are a sentiment analyst. Since no live news feed is wired, infer positioning from price momentum, 24h change, and range compression. Say clearly if signal is weak.",
    snap,
  );
  return { role: "sentiment", ...note };
}

export function riskAnalyst(snap: MarketSnapshot): AnalystNote {
  const atr = snap.stats.atr14;
  const last = snap.lastPrice || 1;
  const atrPct = (atr / last) * 100;
  const wideRange = snap.stats.range20Pct > 3;
  const offHours = snap.sessionsActive.length === 0;
  let confidence = 65;
  const parts: string[] = [];
  if (atrPct > 1.5) { parts.push(`ATR is ${atrPct.toFixed(2)}% of price - volatile, size down.`); confidence -= 10; }
  else if (atrPct < 0.2) { parts.push(`ATR is only ${atrPct.toFixed(2)}% of price - thin range, stops can get spiked.`); confidence -= 5; }
  else parts.push(`ATR is ${atrPct.toFixed(2)}% of price - normal volatility.`);
  if (wideRange) parts.push(`20-bar range is ${snap.stats.range20Pct.toFixed(1)}% - expect follow-through swings.`);
  if (offHours) { parts.push("Off-hours: liquidity is thin, spreads wider."); confidence -= 10; }
  const bias: AnalystNote["bias"] = atrPct > 2 ? "bearish" : "neutral"; // risk-only, not directional
  return {
    role: "risk",
    bias,
    confidence: Math.max(30, confidence),
    summary: parts.join(" "),
    keyLevels: [Number((last - atr).toFixed(4)), Number((last + atr).toFixed(4))],
  };
}
