/**
 * Grade inversion attribution.
 *
 * The stop-width test answered one question and raised a better one: widening the
 * A-grade stop raised its hit rate but each win paid less, because TP1 stayed
 * where it was, and C still beat A. Two things follow from that, and both are
 * measurement problems rather than evidence about setup quality:
 *
 *   1. Moving the stop without moving the target changes the payoff, so
 *      "before vs after" was comparing two different bets. Holding R:R constant
 *      is the only version of that test that isolates stop width. That fix lives
 *      in stop-width-test.server.ts (scaleTargets).
 *
 *   2. A and C are not drawn from the same population. Grades are assigned by the
 *      engine, so the A bucket and the C bucket differ in instrument mix, session,
 *      direction, planned R and whether the trade fought the higher timeframe. Any
 *      of those can produce an inversion on its own. Comparing raw grade averages
 *      across unequal mixes is Simpson's paradox waiting to happen.
 *
 * So this module compares grades three ways: raw, within each instrument class,
 * and mix-adjusted, where every grade is re-weighted onto one common instrument
 * mix. If the inversion survives the mix adjustment it is real and the grading has
 * to change. If it does not, the grading was being judged on composition.
 *
 * Nothing here writes anything or changes a published grade.
 */

import { classifyInstrument, type InstrumentClass } from "@/lib/scanner/program";
import { PLANNER_STOP_MULT } from "@/lib/stop-width-test.server";

export type InversionRow = {
  symbol: string;
  grade: string;
  status: string;
  realizedR: number | null;
  netR: number | null;
  plannedR: number | null;
  maeR: number | null;
  mfeR: number | null;
  barsToResolve: number | null;
  counterTrend: boolean | null;
  entry: number;
  stop: number;
  createdAt: string;
};

export type GradeStats = {
  grade: string;
  trades: number;
  hitRate: number | null;
  expectancyR: number | null;
  netExpectancyR: number | null;
  avgPlannedR: number | null;
  /** Stop distance in ATR, recovered from the filed risk and the planner multiple. */
  avgStopAtr: number | null;
  avgMaeR: number | null;
  avgMfeR: number | null;
  avgBars: number | null;
  counterTrendShare: number | null;
  /** Share of this grade's trades that fell in each liquid-hours bucket. */
  classMix: Array<{ klass: InstrumentClass; share: number; trades: number }>;
};

export type WithinClass = {
  klass: InstrumentClass;
  grades: Array<{ grade: string; trades: number; hitRate: number | null; expectancyR: number | null; netExpectancyR: number | null }>;
  /** A minus C on net expectancy inside this class. Negative means inverted here too. */
  aMinusC: number | null;
  comparable: boolean;
};

export type MixAdjusted = {
  grade: string;
  /** Expectancy re-weighted onto the whole sample's instrument mix. */
  adjustedExpectancyR: number | null;
  adjustedNetExpectancyR: number | null;
  /** Share of the common mix this grade actually has enough trades to cover. */
  coverage: number;
  cellsUsed: number;
};

export type InversionReport = {
  sampled: number;
  skipped: number;
  raw: GradeStats[];
  withinClass: WithinClass[];
  mixAdjusted: MixAdjusted[];
  /** MFE tells us whether A trades were going our way before they turned. */
  findings: string[];
  verdict: string;
};

const MIN_CELL = 5;
const MIN_COMPARE = 20;

const r2 = (n: number) => Math.round(n * 100) / 100;
const mean = (xs: number[]): number | null => (xs.length ? r2(xs.reduce((s, x) => s + x, 0) / xs.length) : null);
const nums = (xs: Array<number | null>): number[] => xs.filter((x): x is number => x != null && Number.isFinite(x));
const hitRate = (rows: InversionRow[]): number | null => {
  const w = rows.filter((r) => r.status === "target").length;
  const l = rows.filter((r) => r.status === "stop").length;
  return w + l ? Math.round((w / (w + l)) * 1000) / 10 : null;
};
const tier = (grade: string) => (grade === "A+" || grade === "A" ? "A" : grade.startsWith("B") ? "B" : "C");

