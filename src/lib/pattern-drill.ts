// Finds real candlestick and chart patterns on an instrument's CLOSED candles
// so the flashcard drill can show traders what the pattern looks like on the
// market they trade, not a textbook drawing. Pure and deterministic.

export type DrillBar = { time: number; open: number; high: number; low: number; close: number };
export type Bias = "bullish" | "bearish";

export type FoundPattern = {
  kind: "candle" | "chart";
  name: string;
  bias: Bias;
  /** Bars to draw (context before + the pattern). */
  window: DrillBar[];
  /** Index range inside `window` that forms the pattern. */
  highlight: [number, number];
  why: string;
};

export const CANDLE_NAMES = [
  "Bullish engulfing",
  "Bearish engulfing",
  "Hammer",
  "Shooting star",
  "Morning star",
  "Evening star",
  "Bullish harami",
  "Bearish harami",
] as const;

const body = (b: DrillBar) => Math.abs(b.close - b.open);
const range = (b: DrillBar) => Math.max(1e-12, b.high - b.low);
const up = (b: DrillBar) => b.close > b.open;
const down = (b: DrillBar) => b.close < b.open;

function priorTrend(bars: DrillBar[], i: number, n = 5): "up" | "down" | "flat" {
  if (i - n < 0) return "flat";
  const d = bars[i - 1].close - bars[i - n].close;
  const avg = bars.slice(i - n, i).reduce((s, b) => s + range(b), 0) / n;
  if (d > avg * 0.8) return "up";
  if (d < -avg * 0.8) return "down";
  return "flat";
}

function candleAt(bars: DrillBar[], i: number): Omit<FoundPattern, "window" | "highlight" | "kind"> & { len: number } | null {
  const c = bars[i], p = bars[i - 1], pp = bars[i - 2];
  if (!c || !p) return null;
  const t = priorTrend(bars, i - (pp ? 2 : 1));
  if (pp && t === "down" && down(pp) && body(pp) > range(pp) * 0.5 && body(p) < range(p) * 0.3 && up(c) && c.close > (pp.open + pp.close) / 2)
    return { name: "Morning star", bias: "bullish", len: 3, why: "A big red candle, a small indecision candle, then a strong green close past the middle of the first. Sellers ran out and buyers took over." };
  if (pp && t === "up" && up(pp) && body(pp) > range(pp) * 0.5 && body(p) < range(p) * 0.3 && down(c) && c.close < (pp.open + pp.close) / 2)
    return { name: "Evening star", bias: "bearish", len: 3, why: "A big green candle, a small indecision candle, then a strong red close past the middle of the first. Buyers ran out and sellers took over." };
  const t2 = priorTrend(bars, i - 1);
  if (t2 === "down" && down(p) && up(c) && c.close >= p.open && c.open <= p.close && body(c) > body(p))
    return { name: "Bullish engulfing", bias: "bullish", len: 2, why: "After selling, a green body fully covers the prior red body. Buyers overpowered the sellers." };
  if (t2 === "up" && up(p) && down(c) && c.close <= p.open && c.open >= p.close && body(c) > body(p))
    return { name: "Bearish engulfing", bias: "bearish", len: 2, why: "After buying, a red body fully covers the prior green body. Sellers overpowered the buyers." };
  if (t2 === "down" && down(p) && body(p) > range(p) * 0.6 && up(c) && Math.max(c.open, c.close) < p.open && Math.min(c.open, c.close) > p.close && body(c) < body(p) * 0.5)
    return { name: "Bullish harami", bias: "bullish", len: 2, why: "A small green body sits inside the prior big red body. Selling pressure is fading." };
  if (t2 === "up" && up(p) && body(p) > range(p) * 0.6 && down(c) && Math.max(c.open, c.close) < p.close && Math.min(c.open, c.close) > p.open && body(c) < body(p) * 0.5)
    return { name: "Bearish harami", bias: "bearish", len: 2, why: "A small red body sits inside the prior big green body. Buying pressure is fading." };
  const lower = Math.min(c.open, c.close) - c.low;
  const upper = c.high - Math.max(c.open, c.close);
  const t1 = priorTrend(bars, i);
  if (t1 === "down" && lower >= body(c) * 2 && upper <= range(c) * 0.15 && body(c) > 0)
    return { name: "Hammer", bias: "bullish", len: 1, why: "After a drop, a long lower wick with a small body near the top. Sellers pushed down and buyers pushed it back." };
  if (t1 === "up" && upper >= body(c) * 2 && lower <= range(c) * 0.15 && body(c) > 0)
    return { name: "Shooting star", bias: "bearish", len: 1, why: "After a rise, a long upper wick with a small body near the bottom. Buyers pushed up and sellers slammed it back." };
  return null;
}

type Pivot = { i: number; price: number; type: "H" | "L" };

