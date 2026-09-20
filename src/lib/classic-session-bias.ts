import { closedBars, type BarCandle } from "@/lib/barClock";
import { CLASSIC_SESSION_RULEBOOK_VERSION } from "@/lib/analysis-models/classic-session-rulebook";

export type SessionBiasDirection = "bullish" | "bearish" | "pending" | "conflicted" | "not-applicable";
export type SessionBiasPattern = "london-reversal" | "london-continuation" | "new-york-reversal" | "none";

export type SessionBiasRead = {
  version: string;
  direction: SessionBiasDirection;
  pattern: SessionBiasPattern;
  reason: string;
  tradeDay: string | null;
  asiaHigh: number | null;
  asiaLow: number | null;
  asiaRange: number | null;
  priorMedianRange: number | null;
  accumulation: boolean;
  londonSweep: "high" | "low" | "both" | "none";
  newYorkSweep: "high" | "low" | "both" | "none";
  displacement: boolean;
  evidenceTimes: number[];
};

type LocalStamp = { date: string; hour: number; weekday: string };

const ZONE = "America/New_York";
const SUPPORTED = new Set(["XAU/USD", "XAG/USD", "EUR/USD", "GBP/USD", "USD/JPY"]);
const stampCache = new Map<number, LocalStamp>();

function localStamp(time: number): LocalStamp {
  const cached = stampCache.get(time);
  if (cached) return cached;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
    weekday: "short",
  }).formatToParts(new Date(time * 1000));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  const stamp = {
    date: `${part("year")}-${part("month")}-${part("day")}`,
    hour: Number(part("hour")),
    weekday: part("weekday"),
  };
  stampCache.set(time, stamp);
  return stamp;
}

function nextDate(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
}

