import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/PageHeader";

export const Route = createFileRoute("/_app/admin")({
  head: () => ({ meta: [{ title: "Admin, TradeMind" }] }),
  component: () => (
    <div className="p-4 md:p-8 max-w-[1100px] mx-auto">
      <PageHeader title="Admin" description="Super-admin tools, user tiers, and revenue overview." />
      <div className="rounded-xl border border-border bg-card p-12 text-center text-sm text-muted-foreground">
        Admin panel restricted to super_admin accounts.
      </div>
    </div>
  ),
});
