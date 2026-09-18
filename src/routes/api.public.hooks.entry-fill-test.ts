// Read-only entry-fill measurement: limit entry versus stop entry, the hold
// window each instrument actually needs, and how often the entry price was
// already gone at filing. Writes nothing and changes no production behaviour.
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/hooks/entry-fill-test")({
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
        const oldestFirst = url.searchParams.get("oldest") === "1";
        const symbol = url.searchParams.get("symbol");
        const minSample = Math.max(Number(url.searchParams.get("minSample")) || 20, 5);

        const { runEntryFillTest } = await import("@/lib/entry-fill-test.server");
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { getHistory } = await import("@/lib/backtest/history.server");

        let query = supabaseAdmin
          .from("signal_scores")
          .select("id,symbol,timeframe,bias,grade,entry,stop,tp1,status,created_at")
          .in("status", ["target", "stop", "expired"])
          .eq("source", "engine")
          .order("created_at", { ascending: oldestFirst })
          .limit(limit);
        if (symbol) query = query.eq("symbol", symbol);

        const { data, error } = await query;
        if (error) return Response.json({ error: error.message }, { status: 500 });

        const rows = (data ?? []).map((r) => ({
          ...r,
          entry: Number(r.entry),
          stop: Number(r.stop),
          tp1: Number(r.tp1),
        })) as Parameters<typeof runEntryFillTest>[0];

        const HISTORY_TF: Record<string, string> = {
          "1": "15",
          "5": "15",
          "15": "15",
          "30": "60",
          "60": "60",
          "240": "240",
          D: "D",
          W: "D",
        };
        const cache = new Map<string, Awaited<ReturnType<typeof getHistory>>["bars"] | null>();
        const pairs = new Set(rows.map((r) => `${r.symbol}|${HISTORY_TF[r.timeframe] ?? "60"}`));
        for (const pair of pairs) {
          const [sym, tf] = pair.split("|") as [string, string];
          try {
            const res = await getHistory(sym, tf as never, "1y");
            cache.set(pair, res.bars);
          } catch {
            cache.set(pair, null);
          }
        }

        const report = runEntryFillTest(
          rows,
          (sym, timeframe) => cache.get(`${sym}|${HISTORY_TF[timeframe] ?? "60"}`) ?? null,
          minSample,
        );

        return Response.json(report);
      },
    },
  },
});
