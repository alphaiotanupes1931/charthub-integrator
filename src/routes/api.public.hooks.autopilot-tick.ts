// Scheduled autopilot tick. Runs the scan for every trader whose autopilot is in
// auto mode, so setups are filed (and paper-filled) without the app being open.
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/hooks/autopilot-tick")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const expected = process.env.SUPABASE_PUBLISHABLE_KEY;
        const provided = request.headers.get("apikey");
        if (expected && provided !== expected) {
          return new Response("unauthorized", { status: 401 });
        }
        const apiKey = process.env.LOVABLE_API_KEY;
        if (!apiKey) return Response.json({ ok: false, error: "analysis service not configured" }, { status: 503 });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { runAutopilotForUser, settingsFromRow } = await import("@/lib/autopilot-run.server");

        const { data: rows, error } = await supabaseAdmin
          .from("autopilot_settings")
          .select("*")
          .eq("mode", "auto")
          .is("paused_reason", null)
          .limit(50);
        if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });

        let users = 0;
        let created = 0;
        let executed = 0;
        for (const row of rows ?? []) {
          const settings = settingsFromRow(row as unknown as Record<string, unknown>);
          try {
            const res = await runAutopilotForUser(
              supabaseAdmin,
              row.user_id as string,
              settings,
              "60",
              apiKey,
            );
            users += 1;
            created += res.created;
            executed += res.executed;
          } catch {
            // one trader failing must not stop the tick
          }
        }
        return Response.json({ ok: true, users, created, executed });
      },
    },
  },
});
