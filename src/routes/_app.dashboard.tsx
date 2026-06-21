import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { TradingViewChart } from "@/components/TradingViewChart";
import { ChevronDown, Crosshair } from "lucide-react";

export const Route = createFileRoute("/_app/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard, TradeMind" },
      { name: "description", content: "Live chart and AI setup analysis for your active instrument." },
    ],
  }),
  component: Dashboard,
});

const INTERVALS = [
  { label: "1m", value: "1" },
  { label: "5m", value: "5" },
  { label: "15m", value: "15" },
  { label: "1H", value: "60" },
  { label: "4H", value: "240" },
  { label: "1D", value: "D" },
];

function Dashboard() {
  const [interval, setInterval] = useState("60");

  return (
    <div className="mx-auto max-w-6xl px-4 sm:px-6 py-8 space-y-6">
      {/* Header */}
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-border/60 pb-5">
        <div>
          <div className="text-[11px] font-medium uppercase tracking-[0.2em] text-muted-foreground mb-1.5">
            Active instrument
          </div>
          <h1 className="font-display text-3xl font-semibold tracking-tight">XAU/USD</h1>
          <p className="text-sm text-muted-foreground mt-1">Gold Spot · OANDA</p>
        </div>
        <button className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm font-medium hover:border-primary/50 transition">
          Change symbol <ChevronDown className="h-3.5 w-3.5" />
        </button>
      </header>

      {/* Interval selector */}
      <div className="flex items-center gap-1 rounded-lg border border-border bg-card p-1 w-fit">
        {INTERVALS.map((i) => (
          <button
            key={i.value}
            onClick={() => setInterval(i.value)}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
              interval === i.value
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {i.label}
          </button>
        ))}
      </div>

      {/* Chart */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="h-[520px]">
          <TradingViewChart symbol="OANDA:XAUUSD" interval={interval} />
        </div>
      </div>

      {/* Scan card */}
      <div className="rounded-xl border border-border bg-card p-8 flex flex-col items-center text-center gap-3">
        <Crosshair className="h-6 w-6 text-primary" />
        <div className="font-semibold">Ready to scan</div>
        <p className="text-sm text-muted-foreground max-w-sm">
          Grade the current setup on XAU/USD and get a written breakdown.
        </p>
        <button className="mt-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 transition">
          Run scan
        </button>
      </div>
    </div>
  );
}

