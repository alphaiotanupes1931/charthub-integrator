// Per-instrument measured behaviour (Phase 4, item 10).
//
// The Wyckoff rules are identical on every symbol. Only the constants change,
// because ATR scale, typical pullback depth and session character differ. This
// file measures those constants from real bars and turns them into an override
// for the bias engine's InstrumentConfig. Everything here is pure arithmetic so
// it can be unit tested and run on the client or the server.

import type { InstrumentConfig } from "./agents/biasEngine";

export type ProfileBar = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
};

export type SessionKey = "asia" | "london" | "newyork";

export type SessionStat = {
  session: SessionKey;
  bars: number;
  /** Average bar range as a fraction of price. */
  avgRangePct: number;
  /** Share of the instrument's total measured range printed in this session. */
  shareOfRange: number;
};

export type InstrumentProfile = {
  symbol: string;
  barsSampled: number;
  lookback: string;
  /** Wilder ATR(14) on the 4H series, in price units. */
  atr4h: number;
  /** ATR as a percentage of price, so instruments are comparable. */
  atrPct: number;
  /** Median retracement of an impulse leg, 0-1 (0.5 = half the leg). */
  medianPullback: number;
  /** 80th percentile retracement. Stops must clear this to survive a normal pullback. */
  deepPullback: number;
  /** Session that prints the most range. */
  bestSession: SessionKey;
  sessions: SessionStat[];
  measuredAt: string;
};

const SESSIONS: Array<{ key: SessionKey; startHour: number; endHour: number }> = [
  { key: "asia", startHour: 0, endHour: 7 },
  { key: "london", startHour: 7, endHour: 13 },
  { key: "newyork", startHour: 13, endHour: 21 },
];

function sessionOf(timeMs: number): SessionKey {
  const h = new Date(timeMs).getUTCHours();
  for (const s of SESSIONS) if (h >= s.startHour && h < s.endHour) return s.key;
  return "asia";
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const idx = Math.min(s.length - 1, Math.max(0, Math.round((s.length - 1) * p)));
  return s[idx];
}

/** Wilder-style ATR in price units. */
export function atrOfBars(bars: ProfileBar[], period = 14): number {
  if (bars.length < 2) return 0;
  const trs: number[] = [];
  for (let i = 1; i < bars.length; i++) {
    const p = bars[i - 1];
    const c = bars[i];
    trs.push(Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close)));
  }
  const slice = trs.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / (slice.length || 1);
}

/** Fractal pivots on the bar series, same wing logic the engine uses. */
function pivots(bars: ProfileBar[], wing: number): { highs: number[]; lows: number[] } {
  const highs: number[] = [];
  const lows: number[] = [];
  for (let i = wing; i < bars.length - wing; i++) {
    let isHigh = true;
    let isLow = true;
    for (let k = 1; k <= wing; k++) {
      if (bars[i - k].high >= bars[i].high || bars[i + k].high >= bars[i].high) isHigh = false;
      if (bars[i - k].low <= bars[i].low || bars[i + k].low <= bars[i].low) isLow = false;
    }
    if (isHigh) highs.push(i);
    if (isLow) lows.push(i);
  }
  return { highs, lows };
}

/**
 * Retracement depth of each impulse leg, expressed as a fraction of the leg.
 * A leg is pivot low -> pivot high (or the reverse); the pullback is how far the
 * next opposite pivot gave the leg back.
 */
export function pullbackDepths(bars: ProfileBar[], wing = 3, minLegAtr = 0.75): number[] {
  const { highs, lows } = pivots(bars, wing);
  const marks = [
    ...highs.map((i) => ({ i, kind: "high" as const, price: bars[i].high })),
    ...lows.map((i) => ({ i, kind: "low" as const, price: bars[i].low })),
  ].sort((a, b) => a.i - b.i);

  // Average true range over the whole sample, used to throw away noise legs.
  // Without this filter two-bar wiggles count as impulses and the measured
  // pullback drifts toward 100%, which would push stops much too wide.
  let trSum = 0;
  for (let i = 1; i < bars.length; i++) {
    const p = bars[i - 1];
    const c = bars[i];
    trSum += Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close));
  }
  const avgTr = bars.length > 1 ? trSum / (bars.length - 1) : 0;
  const minLeg = avgTr * minLegAtr;

  const depths: number[] = [];
  for (let n = 0; n + 2 < marks.length; n++) {
    const a = marks[n];
    const b = marks[n + 1];
    const c = marks[n + 2];
    if (a.kind === b.kind || b.kind === c.kind) continue; // need alternating structure
    const leg = Math.abs(b.price - a.price);
    if (leg <= 0 || leg < minLeg) continue;
    const give = Math.abs(c.price - b.price);
    const depth = give / leg;
    // A give-back over the full leg is a reversal, not a pullback.
    if (depth > 0 && depth <= 1) depths.push(depth);
  }
  return depths;
}

