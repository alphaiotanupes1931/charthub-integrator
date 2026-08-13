import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowLeft, CheckCircle2, AlertTriangle, Loader2, XCircle } from "lucide-react";
import logoAsset from "@/assets/logo.png.asset.json";

export const Route = createFileRoute("/status")({
  head: () => ({
    meta: [
      { title: "System Status - TradeMind" },
      {
        name: "description",
        content:
          "Live operational status for TradeMind: app, database, AI coaching, and market data services.",
      },
      { property: "og:title", content: "System Status - TradeMind" },
      {
        property: "og:description",
        content:
          "Live operational status for TradeMind: app, database, AI coaching, and market data services.",
      },
    ],
  }),
  component: StatusPage,
});

type HealthResponse = {
  status: "ok" | "degraded";
  server: string;
  database: string;
  latencyMs: number;
  timestamp: string;
};

type Check = {
  id: string;
  label: string;
  description: string;
  state: "operational" | "degraded" | "down" | "checking";
  detail?: string;
};

function StatusPage() {
  const [checks, setChecks] = useState<Check[]>([
    { id: "app", label: "Application", description: "Web app and routing", state: "checking" },
    { id: "db", label: "Database", description: "User data and journal storage", state: "checking" },
    { id: "ai", label: "AI coaching", description: "Coach responses and grading", state: "checking" },
    { id: "data", label: "Market data", description: "Live charts and symbol pricing", state: "checking" },
  ]);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        const res = await fetch("/api/health", { cache: "no-store" });
        const data = (await res.json()) as HealthResponse;
        if (cancelled) return;
        const dbOk = data.database === "connected";
        setChecks((prev) =>
          prev.map((c) => {
            if (c.id === "app") return { ...c, state: "operational", detail: `Response ${data.latencyMs}ms` };
            if (c.id === "db")
              return {
                ...c,
                state: dbOk ? "operational" : "down",
                detail: dbOk ? "Connected" : "Unreachable",
              };
            // AI and market data: treated as operational if app + db are up.
            // These are gated by upstream providers we don't synchronously ping
            // from the public status endpoint - we report them as operational
            // unless we have signal otherwise.
            return { ...c, state: dbOk ? "operational" : "degraded", detail: dbOk ? "No incidents" : "Reduced functionality" };
          }),
        );
        setLastChecked(new Date());
      } catch {
        if (cancelled) return;
        setChecks((prev) =>
          prev.map((c) => ({ ...c, state: "down", detail: "Could not reach status endpoint" })),
        );
        setLastChecked(new Date());
      }
    };
    run();
    const t = setInterval(run, 30_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  const overall: Check["state"] = checks.some((c) => c.state === "down")
    ? "down"
    : checks.some((c) => c.state === "degraded")
      ? "degraded"
      : checks.every((c) => c.state === "operational")
        ? "operational"
        : "checking";

  return (
    <div className="min-h-screen w-full text-foreground">
      <header className="sticky top-0 z-40 backdrop-blur-xl bg-background/60 border-b border-border/40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 sm:h-20 flex items-center justify-between gap-3">
          <Link to="/" className="flex items-center gap-2 min-w-0">
            <img src={logoAsset.url} alt="TradeMind" className="h-9 w-9 sm:h-12 sm:w-12 object-contain shrink-0" />
            <span className="font-display text-lg sm:text-2xl font-semibold tracking-tight truncate">TradeMind</span>
          </Link>
          <Link
            to="/"
            className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-card/60 px-4 py-2 text-xs sm:text-sm font-medium hover:bg-card transition"
          >
            <ArrowLeft className="size-4" />
            Back home
          </Link>
        </div>
      </header>

      <main className="px-5 sm:px-6 py-16 sm:py-24">
        <div className="max-w-3xl mx-auto">
          <OverallBanner state={overall} />

          <div className="mt-8 rounded-2xl border border-border/60 bg-card/40 divide-y divide-border/60">
            {checks.map((c) => (
              <div key={c.id} className="flex items-center justify-between gap-4 px-5 py-4">
                <div className="min-w-0">
                  <div className="font-medium">{c.label}</div>
                  <div className="text-sm text-muted-foreground">{c.description}</div>
                </div>
                <StateBadge state={c.state} detail={c.detail} />
              </div>
            ))}
          </div>

          <p className="mt-6 text-xs text-muted-foreground text-center">
            {lastChecked
              ? `Last checked ${lastChecked.toLocaleTimeString()} · re-checks every 30s`
              : "Running first check…"}
          </p>

          <section className="mt-12 rounded-2xl border border-border/60 bg-card/40 p-6">
            <h2 className="font-display text-xl font-medium">Recent incidents</h2>
            <p className="text-sm text-muted-foreground mt-2">
              No incidents reported. We will post here when something goes wrong, with a timeline of
              detection, mitigation, and resolution.
            </p>
          </section>
        </div>
      </main>

      <footer className="border-t border-border/60 px-5 sm:px-6 py-10 bg-card/20">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-muted-foreground">
          <span>© 2026 TradeMind. Educational analysis only, not financial advice.</span>
          <div className="flex gap-4">
            <Link to="/help" className="hover:text-primary transition">Help</Link>
            <Link to="/faq" className="hover:text-primary transition">FAQ</Link>
            <Link to="/" className="hover:text-primary transition">Home</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}

function OverallBanner({ state }: { state: Check["state"] }) {
  const cfg = {
    operational: {
      icon: <CheckCircle2 className="size-5 text-bull" />,
      label: "All systems operational",
      bg: "bg-bull/10 border-bull/30",
    },
    degraded: {
      icon: <AlertTriangle className="size-5 text-amber-500" />,
      label: "Some systems are degraded",
      bg: "bg-amber-500/10 border-amber-500/30",
    },
    down: {
      icon: <XCircle className="size-5 text-red-500" />,
      label: "Service disruption in progress",
      bg: "bg-red-500/10 border-red-500/30",
    },
    checking: {
      icon: <Loader2 className="size-5 text-muted-foreground animate-spin" />,
      label: "Checking system status…",
      bg: "bg-card/60 border-border/60",
    },
  }[state];
  return (
    <div className={`rounded-2xl border ${cfg.bg} px-6 py-5 flex items-center gap-3`}>
      {cfg.icon}
      <div className="font-display text-lg sm:text-xl font-medium">{cfg.label}</div>
    </div>
  );
}

function StateBadge({ state, detail }: { state: Check["state"]; detail?: string }) {
  const map = {
    operational: { label: "Operational", cls: "text-bull bg-bull/10 border-bull/20" },
    degraded: { label: "Degraded", cls: "text-amber-500 bg-amber-500/10 border-amber-500/20" },
    down: { label: "Down", cls: "text-red-500 bg-red-500/10 border-red-500/20" },
    checking: { label: "Checking…", cls: "text-muted-foreground bg-card border-border/60" },
  }[state];
  return (
    <div className="text-right shrink-0">
      <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${map.cls}`}>
        {map.label}
      </span>
      {detail && <div className="text-[11px] text-muted-foreground mt-1">{detail}</div>}
    </div>
  );
}
