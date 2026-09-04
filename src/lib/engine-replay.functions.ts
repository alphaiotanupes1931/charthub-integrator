// Server functions behind the replay track record.
//
// refreshEngineReplay runs the deterministic historical engine on one
// instrument/timeframe over the requested lookback and stores the measured
// stats. listEngineReplay reads the stored rows for display.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { BACKTEST_SYMBOLS, BACKTEST_TIMEFRAMES } from "@/lib/backtest/catalog";
import type { ReplayRow } from "@/lib/engine-replay.shared";

const RefreshInput = z.object({
  symbol: z.enum(BACKTEST_SYMBOLS),
  timeframe: z.enum(BACKTEST_TIMEFRAMES).default("60"),
  lookback: z.enum(["60d", "1y", "2y", "5y"]).default("2y"),
});

type Row = {
  symbol: string;
  timeframe: string;
  lookback: string;
  bars: number;
  from_ts: string | null;
  to_ts: string | null;
  trades: number;
  wins: number;
  win_rate: number;
  expectancy_r: number;
  net_r: number;
  profit_factor: number | null;
  max_dd_pct: number;
  a_trades: number;
  a_win_rate: number;
  a_expectancy_r: number;
  source: string;
  updated_at: string;
};

function toRow(r: Row): ReplayRow {
  return {
    symbol: r.symbol,
    timeframe: r.timeframe,
    lookback: r.lookback,
    bars: Number(r.bars),
    from: r.from_ts,
    to: r.to_ts,
    trades: Number(r.trades),
    wins: Number(r.wins),
    winRate: Number(r.win_rate),
    expectancyR: Number(r.expectancy_r),
    netR: Number(r.net_r),
    profitFactor: r.profit_factor == null ? null : Number(r.profit_factor),
    maxDdPct: Number(r.max_dd_pct),
    aTrades: Number(r.a_trades),
    aWinRate: Number(r.a_win_rate),
    aExpectancyR: Number(r.a_expectancy_r),
    source: r.source,
    updatedAt: r.updated_at,
  };
}

export const listEngineReplay = createServerFn({ method: "GET" }).handler(async (): Promise<ReplayRow[]> => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("engine_replay_stats")
    .select("*")
    .order("symbol", { ascending: true })
    .limit(200);
  if (error) {
    console.error("[engine-replay] list failed", error.message);
    return [];
  }
  return ((data ?? []) as unknown as Row[]).map(toRow);
});

export const refreshEngineReplay = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => RefreshInput.parse(raw))
  .handler(async ({ data }): Promise<{ ok: true; row: ReplayRow } | { ok: false; error: string }> => {
    const { getHistory } = await import("@/lib/backtest/history.server");
    const { runBacktest, DEFAULT_PARAMS } = await import("@/lib/backtest/engine");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    try {
      const { bars, source } = await getHistory(data.symbol, data.timeframe, data.lookback);
      const result = runBacktest(bars, DEFAULT_PARAMS, {
        symbol: data.symbol,
        timeframe: data.timeframe,
        source,
      });
      const aBuckets = result.byGrade.filter((b) => b.key === "A" || b.key === "A+");
      const aTrades = aBuckets.reduce((s, b) => s + b.trades, 0);
      const aWins = aBuckets.reduce((s, b) => s + b.wins, 0);
      const aNetR = aBuckets.reduce((s, b) => s + b.netR, 0);

      const patch = {
        symbol: data.symbol,
        timeframe: data.timeframe,
        lookback: data.lookback,
        bars: result.barCount,
        from_ts: result.from ? new Date(result.from * 1000).toISOString() : null,
        to_ts: result.to ? new Date(result.to * 1000).toISOString() : null,
        trades: result.stats.trades,
        wins: result.stats.wins,
        win_rate: result.stats.winRate,
        expectancy_r: result.stats.expectancyR,
        net_r: result.stats.netR,
        profit_factor: result.stats.profitFactor,
        max_dd_pct: result.stats.maxDrawdownPct,
        a_trades: aTrades,
        a_win_rate: aTrades ? Math.round((aWins / aTrades) * 1000) / 10 : 0,
        a_expectancy_r: aTrades ? Math.round((aNetR / aTrades) * 100) / 100 : 0,
        source,
        notes: result.notes.join(" ") || null,
        updated_at: new Date().toISOString(),
      };

      const { data: saved, error } = await supabaseAdmin
        .from("engine_replay_stats")
        .upsert(patch as never, { onConflict: "symbol,timeframe,lookback" })
        .select("*")
        .single();
      if (error) {
        console.error("[engine-replay] upsert failed", error.message);
        return { ok: false, error: error.message };
      }
      return { ok: true, row: toRow(saved as unknown as Row) };
    } catch (e) {
      console.error("[engine-replay] run failed", (e as Error).message);
      return { ok: false, error: (e as Error).message };
    }
  });
