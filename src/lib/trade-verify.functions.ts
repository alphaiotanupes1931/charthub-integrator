import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export const verifyJournalTrade = createServerFn({ method: "POST" })
  .inputValidator((data) =>
    z
      .object({
        symbol: z.string().min(1),
        timeframe: z.string().min(1),
        side: z.enum(["Long", "Short"]),
        entry: z.number(),
        stop: z.number(),
        takeProfit: z.number().nullable().optional(),
        since: z.number(),
      })
      .parse(data),
  )
  .handler(async ({ data }) => {
    const { verifyTrade } = await import("@/lib/trade-verify.server");
    return verifyTrade({ ...data, takeProfit: data.takeProfit ?? null });
  });
