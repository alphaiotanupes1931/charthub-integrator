// Server entry point for the Wyckoff-only mode.
//
// Deliberately thin: fetch closed bars from the same feed the charts use, run
// the pure engine, return the plan. Nothing is stored and no published grade is
// touched, so this mode can be practised and measured next to the existing
// scanner without changing it.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { readWyckoff, type WyPlan } from "./engine";

export type WyckoffScan = WyPlan & {
  ticker: string;
  interval: string;
  source: string;
  barsRead: number;
  fetchedAt: string;
};

export const runWyckoffScan = createServerFn({ method: "POST" })
  .inputValidator((raw: unknown) =>
    z
      .object({
        ticker: z.string().min(1).max(20),
        interval: z.string().min(1).max(4),
      })
      .parse(raw),
  )
  .handler(async ({ data }): Promise<WyckoffScan> => {
    const { getSnapshot } = await import("@/lib/agents/market-data.server");
    const snap = await getSnapshot(data.ticker, data.interval);
    const candles = snap.candles ?? [];
    const plan = readWyckoff(candles);
    return {
      ...plan,
      ticker: data.ticker,
      interval: data.interval,
      source: snap.source,
      barsRead: candles.length,
      fetchedAt: snap.fetchedAt,
    };
  });
