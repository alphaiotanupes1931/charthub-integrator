// Server-only resolver for the signal scoreboard.
//
// Walks price history forward from the moment a signal was filed and decides
// whether the stop or the first target printed first. No look-ahead games: we
// only consider bars stamped after the signal was created, and when a single
// bar contains both levels we count it as a stop (the conservative read).

import type { BtBar } from "@/lib/backtest/engine";
import type { BacktestTimeframe } from "@/lib/backtest/catalog";

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
  status: "target" | "stop" | "expired" | "open" | "void";
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
  /** Bars from filing to resolution, so timing can be judged per timeframe. */
  barsToResolve?: number | null;
};

/** Long or short, or null when the scan had no directional opinion. */
export function signalDirection(bias: string): "long" | "short" | null {
  const b = bias.trim().toLowerCase();
  if (b.startsWith("l") || b === "buy" || b === "bull" || b === "bullish") return "long";
  if (b.startsWith("s") || b === "sell" || b === "bear" || b === "bearish") return "short";
  return null;
}

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

/** How long a signal gets to work before we call it stale, per timeframe. */
const EXPIRY_HOURS: Record<string, number> = {
  "15": 24,
  "60": 72,
  "240": 240,
  D: 720,
};

export async function resolveSignal(sig: OpenSignal): Promise<Resolution> {
  const tf = HISTORY_TF[sig.timeframe] ?? "60";
  const expiryHours = EXPIRY_HOURS[tf] ?? 72;
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

  const forward = bars.filter((b) => b.time * 1000 > createdMs);
  const long = sig.bias.toLowerCase().startsWith("l");
  const risk = Math.abs(sig.entry - sig.stop);
  if (!risk || !forward.length) {
    return ageHours > expiryHours ? { status: "expired", realizedR: 0 } : { status: "open", realizedR: null };
  }
  const reward = Math.abs(sig.tp1 - sig.entry);
  const rMultiple = Math.round((reward / risk) * 100) / 100;

  // Heat taken before resolution, measured bar by bar in R.
  let mae = 0;
  const round = (n: number) => Math.round(n * 100) / 100;

  for (let i = 0; i < forward.length; i++) {
    const bar = forward[i]!;
    const adverse = long ? sig.entry - bar.low : bar.high - sig.entry;
    if (adverse > 0) mae = Math.max(mae, adverse / risk);
    const hitStop = long ? bar.low <= sig.stop : bar.high >= sig.stop;
    const hitTarget = long ? bar.high >= sig.tp1 : bar.low <= sig.tp1;
    if (hitStop) return { status: "stop", realizedR: -1, maeR: round(mae), barsToResolve: i + 1 };
    if (hitTarget) return { status: "target", realizedR: rMultiple, maeR: round(mae), barsToResolve: i + 1 };
  }

  if (ageHours > expiryHours) {
    const last = forward[forward.length - 1]!.close;
    const move = long ? last - sig.entry : sig.entry - last;
    return {
      status: "expired",
      realizedR: round(move / risk),
      maeR: round(mae),
      barsToResolve: forward.length,
    };
  }
  return { status: "open", realizedR: null, maeR: round(mae), barsToResolve: forward.length };
}
