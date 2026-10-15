// Track-record check: before a scan is published, look at how past logged
// scans for the same market, timeframe and direction actually turned out.
// Below MIN_SAMPLE it is shown only. At MIN_SAMPLE or more settled results it
// may move the grade one letter (evidence tier B: adjust grade and size, never
// block). Unfilled or expired calls count as 0R and stay in the sample.

export const TRACK_RECORD_MIN_SAMPLE = 30;
export const TRACK_RECORD_LOOKBACK_DAYS = 90;
export const TRACK_RECORD_DOWNGRADE_AVG_R = -0.2;
export const TRACK_RECORD_UPGRADE_AVG_R = 0.3;

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
  const base = { n, wins, losses, avgR, newGrade: grade, halfSize: false };
  if (n === 0) return { ...base, action: "none", text: "" };
  const summary = `Past ${opts.label} scans: ${wins} won, ${losses} lost of ${n} settled, ${avgR}R average.`;
  if (n < TRACK_RECORD_MIN_SAMPLE) {
    return { ...base, action: "show", text: `${summary} Not enough results yet (${TRACK_RECORD_MIN_SAMPLE} needed) to change the grade.` };
  }
  const idx = LADDER.indexOf(grade as (typeof LADDER)[number]);
  if (avgR <= TRACK_RECORD_DOWNGRADE_AVG_R && idx > 0) {
    return { ...base, action: "down", newGrade: LADDER[idx - 1], halfSize: true, text: `${summary} This setup has lost money, so the grade drops one letter. Use half size.` };
  }
  if (avgR <= TRACK_RECORD_DOWNGRADE_AVG_R) {
    return { ...base, action: "show", halfSize: true, text: `${summary} This setup has lost money. Use half size.` };
  }
  if (avgR >= TRACK_RECORD_UPGRADE_AVG_R && idx >= 0 && idx < LADDER.length - 1 && !opts.otherCapBinding) {
    return { ...base, action: "up", newGrade: LADDER[idx + 1], text: `${summary} This setup has made money, so the grade rises one letter.` };
  }
  return { ...base, action: "show", text: summary };
}
