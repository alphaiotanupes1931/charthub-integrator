import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/voice-coach")({
  beforeLoad: () => { throw redirect({ to: "/coaches" }); },
});
