import { useEffect, useState } from "react";
import { ArrowDownRight, ArrowUpRight, History, Minus } from "lucide-react";
import {
  listVersions,
  onSignalHistoryChange,
  type SignalVersion,
} from "@/lib/signalHistory";
import { useTimezone, formatInTimezone } from "@/hooks/useTimezone";

/**
 * Version log for one instrument + timeframe. Older scan results are kept, so a
 * trader can open this and see exactly how the grade and the levels moved from
 * one scan to the next instead of losing the previous read.
 */
export function ScanVersionHistory({
  symbol,
  interval,
  className,
}: {
  symbol?: string;
  interval?: string;
  className?: string;
}) {
  const { effectiveTimezone } = useTimezone();
  const [open, setOpen] = useState(false);
  const [versions, setVersions] = useState<SignalVersion[]>([]);

  useEffect(() => {
    if (!symbol) return;
    const load = () => setVersions(listVersions(symbol, interval));
    load();
    return onSignalHistoryChange(load);
  }, [symbol, interval]);

  if (!symbol || versions.length < 1) return null;

  const when = (at: number) =>
    formatInTimezone(new Date(at), effectiveTimezone, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

  return (
    <div className={className}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-6 items-center gap-1 rounded-xl border border-border/60 px-2 text-[10px] font-bold tracking-tight text-foreground hover:bg-muted/60"
        title="Older scans of this instrument are kept so you can see how the grade and levels changed"
      >
        <History className="h-3 w-3" />
        v{versions[0].version} · {open ? "hide history" : `${versions.length} version${versions.length === 1 ? "" : "s"}`}
      </button>

      {open && (
        <div className="mt-2 space-y-1.5">
          {versions.map((v) => (
            <div
              key={v.record.id}
              className="rounded-xl border border-border/50 bg-background/40 p-2 text-[10px]"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-bold tracking-wider text-foreground">v{v.version}</span>
                <span className="text-muted-foreground">{when(v.record.at)}</span>
                <span className="rounded-lg border border-border/60 px-1.5 font-bold text-foreground">
                  {v.record.grade || "—"}
                </span>
                <span className="capitalize text-muted-foreground">{v.record.bias}</span>
                {v.record.taken && <span className="text-foreground">taken</span>}
              </div>
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-muted-foreground">
                {[
                  ["E", v.record.entry],
                  ["SL", v.record.stop],
                  ["TP1", v.record.tp1],
                  ["TP2", v.record.tp2],
                ].map(([label, val]) =>
                  typeof val === "number" ? (
                    <span key={label as string}>
                      {label} <span className="text-foreground">{val}</span>
                    </span>
                  ) : null,
                )}
              </div>
              {v.changes.length > 0 ? (
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {v.changes.map((c) => (
                    <span
                      key={c.label}
                      className="inline-flex items-center gap-1 rounded-lg border border-border/50 px-1.5 py-0.5"
                    >
                      {c.direction === "up" ? (
                        <ArrowUpRight className="h-2.5 w-2.5 text-emerald-500" />
                      ) : c.direction === "down" ? (
                        <ArrowDownRight className="h-2.5 w-2.5 text-red-500" />
                      ) : (
                        <Minus className="h-2.5 w-2.5 text-muted-foreground" />
                      )}
                      <span className="text-muted-foreground">{c.label}</span>
                      <span className="font-mono text-muted-foreground line-through">{c.from}</span>
                      <span className="font-mono text-foreground">{c.to}</span>
                    </span>
                  ))}
                </div>
              ) : (
                <div className="mt-1 text-muted-foreground">
                  {v.version === 1 ? "First scan on record." : "No change from the previous scan."}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
