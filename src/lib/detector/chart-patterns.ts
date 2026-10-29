// Classic chart-pattern detector (Oct 2026, Marcus): double top/bottom, head and
// shoulders (and inverse), triangles and flags, read from swing pivots so the
// scanner can flag a pattern while it is still forming, with its trigger level.
// Evidence tier B (context.chart_pattern): may move the grade one step, never blocks.

import type { ObCandle } from "@/lib/orderBlocks";

export type PatternName =
  | "Double top" | "Double bottom" | "Head and shoulders" | "Inverse head and shoulders"
  | "Ascending triangle" | "Descending triangle" | "Symmetrical triangle" | "Bull flag" | "Bear flag";

export type PatternRead = {
  name: PatternName;
  direction: "bullish" | "bearish" | "neutral";
  status: "forming" | "confirmed";
  /** Level whose close-through confirms the pattern (neckline / breakout line). */
  trigger: number;
  /** Level whose close-through cancels the pattern. */
  invalidation: number;
  endTime: number;
  text: string;
};

type Pivot = { i: number; price: number; kind: "H" | "L" };

function atr(c: ObCandle[], n = 14): number {
  const s = c.slice(-n - 1);
  let sum = 0;
  for (let i = 1; i < s.length; i++) {
    const p = s[i - 1]!, b = s[i]!;
    sum += Math.max(b.high - b.low, Math.abs(b.high - p.close), Math.abs(b.low - p.close));
  }
  return s.length > 1 ? sum / (s.length - 1) : 0;
}

export function findPivots(c: ObCandle[], k = 3): Pivot[] {
  const out: Pivot[] = [];
  for (let i = k; i < c.length - k; i++) {
    let hi = true, lo = true;
    for (let j = i - k; j <= i + k; j++) {
      if (j === i) continue;
      if (c[j]!.high >= c[i]!.high) hi = false;
      if (c[j]!.low <= c[i]!.low) lo = false;
    }
    if (hi) out.push({ i, price: c[i]!.high, kind: "H" });
    if (lo) out.push({ i, price: c[i]!.low, kind: "L" });
  }
  return out.sort((a, b) => a.i - b.i);
}

const fmt = (n: number) => (Math.abs(n) >= 100 ? n.toFixed(2) : n.toFixed(5));

function make(name: PatternName, direction: PatternRead["direction"], status: PatternRead["status"], trigger: number, invalidation: number, endTime: number): PatternRead {
  const verb = direction === "bullish" ? "above" : direction === "bearish" ? "below" : "through";
  const text = status === "confirmed"
    ? `Chart pattern: ${name} confirmed - price closed ${verb} ${fmt(trigger)}. Cancelled on a close back past ${fmt(invalidation)}.`
    : `Chart pattern: ${name} forming. It confirms on a close ${verb} ${fmt(trigger)}; cancelled past ${fmt(invalidation)}.`;
  return { name, direction, status, trigger, invalidation, endTime, text };
}

function doubles(c: ObCandle[], piv: Pivot[], tol: number, a: number): PatternRead | null {
  const last = c[c.length - 1]!;
  for (const top of [true, false]) {
    const ext = piv.filter((p) => p.kind === (top ? "H" : "L"));
    if (ext.length < 2) continue;
    const p1 = ext[ext.length - 2]!, p2 = ext[ext.length - 1]!;
    if (p2.i - p1.i < 5 || Math.abs(p1.price - p2.price) > tol) continue;
    const mid = piv.filter((p) => p.kind === (top ? "L" : "H") && p.i > p1.i && p.i < p2.i);
    if (!mid.length) continue;
    const neck = top ? Math.min(...mid.map((m) => m.price)) : Math.max(...mid.map((m) => m.price));
    const depth = Math.abs((p1.price + p2.price) / 2 - neck);
    if (depth < 1.5 * a) continue;
    const extreme = top ? Math.max(p1.price, p2.price) : Math.min(p1.price, p2.price);
    const after = c.slice(p2.i + 1);
    if (after.some((b) => (top ? b.close > extreme + tol : b.close < extreme - tol))) continue;
    const broke = after.some((b) => (top ? b.close < neck : b.close > neck));
    if (broke && after.length > 30) continue; // stale
    return make(top ? "Double top" : "Double bottom", top ? "bearish" : "bullish", broke ? "confirmed" : "forming", neck, extreme, last.time);
  }
  return null;
}

function headShoulders(c: ObCandle[], piv: Pivot[], tol: number, a: number): PatternRead | null {
  const last = c[c.length - 1]!;
  for (const top of [true, false]) {
    const ext = piv.filter((p) => p.kind === (top ? "H" : "L"));
    if (ext.length < 3) continue;
    const [l, h, r] = ext.slice(-3) as [Pivot, Pivot, Pivot];
    const higher = (x: number, y: number) => (top ? x - y : y - x);
    if (higher(h.price, l.price) < 0.75 * a || higher(h.price, r.price) < 0.75 * a) continue;
    if (Math.abs(l.price - r.price) > 1.5 * tol) continue;
    const t1 = piv.filter((p) => p.kind === (top ? "L" : "H") && p.i > l.i && p.i < h.i);
    const t2 = piv.filter((p) => p.kind === (top ? "L" : "H") && p.i > h.i && p.i < r.i);
    if (!t1.length || !t2.length) continue;
    const pick = (xs: Pivot[]) => (top ? Math.min(...xs.map((x) => x.price)) : Math.max(...xs.map((x) => x.price)));
    const neck = top ? Math.min(pick(t1), pick(t2)) : Math.max(pick(t1), pick(t2));
    const after = c.slice(r.i + 1);
    if (after.some((b) => (top ? b.close > h.price : b.close < h.price))) continue;
    const broke = after.some((b) => (top ? b.close < neck : b.close > neck));
    if (broke && after.length > 30) continue;
    return make(top ? "Head and shoulders" : "Inverse head and shoulders", top ? "bearish" : "bullish", broke ? "confirmed" : "forming", neck, r.price, last.time);
  }
  return null;
}

