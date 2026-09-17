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
};

export type ScoreBucket = {
  key: string;
  total: number;
  resolved: number;
  targets: number;
  stops: number;
  expired: number;
  hitRate: number; // 0-100 of resolved win/loss rows
  expectancyR: number; // average R across resolved rows
};

export type Scoreboard = {
  total: number;
  open: number;
  /** No-direction rows held out of every number here. */
  voided: number;
  resolved: number;
  targets: number;
  stops: number;
  expired: number;
  hitRate: number;
  expectancyR: number;
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
  return rows.filter((r) => r.status !== "void");
}

function bucket(key: string, all: SignalScoreRow[]): ScoreBucket {
  const rows = scorableRows(all);
  const targets = rows.filter((r) => r.status === "target").length;
  const stops = rows.filter((r) => r.status === "stop").length;
  const expired = rows.filter((r) => r.status === "expired").length;
  const decided = targets + stops;
  const resolvedRows = rows.filter((r) => r.status !== "open");
  const rSum = resolvedRows.reduce((acc, r) => acc + (r.realizedR ?? 0), 0);
  return {
    key,
    total: rows.length,
    resolved: resolvedRows.length,
    targets,
    stops,
    expired,
    hitRate: decided ? Math.round((targets / decided) * 1000) / 10 : 0,
    expectancyR: resolvedRows.length ? Math.round((rSum / resolvedRows.length) * 100) / 100 : 0,
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

  const worstSymbol = bySymbol.filter((b) => b.resolved >= 4).sort((a, b) => a.expectancyR - b.expectancyR)[0];
  const bestSymbol = bySymbol.filter((b) => b.resolved >= 4).sort((a, b) => b.expectancyR - a.expectancyR)[0];
  if (bestSymbol && bestSymbol.expectancyR > 0) {
    notes.push(`${bestSymbol.key} is your strongest instrument: ${bestSymbol.hitRate}% hit rate over ${bestSymbol.resolved} resolved signals, ${bestSymbol.expectancyR}R average.`);
  }
  if (worstSymbol && worstSymbol.expectancyR < 0 && worstSymbol.key !== bestSymbol?.key) {
    notes.push(`${worstSymbol.key} is losing: ${worstSymbol.hitRate}% hit rate over ${worstSymbol.resolved} resolved signals, ${worstSymbol.expectancyR}R average. Consider dropping it or trading it smaller.`);
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
  if (counter.resolved >= 4) {
    notes.push(
      `Counter-trend scans (fighting the Daily and 4H): ${counter.hitRate}% hit rate, ${counter.expectancyR}R average over ${counter.resolved} resolved signals` +
        (withTrend.resolved >= 4 ? `, against ${withTrend.hitRate}% and ${withTrend.expectancyR}R with the trend.` : "."),
    );
  }

  const fresh = rows.filter((r) => isAfterEngineFix(r.createdAt));
  const freshBucket = bucket("since-fix", fresh);
  if (freshBucket.targets + freshBucket.stops >= 3) {
    notes.push(
      `Measured ${ENGINE_FIX_LABEL}: ${freshBucket.hitRate}% hit rate and ${freshBucket.expectancyR}R average over ${freshBucket.resolved} resolved signals, against ${overall.hitRate}% and ${overall.expectancyR}R all time.`,
    );
  }

  if (overall.resolved < 10) {
    notes.push("Fewer than 10 resolved signals so far. Numbers here get meaningful after a few weeks of scanning.");
  }

  if (voided > 0) {
    notes.push(
      `${voided} no-direction scan${voided === 1 ? "" : "s"} excluded from these numbers. Neutral reads are not scored either way.`,
    );
  }

  return {
    voided,
    total: overall.total,
    open: rows.filter((r) => r.status === "open").length,
    resolved: overall.resolved,
    targets: overall.targets,
    stops: overall.stops,
    expired: overall.expired,
    hitRate: overall.hitRate,
    expectancyR: overall.expectancyR,
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
