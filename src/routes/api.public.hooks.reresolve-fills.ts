// Re-resolve the filed record under limit-fill semantics.
//
// Rows were originally walked from the moment of filing, which credited a scan
// with a trade even when price never traded back to the planned entry. The
// resolver now requires the fill first, so stored verdicts have to be re-walked
// once: anything price ran away from becomes "unfilled" and drops out of hit rate
// and average R instead of counting as a free win or a loss.
//
// Append-only: every changed row is written to signal_corrections with its old
// value, the new value and the reason. Pass {"dry":false} to apply.
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/hooks/reresolve-fills")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const expected = process.env['SUPABASE_PUBLISHABLE_KEY'];
        if (expected && request.headers.get("apikey") !== expected) {
          return new Response("unauthorized", { status: 401 });
        }
        const body = (await request.json().catch(() => ({}))) as {
          dry?: boolean;
          limit?: number;
          offset?: number;
        };
        const dry = body.dry !== false;
        const limit = Math.min(body.limit ?? 200, 500);
        const offset = Math.max(body.offset ?? 0, 0);

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { resolveSignal } = await import("@/lib/signal-scores.server");

        const { data, error } = await supabaseAdmin
          .from("signal_scores")
          .select("id,symbol,timeframe,bias,entry,stop,tp1,grade,status,realized_r,rescued,created_at")
          .in("status", ["target", "stop", "expired"])
          .eq("source", "engine")
          .order("created_at", { ascending: false })
          .range(offset, offset + limit - 1);
        if (error) return Response.json({ error: error.message }, { status: 500 });

        const changes: Array<Record<string, unknown>> = [];
        let unchanged = 0;
        let failed = 0;
        let becameUnfilled = 0;
        let rescueBackfilled = 0;

        for (const row of data ?? []) {
          let verdict: Awaited<ReturnType<typeof resolveSignal>>;
          try {
            verdict = await resolveSignal({
              id: String(row.id),
              symbol: String(row.symbol),
              timeframe: String(row.timeframe),
              bias: String(row.bias),
              entry: Number(row.entry),
              stop: Number(row.stop),
              tp1: Number(row.tp1),
              created_at: String(row.created_at),
            } as never);
          } catch {
            failed += 1;
            continue;
          }
          // An already-decided row must never be re-opened by a short history
          // window; only a verdict change we can stand behind is written.
          if (verdict.status === "open") {
            unchanged += 1;
            continue;
          }
          const oldR = row.realized_r === null ? null : Number(row.realized_r);
          const sameStatus = verdict.status === String(row.status);
          const sameR =
            (verdict.realizedR ?? null) === null && oldR === null
              ? true
              : Math.abs((verdict.realizedR ?? 0) - (oldR ?? 0)) < 0.005;
          if (sameStatus && sameR) {
            unchanged += 1;
            // The verdict stands, but "stopped, then the target printed anyway" is a
            // new measurement rather than a correction, so it is backfilled quietly
            // on rows whose status and R are unchanged.
            const wantRescued = Boolean(verdict.rescued);
            if (!dry && wantRescued !== Boolean(row.rescued)) {
              rescueBackfilled += 1;
              await supabaseAdmin
                .from("signal_scores")
                .update({ rescued: wantRescued } as never)
                .eq("id", String(row.id));
            }
            continue;
          }
          if (verdict.status === "unfilled") becameUnfilled += 1;
          changes.push({
            id: row.id,
            symbol: row.symbol,
            grade: row.grade,
            oldStatus: row.status,
            newStatus: verdict.status,
            oldRealizedR: oldR,
            newRealizedR: verdict.realizedR ?? null,
          });
          if (dry) continue;

          const reason =
            "Re-walked under limit-fill semantics: a planned entry is a resting limit, so the trade is only scored once price traded back to it.";
          await supabaseAdmin.from("signal_corrections").insert([
            {
              signal_id: String(row.id),
              field: "status",
              old_value: String(row.status),
              new_value: verdict.status,
              reason,
            },
            {
              signal_id: String(row.id),
              field: "realized_r",
              old_value: oldR === null ? null : String(oldR),
              new_value: verdict.realizedR == null ? null : String(verdict.realizedR),
              reason,
            },
          ] as never);
          await supabaseAdmin
            .from("signal_scores")
            .update({
              status: verdict.status,
              realized_r: verdict.realizedR ?? null,
              net_r: verdict.netR ?? null,
              cost_r: verdict.costR ?? null,
              mae_r: verdict.maeR ?? null,
              mfe_r: verdict.mfeR ?? null,
              rescued: verdict.rescued ?? false,
              bars_to_resolve: verdict.barsToResolve ?? null,
              resolved_at: new Date().toISOString(),
            } as never)
            .eq("id", String(row.id));
        }

        return Response.json({
          dry,
          offset,
          scanned: (data ?? []).length,
          changed: changes.length,
          becameUnfilled,
          rescueBackfilled,
          unchanged,
          failed,
          changes: changes.slice(0, 40),
        });
      },
    },
  },
});
