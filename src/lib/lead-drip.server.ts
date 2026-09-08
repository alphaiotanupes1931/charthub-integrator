// Server-only: the free-plan drip sequence. Three short emails, plain HTML so
// they render the same everywhere. The unsubscribe footer is appended by the
// email platform, so the copy here never adds one.
import { SITE_NAME, sendRawEmail, logEmailSend } from "./email-raw.server";

export { SITE_NAME };
export const SENDER_DOMAIN = "notify.reeddigitalgroup.com";
const SITE_URL = "https://www.trademindaicoach.com";

/** Days to wait before each stage, measured from the previous send. */
export const STAGE_DELAY_DAYS = [0, 2, 4];

export type DripStage = 0 | 1 | 2;

function shell(body: string): string {
  return `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#111;max-width:560px">
${body}
</div>`;
}

function button(label: string, href: string): string {
  return `<p style="margin:24px 0"><a href="${href}" style="background:#111;color:#fff;text-decoration:none;padding:12px 20px;border-radius:999px;font-weight:600;display:inline-block">${label}</a></p>`;
}

/** TradeMind-branded opt-out footer, so the link points at our own page. */
function footer(unsubUrl: string | null): string {
  if (!unsubUrl) return "";
  return `<hr style="border:none;border-top:1px solid #e5e5e5;margin:32px 0 16px" />
<p style="margin:0 0 6px;font-size:13px;line-height:1.6;color:#111"><a href="${unsubUrl}" style="color:#111;font-weight:700">Unsubscribe from ${SITE_NAME} emails</a></p>
<p style="margin:0;font-size:12px;line-height:1.6;color:#666">You are receiving this because you asked for free ${SITE_NAME} access. Account and security emails still come through. Any other opt-out link below is added automatically by our email provider.</p>`;
}

function footerText(unsubUrl: string | null): string {
  return unsubUrl ? `\n\nUnsubscribe from ${SITE_NAME} marketing emails: ${unsubUrl}` : "";
}

export function dripEmail(stage: DripStage, unsubUrl: string | null = null): {
  subject: string;
  html: string;
  text: string;
  label: string;
} {
  if (stage === 0) {
    const text = `Your free ${SITE_NAME} access is ready. You get 2 signal grades every day, and the journal, risk calculator, alerts and Academy basics stay free. Open the dashboard, pick an instrument and run a scan: ${SITE_URL}/dashboard`;
    return {
      subject: `Your free ${SITE_NAME} access is ready`,
      label: "drip_welcome",
      text: text + footerText(unsubUrl),
      html: shell(
        `<h1 style="font-size:22px;margin:0 0 16px">Grade your next trade</h1>
<p style="margin:0 0 12px">You have 2 signal grades every day on the free plan, and they reset at midnight in your own time zone.</p>
<p style="margin:0 0 12px">The journal, risk calculator, price alerts and Academy basics are free for good.</p>
<p style="margin:0 0 12px">Pick an instrument, run a scan, and read the grade before you take the trade.</p>
${button("Run your first scan", `${SITE_URL}/dashboard`)}
${footer(unsubUrl)}`,
      ),

    };
  }
  if (stage === 1) {
    const text = `What the grade means: A and A+ setups are the ones where the 4H, 1H and 15m structure agree, the stop sits behind real structure and the reward is at least 2 to 1. Everything else is graded down on purpose. Check the live hit rate by grade: ${SITE_URL}/signals`;
    return {
      subject: `What an A grade actually means`,
      label: "drip_grade",
      text: text + footerText(unsubUrl),
      html: shell(
        `<h1 style="font-size:22px;margin:0 0 16px">Why most setups are not an A</h1>
<p style="margin:0 0 12px">The grade is computed in code, not written by a chatbot. A and A+ need the 4H, 1H and 15m structure to agree, a stop behind real structure, and at least 2 to 1 reward.</p>
<p style="margin:0 0 12px">Anything less gets graded down, which is the point: the low grades are the trades that were costing you money.</p>
${button("See hit rate by grade", `${SITE_URL}/signals`)}
${footer(unsubUrl)}`,
      ),

    };
  }
  const text = `Ready for unlimited grades? Paid plans start at $49 a month and the first 7 days are free when you add a card. You keep the journal and Academy either way. See plans: ${SITE_URL}/pricing`;
  return {
    subject: `Unlimited grades, 7 days free`,
    label: "drip_upgrade",
    text: text + footerText(unsubUrl),
    html: shell(
      `<h1 style="font-size:22px;margin:0 0 16px">Two grades a day is a taste</h1>
<p style="margin:0 0 12px">If you are scanning more than twice a day, the paid plan removes the cap and opens the coaching layer and analytics.</p>
<p style="margin:0 0 12px">Plans start at $49 a month, and your first 7 days are free when you add a card. Cancel from the billing portal any time.</p>
${button("See plans", `${SITE_URL}/pricing`)}
${footer(unsubUrl)}`,
    ),
  };
}

/**
 * Sends one drip stage to a lead through the managed email API. Suppressed
 * recipients are an expected outcome, not a failure.
 */
export async function enqueueDripStage(
  admin: { from: (t: string) => any },
  lead: { id: string; email: string },
  stage: DripStage,
): Promise<void> {
  const { unsubscribeToken, unsubscribeUrl } = await import("./unsubscribe-link.server");
  const token = await unsubscribeToken(admin, lead.email);
  const mail = dripEmail(stage, token ? unsubscribeUrl(token) : null);

  try {
    const result = await sendRawEmail({
      to: lead.email,
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
      label: mail.label,
      idempotencyKey: `drip:${lead.id}:${stage}`,
    });
    await logEmailSend(admin, {
      template_name: mail.label,
      recipient_email: lead.email,
      status: result.sent ? "sent" : "suppressed",
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await logEmailSend(admin, {
      template_name: mail.label,
      recipient_email: lead.email,
      status: "failed",
      error_message: message.slice(0, 1000),
    });
    throw e;
  }
}

