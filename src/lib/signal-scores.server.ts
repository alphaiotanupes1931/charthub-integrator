// Server-only resolver for the signal scoreboard.
//
// Walks price history forward from the moment a signal was filed and decides
// whether the stop or the first target printed first. No look-ahead games: we
// only consider bars stamped after the signal was created, and when a single
// bar contains both levels we count it as a stop (the conservative read).

import type { BtBar } from "@/lib/backtest/engine";
import type { BacktestTimeframe } from "@/lib/backtest/catalog";
import { costInR } from "@/lib/trading-costs";
import { replayForward, replayDirection } from "@/lib/signal-replay";

export type OpenSignal = {
  id: string;
  symbol: string;
  timeframe: string;
  bias: string;
  entry: number;
  stop: number;
  tp1: number;
  created_at: string;
};

export type Resolution = {
  /**
   * "void" means the signal had no direction to score (Neutral bias). Those rows
   * are excluded from hit rate and expectancy: scoring them silently bets short
   * on every no-opinion scan and folds coin flips into the record.
   */
  status: "target" | "stop" | "expired" | "open" | "void" | "unfilled";
  realizedR: number | null;
  /**
   * Maximum adverse excursion, in R: how far price went AGAINST the entry
   * before the signal resolved. This is the measurement of "how early" an entry
   * was. A book of winners with a consistent 0.7R of heat means the entry rule
   * fires before price is done, and the confirmation threshold should tighten.
   */
  maeR?: number | null;
  /**
   * Maximum favourable excursion, in R: how far price went IN FAVOUR of the
   * entry before the signal resolved. Read against maeR it separates a stop that
   * was too tight (large mfeR on a loser) from a direction that was simply wrong.
   */
  mfeR?: number | null;
  /**
   * Realised R after spread and slippage. Gross R (realizedR) leaves trading
   * costs out, which flatters tight-stopped setups most, so both are reported.
   */
  netR?: number | null;
  /** Cost of this trade expressed in R, so the size of the haircut is visible. */
  costR?: number | null;
  /** Bars from filing to resolution, so timing can be judged per timeframe. */
  barsToResolve?: number | null;
};

/** Long or short, or null when the scan had no directional opinion. */
export { replayDirection as signalDirection };

const HISTORY_TF: Record<string, BacktestTimeframe> = {
  "1": "15",
  "5": "15",
  "15": "15",
  "30": "60",
  "60": "60",
  "240": "240",
  D: "D",
  W: "D",
};

export async function resolveSignal(sig: OpenSignal): Promise<Resolution> {
  const direction = replayDirection(sig.bias);
  if (!direction) {
    // No opinion, nothing to score. Voided rather than defaulted to short.
    return { status: "void", realizedR: null, maeR: null, mfeR: null, netR: null, costR: null, barsToResolve: null };
  }
  const tf = HISTORY_TF[sig.timeframe] ?? "60";
  // Per-market clock from measured time-to-resolution: see signal-expiry.ts. The
  // old single 72-hour 1H clock was closing live trades and holding dead ones.
  const { expiryHoursFor } = await import("@/lib/signal-expiry");
  const expiryHours = expiryHoursFor(sig.symbol, tf);
  const createdMs = new Date(sig.created_at).getTime();
  const ageHours = (Date.now() - createdMs) / 3_600_000;

  const { getHistory } = await import("@/lib/backtest/history.server");
  let bars: BtBar[];
  try {
    const res = await getHistory(sig.symbol, tf, ageHours > 240 ? "1y" : "3m");
    bars = res.bars;
  } catch {
    return { status: "open", realizedR: null };
  }

  const risk = Math.abs(sig.entry - sig.stop);
  // One bar walk for the whole app: see signal-replay.ts. The backfill pass uses
  // the same function, so a historical MFE and a live MFE are the same measurement.
  const verdict = replayForward(sig, bars);
  if (!verdict || !risk) {
    return ageHours > expiryHours ? { status: "expired", realizedR: 0 } : { status: "open", realizedR: null };
  }
  const cost = costInR(sig.symbol, sig.entry, risk);
  const net = (gross: number) => Math.round((gross - cost) * 1000) / 1000;
  const round = (n: number) => Math.round(n * 100) / 100;

  if (verdict.status !== "unresolved") {
    return {
      status: verdict.status,
      realizedR: verdict.realizedR,
      netR: net(verdict.realizedR ?? 0),
      costR: cost,
      maeR: verdict.maeR,
      mfeR: verdict.mfeR,
      barsToResolve: verdict.bars,
    };
  }

  if (ageHours > expiryHours) {
    const long = direction === "long";
    const last = verdict.lastClose ?? sig.entry;
    const move = long ? last - sig.entry : sig.entry - last;
    return {
      status: "expired",
      realizedR: round(move / risk),
      netR: net(round(move / risk)),
      costR: cost,
      maeR: verdict.maeR,
      mfeR: verdict.mfeR,
      barsToResolve: verdict.bars,
    };
  }
  return {
    status: "open",
    realizedR: null,
    netR: null,
    costR: cost,
    maeR: verdict.maeR,
    mfeR: verdict.mfeR,
    barsToResolve: verdict.bars,
  };
}
