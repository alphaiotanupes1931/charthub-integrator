// Cron endpoint (hourly). 8 AM New York: morning picks email. 6 PM New York:
// "scanner wins" recap of setups that hit target today. One of each per user per day,
// each user can switch either off in Settings.
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/hooks/retention-emails")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const expected = process.env.SUPABASE_PUBLISHABLE_KEY;
        if (!expected || request.headers.get("apikey") !== expected) {
          return new Response("unauthorized", { status: 401 });
        }
        const R = await import("@/lib/retention-emails.shared");
        const { tradingDay } = await import("@/lib/daily-profit.shared");
        const url = new URL(request.url);
        const now = new Date();
        const forced = url.searchParams.get("kind") as "morning_brief" | "scanner_wins" | null;
        const kind = forced ?? R.retentionKindAt(now);
        if (!kind) return Response.json({ ok: true, skipped: "outside window" });
        if (!forced && R.isQuietDay(now)) return Response.json({ ok: true, skipped: "weekend" });
        const onlyEmail = url.searchParams.get("to");

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { sendTemplateEmail } = await import("@/lib/email-templates/send-email");
        const day = tradingDay(now);
        const dateLabel = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "long", month: "short", day: "numeric" }).format(now);
        const dir = (b: string) => (/(short|sell|bear)/i.test(b) ? "Short" : "Long");
        const fmt = (n: number | null) => (n == null ? "-" : String(Number(n.toPrecision(6))));

        let payload: Record<string, unknown>;
        if (kind === "morning_brief") {
          const since = new Date(now.getTime() - R.MORNING_LOOKBACK_HOURS * 3600_000).toISOString();
          const { data } = await supabaseAdmin.from("signal_feed")
            .select("symbol, grade, bias, entry, stop, tp1, confidence, created_at")
            .gte("created_at", since).order("created_at", { ascending: false }).limit(200);
          const picks = R.pickMorningSetups((data ?? []) as R.SetupRow[], now);
          if (!picks.length) return Response.json({ ok: true, kind, sent: 0, skipped: "no setups" });
          payload = { dateLabel, picks: picks.map((p) => ({ symbol: p.symbol, grade: p.grade, direction: dir(p.bias), entry: fmt(p.entry), stop: fmt(p.stop), target: fmt(p.tp1) })) };
        } else {
          const since = new Date(now.getTime() - 30 * 3600_000).toISOString();
          const { data } = await supabaseAdmin.from("signal_scores")
            .select("symbol, bias, grade, status, realized_r, resolved_at")
            .eq("status", "target").gte("resolved_at", since).limit(500);
          const wins = R.scannerWinsForDay((data ?? []) as R.ResolvedRow[], day);
          if (!R.shouldSendWins(wins)) return Response.json({ ok: true, kind, sent: 0, skipped: "no wins" });
          payload = { dateLabel, wins: wins.slice(0, 6).map((w) => ({ symbol: w.symbol, direction: dir(w.bias), grade: w.grade ?? undefined, r: w.r.toFixed(1) })) };
        }

        const prefCol = kind === "morning_brief" ? "morning_brief_email" : "scanner_wins_email";
        const { data: profiles } = await supabaseAdmin.from("profiles")
          .select(`id, email, display_name, banned, ${prefCol}` as never).eq("onboarded", true);
        const { data: done } = await supabaseAdmin.from("retention_emails" as never)
          .select("user_id").eq("kind", kind).eq("trading_day", day);
        const already = new Set(((done ?? []) as Array<{ user_id: string }>).map((r) => r.user_id));

        let sent = 0;
        for (const p of (profiles ?? []) as Array<Record<string, any>>) {
          if (!p.email || p.banned || p[prefCol] === false || already.has(p.id)) continue;
          if (onlyEmail && p.email !== onlyEmail) continue;
          try {
            const r = await sendTemplateEmail(kind === "morning_brief" ? "morning-brief" : "scanner-wins", p.email, {
              idempotencyKey: `${kind}-${p.id}-${day}`,
              templateData: { ...payload, name: p.display_name?.split(" ")[0] ?? undefined },
            });
            await supabaseAdmin.from("retention_emails" as never).insert({ user_id: p.id, kind, trading_day: day } as never);
            if ((r as { sent?: boolean })?.sent !== false) sent += 1;
          } catch (e) {
            console.error("[retention-emails] failed", p.id, (e as Error).message);
          }
        }
        return Response.json({ ok: true, kind, day, sent });
      },
    },
  },
});
