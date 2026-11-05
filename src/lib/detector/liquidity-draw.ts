import type { Candle } from "@/lib/agents/types";
import { computeOrderBlocks } from "@/lib/orderBlocks";
import { mapLiquidityPools, orderedPools, type LiquidityPool, type PoolSeries, type PoolSide } from "./liquidity-pools";

export const LIQUIDITY_DRAW_VERSION = "liquidity-draw-2026.11-v1";
/** Explicit rollout, separate from the unchanged v2 candidate experiment. */
export const LIQUIDITY_DRAW_LIVE = new Set([
  "NAS100", "SPX500", "US30", "XAU/USD", "XAG/USD", "XPT/USD", "GER40", "UK100", "JPN225",
  "EUR/USD", "GBP/USD", "USD/JPY", "AUD/USD", "USD/CAD", "USD/CHF", "NZD/USD", "EUR/JPY", "GBP/JPY",
  "WTI Oil", "Brent Oil", "NATGAS",
]);
export type Sweep = { side: PoolSide; pool: LiquidityPool; extreme: number; time: number; confirmedAt: number; breakLevel: number };
export type DrawState = {
  version: typeof LIQUIDITY_DRAW_VERSION; feed: string; processedTime: number;
  side: PoolSide | null; sweep: Sweep | null; pending: Sweep | null;
  target: LiquidityPool | null; status: "active" | "waiting" | "reached" | "invalidated";
  crossed?: { pool: LiquidityPool; extreme: number; time: number } | null;
};
export type DrawRead = { state: DrawState; pools: LiquidityPool[]; targets: LiquidityPool[] };
export const emptyDraw = (feed: string): DrawState => ({ version: LIQUIDITY_DRAW_VERSION, feed, processedTime: 0, side: null, sweep: null, pending: null, target: null, status: "waiting" });

/** One closed 15m tick. HTF labels are deliberately absent from this state machine. */
export function advanceDraw(previous: DrawState, bar: Candle, pools: LiquidityPool[], history: Candle[], endPools: LiquidityPool[] = pools): DrawState {
  if (bar.time <= previous.processedTime) return previous;
  let state: DrawState = { ...previous, processedTime: bar.time };
  if (state.sweep && state.side && bar.time > state.sweep.time &&
      (state.side === "buyside" ? bar.low < state.sweep.extreme : bar.high > state.sweep.extreme)) {
    state = { ...state, side: null, sweep: null, target: null, pending: null, crossed: null, status: "invalidated" };
  }
  const pending = state.pending;
  if (pending && bar.time > pending.time) {
    const invalid = pending.side === "sellside" ? bar.low < pending.extreme : bar.high > pending.extreme;
    const confirmed = pending.side === "sellside" ? bar.close > pending.breakLevel : bar.close < pending.breakLevel;
    if (invalid) state.pending = null;
    else if (confirmed) {
      const side = pending.side === "sellside" ? "buyside" : "sellside";
      const targets = orderedPools(endPools.filter(p => p.id !== pending.pool.id), side, bar.close);
      state = { ...state, side, sweep: { ...pending, confirmedAt: bar.time + 900 }, pending: null,
        target: targets[0] ?? null, crossed: null, status: targets.length ? "active" : "reached" };
    }
  }
  // Persist the target identity; a closer newly formed pool cannot rewrite the lock.
  if (state.side && state.target) {
    const reached = state.side === "buyside" ? bar.high >= state.target.price : bar.low <= state.target.price;
    const closedThrough = state.side === "buyside" ? bar.close > state.target.price : bar.close < state.target.price;
    if (reached) state.status = "reached";
    if (closedThrough) {
      state.crossed = { pool: state.target, extreme: state.side === "buyside" ? bar.high : bar.low, time: bar.time };
      const next = orderedPools(endPools, state.side, bar.close)[0];
      state.target = next ?? state.target;
      state.status = next ? "active" : "reached";
    }
  }
  const candidates = pools.filter(p => p.status === "unswept" && p.confirmedAt <= bar.time &&
    (p.side === "sellside" ? bar.low < p.price && bar.close > p.price : bar.high > p.price && bar.close < p.price));
  if (state.target && state.side) {
    const p = state.target;
    if (p.side === "buyside" ? bar.high > p.price && bar.close < p.price : bar.low < p.price && bar.close > p.price) candidates.unshift(p);
  }
  const crossed = state.crossed;
  if (crossed && state.side && bar.time > crossed.time) {
    crossed.extreme = state.side === "buyside" ? Math.max(crossed.extreme, bar.high) : Math.min(crossed.extreme, bar.low);
    if (state.side === "buyside" ? bar.close < crossed.pool.price : bar.close > crossed.pool.price) candidates.unshift(crossed.pool);
  }
  // While locked, only a sweep of the draw side can hand it off. Ignore unrelated pullback sweeps.
  const eligible = state.side ? candidates.filter(p => p.id === state.target?.id || p.id === state.crossed?.pool.id) : candidates;
  const pool = eligible.sort((a, b) => Math.abs(a.price - bar.close) - Math.abs(b.price - bar.close))[0];
  if (pool && !state.pending) {
    const prior = history.filter(b => b.time < bar.time).slice(-8);
    // Recent closed 15m swing, with two right bars already available before the sweep.
    let swing: number | null = null;
    for (let i = 2; i + 2 < prior.length; i++) {
      const b = prior[i], a = prior[i - 1], z = prior[i + 1], a2 = prior[i - 2], z2 = prior[i + 2];
      if (!b || !a || !z || !a2 || !z2) continue;
      if (pool.side === "sellside" ? [a, a2, z, z2].every(x => b.high > x.high) : [a, a2, z, z2].every(x => b.low < x.low)) swing = pool.side === "sellside" ? b.high : b.low;
    }
    if (swing !== null) state.pending = { side: pool.side, pool, extreme: pool.id === state.crossed?.pool.id ? state.crossed.extreme : pool.side === "sellside" ? bar.low : bar.high,
      time: bar.time, confirmedAt: 0, breakLevel: swing };
  }
  return state;
}

