/**
 * Does the daily bias explain our results better than the 4H trend?
 *
 * The claim under test: when the daily bias is down and the 4H is up, the 4H move
 * is a retracement into the next sell, so the app should follow the daily bias
 * rather than the 4H trend. Today the 4H direction is the hard gate, which means
 * exactly those setups are issued as buys.
 *
 * This measures the claim on our own decided signals. Every signal is tagged with
 * the daily and 4H direction present at filing time, using only candles that had
 * closed at or before that moment, and outcomes are split three ways:
 *   with-daily              - trade direction agreed with the daily bias
 *   against-daily-with-4h   - fought the daily bias but went with the 4H (the
 *                             retracement case Neal describes)
 *   counter-trend           - fought both
 *
 * Read-only research. Nothing is written back and no live gate changes off it.
 */

import { wilson95, SAMPLE_FLOOR, twoProportionP } from "@/lib/statistics";
import type { ReplayBar } from "@/lib/signal-replay";

export type Bucket = "with-daily" | "against-daily-with-4h" | "counter-trend" | "unclassified";

export type BiasSignal = {
  id: string;
  symbol: string;
  timeframe: string;
  grade: string;
  bias: string;
  status: string;
  /** Net of costs where present, gross otherwise. */
  r: number | null;
  created_at: string;
};

export type TaggedBiasSignal = BiasSignal & {
  dailyBias: "bullish" | "bearish" | "neutral" | null;
  h4Trend: "up" | "down" | "range" | null;
  bucket: Bucket;
};

export type BiasCell = {
  bucket: Bucket;
  decided: number;
  targets: number;
  stops: number;
  hitRate: number | null;
  hitRate95: { low: number; high: number } | null;
  avgR: number | null;
  enoughData: boolean;
};

export type DailyBiasSplitReport = {
  tagged: number;
  untagged: number;
  byBucket: BiasCell[];
  bySymbol: { symbol: string; cells: BiasCell[] }[];
  aGradeByBucket: BiasCell[];
  /** with-daily vs the retracement bucket, when both clear the sample floor. */
  comparison: {
    withDailyAvgR: number;
    againstDailyAvgR: number;
    avgRGap: number;
    hitRateP: number | null;
  } | null;
  verdict: string;
  notes: string[];
};

const round = (n: number, dp = 3) => Math.round(n * 10 ** dp) / 10 ** dp;

function ema(values: number[], period: number): number | null {
  if (values.length < period) return null;
  const k = 2 / (period + 1);
  let e = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < values.length; i++) e = values[i]! * k + e * (1 - k);
  return e;
}

/** Closed bars at or before the filing time - never after. */
function before(bars: ReplayBar[], createdAtIso: string): ReplayBar[] {
  const t = Math.floor(new Date(createdAtIso).getTime() / 1000);
  if (!Number.isFinite(t)) return [];
  return bars.filter((b) => b.time <= t);
}

/**
 * Direction of a timeframe at filing time: fast against slow moving average,
 * with a dead band so a flat market is not called a trend.
 */
export function directionAt(
  bars: ReplayBar[],
  createdAtIso: string,
  band = 0.1,
): "bullish" | "bearish" | "neutral" | null {
  const hist = before(bars, createdAtIso);
  if (hist.length < 60) return null;
  const closes = hist.map((b) => b.close);
  const last = closes[closes.length - 1]!;
  const fast = ema(closes, 20);
  const slow = ema(closes, 50);
  if (fast == null || slow == null || !(last > 0)) return null;
  const sep = ((fast - slow) / last) * 100;
  return sep > band ? "bullish" : sep < -band ? "bearish" : "neutral";
}

export function bucketFor(input: {
  bias: string;
  dailyBias: "bullish" | "bearish" | "neutral" | null;
  h4: "bullish" | "bearish" | "neutral" | null;
}): Bucket {
  const side = input.bias.trim().toLowerCase();
  const wanted = side === "long" ? "bullish" : side === "short" ? "bearish" : null;
  if (!wanted || !input.dailyBias || input.dailyBias === "neutral") return "unclassified";
  if (input.dailyBias === wanted) return "with-daily";
  // Fights the daily bias. Which way was the 4H pointing?
  if (input.h4 === wanted) return "against-daily-with-4h";
  if (input.h4 && input.h4 !== wanted && input.h4 !== "neutral") return "counter-trend";
  return "unclassified";
}

