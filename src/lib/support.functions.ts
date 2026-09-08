import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { SupabaseClient } from "@supabase/supabase-js";

type Ctx = { supabase: SupabaseClient; userId: string };

const SUPPORT_INBOX = "reeddigitalgroup@gmail.com";
const SITE_NAME = "TradeMind";
const SENDER_DOMAIN = "notify.reeddigitalgroup.com";

const SubmitInput = z.object({
  kind: z.enum(["ticket", "feedback"]),
  subject: z.string().trim().min(3).max(140),
  message: z.string().trim().min(10).max(4000),
  replyEmail: z.string().trim().email().max(255),
  sentiment: z.enum(["good", "neutral", "bad"]).optional(),
});

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export const submitSupportRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => SubmitInput.parse(raw))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as Ctx;

    const { data: row, error } = await supabase
      .from("support_tickets")
      .insert({
        user_id: userId,
        kind: data.kind,
        subject: data.subject,
        message: data.message,
        reply_email: data.replyEmail,
        sentiment: data.sentiment ?? null,
      })
      .select("id, created_at")
      .single();
    if (error) throw new Error(error.message);

    const ticket = row as { id: string; created_at: string };
    const label = data.kind === "ticket" ? "Support ticket" : "Feedback";
    const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:15px;color:#111">
<p style="margin:0 0 16px"><strong>${label}</strong> from ${escapeHtml(data.replyEmail)}</p>
${data.sentiment ? `<p style="margin:0 0 8px"><strong>Rating:</strong> ${data.sentiment}</p>` : ""}
<p style="margin:0 0 8px"><strong>Subject:</strong> ${escapeHtml(data.subject)}</p>
<p style="margin:0 0 16px;white-space:pre-wrap">${escapeHtml(data.message)}</p>
<hr style="border:none;border-top:1px solid #e5e5e5;margin:16px 0" />
<p style="margin:0;color:#666;font-size:13px">Ticket ${ticket.id}<br/>User ${userId}<br/>Submitted ${ticket.created_at}</p>
</div>`;
    const text = `${label} from ${data.replyEmail}\n\nSubject: ${data.subject}\n\n${data.message}\n\nTicket ${ticket.id}\nUser ${userId}\nSubmitted ${ticket.created_at}`;

    // The ticket row is already saved above, so a mail hiccup never loses the
    // submission — the notification is best effort.
    let emailQueued = false;
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { sendRawEmail, logEmailSend } = await import("@/lib/email-raw.server");
      const templateName = `support_${data.kind}`;
      try {
        const result = await sendRawEmail({
          to: SUPPORT_INBOX,
          subject: `${SITE_NAME} ${label}: ${data.subject}`,
          html,
          text,
          label: templateName,
          idempotencyKey: `support:${ticket.id}`,
          replyTo: data.replyEmail,
        });
        await logEmailSend(supabaseAdmin as never, {
          template_name: templateName,
          recipient_email: SUPPORT_INBOX,
          status: result.sent ? "sent" : "suppressed",
        });
        emailQueued = result.sent;
      } catch (e) {
        const message = (e as Error).message;
        await logEmailSend(supabaseAdmin as never, {
          template_name: templateName,
          recipient_email: SUPPORT_INBOX,
          status: "failed",
          error_message: message.slice(0, 1000),
        });
        throw e;
      }
    } catch (e) {
      console.error("[support] email send failed", (e as Error).message);
    }

    return { id: ticket.id, emailQueued };
  });

export const listMySupportRequests = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as Ctx;
    const { data, error } = await supabase
      .from("support_tickets")
      .select("id, kind, subject, message, status, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(25);
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as Array<{
      id: string; kind: string; subject: string; message: string; status: string; created_at: string;
    }>;
  });

export const adminListSupportRequests = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as Ctx;
    const { data: roleRow, error: roleErr } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .eq("role", "admin")
      .maybeSingle();
    if (roleErr) throw new Error(roleErr.message);
    if (!roleRow) throw new Error("Forbidden");

    const { data, error } = await supabase
      .from("support_tickets")
      .select("id, kind, subject, message, reply_email, status, sentiment, created_at")
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as Array<{
      id: string; kind: string; subject: string; message: string;
      reply_email: string; status: string; sentiment: string | null; created_at: string;
    }>;
  });
