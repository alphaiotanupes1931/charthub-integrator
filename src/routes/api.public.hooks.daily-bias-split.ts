// Measurement endpoint: do our decided signals do better when they follow the
// daily bias instead of the 4H trend? Read-only research - nothing is written
// back and no live gate changes off the back of it.
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/hooks/daily-bias-split")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const expected = process.env.SUPABASE_PUBLISHABLE_KEY;
        const provided = request.headers.get("apikey");
        if (expected && provided !== expected) {
          return new Response("unauthorized", { status: 401 });
        }

        const url = new URL(request.url);
        const limit = Math.min(Number(url.searchParams.get("limit")) || 1500, 5000);
        const symbolFilter = url.searchParams.get("symbol");

        const { analyzeDailyBiasSplit, directionAt, bucketFor } = await import("@/lib/daily-bias-split.server");
        const { cachedBarLoader } = await import("@/lib/stop-width-per-instrument.server");
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        let q = supabaseAdmin
          .from("signal_scores")
          .select("id,symbol,timeframe,grade,bias,status,realized_r,net_r,created_at")
          .in("status", ["target", "stop"])
          .order("created_at", { ascending: false })
          .limit(limit);
        if (symbolFilter) q = q.eq("symbol", symbolFilter);
        const { data, error } = await q;
        if (error) return Response.json({ error: error.message }, { status: 500 });

        const loadBars = cachedBarLoader();
        const tagged = [];
        for (const row of data ?? []) {
          const dailyBars = await loadBars(row.symbol, "D");
          const h4Bars = await loadBars(row.symbol, "240");
          const dailyBias = dailyBars.length ? directionAt(dailyBars, row.created_at) : null;
          const h4 = h4Bars.length ? directionAt(h4Bars, row.created_at) : null;
          tagged.push({
            id: row.id,
            symbol: row.symbol,
            timeframe: row.timeframe,
            grade: row.grade,
            bias: row.bias,
            status: row.status,
            r:
              row.net_r != null
                ? Number(row.net_r)
                : row.realized_r == null
                  ? null
                  : Number(row.realized_r),
            created_at: row.created_at,
            dailyBias,
            h4Trend: h4 === "bullish" ? ("up" as const) : h4 === "bearish" ? ("down" as const) : h4 ? ("range" as const) : null,
            bucket: bucketFor({ bias: row.bias, dailyBias, h4 }),
          });
        }

        return Response.json(analyzeDailyBiasSplit(tagged));
      },
    },
  },
});
