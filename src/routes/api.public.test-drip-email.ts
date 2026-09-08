// Temporary internal helper: send one drip-stage email to a chosen address.
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/test-drip-email")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const expected = process.env.SUPABASE_PUBLISHABLE_KEY;
        const provided = request.headers.get("apikey");
        if (expected && provided !== expected) {
          return new Response("unauthorized", { status: 401 });
        }
        const body = (await request.json()) as { to?: string; stage?: number };
        const to = body.to;
        if (!to) return Response.json({ ok: false, error: "missing to" }, { status: 400 });
        const stage = (body.stage ?? 0) as 0 | 1 | 2;

        const { dripEmail } = await import("@/lib/lead-drip.server");
        const { sendRawEmail } = await import("@/lib/email-raw.server");
        const mail = dripEmail(stage);
        try {
          const result = await sendRawEmail({
            to,
            subject: mail.subject,
            html: mail.html,
            text: mail.text,
            label: mail.label,
            idempotencyKey: `test:${mail.label}:${to}:${Date.now()}`,
          });
          return Response.json({ ok: true, result, subject: mail.subject });
        } catch (e) {
          return Response.json({ ok: false, error: (e as Error).message }, { status: 500 });
        }
      },
    },
  },
});
