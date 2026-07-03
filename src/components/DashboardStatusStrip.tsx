import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

type PlatformStatus = {
  level: "operational" | "degraded" | "down";
  message: string;
};

const DOT: Record<PlatformStatus["level"], string> = {
  operational: "bg-emerald-500 shadow-[0_0_8px_1px_rgba(16,185,129,0.55)]",
  degraded: "bg-amber-500 shadow-[0_0_8px_1px_rgba(245,158,11,0.55)]",
  down: "bg-red-500 shadow-[0_0_8px_1px_rgba(239,68,68,0.55)]",
};

const LABEL: Record<PlatformStatus["level"], string> = {
  operational: "All systems operational",
  degraded: "Partial degradation",
  down: "Service disruption",
};

const SESSIONS: Array<{ label: string; hour: number; min: number }> = [
  { label: "Asian Prep", hour: 22, min: 0 },
  { label: "London Prep", hour: 6, min: 0 },
  { label: "NY Prep", hour: 12, min: 30 },
];

function nextSession(now: Date) {
  const nowMs = now.getTime();
  let best: { label: string; diffMs: number } | null = null;
  for (let d = 0; d <= 1; d++) {
    for (const s of SESSIONS) {
      const t = new Date(now);
      t.setUTCDate(now.getUTCDate() + d);
      t.setUTCHours(s.hour, s.min, 0, 0);
      const diff = t.getTime() - nowMs;
      if (diff > 0 && (best === null || diff < best.diffMs)) {
        best = { label: s.label, diffMs: diff };
      }
    }
  }
  return best ?? { label: SESSIONS[0].label, diffMs: 0 };
}

function formatDiff(ms: number): string {
  const totalMin = Math.max(0, Math.floor(ms / 60000));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export function DashboardStatusStrip() {
  const [status, setStatus] = useState<PlatformStatus | null>(null);
  const [now, setNow] = useState(() => new Date());
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("platform_status")
        .select("level,message")
        .maybeSingle();
      if (!cancelled && data) setStatus(data as PlatformStatus);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const next = nextSession(now);
  const level = status?.level ?? "operational";
  const dot = DOT[level];

  return (
    <div className="shrink-0 border-b border-border/40 bg-background/40">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 px-3 py-1 text-[11px] text-muted-foreground hover:text-foreground transition"
      >
        <span className={`inline-flex h-1.5 w-1.5 rounded-full ${dot} shrink-0`} />
        <span className="truncate">
          <span className="text-foreground/80 font-medium">{LABEL[level]}</span>
          <span className="mx-1.5 text-muted-foreground/60">·</span>
          Next <span className="text-primary font-medium">{next.label}</span> in{" "}
          <span className="text-foreground/80">{formatDiff(next.diffMs)}</span>
        </span>
        <span className="flex-1" />
        {open ? <ChevronUp className="h-3 w-3 shrink-0" /> : <ChevronDown className="h-3 w-3 shrink-0" />}
      </button>
      {open && (
        <div className="px-3 pb-2 pt-0.5 text-[11px] text-muted-foreground space-y-1 border-t border-border/40">
          {status?.message && (
            <div>
              <span className="text-foreground/70 font-medium">Status:</span> {status.message}
            </div>
          )}
          <div>
            <span className="text-foreground/70 font-medium">Session:</span> {next.label} opens in {formatDiff(next.diffMs)}
          </div>
        </div>
      )}
    </div>
  );
}
