// Re-resolve signals that were closed as expired under the old single clock.
//
// The clock used to be 72 hours on the 1H for every market. Measured hold times
// say several markets need far longer, so some of those rows were closed while the
// trade was still alive. This pass replays them under the per-market clock.
//
// The record is append-only: any row whose verdict changes is written to
// signal_corrections with its old value, the new value and the reason, so nothing
// is quietly overwritten. Pass {"dry":true} to see what would change first.
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/hooks/reresolve-expiries")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const expected = process.env.SUPABASE_PUBLISHABLE_KEY;
        if (expected && request.headers.get("apikey") !== expected) {
          return new Response("unauthorized", { status: 401 });
        }
        const body = (await request.json().catch(() => ({}))) as { dry?: boolean; limit?: number };
        const dry = body.dry !== false;
        const limit = Math.min(body.limit ?? 200, 1000);

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { resolveSignal } = await import("@/lib/signal-scores.server");
        const { expiryPolicy } = await import("@/lib/signal-expiry");

        const { data, error } = await supabaseAdmin
          .from("signal_scores")
          .select("id,symbol,timeframe,bias,entry,stop,tp1,status,realized_r,net_r,created_at")
          .eq("status", "expired")
          .eq("source", "engine")
          .order("created_at", { ascending: false })
          .limit(limit);
        if (error) return Response.json({ error: error.message }, { status: 500 });

        const HISTORY_TF: Record<string, string> = {
          "1": "15", "5": "15", "15": "15", "30": "60", "60": "60", "240": "240", D: "D", W: "D",
        };

        const changes: Array<Record<string, unknown>> = [];
        let unchanged = 0;
        let failed = 0;

        for (const row of data ?? []) {
          const tf = HISTORY_TF[String(row.timeframe)] ?? "60";
          const policy = expiryPolicy(String(row.symbol), tf);
          // Rows whose clock did not get longer cannot have been cut short.
          if (policy.basis !== "measured") {
            unchanged += 1;
            continue;
          }
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
          const oldR = row.realized_r === null ? null : Number(row.realized_r);
          const sameStatus = verdict.status === "expired";
          const sameR =
            (verdict.realizedR ?? null) === null && oldR === null
              ? true
              : Math.abs((verdict.realizedR ?? 0) - (oldR ?? 0)) < 0.005;
          if (sameStatus && sameR) {
            unchanged += 1;
            continue;
          }
          const change = {
            id: row.id,
            symbol: row.symbol,
            oldStatus: row.status,
            newStatus: verdict.status,
            oldRealizedR: oldR,
            newRealizedR: verdict.realizedR ?? null,
            clockHours: policy.hours,
          };
          changes.push(change);
          if (dry) continue;

          const reason = `Re-resolved under the measured per-market expiry clock (${policy.hours}h on the ${tf}), replacing the single 72h clock that closed this signal while it was still live.`;
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
              new_value: verdict.realizedR === null || verdict.realizedR === undefined ? null : String(verdict.realizedR),
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
              bars_to_resolve: verdict.barsToResolve ?? null,
              resolved_at: verdict.status === "open" ? null : new Date().toISOString(),
            } as never)
            .eq("id", String(row.id));
        }

        return Response.json({
          dry,
          scanned: (data ?? []).length,
          changed: changes.length,
          unchanged,
          failed,
          changes,
        });
      },
    },
  },
});
