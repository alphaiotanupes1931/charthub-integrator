// Bridges the existing MarketSnapshot onto the v3 bias engine.
//
// Rule 6 of the v3 brief: bias is computed in code from the current closed
// candles on every scan, never decided by the model and never cached. This file
// is the only place the snapshot is translated into engine input, so there is a
// single audit point for what the engine was handed.

import type { MarketSnapshot } from "./types";
import {
  gradeScan,
  buildScanContext,
  classifyTrend,
  detect4hReversal,
  engineSymbolFor,
  getInstrumentConfig,
  type BiasState,
  type Candle as BiasCandle,
  type Grade,
  type ImbalanceStack,
  type InstrumentConfig,
  type ScanResult,
  type Zone,

} from "./biasEngine";
import {
  behaviourFor,
  behaviourBrief,
  applyBehaviourGrade,
  expectedHold,
  sessionGate,
  type InstrumentBehaviour,
} from "../instrumentBehaviour";

export type BiasReadout = {
  symbol: string;
  result: ScanResult;
  /** The authoritative block injected into the model prompt. */
  contextBlock: string;
  /** Long / Short / Neutral in the platform's own vocabulary. */
  platformBias: "Long" | "Short" | "Neutral";
  /** How this specific instrument moves: sessions, hold, target style, grade ceiling. */
  behaviour: InstrumentBehaviour;
  /** Expected hold for a valid setup here. */
  hold: ReturnType<typeof expectedHold>;
  /** Session quality at scan time. */
  session: ReturnType<typeof sessionGate>;
};

/** OANDA marks live candles incomplete; our loaders drop the forming bar already. */
function toEngineCandles(candles: MarketSnapshot["candles"]): BiasCandle[] {
  return candles.map((c) => ({
    time: c.time,
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
    volume: c.volume,
    complete: true,
  }));
}

/** Wilder-style ATR over the 4H series the engine reads. */
export function atrOf(candles: BiasCandle[], period = 14): number {
  if (candles.length < 2) return 0;
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const p = candles[i - 1];
    const c = candles[i];
    trs.push(Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close)));
  }
  const slice = trs.slice(-period);
  return slice.reduce((s, v) => s + v, 0) / (slice.length || 1);
}

/**
 * Zone state, per correction C in the brief: price sitting inside a zone is the
 * live entry trigger, not a dead zone. Only a zone price has closed all the way
 * through is 'filled'.
 */
function zoneState(direction: "bullish" | "bearish", top: number, bottom: number, price: number) {
  if (price <= top && price >= bottom) return "testing" as const;
  if (direction === "bullish" && price < bottom) return "filled" as const;
  if (direction === "bearish" && price > top) return "filled" as const;
  return "fresh" as const;
}

function pushZone(out: Zone[], type: "OB" | "FVG", direction: "bullish" | "bearish", pair: [number, number], price: number) {
  const top = Math.max(pair[0], pair[1]);
  const bottom = Math.min(pair[0], pair[1]);
  if (!Number.isFinite(top) || !Number.isFinite(bottom) || top <= 0) return;
  out.push({ type, direction, top, bottom, state: zoneState(direction, top, bottom, price) });
}

export function zonesFromSnapshot(snap: MarketSnapshot): Zone[] {
  const price = snap.lastPrice;
  const out: Zone[] = [];
  const h1 = snap.mtf?.h1;
  const h4 = snap.mtf?.h4;
  for (const z of h1?.orderBlocks.bull ?? []) pushZone(out, "OB", "bullish", z, price);
  for (const z of h1?.orderBlocks.bear ?? []) pushZone(out, "OB", "bearish", z, price);
  for (const z of h1?.fvg.bull ?? []) pushZone(out, "FVG", "bullish", z, price);
  for (const z of h1?.fvg.bear ?? []) pushZone(out, "FVG", "bearish", z, price);
  for (const z of h4?.supplyDemand.demand ?? []) pushZone(out, "OB", "bullish", z, price);
  for (const z of h4?.supplyDemand.supply ?? []) pushZone(out, "OB", "bearish", z, price);
  return out;
}

function liquidityFrom(snap: MarketSnapshot): number[] {
  const h1 = snap.mtf?.h1.liquidity;
  const h4 = snap.mtf?.h4.keyLevels;
  return [
    ...(h1?.buyside ?? []),
    ...(h1?.sellside ?? []),
    ...(h4?.support ?? []),
    ...(h4?.resistance ?? []),
    snap.stats.high20,
    snap.stats.low20,
    snap.stats.high50,
    snap.stats.low50,
  ].filter((n) => Number.isFinite(n) && n > 0);
}

/** Footprint stacks, read by location and mitigation (correction B in the brief). */
function imbalancesFrom(snap: MarketSnapshot): ImbalanceStack[] {
  const of = snap.orderFlow;
  if (!of || of.stackedSide === "none" || of.stackedImbalances < 2) return [];
  const top = Math.max(of.valueAreaHigh, of.poc);
  const bottom = Math.min(of.valueAreaLow, of.poc);
  const tradedThrough = of.stackedSide === "sell" ? snap.lastPrice > top : snap.lastPrice < bottom;
  return [{ direction: of.stackedSide, top, bottom, tradedThrough }];
}

