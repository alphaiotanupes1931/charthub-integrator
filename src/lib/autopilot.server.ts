// Server-only autopilot helpers: turn the scan stack into concrete trade
// proposals and size them against the trader's risk rails.
import { getSnapshot } from "@/lib/agents/market-data.server";
import { runResearch } from "@/lib/agents/research.server";
import { runPlanner } from "@/lib/agents/planner.server";
import type { AutopilotSettings } from "@/lib/autopilot.shared";

export type ProposalDraft = {
  symbol: string;
  timeframe: string;
  side: "long" | "short";
  grade: string;
  confidence: number;
  entry: number;
  stopLoss: number | null;
  takeProfit: number | null;
  units: number | null;
  reasoning: string;
};

export function parseLevel(text: string | null | undefined): number | null {
  if (text == null) return null;
  const m = String(text).replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : null;
}

// Risk-based sizing: units such that a stop-out costs riskPct of equity.
export function sizeUnits(equity: number, riskPct: number, entry: number, stop: number | null): number | null {
  if (!stop || !Number.isFinite(stop) || stop === entry) return null;
  const riskAmount = (equity * riskPct) / 100;
  const perUnit = Math.abs(entry - stop);
  if (perUnit <= 0) return null;
  const units = riskAmount / perUnit;
  if (!Number.isFinite(units) || units <= 0) return null;
  return Math.max(1, Math.floor(units));
}

export async function buildProposalDraft(
  apiKey: string,
  symbol: string,
  timeframe: string,
  settings: AutopilotSettings,
  equity: number,
): Promise<ProposalDraft | null> {
  const snap = await getSnapshot(symbol, timeframe);
  if (snap.source === "unavailable" || snap.candles.length < 20) return null;

  const memo = await runResearch(apiKey, snap);
  const plan = await runPlanner(apiKey, snap, memo);
  if (plan.bias === "Neutral" || plan.grade === "NO ENTRY") return null;

  const entry = parseLevel(plan.entry);
  if (entry === null) return null;
  const stopLoss = parseLevel(plan.stop);
  const takeProfit = parseLevel(plan.tp1);

  return {
    symbol,
    timeframe,
    side: plan.bias === "Long" ? "long" : "short",
    grade: String(plan.grade),
    confidence: Number(plan.confidence) || 0,
    entry,
    stopLoss,
    takeProfit,
    units: sizeUnits(equity, settings.riskPct, entry, stopLoss),
    reasoning: plan.notes ?? "",
  };
}
