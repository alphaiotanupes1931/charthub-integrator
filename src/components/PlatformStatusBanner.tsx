import { useEffect, useState } from "react";
import { CheckCircle2, AlertTriangle, XCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

type Status = {
  level: "operational" | "degraded" | "down";
  message: string;
  updated_at: string;
};

const STYLES = {
  operational: {
    icon: CheckCircle2,
    label: "All systems operational",
    ring: "border-bull/30",
    bg: "bg-bull/10",
    dot: "bg-bull shadow-[0_0_12px_2px_rgba(16,185,129,0.55)]",
    text: "text-bull",
  },
  degraded: {
    icon: AlertTriangle,
    label: "Partial degradation",
    ring: "border-amber-500/30",
    bg: "bg-amber-500/10",
    dot: "bg-amber-500 shadow-[0_0_12px_2px_rgba(245,158,11,0.55)]",
    text: "text-amber-400",
  },
  down: {
    icon: XCircle,
    label: "Service disruption",
    ring: "border-red-500/30",
    bg: "bg-red-500/10",
    dot: "bg-red-500 shadow-[0_0_12px_2px_rgba(239,68,68,0.55)]",
    text: "text-red-400",
  },
} as const;

export function PlatformStatusBanner() {
  const [status, setStatus] = useState<Status | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("platform_status")
        .select("level,message,updated_at")
        .maybeSingle();
      if (!cancelled && data) setStatus(data as Status);
    })();
    return () => { cancelled = true; };
  }, []);

  if (!status) return null;
  const s = STYLES[status.level];
  const Icon = s.icon;

  return (
    <div className={`shrink-0 border-b ${s.ring} ${s.bg}`}>
      <div className="mx-auto flex max-w-[1600px] items-center gap-3 px-3 py-2 sm:px-4">
        <span className={`relative inline-flex h-2 w-2 rounded-full ${s.dot}`}>
          <span className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 ${s.dot}`} />
        </span>
        <Icon className={`h-4 w-4 shrink-0 ${s.text}`} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className={`text-xs font-semibold tracking-tight ${s.text}`}>
              TradeMind Status
            </span>
            <span className="text-xs text-muted-foreground">·</span>
            <span className="text-xs font-medium text-foreground">{s.label}</span>
          </div>
          <p className="mt-0.5 truncate text-[11px] text-muted-foreground sm:text-xs">
            {status.message}
          </p>
        </div>
      </div>
    </div>
  );
}
