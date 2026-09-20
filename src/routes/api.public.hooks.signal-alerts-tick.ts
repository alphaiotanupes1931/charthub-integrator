// Cron endpoint: the personal hourly scan.
//
// Runs just after the hourly candle closes, scans only the instruments people
// actually asked for, with the scan models they chose, and drops a notification
// in the app for every setup that passes their own grade rule. Nothing here
// changes how grades are produced; it only decides who gets told.
import { createFileRoute } from "@tanstack/react-router";
import {
  alertDedupeKey,
  decideAlert,
  formatAlert,
  inQuietHours,
  isTradeableBias,
  normalizeMinGrade,
} from "@/lib/signal-alerts.shared";
import { clusterOf, gradeRank } from "@/lib/correlation-clusters";
import { getAnalysisModel, normalizeAnalysisModel, type AnalysisModelId } from "@/lib/analysis-models";
import { evaluateEntryStaleness } from "@/lib/signal-staleness";

type PrefRow = {
  user_id: string;
  min_grade: string;
  symbols: string[] | null;
  models: string[] | null;
  timezone: string | null;
  quiet_from: number | null;
  quiet_to: number | null;
};

function num(raw: unknown): number | null {
  const n = typeof raw === "number" ? raw : Number.parseFloat(String(raw ?? "").replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) && n !== 0 ? n : null;
}

