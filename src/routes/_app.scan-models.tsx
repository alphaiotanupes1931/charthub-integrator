import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/scan-models")({
  beforeLoad: () => {
    throw redirect({ to: "/strategies/alt-strategies" });
  },
  component: () => null,
});