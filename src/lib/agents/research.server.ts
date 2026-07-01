// Layer 2 orchestrator — runs analysts in parallel and merges into a ResearchMemo.

import type { MarketSnapshot, ResearchMemo, AnalystNote } from "./types";
import { technicalAnalyst, macroAnalyst, sentimentAnalyst, riskAnalyst } from "./analysts";

function consensus(notes: AnalystNote[]): { bias: ResearchMemo["consensus"]; confidence: number } {
  // Weight technical highest, then macro, then sentiment; risk excluded from directional vote.
  const weights: Record<AnalystNote["role"], number> = { technical: 3, macro: 2, sentiment: 1, risk: 0 };
  let score = 0, total = 0;
  for (const n of notes) {
    const w = weights[n.role] * (n.confidence / 100);
    total += w;
    if (n.bias === "bullish") score += w;
    else if (n.bias === "bearish") score -= w;
  }
  if (total === 0) return { bias: "neutral", confidence: 0 };
  const norm = score / total; // -1..1
  const bias: ResearchMemo["consensus"] = norm > 0.25 ? "bullish" : norm < -0.25 ? "bearish" : "neutral";
  const confidence = Math.round(Math.min(100, Math.abs(norm) * 100 + 30));
  return { bias, confidence };
}

export async function runResearch(apiKey: string, snap: MarketSnapshot): Promise<ResearchMemo> {
  const risk = riskAnalyst(snap);
  const [tech, macro, sent] = await Promise.all([
    technicalAnalyst(apiKey, snap).catch((): AnalystNote => ({ role: "technical", bias: "neutral", confidence: 0, summary: "Technical analyst unavailable." })),
    macroAnalyst(apiKey, snap).catch((): AnalystNote => ({ role: "macro", bias: "neutral", confidence: 0, summary: "Macro analyst unavailable." })),
    sentimentAnalyst(apiKey, snap).catch((): AnalystNote => ({ role: "sentiment", bias: "neutral", confidence: 0, summary: "Sentiment analyst unavailable." })),
  ]);
  const notes = [tech, macro, sent, risk];
  const c = consensus(notes);
  return {
    ticker: snap.ticker,
    interval: snap.interval,
    generatedAt: new Date().toISOString(),
    notes,
    consensus: c.bias,
    consensusConfidence: c.confidence,
  };
}
