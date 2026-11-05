import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

/** Authoritative owner-scoped saved scan, never a visitor-supplied multiplier. */
export async function savedDrawRisk(client: SupabaseClient<Database>, userId: string, symbol: string | undefined, entry: number, stop: number): Promise<number> {
  if (!symbol) return 1;
  const { data, error } = await client.from("scan_log").select("entry_model, entry, stop, liquidity_draw, created_at")
    .eq("user_id", userId).eq("symbol", symbol).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error("Could not verify scan risk. Rescan before placing this trade.");
  if (data?.entry_model !== "liquidity_draw_proximal") return 1;
  const draw = data.liquidity_draw as { sizeMultiplier?: number } | null;
  const tolerance = Math.max(Math.abs(entry) * 0.000001, 0.00001);
  if (Math.abs(Number(data.entry) - entry) > tolerance || Math.abs(Number(data.stop) - stop) > tolerance ||
      Date.now() - Date.parse(data.created_at) > 3600000 || !draw || ![0.25, 0.5, 1].includes(draw.sizeMultiplier ?? 0)) {
    throw new Error("The saved draw setup no longer matches this order. Rescan before placing it.");
  }
  return draw.sizeMultiplier ?? 1;
}