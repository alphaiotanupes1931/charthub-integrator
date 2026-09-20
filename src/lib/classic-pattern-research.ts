import { closedBars, type BarCandle } from "@/lib/barClock";

export type ResearchDirection = "bullish" | "bearish";
export type FvgClass = "normal" | "breakaway" | "inverted";

export type ClassifiedFvg = {
  direction: ResearchDirection;
  classification: FvgClass;
  lower: number;
  upper: number;
  formedAt: number;
  invertedAt: number | null;
};

export type PocContinuationRead = {
  status: "confirmed" | "waiting-breakout" | "waiting-pullback" | "waiting-continuation" | "not-applicable";
  direction: ResearchDirection | null;
  poc: number | null;
  rangeHigh: number | null;
  rangeLow: number | null;
  breakoutAt: number | null;
  pullbackAt: number | null;
  continuationAt: number | null;
  reason: string;
};

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function atr(bars: BarCandle[], period = 14): number {
  if (bars.length < 2) return 0;
  const rows = bars.slice(-(period + 1));
  const values = rows.slice(1).map((bar, index) => {
    const previous = rows[index];
    return Math.max(bar.high - bar.low, Math.abs(bar.high - previous.close), Math.abs(bar.low - previous.close));
  });
  return values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1);
}

function volumePoc(bars: BarCandle[], bins = 32): number | null {
  if (!bars.length) return null;
  const high = Math.max(...bars.map((bar) => bar.high));
  const low = Math.min(...bars.map((bar) => bar.low));
  if (!(high > low)) return null;
  const size = (high - low) / bins;
  const profile = new Array<number>(bins).fill(0);
  for (const bar of bars) {
    const volume = typeof bar.volume === "number" && bar.volume > 0
      ? bar.volume
      : Math.max(bar.high - bar.low, Math.abs(bar.close - bar.open), 1e-9) * 1000;
    const from = Math.max(0, Math.floor((bar.low - low) / size));
    const to = Math.min(bins - 1, Math.floor((bar.high - low) / size));
    for (let index = from; index <= to; index++) profile[index] += volume / (to - from + 1);
  }
  let winner = 0;
  for (let index = 1; index < profile.length; index++) if (profile[index] > profile[winner]) winner = index;
  return low + (winner + 0.5) * size;
}

export function classifyFairValueGaps(candles: BarCandle[], asOfMs?: number): ClassifiedFvg[] {
  const bars = closedBars(candles, asOfMs);
  const output: ClassifiedFvg[] = [];
  for (let index = 2; index < bars.length; index++) {
    const first = bars[index - 2];
    const impulse = bars[index - 1];
    const third = bars[index];
    const direction: ResearchDirection | null = first.high < third.low ? "bullish" : first.low > third.high ? "bearish" : null;
    if (!direction) continue;
    const lower = direction === "bullish" ? first.high : third.high;
    const upper = direction === "bullish" ? third.low : first.low;
    const prior = bars.slice(Math.max(0, index - 22), index - 2);
    const priorHigh = prior.length ? Math.max(...prior.map((bar) => bar.high)) : impulse.high;
    const priorLow = prior.length ? Math.min(...prior.map((bar) => bar.low)) : impulse.low;
    const impulseAtr = atr(bars.slice(0, index), 14);
    const structuralBreak = direction === "bullish" ? impulse.close > priorHigh : impulse.close < priorLow;
    const impulsive = impulseAtr > 0 && Math.abs(impulse.close - impulse.open) >= impulseAtr * 0.6;
    const later = bars.slice(index + 1);
    const inversion = later.find((bar) => direction === "bullish" ? bar.close < lower : bar.close > upper);
    output.push({
      direction,
      classification: inversion ? "inverted" : structuralBreak && impulsive ? "breakaway" : "normal",
      lower,
      upper,
      formedAt: third.time,
      invertedAt: inversion?.time ?? null,
    });
  }
  return output;
}

export function readPocContinuation(input: {
  accumulationBars: BarCandle[];
  followingBars: BarCandle[];
  higherTimeframeBias: ResearchDirection | "neutral";
  asOfMs?: number;
}): PocContinuationRead {
  const accumulation = closedBars(input.accumulationBars, input.asOfMs);
  const following = closedBars(input.followingBars, input.asOfMs);
  const blank = (status: PocContinuationRead["status"], reason: string): PocContinuationRead => ({
    status, direction: null, poc: null, rangeHigh: null, rangeLow: null,
    breakoutAt: null, pullbackAt: null, continuationAt: null, reason,
  });
  if (input.higherTimeframeBias === "neutral") return blank("not-applicable", "Higher-timeframe bias is neutral.");
  if (accumulation.length < 8) return blank("not-applicable", "At least eight closed accumulation bars are required.");
  const rangeHigh = Math.max(...accumulation.map((bar) => bar.high));
  const rangeLow = Math.min(...accumulation.map((bar) => bar.low));
  const poc = volumePoc(accumulation);
  if (poc === null) return blank("not-applicable", "A volume-profile point of control could not be calculated.");
  const typicalRange = median(accumulation.map((bar) => bar.high - bar.low));
  if (!(typicalRange > 0) || rangeHigh - rangeLow > typicalRange * 4) {
    return { ...blank("not-applicable", "The proposed accumulation is not sufficiently compressed."), poc, rangeHigh, rangeLow };
  }
  const direction = input.higherTimeframeBias;
  const breakout = following.find((bar) => direction === "bullish" ? bar.close > rangeHigh : bar.close < rangeLow);
  const base = { direction, poc, rangeHigh, rangeLow };
  if (!breakout) return { ...blank("waiting-breakout", "No aligned closed-bar breakout yet."), ...base };
  const afterBreakout = following.slice(following.indexOf(breakout) + 1);
  const tolerance = Math.max(atr([...accumulation, ...following]) * 0.15, (rangeHigh - rangeLow) * 0.03);
  const pullback = afterBreakout.find((bar) => bar.low <= poc + tolerance && bar.high >= poc - tolerance);
  if (!pullback) return { ...blank("waiting-pullback", "The breakout has not pulled back to the accumulation POC."), ...base, breakoutAt: breakout.time };
  const afterPullback = afterBreakout.slice(afterBreakout.indexOf(pullback) + 1);
  const continuation = afterPullback.find((bar) => direction === "bullish" ? bar.close > rangeHigh : bar.close < rangeLow);
  if (!continuation) return {
    ...blank("waiting-continuation", "POC was touched, but continuation has not closed beyond the breakout boundary."),
    ...base, breakoutAt: breakout.time, pullbackAt: pullback.time,
  };
  return {
    status: "confirmed", ...base, breakoutAt: breakout.time, pullbackAt: pullback.time,
    continuationAt: continuation.time,
    reason: "Accumulation, aligned breakout, POC pullback, and closed-bar continuation are complete.",
  };
}