// Fibonacci retracement study — TradingView-style, direction aware and
// timeframe aware. The swing used for the measurement changes with the
// selected interval (a 15m fib measures the last intraday leg, a weekly fib
// measures the last multi-month leg).

export type FibCandle = { time: number; open: number; high: number; low: number; close: number };

export type FibLevel = {
  ratio: number;
  price: number;
  color: string;
  /** e.g. "0.618 (1.34889)" */
  label: string;
};

export type FibStudy = {
  swingHigh: number;
  swingLow: number;
  /** "up" = leg ran high→low retracing up-side? we store leg direction */
  direction: "up" | "down";
  /** index in candles of each anchor, for optional trend-line drawing */
  fromIndex: number;
  toIndex: number;
  lookback: number;
  levels: FibLevel[];
};

/** TradingView default retracement colors. */
const RATIO_COLORS: Record<string, string> = {
  "0": "#787b86",
  "0.236": "#f23645",
  "0.382": "#ff9800",
  "0.5": "#4caf50",
  "0.618": "#089981",
  "0.786": "#00bcd4",
  "1": "#787b86",
  "1.272": "#2962ff",
  "1.618": "#2962ff",
};

export const FIB_RATIOS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1, 1.272, 1.618];

/**
 * How many bars of history the fib measurement looks back over, and how strict
 * pivot detection is, for each interval. Bigger timeframes measure wider legs.
 */
export function fibWindowFor(interval: string): { lookback: number; pivot: number } {
  const i = interval.toLowerCase();
  if (i === "1" || i === "1m") return { lookback: 120, pivot: 3 };
  if (i === "3" || i === "3m") return { lookback: 140, pivot: 3 };
  if (i === "5" || i === "5m") return { lookback: 150, pivot: 4 };
  if (i === "15" || i === "15m") return { lookback: 160, pivot: 4 };
  if (i === "30" || i === "30m") return { lookback: 170, pivot: 5 };
  if (i === "60" || i === "1h") return { lookback: 180, pivot: 5 };
  if (i === "120" || i === "2h") return { lookback: 180, pivot: 5 };
  if (i === "240" || i === "4h") return { lookback: 200, pivot: 6 };
  if (i === "d" || i === "1d" || i === "day" || i === "daily") return { lookback: 220, pivot: 7 };
  if (i === "w" || i === "1w" || i === "week" || i === "weekly") return { lookback: 260, pivot: 8 };
  if (i === "m" || i === "1mo" || i === "month" || i === "monthly") return { lookback: 300, pivot: 9 };
  return { lookback: 160, pivot: 5 };
}

function fmtPrice(p: number): string {
  const abs = Math.abs(p);
  const dp = abs >= 1000 ? 2 : abs >= 100 ? 2 : abs >= 10 ? 3 : abs >= 1 ? 4 : 5;
  return p.toFixed(dp);
}

/** Find the most recent significant swing leg using pivot highs/lows. */
function lastLeg(window: FibCandle[], pivot: number) {
  type P = { idx: number; price: number; kind: "high" | "low" };
  const pivots: P[] = [];
  for (let i = pivot; i < window.length - pivot; i++) {
    let isHigh = true, isLow = true;
    for (let k = 1; k <= pivot; k++) {
      if (window[i].high <= window[i - k].high || window[i].high <= window[i + k].high) isHigh = false;
      if (window[i].low >= window[i - k].low || window[i].low >= window[i + k].low) isLow = false;
    }
    if (isHigh) pivots.push({ idx: i, price: window[i].high, kind: "high" });
    else if (isLow) pivots.push({ idx: i, price: window[i].low, kind: "low" });
  }

  // Walk back for the last high/low pair of opposite kind.
  for (let i = pivots.length - 1; i > 0; i--) {
    const b = pivots[i];
    for (let j = i - 1; j >= 0; j--) {
      const a = pivots[j];
      if (a.kind !== b.kind) return { a, b };
    }
  }
  return null;
}

/**
 * Compute the fib study for the given candles + interval.
 * Returns null when there is not enough data.
 */
export function computeFib(candles: FibCandle[], interval: string): FibStudy | null {
  if (!candles || candles.length < 12) return null;
  const { lookback, pivot } = fibWindowFor(interval);
  const window = candles.slice(-lookback);

  let fromIndex = 0;
  let toIndex = window.length - 1;
  let high: number;
  let low: number;
  let direction: "up" | "down";

  const leg = lastLeg(window, pivot);
  if (leg) {
    fromIndex = leg.a.idx;
    toIndex = leg.b.idx;
    if (leg.a.kind === "low") {
      // up leg: low -> high, retracement measured down from the high
      low = leg.a.price;
      high = leg.b.price;
      direction = "up";
    } else {
      high = leg.a.price;
      low = leg.b.price;
      direction = "down";
    }
  } else {
    high = Math.max(...window.map((c) => c.high));
    low = Math.min(...window.map((c) => c.low));
    const hiIdx = window.findIndex((c) => c.high === high);
    const loIdx = window.findIndex((c) => c.low === low);
    fromIndex = Math.min(hiIdx, loIdx);
    toIndex = Math.max(hiIdx, loIdx);
    direction = loIdx < hiIdx ? "up" : "down";
  }

  const range = high - low;
  if (!(range > 0)) return null;

  const levels: FibLevel[] = FIB_RATIOS.map((ratio) => {
    // ratio 0 sits at the end of the leg, ratio 1 at its start.
    const price = direction === "up" ? high - range * ratio : low + range * ratio;
    const key = String(ratio);
    return {
      ratio,
      price,
      color: RATIO_COLORS[key] ?? "#787b86",
      label: `${ratio} (${fmtPrice(price)})`,
    };
  });

  return { swingHigh: high, swingLow: low, direction, fromIndex, toIndex, lookback, levels };
}
