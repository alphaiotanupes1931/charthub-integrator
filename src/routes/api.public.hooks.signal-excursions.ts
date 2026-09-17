// Backfill maximum favourable/adverse excursion onto historical signals, and
// verify each stored verdict against a fresh bar walk. Excursions and estimated
// costs are written; stored status and realised R are never rewritten here.
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/hooks/signal-excursions")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const expected = process.env.SUPABASE_PUBLISHABLE_KEY;
        const provided = request.headers.get("apikey");
        if (expected && provided !== expected) {
          return new Response("unauthorized", { status: 401 });
        }

        const url = new URL(request.url);
        const limit = Math.min(Number(url.searchParams.get("limit")) || 500, 2000);
        // dry=1 verifies and reports without writing anything.
        const dry = url.searchParams.get("dry") === "1";

        const { computeExcursions } = await import("@/lib/signal-excursions.server");
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { getHistory } = await import("@/lib/backtest/history.server");

        const { data, error } = await supabaseAdmin
          .from("signal_scores")
          .select("id,symbol,timeframe,bias,grade,entry,stop,tp1,status,realized_r,mfe_r,mae_r,net_r,created_at,resolved_at")
          .in("status", ["target", "stop", "expired"])
          .order("created_at", { ascending: false })
          .limit(limit);
        if (error) return Response.json({ error: error.message }, { status: 500 });

        const rows = (data ?? []).map((r) => ({
          ...r,
          entry: Number(r.entry),
          stop: Number(r.stop),
          tp1: Number(r.tp1),
          realized_r: r.realized_r == null ? null : Number(r.realized_r),
          mfe_r: r.mfe_r == null ? null : Number(r.mfe_r),
          mae_r: r.mae_r == null ? null : Number(r.mae_r),
          net_r: r.net_r == null ? null : Number(r.net_r),
        })) as Parameters<typeof computeExcursions>[0];

        // One history fetch per symbol/timeframe pair, reused across its rows.
        const HISTORY_TF: Record<string, string> = { "1": "15", "5": "15", "15": "15", "30": "60", "60": "60", "240": "240", D: "D", W: "D" };
        const cache = new Map<string, Awaited<ReturnType<typeof getHistory>>["bars"] | null>();
        const pairs = new Set(rows.map((r) => `${r.symbol}|${HISTORY_TF[r.timeframe] ?? "60"}`));
        for (const pair of pairs) {
          const [symbol, tf] = pair.split("|") as [string, string];
          try {
            const res = await getHistory(symbol, tf as never, "1y");
            cache.set(pair, res.bars);
          } catch {
            cache.set(pair, null);
          }
        }

        const { updates, report } = computeExcursions(rows, (symbol, timeframe) => {
          return cache.get(`${symbol}|${HISTORY_TF[timeframe] ?? "60"}`) ?? null;
        });

        let written = 0;
        if (!dry) {
          for (const u of updates) {
            const { id, ...fields } = u;
            const { error: upErr } = await supabaseAdmin
              .from("signal_scores")
              .update(fields as never)
              .eq("id", id);
            if (!upErr) written += 1;
          }
        }

        return Response.json({ ...report, written, dry });
      },
    },
  },
});
