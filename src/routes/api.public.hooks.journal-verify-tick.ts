// Cron endpoint: every 15 minutes we walk every journal trade that is still
// unresolved, check it against real price history, write the outcome back onto
// the trade row, and notify the owner when it finally hits.
//
// The user never has to open TradingView to find out what happened.
//
// Called by pg_cron. No session auth: /api/public/* bypasses published auth,
// so the Supabase publishable key is required in the `apikey` header.

import { createFileRoute } from "@tanstack/react-router";

interface JournalRow {
  id: string;
  user_id: string;
  data: Record<string, unknown> | null;
}

type Outcome = "tp" | "stop" | "breakeven" | "partial" | "open";

const RESULT_TITLE: Record<Exclude<Outcome, "open">, string> = {
  tp: "Take profit hit",
  stop: "Stop loss hit",
  breakeven: "Closed at breakeven",
  partial: "Closed part way",
};

function num(v: unknown): number | null {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : null;
}

export const Route = createFileRoute("/api/public/hooks/journal-verify-tick")({
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
        const { verifyTrade } = await import("@/lib/trade-verify.server");

        const { data, error } = await supabaseAdmin
          .from("journal_trades")
          .select("id, user_id, data")
          .order("updated_at", { ascending: false })
          .limit(600);

        if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });

        const rows = (data ?? []) as unknown as JournalRow[];
        let checked = 0;
        let resolved = 0;

        for (const row of rows) {
          const t = row.data;
          if (!t) continue;

          // Manual calls are the trader's word: never overwrite them.
          if (t["resultSource"] === "manual") continue;
          const current = t["result"] as Outcome | undefined;
          if (current && current !== "open") continue;

          const entry = num(t["entry"]);
          const stop = num(t["stop"]);
          const symbol = typeof t["symbol"] === "string" ? t["symbol"] : "";
          const timeframe = typeof t["timeframe"] === "string" ? t["timeframe"] : "1H";
          const side = t["side"] === "Short" ? "Short" : "Long";
          if (!symbol || entry == null || stop == null || entry === stop) continue;

          const since = num(t["createdAt"]);
          if (!since) continue;

          // Don't re-hammer a trade we just looked at.
          const last = num(t["resultCheckedAt"]) ?? 0;
          if (Date.now() - last < 10 * 60_000) continue;

          let res: Awaited<ReturnType<typeof verifyTrade>>;
          try {
            res = await verifyTrade({
              symbol,
              timeframe,
              side,
              entry,
              stop,
              takeProfit: num(t["takeProfit"]),
              since,
            });
          } catch {
            continue;
          }
          checked += 1;

          // Write the price the trade actually resolved at. Without it the row
          // keeps its exit equal to the entry, so the journal and the calendar
          // still read 0.00 even though the stop or target printed.
          const settled = res.status !== "open";
          const tp = num(t["takeProfit"]);
          const dir = side === "Short" ? -1 : 1;
          // Fall back to the level that resolved the trade (or the measured R)
          // when the provider gives no fill price, otherwise exit stays equal to
          // entry and the journal keeps reading 0.00 on a closed trade.
          let derived: number | null = null;
          if (settled) {
            if (res.status === "tp" && tp != null) derived = tp;
            else if (res.status === "stop") derived = stop;
            else if (res.r != null && Number.isFinite(res.r)) derived = entry + dir * res.r * Math.abs(entry - stop);
          }
          const exit = settled
            ? (res.price != null && Number.isFinite(res.price) ? res.price : derived ?? num(t["exit"]))
            : num(t["exit"]);

          const next = {
            ...t,
            exit,
            result: res.status,
            resultSource: "auto",
            resultR: res.r,
            resultNote: res.note,
            resultCheckedAt: Date.now(),
          };

          await supabaseAdmin
            .from("journal_trades")
            .update({ data: next as never, updated_at: new Date().toISOString() })
            .eq("id", row.id)
            .eq("user_id", row.user_id);

          if (res.status === "open") continue;
          resolved += 1;

          const rTxt = res.r == null ? "" : ` (${res.r > 0 ? "+" : ""}${res.r}R)`;
          try {
            await createNotificationOnce(
              `journal-result:${row.id}:${res.status}`,
              {
                userId: row.user_id,
                kind: "trade",
                title: `${symbol} ${side} — ${RESULT_TITLE[res.status]}${rTxt}`,
                body: res.note,
                url: "/journal",
                meta: { tradeId: row.id, symbol, side, result: res.status, r: res.r ?? null },
              },
            );
          } catch { /* notification failure must not stop the sweep */ }
        }

        return Response.json({ ok: true, scanned: rows.length, checked, resolved });
      },
    },
  },
});
