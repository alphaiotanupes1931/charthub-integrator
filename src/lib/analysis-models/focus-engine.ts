// The Trading Channel engine — deterministic core for Model 2.
//
// Implements the measurable subset of the Trading Channel rulebook
// (focus-rulebook.ts): objective trend (rule 1), trade-with-trend (2),
// break-and-retest entry zone (3), pressure candles (4-7), ATR stops (8),
// structure targets (9), minimum 1.5R (10), and the 20-MA trend filter (11).
//
// Fully deterministic and pure: no network, no AI, no randomness. Give it the
// same closed bars twice and it returns the same read twice. The AI is only
// ever handed this output to narrate; it cannot move direction, entry, stop,
// target or grade.

import { FOCUS_RULEBOOK_VERSION } from "./focus-rulebook";

export type FocusCandle = { time: number; open: number; high: number; low: number; close: number };

export type FocusGrade = "A" | "B" | "C" | "NO ENTRY";

export type FocusEntryPattern = "38.2 candle" | "engulfing" | "close beyond" | "plain pressure";

export type FocusRuleCheck = { id: number; title: string; pass: boolean; detail: string };

export type FocusRead = {
  rulebookVersion: string;
  trend: "up" | "down" | "none";
  bias: "Long" | "Short" | "Neutral";
  grade: FocusGrade;
  /** Why the grade is not higher, when something capped it. */
  cap: string | null;
  setup: "break-retest" | null;
  entryPattern: FocusEntryPattern | null;
  entry: number | null;
  stop: number | null;
  tp1: number | null;
  rr: number | null;
  atr: number;
  ma20: number | null;
  aboveMa20: boolean | null;
  /** The broken structure level being retested. */
  level: number | null;
  lastPrice: number;
  rules: FocusRuleCheck[];
  note: string;
};

const MIN_BARS = 40;
const PIVOT = 2; // bars each side for a swing point

/** Simple 14-bar ATR over closed bars. */
export function focusAtr(candles: FocusCandle[], period = 14): number {
  if (candles.length < period + 1) return 0;
  const rows = candles.slice(-(period + 1));
  let sum = 0;
  for (let i = 1; i < rows.length; i++) {
    const c = rows[i]!;
    const p = rows[i - 1]!;
    sum += Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close));
  }
  return sum / period;
}

