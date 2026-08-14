// Daily check-in: once a day we look at every trade logged the day before and
// nudge the trader to review it — confirm they executed it, add the exit, and
// note what they learned. One notification per user per day.
//
// Called by pg_cron. /api/public/* bypasses published auth, so the Supabase
// publishable key is required in the `apikey` header.

import { createFileRoute } from "@tanstack/react-router";

interface JournalRow {
  user_id: string;
  data: Record<string, unknown> | null;
  trade_date: string | null;
  created_at: string;
}

export const Route = createFileRoute("/api/public/hooks/journal-daily-checkin")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const expected = process.env.SUPABASE_PUBLISHABLE_KEY;
        const provided = request.headers.get("apikey");
        if (expected && provided !== expected) {
          return new Response("unauthorized", { status: 401 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { createNotificationOnce } = await import("@/lib/notifications.server");

        const since = new Date(Date.now() - 40 * 60 * 60 * 1000).toISOString();
        const { data, error } = await supabaseAdmin
          .from("journal_trades")
          .select("user_id, data, trade_date, created_at")
          .gte("created_at", since)
          .limit(1000);

        if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });

        const rows = (data ?? []) as unknown as JournalRow[];

        // Group yesterday's trades per user, tracking what still needs input.
        type Bucket = { total: number; symbols: string[]; unconfirmed: number; open: number };
        const byUser = new Map<string, Bucket>();
        const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

        for (const row of rows) {
          const t = row.data;
          if (!t) continue;
          const day = row.trade_date ?? (typeof t["date"] === "string" ? (t["date"] as string) : null);
          if (day !== yesterday) continue;

          const bucket = byUser.get(row.user_id) ?? { total: 0, symbols: [], unconfirmed: 0, open: 0 };
          bucket.total += 1;
          const symbol = typeof t["symbol"] === "string" ? (t["symbol"] as string) : "";
          if (symbol && !bucket.symbols.includes(symbol)) bucket.symbols.push(symbol);
          if (t["executed"] === undefined || t["executed"] === null) bucket.unconfirmed += 1;
          const result = t["result"];
          if (!result || result === "open") bucket.open += 1;
          byUser.set(row.user_id, bucket);
        }

        let notified = 0;
        for (const [userId, b] of byUser) {
          const symbols = b.symbols.slice(0, 4).join(", ");
          const bits: string[] = [];
          if (b.unconfirmed) bits.push(`${b.unconfirmed} still need${b.unconfirmed === 1 ? "s" : ""} an "did you execute it" answer`);
          if (b.open) bits.push(`${b.open} still open without a result`);
          const body = bits.length
            ? `${bits.join(" and ")}. Open the journal to confirm and close them out.`
            : "Take two minutes to review how they played out and write one takeaway.";

          try {
            const id = await createNotificationOnce(
              `journal-daily-checkin:${userId}:${yesterday}`,
              {
                userId,
                kind: "trade",
                title: `Yesterday you logged ${b.total} trade${b.total === 1 ? "" : "s"}${symbols ? ` (${symbols})` : ""}`,
                body,
                url: "/journal",
                meta: { day: yesterday, total: b.total, unconfirmed: b.unconfirmed, open: b.open },
              },
              20,
            );
            if (id) notified += 1;
          } catch { /* one bad row must not stop the run */ }
        }

        return Response.json({ ok: true, day: yesterday, users: byUser.size, notified });
      },
    },
  },
});
