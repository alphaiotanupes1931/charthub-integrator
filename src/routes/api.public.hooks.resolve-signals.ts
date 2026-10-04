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
          .select("id, symbol, timeframe, bias, entry, stop, tp1, created_at, ob_shadow_entry, ob_shadow_stop")
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
          ob_shadow_entry?: number | string | null;
          ob_shadow_stop?: number | string | null;
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
              ob_shadow_entry: sig.ob_shadow_entry == null ? null : Number(sig.ob_shadow_entry),
              ob_shadow_stop: sig.ob_shadow_stop == null ? null : Number(sig.ob_shadow_stop),
            });
            if (res.status === "open") continue;
            await supabaseAdmin
              .from("signal_scores")
              .update({
                status: res.status,
                realized_r: res.realizedR,
                resolved_at: new Date().toISOString(),
                // "How early" as a number: heat taken before the signal resolved.
                // Net of spread and slippage, plus the size of that haircut in R.
                net_r: res.netR ?? null,
                cost_r: res.costR ?? null,
                mae_r: res.maeR ?? null,
                // Ground made in our favour: separates a tight stop from a wrong call.
                mfe_r: res.mfeR ?? null,
                bars_to_resolve: res.barsToResolve ?? null,
                // Stopped, then the target printed anyway: a stop-width problem.
                rescued: res.rescued ?? false,
                // Shadow only: what a 1R target would have made. Never live.
                shadow_tp1r_r: res.shadowTp1rR ?? null,
                // Shadow only: the 15m-inside-1H order-block entry. Never live.
                ob_shadow_r: res.obShadowR ?? null,
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
