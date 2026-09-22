// Instrument- and chart-specific pre-scan questions.
//
// The teaching checklist should not feel like a generic quiz: it asks about the
// instrument on screen, on the timeframe on screen, using the levels that are
// actually there. Everything here is derived from CLOSED candles only (the last
// bar is still forming and is deliberately dropped), so the questions never
// depend on a price that can still change while the trader reads them.

import type { PreScanQuestion } from "@/lib/prescan-questions";

export type PreScanBar = { time: number; open: number; high: number; low: number; close: number };

export type ChartFacts = {
  /** Close of the most recent CLOSED candle. */
  lastClose: number;
  /** Most recent swing high / low to the left of the last closed candle. */
  swingHigh: number;
  swingLow: number;
  /** ATR(14) on closed candles. */
  atr: number;
  /** Direction of the closed-candle structure. */
  trend: "up" | "down" | "sideways";
  /** Decimals to print prices with. */
  decimals: number;
  /** Distance from last close to each side, in price. */
  toHigh: number;
  toLow: number;
};

function decimalsFor(price: number): number {
  const p = Math.abs(price);
  if (p >= 1000) return 2;
  if (p >= 100) return 2;
  if (p >= 10) return 3;
  if (p >= 1) return 4;
  return 5;
}

export function fmtPrice(value: number, decimals: number): string {
  return value.toFixed(decimals);
}

/** Highest high / lowest low of a swing pivot search over the closed window. */
function findSwings(bars: PreScanBar[]): { high: number; low: number } {
  const look = bars.slice(-40);
  let high = -Infinity;
  let low = Infinity;
  // Fractal pivots: a high with two lower highs either side, and the mirror.
  for (let i = 2; i < look.length - 2; i++) {
    const b = look[i];
    const isHigh = look[i - 1].high < b.high && look[i - 2].high < b.high && look[i + 1].high < b.high && look[i + 2].high < b.high;
    const isLow = look[i - 1].low > b.low && look[i - 2].low > b.low && look[i + 1].low > b.low && look[i + 2].low > b.low;
    if (isHigh) high = b.high;
    if (isLow) low = b.low;
  }
  // No clean pivot found: fall back to the window extremes so the question can
  // still be asked about a real level on the chart.
  if (!Number.isFinite(high)) high = Math.max(...look.map((b) => b.high));
  if (!Number.isFinite(low)) low = Math.min(...look.map((b) => b.low));
  return { high, low };
}

function atr14(bars: PreScanBar[]): number {
  const look = bars.slice(-15);
  if (look.length < 2) return 0;
  let sum = 0;
  let n = 0;
  for (let i = 1; i < look.length; i++) {
    const prev = look[i - 1].close;
    const b = look[i];
    sum += Math.max(b.high - b.low, Math.abs(b.high - prev), Math.abs(b.low - prev));
    n++;
  }
  return n ? sum / n : 0;
}

/**
 * Read the chart the trader is looking at. `bars` comes straight from the same
 * OHLC feed the chart uses; the final bar is treated as forming and dropped.
 */
export function readChartFacts(bars: PreScanBar[] | undefined | null): ChartFacts | null {
  if (!bars || bars.length < 20) return null;
  const closed = bars.slice(0, -1);
  if (closed.length < 20) return null;
  const last = closed[closed.length - 1];
  if (!Number.isFinite(last?.close)) return null;

  const { high, low } = findSwings(closed);
  const atr = atr14(closed);
  const first = closed[Math.max(0, closed.length - 20)].close;
  const drift = last.close - first;
  const trend: ChartFacts["trend"] = Math.abs(drift) < atr ? "sideways" : drift > 0 ? "up" : "down";

  return {
    lastClose: last.close,
    swingHigh: high,
    swingLow: low,
    atr,
    trend,
    decimals: decimalsFor(last.close),
    toHigh: Math.max(0, high - last.close),
    toLow: Math.max(0, last.close - low),
  };
}

/**
 * Build questions about this instrument on this timeframe, using its own levels.
 * Deterministic for a given seed so the same scan does not reshuffle mid-read.
 */
