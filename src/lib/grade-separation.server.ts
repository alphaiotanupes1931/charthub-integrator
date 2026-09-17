/**
 * Does the label rank the trade?
 *
 * The stop-width test answered its question: widening the A stop with reward held
 * constant made A slightly worse, so stop distance is not what is wrong. The open
 * question is upstream of the plan - whether the grade carries any ordering
 * information about the outcome at all.
 *
 * This module answers three separate questions, and keeps them separate on
 * purpose because they have different fixes:
 *
 *   1. Does the PUBLISHED grade rank outcomes? Rank correlation between grade
 *      (A+ best .. C- worst) and net R. Near zero means the label is noise, not
 *      that it is inverted.
 *   2. Does CONFIDENCE rank outcomes? Confidence is a finer number than the grade
 *      and comes off the same evidence count. If confidence ranks but the grade
 *      does not, the thresholds are wrong. If neither ranks, the evidence count is
 *      wrong.
 *   3. Do the six FAMILY scores rank outcomes, one at a time? This is the one that
 *      says what to fix. A family whose high half and low half have the same net R
 *      is not evidence, whatever weight the rulebook assigns it. This is the
 *      measurement that has to replace the assumed weights in program.ts.
 *
 * Everything here is read-only and reports sample size next to every number. At
 * current volumes most cells are underpowered and the report says so rather than
 * rounding an opinion into a verdict.
 */

export type SepRow = {
  id: string;
  symbol: string;
  grade: string;
  confidence: number | null;
  /** Net of costs where available, gross otherwise. */
  r: number | null;
  status: string;
};

export type ProgramRow = {
  symbol: string;
  timeframe: string;
  bias: string;
  createdAt: string;
  composite: number | null;
  percentile: number | null;
  families: Record<string, { score?: number; above?: boolean }> | null;
};

export type RankResult = {
  /** Spearman rank correlation between the label and net R. */
  rho: number | null;
  n: number;
  /** Rough two-sided significance gate: |rho| > 2/sqrt(n) is worth reading. */
  meaningful: boolean;
};

export type Bucket = { label: string; n: number; hitRate: number; avgR: number };

export type FamilyCheck = {
  family: string;
  n: number;
  /** Net R for setups scoring in the top half of this family. */
  highR: number;
  lowR: number;
  gap: number;
  rho: number | null;
  verdict: "predictive" | "no signal" | "inverted" | "too few";
};

export type SeparationReport = {
  resolved: number;
  gradeRank: RankResult;
  gradeBuckets: Bucket[];
  confidenceRank: RankResult;
  confidenceBuckets: Bucket[];
  programRank: RankResult | null;
  programCoverage: number;
  families: FamilyCheck[];
  diagnosis: string[];
  nextSteps: string[];
};

const GRADE_ORDER = ["C-", "C", "C+", "B-", "B", "B+", "A-", "A", "A+"];
/** Worst to best, so a positive correlation means the label works. */
function gradeRankOf(g: string): number | null {
  const i = GRADE_ORDER.indexOf(g.trim().toUpperCase());
  return i < 0 ? null : i;
}

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

function round(n: number, dp = 2): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

/** Average ranks so ties (many equal grades) do not distort the correlation. */
function ranks(xs: number[]): number[] {
  const order = xs.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const out = new Array<number>(xs.length);
  let i = 0;
  while (i < order.length) {
    let j = i;
    while (j + 1 < order.length && order[j + 1]!.v === order[i]!.v) j++;
    const r = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) out[order[k]!.i] = r;
    i = j + 1;
  }
  return out;
}

export function spearman(xs: number[], ys: number[]): RankResult {
  const n = Math.min(xs.length, ys.length);
  if (n < 10) return { rho: null, n, meaningful: false };
  const rx = ranks(xs.slice(0, n));
  const ry = ranks(ys.slice(0, n));
  const mx = mean(rx);
  const my = mean(ry);
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    const a = rx[i]! - mx;
    const b = ry[i]! - my;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  if (!dx || !dy) return { rho: null, n, meaningful: false };
  const rho = round(num / Math.sqrt(dx * dy), 3);
  return { rho, n, meaningful: Math.abs(rho) > 2 / Math.sqrt(n) };
}

