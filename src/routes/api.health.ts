import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { corsHeadersFor, getOrCreateRequestId, preflight } from "@/lib/api-security";
import type { Database } from "@/integrations/supabase/types";

export const Route = createFileRoute("/api/health")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) => preflight(request) ?? new Response(null, { status: 204 }),
      GET: async ({ request }) => {
        const reqId = getOrCreateRequestId(request);
        const cors = corsHeadersFor(request);
        const headers = {
          "Content-Type": "application/json",
          "X-Request-Id": reqId,
          ...cors,
        };
        const startedAt = Date.now();

        // Ping the database with a 2-second timeout so a hung connection
        // doesn't keep the health check open forever.
        let dbOk = false;
        let dbError: string | null = null;
        try {
          const sb = createClient<Database>(
            process.env.SUPABASE_URL!,
            process.env.SUPABASE_PUBLISHABLE_KEY!,
            { auth: { storage: undefined, persistSession: false, autoRefreshToken: false } },
          );
          const probe = sb.from("profiles").select("id", { head: true, count: "exact" }).limit(1);
          const timeout = new Promise<{ error: Error }>((resolve) =>
            setTimeout(() => resolve({ error: new Error("db_timeout") }), 2000),
          );
          const result = await Promise.race([probe, timeout]);
          if ("error" in result && result.error) {
            dbError = result.error.message ?? "unknown_db_error";
          } else {
            dbOk = true;
          }
        } catch (err) {
          dbError = err instanceof Error ? err.message : "unknown_db_error";
        }

        // Verify the stored Anthropic key can actually call Claude. Cached, so
        // repeated health polls don't spend a probe call each time.
        const { checkAnthropicHealth } = await import("@/lib/anthropic-health.server");
        const claude = await checkAnthropicHealth();

        const body = {
          status: dbOk ? "ok" : "degraded",
          server: "up",
          database: dbOk ? "connected" : "unreachable",
          ...(dbError ? { databaseError: dbError } : {}),
          claude: {
            status: claude.status,
            usable: claude.ok,
            detail: claude.detail,
            checkedAt: claude.checkedAt,
            cached: claude.cached,
          },
          requestId: reqId,
          latencyMs: Date.now() - startedAt,
          timestamp: new Date().toISOString(),
        };

        console.log(`[health] req=${reqId} db=${body.database} claude=${claude.status} latency=${body.latencyMs}ms`);

        return new Response(JSON.stringify(body), {
          status: dbOk ? 200 : 503,
          headers,
        });
      },
    },
  },
});
