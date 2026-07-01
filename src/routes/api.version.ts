import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/version")({
  server: {
    handlers: {
      GET: async () => {
        const version =
          process.env.VERCEL_DEPLOYMENT_ID ||
          process.env.VERCEL_GIT_COMMIT_SHA ||
          process.env.CF_PAGES_COMMIT_SHA ||
          "0";
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
