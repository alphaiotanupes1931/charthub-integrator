// Cron endpoint: scan the default watchlist and fan A/A+ actionable
// signals out to the shared Discord community webhook. Deduplicates
// per-symbol within a 4-hour window so we don't spam the channel.
import { createFileRoute } from "@tanstack/react-router";

const WATCHLIST = [
  "XAU/USD", "EUR/USD", "GBP/USD", "USD/JPY",
  "BTC/USD", "ETH/USD", "NAS100", "SPX500",
];

// In-memory dedupe (per worker instance). Best-effort — a duplicate post
// once in a while is fine; missing a fresh A/A+ isn't.
const lastPostedAt = new Map<string, number>();
const DEDUPE_MS = 4 * 60 * 60 * 1000; // 4h

export const Route = createFileRoute("/api/public/hooks/scan-signals")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const expected = process.env.SUPABASE_PUBLISHABLE_KEY;
        const provided = request.headers.get("apikey");
        if (expected && provided !== expected) {
          return new Response("unauthorized", { status: 401 });
        }

        const apiKey = process.env.LOVABLE_API_KEY;
        if (!apiKey) return Response.json({ ok: false, error: "no_lovable_api_key" }, { status: 500 });

        const { getSnapshot } = await import("@/lib/agents/market-data.server");
        const { runResearch } = await import("@/lib/agents/research.server");
        const { runPlanner } = await import("@/lib/agents/planner.server");
        const { sendDiscordShared } = await import("@/lib/briefings.server");

        const now = Date.now();
        const posted: string[] = [];
        const skipped: string[] = [];

        for (const ticker of WATCHLIST) {
          try {
            const snap = await getSnapshot(ticker, "60");
            if (snap.source === "unavailable" || snap.candles.length < 20) {
              skipped.push(`${ticker}:no-data`);
              continue;
            }
            const memo = await runResearch(apiKey, snap);
            const plan = await runPlanner(apiKey, snap, memo);

            const isActionable =
              (plan.grade === "A" || plan.grade === "A+") &&
              plan.bias !== "Neutral" &&
              plan.confidence >= 55;
            if (!isActionable) { skipped.push(`${ticker}:${plan.grade}/${plan.confidence}`); continue; }

            const key = `${ticker}:${plan.bias}`;
            const last = lastPostedAt.get(key) ?? 0;
            if (now - last < DEDUPE_MS) { skipped.push(`${ticker}:cooldown`); continue; }

            const action = plan.bias === "Long" ? "BUY" : "SELL";
            const msg =
              `**${plan.grade} · ${action} ${ticker}**\n` +
              `Entry ${plan.entry} · Stop ${plan.stop} · TP1 ${plan.tp1}\n` +
              `R:R ${plan.rr} · Confidence ${plan.confidence}%\n` +
              (plan.notes ? `_${plan.notes}_` : "");

            const r = await sendDiscordShared(msg);
            if (r.ok) {
              lastPostedAt.set(key, now);
              posted.push(ticker);
            } else {
              skipped.push(`${ticker}:discord_${r.error ?? "err"}`);
            }
          } catch (e) {
            skipped.push(`${ticker}:err`);
          }
        }

        return Response.json({ ok: true, posted, skipped, scanned: WATCHLIST.length });
      },
    },
  },
});