function statsFor(grade: string, rows: InversionRow[], total: number): GradeStats {
  const byClass = new Map<InstrumentClass, number>();
  for (const r of rows) {
    const k = classifyInstrument(r.symbol).klass;
    byClass.set(k, (byClass.get(k) ?? 0) + 1);
  }
  const stopAtr = nums(
    rows.map((r) => {
      const mult = PLANNER_STOP_MULT[r.grade];
      const risk = Math.abs(r.entry - r.stop);
      return mult && risk > 0 ? mult : null;
    }),
  );
  const ct = rows.filter((r) => r.counterTrend != null);
  return {
    grade,
    trades: rows.length,
    hitRate: hitRate(rows),
    expectancyR: mean(nums(rows.map((r) => r.realizedR))),
    netExpectancyR: mean(nums(rows.map((r) => r.netR ?? r.realizedR))),
    avgPlannedR: mean(nums(rows.map((r) => r.plannedR))),
    avgStopAtr: mean(stopAtr),
    avgMaeR: mean(nums(rows.map((r) => r.maeR))),
    avgMfeR: mean(nums(rows.map((r) => r.mfeR))),
    avgBars: mean(nums(rows.map((r) => r.barsToResolve))),
    counterTrendShare: ct.length ? r2(ct.filter((r) => r.counterTrend).length / ct.length) : null,
    classMix: [...byClass.entries()]
      .map(([klass, trades]) => ({ klass, trades, share: r2(trades / Math.max(1, total ? rows.length : 1)) }))
      .sort((a, b) => b.trades - a.trades),
  };
}

/**
 * Compare grades raw, within instrument class, and on one common instrument mix.
 */
