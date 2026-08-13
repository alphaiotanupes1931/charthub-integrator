// Cron/webhook endpoint: recomputes the AI credit snapshot, probes Claude, and
// notifies admins when the budget runs low or the provider stops accepting
// calls. Called on a schedule (or manually) with the publishable key in the
// `apikey` header, matching the other /api/public/hooks/* jobs.

import { createFileRoute } from "@tanstack/react-router";

async function run(request: Request) {
  const expected = process.env["SUPABASE_PUBLISHABLE_KEY"];
  const provided = request.headers.get("apikey");
  if (expected && provided !== expected) {
    return new Response("unauthorized", { status: 401 });
  }
  const { checkAiCredits } = await import("@/lib/ai-credits.server");
  try {
    const snapshot = await checkAiCredits({ notify: true });
    return Response.json({
      ok: true,
      provider_status: snapshot.providerStatus,
      month_to_date_usd: Number(snapshot.monthToDateUsd.toFixed(4)),
      remaining_usd: Number(snapshot.remainingUsd.toFixed(4)),
      remaining_pct: snapshot.remainingPct,
      checked_at: snapshot.checkedAt,
    });
  } catch (e) {
    return Response.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}

export const Route = createFileRoute("/api/public/hooks/ai-credits")({
  server: {
    handlers: {
      POST: async ({ request }) => run(request),
      GET: async ({ request }) => run(request),
    },
  },
});
