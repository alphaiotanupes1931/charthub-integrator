// Measurement endpoint: sweep stop widths per instrument over already-resolved
// signals. Read-only - nothing is written back and no live stop placement changes
// from it. Stop distance is where most of the loss is coming from, and it is
// instrument-specific, so it is measured per symbol rather than pooled.
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/hooks/stop-width-per-instrument")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const expected = process.env.SUPABASE_PUBLISHABLE_KEY;
        const provided = request.headers.get("apikey");
        if (expected && provided !== expected) {
          return new Response("unauthorized", { status: 401 });
        }

        const url = new URL(request.url);
        const grades = (url.searchParams.get("grades") ?? "A+,A,B,C").split(",").map((g) => g.trim());
        const limit = Math.min(Number(url.searchParams.get("limit")) || 1200, 3000);
        const symbolFilter = (url.searchParams.get("symbols") ?? "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        const multsParam = (url.searchParams.get("mults") ?? "")
          .split(",")
          .map((m) => Number(m.trim()))
          .filter((m) => Number.isFinite(m) && m > 0);
        const floorParam = Number(url.searchParams.get("floor"));

        const { runPerInstrumentStopWidthSweep, DEFAULT_STOP_MULTIPLES, PER_INSTRUMENT_SAMPLE_FLOOR } =
          await import("@/lib/stop-width-per-instrument.server");
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        let query = supabaseAdmin
          .from("signal_scores")
          .select("id,symbol,timeframe,grade,bias,entry,stop,tp1,status,realized_r,created_at")
          .in("status", ["target", "stop", "expired"])
          .in("grade", grades);
        if (symbolFilter.length > 0) query = query.in("symbol", symbolFilter);

        const { data, error } = await query.order("created_at", { ascending: false }).limit(limit);
        if (error) return Response.json({ error: error.message }, { status: 500 });

        const rows = (data ?? []).map((r) => ({
          id: r.id,
          symbol: r.symbol,
          timeframe: r.timeframe,
          grade: r.grade,
          bias: r.bias,
          entry: Number(r.entry),
          stop: Number(r.stop),
          tp1: Number(r.tp1),
          status: r.status,
          realizedR: r.realized_r == null ? null : Number(r.realized_r),
          created_at: r.created_at,
        }));

        const report = await runPerInstrumentStopWidthSweep(
          rows,
          multsParam.length > 0 ? multsParam : DEFAULT_STOP_MULTIPLES,
          { sampleFloor: Number.isFinite(floorParam) && floorParam > 0 ? floorParam : PER_INSTRUMENT_SAMPLE_FLOOR },
        );
        return Response.json({ sampled: rows.length, ...report });
      },
    },
  },
});
