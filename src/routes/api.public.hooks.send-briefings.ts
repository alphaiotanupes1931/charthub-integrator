// Cron endpoint: send morning/evening briefings for any user whose local
// hour matches their preference and hasn't received today's yet.
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/hooks/send-briefings")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const expected = process.env.SUPABASE_PUBLISHABLE_KEY;
        const provided = request.headers.get("apikey");
        if (expected && provided !== expected) {
          return new Response("unauthorized", { status: 401 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { buildBriefingBody, sendTelegramMessage, sendDiscordWebhook, sendDiscordShared, currentHourInTZ } = await import("@/lib/briefings.server");

        const { data: prefs } = await supabaseAdmin.from("briefing_prefs").select("*");
        if (!prefs?.length) return Response.json({ ok: true, sent: 0 });

        const now = new Date();
        const today = now.toISOString().slice(0, 10);
        let sent = 0;

        for (const p of prefs as any[]) {
          const hour = currentHourInTZ(p.timezone || "UTC");
          const wantsMorning = p.morning_enabled && hour === p.morning_hour;
          const wantsEvening = p.evening_enabled && hour === p.evening_hour;
          if (!wantsMorning && !wantsEvening) continue;

          const kind: "morning" | "evening" = wantsMorning ? "morning" : "evening";
          const lastAt = kind === "morning" ? p.last_morning_at : p.last_evening_at;
          if (lastAt && String(lastAt).slice(0, 10) === today) continue;

          const { data: acct } = await supabaseAdmin
            .from("paper_accounts")
            .select("balance,peak_equity,status,testing_mode")
            .eq("user_id", p.user_id)
            .maybeSingle();
          const paperSummary = acct?.testing_mode
            ? `Balance $${Number(acct.balance).toFixed(2)} · Peak $${Number(acct.peak_equity).toFixed(2)} · Status ${acct.status}`
            : null;
          const { title, body } = await buildBriefingBody(kind, p.watchlist ?? [], paperSummary);
          const msg = `${title}\n\n${body}`;
          let delivered_telegram = false;
          let delivered_discord = false;
          if (p.telegram_chat_id) {
            const r = await sendTelegramMessage(p.telegram_chat_id, msg);
            delivered_telegram = r.ok;
          }
          if (p.discord_webhook_url) {
            const r = await sendDiscordWebhook(p.discord_webhook_url, `**${title}**\n${body}`);
            delivered_discord = r.ok;
          }
          await (supabaseAdmin.from("briefings") as any).insert({
            user_id: p.user_id,
            kind,
            title,
            body,
            delivered_telegram,
            delivered_discord,
          });
          await supabaseAdmin.from("briefing_prefs").update({
            ...(kind === "morning" ? { last_morning_at: now.toISOString() } : { last_evening_at: now.toISOString() }),
          }).eq("user_id", p.user_id);
          sent += 1;
        }

        // One shared community fan-out per run (best-effort, deduped by run).
        if (sent > 0) {
          await sendDiscordShared(`Briefings dispatched for ${sent} trader${sent === 1 ? "" : "s"} at ${now.toISOString()}.`).catch(() => undefined);
        }

        return Response.json({ ok: true, sent });
      },
    },
  },
});
