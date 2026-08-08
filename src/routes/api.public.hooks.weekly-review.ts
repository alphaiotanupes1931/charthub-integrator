// Scheduled weekly review. Runs after the trading week closes and writes one
// report per trader who closed trades, then notifies them in-app.
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/hooks/weekly-review")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const expected = process.env.SUPABASE_PUBLISHABLE_KEY;
        const provided = request.headers.get("apikey");
        if (expected && provided !== expected) {
          return new Response("unauthorized", { status: 401 });
        }

        const { runWeeklyReviewForAll, lastCompletedWeekEnding } = await import(
          "@/lib/weekly-review.server"
        );

        let weekEnding = lastCompletedWeekEnding();
        try {
          const body = (await request.json()) as { weekEnding?: string } | null;
          if (body?.weekEnding && /^\d{4}-\d{2}-\d{2}$/.test(body.weekEnding)) {
            weekEnding = body.weekEnding;
          }
        } catch {
          // empty body is the normal cron case
        }

        try {
          const summary = await runWeeklyReviewForAll(weekEnding);
          return Response.json({ ok: true, ...summary });
        } catch (err) {
          const message = err instanceof Error ? err.message : "weekly review failed";
          return Response.json({ ok: false, error: message }, { status: 500 });
        }
      },
    },
  },
});
