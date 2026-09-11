// Shared types for the "engine tested on past price" track record.
//
// Live post-fix scans take real time to resolve, so the current engine is also
// replayed over years of historical bars per instrument. Those results are a
// measured track record of the same deterministic rules, kept clearly separate
// from live scan outcomes.

export type ReplayRow = {
  symbol: string;
  timeframe: string;
  lookback: string;
  bars: number;
  from: string | null;
  to: string | null;
  trades: number;
  wins: number;
  winRate: number;
  expectancyR: number;
  netR: number;
  profitFactor: number | null;
  maxDdPct: number;
  aTrades: number;
  aWinRate: number;
  aExpectancyR: number;
  source: string;
  updatedAt: string;
};

/** Whether one instrument's replay result is strong enough to quote anywhere. */
export type ReplayStatus = "validated" | "needs-calibration" | "insufficient-data";

export const MIN_VALIDATION_TRADES = 30;

export function replayStatus(row: ReplayRow): ReplayStatus {
  if (row.trades < MIN_VALIDATION_TRADES) return "insufficient-data";
  return row.expectancyR > 0 ? "validated" : "needs-calibration";
}

export const REPLAY_STATUS_LABEL: Record<ReplayStatus, string> = {
  validated: "Validated",
  "needs-calibration": "Needs calibration",
  "insufficient-data": "Not enough data",
};

export type ReplayTotals = {
  instruments: number;
  trades: number;
  winRate: number | null;
  expectancyR: number | null;
  aTrades: number;
  aWinRate: number | null;
  updatedAt: string | null;
  validatedInstruments: number;
  needsCalibration: string[];
};

const round = (n: number, d = 1) => Math.round(n * 10 ** d) / 10 ** d;

/** Trade-weighted roll-up across every replayed instrument. */
export function replayTotals(rows: ReplayRow[]): ReplayTotals {
  const trades = rows.reduce((s, r) => s + r.trades, 0);
  const wins = rows.reduce((s, r) => s + r.wins, 0);
  const netR = rows.reduce((s, r) => s + r.netR, 0);
  const aTrades = rows.reduce((s, r) => s + r.aTrades, 0);
  const aWins = rows.reduce((s, r) => s + Math.round((r.aWinRate / 100) * r.aTrades), 0);
  const stamps = rows.map((r) => Date.parse(r.updatedAt)).filter((t) => Number.isFinite(t));
  return {
    instruments: rows.filter((r) => r.trades > 0).length,
    trades,
    winRate: trades ? round((wins / trades) * 100) : null,
    expectancyR: trades ? round(netR / trades, 2) : null,
    aTrades,
    aWinRate: aTrades ? round((aWins / aTrades) * 100) : null,
    updatedAt: stamps.length ? new Date(Math.max(...stamps)).toISOString() : null,
    validatedInstruments: rows.filter((r) => replayStatus(r) === "validated").length,
    needsCalibration: rows.filter((r) => replayStatus(r) === "needs-calibration").map((r) => r.symbol),
  };
}
