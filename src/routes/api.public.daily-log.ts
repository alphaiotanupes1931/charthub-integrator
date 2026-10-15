// Private, read-only daily trading log for an outside reviewer (e.g. Claude).
// GET /api/public/daily-log?day=YYYY-MM-DD   Authorization: Bearer tmsig_...
// The key is one of the trader's own keys from the Connections page; it only
// ever returns that trader's scans.
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/daily-log")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = request.headers.get("authorization") ?? "";
        const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
        if (!token.startsWith("tmsig_")) return Response.json({ error: "missing key" }, { status: 401 });

        const url = new URL(request.url);
        const day = url.searchParams.get("day") ?? new Date().toISOString().slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return Response.json({ error: "day must be YYYY-MM-DD" }, { status: 400 });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: keyRow } = await supabaseAdmin
          .from("signal_inbound_keys")
          .select("user_id")
          .eq("token", token)
          .is("revoked_at", null)
          .maybeSingle();
        if (!keyRow) return Response.json({ error: "key not recognised" }, { status: 401 });

        const start = new Date(`${day}T00:00:00Z`);
        const end = new Date(start.getTime() + 86_400_000);
        const { data: rows, error } = await supabaseAdmin
          .from("scan_log")
          .select("created_at, source, symbol, timeframe, data_feed, ref_price, bias, grade, confidence, entry, stop, tp1, tp2, rr, reason, counter_trend, htf_bias, refused_reason, grade_caps, status, realized_r, mae_r, mfe_r, resolved_at, taken")
          .eq("user_id", (keyRow as { user_id: string }).user_id)
          .gte("created_at", start.toISOString())
          .lt("created_at", end.toISOString())
          .order("created_at", { ascending: true })
          .limit(1000);
        if (error) return Response.json({ error: "could not read log" }, { status: 500 });

        const num = (v: unknown) => (v == null ? null : Number(v));
        const scans = (rows ?? []).map((r) => ({
          ...r,
          ref_price: num(r.ref_price), confidence: num(r.confidence), entry: num(r.entry), stop: num(r.stop),
          tp1: num(r.tp1), tp2: num(r.tp2), realized_r: num(r.realized_r), mae_r: num(r.mae_r), mfe_r: num(r.mfe_r),
        }));
        const { summarizeDay } = await import("@/lib/scan-log.shared");
        return Response.json(
          { day, timezone: "UTC", summary: summarizeDay(scans), scans },
          { headers: { "Cache-Control": "no-store" } },
        );
      },
    },
  },
});
