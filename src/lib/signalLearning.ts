// Phase 3: backtest and learn from taken signals.
//
// Reads the device-local signal history (see signalHistory.ts), keeps only the
// signals the trader actually took AND tagged with an outcome, then measures
// where the edge is and where it leaks. The same numbers power the "Backtest
// and learn" panel and the lesson block we hand to the AI coach so it stops
// repeating setups that have historically lost.

import { listSignals, type SignalRecord } from "./signalHistory";
import { journalAsSignalRecords, journalUntaggedCount } from "./journalLearning";


export type Bucket = {
  key: string;
  taken: number;
  wins: number;
  losses: number;
  breakeven: number;
  winRate: number;      // 0-100, wins / (wins + losses)
  expectancyR: number;  // average R per taken trade
};

export type LearningReport = {
  taken: number;
  graded: number;       // taken AND tagged win/loss/breakeven
  wins: number;
  losses: number;
  breakeven: number;
  winRate: number;
  expectancyR: number;
  byGrade: Bucket[];
  bySymbol: Bucket[];
  byBias: Bucket[];
  byTimeframe: Bucket[];
  bySession: Bucket[];
  best: Bucket[];
  worst: Bucket[];
  lessons: string[];
};

const TF_LABEL: Record<string, string> = {
  "1": "1m", "5": "5m", "15": "15m", "30": "30m", "60": "1H", "240": "4H", D: "1D", W: "1W", M: "1M",
};

export function timeframeLabel(interval: string): string {
  return TF_LABEL[interval] ?? interval;
}

export function sessionForHourUtc(hour: number): string {
  if (hour >= 22 || hour < 1) return "Sydney";
  if (hour < 8) return "Tokyo";
  if (hour < 13) return "London";
  if (hour < 17) return "London/NY overlap";
  return "New York";
}

/** Planned R multiple of a signal: (tp1 - entry) / (entry - stop), absolute. */
export function plannedR(rec: SignalRecord): number {
  if (rec.entry == null || rec.stop == null) return 1;
  const risk = Math.abs(rec.entry - rec.stop);
  if (!risk) return 1;
  if (rec.tp1 == null) return 1;
  const reward = Math.abs(rec.tp1 - rec.entry);
  const r = reward / risk;
  return Number.isFinite(r) && r > 0 ? Math.min(r, 20) : 1;
}

/** Realised R for a graded signal: +plannedR on a win, -1 on a loss, 0 flat. */
export function realisedR(rec: SignalRecord): number {
  if (rec.outcome === "win") return plannedR(rec);
  if (rec.outcome === "loss") return -1;
  return 0;
}

function bucket(key: string, recs: SignalRecord[]): Bucket {
  const wins = recs.filter((r) => r.outcome === "win").length;
  const losses = recs.filter((r) => r.outcome === "loss").length;
  const breakeven = recs.filter((r) => r.outcome === "breakeven").length;
  const decided = wins + losses;
  const totalR = recs.reduce((s, r) => s + realisedR(r), 0);
  return {
    key,
    taken: recs.length,
    wins,
    losses,
    breakeven,
    winRate: decided ? Math.round((wins / decided) * 100) : 0,
    expectancyR: recs.length ? Number((totalR / recs.length).toFixed(2)) : 0,
  };
}

function group(recs: SignalRecord[], keyOf: (r: SignalRecord) => string): Bucket[] {
  const map = new Map<string, SignalRecord[]>();
  for (const r of recs) {
    const k = keyOf(r) || "unknown";
    const arr = map.get(k);
    if (arr) arr.push(r);
    else map.set(k, [r]);
  }
  return [...map.entries()]
    .map(([k, v]) => bucket(k, v))
    .sort((a, b) => b.taken - a.taken);
}

