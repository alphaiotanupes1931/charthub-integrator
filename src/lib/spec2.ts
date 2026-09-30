// Spec 2 addendum rules. Pure.
//
// 1. Grade caps compose by taking the single lowest applicable cap. Caps never
//    stack, and the rule that set the final grade is recorded.
// 2. Counter-bias reversals (Fix 4) are internal only: logged and armed, never
//    published as a tradeable signal, until the counter-bias split shows
//    positive average R over at least 30 resolved reversals.
// 3. OANDA "volume" is tick count. It is labelled that way in user-facing text,
//    and the climax baseline is session-matched so it measures effort, not
//    session liquidity.
// 4. Wyckoff phase letters A-E are stages inside one trading range. The market
//    cycle (accumulation, markup, distribution, markdown) is a different thing.

const RANK: Record<string, number> = { "A+": 4, A: 3, B: 2, C: 1 };
const LETTER = ["", "C", "B", "A", "A+"];

export type GradeCap = { rule: string; maxGrade?: "A+" | "A" | "B" | "C"; downgrade?: number };

/** Lowest single cap wins. Returns the final grade and which rule set it (null if none bit). */
export function composeGradeCaps(grade: string, caps: GradeCap[]): { grade: string; setBy: string | null } {
  const base = RANK[grade];
  if (base === undefined) return { grade, setBy: null };
  let best = base;
  let setBy: string | null = null;
  for (const c of caps) {
    let v = base;
    if (c.maxGrade) v = Math.min(v, RANK[c.maxGrade]);
    if (c.downgrade) v = Math.max(1, base - c.downgrade);
    if (v < best) {
      best = v;
      setBy = c.rule;
    }
  }
  return { grade: LETTER[best], setBy };
}

export const COUNTER_BIAS_MIN_RESOLVED = 30;

export function counterBiasPublishable(split: { resolved: number; avgR: number | null }): boolean {
  return split.resolved >= COUNTER_BIAS_MIN_RESOLVED && split.avgR != null && split.avgR > 0;
}

/** Tick volume label for any user-facing text. */
export const TICK_VOLUME_LABEL = "tick volume (price updates, not traded volume)";

/**
 * Climax check against a session-matched baseline: compares the bar's tick
 * count with the average of the last `n` bars from the same session.
 */
export function tickClimax(
  bars: Array<{ volume?: number; session: string }>,
  index: number,
  opts: { n?: number; mult?: number } = {},
): { climax: boolean; ratio: number | null; baselineBars: number } {
  const n = opts.n ?? 20;
  const mult = opts.mult ?? 2;
  const bar = bars[index];
  if (!bar || typeof bar.volume !== "number") return { climax: false, ratio: null, baselineBars: 0 };
  const same: number[] = [];
  for (let i = index - 1; i >= 0 && same.length < n; i--) {
    const b = bars[i];
    if (b.session === bar.session && typeof b.volume === "number") same.push(b.volume);
  }
  if (same.length < n) return { climax: false, ratio: null, baselineBars: same.length };
  const avg = same.reduce((a, b) => a + b, 0) / same.length;
  if (avg <= 0) return { climax: false, ratio: null, baselineBars: same.length };
  const ratio = Math.round((bar.volume / avg) * 100) / 100;
  return { climax: ratio > mult, ratio, baselineBars: same.length };
}

export const WYCKOFF_PHASES = {
  A: "Stopping action (SC/BC, AR, ST)",
  B: "Building cause inside the range",
  C: "The test: spring or UTAD",
  D: "Move to the range boundary (SOS/SOW, LPS/LPSY)",
  E: "Leaving the range",
} as const;
