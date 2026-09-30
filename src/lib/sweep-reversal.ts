// Spec 2, Fix 4: symmetric sweep gate and reversal flag. Pure, deterministic.
//
// A swept low + a bullish change in state of delivery (CISD) arms a long even
// when the 4H/1H read bearish (mirror for swept highs). Per the addendum this is
// INTERNAL ONLY: it is logged and armed in shadow and never published as a
// tradeable signal until the counter-bias split shows positive average R over at
// least 30 resolved reversals (see counterBiasPublishable in spec2.ts).
//
// Trigger (bullish):
//   1. a candle wicks below a swing low by >= tolerance and closes back above it
//   2. within confirmWindow bars a candle BODY closes above the CISD level: the
//      open of the first candle in the last run of down-closes into the sweep
//   3. ARMED_LONG. Entry on the retrace to CISD. Stop = extreme - 0.25 ATR
//   4. invalidated on a body close below the extreme, expired if no CISD

import type { PsCandle } from "@/lib/protectedStructure";

export type ReversalState = "NONE" | "SWEPT" | "ARMED_LONG" | "ARMED_SHORT" | "INVALIDATED" | "EXPIRED";

export type SweepReversalConfig = {
  enabled: boolean;
  confirmWindow: number;
  toleranceAtrK: number;
  stopBufferAtrK: number;
  lookback: number;
};

export const DEFAULT_SWEEP_REVERSAL: SweepReversalConfig = {
  enabled: false, // shadow: internal only
  confirmWindow: 12,
  toleranceAtrK: 0.05,
  stopBufferAtrK: 0.25,
  lookback: 48,
};

export type SweepReversal = {
  state: ReversalState;
  sweep: { side: "sell_side" | "buy_side"; level: number; extreme: number; time: number } | null;
  cisd: { level: number; confirmed: boolean; time: number | null } | null;
  entry: number | null;
  stop: number | null;
  counterBiasReversal: boolean;
  /** Structure break in the new direction printed after CISD: normal grading allowed. */
  structureBreak: boolean;
  /** Fix 4 grade cap: B until a structure break prints. */
  maxGrade: "B" | null;
  /** Always false in v1: reversals are internal until measured. */
  publishable: false;
  rationale: string;
};

type Bias = "bullish" | "bearish" | "neutral" | undefined;

function swings(c: PsCandle[], kind: "low" | "high", end: number): Array<{ i: number; price: number }> {
  const out: Array<{ i: number; price: number }> = [];
  for (let i = 2; i < end - 2; i++) {
    const v = kind === "low" ? c[i].low : c[i].high;
    const n = [c[i - 2], c[i - 1], c[i + 1], c[i + 2]].map((x) => (kind === "low" ? x.low : x.high));
    if (kind === "low" ? n.every((x) => x > v) : n.every((x) => x < v)) out.push({ i, price: v });
  }
  return out;
}

export function detectSweepReversal(
  candles: PsCandle[],
  opts: { atr: number; h4?: Bias; h1?: Bias; fmt?: (n: number) => string; config?: Partial<SweepReversalConfig> },
): SweepReversal {
  const cfg = { ...DEFAULT_SWEEP_REVERSAL, ...opts.config };
  const fmt = opts.fmt ?? ((n: number) => String(n));
  const none: SweepReversal = {
    state: "NONE", sweep: null, cisd: null, entry: null, stop: null,
    counterBiasReversal: false, structureBreak: false, maxGrade: null, publishable: false,
    rationale: "No completed sweep of a swing high or low in the lookback.",
  };
  const atr = opts.atr;
  if (!(atr > 0) || candles.length < 10) return none;
  const tol = cfg.toleranceAtrK * atr;
  const start = Math.max(5, candles.length - cfg.lookback);

  // Most recent sweep candle wins.
  for (let s = candles.length - 1; s >= start; s--) {
    const c = candles[s];
    for (const side of ["sell_side", "buy_side"] as const) {
      const long = side === "sell_side";
      const pools = swings(candles, long ? "low" : "high", s);
      const pool = pools.reverse().find((p) =>
        long ? c.low <= p.price - tol && c.close > p.price : c.high >= p.price + tol && c.close < p.price,
      );
      if (!pool) continue;
      const extreme = long ? c.low : c.high;
      // CISD level: open of the first candle in the run of opposite closes into the sweep.
      let j = s;
      const against = (x: PsCandle) => (long ? x.close < x.open : x.close > x.open);
      if (!against(candles[j])) j--;
      while (j > 0 && against(candles[j - 1])) j--;
      const cisdLevel = candles[Math.max(0, j)].open;
      const sweep = { side, level: pool.price, extreme, time: c.time };
      const after = candles.slice(s + 1);
      let state: ReversalState = "SWEPT";
      let cisdTime: number | null = null;
      let confirmIdx = -1;
      for (let k = 0; k < after.length; k++) {
        const b = after[k];
        const bodyLow = Math.min(b.open, b.close);
        const bodyHigh = Math.max(b.open, b.close);
        if (long ? bodyLow < extreme : bodyHigh > extreme) { state = "INVALIDATED"; break; }
        if (k >= cfg.confirmWindow) { state = "EXPIRED"; break; }
        if (long ? b.close > cisdLevel : b.close < cisdLevel) {
          state = long ? "ARMED_LONG" : "ARMED_SHORT";
          cisdTime = b.time;
          confirmIdx = k;
          break;
        }
      }
      const armed = state === "ARMED_LONG" || state === "ARMED_SHORT";
      const opposing = long ? "bearish" : "bullish";
      const counter = armed && (opts.h4 === opposing || opts.h1 === opposing);
      // Structure break in the new direction: a close beyond the reversal leg's high/low after CISD.
      let structureBreak = false;
      if (armed) {
        const leg = candles.slice(Math.max(0, j - 10), s + 1);
        const pivot = long ? Math.max(...leg.map((x) => x.high)) : Math.min(...leg.map((x) => x.low));
        structureBreak = after.slice(confirmIdx).some((b) => (long ? b.close > pivot : b.close < pivot));
      }
      const stop = armed ? (long ? extreme - cfg.stopBufferAtrK * atr : extreme + cfg.stopBufferAtrK * atr) : null;
      const sideWord = long ? "Sell-side" : "Buy-side";
      const dir = long ? "bullish" : "bearish";
      const rationale = armed
        ? `${sideWord} swept at ${fmt(pool.price)} (extreme ${fmt(extreme)}) and delivery flipped ${dir} through ${fmt(cisdLevel)}.` +
          (counter ? ` This opposes the 4H/1H ${opposing} bias; treat as a reversal attempt.` : "") +
          (counter && !structureBreak ? " Capped at B until a structure break prints." : "") +
          " Internal only: not published until counter-bias reversals are measured."
        : state === "INVALIDATED"
          ? `${sideWord} swept at ${fmt(pool.price)} but a body closed beyond the extreme ${fmt(extreme)}. Invalidated.`
          : state === "EXPIRED"
            ? `${sideWord} swept at ${fmt(pool.price)} but no CISD through ${fmt(cisdLevel)} within ${cfg.confirmWindow} bars. Expired.`
            : `${sideWord} swept at ${fmt(pool.price)}; waiting for a body close through ${fmt(cisdLevel)}.`;
      return {
        state, sweep,
        cisd: { level: cisdLevel, confirmed: armed, time: cisdTime },
        entry: armed ? cisdLevel : null,
        stop,
        counterBiasReversal: counter,
        structureBreak,
        maxGrade: counter && !structureBreak ? "B" : null,
        publishable: false,
        rationale,
      };
    }
  }
  return none;
}
