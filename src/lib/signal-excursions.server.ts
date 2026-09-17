/**
 * Backfill and verification pass over already-resolved signals.
 *
 * Two jobs, one bar walk:
 *
 *  1. BACKFILL the free data. Maximum favourable and adverse excursion need no
 *     new inputs — the bars that decided the trade already say how far it ran in
 *     each direction. MFE is what separates "the stop was too tight" from "the
 *     direction was wrong", and it can be recovered for every historical row that
 *     still has price history behind it.
 *
 *  2. VERIFY the stored verdict. Re-walking the bars and comparing against what
 *     is stored is the automated form of the five-signal spot check: if a stored
 *     "target" replays as a stop, the arithmetic on the page is internally
 *     consistent but disagrees with the market, which is the failure that matters.
 *
 * Stored status and realised R are NEVER silently rewritten here. Disagreements
 * are reported so a human decides. Excursions and costs are written, because
 * those are additive, not corrections.
 *
 * Limit of the method: price history reaches back about a year per instrument, so
 * signals older than the feed window cannot be re-walked. Those are reported as
 * unrecoverable rather than quietly skipped.
 */

import { replayForward, type ReplayBar } from "@/lib/signal-replay";
import { costInR } from "@/lib/trading-costs";

export type StoredSignal = {
  id: string;
  symbol: string;
  timeframe: string;
  bias: string;
  grade: string;
  entry: number;
  stop: number;
  tp1: number;
  status: string;
  realized_r: number | null;
  mfe_r: number | null;
  mae_r: number | null;
  net_r: number | null;
  created_at: string;
  resolved_at: string | null;
};

export type ExcursionUpdate = {
  id: string;
  mae_r: number;
  mfe_r: number;
  bars_to_resolve: number;
  net_r?: number;
  cost_r?: number;
};

export type Mismatch = {
  id: string;
  symbol: string;
  timeframe: string;
  bias: string;
  grade: string;
  storedStatus: string;
  replayStatus: string;
  storedR: number | null;
  replayR: number | null;
  filedAt: string;
  /** ISO time of the bar that decided it on replay, for opening a chart there. */
  replayResolvedAt: string | null;
};

export type SpotCheck = Mismatch & {
  entry: number;
  stop: number;
  tp1: number;
  maeR: number;
  mfeR: number;
  bars: number;
  agrees: boolean;
};

export type ExcursionReport = {
  scanned: number;
  /** Rows whose excursions were recomputed. */
  updated: number;
  /** Rows already carrying an MFE figure. */
  alreadyHad: number;
  /** No usable price history left for that instrument and date. */
  unrecoverable: number;
  /** Not scorable at all: no direction, or entry equal to stop. */
  unscorable: number;
  /** Stored verdict disagrees with the replay. Never auto-corrected. */
  mismatches: Mismatch[];
  /** Five worked examples, chart-checkable, whether or not they agree. */
  spotCheck: SpotCheck[];
  notes: string[];
};

const iso = (unixSeconds: number | null) => (unixSeconds == null ? null : new Date(unixSeconds * 1000).toISOString());

/**
 * Pure core: given stored rows and the bars for each symbol/timeframe pair,
 * decide what to write and what disagrees. Kept free of database access so it can
 * be tested against fabricated bars.
 */
export function computeExcursions(
  rows: StoredSignal[],
  barsFor: (symbol: string, timeframe: string) => ReplayBar[] | null,
): { updates: ExcursionUpdate[]; report: ExcursionReport } {
  const updates: ExcursionUpdate[] = [];
  const mismatches: Mismatch[] = [];
  const spotCheck: SpotCheck[] = [];
  let alreadyHad = 0;
  let unrecoverable = 0;
  let unscorable = 0;

  for (const row of rows) {
    const bars = barsFor(row.symbol, row.timeframe);
    if (!bars || !bars.length) {
      unrecoverable += 1;
      continue;
    }
    const verdict = replayForward(row, bars);
    if (!verdict) {
      unscorable += 1;
      continue;
    }
    // A row filed before the feed window opens replays with no forward bars at
    // all; that is a history gap, not a flat trade.
    if (!verdict.bars) {
      unrecoverable += 1;
      continue;
    }

    const storedR = row.realized_r == null ? null : Number(row.realized_r);
    const expected = row.status === "expired" ? "unresolved" : row.status;
    const agrees = verdict.status === expected;
    const record: Mismatch = {
      id: row.id,
      symbol: row.symbol,
      timeframe: row.timeframe,
      bias: row.bias,
      grade: row.grade,
      storedStatus: row.status,
      replayStatus: verdict.status,
      storedR,
      replayR: verdict.realizedR,
      filedAt: row.created_at,
      replayResolvedAt: iso(verdict.resolvedAt),
    };
    if (!agrees) mismatches.push(record);
    if (spotCheck.length < 5) {
      spotCheck.push({
        ...record,
        entry: Number(row.entry),
        stop: Number(row.stop),
        tp1: Number(row.tp1),
        maeR: verdict.maeR,
        mfeR: verdict.mfeR,
        bars: verdict.bars,
        agrees,
      });
    }

    if (row.mfe_r != null && row.mae_r != null) {
      alreadyHad += 1;
      continue;
    }
    const update: ExcursionUpdate = {
      id: row.id,
      mae_r: verdict.maeR,
      mfe_r: verdict.mfeR,
      bars_to_resolve: verdict.bars,
    };
    // Fill costs at the same time when the row predates cost recording, using the
    // static per-instrument table. Estimated, not the true spread at the minute.
    if (row.net_r == null && storedR != null) {
      const risk = Math.abs(Number(row.entry) - Number(row.stop));
      const cost = costInR(row.symbol, Number(row.entry), risk);
      update.cost_r = cost;
      update.net_r = Math.round((storedR - cost) * 1000) / 1000;
    }
    updates.push(update);
  }

  const notes: string[] = [];
  notes.push(
    `Excursions recomputed for ${updates.length} of ${rows.length} rows. MFE and MAE come from the same bar walk that decided the trade, so no new inputs were needed.`,
  );
  if (unrecoverable)
    notes.push(
      `${unrecoverable} rows are older than the price feed window (roughly a year per instrument). Their excursions cannot be recovered.`,
    );
  if (unscorable) notes.push(`${unscorable} rows are not scorable: no direction, or entry equal to stop.`);
  notes.push(
    mismatches.length
      ? `${mismatches.length} stored verdicts disagree with the replay. Nothing was auto-corrected; each is listed with the bar time so it can be checked on a chart.`
      : "Every stored verdict re-walked to the same result. The page agrees with the bars.",
  );
  notes.push(
    "Costs are a static per-instrument spread and slippage estimate, not the true spread at signal time. That figure is not recoverable.",
  );

  return {
    updates,
    report: {
      scanned: rows.length,
      updated: updates.length,
      alreadyHad,
      unrecoverable,
      unscorable,
      mismatches: mismatches.slice(0, 50),
      spotCheck,
      notes,
    },
  };
}
