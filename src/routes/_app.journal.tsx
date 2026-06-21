import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Calendar as CalIcon, BookOpen, MessageSquare, ChevronLeft, ChevronRight } from "lucide-react";

export const Route = createFileRoute("/_app/journal")({
  head: () => ({ meta: [{ title: "Trade Journal — TradeMind" }] }),
  component: JournalPage,
});

const MONTH_NAMES = ["JANUARY","FEBRUARY","MARCH","APRIL","MAY","JUNE","JULY","AUGUST","SEPTEMBER","OCTOBER","NOVEMBER","DECEMBER"];

function JournalPage() {
  const [tab, setTab] = useState<"calendar" | "trades" | "sessions">("calendar");
  const [date, setDate] = useState(new Date());

  const year = date.getFullYear();
  const month = date.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (number | null)[] = [
    ...Array(firstDay).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <div className="p-8 max-w-[1400px] mx-auto">
      <PageHeader
        title="Trade Journal"
        description={
          <>
            Log every trade with your three trader inputs (entry-matched-plan, exit-matched-plan, P&L).
            The system grades your execution and behavior over time so you can see whether you're
            actually improving — not just whether you got lucky.
          </>
        }
      />

      <div className="flex gap-2 mb-6">
        {[
          { id: "calendar", label: "Calendar", icon: CalIcon },
          { id: "trades", label: "Trades", icon: BookOpen },
          { id: "sessions", label: "Sessions", icon: MessageSquare },
        ].map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id as typeof tab)}
              className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-sm ${
                active ? "bg-primary/15 text-primary border border-primary/30" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="h-3.5 w-3.5" /> {t.label}
            </button>
          );
        })}
      </div>

      {tab === "calendar" && (
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center justify-between px-4 py-2 mb-2">
            <button onClick={() => setDate(new Date(year, month - 1, 1))} className="h-8 w-8 rounded-md hover:bg-accent flex items-center justify-center">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <div className="font-display text-lg tracking-wider">{MONTH_NAMES[month]} {year}</div>
            <button onClick={() => setDate(new Date(year, month + 1, 1))} className="h-8 w-8 rounded-md hover:bg-accent flex items-center justify-center">
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
          <div className="grid grid-cols-7 text-xs text-muted-foreground font-mono border-b border-border">
            {["S","M","T","W","T","F","S"].map((d, i) => (
              <div key={i} className="text-center py-2">{d}</div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {cells.map((d, i) => (
              <div key={i} className="aspect-[5/4] border-b border-r border-border/50 p-2 text-sm text-muted-foreground">
                {d ?? ""}
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === "trades" && (
        <div className="rounded-xl border border-border bg-card p-12 text-center text-sm text-muted-foreground">
          No trades logged yet. Use the journal entry to start tracking.
        </div>
      )}
      {tab === "sessions" && (
        <div className="rounded-xl border border-border bg-card p-12 text-center text-sm text-muted-foreground">
          No sessions logged yet.
        </div>
      )}
    </div>
  );
}
