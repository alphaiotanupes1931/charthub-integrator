import { createFileRoute, Link } from "@tanstack/react-router";
import { Users, MessageSquare, Mic } from "lucide-react";

export const Route = createFileRoute("/_app/coach-dashboard")({
  head: () => ({
    meta: [
      { title: "Coach Dashboard, TradeMind" },
      { name: "description", content: "Overview of your active coach, sessions, and voice settings." },
    ],
  }),
  component: CoachDashboard,
});

function CoachDashboard() {
  return (
    <div className="p-6 md:p-10 space-y-6 max-w-4xl mx-auto">
      <div>
        <h1 className="font-display text-3xl">Coach Dashboard</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Quick access to your active coach, voice, and library.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Link
          to="/coaches"
          className="rounded-xl border border-border bg-card hover:border-primary/50 transition p-5"
        >
          <Users className="h-5 w-5 text-primary" />
          <div className="mt-3 font-semibold">Coach Library</div>
          <p className="text-xs text-muted-foreground mt-1">Browse and switch your active AI coach.</p>
        </Link>
        <Link
          to="/voice-coach"
          className="rounded-xl border border-border bg-card hover:border-primary/50 transition p-5"
        >
          <Mic className="h-5 w-5 text-primary" />
          <div className="mt-3 font-semibold">Voice Coach</div>
          <p className="text-xs text-muted-foreground mt-1">Configure voice replies and previews.</p>
        </Link>
        <Link
          to="/dashboard"
          className="rounded-xl border border-border bg-card hover:border-primary/50 transition p-5"
        >
          <MessageSquare className="h-5 w-5 text-primary" />
          <div className="mt-3 font-semibold">Open Chat</div>
          <p className="text-xs text-muted-foreground mt-1">Jump back into the dashboard chat.</p>
        </Link>
      </div>
    </div>
  );
}