function bucketise(rows: Array<{ key: string; r: number }>): Bucket[] {
  const by = new Map<string, number[]>();
  for (const row of rows) {
    const list = by.get(row.key) ?? [];
    list.push(row.r);
    by.set(row.key, list);
  }
  return [...by.entries()]
    .map(([label, rs]) => ({
      label,
      n: rs.length,
      hitRate: round((rs.filter((r) => r > 0).length / rs.length) * 100, 1),
      avgR: round(mean(rs)),
    }))
    .sort((a, b) => b.avgR - a.avgR);
}

/** Match a shadow program score to a filed signal: same symbol, side and minute. */
function joinProgram(
  filed: Array<SepRow & { symbol: string; timeframe: string; bias: string; createdAt: string }>,
  program: ProgramRow[],
): Array<{ row: SepRow; prog: ProgramRow }> {
  const out: Array<{ row: SepRow; prog: ProgramRow }> = [];
  const WINDOW_MS = 3 * 60 * 1000;
  for (const f of filed) {
    const t = Date.parse(f.createdAt);
    let best: ProgramRow | null = null;
    let bestGap = Infinity;
    for (const p of program) {
      if (p.symbol !== f.symbol || p.timeframe !== f.timeframe) continue;
      if (p.bias.toLowerCase() !== f.bias.toLowerCase()) continue;
      const gap = Math.abs(Date.parse(p.createdAt) - t);
      if (gap <= WINDOW_MS && gap < bestGap) {
        best = p;
        bestGap = gap;
      }
    }
    if (best) out.push({ row: f, prog: best });
  }
  return out;
}

const MIN_FAMILY = 40;

