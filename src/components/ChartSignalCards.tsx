import { useState } from "react";
import { ArrowUpRight, ArrowDownRight, Minus, Target, Shield, Flag, Clock, ChevronDown, ChevronUp } from "lucide-react";
import type { ChartGrade } from "@/lib/chartAnnotations";

type Props = {
  grade: ChartGrade | null;
  lastPrice?: number;
  onClear?: () => void;
};

function fmt(n?: number) {
  if (typeof n !== "number" || !isFinite(n)) return "—";
  const abs = Math.abs(n);
  const d = abs >= 1000 ? 2 : abs >= 10 ? 3 : abs >= 1 ? 4 : 5;
  return n.toFixed(d);
}

function pct(from?: number, to?: number) {
  if (typeof from !== "number" || typeof to !== "number" || !isFinite(from) || !isFinite(to) || from === 0) return "";
  return `${(((to - from) / from) * 100).toFixed(2)}%`;
}

export function ChartSignalCards({ grade, lastPrice, onClear }: Props) {
  const [expanded, setExpanded] = useState(false);

  // Waiting-for-signal state — small pill only
  if (!grade) {
    return (
      <div className="pointer-events-auto absolute left-3 top-3 z-20 inline-flex items-center gap-1.5 rounded-md border border-border/70 bg-background/85 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground backdrop-blur-md shadow-md">
        <Clock className="h-3 w-3" />
        Waiting for signal
      </div>
    );
  }

  const bias = grade.bias ?? "neutral";
  const isLong = bias === "long";
  const isShort = bias === "short";
  const biasTone = isLong
    ? "text-emerald-300 border-emerald-500/40 bg-emerald-500/10"
    : isShort
    ? "text-red-300 border-red-500/40 bg-red-500/10"
    : "text-muted-foreground border-border bg-muted/20";
  const BiasIcon = isLong ? ArrowUpRight : isShort ? ArrowDownRight : Minus;
  const actionLabel = isLong ? "BUY" : isShort ? "SELL" : "WAIT";

  const rows: Array<{ key: string; label: string; value?: number; tone: string; icon: React.ComponentType<{ className?: string }>; from?: number }> = [
    { key: "entry", label: "Entry", value: grade.entry, tone: "text-foreground", icon: Target, from: lastPrice },
    { key: "stop", label: "Stop Loss", value: grade.stop, tone: "text-red-300", icon: Shield, from: grade.entry },
    { key: "tp1", label: "Take Profit 1", value: grade.tp1, tone: "text-emerald-300", icon: Flag, from: grade.entry },
    { key: "tp2", label: "Take Profit 2", value: grade.tp2, tone: "text-emerald-200", icon: Flag, from: grade.entry },
  ];

  return (
    <div className="pointer-events-auto absolute left-3 top-3 z-20 w-[240px] rounded-lg border border-border/70 bg-background/90 backdrop-blur-md shadow-lg overflow-hidden">
      <div className={`flex items-center justify-between gap-2 px-2.5 py-1.5 border-b border-border/60 ${biasTone.split(" ").filter((c) => c.startsWith("bg-")).join(" ")}`}>
        <div className="flex items-center gap-1.5">
          <span className={`inline-flex h-5 w-5 items-center justify-center rounded ${biasTone}`}>
            <BiasIcon className="h-3 w-3" />
          </span>
          <span className={`text-[11px] font-bold tracking-wider ${biasTone.split(" ").filter((c) => c.startsWith("text-")).join(" ")}`}>
            {actionLabel}
          </span>
          <span className="text-[9px] uppercase tracking-wider text-muted-foreground">Signal</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="rounded border border-border/60 bg-background/60 px-1.5 py-0.5 text-[10px] font-bold text-foreground">
            {grade.grade.toUpperCase()}
          </span>
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="inline-flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted/60"
            title={expanded ? "Collapse" : "Expand"}
            aria-label={expanded ? "Collapse" : "Expand"}
          >
            {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </button>
          {onClear && (
            <button
              type="button"
              onClick={onClear}
              className="text-[11px] leading-none text-muted-foreground hover:text-foreground"
              title="Clear signal"
            >
              ×
            </button>
          )}
        </div>
      </div>
      <div className="divide-y divide-border/40">
        {rows.map((r) => {
          const Icon = r.icon;
          const delta = pct(r.from, r.value);
          return (
            <div key={r.key} className="flex items-center justify-between px-2.5 py-1.5">
              <div className="flex items-center gap-1.5">
                <Icon className={`h-3 w-3 ${r.tone}`} />
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{r.label}</span>
              </div>
              <div className="flex items-baseline gap-1.5">
                <span className={`font-mono text-[11px] ${r.tone}`}>{fmt(r.value)}</span>
                {delta && (
                  <span className="font-mono text-[9px] text-muted-foreground">{delta}</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {(grade.strength || grade.weakness) && (
        <div className="space-y-0.5 border-t border-border/60 px-2.5 py-1.5 text-[10px] leading-snug">
          {grade.strength && (
            <div><span className="text-emerald-400 font-semibold">+ </span><span className="text-foreground/80">{grade.strength}</span></div>
          )}
          {grade.weakness && (
            <div><span className="text-red-400 font-semibold">− </span><span className="text-foreground/80">{grade.weakness}</span></div>
          )}
        </div>
      )}
    </div>
  );
}
