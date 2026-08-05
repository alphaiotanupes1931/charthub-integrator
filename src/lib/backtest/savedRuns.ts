import type { BtResult } from "@/lib/backtest/engine";

/**
 * Saved backtest runs live on the device so a trader can reopen a run without
 * paying for the data fetch again. Bars are not stored (too large); reopening a
 * run restores its settings and stats, and re-running fills the replay again.
 */
export type SavedRun = {
  id: string;
  savedAt: string;
  symbol: string;
  timeframe: string;
  lookback: string;
  minGrade: string;
  direction: string;
  riskPct: number;
  rrTarget: number;
  atrStopMult: number;
  maxHoldBars: number;
  sessions: string[];
  result: BtResult;
};

const KEY = "tm_backtest_runs_v1";
const MAX = 25;

export function readSavedRuns(): SavedRun[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    const list = raw ? (JSON.parse(raw) as SavedRun[]) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function write(list: SavedRun[]) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)));
  } catch {
    // storage full or blocked: keep the session going without saving
  }
}

export function saveRun(run: Omit<SavedRun, "id" | "savedAt">): SavedRun[] {
  const entry: SavedRun = {
    ...run,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    savedAt: new Date().toISOString(),
  };
  // One row per settings combination: a re-run replaces the older result.
  const same = (r: SavedRun) =>
    r.symbol === entry.symbol &&
    r.timeframe === entry.timeframe &&
    r.lookback === entry.lookback &&
    r.minGrade === entry.minGrade &&
    r.direction === entry.direction &&
    r.riskPct === entry.riskPct &&
    r.rrTarget === entry.rrTarget &&
    r.atrStopMult === entry.atrStopMult &&
    r.maxHoldBars === entry.maxHoldBars &&
    r.sessions.join(",") === entry.sessions.join(",");
  const next = [entry, ...readSavedRuns().filter((r) => !same(r))];
  write(next);
  return next.slice(0, MAX);
}

export function deleteRun(id: string): SavedRun[] {
  const next = readSavedRuns().filter((r) => r.id !== id);
  write(next);
  return next;
}

export function clearRuns(): SavedRun[] {
  write([]);
  return [];
}
