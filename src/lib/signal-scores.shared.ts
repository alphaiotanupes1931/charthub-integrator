// Client-safe types and aggregation for the signal quality scoreboard.
//
// Every scan the coach produces is filed as an "open" score row. A background
// job walks the price history forward and marks whether the stop or the first
// target printed first, so hit rates are measured from real bars instead of
// the trader remembering to tag an outcome.

import { ENGINE_FIX_LABEL, isAfterEngineFix } from "@/lib/signal-engine-version";

/**
 * "void" is a row with no direction to score (Neutral bias). It is kept for the
 * audit trail but excluded from every aggregate, so no-opinion scans never count
 * as short bets that happened to win or lose.
 */
export type SignalScoreStatus = "open" | "target" | "stop" | "expired" | "void";

export type SignalScoreRow = {
  id: string;
  symbol: string;
  timeframe: string;
  grade: string;
  bias: string;
  confidence: number | null;
  strategyId: string | null;
  entry: number;
  stop: number;
  tp1: number;
  plannedR: number | null;
  status: SignalScoreStatus;
  realizedR: number | null;
  resolvedAt: string | null;
  taken: boolean;
  createdAt: string;
  /** True when the scan fought the Daily and 4H direction. */
  counterTrend?: boolean;
  /** Daily bias recorded at scan time. */
  htfBias?: string | null;
  /** Realised R after spread and slippage. Null on rows resolved before costs were recorded. */
  netR?: number | null;
  /** Spread and slippage for this row, in R. */
  costR?: number | null;
  /** Maximum adverse excursion in R: heat taken before it resolved. */
  maeR?: number | null;
  /** Maximum favourable excursion in R: best price reached before it resolved. */
  mfeR?: number | null;
};

/**
 * One definition of "resolved" for the whole scoreboard: DECIDED, meaning the
 * stop or the first target actually printed. Expiries are counted and reported
 * on their own line but never folded into hit rate or average R, because an
 * expiry is marked to the last close of a trade that never concluded, and a
 * partial R from a timed-out signal dilutes every figure it lands in.
 */
export type ScoreBucket = {
  key: string;
  /** Scorable rows filed (open + decided + expired). */
  total: number;
  open: number;
  /** Target + stop. The denominator for hit rate, average R and net R. */
  decided: number;
  targets: number;
  stops: number;
  /** Timed out. Reported separately, never inside hitRate/expectancyR. */
  expired: number;
  hitRate: number; // 0-100 over `decided`
  expectancyR: number; // gross average R over `decided`
  /** Average R after costs, over the decided rows that carry a cost figure. */
  netExpectancyR: number | null;
  /** How many decided rows had a net figure to average. */
  netCount: number;
  /** Average cost paid, in R, over the same rows as netExpectancyR. */
  avgCostR: number | null;
  /** Average R on expiries, so timing-out trades are visible but separate. */
  expiredAvgR: number | null;
  /** Average heat taken before resolving, over decided rows that carry it. */
  avgMaeR: number | null;
  /** Average best price reached before resolving. Large on losers means the
   * direction was right and the stop was too tight. */
  avgMfeR: number | null;
  /** How many decided rows carried excursion figures. */
  excursionCount: number;
};

export type Scoreboard = {
  total: number;
  open: number;
  /** No-direction rows held out of every number here. */
  voided: number;
  /** Target + stop. The single denominator behind every headline figure. */
  decided: number;
  targets: number;
  stops: number;
  expired: number;
  expiredAvgR: number | null;
  hitRate: number;
  expectancyR: number;
  netExpectancyR: number | null;
  netCount: number;
  avgCostR: number | null;
  /** A and A+ combined, so the callout and the table share one denominator. */
  aGrade: ScoreBucket;
  byGrade: ScoreBucket[];
  bySymbol: ScoreBucket[];
  byTimeframe: ScoreBucket[];
  byStrategy: ScoreBucket[];
  byConfidence: ScoreBucket[];
  /** Counter-trend vs with-trend, measured from real bars. */
  byTrendContext: ScoreBucket[];
  takenHitRate: number | null;
  skippedHitRate: number | null;
  /** Grade record limited to signals the trader actually traded. */
  takenByGrade: ScoreBucket[];
  notes: string[];
};

const TF_LABEL: Record<string, string> = {
  "1": "1m",
  "5": "5m",
  "15": "15m",
  "30": "30m",
  "60": "1H",
  "240": "4H",
  D: "1D",
  W: "1W",
};

