import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/PageHeader";

export const Route = createFileRoute("/_app/system-status")({
  head: () => ({ meta: [{ title: "System Status, TradeMind" }] }),
  component: () => (
    <div className="p-4 md:p-8 max-w-[900px] mx-auto">
      <PageHeader title="System Status" description="Live status of TradeMind services." />
      <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-6 text-sm">
        <div className="flex items-center gap-2 mb-1">
          <span className="h-2 w-2 rounded-full bg-emerald-400" /> All systems operational
        </div>
        <p className="text-muted-foreground">Charts, AI gateway, and journaling are responding normally.</p>
      </div>
    </div>
  ),
});
