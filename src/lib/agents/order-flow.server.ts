// Order flow metrics computed server-side from OHLCV candles.
// These are the five metrics that actually describe order flow:
//   1. Delta                     - signed volume on the most recent bar
//   2. Cumulative Volume Delta   - running sum of delta over the lookback
//   3. Volume Point of Control   - price level that traded the most volume
//   4. Volume Imbalance          - buy vs sell skew, plus stacked imbalances
//   5. Market Depth              - liquidity/absorption proxy per unit volume
//
// When a feed gives no volume (spot FX on Yahoo), volume is estimated from bar
// range so the shape of the read still holds. That is flagged as `estimated`.

import type { Candle, OrderFlow } from "./types";

const LOOKBACK = 120;
const PROFILE_BINS = 48;
const IMBALANCE_RATIO = 2; // 2:1 buy/sell = an imbalance

function barVolume(c: Candle, estimated: boolean): number {
  if (!estimated && typeof c.volume === "number" && c.volume > 0) return c.volume;
  // Range proxy: wider bars traded more.
  const r = Math.max(c.high - c.low, Math.abs(c.close - c.open));
  return r > 0 ? r * 1000 : 1;
}

/** Split a bar's volume into buy/sell using close position inside the bar. */
function splitBar(c: Candle, vol: number): { buy: number; sell: number } {
  const span = c.high - c.low;
  if (span <= 0) return { buy: vol / 2, sell: vol / 2 };
  const upShare = (c.close - c.low) / span;
  return { buy: vol * upShare, sell: vol * (1 - upShare) };
}

export function computeOrderFlow(candles: Candle[]): OrderFlow | undefined {
  if (candles.length < 20) return undefined;
  const bars = candles.slice(-LOOKBACK);
  const estimated = !bars.some((c) => typeof c.volume === "number" && (c.volume ?? 0) > 0);

  // --- Delta and CVD -------------------------------------------------------
  const deltas: number[] = [];
  let cvd = 0;
  let totalBuy = 0;
  let totalSell = 0;
  let totalVol = 0;
  const imbalanceMarks: Array<1 | -1 | 0> = [];

  for (const c of bars) {
    const vol = barVolume(c, estimated);
    const { buy, sell } = splitBar(c, vol);
    const d = buy - sell;
    deltas.push(d);
    cvd += d;
    totalBuy += buy;
    totalSell += sell;
    totalVol += vol;
    imbalanceMarks.push(buy >= sell * IMBALANCE_RATIO ? 1 : sell >= buy * IMBALANCE_RATIO ? -1 : 0);
  }

  const delta = deltas.at(-1) ?? 0;
  const recentDeltas = deltas.slice(-10);
  const deltaAvg = recentDeltas.reduce((a, b) => a + b, 0) / (recentDeltas.length || 1);
  const cvdSlope = (() => {
    // CVD over the last 20 bars vs the 20 before that.
    const tail = deltas.slice(-20).reduce((a, b) => a + b, 0);
    const prev = deltas.slice(-40, -20).reduce((a, b) => a + b, 0);
    return tail - prev;
  })();

  // --- Volume profile / point of control -----------------------------------
  const hi = Math.max(...bars.map((c) => c.high));
  const lo = Math.min(...bars.map((c) => c.low));
  const binSize = (hi - lo) / PROFILE_BINS || 1;
  const profile = new Array<number>(PROFILE_BINS).fill(0);
  for (const c of bars) {
    const vol = barVolume(c, estimated);
    const from = Math.max(0, Math.floor((c.low - lo) / binSize));
    const to = Math.min(PROFILE_BINS - 1, Math.floor((c.high - lo) / binSize));
    const spread = to - from + 1;
    for (let i = from; i <= to; i++) profile[i] += vol / spread;
  }
  let pocIdx = 0;
  for (let i = 1; i < profile.length; i++) if (profile[i] > profile[pocIdx]) pocIdx = i;
  const poc = lo + (pocIdx + 0.5) * binSize;

  // Value area: expand from POC until 70% of volume is covered.
  const target = totalVol * 0.7;
  let covered = profile[pocIdx];
  let lowIdx = pocIdx;
  let highIdx = pocIdx;
  while (covered < target && (lowIdx > 0 || highIdx < PROFILE_BINS - 1)) {
    const below = lowIdx > 0 ? profile[lowIdx - 1] : -1;
    const above = highIdx < PROFILE_BINS - 1 ? profile[highIdx + 1] : -1;
    if (above >= below) { highIdx++; covered += Math.max(above, 0); }
    else { lowIdx--; covered += Math.max(below, 0); }
  }
  const valueAreaLow = lo + lowIdx * binSize;
  const valueAreaHigh = lo + (highIdx + 1) * binSize;

  // --- Volume imbalance ----------------------------------------------------
  const buyPct = totalVol > 0 ? (totalBuy / (totalBuy + totalSell)) * 100 : 50;
  const imbalanceSkew = buyPct - 50; // -50..+50
  let stacked = 0;
  let run = 0;
  let runSign: 1 | -1 | 0 = 0;
  for (const m of imbalanceMarks.slice(-20)) {
    if (m !== 0 && m === runSign) run++;
    else if (m !== 0) { runSign = m; run = 1; }
    else { runSign = 0; run = 0; }
    if (run > stacked) stacked = run;
  }

  // --- Market depth proxy --------------------------------------------------
  // Price movement produced per unit of volume. Lots of movement on little
  // volume = thin book. Little movement on heavy volume = deep/absorbing.
  const recent = bars.slice(-20);
  const moved = recent.reduce((a, c) => a + Math.abs(c.close - c.open), 0);
  const recentVol = recent.reduce((a, c) => a + barVolume(c, estimated), 0);
  const avgPrice = recent.reduce((a, c) => a + c.close, 0) / recent.length;
  const efficiency = recentVol > 0 ? (moved / avgPrice) / (recentVol / totalVol || 1) : 0;
  const medianVol = (() => {
    const v = bars.map((c) => barVolume(c, estimated)).sort((a, b) => a - b);
    return v[Math.floor(v.length / 2)] || 1;
  })();
  const lastVolRatio = barVolume(bars.at(-1)!, estimated) / medianVol;
  const depth: OrderFlow["depth"] =
    lastVolRatio >= 1.6 && efficiency < 0.5 ? "absorbing"
    : lastVolRatio >= 1.3 ? "deep"
    : lastVolRatio <= 0.6 ? "thin"
    : "normal";

  const bias: OrderFlow["bias"] =
    cvd > 0 && cvdSlope > 0 && imbalanceSkew > 2 ? "bullish"
    : cvd < 0 && cvdSlope < 0 && imbalanceSkew < -2 ? "bearish"
    : imbalanceSkew > 6 ? "bullish"
    : imbalanceSkew < -6 ? "bearish"
    : "neutral";

  const last = bars.at(-1)!.close;

  return {
    estimated,
    bars: bars.length,
    delta,
    deltaAvg,
    cvd,
    cvdSlope,
    poc,
    valueAreaLow,
    valueAreaHigh,
    priceVsPoc: last > poc ? "above" : last < poc ? "below" : "at",
    buyPct,
    imbalanceSkew,
    stackedImbalances: stacked,
    stackedSide: runSign === 1 ? "buy" : runSign === -1 ? "sell" : "none",
    depth,
    lastVolRatio,
    bias,
  };
}

