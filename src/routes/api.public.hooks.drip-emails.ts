// Cron endpoint: advance the free-plan drip sequence for captured emails.
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/hooks/drip-emails")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const expected = process.env.SUPABASE_PUBLISHABLE_KEY;
        const provided = request.headers.get("apikey");
        if (expected && provided !== expected) {
          return new Response("unauthorized", { status: 401 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { dripEmail, unsubscribeUrlFor, STAGE_DELAY_DAYS, SITE_NAME, SENDER_DOMAIN } =
          await import("@/lib/lead-drip.server");

        const nowIso = new Date().toISOString();
        const { data: leads } = await supabaseAdmin
          .from("marketing_leads")
          .select("id, email, drip_stage, user_id")
          .is("unsubscribed_at", null)
          .lt("drip_stage", STAGE_DELAY_DAYS.length)
          .lte("next_send_at", nowIso)
          .order("next_send_at", { ascending: true })
          .limit(100);

        if (!leads?.length) return Response.json({ ok: true, sent: 0 });

        let sent = 0;
        for (const lead of leads as Array<{
          id: string;
          email: string;
          drip_stage: number;
          user_id: string | null;
        }>) {
          const stage = lead.drip_stage as 0 | 1 | 2;

          // Never pitch the upgrade to someone who already pays.
          if (stage === 2 && lead.user_id) {
            const { data: sub } = await supabaseAdmin
              .from("subscriptions")
              .select("status")
              .eq("user_id", lead.user_id)
              .maybeSingle();
            if (sub && ["active", "trialing", "past_due"].includes(String(sub.status))) {
              await supabaseAdmin
                .from("marketing_leads")
                .update({ drip_stage: STAGE_DELAY_DAYS.length })
                .eq("id", lead.id);
              continue;
            }
          }

          const token = crypto.randomUUID();
          await supabaseAdmin
            .from("email_unsubscribe_tokens")
            .insert({ token, email: lead.email });

          const mail = dripEmail(stage, unsubscribeUrlFor(token));
          const messageId = crypto.randomUUID();

          try {
            await supabaseAdmin.from("email_send_log").insert({
              message_id: messageId,
              template_name: mail.label,
              recipient_email: lead.email,
              status: "pending",
            });
            const { error: qErr } = await supabaseAdmin.rpc("enqueue_email" as never, {
              queue_name: "transactional_emails",
              payload: {
                message_id: messageId,
                to: lead.email,
                from: `${SITE_NAME} <noreply@${SENDER_DOMAIN}>`,
                sender_domain: SENDER_DOMAIN,
                subject: mail.subject,
                html: mail.html,
                text: mail.text,
                purpose: "marketing",
                idempotency_key: `drip:${lead.id}:${stage}`,
                unsubscribe_token: token,
                label: mail.label,
                queued_at: new Date().toISOString(),
              },
            } as never);
            if (qErr) throw new Error(qErr.message);
          } catch (e) {
            console.error("[drip] enqueue failed", lead.id, (e as Error).message);
            continue;
          }

          const nextStage = stage + 1;
          const waitDays = STAGE_DELAY_DAYS[nextStage] ?? 0;
          await supabaseAdmin
            .from("marketing_leads")
            .update({
              drip_stage: nextStage,
              last_sent_at: new Date().toISOString(),
              next_send_at: new Date(Date.now() + waitDays * 86_400_000).toISOString(),
            })
            .eq("id", lead.id);
          sent += 1;
        }

        return Response.json({ ok: true, sent });
      },
    },
  },
});
