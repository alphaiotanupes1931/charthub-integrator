import { createServerFn } from "@tanstack/react-start";
import { requireCapability } from "@/lib/capability-middleware";
import { z } from "zod";
import type { SniperResult } from "./sniper.server";

export const runSniperEntry = createServerFn({ method: "POST" })
  .middleware([requireCapability("signal_engine")])
  .inputValidator((raw: unknown) =>
    z
      .object({
        ticker: z.string().min(1).max(20),
        interval: z.string().min(1).max(4),
        bias: z.enum(["Long", "Short"]),
        entry: z.number().positive(),
        stop: z.number().positive(),
        tp1: z.number().positive(),
        tp2: z.number().positive(),
      })
      .parse(raw),
  )
  .handler(async ({ data }): Promise<SniperResult> => {
    const { getSnapshot } = await import("./market-data.server");
    const { refineSniper, sniperInterval } = await import("./sniper.server");
    const tf = sniperInterval(data.interval);
    const snap = await getSnapshot(data.ticker, tf);
    const riskBefore = Math.abs(data.entry - data.stop);
    const rrBefore = riskBefore > 0 ? Math.abs(data.tp1 - data.entry) / riskBefore : 0;
    if (snap.source === "unavailable" || snap.candles.length < 20) {
      return {
        improved: false,
        timeframe: tf,
        lastPrice: snap.lastPrice,
        entry: data.entry,
        stop: data.stop,
        tp1: data.tp1,
        tp2: data.tp2,
        rr: rrBefore,
        rrBefore,
        riskBefore,
        riskAfter: riskBefore,
        anchor: "original plan",
        orderType: data.bias === "Long" ? "BUY LIMIT" : "SELL LIMIT",
        notes: "The lower-timeframe feed is unavailable right now, so the original limit stands. Try the sniper pass again in a moment.",
      };
    }
    return refineSniper(snap, {
      bias: data.bias,
      entry: data.entry,
      stop: data.stop,
      tp1: data.tp1,
      tp2: data.tp2,
    });
  });
