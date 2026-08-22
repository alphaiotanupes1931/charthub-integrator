import { createServerFn } from "@tanstack/react-start";
import { requireCapability } from "@/lib/capability-middleware";
import { BacktestInput } from "./schemas";
import type { BtBar, BtResult } from "./engine";

export type BacktestRequest = import("zod").input<typeof BacktestInput>;
export type BacktestResponse =
  | { ok: true; result: BtResult; bars: BtBar[] }
  | { ok: false; error: string };

export const runHistoricalBacktest = createServerFn({ method: "POST" })
  .middleware([requireCapability("strategy_library")])
  .inputValidator((input: unknown) => BacktestInput.parse(input))
  .handler(async ({ data }): Promise<BacktestResponse> => {
    const { getHistory } = await import("./history.server");
    const { DEFAULT_PARAMS, runBacktest } = await import("./engine");
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
      // Bars are returned so the UI can replay every simulated trade on a chart.
      return { ok: true, result, bars: bars.slice(-6000) };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  });
