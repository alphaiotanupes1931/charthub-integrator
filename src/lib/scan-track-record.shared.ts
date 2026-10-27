// Track-record check: before a scan is published, look at how past logged
// scans for the same market, timeframe and direction actually turned out.
// Evidence tier B: may adjust grade and size, never block. Unfilled or expired
// calls count as 0R and stay in the sample.
//
// Learning ladder (so verified winners teach the grader faster):
// - Under EARLY_MIN_SAMPLE settled: shown only.
// - EARLY_MIN_SAMPLE+ settled with a strong record (avg R and win rate both
//   high): may lift the grade one letter when no other cap binds.
// - MIN_SAMPLE+ settled: normal one-letter up/down moves.
// - MIN_SAMPLE+ with a proven record (avg R >= PROVEN_AVG_R): may lift one
//   letter even past a binding cap, because measured outcomes outrank opinion.

export const TRACK_RECORD_MIN_SAMPLE = 30;
export const TRACK_RECORD_EARLY_MIN_SAMPLE = 15;
export const TRACK_RECORD_LOOKBACK_DAYS = 90;
export const TRACK_RECORD_DOWNGRADE_AVG_R = -0.2;
export const TRACK_RECORD_UPGRADE_AVG_R = 0.3;
export const TRACK_RECORD_EARLY_AVG_R = 0.4;
export const TRACK_RECORD_EARLY_WIN_RATE = 0.6;
export const TRACK_RECORD_PROVEN_AVG_R = 0.5;

export type TrackRow = { status: string; realized_r: number | null };

export type TrackRecord = {
  n: number;
  wins: number;
  losses: number;
  avgR: number;
  /** "show" = context only; "down"/"up" = grade moved one letter. */
  action: "show" | "down" | "up" | "none";
  newGrade: string;
  halfSize: boolean;
  text: string;
};

const LADDER = ["C", "B", "A"] as const;

export function evaluateTrackRecord(
  rows: TrackRow[],
  grade: string,
  opts: { otherCapBinding: boolean; label: string },
): TrackRecord {
  const settled = rows.filter((r) => r.status !== "open" && r.status !== "no_trade");
  const n = settled.length;
  const rs = settled.map((r) => (typeof r.realized_r === "number" && Number.isFinite(r.realized_r) ? r.realized_r : 0));
  const wins = rs.filter((r) => r > 0).length;
  const losses = rs.filter((r) => r < 0).length;
  const avgR = n ? Math.round((rs.reduce((a, b) => a + b, 0) / n) * 100) / 100 : 0;
  const winRate = n ? wins / n : 0;
  const base = { n, wins, losses, avgR, newGrade: grade, halfSize: false };
  if (n === 0) return { ...base, action: "none", text: "" };
  const summary = `Past ${opts.label} scans: ${wins} won, ${losses} lost of ${n} settled, ${avgR}R average.`;
  const idx = LADDER.indexOf(grade as (typeof LADDER)[number]);
  const canRise = idx >= 0 && idx < LADDER.length - 1;
  const up = (why: string): TrackRecord => ({ ...base, action: "up", newGrade: LADDER[idx + 1], text: `${summary} ${why}` });

  if (n < TRACK_RECORD_EARLY_MIN_SAMPLE) {
    return { ...base, action: "show", text: `${summary} Not enough results yet (${TRACK_RECORD_EARLY_MIN_SAMPLE} needed) to change the grade.` };
  }
  if (n < TRACK_RECORD_MIN_SAMPLE) {
    if (canRise && !opts.otherCapBinding && avgR >= TRACK_RECORD_EARLY_AVG_R && winRate >= TRACK_RECORD_EARLY_WIN_RATE) {
      return up("This setup keeps hitting target, so the grade rises one letter early.");
    }
    return { ...base, action: "show", text: `${summary} ${TRACK_RECORD_MIN_SAMPLE} results needed for a full grade review.` };
  }
  if (avgR <= TRACK_RECORD_DOWNGRADE_AVG_R && idx > 0) {
    return { ...base, action: "down", newGrade: LADDER[idx - 1], halfSize: true, text: `${summary} This setup has lost money, so the grade drops one letter. Use half size.` };
  }
  if (avgR <= TRACK_RECORD_DOWNGRADE_AVG_R) {
    return { ...base, action: "show", halfSize: true, text: `${summary} This setup has lost money. Use half size.` };
  }
  if (canRise && avgR >= TRACK_RECORD_PROVEN_AVG_R) {
    return up("This setup has a proven winning record, so the grade rises one letter.");
  }
  if (canRise && avgR >= TRACK_RECORD_UPGRADE_AVG_R && !opts.otherCapBinding) {
    return up("This setup has made money, so the grade rises one letter.");
  }
  return { ...base, action: "show", text: summary };
}
