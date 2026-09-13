// Measured grade mix and per-grade accuracy for the replay track record.
//
// The grading rules were tightened by hand, so this module turns the stored
// replay results into numbers: what share of setups land on each grade and how
// each grade actually performed. Calibration decisions read off these numbers
// instead of impressions from a handful of trades.

export type GradeKey = "A+" | "A" | "B" | "C";

export const GRADE_KEYS: GradeKey[] = ["A+", "A", "B", "C"];

export type GradeMixEntry = {
  grade: string;
  trades: number;
  wins: number;
  winRate: number;
  expectancyR: number;
  netR: number;
};

export type GradeStat = {
  grade: GradeKey;
  trades: number;
  wins: number;
  /** Percentage of all replayed setups that landed on this grade. */
  sharePct: number;
  winRate: number | null;
  expectancyR: number | null;
  netR: number;
};

export type CalibrationIssue = {
  code: "thin-sample" | "inverted" | "c-heavy" | "a-starved" | "a-negative";
  severity: "warn" | "alert";
  message: string;
};

export type GradeReport = {
  totalTrades: number;
  grades: GradeStat[];
  /** A and A+ combined, the grade the product is marketed on. */
  aTrades: number;
  aWinRate: number | null;
  aExpectancyR: number | null;
  bWinRate: number | null;
  issues: CalibrationIssue[];
  verdict: "calibrated" | "needs-attention" | "not-enough-data";
};

/** Minimum trades per grade before its win rate means anything. */
export const MIN_GRADE_TRADES = 30;

const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;

export function parseGradeMix(raw: unknown): GradeMixEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((e): e is Record<string, unknown> => !!e && typeof e === "object")
    .map((e) => ({
      grade: String(e.grade ?? e.key ?? ""),
      trades: Number(e.trades ?? 0) || 0,
      wins: Number(e.wins ?? 0) || 0,
      winRate: Number(e.winRate ?? e.win_rate ?? 0) || 0,
      expectancyR: Number(e.expectancyR ?? e.expectancy_r ?? 0) || 0,
      netR: Number(e.netR ?? e.net_r ?? 0) || 0,
    }))
    .filter((e) => GRADE_KEYS.includes(e.grade as GradeKey));
}

/** Roll a set of per-instrument grade mixes into one trade-weighted report. */
export function gradeReport(mixes: GradeMixEntry[][]): GradeReport {
  const flat = mixes.flat();
  const total = flat.reduce((s, e) => s + e.trades, 0);

  const grades: GradeStat[] = GRADE_KEYS.map((grade) => {
    const rows = flat.filter((e) => e.grade === grade);
    const trades = rows.reduce((s, e) => s + e.trades, 0);
    const wins = rows.reduce((s, e) => s + e.wins, 0);
    const netR = rows.reduce((s, e) => s + e.netR, 0);
    return {
      grade,
      trades,
      wins,
      sharePct: total ? r1((trades / total) * 100) : 0,
      winRate: trades ? r1((wins / trades) * 100) : null,
      expectancyR: trades ? r2(netR / trades) : null,
      netR: r2(netR),
    };
  });

  const byKey = (k: GradeKey) => grades.find((g) => g.grade === k)!;
  const aRows = [byKey("A+"), byKey("A")];
  const aTrades = aRows.reduce((s, g) => s + g.trades, 0);
  const aWins = aRows.reduce((s, g) => s + g.wins, 0);
  const aNetR = aRows.reduce((s, g) => s + g.netR, 0);
  const aWinRate = aTrades ? r1((aWins / aTrades) * 100) : null;
  const aExpectancyR = aTrades ? r2(aNetR / aTrades) : null;
  const b = byKey("B");
  const c = byKey("C");

  const issues: CalibrationIssue[] = [];

  if (total < MIN_GRADE_TRADES || aTrades < MIN_GRADE_TRADES) {
    issues.push({
      code: "thin-sample",
      severity: "warn",
      message: `Only ${aTrades} top-grade setups measured. Need ${MIN_GRADE_TRADES} before the A win rate can be trusted.`,
    });
  }

  if (aWinRate != null && b.winRate != null && aTrades >= MIN_GRADE_TRADES && b.trades >= MIN_GRADE_TRADES) {
    if (b.winRate > aWinRate + 2) {
      issues.push({
        code: "inverted",
        severity: "alert",
        message: `B setups win ${b.winRate}% versus ${aWinRate}% for A. The grade ladder is upside down — the A filter is rejecting the wrong setups.`,
      });
    }
  }

  if (total >= MIN_GRADE_TRADES && c.sharePct >= 60) {
    issues.push({
      code: "c-heavy",
      severity: "alert",
      message: `${c.sharePct}% of setups grade C. The rules are too strict, so almost nothing reaches a tradable grade.`,
    });
  }

  if (total >= MIN_GRADE_TRADES && aTrades / total < 0.08) {
    issues.push({
      code: "a-starved",
      severity: "warn",
      message: `Only ${total ? r1((aTrades / total) * 100) : 0}% of setups reach A. Expect very few sniper calls at this setting.`,
    });
  }

  if (aExpectancyR != null && aTrades >= MIN_GRADE_TRADES && aExpectancyR <= 0) {
    issues.push({
      code: "a-negative",
      severity: "alert",
      message: `A setups average ${aExpectancyR}R. The top grade loses money over this sample.`,
    });
  }

  const verdict: GradeReport["verdict"] =
    total === 0 || aTrades < MIN_GRADE_TRADES
      ? "not-enough-data"
      : issues.some((i) => i.severity === "alert")
        ? "needs-attention"
        : "calibrated";

  return { totalTrades: total, grades, aTrades, aWinRate, aExpectancyR, bWinRate: b.winRate, issues, verdict };
}

export const VERDICT_LABEL: Record<GradeReport["verdict"], string> = {
  calibrated: "Grades line up",
  "needs-attention": "Needs calibration",
  "not-enough-data": "Not enough data yet",
};