export function analyzeGradeSeparation(
  filed: Array<SepRow & { symbol: string; timeframe: string; bias: string; createdAt: string }>,
  program: ProgramRow[],
): SeparationReport {
  const scored = filed.filter(
    (r) => (r.status === "target" || r.status === "stop" || r.status === "expired") && r.r !== null,
  );

  // 1. Published grade
  const gradePairs = scored
    .map((r) => ({ rank: gradeRankOf(r.grade), r: r.r as number }))
    .filter((p): p is { rank: number; r: number } => p.rank !== null);
  const gradeRank = spearman(gradePairs.map((p) => p.rank), gradePairs.map((p) => p.r));
  const gradeBuckets = bucketise(scored.map((r) => ({ key: r.grade, r: r.r as number })));

  // 2. Confidence
  const confPairs = scored.filter((r) => r.confidence !== null);
  const confidenceRank = spearman(
    confPairs.map((r) => r.confidence as number),
    confPairs.map((r) => r.r as number),
  );
  const confidenceBuckets = bucketise(
    confPairs.map((r) => {
      const c = r.confidence as number;
      const lo = Math.floor(c / 10) * 10;
      return { key: `${lo}-${lo + 9}`, r: r.r as number };
    }),
  );

  // 3. Shadow program composite and the six families
  const joined = joinProgram(scored, program);
  const programRank = joined.length
    ? spearman(
        joined.map((j) => j.prog.composite ?? 0),
        joined.map((j) => j.row.r as number),
      )
    : null;

  const familyNames = ["regime", "location", "trigger", "participation", "execution", "risk"];
  const families: FamilyCheck[] = familyNames.map((family) => {
    const pts = joined
      .map((j) => ({ s: j.prog.families?.[family]?.score, r: j.row.r as number }))
      .filter((p): p is { s: number; r: number } => typeof p.s === "number");
    if (pts.length < MIN_FAMILY) {
      return { family, n: pts.length, highR: 0, lowR: 0, gap: 0, rho: null, verdict: "too few" };
    }
    const sorted = [...pts].sort((a, b) => a.s - b.s);
    const mid = sorted[Math.floor(sorted.length / 2)]!.s;
    const highR = round(mean(pts.filter((p) => p.s >= mid).map((p) => p.r)));
    const lowR = round(mean(pts.filter((p) => p.s < mid).map((p) => p.r)));
    const rank = spearman(pts.map((p) => p.s), pts.map((p) => p.r));
    const gap = round(highR - lowR);
    const verdict: FamilyCheck["verdict"] =
      !rank.meaningful ? "no signal" : gap > 0 ? "predictive" : "inverted";
    return { family, n: pts.length, highR, lowR, gap, rho: rank.rho, verdict };
  });

  // ---- Read the numbers -------------------------------------------------
  const diagnosis: string[] = [];
  const nextSteps: string[] = [];

  if (scored.length < 100) {
    diagnosis.push(`Only ${scored.length} resolved trades. Nothing below is conclusive.`);
  }

  if (gradeRank.rho === null) {
    diagnosis.push("Not enough graded trades to test whether the grade ranks outcomes.");
  } else if (!gradeRank.meaningful) {
    diagnosis.push(
      `The published grade does not rank outcomes (rho ${gradeRank.rho} on ${gradeRank.n} trades). The label is closer to noise than to backwards - an inverted label would still be information.`,
    );
    nextSteps.push(
      "Treat the grade as unvalidated in the product: keep publishing it, stop implying it predicts outcome, and never attach a probability to it.",
    );
  } else if (gradeRank.rho < 0) {
    diagnosis.push(`The grade ranks outcomes backwards (rho ${gradeRank.rho} on ${gradeRank.n} trades).`);
  } else {
    diagnosis.push(`The grade ranks outcomes in the right direction (rho ${gradeRank.rho} on ${gradeRank.n} trades).`);
  }

  if (confidenceRank.rho !== null && gradeRank.rho !== null) {
    if (confidenceRank.meaningful && !gradeRank.meaningful) {
      diagnosis.push(
        `Confidence does rank outcomes (rho ${confidenceRank.rho}) while the grade does not. That points at the grade thresholds, not the evidence.`,
      );
      nextSteps.push("Re-cut the grade thresholds from the confidence-to-outcome curve instead of the current fixed cutoffs.");
    } else if (!confidenceRank.meaningful) {
      diagnosis.push(
        `Confidence does not rank outcomes either (rho ${confidenceRank.rho}). The problem is the evidence count feeding both, not the cutoffs above it.`,
      );
      nextSteps.push("Replace the unweighted evidence count with weights fitted to resolved outcomes - the six-family scores below are the inputs.");
    }
  }

  const usable = families.filter((f) => f.verdict !== "too few");
  if (!usable.length) {
    diagnosis.push(
      `The six family scores cannot be tested yet: ${joined.length} resolved trades carry a shadow score, and each family needs ${MIN_FAMILY}. This is the data that has to exist before any weight is anything but an assumption.`,
    );
    nextSteps.push("Let the shadow scorer accumulate. It records on every directional scan, so this fills from normal use rather than a backfill.");
  } else {
    const predictive = usable.filter((f) => f.verdict === "predictive");
    const dead = usable.filter((f) => f.verdict === "no signal");
    const inverted = usable.filter((f) => f.verdict === "inverted");
    if (predictive.length) diagnosis.push(`Carries signal: ${predictive.map((f) => `${f.family} (+${f.gap}R)`).join(", ")}.`);
    if (dead.length) diagnosis.push(`No measurable signal: ${dead.map((f) => f.family).join(", ")}.`);
    if (inverted.length) diagnosis.push(`Scores backwards: ${inverted.map((f) => `${f.family} (${f.gap}R)`).join(", ")}.`);
    if (dead.length || inverted.length) {
      nextSteps.push(
        `Cut the weight on ${[...dead, ...inverted].map((f) => f.family).join(", ")} before touching anything else - those are the checks currently inflating grades without earning it.`,
      );
    }
  }

  if (programRank && programRank.rho !== null && gradeRank.rho !== null) {
    diagnosis.push(
      `Shadow program composite ranks outcomes at rho ${programRank.rho} on ${programRank.n} trades, against ${gradeRank.rho} for the published grade.`,
    );
  }

  nextSteps.push("Do not re-tune the grade on this window alone - it is in-sample. Hold the most recent third back and re-check any change there.");

  return {
    resolved: scored.length,
    gradeRank,
    gradeBuckets,
    confidenceRank,
    confidenceBuckets,
    programRank,
    programCoverage: joined.length,
    families,
    diagnosis,
    nextSteps,
  };
}