function cell(bucket: Bucket, rows: TaggedBiasSignal[]): BiasCell {
  const decidedRows = rows.filter((r) => r.status === "target" || r.status === "stop");
  const targets = decidedRows.filter((r) => r.status === "target").length;
  const rs = decidedRows.map((r) => r.r).filter((v): v is number => v != null);
  return {
    bucket,
    decided: decidedRows.length,
    targets,
    stops: decidedRows.length - targets,
    hitRate: decidedRows.length ? round((targets / decidedRows.length) * 100, 1) : null,
    hitRate95: wilson95(targets, decidedRows.length),
    avgR: rs.length ? round(rs.reduce((a, b) => a + b, 0) / rs.length) : null,
    enoughData: decidedRows.length >= SAMPLE_FLOOR,
  };
}

export function analyzeDailyBiasSplit(rows: TaggedBiasSignal[]): DailyBiasSplitReport {
  const tagged = rows.filter((r) => r.bucket !== "unclassified");
  const untagged = rows.length - tagged.length;

  const buckets: Bucket[] = ["with-daily", "against-daily-with-4h", "counter-trend"];
  const byBucket = buckets.map((b) => cell(b, tagged.filter((r) => r.bucket === b)));

  const symbols = Array.from(new Set(tagged.map((r) => r.symbol)));
  const bySymbol = symbols
    .map((symbol) => {
      const own = tagged.filter((r) => r.symbol === symbol);
      return { symbol, cells: buckets.map((b) => cell(b, own.filter((r) => r.bucket === b))) };
    })
    .sort((a, b) => {
      const an = a.cells.reduce((s, c) => s + c.decided, 0);
      const bn = b.cells.reduce((s, c) => s + c.decided, 0);
      return bn - an;
    });

  const aRows = tagged.filter((r) => r.grade.trim().toUpperCase().startsWith("A"));
  const aGradeByBucket = buckets.map((b) => cell(b, aRows.filter((r) => r.bucket === b)));

  const withDaily = byBucket[0]!;
  const against = byBucket[1]!;
  let comparison: DailyBiasSplitReport["comparison"] = null;
  if (
    withDaily.enoughData && against.enoughData &&
    withDaily.avgR != null && against.avgR != null
  ) {
    comparison = {
      withDailyAvgR: withDaily.avgR,
      againstDailyAvgR: against.avgR,
      avgRGap: round(withDaily.avgR - against.avgR),
      hitRateP: twoProportionP(withDaily.targets, withDaily.decided, against.targets, against.decided),
    };
  }

  const notes = [
    "Daily and 4H direction reconstructed from candles closed at or before filing time; no look-ahead.",
    `Cells under ${SAMPLE_FLOOR} decided trades are reported, not claimed.`,
    "Read-only: the 4H direction gate is unchanged until a held-out split repeats the result.",
  ];
  if (untagged) notes.push(`${untagged} signals could not be tagged (flat daily bias or short history).`);

  let verdict: string;
  if (!comparison) {
    verdict =
      "Not enough decided trades on both sides to judge the daily-bias-first idea. The 4H gate stays as it is.";
  } else if (comparison.avgRGap > 0.1 && (comparison.hitRateP ?? 1) <= 0.05) {
    verdict = `Supported so far: trades with the daily bias earned ${comparison.avgRGap}R more per trade than retracement trades against it (p=${round(comparison.hitRateP ?? 1)}). Worth a shadow trial of a daily-bias filter.`;
  } else if (comparison.avgRGap > 0.1) {
    verdict = `Points the same way as the claim (${comparison.avgRGap}R gap) but not statistically clear (p=${comparison.hitRateP == null ? "n/a" : round(comparison.hitRateP)}). Keep measuring; no gate change.`;
  } else if (comparison.avgRGap < -0.1) {
    verdict = `Against the claim: retracement trades that followed the 4H did ${round(-comparison.avgRGap)}R better per trade than trades with the daily bias. Following the daily bias instead would have cost money.`;
  } else {
    verdict = "No meaningful difference between following the daily bias and following the 4H. No change justified.";
  }

  return { tagged: tagged.length, untagged, byBucket, bySymbol, aGradeByBucket, comparison, verdict, notes };
}
