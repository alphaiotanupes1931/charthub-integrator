// Cron endpoint: one deterministic paper-bot pass over every running bot.
// Paper only — this hook can never reach a broker.
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/hooks/paper-bot-tick")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const expected = process.env.SUPABASE_PUBLISHABLE_KEY;
        const provided = request.headers.get("apikey");
        if (expected && provided !== expected) {
          return new Response("unauthorized", { status: 401 });
        }
        const { tickActivePaperBots } = await import("@/lib/paper-bot.server");
        const result = await tickActivePaperBots();
        return Response.json({ ok: true, ...result });
      },
    },
  },
});
