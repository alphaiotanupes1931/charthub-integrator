// Cron endpoint: reconcile all paper accounts. Runs every minute.
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/hooks/reconcile-paper")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const expected = process.env.SUPABASE_PUBLISHABLE_KEY;
        const provided = request.headers.get("apikey");
        if (expected && provided !== expected) {
          return new Response("unauthorized", { status: 401 });
        }
        const { reconcileAllPaperAccounts } = await import("@/lib/paper-engine.functions");
        const result = await reconcileAllPaperAccounts();
        return Response.json({ ok: true, ...result });
      },
    },
  },
});
