// Server-only builder for the branded platform status email.

export type StatusLevel = "operational" | "degraded" | "down";

const LOGO_URL =
  "https://www.trademindaicoach.com/__l5e/assets-v1/8670f86e-5056-4ecd-abe9-d675d7dddbb8/trademind-logo.png";
const SITE_URL = "https://www.trademindaicoach.com";

const META: Record<StatusLevel, { title: string; accent: string; chip: string; lead: string }> = {
  operational: {
    title: "All systems operational",
    accent: "#10b981",
    chip: "Operational",
    lead: "TradeMind is running normally. Scans, charts and the AI coach are all available.",
  },
  degraded: {
    title: "Partial degradation",
    accent: "#f59e0b",
    chip: "Degraded",
    lead: "Some parts of TradeMind are slower or partly unavailable right now. We are on it.",
  },
  down: {
    title: "Service disruption",
    accent: "#ef4444",
    chip: "Disruption",
    lead: "TradeMind is currently disrupted. Our team is actively working on a fix.",
  },
};

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function buildStatusEmail(level: StatusLevel, message: string) {
  const m = META[level];
  const when = new Date().toLocaleString("en-US", { timeZone: "America/New_York", dateStyle: "medium", timeStyle: "short" });

  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#fafafa;">
  <div style="max-width:560px;margin:0 auto;padding:32px 20px;font-family:-apple-system,'SF Pro Display',Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111;">
    <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin-bottom:24px;">
      <tr>
        <td style="vertical-align:middle;">
          <img src="${LOGO_URL}" alt="TradeMind" width="36" height="36" style="display:inline-block;vertical-align:middle;border-radius:8px;" />
          <span style="display:inline-block;vertical-align:middle;margin-left:10px;font-size:15px;font-weight:700;letter-spacing:0.08em;">TRADEMIND<span style="color:#8a8a8a;font-weight:600;"> · Beta</span></span>
        </td>
      </tr>
    </table>

    <div style="background:#fff;border:1px solid #eaeaea;border-radius:16px;overflow:hidden;">
      <div style="height:4px;background:${m.accent};"></div>
      <div style="padding:28px 24px;">
        <span style="display:inline-block;font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:${m.accent};border:1px solid ${m.accent};border-radius:999px;padding:4px 10px;">${m.chip}</span>
        <h1 style="margin:16px 0 8px;font-size:22px;line-height:1.25;font-weight:700;">${esc(m.title)}</h1>
        <p style="margin:0 0 18px;font-size:15px;line-height:1.55;color:#444;">${esc(m.lead)}</p>
        <div style="border-left:3px solid ${m.accent};background:#fafafa;border-radius:8px;padding:14px 16px;">
          <div style="font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#8a8a8a;margin-bottom:6px;">What is happening</div>
          <div style="font-size:15px;line-height:1.55;color:#111;white-space:pre-wrap;">${esc(message)}</div>
        </div>
        <a href="${SITE_URL}/status" style="display:inline-block;margin-top:22px;background:#111;color:#fff;text-decoration:none;font-size:14px;font-weight:600;padding:11px 18px;border-radius:10px;">View live status</a>
        <p style="margin:20px 0 0;font-size:12px;color:#8a8a8a;">Updated ${esc(when)} ET</p>
      </div>
    </div>

    <p style="margin:20px 0 0;font-size:12px;line-height:1.5;color:#8a8a8a;">
      You are receiving this because you have a TradeMind account. Status updates are sent only when the platform state changes.
    </p>
  </div>
</body></html>`;

  const text = `${m.title}\n\n${m.lead}\n\nWhat is happening:\n${message}\n\nLive status: ${SITE_URL}/status\nUpdated ${when} ET`;

  return { subject: `TradeMind status: ${m.title}`, html, text };
}
