import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { DEFAULT_PARAMS, runBacktest, type BtResult } from "./engine";
import { BACKTEST_TIMEFRAMES } from "./catalog";

const Input = z.object({
  symbol: z.string().min(1),
  timeframe: z.enum(BACKTEST_TIMEFRAMES),
  lookback: z.enum(["60d", "1y", "2y", "5y"]).default("2y"),
  minGrade: z.enum(["A+", "A", "B", "C"]).default("B"),
  direction: z.enum(["both", "long", "short"]).default("both"),
  riskPct: z.coerce.number().min(0.1).max(10).default(1),
  rrTarget: z.coerce.number().min(0.5).max(10).default(2),
  atrStopMult: z.coerce.number().min(0.3).max(5).default(1.2),
  maxHoldBars: z.coerce.number().int().min(3).max(300).default(40),
  sessions: z.array(z.string()).default([]),
});

export type BacktestRequest = z.input<typeof Input>;
export type BacktestResponse = { ok: true; result: BtResult } | { ok: false; error: string };

export const runHistoricalBacktest = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => Input.parse(input))
  .handler(async ({ data }): Promise<BacktestResponse> => {
    const { getHistory } = await import("./history.server");
    try {
      const { bars, source } = await getHistory(data.symbol, data.timeframe, data.lookback);
      const result = runBacktest(
        bars,
        {
          ...DEFAULT_PARAMS,
          minGrade: data.minGrade,
          direction: data.direction,
          riskPct: data.riskPct,
          rrTarget: data.rrTarget,
          atrStopMult: data.atrStopMult,
          maxHoldBars: data.maxHoldBars,
          sessions: data.sessions,
        },
        { symbol: data.symbol, timeframe: data.timeframe, source },
      );
      return { ok: true, result };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  });
