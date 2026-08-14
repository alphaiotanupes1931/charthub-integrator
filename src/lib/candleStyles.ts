/**
 * 21 chart display styles (TradingView-style "chart type" list).
 *
 * Each style declares which lightweight-charts series kind it needs and how to
 * transform raw OHLC bars into that series' data. Synthetic styles (Renko,
 * Kagi, Point & Figure, Range, Line Break) rebuild bars from price action, so
 * they get evenly spaced synthetic timestamps derived from the source series.
 */

export type Bar = { time: number; open: number; high: number; low: number; close: number };

export type SeriesKind = "candlestick" | "bar" | "line" | "area" | "baseline" | "histogram";

export type OhlcPoint = { time: number; open: number; high: number; low: number; close: number };
export type ValuePoint = { time: number; value: number; color?: string };

export type CandleStyleId =
  | "candle"
  | "hollow"
  | "ha"
  | "bars"
  | "hlc-bars"
  | "high-low"
  | "line"
  | "line-markers"
  | "step-line"
  | "area"
  | "hlc-area"
  | "baseline"
  | "columns"
  | "renko"
  | "line-break"
  | "kagi"
  | "point-figure"
  | "range"
  | "typical"
  | "median"
  | "weighted";

export type CandleStyle = {
  id: CandleStyleId;
  label: string;
  hint: string;
  kind: SeriesKind;
  /** candlestick/bar styles */
  ohlc?: (bars: Bar[]) => OhlcPoint[];
  /** line/area/baseline/histogram styles */
  values?: (bars: Bar[]) => ValuePoint[];
  /** true when up bodies should be drawn hollow */
  hollow?: boolean;
  /** dashed/step line rendering */
  stepped?: boolean;
  markers?: boolean;
};

// ---------- helpers ----------

function step(bars: Bar[]) {
  if (bars.length < 3) return 60;
  const deltas: number[] = [];
  for (let i = 1; i < bars.length; i++) deltas.push(bars[i].time - bars[i - 1].time);
  deltas.sort((a, b) => a - b);
  return Math.max(1, deltas[Math.floor(deltas.length / 2)] || 60);
}

/** Re-times synthetic bars onto an evenly spaced, strictly increasing axis. */
function retime<T extends { time: number }>(src: Bar[], out: T[]): T[] {
  if (out.length === 0) return out;
  const s = step(src);
  const start = src.length ? src[0].time : 0;
  return out.map((p, i) => ({ ...p, time: start + i * s }));
}

function atr(bars: Bar[], len = 14) {
  if (bars.length < 2) return 0;
  const slice = bars.slice(-Math.max(len + 1, 2));
  let sum = 0;
  for (let i = 1; i < slice.length; i++) {
    const p = slice[i - 1], c = slice[i];
    sum += Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close));
  }
  return sum / Math.max(1, slice.length - 1);
}

function heikinAshi(bars: Bar[]): OhlcPoint[] {
  const out: OhlcPoint[] = [];
  for (let i = 0; i < bars.length; i++) {
    const c = bars[i];
    const haClose = (c.open + c.high + c.low + c.close) / 4;
    const prev = out[i - 1];
    const haOpen = prev ? (prev.open + prev.close) / 2 : (c.open + c.close) / 2;
    out.push({
      time: c.time,
      open: haOpen,
      close: haClose,
      high: Math.max(c.high, haOpen, haClose),
      low: Math.min(c.low, haOpen, haClose),
    });
  }
  return out;
}

function renko(bars: Bar[]): OhlcPoint[] {
  if (bars.length === 0) return [];
  const brick = atr(bars) || Math.abs(bars[0].close) * 0.002 || 1;
  const out: OhlcPoint[] = [];
  let base = bars[0].close;
  for (const b of bars) {
    let diff = b.close - base;
    while (Math.abs(diff) >= brick) {
      const dir = diff > 0 ? 1 : -1;
      const open = base;
      const close = base + dir * brick;
      out.push({ time: b.time, open, close, high: Math.max(open, close), low: Math.min(open, close) });
      base = close;
      diff = b.close - base;
    }
  }
  return retime(bars, out);
}

function rangeBars(bars: Bar[]): OhlcPoint[] {
  if (bars.length === 0) return [];
  const size = (atr(bars) || 1) * 0.75;
  const out: OhlcPoint[] = [];
  let cur: OhlcPoint | null = null;
  for (const b of bars) {
    if (!cur) cur = { time: b.time, open: b.open, high: b.high, low: b.low, close: b.close };
    else {
      cur.high = Math.max(cur.high, b.high);
      cur.low = Math.min(cur.low, b.low);
      cur.close = b.close;
    }
    if (cur.high - cur.low >= size) { out.push(cur); cur = null; }
  }
  if (cur) out.push(cur);
  return retime(bars, out);
}

function lineBreak(bars: Bar[], lines = 3): OhlcPoint[] {
  if (bars.length === 0) return [];
  const out: OhlcPoint[] = [];
  const closes: number[] = [];
  let prevClose = bars[0].close;
  for (const b of bars) {
    const recent = closes.slice(-lines);
    const hi = recent.length ? Math.max(...recent, prevClose) : prevClose;
    const lo = recent.length ? Math.min(...recent, prevClose) : prevClose;
    if (b.close > hi || b.close < lo || out.length === 0) {
      out.push({
        time: b.time,
        open: prevClose,
        close: b.close,
        high: Math.max(prevClose, b.close),
        low: Math.min(prevClose, b.close),
      });
      closes.push(prevClose);
      prevClose = b.close;
    }
  }
  return retime(bars, out);
}

