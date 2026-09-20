// Photon Trading engine — deterministic core for Model 3.
//
// Implements the measurable subset of the Photon rulebook (photon-rulebook.ts):
// swing range mapping from wicks (rule 1), swing trend from closes through
// swing levels (rules 2-3), expect-the-pullback (4), strong/weak structure
// (5), internal change of character on wick breaks (6), entry when internal
// realigns with swing (7), stop beyond the protecting swing (8), weak-
// structure target with a 1.5R bar (9). Rule 10 (reversal anticipation,
// supply/demand refinement) is coach knowledge only in v1 - the engine never
// files a counter-trend signal on its own.
//
// Fully deterministic and pure: no network, no AI, no randomness. Give it the
// same closed bars twice and it returns the same read twice. The AI is only
// ever handed this output to narrate; it cannot move direction, entry, stop,
// target or grade.

import { PHOTON_RULEBOOK_VERSION } from "./photon-rulebook";

export type PhotonCandle = { time: number; open: number; high: number; low: number; close: number };

export type PhotonGrade = "A" | "B" | "C" | "NO ENTRY";

export type PhotonRuleCheck = { id: number; title: string; pass: boolean; detail: string };

export type PhotonRead = {
  rulebookVersion: string;
  swingTrend: "up" | "down" | "none";
  bias: "Long" | "Short" | "Neutral";
  grade: PhotonGrade;
  /** Why the grade is not higher, when something capped it. */
  cap: string | null;
  /** Where in the break -> pullback -> realign sequence the market sits. */
  phase: "no-trend" | "broken-awaiting-pullback" | "pullback-running" | "realigned" | "void";
  entry: number | null;
  stop: number | null;
  tp1: number | null;
  rr: number | null;
  /** The broken swing level (wick extreme). */
  swingLevel: number | null;
  /** The protecting swing point the stop hides behind. */
  protectingSwing: number | null;
  /** The weak structure the target aims at. */
  weakTarget: number | null;
  /** Bars since internal structure realigned with the swing trend. */
  barsSinceRealign: number | null;
  lastPrice: number;
  rules: PhotonRuleCheck[];
  note: string;
};

const MIN_BARS = 40;
const SWING_PIVOT = 2; // bars each side for a swing point
const INTERNAL_PIVOT = 1; // bars each side for internal (minor) structure
const MAX_BARS_SINCE_REALIGN = 10; // a realignment older than this is stale

type Pivot = { index: number; price: number };

function pivots(c: PhotonCandle[], width: number, kind: "high" | "low"): Pivot[] {
  const out: Pivot[] = [];
  for (let i = width; i < c.length - width; i++) {
    const v = kind === "high" ? c[i]!.high : c[i]!.low;
    let ok = true;
    for (let j = i - width; j <= i + width; j++) {
      if (j === i) continue;
      const other = kind === "high" ? c[j]!.high : c[j]!.low;
      if (kind === "high" ? other >= v : other <= v) { ok = false; break; }
    }
    if (ok) out.push({ index: i, price: v });
  }
  return out;
}