function triangles(c: ObCandle[], piv: Pivot[], tol: number, a: number): PatternRead | null {
  const last = c[c.length - 1]!;
  const recent = piv.filter((p) => p.i >= c.length - 60);
  const hs = recent.filter((p) => p.kind === "H").slice(-3);
  const ls = recent.filter((p) => p.kind === "L").slice(-3);
  if (hs.length < 2 || ls.length < 2) return null;
  const slope = (ps: Pivot[]) => (ps[ps.length - 1]!.price - ps[0]!.price) / Math.max(1, ps[ps.length - 1]!.i - ps[0]!.i);
  const sh = slope(hs), sl = slope(ls);
  const flat = (s: number, ps: Pivot[]) => Math.abs(s * (ps[ps.length - 1]!.i - ps[0]!.i)) <= tol;
  const top = Math.max(...hs.map((p) => p.price)), bot = Math.min(...ls.map((p) => p.price));
  if (top - bot < 1.5 * a) return null;
  const hiNow = hs[hs.length - 1]!.price, loNow = ls[ls.length - 1]!.price;
  const close = last.close;
  if (flat(sh, hs) && sl > 0 && !flat(sl, ls)) {
    return make("Ascending triangle", "bullish", close > top ? "confirmed" : "forming", top, loNow, last.time);
  }
  if (flat(sl, ls) && sh < 0 && !flat(sh, hs)) {
    return make("Descending triangle", "bearish", close < bot ? "confirmed" : "forming", bot, hiNow, last.time);
  }
  if (sh < 0 && sl > 0 && !flat(sh, hs) && !flat(sl, ls)) {
    if (close > hiNow) return make("Symmetrical triangle", "bullish", "confirmed", hiNow, loNow, last.time);
    if (close < loNow) return make("Symmetrical triangle", "bearish", "confirmed", loNow, hiNow, last.time);
    return make("Symmetrical triangle", "neutral", "forming", hiNow, loNow, last.time);
  }
  return null;
}

function flags(c: ObCandle[], a: number): PatternRead | null {
  const last = c[c.length - 1]!;
  for (let len = 4; len <= 15; len++) {
    const startCons = c.length - len;
    const poleEnd = startCons - 1;
    if (poleEnd - 8 < 0) break;
    const pole = c.slice(poleEnd - 8, poleEnd + 1);
    const cons = c.slice(startCons);
    const poleLow = Math.min(...pole.map((b) => b.low)), poleHigh = Math.max(...pole.map((b) => b.high));
    const up = pole[pole.length - 1]!.close > pole[0]!.open;
    const move = poleHigh - poleLow;
    if (move < 4 * a) continue;
    const consBody = cons.slice(0, -1);
    if (consBody.length < 3) continue;
    const ch = Math.max(...consBody.map((b) => b.high)), cl = Math.min(...consBody.map((b) => b.low));
    if (up) {
      if (poleHigh - cl > 0.5 * move || ch > poleHigh + 0.25 * a) continue;
      return make("Bull flag", "bullish", last.close > ch ? "confirmed" : "forming", ch, cl, last.time);
    }
    if (cl - poleLow > 0.5 * move || cl < poleLow - 0.25 * a) continue;
    return make("Bear flag", "bearish", last.close < cl ? "confirmed" : "forming", cl, ch, last.time);
  }
  return null;
}

/** Most relevant pattern on the series, or null. Priority: H&S, doubles, flags, triangles. */
export function detectChartPattern(c: ObCandle[]): PatternRead | null {
  if (c.length < 30) return null;
  const s = c.slice(-150);
  const a = atr(s) || Math.abs(s[s.length - 1]!.close) * 0.002;
  const tol = 0.6 * a;
  const piv = findPivots(s);
  return headShoulders(s, piv, tol, a) ?? doubles(s, piv, tol, a) ?? flags(s, a) ?? triangles(s, piv, tol, a);
}

const GRADE_ORDER = ["NO ENTRY", "C", "B", "A", "A+"] as const;
type G = (typeof GRADE_ORDER)[number];

/**
 * Grade nudge. A confirmed pattern that agrees with the trade lifts one letter (to A at most)
 * when no other cap binds; a confirmed pattern against the trade drops one letter (to C at
 * least). Forming patterns only add a note with the trigger level. Never produces NO ENTRY.
 */
export function applyChartPattern(
  grade: string, bias: "Long" | "Short" | "Neutral", read: PatternRead | null, otherCapBinding: boolean,
): { grade: string; action: "up" | "down" | "none" } {
  const i = GRADE_ORDER.indexOf(grade as G);
  if (!read || bias === "Neutral" || i < 1 || read.status !== "confirmed" || read.direction === "neutral") return { grade, action: "none" };
  const agrees = (bias === "Long") === (read.direction === "bullish");
  if (agrees) {
    if (!otherCapBinding && i < GRADE_ORDER.indexOf("A")) return { grade: GRADE_ORDER[i + 1]!, action: "up" };
    return { grade, action: "none" };
  }
  if (i > 1) return { grade: GRADE_ORDER[i - 1]!, action: "down" };
  return { grade, action: "none" };
}
