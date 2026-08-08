// Feedback loop: the coach's own measured hit rates, turned into grading
// pressure. Reads resolved rows from signal_scores and produces both a prompt
// block and a hard grade cap, so a setup on an instrument or playbook that has
// been losing cannot keep printing high grades.

export type ScoreEvidence = {
  /** Prompt block describing measured performance for this scan's context. */
  prompt: string;
  /** Highest grade this context has earned, or null when there is no basis to cap. */
  cap: "A+" | "A" | "B" | "C" | null;
  /** Plain sentence explaining the cap, appended to the plan's reasoning. */
  reason: string | null;
};

const EMPTY: ScoreEvidence = { prompt: "", cap: null, reason: null };

type Stat = { total: number; targets: number; stops: number; rSum: number };

function pct(part: number, whole: number): number {
  return whole ? Math.round((part / whole) * 1000) / 10 : 0;
}

function statOf(rows: Array<{ status: string; realized_r: number | string | null }>): Stat {
  let targets = 0;
  let stops = 0;
  let rSum = 0;
  for (const r of rows) {
    if (r.status === "target") targets += 1;
    else if (r.status === "stop") stops += 1;
    rSum += r.realized_r === null ? 0 : Number(r.realized_r);
  }
  return { total: rows.length, targets, stops, rSum };
}

function avgR(s: Stat): number {
  return s.total ? Math.round((s.rSum / s.total) * 100) / 100 : 0;
}

/**
 * Build the scoreboard feedback for one scan context.
 *
 * Caps are deliberately conservative: we only downgrade once there are enough
 * resolved signals to mean something, and the worst applicable cap wins.
 */
export async function scoreEvidenceFor(
  supabase: {
    from: (t: string) => {
      select: (c: string) => {
        eq: (
          c: string,
          v: unknown,
        ) => {
          eq: (
            c: string,
            v: unknown,
          ) => {
            neq: (
              c: string,
              v: unknown,
            ) => {
              order: (c: string, o: { ascending: boolean }) => {
                limit: (n: number) => Promise<{ data: unknown }>;
              };
            };
          };
        };
      };
    };
  },
  userId: string,
  symbol: string,
  strategyId?: string,
): Promise<ScoreEvidence> {
  type Row = {
    symbol: string;
    timeframe: string;
    grade: string;
    bias: string;
    status: string;
    realized_r: number | string | null;
    strategy_id: string | null;
  };

  let rows: Row[] = [];
  try {
    const res = await supabase
      .from("signal_scores")
      .select("symbol, timeframe, grade, bias, status, realized_r, strategy_id")
      .eq("user_id", userId)
      .eq("symbol", symbol)
      .neq("status", "open")
      .order("created_at", { ascending: false })
      .limit(120);
    rows = ((res.data ?? []) as Row[]).filter(Boolean);
  } catch {
    return EMPTY;
  }
  if (rows.length === 0) return EMPTY;

  const all = statOf(rows);
  const decided = all.targets + all.stops;
  const lines: string[] = [
    `Measured record of past scans on ${symbol}: ${all.total} resolved signals, ${all.targets} reached target, ${all.stops} stopped out, ${avgR(all)}R average.`,
  ];

  // Grade honesty: are the coach's own A grades actually better than its B grades?
  const high = statOf(rows.filter((r) => r.grade === "A" || r.grade === "A+"));
  const mid = statOf(rows.filter((r) => r.grade === "B"));
  if (high.targets + high.stops >= 6) {
    lines.push(
      `Past A/A+ calls on ${symbol}: ${pct(high.targets, high.targets + high.stops)}% hit rate, ${avgR(high)}R average over ${high.total} signals.`,
    );
  }
  if (mid.targets + mid.stops >= 6) {
    lines.push(
      `Past B calls on ${symbol}: ${pct(mid.targets, mid.targets + mid.stops)}% hit rate, ${avgR(mid)}R average over ${mid.total} signals.`,
    );
  }

  let strategyStat: Stat | null = null;
  if (strategyId) {
    strategyStat = statOf(rows.filter((r) => r.strategy_id === strategyId));
    if (strategyStat.total >= 5) {
      lines.push(
        `This playbook on ${symbol}: ${pct(strategyStat.targets, Math.max(1, strategyStat.targets + strategyStat.stops))}% hit rate, ${avgR(strategyStat)}R average over ${strategyStat.total} resolved signals.`,
      );
    } else {
      strategyStat = null;
    }
  }

  // Hard caps. Worst applicable cap wins.
  let cap: ScoreEvidence["cap"] = null;
  let reason: string | null = null;
  const setCap = (next: NonNullable<ScoreEvidence["cap"]>, why: string) => {
    const order = ["C", "B", "A", "A+"];
    if (cap === null || order.indexOf(next) < order.indexOf(cap)) {
      cap = next;
      reason = why;
    }
  };

  if (decided >= 10 && avgR(all) < -0.25) {
    setCap(
      "C",
      `Capped at C: scans on ${symbol} have lost money over the last ${all.total} resolved signals (${pct(all.targets, decided)}% hit rate, ${avgR(all)}R average).`,
    );
  } else if (decided >= 8 && pct(all.targets, decided) < 40) {
    setCap(
      "B",
      `Capped at B: only ${pct(all.targets, decided)}% of the last ${decided} resolved signals on ${symbol} reached target.`,
    );
  }

  if (high.targets + high.stops >= 8 && pct(high.targets, high.targets + high.stops) < 45) {
    setCap(
      "B",
      `Capped at B: past A grade calls on ${symbol} have only hit ${pct(high.targets, high.targets + high.stops)}% of the time, so a high grade is not earned here yet.`,
    );
  }

  if (strategyStat && strategyStat.total >= 8 && avgR(strategyStat) < -0.25) {
    setCap(
      "C",
      `Capped at C: this playbook has a negative measured record on ${symbol} (${avgR(strategyStat)}R average over ${strategyStat.total} resolved signals).`,
    );
  }

  const guidance = cap
    ? `\nSelf-correction: the measured record above is worse than the grades previously given. Do not grade this setup above ${cap}, and say plainly in the invalidation that past scans on this instrument have not paid.`
    : decided >= 10 && avgR(all) > 0.3
      ? `\nSelf-correction: the measured record above is positive, so a high grade is supportable when the structure agrees.`
      : "";

  return {
    prompt: `SCAN TRACK RECORD (measured from resolved past signals, not opinion):\n${lines.join("\n")}${guidance}`,
    cap,
    reason,
  };
}

const GRADE_ORDER = ["NO ENTRY", "C", "B", "A", "A+"];

/** Clamp a grade down to the cap the measured record supports. */
export function applyGradeCap(grade: string, cap: ScoreEvidence["cap"]): string {
  if (!cap) return grade;
  if (grade === "NO ENTRY") return grade;
  const gi = GRADE_ORDER.indexOf(grade);
  const ci = GRADE_ORDER.indexOf(cap);
  if (gi === -1 || ci === -1) return grade;
  return gi > ci ? cap : grade;
}
