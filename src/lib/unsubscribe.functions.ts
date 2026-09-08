// Public server functions behind the branded unsubscribe page.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const TokenInput = z.object({ token: z.string().min(8).max(200) });

function maskEmail(email: string): string {
  const [user, domain] = email.split("@");
  if (!domain) return email;
  return `${user.slice(0, 1)}***@${domain}`;
}

/** Looks up who a token belongs to, without changing anything. */
export const lookupUnsubscribe = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) => TokenInput.parse(input))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row } = await supabaseAdmin
      .from("email_unsubscribe_tokens")
      .select("email, used_at")
      .eq("token", data.token)
      .maybeSingle();

    if (!row?.email) return { status: "invalid" as const, masked: null };
    if (row.used_at) return { status: "already" as const, masked: maskEmail(String(row.email)) };
    return { status: "ready" as const, masked: maskEmail(String(row.email)) };
  });

/** Confirms the opt-out: marketing stops, account and security email stays. */
export const confirmUnsubscribe = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => TokenInput.parse(input))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row } = await supabaseAdmin
      .from("email_unsubscribe_tokens")
      .select("email")
      .eq("token", data.token)
      .maybeSingle();

    if (!row?.email) return { status: "invalid" as const, masked: null };
    const email = String(row.email).toLowerCase();
    const nowIso = new Date().toISOString();

    await supabaseAdmin.from("marketing_leads").update({ unsubscribed_at: nowIso }).ilike("email", email);
    await supabaseAdmin.from("email_unsubscribe_tokens").update({ used_at: nowIso }).eq("token", data.token);
    await supabaseAdmin
      .from("suppressed_emails")
      .upsert({ email, reason: "unsubscribe" }, { onConflict: "email" });

    // Keep the sending side in sync so nothing slips out after the opt-out.
    try {
      const { setEmailUnsubscribe } = await import("@lovable.dev/email-js");
      const { SENDER_DOMAIN } = await import("./email-raw.server");
      const apiKey = process.env["LOVABLE_API_KEY"];
      if (apiKey) {
        await setEmailUnsubscribe(
          { recipient: email, domain: SENDER_DOMAIN, subscribed: false },
          { apiKey },
        );
      }
    } catch (e) {
      console.error("[unsubscribe] provider sync failed", (e as Error).message);
    }

    return { status: "done" as const, masked: maskEmail(email) };
  });
