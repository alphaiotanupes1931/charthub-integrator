// Premium / discount read. The dealing range is the swing high and swing low of
// the recent higher-timeframe leg; its 50% line is equilibrium. Buys belong in
// discount (below 50%), sells in premium (above 50%). Evidence tier B
// (context.premium_discount): it may move the grade, never block a trade.
// Shared by the live planner and the research rig; do not copy it elsewhere.

export type RangeBar = { high: number; low: number; close?: number };

export type DealingRange = { high: number; low: number; equilibrium: number };

export type PdZone = "deep_discount" | "discount" | "premium" | "deep_premium";

export type PdRead = {
  range: DealingRange;
  /** Entry position in the range, 0 = range low, 1 = range high. */
  position: number;
  zone: PdZone;
  /** Buy in discount or sell in premium. */
  correctSide: boolean;
  /** Buy at or below 38% / sell at or above 62% (the 62-79% retracement area). */
  ote: boolean;
  text: string;
};

/** Default lookback: 120 one-hour bars, about one trading week. */
export const DEALING_RANGE_BARS = 120;
export const OTE_EDGE = 0.38;

export function dealingRange(bars: RangeBar[], lookback = DEALING_RANGE_BARS): DealingRange | null {
  const view = bars.slice(-lookback);
  if (view.length < 20) return null;
  let high = -Infinity, low = Infinity;
  for (const b of view) { if (b.high > high) high = b.high; if (b.low < low) low = b.low; }
  if (!(high > low)) return null;
  return { high, low, equilibrium: (high + low) / 2 };
}

export function readPremiumDiscount(bias: "Long" | "Short", entry: number, range: DealingRange): PdRead {
  const pos = (entry - range.low) / (range.high - range.low);
  const position = Math.max(0, Math.min(1, pos));
  const zone: PdZone = position < 0.25 ? "deep_discount" : position < 0.5 ? "discount" : position < 0.75 ? "premium" : "deep_premium";
  const long = bias === "Long";
  const correctSide = long ? position < 0.5 : position > 0.5;
  const ote = long ? position <= OTE_EDGE : position >= 1 - OTE_EDGE;
  const pct = Math.round(position * 100);
  const where = position < 0.5 ? "discount" : "premium";
  const text = correctSide
    ? `Entry sits at ${pct}% of the dealing range (${where}${ote ? ", optimal trade entry area" : ""}), the right side to ${long ? "buy" : "sell"}.`
    : `Entry sits at ${pct}% of the dealing range (${where}): ${long ? "buying in premium" : "selling in discount"}, the wrong side of equilibrium ${range.equilibrium.toFixed(5).replace(/0+$/, "")}.`;
  return { range, position, zone, correctSide, ote, text };
}

const ORDER = ["NO ENTRY", "C", "B", "A", "A+"];

/**
 * Wrong side of equilibrium caps the grade at C. A correct-side optimal trade
 * entry may lift a B to A when no other cap is holding the grade. Never blocks.
 */
export function applyPremiumDiscount(grade: string, read: PdRead, otherCapBinding: boolean): { grade: string; action: "up" | "down" | "none" } {
  const i = ORDER.indexOf(grade);
  if (i <= 0) return { grade, action: "none" };
  if (!read.correctSide) return i > 1 ? { grade: "C", action: "down" } : { grade, action: "none" };
  if (read.ote && grade === "B" && !otherCapBinding) return { grade: "A", action: "up" };
  return { grade, action: "none" };
}