export function analyzeGradeInversion(input: InversionRow[]): InversionReport {
  const rows = input.filter((r) => r.status === "target" || r.status === "stop" || r.status === "expired");
  const skipped = input.length - rows.length;

  const grades = [...new Set(rows.map((r) => r.grade))].sort((a, b) => {
    const order = ["A+", "A", "B", "C"];
    const ai = order.indexOf(a);
    const bi = order.indexOf(b);
    return (ai < 0 ? 9 : ai) - (bi < 0 ? 9 : bi) || a.localeCompare(b);
  });

  const raw = grades.map((g) => statsFor(g, rows.filter((r) => r.grade === g), rows.length));

  // --- within class -------------------------------------------------------
  const classes = [...new Set(rows.map((r) => classifyInstrument(r.symbol).klass))];
  const withinClass: WithinClass[] = classes.map((klass) => {
    const inClass = rows.filter((r) => classifyInstrument(r.symbol).klass === klass);
    const byTier = (t: string) => inClass.filter((r) => tier(r.grade) === t);
    const gradeRows = ["A", "B", "C"].map((t) => {
      const rs = byTier(t);
      return {
        grade: t,
        trades: rs.length,
        hitRate: hitRate(rs),
        expectancyR: mean(nums(rs.map((r) => r.realizedR))),
        netExpectancyR: mean(nums(rs.map((r) => r.netR ?? r.realizedR))),
      };
    });
    const a = gradeRows.find((g) => g.grade === "A")!;
    const c = gradeRows.find((g) => g.grade === "C")!;
    const comparable = a.trades >= MIN_COMPARE && c.trades >= MIN_COMPARE;
    return {
      klass,
      grades: gradeRows,
      aMinusC: a.netExpectancyR == null || c.netExpectancyR == null ? null : r2(a.netExpectancyR - c.netExpectancyR),
      comparable,
    };
  }).sort((a, b) => Number(b.comparable) - Number(a.comparable) || a.klass.localeCompare(b.klass));

  // --- mix adjusted -------------------------------------------------------
  // Common weights come from the whole resolved sample, so every grade is scored
  // as if it had traded the same instruments in the same proportions.
  const commonWeights = new Map<InstrumentClass, number>();
  for (const r of rows) {
    const k = classifyInstrument(r.symbol).klass;
    commonWeights.set(k, (commonWeights.get(k) ?? 0) + 1 / rows.length);
  }

  const mixAdjusted: MixAdjusted[] = grades.map((g) => {
    const gr = rows.filter((r) => r.grade === g);
    let wSum = 0;
    let rSum = 0;
    let nSum = 0;
    let cells = 0;
    for (const [klass, w] of commonWeights) {
      const cell = gr.filter((r) => classifyInstrument(r.symbol).klass === klass);
      if (cell.length < MIN_CELL) continue;
      const m = mean(nums(cell.map((r) => r.realizedR)));
      const n = mean(nums(cell.map((r) => r.netR ?? r.realizedR)));
      if (m == null) continue;
      wSum += w;
      rSum += w * m;
      nSum += w * (n ?? m);
      cells += 1;
    }
    return {
      grade: g,
      adjustedExpectancyR: wSum > 0 ? r2(rSum / wSum) : null,
      adjustedNetExpectancyR: wSum > 0 ? r2(nSum / wSum) : null,
      coverage: r2(wSum),
      cellsUsed: cells,
    };
  });

  // --- findings -----------------------------------------------------------
  const findings: string[] = [];
  const rawA = raw.find((g) => g.grade === "A") ?? raw.find((g) => g.grade === "A+");
  const rawC = raw.find((g) => g.grade === "C");

  if (rawA && rawC) {
    if (rawA.netExpectancyR != null && rawC.netExpectancyR != null) {
      findings.push(
        `Raw: A makes ${rawA.netExpectancyR}R net per trade over ${rawA.trades} trades, C makes ${rawC.netExpectancyR}R over ${rawC.trades}. Gap ${r2(rawA.netExpectancyR - rawC.netExpectancyR)}R.`,
      );
    }
    // Mechanical differences that make the raw comparison unfair.
    if (rawA.avgStopAtr != null && rawC.avgStopAtr != null && rawA.avgStopAtr < rawC.avgStopAtr) {
      findings.push(
        `A stops sit at ${rawA.avgStopAtr}x ATR against C at ${rawC.avgStopAtr}x, so A has ${Math.round((1 - rawA.avgStopAtr / rawC.avgStopAtr) * 100)}% less room before noise takes it out. Part of the gap is stop width, not setup quality.`,
      );
    }
    if (rawA.avgPlannedR != null && rawC.avgPlannedR != null && Math.abs(rawA.avgPlannedR - rawC.avgPlannedR) > 0.15) {
      findings.push(
        `Planned R differs too: A ${rawA.avgPlannedR} against C ${rawC.avgPlannedR}. The two grades were not offered the same bet.`,
      );
    }
    if (rawA.avgMfeR != null && rawC.avgMfeR != null) {
      findings.push(
        rawA.avgMfeR >= rawC.avgMfeR
          ? `A trades went further in our favour before resolving (${rawA.avgMfeR}R best excursion against C's ${rawC.avgMfeR}R), so A is reading direction well and losing on exit geometry rather than on direction.`
          : `A trades did not even travel as far in our favour as C's (${rawA.avgMfeR}R against ${rawC.avgMfeR}R), so this is a direction problem, not an exit problem.`,
      );
    }
    if (rawA.avgMaeR != null && rawC.avgMaeR != null && rawA.avgMaeR > rawC.avgMaeR) {
      findings.push(`A trades also went further against us first (${rawA.avgMaeR}R against ${rawC.avgMaeR}R), which is what a stop that is too tight for the entry looks like.`);
    }
    const mixDiff = rawA.classMix[0]?.klass !== rawC.classMix[0]?.klass;
    if (mixDiff) {
      findings.push(
        `Different populations: A is mostly ${rawA.classMix[0]?.klass} while C is mostly ${rawC.classMix[0]?.klass}, so the raw averages are partly an instrument comparison.`,
      );
    }
  }

  const adjA = mixAdjusted.find((g) => g.grade === "A");
  const adjC = mixAdjusted.find((g) => g.grade === "C");
  const comparableClasses = withinClass.filter((c) => c.comparable);
  const invertedClasses = comparableClasses.filter((c) => (c.aMinusC ?? 0) < 0);

  let verdict: string;
  if (adjA?.adjustedNetExpectancyR != null && adjC?.adjustedNetExpectancyR != null) {
    const gap = r2(adjA.adjustedNetExpectancyR - adjC.adjustedNetExpectancyR);
    findings.push(
      `On one common instrument mix: A ${adjA.adjustedNetExpectancyR}R net against C ${adjC.adjustedNetExpectancyR}R, covering ${Math.round(adjA.coverage * 100)}% and ${Math.round(adjC.coverage * 100)}% of the mix.`,
    );
    verdict = gap < 0
      ? `The inversion survives the mix adjustment (A is ${Math.abs(gap)}R per trade behind C on the same instruments), so it is the grading, not the population. Fix the scoring, not the measurement.`
      : `The inversion does not survive the mix adjustment: on the same instruments A is ${gap}R ahead of C. The raw inversion was instrument mix, and A's tighter stop, not evidence that confidence is backwards.`;
  } else if (comparableClasses.length === 0) {
    verdict = `No instrument class has ${MIN_COMPARE} resolved trades in both A and C yet, so the inversion cannot be attributed either way. Treat it as unmeasured, not as a finding.`;
  } else {
    verdict = `${invertedClasses.length} of ${comparableClasses.length} comparable instrument classes are inverted. Not enough per-class coverage to adjust the mix, so this is directional only.`;
  }

  return { sampled: rows.length, skipped, raw, withinClass, mixAdjusted, findings, verdict };
}
