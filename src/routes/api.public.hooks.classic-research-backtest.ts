// Read-only measurement endpoint: do the queued Classic research rules improve
// results on held-out bars? Nothing is written back and no grade changes.
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/hooks/classic-research-backtest")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const expected = process.env.SUPABASE_PUBLISHABLE_KEY;
        const provided = request.headers.get("apikey");
        if (expected && provided !== expected) {
          return new Response("unauthorized", { status: 401 });
        }

        const url = new URL(request.url);
        const { RESEARCH_FILTERS } = await import("@/lib/classic-research-backtest");
        const { runClassicResearchBacktest, SESSION_BIAS_SYMBOLS } = await import(
          "@/lib/classic-research-backtest.server"
        );

        const symbolsParam = url.searchParams.get("symbols");
        const filtersParam = url.searchParams.get("filters");
        const symbols = symbolsParam
          ? symbolsParam.split(",").map((s) => s.trim()).filter(Boolean)
          : [...SESSION_BIAS_SYMBOLS];
        const filters = (filtersParam ? filtersParam.split(",").map((s) => s.trim()) : [...RESEARCH_FILTERS])
          .filter((id): id is (typeof RESEARCH_FILTERS)[number] =>
            (RESEARCH_FILTERS as readonly string[]).includes(id));
        if (!filters.length) return Response.json({ error: "no valid filters requested" }, { status: 400 });

        const report = await runClassicResearchBacktest({
          symbols,
          filters,
          timeframe: "60",
          lookback: url.searchParams.get("lookback") ?? "2y",
        });
        return Response.json(report);
      },
    },
  },
});