/** Human/AI readable block used in prompts. */
export function formatOrderFlow(of: OrderFlow | undefined): string {
  if (!of) return "ORDER FLOW: unavailable (not enough candles).";
  const n = (v: number) => (Math.abs(v) >= 100 ? v.toFixed(2) : v.toFixed(4));
  const k = (v: number) => {
    const a = Math.abs(v);
    if (a >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
    if (a >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
    if (a >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
    return v.toFixed(0);
  };
  return [
    `ORDER FLOW (${of.bars} bars${of.estimated ? ", volume estimated from range - no exchange volume on this feed" : ""}):`,
    `  Delta (last bar): ${k(of.delta)} | 10-bar avg delta: ${k(of.deltaAvg)}`,
    `  Cumulative Volume Delta: ${k(of.cvd)} | CVD slope (last 20 vs prior 20): ${k(of.cvdSlope)}`,
    `  Volume Point of Control: ${n(of.poc)} | value area ${n(of.valueAreaLow)} - ${n(of.valueAreaHigh)} | price is ${of.priceVsPoc} POC`,
    `  Volume imbalance: ${of.buyPct.toFixed(1)}% buy / ${(100 - of.buyPct).toFixed(1)}% sell (skew ${of.imbalanceSkew >= 0 ? "+" : ""}${of.imbalanceSkew.toFixed(1)}), ${of.stackedImbalances} stacked ${of.stackedSide} imbalances`,
    `  Market depth: ${of.depth} (last bar volume ${of.lastVolRatio.toFixed(2)}x median)`,
    `  Order flow read: ${of.bias}`,
    `Use these numbers when discussing order flow. Do not substitute generic "directional strength" language.`,
  ].join("\n");
}