function pivots(bars: DrillBar[], k = 3): Pivot[] {
  const out: Pivot[] = [];
  for (let i = k; i < bars.length - k; i++) {
    const w = bars.slice(i - k, i + k + 1);
    if (bars[i].high === Math.max(...w.map((b) => b.high))) out.push({ i, price: bars[i].high, type: "H" });
    else if (bars[i].low === Math.min(...w.map((b) => b.low))) out.push({ i, price: bars[i].low, type: "L" });
  }
  return out;
}

function atr(bars: DrillBar[]): number {
  const s = bars.slice(-30);
  return s.reduce((a, b) => a + range(b), 0) / Math.max(1, s.length);
}

function chartPatterns(bars: DrillBar[]): Array<{ name: string; bias: Bias; start: number; end: number; why: string }> {
  const ps = pivots(bars);
  const tol = atr(bars) * 0.6;
  const found: Array<{ name: string; bias: Bias; start: number; end: number; why: string }> = [];
  const H = ps.filter((p) => p.type === "H");
  const L = ps.filter((p) => p.type === "L");
  for (let j = 2; j < H.length; j++) {
    const [a, b, c] = [H[j - 2], H[j - 1], H[j]];
    if (b.price > a.price + tol && b.price > c.price + tol && Math.abs(a.price - c.price) < tol)
      found.push({ name: "Head and shoulders", bias: "bearish", start: a.i, end: c.i, why: "Three peaks with the middle one highest. Buyers failed to make a new high on the right shoulder, a common top." });
  }
  for (let j = 2; j < L.length; j++) {
    const [a, b, c] = [L[j - 2], L[j - 1], L[j]];
    if (b.price < a.price - tol && b.price < c.price - tol && Math.abs(a.price - c.price) < tol)
      found.push({ name: "Inverse head and shoulders", bias: "bullish", start: a.i, end: c.i, why: "Three troughs with the middle one lowest. Sellers failed to make a new low on the right shoulder, a common bottom." });
  }
  for (let j = 1; j < H.length; j++) {
    const [a, b] = [H[j - 1], H[j]];
    if (b.i - a.i >= 5 && Math.abs(a.price - b.price) < tol * 0.6) {
      const mid = Math.min(...bars.slice(a.i, b.i + 1).map((x) => x.low));
      if (a.price - mid > tol * 2) found.push({ name: "Double top", bias: "bearish", start: a.i, end: b.i, why: "Price hit the same high twice and could not break it. That ceiling often turns price lower." });
    }
  }
  for (let j = 1; j < L.length; j++) {
    const [a, b] = [L[j - 1], L[j]];
    if (b.i - a.i >= 5 && Math.abs(a.price - b.price) < tol * 0.6) {
      const mid = Math.max(...bars.slice(a.i, b.i + 1).map((x) => x.high));
      if (mid - a.price > tol * 2) found.push({ name: "Double bottom", bias: "bullish", start: a.i, end: b.i, why: "Price hit the same low twice and could not break it. That floor often turns price higher." });
    }
  }
  return found;
}

/** Most recent patterns on closed candles (drops the forming bar). */
export function findPatterns(raw: DrillBar[] | undefined): FoundPattern[] {
  if (!raw || raw.length < 20) return [];
  const bars = raw.slice(0, -1);
  const out: FoundPattern[] = [];
  const seen = new Set<string>();
  for (let i = bars.length - 1; i >= 10 && out.length < 6; i--) {
    const p = candleAt(bars, i);
    if (p && !seen.has(p.name)) {
      seen.add(p.name);
      const start = Math.max(0, i - p.len + 1 - 8);
      const end = Math.min(bars.length - 1, i + 2);
      out.push({ kind: "candle", name: p.name, bias: p.bias, why: p.why, window: bars.slice(start, end + 1), highlight: [i - p.len + 1 - start, i - start] });
    }
  }
  const cps = chartPatterns(bars).sort((a, b) => b.end - a.end);
  for (const c of cps) {
    if (seen.has(c.name)) continue;
    seen.add(c.name);
    const start = Math.max(0, c.start - 6);
    const end = Math.min(bars.length - 1, c.end + 4);
    out.push({ kind: "chart", name: c.name, bias: c.bias, why: c.why, window: bars.slice(start, end + 1), highlight: [c.start - start, c.end - start] });
  }
  return out;
}

/** Four name choices including the right one, deterministic by seed. */
export function nameChoices(correct: string, seed: number): string[] {
  const others = CANDLE_NAMES.filter((n) => n !== correct);
  const picks: string[] = [];
  for (let k = 0; picks.length < 3; k++) picks.push(others[(seed + k * 3) % others.length]!);
  const all = [...new Set(picks)].slice(0, 3);
  all.splice(seed % 4, 0, correct);
  return all;
}
