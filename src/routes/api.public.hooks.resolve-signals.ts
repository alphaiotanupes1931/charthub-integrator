// Cron endpoint: resolve open scan signals against real price history so the
// scoreboard hit rates stay current without the trader tagging anything.
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/hooks/resolve-signals")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const expected = process.env.SUPABASE_PUBLISHABLE_KEY;
        const provided = request.headers.get("apikey");
        if (expected && provided !== expected) {
          return new Response("unauthorized", { status: 401 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { resolveSignal } = await import("@/lib/signal-scores.server");

        const { data, error } = await supabaseAdmin
          .from("signal_scores")
          .select("id, symbol, timeframe, bias, entry, stop, tp1, created_at")
          .eq("status", "open")
          .lt("created_at", new Date(Date.now() - 30 * 60 * 1000).toISOString())
          .order("created_at", { ascending: true })
          .limit(200);
        if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });

        const open = (data ?? []) as unknown as Array<{
          id: string;
          symbol: string;
          timeframe: string;
          bias: string;
          entry: number | string;
          stop: number | string;
          tp1: number | string;
          created_at: string;
        }>;

        let resolved = 0;
        for (const sig of open) {
          try {
            const res = await resolveSignal({
              id: sig.id,
              symbol: sig.symbol,
              timeframe: sig.timeframe,
              bias: sig.bias,
              entry: Number(sig.entry),
              stop: Number(sig.stop),
              tp1: Number(sig.tp1),
              created_at: sig.created_at,
            });
            if (res.status === "open") continue;
            await supabaseAdmin
              .from("signal_scores")
              .update({
                status: res.status,
                realized_r: res.realizedR,
                resolved_at: new Date().toISOString(),
                // "How early" as a number: heat taken before the signal resolved.
                mae_r: res.maeR ?? null,
                bars_to_resolve: res.barsToResolve ?? null,
              } as never)
              .eq("id", sig.id);
            resolved += 1;
          } catch {
            /* one bad symbol shouldn't stop the batch */
          }
        }

        return Response.json({ ok: true, checked: open.length, resolved });
      },
    },
  },
});
