// Read-only measurement: how many signals survive the sweep gate, the staleness
// guard, and both together, per instrument per week. Nothing is written back
// and no live signal changes off this report.
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/hooks/gate-volume")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const expected = process.env.SUPABASE_PUBLISHABLE_KEY;
        if (expected && request.headers.get("apikey") !== expected) {
          return new Response("unauthorized", { status: 401 });
        }
        const url = new URL(request.url);
        const limit = Math.min(Number(url.searchParams.get("limit")) || 1500, 5000);
        const staleR = Number(url.searchParams.get("staleR")) || 0.5;

        const { analyzeGateVolume } = await import("@/lib/gate-volume");
        const { readProtectedStructure } = await import("@/lib/protectedStructure");
        const { cachedBarLoader } = await import("@/lib/stop-width-per-instrument.server");
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const { data, error } = await supabaseAdmin
          .from("signal_scores")
          .select("symbol,timeframe,bias,status,realized_r,net_r,entry_distance_r,entry,stop,created_at")
          .in("status", ["target", "stop", "expired"])
          .order("created_at", { ascending: false })
          .limit(limit);
        if (error) return Response.json({ error: error.message }, { status: 500 });

        const loadBars = cachedBarLoader();
        const { evaluateEntryStaleness } = await import("@/lib/signal-staleness");
        const rows = [];
        const staleSource = { recorded: 0, reconstructed: 0, unmeasured: 0 };
        for (const row of data ?? []) {
          const bias = String(row.bias).toLowerCase();
          if (bias !== "long" && bias !== "short") continue;
          const bars = await loadBars(row.symbol, row.timeframe);
          const cutoff = Date.parse(row.created_at);
          const upto = bars.filter((b) => (b.time > 1e12 ? b.time : b.time * 1000) <= cutoff);
          let sweepPass: boolean | null = null;
          if (upto.length > 30) {
            const candles = upto.map((b, i) => ({ ...b, open: i > 0 ? upto[i - 1]!.close : b.close }));
            const bos = readProtectedStructure(candles);
            const wanted = bias === "long" ? "bullish" : "bearish";
            sweepPass = !bos || bos.kind !== wanted ? true : bos.swept;
          }
          // Fill-time reconstruction: when the filing path did not record how far
          // past entry price sat, rebuild it from the last closed bar at or before
          // filing, the same price the scanner could see. No look-ahead.
          let d = row.entry_distance_r == null ? null : Number(row.entry_distance_r);
          if (d != null && isFinite(d)) staleSource.recorded += 1;
          else {
            const ref = upto.length ? upto[upto.length - 1]!.close : null;
            const read = evaluateEntryStaleness({ bias, entry: Number(row.entry), stop: Number(row.stop), lastPrice: ref, toleranceR: staleR });
            d = read.distanceR;
            if (d == null) staleSource.unmeasured += 1;
            else staleSource.reconstructed += 1;
          }
          rows.push({
            symbol: row.symbol,
            created_at: row.created_at,
            r: row.net_r != null ? Number(row.net_r) : row.realized_r == null ? null : Number(row.realized_r),
            sweepPass,
            stalePass: d == null || !isFinite(d) ? null : d <= staleR,
          });
        }
        return Response.json({ staleToleranceR: staleR, staleSource, ...analyzeGateVolume(rows) });
      },
    },
  },
});
