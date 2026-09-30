// Spec 2, Fix 5: Wyckoff context layer. Pure. Labels only, soft policy.
//
// Phase letters follow the one definition in the product (spec2.WYCKOFF_PHASES):
// A-E are stages inside ONE trading range, never the market cycle.
// v1 policy: a setup that opposes context_direction is capped one letter lower;
// agreement or unknown changes nothing. No hard block until the pooled backtest
// supports one. Climax (SC/BC) needs session-matched tick volume and is left out
// of v1; the range comes from the established base instead.

import { readWyckoff, type WyCandle } from "@/lib/wyckoff/engine";
import type { GradeCap } from "@/lib/spec2";

export type WyEventType = "SC" | "AR" | "ST" | "SPRING" | "SOS" | "LPS" | "BC" | "UT" | "UTAD" | "SOW" | "LPSY";

export type WyckoffContext = {
  schematic: "accumulation" | "distribution" | "reaccumulation" | "redistribution" | "trending" | "none";
  phase: "A" | "B" | "C" | "D" | "E" | "unknown";
  range: { high: number; low: number; start: number } | null;
  events: Array<{ type: WyEventType; price: number; time: number; confidence: "low" | "medium" }>;
  contextDirection: "long_bias" | "short_bias" | "neutral";
  rationale: string;
};

const MAP: Record<string, WyEventType> = { spring: "SPRING", upthrust: "UTAD", sos: "SOS", sow: "SOW", lps: "LPS", lpsy: "LPSY" };

export function readWyckoffContext(candles: WyCandle[], priorTrend?: "up" | "down" | "range"): WyckoffContext {
  const p = readWyckoff(candles);
  if (p.range.width <= 0) {
    return { schematic: "none", phase: "unknown", range: null, events: [], contextDirection: "neutral", rationale: "Phase unknown: not enough closed bars." };
  }
  const events = p.events.map((e) => ({ type: MAP[e.kind], price: e.level, time: e.time, confidence: "low" as const }));
  const has = (t: WyEventType) => events.some((e) => e.type === t);
  const last = p.lastPrice;
  const { high, low, width } = p.range;
  const start = candles.length ? candles[Math.max(0, candles.length - 80)].time : 0;
  let phase: WyckoffContext["phase"] = "unknown";
  let dir: WyckoffContext["contextDirection"] = "neutral";
  let schematic: WyckoffContext["schematic"] = "none";
  const accum = has("SPRING") || has("SOS") || has("LPS");
  const dist = has("UTAD") || has("SOW") || has("LPSY");
  if (accum && !dist) {
    dir = "long_bias";
    schematic = priorTrend === "up" ? "reaccumulation" : "accumulation";
    phase = last > high + width ? "E" : has("SOS") || has("LPS") ? "D" : "C";
  } else if (dist && !accum) {
    dir = "short_bias";
    schematic = priorTrend === "down" ? "redistribution" : "distribution";
    phase = last < low - width ? "E" : has("SOW") || has("LPSY") ? "D" : "C";
  } else if (!accum && !dist && p.phase === "consolidation") {
    phase = "B";
  } else if (!accum && !dist) {
    schematic = "trending";
  }
  const lead = events.find((e) => ["SPRING", "UTAD", "SOS", "SOW"].includes(e.type));
  const rationale =
    phase === "unknown"
      ? "Wyckoff phase unknown: no grade change."
      : `Wyckoff ${schematic} Phase ${phase}${lead ? `, set by ${lead.type} at ${lead.price}` : ""}.`;
  return { schematic, phase, range: { high, low, start }, events, contextDirection: dir, rationale };
}

/** Soft policy cap: one letter lower when the setup opposes context. */
export function wyckoffContextCap(bias: "Long" | "Short" | "Neutral", ctx: WyckoffContext): GradeCap | null {
  if (bias === "Neutral" || ctx.phase === "unknown" || ctx.contextDirection === "neutral") return null;
  const opposes = (bias === "Long" && ctx.contextDirection === "short_bias") || (bias === "Short" && ctx.contextDirection === "long_bias");
  return opposes ? { rule: `Fix 5: opposes Wyckoff context (${ctx.rationale})`, downgrade: 1 } : null;
}
