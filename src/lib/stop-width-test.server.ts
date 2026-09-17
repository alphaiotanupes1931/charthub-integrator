// Stop-width experiment.
//
// The planner gives A grades a 1.1x ATR stop, B 1.25x and C 1.5x, with R:R held
// at 1.5:1. That makes hit rates non-comparable across grades: an A grade has 36%
// less room before noise takes it out than a C grade does, so part of any grade
// inversion is mechanical rather than evidence about setup quality.
//
// This re-scores already-resolved signals with the stop widened to a single
// common multiple, keeping entry, direction and TP1 exactly as filed, so the ONLY
// thing that changes is stop width. ATR at scan time is recovered from the filed
// risk distance: stop distance was atr * mult, so atr = |entry - stop| / mult.

import { resolveSignal, signalDirection, type OpenSignal } from "@/lib/signal-scores.server";
import { costInR } from "@/lib/trading-costs";

/** Stop multiples the planner used when these rows were filed. */
export const PLANNER_STOP_MULT: Record<string, number> = {
  "A+": 1.1,
  A: 1.1,
  B: 1.25,
  C: 1.5,
};

export type StopWidthBand = {
  grade: string;
  trades: number;
  /** As filed, at the planner's grade-dependent stop. */
  beforeHitRate: number | null;
  beforeExpectancyR: number | null;
  beforeNetExpectancyR: number | null;
  /** Re-scored at the common stop multiple. */
  afterHitRate: number | null;
  afterExpectancyR: number | null;
  afterNetExpectancyR: number | null;
  /** Average cost in R before and after widening, to show the second bias. */
  beforeCostR: number | null;
  afterCostR: number | null;
};

export type StopWidthReport = {
  targetMult: number;
  /** True when TP1 was moved with the stop so planned R:R stayed constant. */
  scaledTargets: boolean;
  bands: StopWidthBand[];
  skipped: number;
  notes: string[];
};

type Filed = {
  id: string;
  symbol: string;
  timeframe: string;
  grade: string;
  bias: string;
  entry: number;
  stop: number;
  tp1: number;
  status: string;
  realizedR: number | null;
  created_at: string;
};

const avg = (xs: number[]): number | null =>
  xs.length ? Math.round((xs.reduce((s, x) => s + x, 0) / xs.length) * 100) / 100 : null;

const rate = (wins: number, losses: number): number | null =>
  wins + losses ? Math.round((wins / (wins + losses)) * 1000) / 10 : null;

/**
 * Re-resolve each filed signal with the stop moved to `targetMult` x ATR.
 *
 * Two modes, and the difference is the whole point:
 *
 *   scaleTargets: false — TP1 stays where it was filed. Widening the stop then
 *     lowers planned R as well as the chance of being stopped, so hit rate rises
 *     while each win pays less. That is two changes at once and it is why the
 *     first run of this test came back "not clearly better": it was comparing
 *     two different bets, not two stop widths.
 *
 *   scaleTargets: true — TP1 moves out by the same factor as the stop, so planned
 *     R:R is held constant. This is the version that isolates stop width, and it
 *     is the one to read when asking whether A grades were being stopped out by
 *     noise.
 */
export async function runStopWidthTest(
  rows: Filed[],
  targetMult = 1.5,
  opts: { scaleTargets?: boolean } = {},
): Promise<StopWidthReport> {
  const scaleTargets = opts.scaleTargets ?? false;
  const notes: string[] = [];
  let skipped = 0;

  const byGrade = new Map<string, { before: Filed[]; after: Array<{ row: Filed; r: number | null; hit: boolean | null; costR: number }> }>();

  for (const row of rows) {
    const direction = signalDirection(row.bias);
    const filedMult = PLANNER_STOP_MULT[row.grade];
    const risk = Math.abs(row.entry - row.stop);
    if (!direction || !filedMult || !(risk > 0)) {
      skipped += 1;
      continue;
    }
    const atr = risk / filedMult;
    const widened = atr * targetMult;
    const stop = direction === "long" ? row.entry - widened : row.entry + widened;
    // Hold planned R:R constant by moving TP1 out in the same proportion as the
    // stop, so the only variable is how much room the trade is given.
    const scale = widened / risk;
    const tp1 = scaleTargets
      ? row.entry + (row.tp1 - row.entry) * scale
      : row.tp1;

    const sig: OpenSignal = {
      id: row.id,
      symbol: row.symbol,
      timeframe: row.timeframe,
      bias: row.bias,
      entry: row.entry,
      stop,
      tp1,
      created_at: row.created_at,
    };
    const res = await resolveSignal(sig);
    const bucket = byGrade.get(row.grade) ?? { before: [], after: [] };
    bucket.before.push(row);
    bucket.after.push({
      row,
      r: res.realizedR,
      hit: res.status === "target" ? true : res.status === "stop" ? false : null,
      costR: costInR(row.symbol, row.entry, widened),
    });
    byGrade.set(row.grade, bucket);
  }

  const bands: StopWidthBand[] = [...byGrade.entries()].map(([grade, b]) => {
    const beforeWins = b.before.filter((r) => r.status === "target").length;
    const beforeLosses = b.before.filter((r) => r.status === "stop").length;
    const beforeR = b.before.map((r) => r.realizedR).filter((r): r is number => r != null);
    const beforeCost = b.before.map((r) => costInR(r.symbol, r.entry, Math.abs(r.entry - r.stop)));
    const afterWins = b.after.filter((a) => a.hit === true).length;
    const afterLosses = b.after.filter((a) => a.hit === false).length;
    const afterR = b.after.map((a) => a.r).filter((r): r is number => r != null);
    const afterCost = b.after.map((a) => a.costR);
    const beforeExp = avg(beforeR);
    const afterExp = avg(afterR);
    const beforeC = avg(beforeCost);
    const afterC = avg(afterCost);
    return {
      grade,
      trades: b.before.length,
      beforeHitRate: rate(beforeWins, beforeLosses),
      beforeExpectancyR: beforeExp,
      beforeNetExpectancyR: beforeExp == null || beforeC == null ? null : Math.round((beforeExp - beforeC) * 100) / 100,
      afterHitRate: rate(afterWins, afterLosses),
      afterExpectancyR: afterExp,
      afterNetExpectancyR: afterExp == null || afterC == null ? null : Math.round((afterExp - afterC) * 100) / 100,
      beforeCostR: beforeC,
      afterCostR: afterC,
    };
  });

  bands.sort((a, b) => (PLANNER_STOP_MULT[a.grade] ?? 9) - (PLANNER_STOP_MULT[b.grade] ?? 9) || a.grade.localeCompare(b.grade));

  if (skipped > 0) {
    notes.push(`${skipped} rows skipped: no direction, unknown grade or zero risk distance.`);
  }
  notes.push(
    scaleTargets
      ? "TP1 was moved out in the same proportion as the stop, so planned R:R is unchanged and the only variable is how much room the trade was given. Read this run when asking whether A grades were being stopped out by noise."
      : "Only the stop moved. TP1 stayed where it was filed, so widening the stop also lowered planned R: hit rate rises while each win pays less. This run cannot separate the two effects - use scaleTargets for that.",
  );

  return { targetMult, scaledTargets: scaleTargets, bands, skipped, notes };
}