export function sessionStats(bars: ProfileBar[]): SessionStat[] {
  const acc = new Map<SessionKey, { bars: number; rangePct: number; range: number }>();
  for (const s of SESSIONS) acc.set(s.key, { bars: 0, rangePct: 0, range: 0 });
  let totalRange = 0;
  for (const b of bars) {
    const price = b.close || b.open || 1;
    const range = Math.max(0, b.high - b.low);
    const bucket = acc.get(sessionOf(b.time))!;
    bucket.bars += 1;
    bucket.range += range;
    bucket.rangePct += price ? range / price : 0;
    totalRange += range;
  }
  return SESSIONS.map(({ key }) => {
    const a = acc.get(key)!;
    return {
      session: key,
      bars: a.bars,
      avgRangePct: a.bars ? +(a.rangePct / a.bars).toFixed(6) : 0,
      shareOfRange: totalRange ? +(a.range / totalRange).toFixed(4) : 0,
    };
  });
}

/** Measure a symbol's behaviour from its 4H bars (1H also works, less smooth). */
export function profileFromBars(
  symbol: string,
  bars: ProfileBar[],
  lookback = "2y",
  /** Finer bars (1H) for session character; 4H buckets are too coarse to place a session. */
  sessionBars?: ProfileBar[],
): InstrumentProfile {
  const clean = bars.filter((b) => [b.open, b.high, b.low, b.close].every(Number.isFinite));
  const atr4h = atrOfBars(clean);
  const lastPrice = clean.length ? clean[clean.length - 1].close : 0;
  const depths = pullbackDepths(clean);
  const sessions = sessionStats(
    sessionBars && sessionBars.length > 50
      ? sessionBars.filter((b) => [b.open, b.high, b.low, b.close].every(Number.isFinite))
      : clean,
  );
  const bestSession = sessions.reduce((best, s) => (s.shareOfRange > best.shareOfRange ? s : best), sessions[0]).session;
  return {
    symbol,
    barsSampled: clean.length,
    lookback,
    atr4h: +atr4h.toFixed(6),
    atrPct: lastPrice ? +((atr4h / lastPrice) * 100).toFixed(4) : 0,
    medianPullback: depths.length ? +median(depths).toFixed(4) : 0.5,
    deepPullback: depths.length ? +percentile(depths, 0.8).toFixed(4) : 0.75,
    bestSession,
    sessions,
    measuredAt: new Date().toISOString(),
  };
}

const MIN_BARS_TO_TUNE = 200;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Turn a measured profile into an InstrumentConfig override.
 *
 * - entryBuffer scales with measured ATR so the limit sits far enough inside the
 *   zone to fill on this symbol, not on gold's numbers.
 * - stopBufferAtr must clear the instrument's typical deep pullback, otherwise a
 *   normal retracement takes the stop out before the move.
 * - maxEntryDistanceAtr widens on symbols whose pullbacks are deep, because the
 *   valid zone genuinely sits further from price there.
 *
 * A thin sample never changes anything: unknown or under-sampled symbols keep the
 * conservative shipped constants.
 */
export function tunedConfig(base: InstrumentConfig, profile: InstrumentProfile | null | undefined): {
  cfg: InstrumentConfig;
  tuned: boolean;
  reason: string;
} {
  if (!profile || profile.barsSampled < MIN_BARS_TO_TUNE || profile.atr4h <= 0) {
    return { cfg: base, tuned: false, reason: "No measured profile with enough bars. Keeping shipped constants." };
  }
  const entryBuffer = base.entryBuffer > 0
    ? +clamp(profile.atr4h * 0.05, base.entryBuffer * 0.5, base.entryBuffer * 2).toFixed(6)
    : base.entryBuffer;
  const stopBufferAtr = +clamp(
    Math.max(base.stopBufferAtr, profile.deepPullback * 0.9),
    0.4,
    1.25,
  ).toFixed(2);
  const maxEntryDistanceAtr = +clamp(
    base.maxEntryDistanceAtr * (1 + (profile.medianPullback - 0.5)),
    0.8,
    2.5,
  ).toFixed(2);
  return {
    cfg: { ...base, entryBuffer, stopBufferAtr, maxEntryDistanceAtr },
    tuned: true,
    reason: `Measured on ${profile.barsSampled} 4H bars: ATR ${profile.atr4h} (${profile.atrPct}% of price), median pullback ${(profile.medianPullback * 100).toFixed(0)}%, deep pullback ${(profile.deepPullback * 100).toFixed(0)}%, most range in ${profile.bestSession}.`,
  };
}

export const SESSION_LABEL: Record<SessionKey, string> = {
  asia: "Asia",
  london: "London",
  newyork: "New York",
};
