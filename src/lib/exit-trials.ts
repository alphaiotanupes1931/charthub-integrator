// Two quiet trials, replayed candle by candle with the same rules as live scoring
// (fill required, same-bar stop+target counts as a stop). Read-only research.
//
// 1. Breakeven at +1R (Gold): once price reaches +1R, the stop moves to entry.
// 2. Minimum stop width (EUR/USD): the stop is widened until round-trip cost is
//    at most `maxCostR` of risk; the target moves with it so planned R:R holds.
import { forwardBars, replayDirection, replayForward, type ReplayBar, type ReplaySignal } from "@/lib/signal-replay";
import { roundTripCost } from "@/lib/trading-costs";

export type TrialResult = { status: "target" | "stop" | "breakeven" | "unresolved" | "unfilled"; r: number | null };

export function replayBreakevenAt1R(sig: ReplaySignal, bars: ReplayBar[]): TrialResult | null {
  const dir = replayDirection(sig.bias);
  const risk = Math.abs(sig.entry - sig.stop);
  if (!dir || !(risk > 0)) return null;
  const long = dir === "long";
  const fwd = forwardBars(bars, sig.created_at);
  const rr = Math.abs(sig.tp1 - sig.entry) / risk;
  const oneR = long ? sig.entry + risk : sig.entry - risk;
  let filled = false;
  let stop = sig.stop;
  let armed = false;
  for (const b of fwd) {
    if (!filled) {
      if (long ? b.low <= sig.entry : b.high >= sig.entry) filled = true;
      else if (long ? b.high >= sig.tp1 : b.low <= sig.tp1) return { status: "unfilled", r: null };
      else continue;
    }
    const hitStop = long ? b.low <= stop : b.high >= stop;
    const hitTarget = long ? b.high >= sig.tp1 : b.low <= sig.tp1;
    if (hitStop) return armed ? { status: "breakeven", r: 0 } : { status: "stop", r: -1 };
    if (hitTarget) return { status: "target", r: Math.round(rr * 100) / 100 };
    // Move to breakeven only after the bar closes; the stop applies from the next bar.
    if (!armed && (long ? b.high >= oneR : b.low <= oneR)) {
      armed = true;
      stop = sig.entry;
    }
  }
  return { status: filled ? "unresolved" : "unfilled", r: null };
}

/** Widen the stop so costs are at most maxCostR of risk; R:R held constant. */
export function widenForCost(sig: ReplaySignal, symbol: string, maxCostR = 0.1): ReplaySignal {
  const dir = replayDirection(sig.bias);
  const risk = Math.abs(sig.entry - sig.stop);
  if (!dir || !(risk > 0)) return sig;
  const minRisk = roundTripCost(symbol, sig.entry) / maxCostR;
  if (risk >= minRisk) return sig;
  const rr = Math.abs(sig.tp1 - sig.entry) / risk;
  const s = dir === "long" ? -1 : 1;
  return { ...sig, stop: sig.entry + s * minRisk, tp1: sig.entry - s * minRisk * rr };
}

export function replayMinStopWidth(sig: ReplaySignal, bars: ReplayBar[], symbol: string, maxCostR = 0.1): TrialResult | null {
  const v = replayForward(widenForCost(sig, symbol, maxCostR), bars, { requireFill: true });
  if (!v) return null;
  return { status: v.status, r: v.realizedR };
}
