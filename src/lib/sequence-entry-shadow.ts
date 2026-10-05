// Trial entry v3: the full sequence from the Oct 4 call.
// Session phase -> 1H phase -> sweep -> opposite break -> retest -> 15m OB
// inside 1H OB, entry on the candle body. Never traded; filed for comparison.

import { computeOrderBlocks, type ObCandle } from "@/lib/orderBlocks";
import { ENTRY_SEQUENCE_VERSION } from "@/lib/analysis-models/entry-sequence-rulebook";

export type SessionName = "Asia" | "London" | "New York";
export type SessionPhaseLabel = "consolidation" | "swept-high" | "swept-low" | "broke-up" | "broke-down" | "expansion" | "unknown";
export type StructuralPhase = "consolidation" | "accumulation" | "distribution" | "continuation-up" | "continuation-down";
export type SequenceStatus = "waiting-for-sweep" | "swept" | "broke-structure" | "retesting" | "no-order-block" | "against-bias" | "ready";

export type SessionPhaseRead = { session: SessionName; tradeDay: string; phase: SessionPhaseLabel; high: number; low: number } | null;

export type SequenceShadow = {
  version: string;
  sessionPhase: SessionPhaseRead;
  h1Phase: StructuralPhase;
  status: SequenceStatus;
  sweepTime: number | null;
  breakTime: number | null;
  breakLevel: number | null;
  entry: number | null;
  stop: number | null;
  target: number | null;
  fvg: boolean;
  label: string;
  note: string;
};

