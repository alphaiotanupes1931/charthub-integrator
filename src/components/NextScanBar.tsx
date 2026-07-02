import { useEffect, useState } from "react";
import { Crosshair, ChevronDown, ChevronUp } from "lucide-react";

// Ordered by UTC hour. The "Prep" window is the hour immediately before each session opens.
const SESSIONS: Array<{ label: string; hour: number; min: number }> = [
  { label: "Asian Prep",  hour: 22, min: 0  }, // Sydney/Tokyo open
  { label: "London Prep", hour: 6,  min: 0  }, // London open
  { label: "NY Prep",     hour: 12, min: 30 }, // NY open
];

function nextSession(now: Date): { label: string; diffMs: number } {
  const nowMs = now.getTime();
  let best: { label: string; diffMs: number } | null = null;
  for (let dayOffset = 0; dayOffset <= 1; dayOffset++) {
    for (const s of SESSIONS) {
      const t = new Date(now);
      t.setUTCDate(now.getUTCDate() + dayOffset);
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
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function NextScanBar() {
  const [now, setNow] = useState(() => new Date());
  const [open, setOpen] = useState(true);

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const next = nextSession(now);

  return (
    <div className="shrink-0 flex items-center gap-2 px-3 py-2 border-b border-border/60 bg-background/60 text-xs">
      <Crosshair className="h-3.5 w-3.5 text-primary shrink-0" />
      <div className="flex-1 min-w-0 truncate text-muted-foreground">
        Next scan: <span className="text-primary font-semibold">{next.label}</span>{" "}
        <span className="text-foreground">in {formatDiff(next.diffMs)}</span>
      </div>
      <button
        onClick={() => setOpen((o) => !o)}
        className="h-6 w-6 inline-flex items-center justify-center rounded text-muted-foreground hover:text-foreground"
        aria-label={open ? "Collapse" : "Expand"}
      >
        {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
      </button>
    </div>
  );
}
