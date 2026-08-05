// Strategy performance loop: run the historical engine for a strategy on a
// given instrument/timeframe, store the measured edge, and feed it back into
// scan grading so proven playbooks weigh more than untested ones.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { StrategyPerfInput } from "@/lib/backtest/schemas";
import type { StrategyPerfRow } from "@/lib/strategy-perf.shared";

export type { StrategyPerfRow };

export const listStrategyPerformance = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<StrategyPerfRow[]> => {
    const { data, error } = await context.supabase
      .from("strategy_performance")
      .select("*")
      .eq("user_id", context.userId)
      .order("updated_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    return (data ?? []).map((r) => ({
      strategyId: r.strategy_id as string,
      symbol: r.symbol as string,
      timeframe: r.timeframe as string,
      trades: Number(r.trades),
      winRate: Number(r.win_rate),
      expectancyR: Number(r.expectancy_r),
      netR: Number(r.net_r),
      maxDrawdownPct: Number(r.max_drawdown_pct),
      updatedAt: r.updated_at as string,
    }));
  });

export const recordStrategyBacktest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => StrategyPerfInput.parse(raw))
  .handler(async ({ data, context }): Promise<{ ok: true; row: StrategyPerfRow } | { ok: false; error: string }> => {
    const { getHistory } = await import("@/lib/backtest/history.server");
    const { runBacktest, DEFAULT_PARAMS } = await import("@/lib/backtest/engine");
    try {
      const { bars, source } = await getHistory(data.symbol, data.timeframe, data.lookback);
      const result = runBacktest(
        bars,
        { ...DEFAULT_PARAMS, minGrade: data.minGrade, direction: data.direction },
        { symbol: data.symbol, timeframe: data.timeframe, source },
      );
      const updatedAt = new Date().toISOString();
      const patch = {
        user_id: context.userId,
        strategy_id: data.strategyId,
        symbol: data.symbol,
        timeframe: data.timeframe,
        trades: result.stats.trades,
        win_rate: result.stats.winRate,
        expectancy_r: result.stats.expectancyR,
        net_r: result.stats.netR,
        max_drawdown_pct: result.stats.maxDrawdownPct,
        source: "backtest",
        updated_at: updatedAt,
      };
      const { error } = await context.supabase
        .from("strategy_performance")
        .upsert(patch as never, { onConflict: "user_id,strategy_id,symbol,timeframe" });
      if (error) {
        console.error("[strategy-perf] upsert failed", error.message);
        return { ok: false, error: error.message };
      }
      return {
        ok: true,
        row: {
          strategyId: data.strategyId,
          symbol: data.symbol,
          timeframe: data.timeframe,
          trades: result.stats.trades,
          winRate: result.stats.winRate,
          expectancyR: result.stats.expectancyR,
          netR: result.stats.netR,
          maxDrawdownPct: result.stats.maxDrawdownPct,
          updatedAt,
        },
      };
    } catch (e) {
      console.error("[strategy-perf] run failed", (e as Error).message);
      return { ok: false, error: (e as Error).message };
    }
  });