function tradeDayOf(time: number): string {
  const stamp = localStamp(time);
  return stamp.hour >= 19 ? nextDate(stamp.date) : stamp.date;
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function atrAt(bars: BarCandle[], period = 14): number {
  const sample = bars.slice(-(period + 1));
  if (sample.length < 2) return 0;
  const ranges: number[] = [];
  for (let i = 1; i < sample.length; i++) {
    const previous = sample[i - 1];
    const bar = sample[i];
    ranges.push(Math.max(bar.high - bar.low, Math.abs(bar.high - previous.close), Math.abs(bar.low - previous.close)));
  }
  return ranges.reduce((sum, value) => sum + value, 0) / ranges.length;
}

function barsForDay(bars: BarCandle[], day: string, start: number, end: number): BarCandle[] {
  return bars.filter((bar) => {
    const stamp = localStamp(bar.time);
    return tradeDayOf(bar.time) === day && stamp.hour >= start && stamp.hour < end;
  });
}

function asiaBarsForDay(bars: BarCandle[], day: string): BarCandle[] {
  return bars.filter((bar) => {
    const stamp = localStamp(bar.time);
    return tradeDayOf(bar.time) === day && stamp.hour >= 19;
  });
}

function rangeOf(bars: BarCandle[]): { high: number; low: number; range: number } | null {
  if (!bars.length) return null;
  const high = Math.max(...bars.map((bar) => bar.high));
  const low = Math.min(...bars.map((bar) => bar.low));
  return { high, low, range: high - low };
}

function sweptSide(bars: BarCandle[], high: number, low: number): "high" | "low" | "both" | "none" {
  const sweptHigh = bars.some((bar) => bar.high > high && bar.close < high);
  const sweptLow = bars.some((bar) => bar.low < low && bar.close > low);
  if (sweptHigh && sweptLow) return "both";
  if (sweptHigh) return "high";
  if (sweptLow) return "low";
  return "none";
}

function directionFromSweep(side: "high" | "low"): "bullish" | "bearish" {
  return side === "low" ? "bullish" : "bearish";
}

function empty(direction: SessionBiasDirection, reason: string, tradeDay: string | null): SessionBiasRead {
  return {
    version: CLASSIC_SESSION_RULEBOOK_VERSION,
    direction,
    pattern: "none",
    reason,
    tradeDay,
    asiaHigh: null,
    asiaLow: null,
    asiaRange: null,
    priorMedianRange: null,
    accumulation: false,
    londonSweep: "none",
    newYorkSweep: "none",
    displacement: false,
    evidenceTimes: [],
  };
}

export function readClassicSessionBias(
  symbol: string,
  candles: BarCandle[],
  asOfMs?: number,
): SessionBiasRead {
  if (!SUPPORTED.has(symbol)) return empty("not-applicable", "Session bias is restricted to the approved FX and metals set.", null);
  const closed = closedBars(candles, asOfMs);
  if (!closed.length) return empty("pending", "No closed bars are available.", null);
  const last = closed[closed.length - 1];
  const tradeDay = tradeDayOf(last.time);
  const stamp = localStamp(last.time);
  if (stamp.weekday === "Sat") return empty("not-applicable", "Weekend data is excluded.", tradeDay);

  const asia = asiaBarsForDay(closed, tradeDay);
  const london = barsForDay(closed, tradeDay, 2, 5);
  const newYork = barsForDay(closed, tradeDay, 7, 12);
  if (asia.length < 4) return empty("pending", "The Asia session does not yet have enough closed hourly bars.", tradeDay);
  const asiaRange = rangeOf(asia);
  if (!asiaRange) return empty("pending", "The Asia range is unavailable.", tradeDay);

  const previousDays = [...new Set(closed.map((bar) => tradeDayOf(bar.time)))]
    .filter((day) => day < tradeDay)
    .sort()
    .slice(-20);
  const priorRanges = previousDays
    .map((day) => asiaBarsForDay(closed, day))
    .filter((rows) => rows.length >= 4)
    .map(rangeOf)
    .filter((value): value is { high: number; low: number; range: number } => value !== null)
    .map((value) => value.range);
  if (priorRanges.length < 5) return empty("pending", "At least five prior complete Asia sessions are required.", tradeDay);
  const priorMedianRange = median(priorRanges);
  const accumulation = asiaRange.range <= priorMedianRange;
  const base = {
    version: CLASSIC_SESSION_RULEBOOK_VERSION,
    tradeDay,
    asiaHigh: asiaRange.high,
    asiaLow: asiaRange.low,
    asiaRange: asiaRange.range,
    priorMedianRange,
    accumulation,
  };
  if (!accumulation) {
    return { ...empty("not-applicable", "Asia expanded beyond its trailing median range, so it did not qualify as accumulation.", tradeDay), ...base };
  }
  if (london.length < 3) {
    return { ...empty("pending", "The London window is not complete.", tradeDay), ...base };
  }

  const londonSweep = sweptSide(london, asiaRange.high, asiaRange.low);
  if (londonSweep === "both") {
    return {
      ...empty("conflicted", "London swept both sides of the Asia range.", tradeDay),
      ...base,
      londonSweep,
      evidenceTimes: london.map((bar) => bar.time),
    };
  }
  if (londonSweep === "high" || londonSweep === "low") {
    const direction = directionFromSweep(londonSweep);
    const sweepBar = london.find((bar) => londonSweep === "high"
      ? bar.high > asiaRange.high && bar.close < asiaRange.high
      : bar.low < asiaRange.low && bar.close > asiaRange.low);
    const sweepIndex = sweepBar ? london.indexOf(sweepBar) : -1;
    const atr = atrAt(closed.filter((bar) => bar.time <= (sweepBar?.time ?? last.time)));
    const displacementBar = sweepIndex >= 0
      ? london.slice(sweepIndex + 1).find((bar) => {
          const body = Math.abs(bar.close - bar.open);
          if (!(atr > 0) || body < atr * 0.6 || !sweepBar) return false;
          return direction === "bullish"
            ? bar.close > sweepBar.high && bar.close > bar.open
            : bar.close < sweepBar.low && bar.close < bar.open;
        })
      : undefined;
    const displacement = Boolean(displacementBar);
    return {
      ...base,
      direction,
      pattern: displacement ? "london-continuation" : "london-reversal",
      reason: displacement
        ? `London swept the Asia ${londonSweep} and displaced ${direction} before New York.`
        : `London swept the Asia ${londonSweep} and closed back inside the range.`,
      londonSweep,
      newYorkSweep: "none",
      displacement,
      evidenceTimes: [sweepBar?.time, displacementBar?.time].filter((time): time is number => typeof time === "number"),
    };
  }

  if (newYork.length === 0) {
    return {
      ...empty("pending", "London took neither Asia boundary; waiting for New York liquidity.", tradeDay),
      ...base,
      londonSweep: "none",
    };
  }
  const newYorkSweep = sweptSide(newYork, asiaRange.high, asiaRange.low);
  if (newYorkSweep === "both") {
    return {
      ...empty("conflicted", "New York swept both sides of the Asia range.", tradeDay),
      ...base,
      newYorkSweep,
      evidenceTimes: newYork.map((bar) => bar.time),
    };
  }
  if (newYorkSweep === "high" || newYorkSweep === "low") {
    const event = newYork.find((bar) => newYorkSweep === "high"
      ? bar.high > asiaRange.high && bar.close < asiaRange.high
      : bar.low < asiaRange.low && bar.close > asiaRange.low);
    return {
      ...base,
      direction: directionFromSweep(newYorkSweep),
      pattern: "new-york-reversal",
      reason: `London held the Asia range; New York swept the ${newYorkSweep} and closed back inside.`,
      londonSweep: "none",
      newYorkSweep,
      displacement: false,
      evidenceTimes: event ? [event.time] : [],
    };
  }
  return {
    ...empty("pending", "Neither London nor New York has completed a one-sided liquidity sweep.", tradeDay),
    ...base,
    londonSweep: "none",
    newYorkSweep: "none",
  };
}