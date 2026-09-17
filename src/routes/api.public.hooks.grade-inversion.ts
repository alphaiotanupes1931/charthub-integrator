// Measurement endpoint: why do C grades outperform A grades? Compares grades
// raw, within each instrument class, and re-weighted onto one common instrument
// mix, so composition can be ruled in or out before the grading is changed.
// Read-only: nothing is written back.
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/hooks/grade-inversion")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const expected = process.env.SUPABASE_PUBLISHABLE_KEY;
        const provided = request.headers.get("apikey");
        if (expected && provided !== expected) {
          return new Response("unauthorized", { status: 401 });
        }

        const url = new URL(request.url);
        const limit = Math.min(Number(url.searchParams.get("limit")) || 2000, 5000);

        const { analyzeGradeInversion } = await import("@/lib/grade-inversion.server");
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const { data, error } = await supabaseAdmin
          .from("signal_scores")
          .select("symbol,grade,status,realized_r,net_r,planned_r,mae_r,mfe_r,bars_to_resolve,counter_trend,entry,stop,created_at")
          .in("status", ["target", "stop", "expired"])
          .order("created_at", { ascending: false })
          .limit(limit);

        if (error) return Response.json({ error: error.message }, { status: 500 });

        const rows = (data ?? []).map((r) => ({
          symbol: r.symbol,
          grade: r.grade,
          status: r.status,
          realizedR: r.realized_r == null ? null : Number(r.realized_r),
          netR: r.net_r == null ? null : Number(r.net_r),
          plannedR: r.planned_r == null ? null : Number(r.planned_r),
          maeR: r.mae_r == null ? null : Number(r.mae_r),
          mfeR: r.mfe_r == null ? null : Number(r.mfe_r),
          barsToResolve: r.bars_to_resolve == null ? null : Number(r.bars_to_resolve),
          counterTrend: r.counter_trend ?? null,
          entry: Number(r.entry),
          stop: Number(r.stop),
          createdAt: r.created_at,
        }));

        return Response.json(analyzeGradeInversion(rows));
      },
    },
  },
});
