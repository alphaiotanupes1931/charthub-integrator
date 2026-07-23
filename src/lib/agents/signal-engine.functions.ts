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

export type Signal = {
  ticker: string;
  action: "BUY" | "SELL" | "HOLD";
  grade: TradePlan["grade"];
  confidence: number;
  entry: string;
  stop: string;
  tp1: string;
  rr: string;
  notes: string;
  generatedAt: string;
};

const DEFAULT_WATCHLIST = [
  "XAU/USD", "EUR/USD", "GBP/USD", "USD/JPY",
  "BTC/USD", "ETH/USD", "NAS100", "SPX500",
];

const Input = z.object({
  tickers: z.array(z.string().min(1).max(20)).max(20).optional(),
  interval: z.string().default("60"),
});

function toAction(plan: TradePlan): Signal["action"] {
  if (plan.grade === "NO ENTRY" || plan.bias === "Neutral") return "HOLD";
  if (plan.confidence < 55) return "HOLD";
  return plan.bias === "Long" ? "BUY" : "SELL";
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
        if (snap.source === "unavailable" || snap.candles.length < 20) return null;
        const memo = await runResearch(apiKey, snap);
        const plan = await runPlanner(apiKey, snap, memo);
        return {
          ticker,
          action: toAction(plan),
          grade: plan.grade,
          confidence: plan.confidence,
          entry: plan.entry,
          stop: plan.stop,
          tp1: plan.tp1,
          rr: plan.rr,
          notes: plan.notes,
          generatedAt: new Date().toISOString(),
        };
      } catch { return null; }
    }));
    const signals = results.filter((s): s is Signal => s !== null);

    // Fire-and-forget: post A/A+ actionable signals to the shared Discord feed.
    const topSignals = signals.filter((s) => (s.grade === "A" || s.grade === "A+") && s.action !== "HOLD");
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
