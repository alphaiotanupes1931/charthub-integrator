import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/PageHeader";

export const Route = createFileRoute("/_app/settings")({
  head: () => ({ meta: [{ title: "Settings — TradeMind" }] }),
  component: () => (
    <div className="p-8 max-w-[900px] mx-auto">
      <PageHeader title="Settings" description="Profile, integrations, notifications, and account preferences." />
      <div className="rounded-xl border border-border bg-card p-12 text-center text-sm text-muted-foreground">
        Settings UI coming soon.
      </div>
    </div>
  ),
});
