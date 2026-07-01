import { createFileRoute } from "@tanstack/react-router";

// Assigned once per Worker cold start. When a new deploy ships, new
// isolates start with a new timestamp, so clients notice a version change.
const BOOT_ID = Date.now().toString(36);

export const Route = createFileRoute("/api/version")({
  server: {
    handlers: {
      GET: async () => {
        const version =
          process.env.VERCEL_DEPLOYMENT_ID ||
          process.env.VERCEL_GIT_COMMIT_SHA ||
          process.env.CF_PAGES_COMMIT_SHA ||
          BOOT_ID;
        return new Response(JSON.stringify({ version }), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": "no-store, max-age=0",
          },
        });
      },
    },
  },
});
