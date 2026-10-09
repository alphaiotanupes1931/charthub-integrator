// Cron endpoint (hourly): at 5 PM New York, email each trader whose broker
// shows a net-positive realized P&L for the day. One email per user per day.
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/hooks/daily-profit-email")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const expected = process.env.SUPABASE_PUBLISHABLE_KEY;
        if (!expected || request.headers.get("apikey") !== expected) {
          return new Response("unauthorized", { status: 401 });
        }
        const { isSendWindow, tradingDay, summarizeDay, shouldSendProfitEmail } = await import("@/lib/daily-profit.shared");
        const now = new Date();
        const force = new URL(request.url).searchParams.get("force") === "1";
        if (!isSendWindow(now) && !force) return Response.json({ ok: true, skipped: "outside window" });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { buildBrokerSnapshots } = await import("@/lib/broker-readonly.server");
        const { sendTemplateEmail } = await import("@/lib/email-templates/send-email");
        const day = tradingDay(now);
        const dateLabel = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "long", month: "short", day: "numeric" }).format(now);

        const { data: creds } = await supabaseAdmin.from("user_broker_credentials").select("user_id");
        const userIds = [...new Set(((creds ?? []) as Array<{ user_id: string }>).map((r) => r.user_id))];
        const { data: done } = await supabaseAdmin.from("daily_profit_emails" as never).select("user_id").eq("trading_day", day);
        const already = new Set(((done ?? []) as Array<{ user_id: string }>).map((r) => r.user_id));

        let sent = 0;
        for (const userId of userIds) {
          if (already.has(userId)) continue;
          try {
            const { data: profile } = await supabaseAdmin
              .from("profiles")
              .select("display_name, daily_profit_email" as never)
              .eq("id", userId)
              .maybeSingle();
            const p = profile as { display_name?: string | null; daily_profit_email?: boolean } | null;
            if (p && p.daily_profit_email === false) continue;

            const snap = await buildBrokerSnapshots(userId);
            if (!snap.connected) continue;
            const closes = snap.snapshots.flatMap((s) => s.recentCloses);
            const summary = summarizeDay(closes, day);
            if (!shouldSendProfitEmail(summary)) continue;

            const currency = snap.snapshots[0]?.currency ?? "USD";
            const fmt = (v: number) => new Intl.NumberFormat("en-US", { style: "currency", currency }).format(v);
            const balance = snap.snapshots.reduce((s, x) => s + (x.balance ?? 0), 0);

            const { data: u } = await supabaseAdmin.auth.admin.getUserById(userId);
            const email = u?.user?.email;
            if (!email) continue;

            await sendTemplateEmail("daily-profit", email, {
              idempotencyKey: `daily-profit-${userId}-${day}`,
              templateData: {
                name: p?.display_name?.split(" ")[0] ?? undefined,
                pnl: fmt(summary.pnl),
                dateLabel,
                trades: summary.trades,
                wins: summary.wins,
                bestSymbol: summary.best?.symbol,
                bestPnl: summary.best ? fmt(summary.best.pnl) : undefined,
                balance: balance ? fmt(balance) : undefined,
              },
            });
            await supabaseAdmin
              .from("daily_profit_emails" as never)
              .insert({ user_id: userId, trading_day: day, pnl: summary.pnl, currency } as never);
            sent += 1;
          } catch (e) {
            console.error("[daily-profit] failed", userId, (e as Error).message);
          }
        }
        return Response.json({ ok: true, day, sent });
      },
    },
  },
});