export const Route = createFileRoute("/api/public/hooks/signal-alerts-tick")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const expected = process.env['SUPABASE_PUBLISHABLE_KEY'];
        const provided = request.headers.get("apikey");
        if (expected && provided !== expected) {
          return new Response("unauthorized", { status: 401 });
        }
        const apiKey = process.env['LOVABLE_API_KEY'];
        if (!apiKey) return Response.json({ ok: false, error: "no_lovable_api_key" }, { status: 500 });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: prefRows, error } = await supabaseAdmin
          .from("signal_alert_prefs")
          .select("user_id, min_grade, symbols, models, timezone, quiet_from, quiet_to")
          .eq("enabled", true)
          .limit(500);
        if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });

        const prefs = ((prefRows ?? []) as unknown as PrefRow[]).filter((p) => (p.symbols ?? []).length > 0);
        if (!prefs.length) return Response.json({ ok: true, subscribers: 0, alerts: 0 });

        // One scan per (symbol, model) pair, shared by everyone who wants it.
        const pairs = new Map<string, { symbol: string; modelId: AnalysisModelId }>();
        for (const p of prefs) {
          for (const symbol of (p.symbols ?? []).slice(0, 12)) {
            for (const raw of (p.models ?? ["classic"]).slice(0, 3)) {
              const modelId = normalizeAnalysisModel(raw);
              pairs.set(`${symbol}|${modelId}`, { symbol, modelId });
            }
          }
        }

        const { getSnapshot } = await import("@/lib/agents/market-data.server");
        const { runResearch } = await import("@/lib/agents/research.server");
        const { runPlanner } = await import("@/lib/agents/planner.server");
        const { createNotificationOnce } = await import("@/lib/notifications.server");

        // The candle this tick belongs to: the hour that just closed.
        const barClose = new Date(Math.floor(Date.now() / 3_600_000) * 3_600_000).toISOString();
        const now = new Date();

        type Scan = {
          symbol: string;
          modelId: AnalysisModelId;
          grade: string;
          bias: string;
          entry: number | null;
          stop: number | null;
          tp1: number | null;
          confidence: number;
          stale: boolean;
          staleReason: string | null;
        };
        const scans: Scan[] = [];
        const skipped: string[] = [];
        const memos = new Map<string, Awaited<ReturnType<typeof runResearch>>>();

        for (const { symbol, modelId } of pairs.values()) {
          try {
            const snap = await getSnapshot(symbol, "60");
            if (snap.source === "unavailable" || snap.candles.length < 20) {
              skipped.push(`${symbol}:no-data`);
              continue;
            }
            let memo = memos.get(symbol);
            if (!memo) {
              memo = await runResearch(apiKey, snap);
              memos.set(symbol, memo);
            }
            const plan = await runPlanner(
              apiKey, snap, memo, undefined, undefined, undefined, undefined, undefined, undefined,
              "intraday", modelId,
            );
            const entry = num(plan.entry);
            const stop = num(plan.stop);
            const staleness = entry != null && stop != null
              ? evaluateEntryStaleness({ bias: plan.bias, entry, stop, lastPrice: snap.lastPrice })
              : { stale: true, distanceR: null, reason: "No entry or stop on this read." };
            scans.push({
              symbol, modelId,
              grade: plan.grade, bias: plan.bias,
              entry, stop, tp1: num(plan.tp1),
              confidence: plan.confidence,
              stale: staleness.stale,
              staleReason: staleness.reason,
            });
          } catch {
            skipped.push(`${symbol}:${modelId}:error`);
          }
        }

        let alerts = 0;
        for (const p of prefs) {
          const min = normalizeMinGrade(p.min_grade);
          const zone = p.timezone ?? "America/New_York";
          const quiet = inQuietHours(now, zone, p.quiet_from ?? 22, p.quiet_to ?? 6);
          const wantedModels = new Set((p.models ?? ["classic"]).map((m) => normalizeAnalysisModel(m)));
          const wantedSymbols = new Set(p.symbols ?? []);

          // Within this trader's own selection, an instrument family gets one alert:
          // the best-graded setup in that direction. The rest are the same bet.
          const bestInCluster = new Map<string, string>();
          for (const scan of scans) {
            if (!wantedSymbols.has(scan.symbol) || !wantedModels.has(scan.modelId)) continue;
            const cluster = clusterOf(scan.symbol);
            if (!cluster || !isTradeableBias(scan.bias)) continue;
            const familyKey = `${cluster}:${scan.bias.toLowerCase()}`;
            const held = bestInCluster.get(familyKey);
            if (!held || gradeRank(scan.grade) > gradeRank(held)) {
              bestInCluster.set(familyKey, scan.grade);
            }
          }

          for (const scan of scans) {
            if (!wantedSymbols.has(scan.symbol) || !wantedModels.has(scan.modelId)) continue;
            const cluster = clusterOf(scan.symbol);
            const familyBest = cluster ? bestInCluster.get(`${cluster}:${scan.bias.toLowerCase()}`) : undefined;
            const correlated = familyBest != null && gradeRank(familyBest) > gradeRank(scan.grade);
            const decision = decideAlert({
              plan: {
                grade: scan.grade, bias: scan.bias, entry: scan.entry,
                stop: scan.stop, tp1: scan.tp1, confidence: scan.confidence,
              },
              minGrade: min,
              stale: scan.stale,
              staleReason: scan.staleReason,
              quiet,
              correlated,
            });
            if (!decision.alert) continue;

            const model = getAnalysisModel(scan.modelId);
            const decimals = (scan.entry ?? 1) < 20 ? 5 : 2;
            const { title, body } = formatAlert({
              modelName: model.name,
              symbol: scan.symbol,
              plan: {
                grade: scan.grade, bias: scan.bias, entry: scan.entry,
                stop: scan.stop, tp1: scan.tp1, confidence: scan.confidence,
              },
              decimals,
            });
            const key = alertDedupeKey({
              modelId: scan.modelId, symbol: scan.symbol, bias: scan.bias, barCloseIso: barClose,
            });
            try {
              const id = await createNotificationOnce(key, {
                userId: p.user_id,
                kind: "signal",
                title,
                body,
                url: `/dashboard?symbol=${encodeURIComponent(scan.symbol)}`,
                meta: {
                  symbol: scan.symbol,
                  model: scan.modelId,
                  grade: scan.grade,
                  bias: scan.bias,
                  entry: scan.entry,
                  stop: scan.stop,
                  tp1: scan.tp1,
                  confidence: scan.confidence,
                },
              }, 24);
              if (id) alerts += 1;
            } catch {
              skipped.push(`${p.user_id}:${scan.symbol}:notify-failed`);
            }
          }
        }

        return Response.json({
          ok: true,
          subscribers: prefs.length,
          scanned: pairs.size,
          alerts,
          skipped,
        });
      },
    },
  },
});
