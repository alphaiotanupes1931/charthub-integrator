import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { TradingViewChart } from "@/components/TradingViewChart";
import { CandlestickScene } from "@/components/CandlestickScene";
import { MotionPage, MotionStagger } from "@/components/MotionPage";
import {
  Crosshair,
  Bell,
  ChevronDown,
  Monitor,
  Sparkles,
  Activity,
  MessageSquare,
  BarChart2,
  Target,
  RefreshCw,
} from "lucide-react";

export const Route = createFileRoute("/_app/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard — TradeMind" },
      { name: "description", content: "Live chart, setup grading, and AI analysis for your active instrument." },
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
  { label: "1W", value: "W" },
  { label: "1M", value: "M" },
];

function Dashboard() {
  const [interval, setInterval] = useState("60");
  const [tab, setTab] = useState<"live" | "setup">("live");
  const [chartTab, setChartTab] = useState<"tv" | "native">("tv");
  const [panel, setPanel] = useState<"analysis" | "chat">("analysis");

  return (
    <div className="flex flex-col lg:flex-row">
      {/* Center column */}
      <div className="flex-1 min-w-0 p-4 space-y-3">
        {/* Top status strip */}
        <div className="flex items-center justify-between text-sm">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Crosshair className="h-4 w-4 text-primary" />
            <span>Next scan:</span>
            <span className="text-primary font-medium">Asian Prep</span>
            <span>in 19h 21m</span>
          </div>
          <button className="relative h-8 w-8 rounded-md border border-border flex items-center justify-center text-muted-foreground hover:text-foreground">
            <Bell className="h-4 w-4" />
            <span className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-primary text-[10px] font-bold text-primary-foreground flex items-center justify-center">
              1
            </span>
          </button>
        </div>

        {/* Symbol + interval bar */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <button className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-1.5 text-sm font-semibold">
            <span className="h-2 w-2 rounded-full bg-primary" /> GOLD <ChevronDown className="h-3.5 w-3.5" />
          </button>
          <div className="flex items-center gap-1 rounded-lg border border-border bg-card p-1">
            {INTERVALS.map((i) => (
              <button
                key={i.value}
                onClick={() => setInterval(i.value)}
                className={`rounded-md px-2.5 py-1 text-xs font-medium ${
                  interval === i.value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {i.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <button className="flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs">
              <Monitor className="h-3.5 w-3.5" /> TradingView
            </button>
            <button className="flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs">
              <Sparkles className="h-3.5 w-3.5 text-primary" /> Wyckoff Core <ChevronDown className="h-3 w-3" />
            </button>
            <button className="flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs">
              🧠 The Analyst <ChevronDown className="h-3 w-3" />
            </button>
          </div>
        </div>

        {/* Chart card */}
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2 border-b border-border">
            <div className="flex items-center gap-4 text-sm">
              <button
                onClick={() => setTab("live")}
                className={`flex items-center gap-1.5 pb-1 border-b-2 ${
                  tab === "live" ? "border-primary text-primary" : "border-transparent text-muted-foreground"
                }`}
              >
                <Activity className="h-3.5 w-3.5" /> Live Chart
              </button>
              <button
                onClick={() => setTab("setup")}
                className={`flex items-center gap-1.5 pb-1 border-b-2 ${
                  tab === "setup" ? "border-primary text-primary" : "border-transparent text-muted-foreground"
                }`}
              >
                <Target className="h-3.5 w-3.5" /> Setup View
              </button>
              <div className="ml-4 flex items-center gap-1 rounded-md border border-border p-0.5">
                <button
                  onClick={() => setChartTab("tv")}
                  className={`px-2 py-0.5 text-xs rounded ${chartTab === "tv" ? "bg-primary/15 text-primary" : "text-muted-foreground"}`}
                >
                  TradingView
                </button>
                <button
                  onClick={() => setChartTab("native")}
                  className={`px-2 py-0.5 text-xs rounded ${chartTab === "native" ? "bg-primary/15 text-primary" : "text-muted-foreground"}`}
                >
                  Native Chart
                </button>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button className="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground">
                Levels (6) <ChevronDown className="inline h-3 w-3" />
              </button>
              <button className="h-7 w-7 rounded-md border border-border flex items-center justify-center text-muted-foreground hover:text-foreground">
                <RefreshCw className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
          <div className="h-[560px]">
            <TradingViewChart symbol="OANDA:XAUUSD" interval={interval} />
          </div>
        </div>
      </div>

      {/* Right rail */}
      <div className="lg:w-[360px] shrink-0 border-l border-border/60 p-4 space-y-4 bg-background">
        <div className="flex items-center justify-between">
          <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            Panel Width
          </div>
          <div className="flex items-center gap-1 rounded-md border border-border p-0.5 text-xs">
            <button className="px-2 py-0.5 rounded text-muted-foreground">Narrow</button>
            <button className="px-2 py-0.5 rounded bg-primary/15 text-primary">Default</button>
            <button className="px-2 py-0.5 rounded text-muted-foreground">Wide</button>
          </div>
        </div>

        <div className="flex gap-1 border-b border-border">
          <button
            onClick={() => setPanel("analysis")}
            className={`flex items-center gap-1.5 px-3 py-2 text-sm border-b-2 ${
              panel === "analysis" ? "border-primary text-primary" : "border-transparent text-muted-foreground"
            }`}
          >
            <BarChart2 className="h-3.5 w-3.5" /> Analysis
          </button>
          <button
            onClick={() => setPanel("chat")}
            className={`flex items-center gap-1.5 px-3 py-2 text-sm border-b-2 ${
              panel === "chat" ? "border-primary text-primary" : "border-transparent text-muted-foreground"
            }`}
          >
            <MessageSquare className="h-3.5 w-3.5" /> Chat
          </button>
        </div>

        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground mb-2">
            Performance
          </div>
          <div className="rounded-xl border border-border bg-card p-4 text-center text-xs text-muted-foreground">
            Log trades to see your performance over time.
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card p-5 text-center space-y-3">
          <Crosshair className="h-6 w-6 mx-auto text-primary" />
          <div className="font-semibold">Ready to scan</div>
          <p className="text-xs text-muted-foreground">
            Run a scan to grade the current setup on XAUUSD
          </p>
          <button className="rounded-md border border-primary/40 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary inline-flex items-center gap-1.5">
            <Crosshair className="h-3.5 w-3.5" /> Run scan
          </button>
        </div>

        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground mb-2">
            Order Flow
          </div>
          <div className="rounded-xl border border-border bg-card p-5 text-center space-y-2">
            <Target className="h-6 w-6 mx-auto text-muted-foreground" />
            <p className="text-xs text-muted-foreground">Run a scan to see analysis</p>
          </div>
        </div>
      </div>
    </div>
  );
}
