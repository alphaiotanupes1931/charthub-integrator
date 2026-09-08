// Legacy unsubscribe target from earlier emails. New emails link to the
// branded /unsubscribe page; links already in inboxes are redirected there.
import { createFileRoute } from "@tanstack/react-router";

function page(message: string): Response {
  return new Response(
    `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1" /><title>TradeMind email preferences</title>
<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:520px;margin:12vh auto;padding:0 20px;color:#111">
<h1 style="font-size:22px">TradeMind</h1><p style="font-size:15px;line-height:1.6">${message}</p></div>`,
    { status: 200, headers: { "content-type": "text/html; charset=utf-8" } },
  );
}

async function unsubscribe(token: string | null): Promise<Response> {
  if (!token) return page("That unsubscribe link is missing its token.");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data: row } = await supabaseAdmin
    .from("email_unsubscribe_tokens")
    .select("email")
    .eq("token", token)
    .maybeSingle();
  if (!row?.email) return page("That unsubscribe link is no longer valid.");

  const nowIso = new Date().toISOString();
  await supabaseAdmin
    .from("marketing_leads")
    .update({ unsubscribed_at: nowIso })
    .ilike("email", row.email);
  await supabaseAdmin
    .from("email_unsubscribe_tokens")
    .update({ used_at: nowIso })
    .eq("token", token);
  await supabaseAdmin
    .from("suppressed_emails")
    .upsert({ email: String(row.email).toLowerCase(), reason: "unsubscribe" }, { onConflict: "email" });

  return page(`${row.email} has been removed from TradeMind marketing emails. Account and security emails still come through.`);
}

function toBrandedPage(request: Request): Response {
  const token = new URL(request.url).searchParams.get("token");
  return new Response(null, {
    status: 302,
    headers: {
      location: `https://www.trademindaicoach.com/unsubscribe${token ? `?token=${encodeURIComponent(token)}` : ""}`,
    },
  });
}

export const Route = createFileRoute("/api/public/lead-unsubscribe")({
  server: {
    handlers: {
      // Older links land here: send them to the branded page instead.
      GET: async ({ request }) => toBrandedPage(request),
      // Mail clients that POST the one-click header still get the opt-out done.
      POST: async ({ request }) => unsubscribe(new URL(request.url).searchParams.get("token")),
    },
  },
});
