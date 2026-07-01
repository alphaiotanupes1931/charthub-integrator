// Layer 2 — analyst personas. Each returns an AnalystNote.
// Technical / Sentiment / Macro use the AI gateway; Risk is pure code.

import { generateText, Output } from "ai";
import { z } from "zod";
import { createAiGatewayProvider } from "@/lib/ai-gateway.server";
import type { AnalystNote, MarketSnapshot } from "./types";

const MODEL = "google/gemini-3-flash-preview";

const NoteSchema = z.object({
  bias: z.enum(["bullish", "bearish", "neutral"]),
  confidence: z.number().min(0).max(100),
  summary: z.string().min(10).max(600),
  keyLevels: z.array(z.number()).max(6).optional(),
});

function buildContext(snap: MarketSnapshot): string {
  return [
    `Symbol: ${snap.ticker} | Interval: ${snap.interval} | Source: ${snap.source}`,
    `Last: ${snap.lastPrice} | 24h change: ${snap.stats.changePct24h.toFixed(2)}%`,
    `Range20: ${snap.stats.low20} – ${snap.stats.high20} (${snap.stats.range20Pct.toFixed(2)}%)`,
    `Range50: ${snap.stats.low50} – ${snap.stats.high50}`,
    `ATR14: ${snap.stats.atr14.toFixed(4)}`,
    `CISD: state=${snap.cisd.state} htf=${snap.cisd.htfBias} level=${snap.cisd.level} trigger=${snap.cisd.trigger} proj1=${snap.cisd.proj1}`,
    `Sessions active: ${snap.sessionsActive.join(", ") || "off-hours"}`,
    `Fetched: ${snap.fetchedAt}`,
  ].join("\n");
}

async function askAnalyst(apiKey: string, system: string, snap: MarketSnapshot): Promise<Omit<AnalystNote, "role">> {
  const provider = createAiGatewayProvider(apiKey);
  const { output } = await generateText({
    model: provider(MODEL),
    output: Output.object({ schema: NoteSchema }),
    system,
    prompt: buildContext(snap),
  });
  return {
    bias: output.bias,
    confidence: Math.round(output.confidence),
    summary: output.summary,
    keyLevels: output.keyLevels,
  };
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
  // No live news feed yet — treat momentum + range compression as a proxy.
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
  if (atrPct > 1.5) { parts.push(`ATR is ${atrPct.toFixed(2)}% of price — volatile, size down.`); confidence -= 10; }
  else if (atrPct < 0.2) { parts.push(`ATR is only ${atrPct.toFixed(2)}% of price — thin range, stops can get spiked.`); confidence -= 5; }
  else parts.push(`ATR is ${atrPct.toFixed(2)}% of price — normal volatility.`);
  if (wideRange) parts.push(`20-bar range is ${snap.stats.range20Pct.toFixed(1)}% — expect follow-through swings.`);
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
