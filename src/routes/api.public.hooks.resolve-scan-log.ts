// Cron endpoint: settle open scan-log rows against real price bars, so the
// daily review shows what TradeMind said vs what price actually did.
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/hooks/resolve-scan-log")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const expected = process.env.SUPABASE_PUBLISHABLE_KEY;
        if (expected && request.headers.get("apikey") !== expected) {
          return new Response("unauthorized", { status: 401 });
        }
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { resolveSignal } = await import("@/lib/signal-scores.server");

        const { data, error } = await supabaseAdmin
          .from("scan_log")
          .select("id, symbol, timeframe, bias, entry, stop, tp1, created_at, signal_score_id")
          .eq("status", "open")
          .lt("created_at", new Date(Date.now() - 30 * 60 * 1000).toISOString())
          .order("created_at", { ascending: true })
          .limit(150);
        if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });

        let resolved = 0;
        for (const row of data ?? []) {
          try {
            let upd: Record<string, unknown> | null = null;
            if (row.signal_score_id) {
              // Already on the scoreboard: copy its verdict so both agree.
              const { data: s } = await supabaseAdmin
                .from("signal_scores")
                .select("status, realized_r, mae_r, mfe_r, resolved_at")
                .eq("id", row.signal_score_id)
                .maybeSingle();
              if (s && s.status !== "open") {
                upd = { status: s.status, realized_r: s.realized_r, mae_r: s.mae_r, mfe_r: s.mfe_r, resolved_at: s.resolved_at ?? new Date().toISOString() };
              }
            } else if (row.entry != null && row.stop != null && row.tp1 != null) {
              const res = await resolveSignal({
                id: row.id,
                symbol: row.symbol,
                timeframe: row.timeframe,
                bias: row.bias,
                entry: Number(row.entry),
                stop: Number(row.stop),
                tp1: Number(row.tp1),
                created_at: row.created_at,
              } as never);
              if (res.status !== "open") {
                upd = { status: res.status, realized_r: res.realizedR, mae_r: res.maeR ?? null, mfe_r: res.mfeR ?? null, resolved_at: new Date().toISOString() };
              }
            } else {
              upd = { status: "no_trade" };
            }
            if (upd) {
              await supabaseAdmin.from("scan_log").update(upd as never).eq("id", row.id);
              resolved += 1;
            }
          } catch {
            /* one bad symbol shouldn't stop the batch */
          }
        }
        return Response.json({ ok: true, checked: data?.length ?? 0, resolved });
      },
    },
  },
});