function sma(values: number[], period: number): number | null {
  if (values.length < period) return null;
  const slice = values.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

type Pivot = { index: number; price: number };

function pivotHighs(c: FocusCandle[]): Pivot[] {
  const out: Pivot[] = [];
  for (let i = PIVOT; i < c.length - PIVOT; i++) {
    const h = c[i]!.high;
    let ok = true;
    for (let j = i - PIVOT; j <= i + PIVOT; j++) if (j !== i && c[j]!.high >= h) { ok = false; break; }
    if (ok) out.push({ index: i, price: h });
  }
  return out;
}

function pivotLows(c: FocusCandle[]): Pivot[] {
  const out: Pivot[] = [];
  for (let i = PIVOT; i < c.length - PIVOT; i++) {
    const l = c[i]!.low;
    let ok = true;
    for (let j = i - PIVOT; j <= i + PIVOT; j++) if (j !== i && c[j]!.low <= l) { ok = false; break; }
    if (ok) out.push({ index: i, price: l });
  }
  return out;
}

/** The bullish pressure read on the last closed bar (rules 4-7). */
function bullishPattern(prev: FocusCandle, cur: FocusCandle): FocusEntryPattern | null {
  if (cur.close <= cur.open) return null;
  const range = cur.high - cur.low;
  if (range > 0) {
    const fib382 = cur.low + range * 0.382;
    if (Math.min(cur.open, cur.close) > fib382) return "38.2 candle";
  }
  const prevBody = Math.abs(prev.close - prev.open);
  const curBody = Math.abs(cur.close - cur.open);
  if (prev.close < prev.open && curBody > prevBody) return "engulfing";
  if (cur.close > prev.high) return "close beyond";
  return "plain pressure";
}

function bearishPattern(prev: FocusCandle, cur: FocusCandle): FocusEntryPattern | null {
  if (cur.close >= cur.open) return null;
  const range = cur.high - cur.low;
  if (range > 0) {
    const fib382 = cur.high - range * 0.382;
    if (Math.max(cur.open, cur.close) < fib382) return "38.2 candle";
  }
  const prevBody = Math.abs(prev.close - prev.open);
  const curBody = Math.abs(cur.close - cur.open);
  if (prev.close > prev.open && curBody > prevBody) return "engulfing";
  if (cur.close < prev.low) return "close beyond";
  return "plain pressure";
}

type Side = "long" | "short";

type SideRead = {
  trendOk: boolean;
  level: number | null;
  breakoutIndex: number | null;
  pullbackExtreme: number | null;
  atZone: boolean;
  voided: boolean;
  pattern: FocusEntryPattern | null;
  stopRef: number | null;
  target: number | null;
};

/**
 * One side of the market, read exactly as the rulebook states:
 * impulsive close through a swing point, pullback toward the broken level,
 * trend alive until the pullback's origin low/high closes through, pressure
 * candle at the zone.
 */
function readSide(c: FocusCandle[], atr: number, side: Side): SideRead {
  const n = c.length;
  const last = c[n - 1]!;
  const prev = c[n - 2]!;
  const tol = 0.25 * atr;
  const pivots = side === "long" ? pivotHighs(c) : pivotLows(c);

  const empty: SideRead = {
    trendOk: false, level: null, breakoutIndex: null, pullbackExtreme: null,
    atZone: false, voided: false, pattern: null, stopRef: null, target: null,
  };
  if (pivots.length < 2 || atr <= 0) return empty;

  // Most recent impulsive break: a close through a pivot that formed earlier.
  let breakout: { index: number; level: number } | null = null;
  for (let p = pivots.length - 2; p >= 0 && !breakout; p--) {
    const piv = pivots[p]!;
    for (let i = Math.max(piv.index + PIVOT + 1, n - 60); i < n; i++) {
      const broke = side === "long" ? c[i]!.close > piv.price : c[i]!.close < piv.price;
      if (broke) { breakout = { index: i, level: piv.price }; break; }
    }
  }
  if (!breakout) return empty;

  // The pullback whose extreme must hold: the lowest low (longs) between the
  // pivot and the breakout bar — the breather that produced the impulsive move.
  let origin = side === "long" ? Infinity : -Infinity;
  for (let i = breakout.index - 1; i >= 0 && i >= breakout.index - 30; i--) {
    const bar = c[i]!;
    if (side === "long") origin = Math.min(origin, bar.low);
    else origin = Math.max(origin, bar.high);
    // Stop at the swing the impulsive move launched from.
    if (side === "long" ? bar.low <= origin && i < breakout.index - 3 : bar.high >= origin && i < breakout.index - 3) {
      // keep scanning; origin tracks the extreme over the whole pre-breakout leg
    }
  }
  if (!isFinite(origin)) return empty;

  // Trend alive? No close back through that origin extreme since the breakout.
  let voided = false;
  for (let i = breakout.index + 1; i < n; i++) {
    const cl = c[i]!.close;
    if (side === "long" ? cl < origin : cl > origin) { voided = true; break; }
  }
  const trendOk = !voided;

  // Swing made since the breakout — the pullback extreme that protects the stop.
  let swing = side === "long" ? Infinity : -Infinity;
  for (let i = breakout.index; i < n; i++) {
    swing = side === "long" ? Math.min(swing, c[i]!.low) : Math.max(swing, c[i]!.high);
  }
  const pullbackExtreme = isFinite(swing) ? swing : null;

  // Retest: price has come back to the broken level without closing through it.
  const brokeBackThrough = side === "long"
    ? last.close < breakout.level - tol
    : last.close > breakout.level + tol;
  const nearLevel = Math.abs(last.close - breakout.level) <= 0.75 * atr
    || (side === "long" ? last.low <= breakout.level + tol : last.high >= breakout.level - tol);
  const atZone = nearLevel && !brokeBackThrough;

  const pattern = side === "long" ? bullishPattern(prev, last) : bearishPattern(prev, last);

  // First opposing structure beyond price: nearest pivot on the far side.
  const opposing = side === "long" ? pivotHighs(c) : pivotLows(c);
  const beyond = opposing
    .filter((p) => (side === "long" ? p.price > last.close : p.price < last.close))
    .sort((a, b) => (side === "long" ? a.price - b.price : b.price - a.price));
  const target = beyond.length ? beyond[0]!.price : null;

  return {
    trendOk,
    level: breakout.level,
    breakoutIndex: breakout.index,
    pullbackExtreme,
    atZone,
    voided: brokeBackThrough,
    pattern,
    stopRef: pullbackExtreme,
    target,
  };
}

const fmt = (v: number | null): string => (v == null ? "-" : String(Math.round(v * 100000) / 100000));

/** Deterministic Trading Channel read over closed bars. */
export function focusAnalysis(candles: FocusCandle[]): FocusRead {
  const atr = focusAtr(candles);
  const lastPrice = candles.length ? candles[candles.length - 1]!.close : 0;
  const ma20 = sma(candles.map((k) => k.close), 20);

  const rules: FocusRuleCheck[] = [];
  const check = (id: number, title: string, pass: boolean, detail: string) =>
    rules.push({ id, title, pass, detail });

  const base: FocusRead = {
    rulebookVersion: FOCUS_RULEBOOK_VERSION,
    trend: "none", bias: "Neutral", grade: "NO ENTRY", cap: null,
    setup: null, entryPattern: null,
    entry: null, stop: null, tp1: null, rr: null,
    atr, ma20, aboveMa20: ma20 == null ? null : lastPrice > ma20,
    level: null, lastPrice, rules, note: "",
  };

  if (candles.length < MIN_BARS || atr <= 0) {
    base.note = "Not enough closed bars to read structure; the model stays flat.";
    check(1, "Objective trend", false, "insufficient data");
    return base;
  }

  const long = readSide(candles, atr, "long");
  const short = readSide(candles, atr, "short");

  // Rule 1: objective trend. A side with an unbroken pullback origin is trending.
  const trend: "up" | "down" | "none" =
    long.trendOk && long.breakoutIndex != null && (short.breakoutIndex == null || long.breakoutIndex >= short.breakoutIndex) ? "up"
    : short.trendOk && short.breakoutIndex != null ? "down"
    : "none";
  base.trend = trend;
  check(1, "Objective trend", trend !== "none",
    trend === "none"
      ? "no impulsive close through structure with an intact pullback"
      : trend === "up"
        ? `close above ${fmt(long.level)} with the pullback low at ${fmt(long.pullbackExtreme)} unbroken`
        : `close below ${fmt(short.level)} with the pullback high at ${fmt(short.pullbackExtreme)} unbroken`);

  const side: Side | null = trend === "up" ? "long" : trend === "down" ? "short" : null;
  check(2, "Trade with the trend", side != null,
    side ? `${side} side only` : "no trend, so no direction to take");

  const r = side === "long" ? long : side === "short" ? short : null;
  if (!side || !r) {
    base.note = "No objective trend on the closed bars, so The Trading Channel model has no trade here.";
    return base;
  }

  base.bias = side === "long" ? "Long" : "Short";
  base.level = r.level;

  // Rule 3: break and retest.
  check(3, "Break and retest zone", r.atZone,
    r.voided
      ? `price closed back through ${fmt(r.level)} - retest void`
      : r.atZone
        ? `price is back at the broken level ${fmt(r.level)}`
        : `broken level ${fmt(r.level)} not retested yet - wait, do not chase`);
  if (!r.atZone) {
    base.cap = r.voided ? "retest voided" : "waiting for the retest";
    base.note = r.voided
      ? `The break of ${fmt(r.level)} failed - price closed back through it. No trade.`
      : `${base.bias} bias from the break of ${fmt(r.level)}, but price is not at the level. The rulebook says wait for the pullback; do not chase.`;
    base.bias = "Neutral";
    return base;
  }

  // Rules 4-7: pressure candle at the zone.
  base.entryPattern = r.pattern;
  check(4, "Pressure candle", r.pattern != null,
    r.pattern ? `${r.pattern} on the last closed bar` : "no pressure candle at the zone yet");
  if (!r.pattern) {
    base.cap = "no pressure candle";
    base.note = `Price is at the level but has not shown ${side === "long" ? "buying" : "selling"} pressure. Wait for the candle; do not pre-empt it.`;
    base.bias = "Neutral";
    return base;
  }

  // Rule 8: stop 1 ATR beyond the protecting swing.
  const entry = lastPrice;
  const stop = side === "long" ? (r.stopRef! - atr) : (r.stopRef! + atr);
  const risk = Math.abs(entry - stop);
  check(8, "ATR stop", risk > 0, `stop 1x ATR beyond the pullback ${side === "long" ? "low" : "high"} (${fmt(r.stopRef)})`);
  if (risk <= 0) {
    base.note = "Could not place an ATR stop beyond a real swing; no trade.";
    base.bias = "Neutral";
    return base;
  }

  // Rules 9-10: structure target paying at least 1.5R.
  let tp1 = r.target;
  let rr = tp1 != null ? Math.abs(tp1 - entry) / risk : null;
  let cap: string | null = null;
  if (tp1 == null || rr == null || rr < 1.5) {
    const measured = side === "long" ? entry + 2 * risk : entry - 2 * risk;
    tp1 = measured;
    rr = 2;
    cap = "no structure target paying 1.5R nearby - target is a 2R measured move instead";
  }
  check(9, "Structure target", cap == null,
    cap ?? `next opposing structure at ${fmt(tp1)}`);
  check(10, "Minimum 1.5R", (rr ?? 0) >= 1.5, `planned R:R ${rr!.toFixed(2)}`);

  // Rule 11: 20-MA filter for continuation quality.
  const aboveMa20 = ma20 == null ? null : lastPrice > ma20;
  const maAligned = aboveMa20 == null ? false : side === "long" ? aboveMa20 : !aboveMa20;
  check(11, "20-MA filter", maAligned,
    ma20 == null ? "no 20-MA read" : maAligned ? "price riding the 20 MA" : "price on the wrong side of the 20 MA");

  // Grade. This model never issues A+ in v1: that grade is reserved for
  // multi-timeframe alignment the Trading Channel material does not define.
  let grade: FocusGrade = "B";
  if (cap) grade = "C";
  else if (!maAligned) { grade = "C"; cap = "not aligned with the 20-period MA"; }
  else if (r.pattern !== "plain pressure") grade = "A";
  base.grade = grade;
  base.cap = cap;
  base.entry = entry;
  base.stop = stop;
  base.tp1 = tp1;
  base.rr = Math.round((rr ?? 0) * 100) / 100;
  base.setup = "break-retest";
  base.note = `${grade} ${base.bias}: break and retest of ${fmt(r.level)}, ${r.pattern} at the zone, stop 1x ATR beyond ${fmt(r.stopRef)}, target ${fmt(tp1)} (${base.rr}R).${cap ? ` Capped: ${cap}.` : ""}`;
  return base;
}

/** The authoritative block handed to the planner/coach for Model 2 scans. */
export function focusContextBlock(read: FocusRead, ticker: string, interval: string): string {
  const lines = read.rules.map((r) => `  Rule ${r.id} ${r.title}: ${r.pass ? "PASS" : "FAIL"} - ${r.detail}`);
  return [
    `THE TRADING CHANNEL MODEL — DETERMINISTIC READ (${read.rulebookVersion}) for ${ticker} on ${interval}.`,
    "This model is fed ONLY the Trading Channel rulebook. No order blocks, no fair value gaps, no other TradeMind Classic library applies.",
    "The numbers below are computed in code from closed bars. You narrate them; you may not contradict or move direction, entry, stop, target, or grade.",
    `Trend: ${read.trend}. Bias: ${read.bias}. Grade: ${read.grade}.${read.cap ? ` Cap: ${read.cap}.` : ""}`,
    read.entry != null
      ? `Setup: break and retest of ${fmt(read.level)}. Entry ${fmt(read.entry)}, stop ${fmt(read.stop)} (1x ATR beyond the pullback extreme), target ${fmt(read.tp1)} (${read.rr}R). Pressure candle: ${read.entryPattern}.`
      : "No valid setup: the rulebook's conditions are not all met, so the answer is NO ENTRY.",
    `ATR(14): ${fmt(read.atr)}. 20-MA: ${fmt(read.ma20)}. Last close: ${fmt(read.lastPrice)}.`,
    "Rule checks:",
    ...lines,
    read.note,
  ].join("\n");
}