// ---------- sessions (New York local, DST-aware) ----------
const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" });
function ny(time: number): { date: string; hour: number } {
  const p = fmt.formatToParts(new Date(time * 1000));
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return { date: `${g("year")}-${g("month")}-${g("day")}`, hour: Number(g("hour")) };
}
function sessionOf(time: number): { name: SessionName; key: string } | null {
  const { date, hour } = ny(time);
  // Asia 19:00-03:00, London 03:00-08:00, New York 08:00-17:00 (non-overlapping).
  if (hour >= 19) return { name: "Asia", key: `${date}-A` };
  if (hour < 3) {
    const d = new Date(`${date}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - 1);
    return { name: "Asia", key: `${d.toISOString().slice(0, 10)}-A` };
  }
  if (hour < 8) return { name: "London", key: `${date}-L` };
  if (hour < 17) return { name: "New York", key: `${date}-N` };
  return null;
}

/** Label the last finished session against the one before it. Closed bars only. */
export function readSessionPhase(bars: ObCandle[], nowSec?: number): SessionPhaseRead {
  const now = nowSec ?? (bars.length ? bars[bars.length - 1]!.time + 3600 : 0);
  const closed = bars.filter((b) => b.time + 3600 <= now);
  const groups: { name: SessionName; key: string; bars: ObCandle[] }[] = [];
  for (const b of closed) {
    const s = sessionOf(b.time);
    if (!s) continue;
    const last = groups[groups.length - 1];
    if (last && last.key === s.key) last.bars.push(b);
    else groups.push({ ...s, bars: [b] });
  }
  // The newest group may still be running; it counts only if a later bar exists.
  const lastBar = closed[closed.length - 1];
  const curKey = lastBar ? sessionOf(lastBar.time)?.key : undefined;
  const done = groups.filter((g) => g.key !== curKey || (lastBar && sessionOf(now)?.key !== curKey));
  if (done.length < 2) return null;
  const cur = done[done.length - 1]!, prev = done[done.length - 2]!;
  if (cur.bars.length < 3) return null;
  const hi = (x: ObCandle[]) => Math.max(...x.map((b) => b.high));
  const lo = (x: ObCandle[]) => Math.min(...x.map((b) => b.low));
  const pH = hi(prev.bars), pL = lo(prev.bars), cH = hi(cur.bars), cL = lo(cur.bars);
  const closes = cur.bars.map((b) => b.close);
  const closedAbove = closes.some((c) => c > pH), closedBelow = closes.some((c) => c < pL);
  let phase: SessionPhaseLabel;
  if (closedAbove && !closedBelow) phase = cL < pL ? "expansion" : "broke-up";
  else if (closedBelow && !closedAbove) phase = cH > pH ? "expansion" : "broke-down";
  else if (closedAbove && closedBelow) phase = "expansion";
  else if (cH > pH && cL >= pL) phase = "swept-high";
  else if (cL < pL && cH <= pH) phase = "swept-low";
  else if (cH <= pH && cL >= pL) phase = "consolidation";
  else phase = "expansion";
  return { session: cur.name, tradeDay: cur.key.slice(0, 10), phase, high: cH, low: cL };
}

// ---------- 1H structure ----------
type Swing = { i: number; price: number };
function swings(c: ObCandle[]) {
  const highs: Swing[] = [], lows: Swing[] = [];
  for (let i = 2; i < c.length - 2; i++) {
    const x = c[i]!;
    if (x.high > c[i - 1]!.high && x.high > c[i - 2]!.high && x.high >= c[i + 1]!.high && x.high >= c[i + 2]!.high) highs.push({ i, price: x.high });
    if (x.low < c[i - 1]!.low && x.low < c[i - 2]!.low && x.low <= c[i + 1]!.low && x.low <= c[i + 2]!.low) lows.push({ i, price: x.low });
  }
  return { highs, lows };
}

type Confirm = { long: boolean; sweepI: number; breakI: number; breakLevel: number };

/** Most recent sweep (wick through a swing, close back inside) followed by a close through the opposite swing. */
export function findSweepAndBreak(c: ObCandle[], lookback = 60): Confirm | null {
  const start = Math.max(0, c.length - lookback);
  const { highs, lows } = swings(c);
  let best: Confirm | null = null;
  for (let s = start; s < c.length; s++) {
    const bar = c[s]!;
    for (const long of [true, false]) {
      const pool = (long ? lows : highs).filter((w) => w.i < s && w.i >= s - 30);
      const swept = pool.find((w) => long ? bar.low < w.price && bar.close > w.price : bar.high > w.price && bar.close < w.price);
      if (!swept) continue;
      const opp = (long ? highs : lows).filter((w) => w.i < s).pop();
      if (!opp) continue;
      for (let k = s + 1; k < c.length; k++) {
        const b = c[k]!;
        if (long ? b.close < bar.low : b.close > bar.high) break; // sweep failed
        if (long ? b.close > opp.price : b.close < opp.price) {
          if (!best || k > best.breakI) best = { long, sweepI: s, breakI: k, breakLevel: opp.price };
          break;
        }
      }
    }
  }
  return best;
}

export function structuralPhase(c: ObCandle[], confirm: Confirm | null): StructuralPhase {
  if (confirm && c.length - 1 - confirm.breakI <= 40) return confirm.long ? "accumulation" : "distribution";
  const { highs, lows } = swings(c.slice(-60));
  const h = highs.slice(-2), l = lows.slice(-2);
  if (h.length === 2 && l.length === 2) {
    if (h[1]!.price > h[0]!.price && l[1]!.price > l[0]!.price) return "continuation-up";
    if (h[1]!.price < h[0]!.price && l[1]!.price < l[0]!.price) return "continuation-down";
  }
  return "consolidation";
}

function fvgNear(c: ObCandle[], i0: number, long: boolean): boolean {
  for (let i = i0 + 1; i <= i0 + 3 && i + 1 < c.length; i++) {
    if (long ? c[i + 1]!.low > c[i - 1]!.high : c[i + 1]!.high < c[i - 1]!.low) return true;
  }
  return false;
}

export function sequenceEntryShadow(args: {
  bias: "Long" | "Short" | "Neutral";
  lastPrice: number;
  atr: number;
  candles1h?: ObCandle[] | null;
  candles15m?: ObCandle[] | null;
  nowSec?: number;
}): SequenceShadow {
  const c = args.candles1h ?? [];
  const sessionPhase = readSessionPhase(c, args.nowSec);
  const confirm = findSweepAndBreak(c);
  const h1Phase = structuralPhase(c, confirm);
  const base: SequenceShadow = {
    version: ENTRY_SEQUENCE_VERSION, sessionPhase, h1Phase, status: "waiting-for-sweep",
    sweepTime: confirm ? c[confirm.sweepI]!.time : null, breakTime: confirm ? c[confirm.breakI]!.time : null,
    breakLevel: confirm?.breakLevel ?? null, entry: null, stop: null, target: null, fvg: false, label: "", note: "",
  };
  const done = (status: SequenceStatus, note: string): SequenceShadow => ({ ...base, status, label: `Sequence: ${status}`, note });
  if (args.bias === "Neutral" || !(args.atr > 0)) return done("waiting-for-sweep", "No directional bias.");

  const long = args.bias === "Long";
  const continuation = h1Phase === (long ? "continuation-up" : "continuation-down");
  if (!confirm && !continuation) return done("waiting-for-sweep", "No sweep and break yet. The break of structure is confirmation, not the entry.");
  if (confirm && confirm.long !== long && !continuation) return done("against-bias", "The latest sweep and break point against the top-down bias.");

  // Retest: after the break, price trades back through the break level.
  if (confirm && confirm.long === long) {
    const after = c.slice(confirm.breakI + 1);
    const retested = after.some((b) => long ? b.low <= confirm.breakLevel : b.high >= confirm.breakLevel);
    if (!retested) return done("broke-structure", "Structure broke. Waiting for the pullback toward the order block.");
  }

  const kind = long ? "bullish" : "bearish";
  const fromTime = confirm && confirm.long === long ? c[Math.max(0, confirm.sweepI - 3)]!.time : 0;
  const toTime = confirm && confirm.long === long ? c[confirm.breakI]!.time : Infinity;
  const h1 = computeOrderBlocks(c, { max: 12 })
    .filter((b) => b.kind === kind && b.mitigations <= 1 && b.time >= fromTime && b.time <= toTime)
    .filter((b) => long ? b.top < args.lastPrice + args.atr * 0.5 : b.bot > args.lastPrice - args.atr * 0.5)
    .sort((a, b) => b.time - a.time)[0];
  if (!h1) return done("no-order-block", "No qualifying 1H order block, so no entry.");

  const m15 = computeOrderBlocks(args.candles15m ?? [], { max: 20 })
    .filter((b) => b.kind === kind && b.mitigations <= 1 && b.top <= h1.top + args.atr * 0.1 && b.bot >= h1.bot - args.atr * 0.1)
    .sort((a, b) => b.time - a.time)[0];
  const zone = m15 ?? h1;
  const src = m15 ? args.candles15m ?? [] : c;
  const candle = src.find((x) => x.time === zone.time);
  // Entry on the body of the last opposite candle.
  const entry = candle ? (long ? Math.max(candle.open, candle.close) : Math.min(candle.open, candle.close)) : (long ? zone.top : zone.bot);
  const pad = Math.max(args.atr * 0.15, args.lastPrice * 0.0002);
  const stop = long ? h1.bot - pad : h1.top + pad;
  const sinceSweep = confirm ? c.slice(confirm.sweepI) : c.slice(-30);
  const target = long ? Math.max(...sinceSweep.map((b) => b.high)) : Math.min(...sinceSweep.map((b) => b.low));
  if (!(Math.abs(entry - stop) > 0) || (long ? target <= entry : target >= entry)) return done("no-order-block", "Order block geometry does not leave room to the swing target.");
  const fvg = fvgNear(c, c.findIndex((x) => x.time === h1.time), long);
  const retesting = long ? args.lastPrice > entry : args.lastPrice < entry;
  const status: SequenceStatus = retesting ? "retesting" : "ready";
  return {
    ...base, status, entry, stop, target, fvg,
    label: `Sequence: ${m15 ? "15m inside 1H" : "1H"} ${kind} block${fvg ? " + FVG" : ""}`,
    note: `Trial only. ${h1Phase} on 1H; entry on the order-block body, break of structure used as confirmation only.`,
  };
}