export function replayDraw(series: PoolSeries, feed: string, previous?: DrawState | null): DrawRead {
  let state = previous?.feed === feed && previous.version === LIQUIDITY_DRAW_VERSION ? previous : emptyDraw(feed);
  const m15 = series["15m"] ?? [];
  for (const bar of m15) {
    if (bar.time <= state.processedTime) continue;
    state = advanceDraw(state, bar, mapLiquidityPools(series, bar.time), m15, mapLiquidityPools(series, bar.time + 900));
  }
  const latest = m15.at(-1);
  const pools = mapLiquidityPools(series, latest ? latest.time + 900 : 0);
  const targets = state.side ? orderedPools(pools, state.side, latest?.close ?? 0) : [];
  if (state.target && state.status === "active" && !targets.some(p => p.id === state.target?.id)) targets.unshift(state.target);
  return { state, pools, targets };
}

export type DrawZone = { top: number; bottom: number; time: number; formedAt: number; frame: "15m" | "1H"; kind: "order block" | "FVG"; continuation: boolean };
export function latestDrawZone(series: PoolSeries, state: DrawState, price: number): DrawZone | null {
  if (!state.side || !state.sweep) return null;
  const long = state.side === "buyside";
  const zones: DrawZone[] = [];
  for (const frame of ["15m", "1H"] as const) {
    const bars = series[frame] ?? [];
    for (const ob of computeOrderBlocks(bars, { max: 30 })) {
      if (ob.kind !== (long ? "bullish" : "bearish") || ob.time < state.sweep.time || ob.mitigations > 1) continue;
      // At most the current first visit: a prior closed visit is not a fresh continuation.
      if (ob.mitigatedTime && ob.mitigatedTime < (bars.at(-1)?.time ?? 0)) continue;
      const formation = bars.find(b => b.time > ob.time && (long ? b.close > ob.breakLevel : b.close < ob.breakLevel));
      if (!formation) continue;
      const formedAt = formation.time + (frame === "15m" ? 900 : 3600);
      zones.push({ top: ob.top, bottom: ob.bot, time: ob.time, formedAt, frame, kind: "order block", continuation: formation.time > state.sweep.confirmedAt });
    }
    for (let i = 2; i < bars.length; i++) {
      const a = bars[i - 2], b = bars[i];
      if (!a || !b || a.time < state.sweep.time) continue;
      const bottom = long ? a.high : b.high, top = long ? b.low : a.low;
      if (bottom >= top) continue;
      if (bars.slice(i + 1, -1).some(x => x.low <= top && x.high >= bottom)) continue;
      if (bars.slice(i + 1).some(x => long ? x.close < bottom : x.close > top)) continue;
      const formedAt = b.time + (frame === "15m" ? 900 : 3600);
      zones.push({ top, bottom, time: a.time, formedAt, frame, kind: "FVG", continuation: b.time > state.sweep.confirmedAt });
    }
  }
  return zones.filter(z => long ? z.bottom <= price : z.top >= price).sort((a, b) => b.time - a.time)[0] ?? null;
}

export function drawLevels(state: DrawState, zone: DrawZone, targets: LiquidityPool[], atr: number) {
  if (!state.sweep || !state.side) return null;
  const long = state.side === "buyside", entry = long ? zone.top : zone.bottom;
  const buffer = Math.max(atr * 0.15, entry * 0.0001);
  const anchor = zone.continuation ? long ? zone.bottom : zone.top : state.sweep.extreme;
  const stop = long ? anchor - buffer : anchor + buffer;
  const forward = targets.filter(p => long ? p.price > entry : p.price < entry);
  const first = forward[0];
  if (!first || (long ? stop >= entry : stop <= entry)) return null;
  return { entry, stop, tp1: first.price, tp2: forward[1]?.price ?? first.price, finalPool: forward.at(-1)?.price ?? first.price };
}

export function drawGrade(args: { aligned: boolean; nested: boolean; continuation: boolean; opposingInsideStop: boolean }): { cap: "A" | "B" | "C"; sizeMultiplier: number } {
  if (args.opposingInsideStop) return { cap: "C", sizeMultiplier: 0.25 };
  if (args.aligned) return { cap: "A", sizeMultiplier: 1 };
  if (args.nested && !args.continuation) return { cap: "A", sizeMultiplier: 0.5 };
  return { cap: "B", sizeMultiplier: 0.5 };
}