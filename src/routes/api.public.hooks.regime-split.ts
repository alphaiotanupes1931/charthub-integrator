// Measurement endpoint: do outcomes differ by the market regime present when the
// signal was filed? Read-only research - nothing is written back and no live
// signal, grade or entry changes off the back of it.
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/hooks/regime-split")({
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

        const { analyzeRegimeSplit, regimeAtEmission } = await import("@/lib/regime-split.server");
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
          const bars = await loadBars(row.symbol, row.timeframe);
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
            regime: bars.length ? regimeAtEmission(bars, row.created_at, row.timeframe) : null,
          });
        }

        return Response.json(analyzeRegimeSplit(tagged));
      },
    },
  },
});
