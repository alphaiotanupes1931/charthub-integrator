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
import { scoreCandidate as scoreCandidateSync } from "@/lib/entry-candidates";

export type OpenSignal = {
  id: string;
  symbol: string;
  timeframe: string;
  bias: string;
  entry: number;
  stop: number;
  tp1: number;
  created_at: string;
  ob_shadow_entry?: number | null;
  ob_shadow_stop?: number | null;
  seq_shadow_entry?: number | null;
  seq_shadow_stop?: number | null;
  seq_shadow_target?: number | null;
  entry_candidates?: import("@/lib/entry-candidates").EntryCandidates | null;
};

/**
 * Equal-risk score for each of the four v2 entry candidates over the signal's
 * life. Unfilled candidates score 0R and are kept. Null when nothing was armed.
 */
export function scoreEntryCandidates(
  sig: OpenSignal,
  bars: BtBar[],
  untilSec: number,
): Record<string, { filled: boolean; r: number }> | null {
  const cand = sig.entry_candidates;
  if (!cand || cand.state !== "armed" || !cand.risk || cand.target == null || !cand.direction) return null;
  const fromSec = Math.floor(new Date(sig.created_at).getTime() / 1000);
  const fwd = bars.filter((b) => b.time > fromSec && b.time <= untilSec);
  if (!fwd.length) return null;
  const long = cand.direction === "long";
  const out: Record<string, { filled: boolean; r: number }> = {};
  for (const [model, level] of Object.entries(cand.levels)) {
    if (level == null) continue;
    out[model] = scoreCandidateSync(fwd, long, level, cand.risk, cand.target, costInR(sig.symbol, level, cand.risk));
  }
  return out;
}

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
  /**
   * Stopped out, and then price reached the target anyway. A book of rescued
   * stops is a stop-placement problem, not a direction problem, and the two
   * need opposite fixes.
   */
  rescued?: boolean;
  /**
   * Shadow only: net R had the take-profit sat at exactly 1R. Computed from a
   * second bar walk with the target moved; never touches the live verdict.
   * Collected so the 1R-target idea can be reviewed on forward data.
   */
  shadowTp1rR?: number | null;
  /** Shadow only: net R of the order-block entry against the same target. */
  obShadowR?: number | null;
  /** Shadow only: net R of the full-sequence entry against its own swing target. */
  seqShadowR?: number | null;
  /** v2 entry candidates, equal risk, unfilled = 0R. */
  candidateR?: Record<string, { filled: boolean; r: number }> | null;
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
  // requireFill: a planned entry is a resting limit, so nothing is scored until
  // price actually traded back to it. Signals price ran away from are recorded as
  // never filled instead of being credited with a trade the account never had.
  const verdict = replayForward(sig, bars, { requireFill: true });
  if (!verdict || !risk) {
    return ageHours > expiryHours ? { status: "expired", realizedR: 0 } : { status: "open", realizedR: null };
  }
  const cost = costInR(sig.symbol, sig.entry, risk);
  const net = (gross: number) => Math.round((gross - cost) * 1000) / 1000;
  const round = (n: number) => Math.round(n * 100) / 100;

  if (verdict.status === "unfilled") {
    // Still inside its clock: the entry may yet be traded back to.
    if (ageHours <= expiryHours) {
      return { status: "open", realizedR: null, netR: null, costR: null, maeR: null, mfeR: null, barsToResolve: null };
    }
    return {
      status: "unfilled",
      realizedR: null,
      netR: null,
      costR: null,
      maeR: null,
      mfeR: null,
      barsToResolve: null,
    };
  }

  if (verdict.status !== "unresolved") {
    return {
      status: verdict.status,
      realizedR: verdict.realizedR,
      netR: net(verdict.realizedR ?? 0),
      costR: cost,
      maeR: verdict.maeR,
      mfeR: verdict.mfeR,
      barsToResolve: verdict.bars,
      rescued: verdict.rescued,
      shadowTp1rR: shadowTp1r(sig, bars, direction, risk, cost),
      obShadowR: obShadowR(sig, bars, direction),
      seqShadowR: shadowEntryR(sig, bars, direction, sig.seq_shadow_entry, sig.seq_shadow_stop, sig.seq_shadow_target ?? sig.tp1),
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

/**
 * Shadow replay with the target moved to exactly 1R. Same bars, same fill
 * rules, same conservative both-in-one-bar read; only the target changes.
 * Returns net R (1R win, -1R stop, mark-to-market when neither printed), or
 * null when the shadow entry never filled.
 */
function shadowTp1r(
  sig: OpenSignal,
  bars: BtBar[],
  direction: "long" | "short",
  risk: number,
  cost: number,
): number | null {
  const tp1r = direction === "long" ? sig.entry + risk : sig.entry - risk;
  const shadow = replayForward({ ...sig, tp1: tp1r }, bars, { requireFill: true });
  if (!shadow || shadow.status === "unfilled") return null;
  const gross =
    shadow.status === "target"
      ? 1
      : shadow.status === "stop"
        ? -1
        : (() => {
            const last = shadow.lastClose ?? sig.entry;
            const move = direction === "long" ? last - sig.entry : sig.entry - last;
            return Math.round((move / risk) * 100) / 100;
          })();
  return Math.round((gross - cost) * 1000) / 1000;
}

/**
 * Shadow replay of the order-block entry: same bars, same target, same fill and
 * same-bar-is-a-stop rules; only entry and stop move to the order block.
 * Null when there was no order-block entry or it never filled.
 */
function obShadowR(sig: OpenSignal, bars: BtBar[], direction: "long" | "short"): number | null {
  return shadowEntryR(sig, bars, direction, sig.ob_shadow_entry, sig.ob_shadow_stop, sig.tp1);
}

/** Shared shadow replay: alternative entry, stop and target on the same bars and rules. */
export function shadowEntryR(
  sig: OpenSignal,
  bars: BtBar[],
  direction: "long" | "short",
  entry: number | null | undefined,
  stop: number | null | undefined,
  target: number,
): number | null {
  if (entry == null || stop == null || !Number.isFinite(entry) || !Number.isFinite(stop)) return null;
  const long = direction === "long";
  const risk = long ? entry - stop : stop - entry;
  if (!(risk > 0)) return null;
  if (long ? target <= entry : target >= entry) return null;
  const shadow = replayForward({ ...sig, entry, stop, tp1: target }, bars, { requireFill: true });
  if (!shadow || shadow.status === "unfilled") return null;
  const gross =
    shadow.status === "target"
      ? Math.abs(target - entry) / risk
      : shadow.status === "stop"
        ? -1
        : ((long ? (shadow.lastClose ?? entry) - entry : entry - (shadow.lastClose ?? entry)) / risk);
  const cost = costInR(sig.symbol, entry, risk);
  return Math.round((gross - cost) * 1000) / 1000;
}
