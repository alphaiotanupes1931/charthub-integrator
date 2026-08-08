// Client-safe types and aggregation for the signal quality scoreboard.
//
// Every scan the coach produces is filed as an "open" score row. A background
// job walks the price history forward and marks whether the stop or the first
// target printed first, so hit rates are measured from real bars instead of
// the trader remembering to tag an outcome.

export type SignalScoreStatus = "open" | "target" | "stop" | "expired";

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
  takenHitRate: number | null;
  skippedHitRate: number | null;
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

function bucket(key: string, rows: SignalScoreRow[]): ScoreBucket {
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

function hitRateOf(rows: SignalScoreRow[]): number | null {
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

export function buildScoreboard(rows: SignalScoreRow[]): Scoreboard {
  const overall = bucket("all", rows);
  const notes: string[] = [];

  const byGrade = group(rows, (r) => r.grade);
  const bySymbol = group(rows, (r) => r.symbol);
  const byTimeframe = group(rows, (r) => tfLabel(r.timeframe));
  const byStrategy = group(rows, (r) => r.strategyId);
  const byConfidence = group(rows, (r) => confidenceBand(r.confidence));

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

  if (overall.resolved < 10) {
    notes.push("Fewer than 10 resolved signals so far. Numbers here get meaningful after a few weeks of scanning.");
  }

  return {
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
    takenHitRate: takenRate,
    skippedHitRate: skippedRate,
    notes,
  };
}
