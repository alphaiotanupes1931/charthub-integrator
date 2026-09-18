/**
 * Inbound signal endpoint.
 *
 * An outside tool posts a signal here and it is filed, sealed and later resolved
 * against real closed bars on exactly the same terms as our own scans. The caller
 * is verified by an inbound key, and the filed row is tagged with a non-engine
 * source so third-party signals never appear inside the published track record.
 *
 * POST /api/public/signals/file
 *   Authorization: Bearer tmsig_...
 *   { "symbol": "XAUUSD", "timeframe": "60", "bias": "long",
 *     "entry": 2350.5, "stop": 2344.2, "tp1": 2365,
 *     "grade": "ext", "label": "my-tv-alert" }
 */
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const Body = z.object({
  symbol: z.string().min(1).max(24),
  timeframe: z.string().min(1).max(4),
  bias: z
    .string()
    .transform((v) => v.trim().toLowerCase())
    .pipe(z.enum(["long", "short"]))
    .transform((v) => (v === "long" ? "Long" : "Short")),
  entry: z.number().finite(),
  stop: z.number().finite(),
  tp1: z.number().finite(),
  grade: z.string().min(1).max(8).default("ext"),
  confidence: z.number().min(0).max(100).nullable().optional(),
  label: z.string().max(64).optional(),
});

export const Route = createFileRoute("/api/public/signals/file")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = request.headers.get("authorization") ?? "";
        const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
        if (!token.startsWith("tmsig_")) {
          return Response.json({ error: "missing or malformed inbound key" }, { status: 401 });
        }

        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return Response.json({ error: "body must be JSON" }, { status: 400 });
        }
        const parsed = Body.safeParse(body);
        if (!parsed.success) {
          return Response.json({ error: "invalid signal", details: parsed.error.flatten() }, { status: 400 });
        }
        const data = parsed.data;

        const risk = Math.abs(data.entry - data.stop);
        if (!risk) return Response.json({ error: "entry and stop cannot be equal" }, { status: 400 });
        // A signal whose target sits on the wrong side of entry cannot be scored.
        const targetAhead = data.bias === "Long" ? data.tp1 > data.entry : data.tp1 < data.entry;
        const stopBehind = data.bias === "Long" ? data.stop < data.entry : data.stop > data.entry;
        if (!targetAhead || !stopBehind) {
          return Response.json({ error: "stop and target must sit on the correct sides of entry" }, { status: 400 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: keyRow } = await supabaseAdmin
          .from("signal_inbound_keys")
          .select("id,user_id,source,revoked_at")
          .eq("token", token)
          .is("revoked_at", null)
          .maybeSingle();
        if (!keyRow) return Response.json({ error: "inbound key not recognised" }, { status: 401 });

        const createdAt = new Date().toISOString();
        const { signalFingerprint } = await import("@/lib/signal-integrity.server");
        const filedHash = signalFingerprint({ ...data, createdAt });
        const plannedR = Math.round((Math.abs(data.tp1 - data.entry) / risk) * 100) / 100;

        const source = data.label
          ? `${String((keyRow as { source: string }).source)}:${data.label.replace(/[^\w.-]/g, "").slice(0, 40)}`
          : String((keyRow as { source: string }).source);

        const { data: inserted, error } = await supabaseAdmin
          .from("signal_scores")
          .insert({
            user_id: (keyRow as { user_id: string }).user_id,
            symbol: data.symbol,
            timeframe: data.timeframe,
            grade: data.grade,
            bias: data.bias,
            confidence: data.confidence ?? null,
            entry: data.entry,
            stop: data.stop,
            tp1: data.tp1,
            planned_r: plannedR,
            created_at: createdAt,
            filed_hash: filedHash,
            source,
          } as never)
          .select("id")
          .single();
        if (error) return Response.json({ error: error.message }, { status: 500 });

        await supabaseAdmin
          .from("signal_inbound_keys")
          .update({ last_used_at: createdAt } as never)
          .eq("id", (keyRow as { id: string }).id);

        return Response.json({
          ok: true,
          id: (inserted as { id: string }).id,
          filedAt: createdAt,
          plannedR,
          seal: filedHash.slice(0, 12),
          note: "Filed and sealed. It will be resolved against real closed bars, and is excluded from the published track record because it did not come from the engine.",
        });
      },
    },
  },
});
