import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { TradePlan } from "@/lib/agents/types";
import { normalizeScanLevels } from "@/lib/scan-log.shared";

export async function logAutopilotEvaluation(client: SupabaseClient<Database>, userId: string, symbol: string, timeframe: string,
  plan: TradePlan, levels: { entry: number | null; stop: number | null; tp1: number | null; tp2: number | null }, riskAmount: number) {
  const normalized = normalizeScanLevels({ ...levels, bias: plan.bias, grade: plan.grade });
  const { data, error } = await client.from("scan_log").insert({
    user_id: userId, source: "autopilot", symbol, timeframe,
    data_feed: plan.liquidityDraw?.feed ?? plan.dataSource ?? null,
    ref_price: plan.refPrice ?? null, grade: plan.grade, confidence: plan.confidence,
    bias: normalized.bias, entry: normalized.entry, stop: normalized.stop, tp1: normalized.tp1, tp2: normalized.tp2,
    status: normalized.status, reason: plan.notes, methodology_version: plan.methodologyVersion,
    entry_model: plan.entryModel ?? null, liquidity_draw: plan.liquidityDraw as never ?? null,
    grade_caps: plan.gradeCaps as never ?? null,
    hypothetical_risk_amount: riskAmount > 0 ? riskAmount : null,
    refused_reason: normalized.directional ? (plan.triggered === false ? plan.triggerRule ?? "Waiting for entry confirmation" : null) : plan.notes,
  } as never).select("id").single();
  if (error || !data) throw new Error("Autopilot evaluation could not be saved; no order issued");
  return data.id;
}