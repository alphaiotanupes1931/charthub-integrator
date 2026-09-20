// Scheduled job: replay the current deterministic engine over two years of
// real price bars for each instrument and store the measured stats, so the
// published track record does not depend on waiting for live scans to resolve.
import { createFileRoute } from "@tanstack/react-router";
import { BACKTEST_SYMBOLS } from "@/lib/backtest/catalog";
import { toGradeMix } from "@/lib/grade-mix.shared";

export const Route = createFileRoute("/api/public/hooks/replay-refresh")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const expected = process.env.SUPABASE_PUBLISHABLE_KEY;
        const provided = request.headers.get("apikey");
        if (expected && provided !== expected) {
          return new Response("unauthorized", { status: 401 });
        }

        const url = new URL(request.url);
        const only = url.searchParams.get("symbol");
        const timeframe = (url.searchParams.get("timeframe") ?? "60") as "15" | "60" | "240" | "D";
        const lookback = (url.searchParams.get("lookback") ?? "2y") as "60d" | "1y" | "2y" | "5y";
        // Tuning sweeps run with ?dry=1 so numbers can be compared without
        // overwriting the published track record.
        const dry = url.searchParams.get("dry") === "1";
        const sessionBiasComparison = url.searchParams.get("variant") === "classic-session-bias";
        if (sessionBiasComparison && !dry) {
          return Response.json({ ok: false, error: "The session-bias variant is shadow-only; add dry=1." }, { status: 400 });
        }
        const num = (k: string) => {
          const v = url.searchParams.get(k);
          const n = v == null ? NaN : Number(v);
          return Number.isFinite(n) ? n : undefined;
        };
        const overrides = {
          ...(num("rrTarget") !== undefined ? { rrTarget: num("rrTarget")! } : {}),
          ...(num("atrStopMult") !== undefined ? { atrStopMult: num("atrStopMult")! } : {}),
          ...(num("maxHoldBars") !== undefined ? { maxHoldBars: num("maxHoldBars")! } : {}),
          ...(num("maxExtensionAtr") !== undefined ? { maxExtensionAtr: num("maxExtensionAtr")! } : {}),
          ...(url.searchParams.get("trendFilter") === "0" ? { trendFilter: false } : {}),
          ...(url.searchParams.get("sessions") ? { sessions: url.searchParams.get("sessions")!.split(",") } : {}),
          ...(url.searchParams.get("minGrade") ? { minGrade: url.searchParams.get("minGrade") as "A+" | "A" | "B" | "C" } : {}),
        };

        const { getHistory } = await import("@/lib/backtest/history.server");
        const { runBacktest, DEFAULT_PARAMS } = await import("@/lib/backtest/engine");
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const symbols = only ? [only] : [...BACKTEST_SYMBOLS];
        const done: Array<{ symbol: string; trades?: number; winRate?: number; expectancyR?: number; error?: string }> = [];

        for (const symbol of symbols) {
          try {
            const { bars, source } = await getHistory(symbol, timeframe, lookback);
            if (sessionBiasComparison) {
              const { compareClassicSessionBias, SESSION_BIAS_SYMBOLS } = await import("@/lib/backtest/session-bias-comparison");
              if (!(SESSION_BIAS_SYMBOLS as readonly string[]).includes(symbol)) continue;
              const comparison = compareClassicSessionBias(symbol, bars);
              done.push({
                symbol,
                trades: comparison.filtered.stats.trades,
                winRate: comparison.filtered.stats.winRate,
                expectancyR: comparison.filtered.stats.expectancyR,
                comparison,
              } as (typeof done)[number]);
              continue;
            }
            const result = runBacktest(bars, { ...DEFAULT_PARAMS, ...overrides }, { symbol, timeframe, source });
            const aBuckets = result.byGrade.filter((b) => b.key === "A" || b.key === "A+");
            const aTrades = aBuckets.reduce((s, b) => s + b.trades, 0);
            const aWins = aBuckets.reduce((s, b) => s + b.wins, 0);
            const aNetR = aBuckets.reduce((s, b) => s + b.netR, 0);

            if (dry) {
              done.push({
                symbol,
                trades: result.stats.trades,
                winRate: result.stats.winRate,
                expectancyR: result.stats.expectancyR,
              });
              continue;
            }

            const { error } = await supabaseAdmin.from("engine_replay_stats").upsert(
              {
                symbol,
                timeframe,
                lookback,
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
                grade_mix: toGradeMix(result.byGrade),
                notes: result.notes.join(" ") || null,
                updated_at: new Date().toISOString(),
              } as never,
              { onConflict: "symbol,timeframe,lookback" },
            );
            if (error) done.push({ symbol, error: error.message });
            else done.push({ symbol, trades: result.stats.trades, winRate: result.stats.winRate });
          } catch (e) {
            done.push({ symbol, error: (e as Error).message });
          }
        }

        return Response.json({ ok: true, timeframe, lookback, results: done });
      },
    },
  },
});
