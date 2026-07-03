// Cron endpoint: scans active price alerts, checks the latest price for each
// symbol, fires an in-app notification when the target is crossed, and either
// deactivates or deletes the alert depending on user preference.
//
// Called by pg_cron every minute. No auth: prefix is /api/public/* which
// bypasses published auth. Requires the Supabase anon key in the `apikey`
// header for parity with the schedule-jobs convention.

import { createFileRoute } from "@tanstack/react-router";
import { getSpotPrice } from "@/lib/quote.server";

interface AlertRow {
  id: string;
  user_id: string;
  symbol: string;
  side: "above" | "below";
  price: number;
  auto_delete: boolean;
  note: string | null;
}

export const Route = createFileRoute("/api/public/hooks/price-alerts-tick")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const expected = process.env.SUPABASE_PUBLISHABLE_KEY;
        const provided = request.headers.get("apikey");
        if (expected && provided !== expected) {
          return new Response("unauthorized", { status: 401 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { createNotification } = await import("@/lib/notifications.server");

        const { data: alerts, error } = await supabaseAdmin
          .from("price_alerts")
          .select("id, user_id, symbol, side, price, auto_delete, note")
          .eq("active", true)
          .is("triggered_at", null)
          .limit(500);

        if (error) {
          return Response.json({ ok: false, error: error.message }, { status: 500 });
        }

        const rows = (alerts ?? []) as unknown as AlertRow[];
        if (rows.length === 0) return Response.json({ ok: true, scanned: 0, fired: 0 });

        // Group by symbol so we hit the price provider once per symbol.
        const symbols = Array.from(new Set(rows.map((r) => r.symbol)));
        const prices: Record<string, number | null> = {};
        await Promise.all(
          symbols.map(async (sym) => {
            try {
              prices[sym] = await getSpotPrice(sym);
            } catch {
              prices[sym] = null;
            }
          }),
        );

        let fired = 0;
        const now = new Date().toISOString();

        for (const row of rows) {
          const p = prices[row.symbol];
          if (p == null) continue;

          const crossed = row.side === "above" ? p >= Number(row.price) : p <= Number(row.price);

          if (!crossed) {
            await supabaseAdmin
              .from("price_alerts")
              .update({ last_checked_price: p, last_checked_at: now })
              .eq("id", row.id);
            continue;
          }

          // Fire notification.
          try {
            await createNotification({
              userId: row.user_id,
              kind: "price",
              title: `${row.symbol} ${row.side === "above" ? "≥" : "≤"} ${row.price}`,
              body: `Price hit ${p.toFixed(5)}${row.note ? ` — ${row.note}` : ""}`,
              url: "/alerts",
              meta: { symbol: row.symbol, price: p, target: row.price, side: row.side },
            });
          } catch (e) {
            console.error("notify failed", e);
          }

          if (row.auto_delete) {
            await supabaseAdmin.from("price_alerts").delete().eq("id", row.id);
          } else {
            await supabaseAdmin
              .from("price_alerts")
              .update({ active: false, triggered_at: now, last_checked_price: p, last_checked_at: now })
              .eq("id", row.id);
          }
          fired += 1;
        }

        return Response.json({ ok: true, scanned: rows.length, fired });
      },
    },
  },
});
