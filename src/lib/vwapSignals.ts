/**
 * VWAP Buy/Sell indicator.
 *
 * Mirrors the classic "VWAP BUY SELL INDICATOR" study: an anchored VWAP line
 * plus a fast/slow moving-average pair, and Buy / Sell / TP labels printed on
 * the bars where the study fires.
 *
 * Rules
 *  - Buy:  close crosses ABOVE the fast MA while price is above VWAP and the
 *          fast MA is above the slow MA (trend filter).
 *  - Sell: close crosses BELOW the fast MA while price is below VWAP and the
 *          fast MA is below the slow MA.
 *  - TP:   the open signal has travelled >= tpAtr * ATR(14) in its favour.
 *          The position is flat again after a TP, so the next Buy/Sell can fire.
 *  - Only one signal is live at a time, which is why the labels alternate.
 */

export type Bar = { time: number; open: number; high: number; low: number; close: number };

export type VwapPoint = { time: number; value: number };

export type VwapSignal = {
  time: number;
  price: number;
  kind: "buy" | "sell" | "tp";
};

export type VwapIndicator = {
  vwap: VwapPoint[];
  fast: VwapPoint[];
  slow: VwapPoint[];
  signals: VwapSignal[];
  /** Latest state for AI / UI copy. */
  state: "long" | "short" | "flat";
  lastSignal: VwapSignal | null;
};

export const VWAP_COLORS = {
  vwap: "#fbbf24",   // amber, matches the VWAP badge
  fast: "#eab308",   // yellow fast MA
  slow: "#3b82f6",   // blue slow MA
  buy: "#22c55e",
  sell: "#ef4444",
  tp: "#facc15",
};

function ema(values: number[], length: number): number[] {
  const k = 2 / (length + 1);
  const out: number[] = [];
  let prev = values[0] ?? 0;
  values.forEach((v, i) => {
    prev = i === 0 ? v : v * k + prev * (1 - k);
    out.push(prev);
  });
  return out;
}

function atr(bars: Bar[], length = 14): number[] {
  const trs = bars.map((b, i) => {
    if (i === 0) return b.high - b.low;
    const p = bars[i - 1].close;
    return Math.max(b.high - b.low, Math.abs(b.high - p), Math.abs(b.low - p));
  });
  return ema(trs, length);
}

export function computeVwapIndicator(
  bars: Bar[],
  opts: { fastLength?: number; slowLength?: number; tpAtr?: number } = {},
): VwapIndicator {
  const fastLength = opts.fastLength ?? 21;
  const slowLength = opts.slowLength ?? 50;
  const tpAtr = opts.tpAtr ?? 1.5;

  if (bars.length < Math.max(fastLength, slowLength) + 2) {
    return { vwap: [], fast: [], slow: [], signals: [], state: "flat", lastSignal: null };
  }

  const closes = bars.map((b) => b.close);
  const fastVals = ema(closes, fastLength);
  const slowVals = ema(closes, slowLength);
  const atrVals = atr(bars, 14);

  // Anchored VWAP. No volume in the feed, so bar range is the volume proxy
  // (same approach used elsewhere for the VWAP level).
  const vwap: VwapPoint[] = [];
  let pv = 0;
  let vol = 0;
  bars.forEach((b) => {
    const typical = (b.high + b.low + b.close) / 3;
    const v = Math.max(1e-9, b.high - b.low);
    pv += typical * v;
    vol += v;
    vwap.push({ time: b.time, value: pv / vol });
  });

  const fast: VwapPoint[] = bars.map((b, i) => ({ time: b.time, value: fastVals[i] }));
  const slow: VwapPoint[] = bars.map((b, i) => ({ time: b.time, value: slowVals[i] }));

  const signals: VwapSignal[] = [];
  let state: "long" | "short" | "flat" = "flat";
  let entry = 0;

  for (let i = Math.max(fastLength, slowLength); i < bars.length; i++) {
    const b = bars[i];
    const prev = bars[i - 1];
    const f = fastVals[i];
    const fPrev = fastVals[i - 1];
    const s = slowVals[i];
    const v = vwap[i].value;
    const a = Math.max(1e-9, atrVals[i]);

    // Take profit first: a live signal that reached its target frees the slot.
    if (state === "long" && b.high - entry >= tpAtr * a) {
      signals.push({ time: b.time, price: b.high, kind: "tp" });
      state = "flat";
      continue;
    }
    if (state === "short" && entry - b.low >= tpAtr * a) {
      signals.push({ time: b.time, price: b.low, kind: "tp" });
      state = "flat";
      continue;
    }

    const crossUp = prev.close <= fPrev && b.close > f;
    const crossDown = prev.close >= fPrev && b.close < f;

    if (crossUp && b.close > v && f > s && state !== "long") {
      signals.push({ time: b.time, price: b.low, kind: "buy" });
      state = "long";
      entry = b.close;
    } else if (crossDown && b.close < v && f < s && state !== "short") {
      signals.push({ time: b.time, price: b.high, kind: "sell" });
      state = "short";
      entry = b.close;
    }
  }

  return {
    vwap,
    fast,
    slow,
    signals,
    state,
    lastSignal: signals.length ? signals[signals.length - 1] : null,
  };
}
