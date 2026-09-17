// Measurement endpoint: re-score resolved signals at one common stop width so
// grade hit rates can be compared without the planner's grade-dependent stop
// distance confounding them. Read-only: nothing is written back.
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/hooks/stop-width-test")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const expected = process.env.SUPABASE_PUBLISHABLE_KEY;
        const provided = request.headers.get("apikey");
        if (expected && provided !== expected) {
          return new Response("unauthorized", { status: 401 });
        }

        const url = new URL(request.url);
        const multRaw = Number(url.searchParams.get("mult"));
        const targetMult = Number.isFinite(multRaw) && multRaw > 0 ? multRaw : 1.5;
        const grades = (url.searchParams.get("grades") ?? "A+,A,B,C").split(",").map((g) => g.trim());
        const limit = Math.min(Number(url.searchParams.get("limit")) || 500, 2000);

        const { runStopWidthTest } = await import("@/lib/stop-width-test.server");
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const { data, error } = await supabaseAdmin
          .from("signal_scores")
          .select("id,symbol,timeframe,grade,bias,entry,stop,tp1,status,realized_r,created_at")
          .in("status", ["target", "stop", "expired"])
          .in("grade", grades)
          .order("created_at", { ascending: false })
          .limit(limit);

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

        // scale=1 moves TP1 with the stop so planned R:R stays constant, which is
        // the only version of this test that isolates stop width.
        const scaleTargets = ["1", "true", "yes"].includes((url.searchParams.get("scale") ?? "").toLowerCase());
        const report = await runStopWidthTest(rows, targetMult, { scaleTargets });
        return Response.json({ sampled: rows.length, ...report });
      },
    },
  },
});
