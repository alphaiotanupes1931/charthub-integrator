// AI Signal Engine - scans a watchlist through the 3-layer stack and returns
// a compact BUY/SELL/HOLD signal per ticker. Reuses market-data + research +
// planner helpers directly (not through runResearchPlan) so it stays a single
// server call for the whole watchlist.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getSnapshot } from "./market-data.server";
import { runResearch } from "./research.server";
import { runPlanner } from "./planner.server";
import type { TradePlan } from "./types";

/**
 * Signal lifecycle. A setup that satisfies the structure rules is not an entry
 * yet: it becomes one when the confirming bar has CLOSED and price is actually
 * at the planned entry. "forming" is surfaced as "setup developing" so the
 * engine is visibly working without putting anyone in early; only "confirmed"
 * is an entry.
 */
export type SignalState = "forming" | "confirmed" | "invalidated";

export type Signal = {
  ticker: string;
  /** Market price used to build the plan, required when filing it for scoring. */
  refPrice: number | null;
  action: "BUY" | "SELL" | "HOLD";
  grade: TradePlan["grade"];
  confidence: number;
  entry: string;
  stop: string;
  tp1: string;
  rr: string;
  notes: string;
  generatedAt: string;
  state: SignalState;
  /** Why the signal sits in this state, in plain language. */
  stateReason: string;
  /** Price that has to trade/close before "forming" becomes "confirmed". */
  triggerLevel?: number;
  /** Seconds until the bar being watched closes; 0 when it already has. */
  secondsToBarClose?: number;
};

const DEFAULT_WATCHLIST = [
  "XAU/USD", "XAG/USD", "WTI Oil",
  "NAS100", "SPX500", "US30",
  "EUR/USD", "GBP/USD", "USD/JPY",
  "BTC/USD", "ETH/USD",
];


const Input = z.object({
  tickers: z.array(z.string().min(1).max(20)).optional(),
  interval: z.string().default("60"),
});

function toAction(plan: TradePlan): Signal["action"] {
  if (plan.grade === "NO ENTRY" || plan.bias === "Neutral") return "HOLD";
  // Conviction is now counted from evidence (25-90) rather than floored by
  // grade, so the actionable cut-off sits lower than the old 55.
  if (plan.confidence < 45) return "HOLD";
  return plan.bias === "Long" ? "BUY" : "SELL";
}

/**
 * Promotion rule: a setup is only an entry once the lower timeframe has
 * confirmed on a CLOSED bar and price is at the planned entry. Everything else
 * that still has a valid thesis stays "forming" instead of being shown as a
 * live entry, which is what put traders in one to two bars early.
 */
export function signalState(
  plan: TradePlan,
  action: Signal["action"],
): { state: SignalState; stateReason: string } {
  if (plan.grade === "NO ENTRY" || plan.bias === "Neutral") {
    return { state: "invalidated", stateReason: "No valid setup on this instrument right now." };
  }
  if (action === "HOLD") {
    return { state: "forming", stateReason: "Thesis is valid but conviction is below the entry threshold." };
  }
  if (plan.triggered === false) {
    return {
      state: "forming",
      stateReason: plan.triggerRule ?? "Waiting for the confirming candle to close at the entry.",
    };
  }
  return { state: "confirmed", stateReason: plan.triggerRule ?? "Confirmed on the closed candle at the entry." };
}


export const runSignalScan = createServerFn({ method: "POST" })
  .inputValidator((raw: unknown) => Input.parse(raw))
  .handler(async ({ data }): Promise<Signal[]> => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) return [];
    const tickers = data.tickers && data.tickers.length ? data.tickers : DEFAULT_WATCHLIST;
    const results = await Promise.all(tickers.map(async (ticker): Promise<Signal | null> => {
      try {
        const snap = await getSnapshot(ticker, data.interval);
        if (snap.source === "unavailable" || snap.candles.length < 20) {
          // Keep the instrument visible instead of dropping it silently, so a
          // feed hiccup on US30 / Silver / Oil is obvious rather than looking
          // like the scanner skipped them.
          return {
            ticker,
            refPrice: null,
            action: "HOLD",
            grade: "NO ENTRY",
            confidence: 0,
            entry: "-",
            stop: "-",
            tp1: "-",
            rr: "-",
            notes: "Price feed unavailable for this instrument right now. Re-run the scan in a moment.",
            generatedAt: new Date().toISOString(),
            state: "invalidated",
            stateReason: "No price feed for this instrument right now.",
          };
        }

        const memo = await runResearch(apiKey, snap);
        const plan = await runPlanner(apiKey, snap, memo);
        const action = toAction(plan);
        const lifecycle = signalState(plan, action);
        return {
          ticker,
          refPrice: snap.lastPrice,
          action,
          grade: plan.grade,
          confidence: plan.confidence,
          entry: plan.entry,
          stop: plan.stop,
          tp1: plan.tp1,
          rr: plan.rr,
          notes: plan.notes,
          generatedAt: new Date().toISOString(),
          state: lifecycle.state,
          stateReason: lifecycle.stateReason,
          triggerLevel: plan.triggerLevel,
          secondsToBarClose: snap.bar?.secondsToClose ?? 0,
        };
      } catch { return null; }
    }));
    const signals = results.filter((s): s is Signal => s !== null);

    // Fire-and-forget: post A/A+ actionable signals to the shared Discord feed.
    // Only CONFIRMED setups are posted - a forming setup broadcast as an entry
    // is exactly the "too early" complaint.
    const topSignals = signals.filter(
      (s) => (s.grade === "A" || s.grade === "A+") && s.action !== "HOLD" && s.state === "confirmed",
    );
    if (topSignals.length > 0) {
      try {
        const { sendDiscordShared } = await import("@/lib/briefings.server");
        const lines = topSignals.map((s) =>
          `**${s.grade}** ${s.action} ${s.ticker} · Entry ${s.entry} · Stop ${s.stop} · TP1 ${s.tp1} · R:R ${s.rr} · ${s.confidence}%`,
        );
        await sendDiscordShared(`**High-conviction signals**\n${lines.join("\n")}`).catch(() => undefined);
      } catch { /* non-fatal */ }
    }

    return signals;
  });
