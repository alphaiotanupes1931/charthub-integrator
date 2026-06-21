import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/PageHeader";
import { Users, Mail } from "lucide-react";

export const Route = createFileRoute("/_app/mentor")({
  head: () => ({ meta: [{ title: "Coach Dashboard — TradeMind" }] }),
  component: MentorPage,
});

function MentorPage() {
  return (
    <div className="p-8 max-w-[1400px] mx-auto">
      <PageHeader
        title="Coach Dashboard"
        icon={<Users className="h-8 w-8 text-primary" />}
        description="Invite traders into your roster. Their P&L, win rate, and recent activity stay one click away."
      />

      <div className="rounded-xl border border-border bg-card p-6 mb-4">
        <h2 className="flex items-center gap-2 font-semibold mb-4">
          <Mail className="h-4 w-4 text-primary" /> Invite a trader
        </h2>
        <div className="flex gap-2">
          <input
            type="email"
            placeholder="trader@example.com"
            className="flex-1 h-10 rounded-md border border-border bg-background px-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:border-primary/40"
          />
          <button className="rounded-md bg-primary/20 border border-primary/40 px-4 text-sm font-semibold text-primary">
            Generate link
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card p-6">
        <h2 className="font-semibold mb-2">Your roster</h2>
        <p className="text-sm text-muted-foreground italic">No mentees yet. Send your first invite above.</p>
      </div>
    </div>
  );
}
