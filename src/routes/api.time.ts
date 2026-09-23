import { createFileRoute } from "@tanstack/react-router";

/** Server clock, so the app can tell a trader when their device time is wrong. */
export const Route = createFileRoute("/api/time")({
  server: {
    handlers: {
      GET: async () =>
        new Response(JSON.stringify({ now: Date.now(), iso: new Date().toISOString() }), {
          headers: { "content-type": "application/json", "cache-control": "no-store" },
        }),
    },
  },
});