function pointFigure(bars: Bar[]): OhlcPoint[] {
  if (bars.length === 0) return [];
  const box = (atr(bars) || 1) * 0.5;
  const reversal = 3 * box;
  const out: OhlcPoint[] = [];
  let dir: 1 | -1 = bars[1] && bars[1].close >= bars[0].close ? 1 : -1;
  let colStart = bars[0].close;
  let extreme = bars[0].close;
  for (const b of bars) {
    const px = dir === 1 ? b.high : b.low;
    if (dir === 1 ? px > extreme : px < extreme) extreme = px;
    const pulled = dir === 1 ? extreme - b.low : b.high - extreme;
    if (pulled >= reversal) {
      out.push({
        time: b.time,
        open: colStart,
        close: extreme,
        high: Math.max(colStart, extreme),
        low: Math.min(colStart, extreme),
      });
      dir = dir === 1 ? -1 : 1;
      colStart = extreme;
      extreme = dir === 1 ? b.high : b.low;
    }
  }
  if (Math.abs(extreme - colStart) >= box) {
    out.push({
      time: bars[bars.length - 1].time,
      open: colStart,
      close: extreme,
      high: Math.max(colStart, extreme),
      low: Math.min(colStart, extreme),
    });
  }
  return retime(bars, out);
}

function kagi(bars: Bar[]): ValuePoint[] {
  if (bars.length === 0) return [];
  const rev = (atr(bars) || 1) * 1.0;
  const out: ValuePoint[] = [{ time: bars[0].time, value: bars[0].close }];
  let dir: 1 | -1 = 1;
  let extreme = bars[0].close;
  for (const b of bars) {
    if (dir === 1) {
      if (b.close > extreme) { extreme = b.close; out.push({ time: b.time, value: extreme }); }
      else if (extreme - b.close >= rev) { dir = -1; extreme = b.close; out.push({ time: b.time, value: extreme }); }
    } else {
      if (b.close < extreme) { extreme = b.close; out.push({ time: b.time, value: extreme }); }
      else if (b.close - extreme >= rev) { dir = 1; extreme = b.close; out.push({ time: b.time, value: extreme }); }
    }
  }
  return retime(bars, out);
}

const close = (bars: Bar[]): ValuePoint[] => bars.map((b) => ({ time: b.time, value: b.close }));

// ---------- style table ----------

export const CANDLE_STYLES: CandleStyle[] = [
  { id: "candle", label: "Candles", hint: "Classic OHLC candles", kind: "candlestick", ohlc: (b) => b },
  { id: "hollow", label: "Hollow candles", hint: "Up bodies drawn hollow", kind: "candlestick", ohlc: (b) => b, hollow: true },
  { id: "ha", label: "Heikin Ashi", hint: "Smoothed averaged candles", kind: "candlestick", ohlc: heikinAshi },
  { id: "bars", label: "Bars (OHLC)", hint: "Open/high/low/close ticks", kind: "bar", ohlc: (b) => b },
  { id: "hlc-bars", label: "HLC bars", hint: "Bars without the open tick", kind: "bar", ohlc: (b) => b.map((c) => ({ ...c, open: c.close })) },
  { id: "high-low", label: "High-low", hint: "Range body only", kind: "candlestick", ohlc: (b) => b.map((c) => ({ ...c, open: c.low, close: c.high })) },
  { id: "line", label: "Line", hint: "Close price line", kind: "line", values: close },
  { id: "line-markers", label: "Line with markers", hint: "Close line with dots", kind: "line", values: close, markers: true },
  { id: "step-line", label: "Step line", hint: "Stepped close line", kind: "line", values: close, stepped: true },
  { id: "area", label: "Area", hint: "Filled close line", kind: "area", values: close },
  { id: "hlc-area", label: "HLC area", hint: "Filled (H+L+C)/3", kind: "area", values: (b) => b.map((c) => ({ time: c.time, value: (c.high + c.low + c.close) / 3 })) },
  { id: "baseline", label: "Baseline", hint: "Split above/below a base", kind: "baseline", values: close },
  { id: "columns", label: "Columns", hint: "Close as colored columns", kind: "histogram", values: close },
  { id: "renko", label: "Renko", hint: "ATR bricks, time-independent", kind: "candlestick", ohlc: renko },
  { id: "line-break", label: "Line break", hint: "Three-line break blocks", kind: "candlestick", ohlc: (b) => lineBreak(b, 3) },
  { id: "kagi", label: "Kagi", hint: "Reversal-based line", kind: "line", values: kagi, stepped: true },
  { id: "point-figure", label: "Point & Figure", hint: "Box/reversal columns", kind: "candlestick", ohlc: pointFigure },
  { id: "range", label: "Range bars", hint: "Fixed price-range bars", kind: "candlestick", ohlc: rangeBars },
  { id: "typical", label: "Typical price", hint: "(H+L+C)/3 line", kind: "line", values: (b) => b.map((c) => ({ time: c.time, value: (c.high + c.low + c.close) / 3 })) },
  { id: "median", label: "Median price", hint: "(H+L)/2 line", kind: "line", values: (b) => b.map((c) => ({ time: c.time, value: (c.high + c.low) / 2 })) },
  { id: "weighted", label: "Weighted close", hint: "(H+L+2C)/4 line", kind: "line", values: (b) => b.map((c) => ({ time: c.time, value: (c.high + c.low + 2 * c.close) / 4 })) },
];

export const CANDLE_STYLE_MAP: Record<CandleStyleId, CandleStyle> = Object.fromEntries(
  CANDLE_STYLES.map((s) => [s.id, s]),
) as Record<CandleStyleId, CandleStyle>;

export function getCandleStyle(id: string | undefined): CandleStyle {
  return CANDLE_STYLE_MAP[(id as CandleStyleId) ?? "candle"] ?? CANDLE_STYLE_MAP.candle;
}