export function tfLabel(tf: string): string {
  return TF_LABEL[tf] ?? tf;
}

/** Rows that can be scored at all: void (no-direction) rows never count. */
export function scorableRows(rows: SignalScoreRow[]): SignalScoreRow[] {
  // Two independent defences against a coin-flip landing in an average: the
  // resolver voids no-direction signals, and this filter refuses anything whose
  // bias is not Long or Short even if it carries a stored verdict from before
  // the resolver was fixed.
  return rows.filter((r) => r.status !== "void" && (r.bias === "Long" || r.bias === "Short"));
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const avg = (xs: number[]): number | null => (xs.length ? r2(xs.reduce((a, b) => a + b, 0) / xs.length) : null);

export function bucket(key: string, all: SignalScoreRow[]): ScoreBucket {
  const rows = scorableRows(all);
  const decidedRows = rows.filter((r) => r.status === "target" || r.status === "stop");
  const expiredRows = rows.filter((r) => r.status === "expired");
  const targets = rows.filter((r) => r.status === "target").length;
  const stops = rows.filter((r) => r.status === "stop").length;
  const decided = decidedRows.length;
  // Net R only over the decided rows that actually carry a cost figure, so a
  // backfill gap cannot silently drag the net number toward gross.
  const netRows = decidedRows.filter((r) => typeof r.netR === "number");
  // Excursions were backfilled from the same bar walk, but only where price
  // history still reaches; average them over the rows that actually have them.
  const excursionRows = decidedRows.filter((r) => typeof r.mfeR === "number" && typeof r.maeR === "number");
  return {
    key,
    total: rows.length,
    open: rows.filter((r) => r.status === "open").length,
    decided,
    targets,
    stops,
    expired: expiredRows.length,
    hitRate: decided ? Math.round((targets / decided) * 1000) / 10 : 0,
    expectancyR: avg(decidedRows.map((r) => r.realizedR ?? 0)) ?? 0,
    netExpectancyR: avg(netRows.map((r) => r.netR as number)),
    netCount: netRows.length,
    avgCostR: avg(netRows.map((r) => r.costR ?? 0)),
    expiredAvgR: avg(expiredRows.map((r) => r.realizedR ?? 0)),
    avgMaeR: avg(excursionRows.map((r) => r.maeR as number)),
    avgMfeR: avg(excursionRows.map((r) => r.mfeR as number)),
    excursionCount: excursionRows.length,
  };
}

function group(rows: SignalScoreRow[], keyOf: (r: SignalScoreRow) => string | null): ScoreBucket[] {
  const map = new Map<string, SignalScoreRow[]>();
  for (const r of rows) {
    const k = keyOf(r);
    if (!k) continue;
    const list = map.get(k);
    if (list) list.push(r);
    else map.set(k, [r]);
  }
  return [...map.entries()]
    .map(([k, list]) => bucket(k, list))
    .sort((a, b) => b.total - a.total);
}

function hitRateOf(all: SignalScoreRow[]): number | null {
  const rows = scorableRows(all);
  const targets = rows.filter((r) => r.status === "target").length;
  const stops = rows.filter((r) => r.status === "stop").length;
  if (targets + stops === 0) return null;
  return Math.round((targets / (targets + stops)) * 1000) / 10;
}

function confidenceBand(c: number | null): string | null {
  if (c == null) return null;
  if (c >= 80) return "80-100%";
  if (c >= 70) return "70-79%";
  if (c >= 60) return "60-69%";
  return "Under 60%";
}

export function buildScoreboard(allRows: SignalScoreRow[]): Scoreboard {
  // No-direction scans are voided, not scored: including them defaults every
  // Neutral read to a short and drags the measured hit rate toward chance.
  const voided = allRows.filter((r) => r.status === "void").length;
  const rows = scorableRows(allRows);
  const overall = bucket("all", rows);
  const notes: string[] = [];

  const byGrade = group(rows, (r) => r.grade);
  const bySymbol = group(rows, (r) => r.symbol);
  const byTimeframe = group(rows, (r) => tfLabel(r.timeframe));
  const byStrategy = group(rows, (r) => r.strategyId);
  const byConfidence = group(rows, (r) => confidenceBand(r.confidence));
  // Counter-trend vs with-trend, split by grade so "counter-trend B" shows up
  // as its own measured line instead of hiding inside the B bucket.
  const byTrendContext = group(rows, (r) =>
    `${r.counterTrend ? "Counter-trend" : "With-trend"} ${r.grade}`);

  const worstSymbol = bySymbol.filter((b) => b.decided >= 4).sort((a, b) => a.expectancyR - b.expectancyR)[0];
  const bestSymbol = bySymbol.filter((b) => b.decided >= 4).sort((a, b) => b.expectancyR - a.expectancyR)[0];
  if (bestSymbol && bestSymbol.expectancyR > 0) {
    notes.push(`${bestSymbol.key} is your strongest instrument: ${bestSymbol.hitRate}% hit rate over ${bestSymbol.decided} decided signals, ${bestSymbol.expectancyR}R average.`);
  }
  if (worstSymbol && worstSymbol.expectancyR < 0 && worstSymbol.key !== bestSymbol?.key) {
    notes.push(`${worstSymbol.key} is losing: ${worstSymbol.hitRate}% hit rate over ${worstSymbol.decided} decided signals, ${worstSymbol.expectancyR}R average. Consider dropping it or trading it smaller.`);
  }

  const aGrades = rows.filter((r) => r.grade === "A" || r.grade === "A+");
  const bGrades = rows.filter((r) => r.grade === "B");
  const aRate = hitRateOf(aGrades);
  const bRate = hitRateOf(bGrades);
  if (aRate != null && bRate != null && aRate <= bRate) {
    notes.push(`A grades are not outperforming B grades right now (${aRate}% vs ${bRate}%). Treat grade as one input, not a guarantee.`);
  }

  const takenRate = hitRateOf(rows.filter((r) => r.taken));
  const skippedRate = hitRateOf(rows.filter((r) => !r.taken));
  if (takenRate != null && skippedRate != null && skippedRate - takenRate >= 10) {
    notes.push(`The signals you skipped resolved better than the ones you took (${skippedRate}% vs ${takenRate}%). Your selection is filtering out the good ones.`);
  }

  const counter = bucket("counter", rows.filter((r) => r.counterTrend));
  const withTrend = bucket("with", rows.filter((r) => !r.counterTrend));
  if (counter.decided >= 4) {
    notes.push(
      `Counter-trend scans (fighting the Daily and 4H): ${counter.hitRate}% hit rate, ${counter.expectancyR}R average over ${counter.decided} decided signals` +
        (withTrend.decided >= 4 ? `, against ${withTrend.hitRate}% and ${withTrend.expectancyR}R with the trend.` : "."),
    );
  }

  const fresh = rows.filter((r) => isAfterEngineFix(r.createdAt));
  const freshBucket = bucket("since-fix", fresh);
  if (freshBucket.targets + freshBucket.stops >= 3) {
    notes.push(
      `Measured ${ENGINE_FIX_LABEL}: ${freshBucket.hitRate}% hit rate and ${freshBucket.expectancyR}R average over ${freshBucket.decided} decided signals, against ${overall.hitRate}% and ${overall.expectancyR}R all time.`,
    );
  }

  if (overall.decided < 10) {
    notes.push("Fewer than 10 decided signals so far (target or stop printed). Numbers here get meaningful after a few weeks of scanning.");
  }

  if (voided > 0) {
    notes.push(
      `${voided} no-direction scan${voided === 1 ? "" : "s"} excluded from these numbers. Neutral reads are not scored either way.`,
    );
  }

  if (overall.expired > 0) {
    notes.push(
      `${overall.expired} signal${overall.expired === 1 ? "" : "s"} timed out without hitting the stop or the target` +
        (overall.expiredAvgR == null ? "" : ` (${overall.expiredAvgR}R average at the last close)`) +
        ". Expiries are shown on their own line and are not counted in hit rate or average R.",
    );
  }

  return {
    voided,
    total: overall.total,
    open: rows.filter((r) => r.status === "open").length,
    decided: overall.decided,
    targets: overall.targets,
    stops: overall.stops,
    expired: overall.expired,
    expiredAvgR: overall.expiredAvgR,
    hitRate: overall.hitRate,
    expectancyR: overall.expectancyR,
    netExpectancyR: overall.netExpectancyR,
    netCount: overall.netCount,
    avgCostR: overall.avgCostR,
    aGrade: bucket("A/A+", aGrades),
    byGrade,
    bySymbol,
    byTimeframe,
    byStrategy,
    byConfidence,
    byTrendContext,
    takenHitRate: takenRate,
    skippedHitRate: skippedRate,
    takenByGrade: group(rows.filter((r) => r.taken), (r) => r.grade),
    notes,
  };
}