export function buildLearningReport(records?: SignalRecord[]): LearningReport {
  // Scan history the trader tagged, plus every resolved journal trade, so real
  // logged outcomes count even when the scan card was never tagged.
  const all = records ?? [...listSignals(), ...journalAsSignalRecords()];
  const taken = all.filter((r) => r.taken);
  const graded = taken.filter((r) => r.outcome === "win" || r.outcome === "loss" || r.outcome === "breakeven");


  const base = bucket("all", graded);
  const byGrade = group(graded, (r) => r.grade || "ungraded");
  const bySymbol = group(graded, (r) => r.symbol);
  const byBias = group(graded, (r) => r.bias);
  const byTimeframe = group(graded, (r) => timeframeLabel(r.interval));
  const bySession = group(graded, (r) => sessionForHourUtc(new Date(r.at).getUTCHours()));

  // Only rank buckets with enough samples to mean anything.
  const rankable = [...bySymbol, ...byGrade, ...bySession, ...byTimeframe].filter((b) => b.taken >= 3);
  const sorted = [...rankable].sort((a, b) => b.expectancyR - a.expectancyR);
  const best = sorted.slice(0, 3);
  const worst = sorted.slice(-3).reverse().filter((b) => b.expectancyR < 0);

  const lessons: string[] = [];
  if (graded.length < 5) {
    lessons.push(`Only ${graded.length} taken signal${graded.length === 1 ? "" : "s"} have an outcome tagged. Tag win/loss/breakeven on taken signals so the coach can measure your real edge.`);
  } else {
    lessons.push(`Across ${graded.length} taken signals: ${base.winRate}% win rate, ${base.expectancyR > 0 ? "+" : ""}${base.expectancyR}R expectancy per trade.`);
    for (const b of worst) {
      lessons.push(`Losing bucket: ${b.key} is ${b.expectancyR}R over ${b.taken} trades (${b.wins}W/${b.losses}L). Skip or halve size here until it turns.`);
    }
    for (const b of best.filter((x) => x.expectancyR > 0)) {
      lessons.push(`Working bucket: ${b.key} is +${b.expectancyR}R over ${b.taken} trades (${b.wins}W/${b.losses}L). This is where the edge lives.`);
    }
    const untagged = taken.length - graded.length;
    if (untagged > 0) lessons.push(`${untagged} taken signal${untagged === 1 ? "" : "s"} still have no outcome tagged.`);
  }

  return {
    taken: taken.length,
    graded: graded.length,
    wins: base.wins,
    losses: base.losses,
    breakeven: base.breakeven,
    winRate: base.winRate,
    expectancyR: base.expectancyR,
    byGrade,
    bySymbol,
    byBias,
    byTimeframe,
    bySession,
    best,
    worst,
    lessons,
  };
}

/** Compact plain-text block handed to the AI coach so it learns from outcomes. */
export function buildLearningPromptBlock(report?: LearningReport): string {
  const r = report ?? buildLearningReport();
  if (r.graded === 0) {
    return "The trader has not tagged any taken signal with an outcome yet, so there is no measured signal edge. Do not invent past performance numbers.";
  }
  const fmt = (bs: Bucket[]) =>
    bs.slice(0, 6).map((b) => `  ${b.key}: ${b.taken} trades, ${b.winRate}% WR, ${b.expectancyR > 0 ? "+" : ""}${b.expectancyR}R avg`).join("\n");
  return [
    `SIGNAL BACKTEST (taken signals with tagged outcomes: ${r.graded} of ${r.taken}):`,
    `Overall: ${r.winRate}% win rate (${r.wins}W/${r.losses}L/${r.breakeven}BE), ${r.expectancyR > 0 ? "+" : ""}${r.expectancyR}R expectancy per trade.`,
    `BY GRADE:\n${fmt(r.byGrade)}`,
    `BY SYMBOL:\n${fmt(r.bySymbol)}`,
    `BY DIRECTION:\n${fmt(r.byBias)}`,
    `BY TIMEFRAME:\n${fmt(r.byTimeframe)}`,
    `BY SESSION (UTC):\n${fmt(r.bySession)}`,
    r.worst.length ? `LOSING BUCKETS to warn about: ${r.worst.map((b) => `${b.key} (${b.expectancyR}R)`).join(", ")}` : "",
  ].filter(Boolean).join("\n");
}
