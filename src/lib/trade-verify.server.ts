// Server-only resolver for journal trades.
//
// Walks real price history forward from the moment the trade was logged and
// decides whether the stop, the take profit, or neither printed first. Same
// conservative read as the signal scoreboard: if one bar straddles both
// levels we call it a stop.

import type { BtBar } from "@/lib/backtest/engine";
import type { BacktestTimeframe } from "@/lib/backtest/catalog";

export type TradeVerifyInput = {
  symbol: string;
  timeframe: string; // journal timeframe: 1m,5m,15m,30m,1H,4H,1D,1W
  side: "Long" | "Short";
  entry: number;
  stop: number;
  takeProfit?: number | null;
  /** epoch ms when the trade was logged */
  since: number;
};

export type TradeVerifyResult = {
  status: "tp" | "stop" | "breakeven" | "partial" | "open";
  /** Price the outcome resolved at, when known. */
  price: number | null;
  /** Realised R against the logged risk. */
  r: number | null;
  source: string | null;
  bars: number;
  note: string;
};

const HISTORY_TF: Record<string, BacktestTimeframe> = {
  "1m": "15",
  "5m": "15",
  "15m": "15",
  "30m": "60",
  "1H": "60",
  "4H": "240",
  "1D": "D",
  "1W": "D",
};

/** How long a trade gets to work before we stop calling it live. */
const EXPIRY_HOURS: Record<string, number> = { "15": 48, "60": 120, "240": 336, D: 1440 };

export async function verifyTrade(input: TradeVerifyInput): Promise<TradeVerifyResult> {
  const tf = HISTORY_TF[input.timeframe] ?? "60";
  const ageHours = (Date.now() - input.since) / 3_600_000;
  const risk = Math.abs(input.entry - input.stop);
  if (!risk || !Number.isFinite(risk)) {
    return { status: "open", price: null, r: null, source: null, bars: 0, note: "No stop distance logged, nothing to verify." };
  }

  const { getHistory } = await import("@/lib/backtest/history.server");
  let bars: BtBar[] = [];
  let source: string | null = null;
  try {
    const res = await getHistory(input.symbol, tf, ageHours > 720 ? "1y" : "3m");
    bars = res.bars;
    source = res.source;
  } catch {
    return { status: "open", price: null, r: null, source: null, bars: 0, note: "Price history was not available for this symbol." };
  }

  const forward = bars.filter((b) => b.time * 1000 > input.since);
  if (!forward.length) {
    return { status: "open", price: null, r: null, source, bars: 0, note: "No completed bars since this trade was logged yet." };
  }

  const long = input.side === "Long";
  const tp = input.takeProfit && Number.isFinite(input.takeProfit) ? Number(input.takeProfit) : null;

  for (const bar of forward) {
    const hitStop = long ? bar.low <= input.stop : bar.high >= input.stop;
    const hitTp = tp != null && (long ? bar.high >= tp : bar.low <= tp);
    if (hitStop && Math.abs(input.stop - input.entry) / risk < 0.05) {
      return { status: "breakeven", price: input.stop, r: 0, source, bars: forward.length, note: "Price came back to the entry, closed at breakeven." };
    }
    if (hitStop) {
      return { status: "stop", price: input.stop, r: -1, source, bars: forward.length, note: "Stop loss was hit before the target." };
    }
    if (hitTp) {
      const r = Math.round((Math.abs(tp! - input.entry) / risk) * 100) / 100;
      return { status: "tp", price: tp!, r, source, bars: forward.length, note: "Take profit was hit." };
    }
  }

  const last = forward[forward.length - 1]!.close;
  const move = long ? last - input.entry : input.entry - last;
  const r = Math.round((move / risk) * 100) / 100;
  const expiry = EXPIRY_HOURS[tf] ?? 120;
  if (ageHours > expiry) {
    if (Math.abs(r) < 0.1) {
      return { status: "breakeven", price: last, r, source, bars: forward.length, note: "Trade went nowhere and expired flat, effectively breakeven." };
    }
    return {
      status: "partial",
      price: last,
      r,
      source,
      bars: forward.length,
      note: `Neither level printed. Price sits ${r > 0 ? "in favour" : "against"} at ${r}R, trade has run past its window.`,
    };
  }
  return {
    status: "open",
    price: last,
    r,
    source,
    bars: forward.length,
    note: `Still live. Currently ${r > 0 ? "+" : ""}${r}R at ${last}.`,
  };
}