/** Simple 14-bar ATR over closed bars, used only as a distance unit. */
function photonAtr(candles: PhotonCandle[], period = 14): number {
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

type Side = "long" | "short";

type SideRead = {
  /** The most recent type-1 (close-beyond) swing break on this side. */
  breakoutIndex: number | null;
  /** The swing level that was broken (the pivot wick). */
  level: number | null;
  /** The pullback extreme since the break: highest high (shorts) / lowest low (longs). */
  pullbackExtreme: number | null;
  /** Index where the counter-trend internal ChoCh fired (pullback start). */
  pullbackStartIndex: number | null;
  /** Index where internal structure realigned with the swing trend. */
  realignIndex: number | null;
  /** The weak swing point on the far side - the minimum target. */
  weakTarget: number | null;
  /** Price closed back through the broken level after the break: setup void. */
  voided: boolean;
};

/**
 * One side of the market, read exactly as the rulebook states:
 * swing break on a close (type 1), pullback tracked by internal wick breaks
 * (type 2), entry when internal realigns, target the weak swing point.
 */
function readSide(c: PhotonCandle[], atr: number, side: Side): SideRead {
  const n = c.length;
  const empty: SideRead = {
    breakoutIndex: null, level: null, pullbackExtreme: null,
    pullbackStartIndex: null, realignIndex: null, weakTarget: null, voided: false,
  };

  const breakPivots = pivots(c, SWING_PIVOT, side === "long" ? "high" : "low");
  if (!breakPivots.length) return empty;

  // Most recent swing break: a CLOSE through a swing pivot that formed earlier
  // (type 1 mapping - a wick through the level is a liquidity grab, not a break).
  let breakout: { index: number; level: number } | null = null;
  for (let p = breakPivots.length - 1; p >= 0 && !breakout; p--) {
    const piv = breakPivots[p]!;
    for (let i = Math.max(piv.index + SWING_PIVOT + 1, n - 80); i < n; i++) {
      const broke = side === "long" ? c[i]!.close > piv.price : c[i]!.close < piv.price;
      if (broke) { breakout = { index: i, level: piv.price }; break; }
    }
  }
  if (!breakout) return empty;

  // Voided: a close back through the broken level after the break.
  let voided = false;
  for (let i = breakout.index + 1; i < n; i++) {
    const cl = c[i]!.close;
    if (side === "long" ? cl < breakout.level : cl > breakout.level) { voided = true; break; }
  }

  // The break leg's extreme: lowest low (shorts) / highest high (longs) printed
  // between the break and the start of the pullback.
  let legExtreme = side === "long" ? -Infinity : Infinity;

  // Internal change of character, tracked exactly the way the material reads it
  // on candles (type 2, wicks are enough): after the break, the first bar that
  // BREAKS THE PREVIOUS BAR'S EXTREME AGAINST the swing trend starts the
  // pullback ("the candle that fails to break the prior candle's low"); the
  // first bar that then breaks the previous bar's extreme WITH the swing trend
  // - after the pullback has moved at least 0.3x ATR - realigns internal
  // structure with the swing trend.
  let pullbackStartIndex: number | null = null;
  let realignIndex: number | null = null;
  let pullbackExtreme: number | null = null;
  for (let i = breakout.index + 1; i < n; i++) {
    const bar = c[i]!;
    const prev = c[i - 1]!;
    if (pullbackStartIndex == null) {
      legExtreme = side === "long" ? Math.max(legExtreme, prev.high) : Math.min(legExtreme, prev.low);
      const counter = side === "long" ? bar.low < prev.low : bar.high > prev.high;
      if (counter && isFinite(legExtreme)) {
        pullbackStartIndex = i;
        pullbackExtreme = side === "long" ? bar.low : bar.high;
      }
    } else if (realignIndex == null) {
      pullbackExtreme = side === "long"
        ? Math.min(pullbackExtreme!, bar.low)
        : Math.max(pullbackExtreme!, bar.high);
      const retraced = Math.abs(pullbackExtreme! - legExtreme) >= 0.3 * atr;
      const aligned = side === "long" ? bar.high > prev.high : bar.low < prev.low;
      if (aligned && retraced && i > pullbackStartIndex + 1) {
        realignIndex = i;
      }
    } else {
      // After a realignment the sequence can re-arm: a fresh counter break is a
      // new pullback, and the protecting swing only ever moves in the trade's
      // favour (deeper pullback low for longs, higher pullback high for shorts).
      pullbackExtreme = side === "long"
        ? Math.min(pullbackExtreme!, bar.low)
        : Math.max(pullbackExtreme!, bar.high);
      const counter = side === "long" ? bar.low < prev.low : bar.high > prev.high;
      if (counter) {
        pullbackStartIndex = i;
        realignIndex = null;
        legExtreme = side === "long"
          ? Math.max(...c.slice(breakout.index, i).map((b) => b.high))
          : Math.min(...c.slice(breakout.index, i).map((b) => b.low));
      }
    }
  }

  // Weak target (rule 9): the extreme the pullback left behind - the low that
  // failed to take out the swing high (shorts) or the high that failed to take
  // out the swing low (longs). That is the break leg's extreme.
  const weakTarget = isFinite(legExtreme) && pullbackStartIndex != null ? legExtreme : null;

  return {
    breakoutIndex: breakout.index,
    level: breakout.level,
    pullbackExtreme,
    pullbackStartIndex,
    realignIndex,
    weakTarget,
    voided,
  };
}

const fmt = (v: number | null): string => (v == null ? "-" : String(Math.round(v * 100000) / 100000));

/** Deterministic Photon Trading read over closed bars. */
export function photonAnalysis(candles: PhotonCandle[]): PhotonRead {
  const atr = photonAtr(candles);
  const lastPrice = candles.length ? candles[candles.length - 1]!.close : 0;

  const rules: PhotonRuleCheck[] = [];
  const check = (id: number, title: string, pass: boolean, detail: string) =>
    rules.push({ id, title, pass, detail });

  const base: PhotonRead = {
    rulebookVersion: PHOTON_RULEBOOK_VERSION,
    swingTrend: "none", bias: "Neutral", grade: "NO ENTRY", cap: null,
    phase: "no-trend",
    entry: null, stop: null, tp1: null, rr: null,
    swingLevel: null, protectingSwing: null, weakTarget: null,
    barsSinceRealign: null, lastPrice, rules, note: "",
  };

  if (candles.length < MIN_BARS || atr <= 0) {
    base.note = "Not enough closed bars to map structure; the model stays flat.";
    check(1, "Map the swing range", false, "insufficient data");
    return base;
  }

  const long = readSide(candles, "long");
  const short = readSide(candles, "short");

  // Rule 2: the trend belongs to the side with the most recent swing break.
  const trend: "up" | "down" | "none" =
    long.breakoutIndex != null && (short.breakoutIndex == null || long.breakoutIndex >= short.breakoutIndex) ? "up"
    : short.breakoutIndex != null ? "down"
    : "none";
  base.swingTrend = trend;
  check(2, "Break of structure defines the trend", trend !== "none",
    trend === "none"
      ? "no candle close through a swing level on either side"
      : trend === "up"
        ? `last swing break is a close above ${fmt(long.level)}`
        : `last swing break is a close below ${fmt(short.level)}`);

  const side: Side | null = trend === "up" ? "long" : trend === "down" ? "short" : null;
  const r = side === "long" ? long : side === "short" ? short : null;
  if (!side || !r) {
    base.note = "No swing break of structure on the closed bars, so Photon Trading has no trade here.";
    return base;
  }

  base.bias = side === "long" ? "Long" : "Short";
  base.swingLevel = r.level;
  base.protectingSwing = r.pullbackExtreme;
  base.weakTarget = r.weakTarget;

  // Rule 3 check is inherent in readSide (closes for the swing break, wicks for
  // internal); record it so the coach can show its work.
  check(3, "Closes for swings, wicks for internal", true,
    `swing break of ${fmt(r.level)} came from a candle close; internal shifts tracked on wicks`);

  // Rule 7: the setup is void if price closed back through the broken level.
  if (r.voided) {
    base.phase = "void";
    base.bias = "Neutral";
    check(7, "Enter when internal realigns", false, `price closed back through ${fmt(r.level)} - setup void`);
    base.note = `The break of ${fmt(r.level)} failed - price closed back through it. No trade.`;
    return base;
  }

  // Rule 4: after the break, expect the pullback - never chase.
  const pullbackStarted = r.pullbackStartIndex != null;
  check(4, "Expect the pullback after the break", pullbackStarted,
    pullbackStarted
      ? "the counter-trend change of character fired - pullback is or was running"
      : "fresh break with no pullback yet - wait, do not chase the break");
  if (!pullbackStarted) {
    base.phase = "broken-awaiting-pullback";
    base.bias = "Neutral";
    base.cap = "waiting for the pullback";
    base.note = `${side === "long" ? "Bullish" : "Bearish"} break of structure at ${fmt(r.level)}, but the rulebook expects a pullback first. Do not chase; wait for the internal change of character.`;
    return base;
  }

  // Rule 6/7: has internal structure realigned with the swing trend?
  const realigned = r.realignIndex != null && r.realignIndex > (r.pullbackStartIndex ?? 0);
  const barsSinceRealign = realigned ? candles.length - 1 - r.realignIndex! : null;
  base.barsSinceRealign = barsSinceRealign;
  check(6, "Change of character times the pullback", realigned,
    realigned
      ? `internal structure realigned with the ${trend} swing trend ${barsSinceRealign} bars ago`
      : "pullback still running - internal structure has not realigned yet");
  if (!realigned) {
    base.phase = "pullback-running";
    base.bias = "Neutral";
    base.cap = "pullback still running";
    base.note = `Pullback against the ${trend} swing trend is still running. The rulebook says wait for the change of character back in line with the swing before entering.`;
    return base;
  }

  // Rule 8: stop beyond the protecting swing (the pullback extreme).
  const entry = lastPrice;
  const buffer = 0.1 * atr;
  const stop = side === "long" ? r.pullbackExtreme! - buffer : r.pullbackExtreme! + buffer;
  const risk = Math.abs(entry - stop);
  check(8, "Stop behind the protecting swing", risk > 0,
    `stop beyond the pullback ${side === "long" ? "low" : "high"} at ${fmt(r.pullbackExtreme)}`);
  if (risk <= 0) {
    base.bias = "Neutral";
    base.note = "Could not place a stop beyond a real protecting swing; no trade.";
    return base;
  }

  // Rule 9: target weak structure at minimum, and it must pay 1.5R.
  let tp1 = r.weakTarget;
  let cap: string | null = null;
  let rr = tp1 != null ? Math.abs(tp1 - entry) / risk : null;
  if (tp1 == null || rr == null || rr < 1.5) {
    const measured = side === "long" ? entry + 2 * risk : entry - 2 * risk;
    cap = tp1 == null
      ? "no weak structure target mapped - target is a 2R measured move instead"
      : `weak structure at ${fmt(tp1)} pays only ${(rr ?? 0).toFixed(2)}R - target is a 2R measured move instead`;
    tp1 = measured;
    rr = 2;
  }
  check(9, "Target weak structure, minimum 1.5R", cap == null,
    cap ?? `weak ${side === "long" ? "high" : "low"} at ${fmt(tp1)} pays ${rr!.toFixed(2)}R`);

  // Grade. Freshness matters: an entry long after the realignment is chasing
  // the very move the rulebook says to wait out.
  const stale = barsSinceRealign != null && barsSinceRealign > MAX_BARS_SINCE_REALIGN;
  let grade: PhotonGrade = "B";
  if (stale) {
    grade = "C";
    cap = `realignment is ${barsSinceRealign} bars old - entering now is chasing`;
  } else if (cap) {
    grade = "C";
  } else if ((rr ?? 0) >= 2) {
    grade = "A";
  }
  // Photon v1 never issues A+: that grade is reserved for multi-timeframe
  // alignment the material defers to later videos.
  base.grade = grade;
  base.cap = cap;
  base.phase = "realigned";
  base.entry = entry;
  base.stop = stop;
  base.tp1 = tp1;
  base.rr = Math.round((rr ?? 0) * 100) / 100;
  base.note = `${grade} ${base.bias}: swing break of ${fmt(r.level)}, pullback to ${fmt(r.pullbackExtreme)}, internal structure realigned ${barsSinceRealign} bars ago. Stop beyond ${fmt(r.pullbackExtreme)}, target ${fmt(tp1)} (${base.rr}R).${cap ? ` Capped: ${cap}.` : ""}`;
  return base;
}

/** The authoritative block handed to the planner/coach for Model 3 scans. */
export function photonContextBlock(read: PhotonRead, ticker: string, interval: string): string {
  const lines = read.rules.map((r) => `  Rule ${r.id} ${r.title}: ${r.pass ? "PASS" : "FAIL"} - ${r.detail}`);
  return [
    `PHOTON TRADING MODEL — DETERMINISTIC READ (${read.rulebookVersion}) for ${ticker} on ${interval}.`,
    "This model is fed ONLY the Photon Trading rulebook: mechanical market-structure mapping. No order blocks, no fair value gaps, no pressure candles, no other model's library applies.",
    "The numbers below are computed in code from closed bars. You narrate them; you may not contradict or move direction, entry, stop, target, or grade.",
    `Swing trend: ${read.swingTrend}. Bias: ${read.bias}. Phase: ${read.phase}. Grade: ${read.grade}.${read.cap ? ` Cap: ${read.cap}.` : ""}`,
    read.entry != null
      ? `Setup: continuation after the swing break of ${fmt(read.swingLevel)}. Entry ${fmt(read.entry)}, stop beyond the protecting swing at ${fmt(read.stop)}, target weak structure at ${fmt(read.tp1)} (${read.rr}R).`
      : "No valid setup: the break -> pullback -> realign sequence is not complete, so the answer is NO ENTRY.",
    `Last close: ${fmt(read.lastPrice)}.`,
    "Rule checks:",
    ...lines,
    read.note,
  ].join("\n");
}
