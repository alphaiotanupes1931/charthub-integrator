// Measurement endpoint: does the label rank the trade? Tests the published grade,
// the confidence number and each of the six shadow family scores against realized
// net R. Read-only: nothing is written back and no grade changes as a result.
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/hooks/grade-separation")({
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

        const { analyzeGradeSeparation } = await import("@/lib/grade-separation.server");
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const { data, error } = await supabaseAdmin
          .from("signal_scores")
          .select("id,symbol,timeframe,bias,grade,confidence,status,realized_r,net_r,created_at")
          .in("status", ["target", "stop", "expired"])
          .order("created_at", { ascending: false })
          .limit(limit);
        if (error) return Response.json({ error: error.message }, { status: 500 });

        const filed = (data ?? []).map((r) => ({
          id: r.id,
          symbol: r.symbol,
          timeframe: r.timeframe,
          bias: r.bias,
          grade: r.grade,
          confidence: r.confidence == null ? null : Number(r.confidence),
          // Net of costs when it exists, gross otherwise, so older rows still count.
          r: r.net_r != null ? Number(r.net_r) : r.realized_r == null ? null : Number(r.realized_r),
          status: r.status,
          createdAt: r.created_at,
        }));

        const oldest = filed.length ? filed[filed.length - 1]!.createdAt : new Date().toISOString();
        const { data: progData } = await supabaseAdmin
          .from("scanner_program_scores")
          .select("symbol,timeframe,bias,composite,percentile,families,created_at")
          .gte("created_at", oldest)
          .order("created_at", { ascending: false })
          .limit(5000);

        const program = (progData ?? []).map((p) => ({
          symbol: p.symbol,
          timeframe: p.timeframe,
          bias: p.bias,
          createdAt: p.created_at,
          composite: p.composite == null ? null : Number(p.composite),
          percentile: p.percentile == null ? null : Number(p.percentile),
          families: (p.families ?? null) as Record<string, { score?: number; above?: boolean }> | null,
        }));

        return Response.json(analyzeGradeSeparation(filed, program));
      },
    },
  },
});
