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
  status: "target" | "stop" | "expired" | "open";
  realizedR: number | null;
};

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

  for (const bar of forward) {
    const hitStop = long ? bar.low <= sig.stop : bar.high >= sig.stop;
    const hitTarget = long ? bar.high >= sig.tp1 : bar.low <= sig.tp1;
    if (hitStop) return { status: "stop", realizedR: -1 };
    if (hitTarget) return { status: "target", realizedR: rMultiple };
  }

  if (ageHours > expiryHours) {
    const last = forward[forward.length - 1]!.close;
    const move = long ? last - sig.entry : sig.entry - last;
    return { status: "expired", realizedR: Math.round((move / risk) * 100) / 100 };
  }
  return { status: "open", realizedR: null };
}
