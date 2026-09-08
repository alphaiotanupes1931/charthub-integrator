// Server-only: sends an email whose subject and HTML are composed by the
// feature itself (drip stages, support forwards, platform status notices).
// Mirrors the request shape of the template helper in
// src/lib/email-templates/send-email.ts — delivery, retries, suppression and
// the unsubscribe footer are handled by Lovable's managed email API.
import { EmailAPIError, sendLovableEmail } from "@lovable.dev/email-js";

export const SITE_NAME = "TradeMind";
export const SENDER_DOMAIN = "notify.reeddigitalgroup.com";
const FROM_DOMAIN = "notify.reeddigitalgroup.com";

export type RawEmailResult =
  | { sent: true }
  | { sent: false; reason: "recipient_suppressed" };

export async function sendRawEmail(input: {
  to: string;
  subject: string;
  html: string;
  text: string;
  label: string;
  idempotencyKey: string;
  replyTo?: string;
}): Promise<RawEmailResult> {
  const apiKey = process.env["LOVABLE_API_KEY"];
  if (!apiKey) throw new Error("LOVABLE_API_KEY is not configured");

  try {
    await sendLovableEmail(
      {
        to: input.to,
        from: `${SITE_NAME} <noreply@${FROM_DOMAIN}>`,
        sender_domain: SENDER_DOMAIN,
        subject: input.subject,
        html: input.html,
        text: input.text,
        purpose: "transactional",
        label: input.label,
        idempotency_key: input.idempotencyKey,
        reply_to: input.replyTo,
      },
      { apiKey, sendUrl: process.env["LOVABLE_SEND_URL"] },
    );
  } catch (error) {
    if (error instanceof EmailAPIError && error.code === "recipient_suppressed") {
      return { sent: false, reason: "recipient_suppressed" };
    }
    throw error;
  }
  return { sent: true };
}

/** Appends one row to the send history. Never decides the send result. */
export async function logEmailSend(
  admin: { from: (t: string) => any },
  row: {
    template_name: string;
    recipient_email: string;
    status: "sent" | "suppressed" | "failed";
    error_message?: string;
  },
): Promise<void> {
  const { error } = await admin.from("email_send_log").insert({
    message_id: null,
    template_name: row.template_name,
    recipient_email: row.recipient_email,
    status: row.status,
    error_message: row.error_message ?? null,
  });
  if (error) console.error("[email] send log write failed", error.code, error.message);
}