export function buildChartQuestions(opts: {
  facts: ChartFacts;
  instrument: string;
  timeframe: string;
  seed?: number;
}): PreScanQuestion[] {
  const { facts, instrument, timeframe } = opts;
  const d = facts.decimals;
  const p = (v: number) => fmtPrice(v, d);
  const atrTxt = p(facts.atr);
  const tightStop = p(facts.atr * 0.25);

  const trendWord = facts.trend === "up" ? "higher" : facts.trend === "down" ? "lower" : "sideways";
  const longSide = facts.trend === "up";

  const candidates: PreScanQuestion[] = [
    {
      id: "ctx-direction",
      question: `${instrument} on ${timeframe}: the last closed candle finished at ${p(facts.lastClose)}, with the recent swing high at ${p(facts.swingHigh)} and the swing low at ${p(facts.swingLow)}. Over the last 20 closed candles price has moved ${trendWord}. Which side is the structure offering right now?`,
      options:
        facts.trend === "sideways"
          ? [
              "Longs, the low is closer",
              "Shorts, the high is closer",
              `Neither yet - price is ranging between ${p(facts.swingLow)} and ${p(facts.swingHigh)}, so wait for a closed break of one side`,
              "Both, trade whichever fills first",
            ]
          : [
              longSide
                ? `Longs, in line with the move up, once price offers a level rather than chasing ${p(facts.lastClose)}`
                : `Shorts, in line with the move down, once price offers a level rather than chasing ${p(facts.lastClose)}`,
              longSide ? "Shorts, it has gone up too far" : "Longs, it has gone down too far",
              "Either side, the timeframe decides nothing",
              "Whichever side the last candle closed",
            ],
      correct: facts.trend === "sideways" ? 2 : 0,
      why:
        facts.trend === "sideways"
          ? `Between ${p(facts.swingLow)} and ${p(facts.swingHigh)} there is no directional edge on ${timeframe}. The trade appears when a candle closes beyond one of those levels.`
          : `The closed-candle structure on ${timeframe} is pointing ${trendWord}, so that is the side you are allowed to take. Wanting a reversal because it "went far" is a prediction, not a read.`,
    },
    {
      id: "ctx-invalidation",
      question: `If you take the ${longSide ? "long" : "short"} on ${instrument} here, which price on this chart proves the idea wrong?`,
      options: [
        longSide ? `${p(facts.swingLow)} - the swing low the idea depends on` : `${p(facts.swingHigh)} - the swing high the idea depends on`,
        longSide ? `${p(facts.swingHigh)} - the swing high` : `${p(facts.swingLow)} - the swing low`,
        `A round ${instrument} number near ${p(facts.lastClose)}`,
        "Whatever loss size you are comfortable with",
      ],
      correct: 0,
      why: `Invalidation is structural. ${longSide ? `Below ${p(facts.swingLow)}` : `Above ${p(facts.swingHigh)}`} the reason for the trade is gone, so that level - not a comfortable loss - sets the stop, and size comes after it.`,
    },
    {
      id: "ctx-atr",
      question: `One ATR(14) on ${instrument} ${timeframe} is about ${atrTxt}. A stop placed ${tightStop} away from entry is:`,
      options: [
        "Good - the tighter the stop, the better the risk-to-reward",
        `Inside normal noise for ${instrument} on this timeframe, so it gets taken out even when the read is right`,
        "Fine, as long as the target is far away",
        "Correct, because it keeps the loss small in money terms",
      ],
      correct: 1,
      why: `Ordinary movement on ${instrument} ${timeframe} is around ${atrTxt}. A stop well inside that is a coin flip on noise; the stop belongs beyond the level that would disprove you.`,
    },
    {
      id: "ctx-distance",
      question: `Price closed at ${p(facts.lastClose)}, which is ${p(facts.toHigh)} below the swing high and ${p(facts.toLow)} above the swing low. What is the disciplined action if your plan's entry zone is not where price is now?`,
      options: [
        "Enter at market so the move is not missed",
        "Move the entry to the current price",
        `Wait, or leave a limit order in the zone the plan defined on ${instrument}`,
        "Enter half size here and add later",
      ],
      correct: 2,
      why: `Entering away from the zone changes the distance to ${longSide ? p(facts.swingLow) : p(facts.swingHigh)} and therefore the whole risk-to-reward. Outside the zone there is no trade to take on ${instrument} yet.`,
    },
  ];

  const seed = Math.abs(Math.floor((opts.seed ?? Date.now()) / 1000));
  const i = seed % candidates.length;
  return [candidates[i], candidates[(i + 1) % candidates.length]];
}