/** z-scores for CVD and price slope, normalised by the series' own volatility. */
function slopeZ(snap: MarketSnapshot): { cvdSlopeZ: number; priceSlopeZ: number } {
  const of = snap.orderFlow;
  const closes = snap.candles.slice(-20).map((c) => c.close);
  const atr = Math.max(snap.stats.atr14 || 0, 1e-9);
  const priceSlope = closes.length >= 2 ? closes[closes.length - 1] - closes[0] : 0;
  const deltaScale = Math.max(Math.abs(of?.deltaAvg ?? 0), 1e-9);
  return {
    cvdSlopeZ: (of?.cvdSlope ?? 0) / deltaScale,
    priceSlopeZ: priceSlope / (atr * 2),
  };
}

const toBias = (v: string | undefined): BiasState =>
  v === "bullish" ? "bullish" : v === "bearish" ? "bearish" : "neutral";

/**
 * Computes the authoritative bias for this scan. No cache, no TTL: this is
 * arithmetic over candles that already sit in memory.
 */
export function computeBias(
  snap: MarketSnapshot,
  baseGrade: Grade = "A",
  configOverride?: InstrumentConfig,
  /** Measured profile hint so the best session comes from real bars where we have them. */
  profileHint?: { bestSession?: "asia" | "london" | "newyork"; barsSampled?: number } | null,
  nowMs: number = Date.now(),
): BiasReadout {
  const symbol = engineSymbolFor(snap.ticker);
  const candles4h = toEngineCandles(snap.candles4h?.length ? snap.candles4h : snap.candles);
  const atr4h = snap.atr4h && snap.atr4h > 0 ? snap.atr4h : atrOf(candles4h);
  const ladderRow = (label: string) => snap.mtf?.ladder?.find((r) => r.label === label);

  // 4H trend: the engine's own swing read is strict (it needs two clean swings
  // inside a 20-candle window and a span over 1.5x ATR), and on live FX it returns
  // 'range' most of the time, which would push nearly every scan to NEUTRAL. When
  // it finds no structure we fall back to the platform's own deterministic 4H trend
  // read from the same candles. Reversal detection is never overridden: an
  // invalidated 4H still forces NEUTRAL.
  const engineTrend = classifyTrend(candles4h, Math.max(atr4h, 1e-9));
  const platformTrend = snap.mtf?.h4.trend === "up" ? "up" : snap.mtf?.h4.trend === "down" ? "down" : "range";
  const fourHTrend = engineTrend !== "range" ? engineTrend : platformTrend;

  const result = gradeScan({
    instrument: symbol,
    price: snap.lastPrice,
    atr4h: Math.max(atr4h, Math.abs(snap.lastPrice) * 1e-6),
    candles4h,
    zones: zonesFromSnapshot(snap),
    liquidity: liquidityFrom(snap),
    orderFlow: {
      ...slopeZ(snap),
      price: snap.lastPrice,
      poc: snap.orderFlow?.poc ?? snap.lastPrice,
      vah: snap.orderFlow?.valueAreaHigh ?? snap.lastPrice,
      val: snap.orderFlow?.valueAreaLow ?? snap.lastPrice,
    },
    imbalances: imbalancesFrom(snap),
    ladder: {
      weekly: toBias(ladderRow("Weekly")?.bias),
      daily: toBias(ladderRow("Daily")?.bias ?? snap.cisd.htfBias),
      oneH: toBias(ladderRow("1H")?.bias ?? snap.mtf?.h1.structureBreak),
      fifteenM: toBias(snap.mtf?.m15.confirmation),
      fourH: { trend: fourHTrend, reversal: detect4hReversal(candles4h, Math.max(atr4h, 1e-9)) },
      computedAt: Date.now(),
    },
    baseGrade,
    configOverride,
  });

  // Per-instrument behaviour: sessions, expected hold, target style and the
  // measured-edge ceiling. Applied after grading so direction and levels are
  // untouched; only the confidence we sell it with changes.
  const behaviour = behaviourFor(symbol, profileHint);
  const hold = expectedHold(behaviour);
  let session = sessionGate(behaviour, nowMs);
  if (result.bias !== "neutral" && result.status !== "NO SETUP") {
    const applied = applyBehaviourGrade(result.grade, behaviour, nowMs);
    result.grade = applied.grade;
    session = applied.session;
    result.notes.push(...applied.notes);
  } else {
    result.notes.push(behaviourBrief(behaviour, nowMs));
  }

  return {
    symbol,
    result,
    contextBlock: `${buildScanContext(result, symbol, snap.lastPrice)}\n\n${behaviourBrief(behaviour, nowMs)}`,
    platformBias: result.bias === "bullish" ? "Long" : result.bias === "bearish" ? "Short" : "Neutral",
    behaviour,
    hold,
    session,
  };
}

export { getInstrumentConfig };
