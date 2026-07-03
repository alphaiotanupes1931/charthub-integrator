import { useState } from "react";
import { ArrowUpRight, ArrowDownRight, Minus, Target, Shield, Flag, Clock, ChevronDown, ChevronUp, X } from "lucide-react";
import type { ChartGrade } from "@/lib/chartAnnotations";

type Props = {
  grade: ChartGrade | null;
  lastPrice?: number;
  onClear?: () => void;
  scanning?: boolean;
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

export function ChartSignalCards({ grade, lastPrice, onClear, scanning }: Props) {
  const [expanded, setExpanded] = useState(true);

  // Empty state — render nothing when idle so the chart can fill the whole area.
  // While actively scanning, show a very thin one-line status so the user gets
  // feedback without eating chart height.
  if (!grade) {
    if (!scanning) return null;
    return (
      <div className="shrink-0 flex items-center gap-2 px-3 py-1 border-b border-border/60 bg-card/40 text-[10px] font-semibold uppercase tracking-[0.18em] text-primary">
        <Clock className="h-3 w-3 animate-pulse" />
        Scanning setup…
      </div>
    );
  }

  const bias = grade.bias ?? "neutral";
  const isLong = bias === "long";
  const isShort = bias === "short";
  const biasText = isLong ? "text-emerald-300" : isShort ? "text-red-300" : "text-muted-foreground";
  const biasBg = isLong ? "bg-emerald-500/10 border-emerald-500/40" : isShort ? "bg-red-500/10 border-red-500/40" : "bg-muted/20 border-border";
  const BiasIcon = isLong ? ArrowUpRight : isShort ? ArrowDownRight : Minus;
  const actionLabel = isLong ? "BUY" : isShort ? "SELL" : "WAIT";

  const rows: Array<{ key: string; label: string; value?: number; tone: string; icon: React.ComponentType<{ className?: string }>; from?: number }> = [
    { key: "entry", label: "Entry", value: grade.entry, tone: "text-foreground", icon: Target, from: lastPrice },
    { key: "stop", label: "Stop", value: grade.stop, tone: "text-red-300", icon: Shield, from: grade.entry },
    { key: "tp1", label: "TP1", value: grade.tp1, tone: "text-emerald-300", icon: Flag, from: grade.entry },
    { key: "tp2", label: "TP2", value: grade.tp2, tone: "text-emerald-200", icon: Flag, from: grade.entry },
  ];

  return (
    <div className="shrink-0 border-b border-border/60 bg-card/40">
      {/* Header strip — always visible */}
      <div className="flex items-center gap-2 px-3 py-1.5 overflow-x-auto">
        <span className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 ${biasBg}`}>
          <BiasIcon className={`h-3 w-3 ${biasText}`} />
          <span className={`text-[10px] font-bold tracking-wider ${biasText}`}>{actionLabel}</span>
        </span>
        <span className="rounded border border-border/60 bg-background/60 px-1.5 py-0.5 text-[10px] font-bold text-foreground">
          {grade.grade.toUpperCase()}
        </span>

        {/* Inline preview of key numbers */}
        <div className="hidden sm:flex items-center gap-3 ml-1 text-[11px] font-mono">
          {rows.map((r) => (
            <span key={r.key} className="inline-flex items-baseline gap-1">
              <span className="text-[9px] uppercase tracking-wider text-muted-foreground">{r.label}</span>
              <span className={r.tone}>{fmt(r.value)}</span>
            </span>
          ))}
        </div>

        <div className="flex-1" />

        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="inline-flex h-6 items-center gap-1 rounded px-1.5 text-[10px] uppercase tracking-wider text-muted-foreground hover:text-foreground hover:bg-muted/60"
          title={expanded ? "Hide details" : "Show details"}
        >
          {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          {expanded ? "Hide" : "Details"}
        </button>
        {onClear && (
          <button
            type="button"
            onClick={onClear}
            className="inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted/60"
            title="Clear signal"
            aria-label="Clear signal"
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>

      {expanded && (
        <div className="border-t border-border/40 px-3 py-2 grid grid-cols-2 sm:grid-cols-4 gap-2">
          {rows.map((r) => {
            const Icon = r.icon;
            const delta = pct(r.from, r.value);
            return (
              <div key={r.key} className="flex items-center justify-between gap-2 rounded-md border border-border/50 bg-background/40 px-2 py-1.5">
                <div className="flex items-center gap-1.5 min-w-0">
                  <Icon className={`h-3 w-3 shrink-0 ${r.tone}`} />
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground truncate">{r.label}</span>
                </div>
                <div className="flex items-baseline gap-1.5 shrink-0">
                  <span className={`font-mono text-[11px] ${r.tone}`}>{fmt(r.value)}</span>
                  {delta && <span className="font-mono text-[9px] text-muted-foreground">{delta}</span>}
                </div>
              </div>
            );
          })}
          {(grade.strength || grade.weakness) && (
            <div className="col-span-2 sm:col-span-4 space-y-0.5 text-[11px] leading-snug">
              {grade.strength && (
                <div><span className="text-emerald-400 font-semibold">+ </span><span className="text-foreground/80">{grade.strength}</span></div>
              )}
              {grade.weakness && (
                <div><span className="text-red-400 font-semibold">− </span><span className="text-foreground/80">{grade.weakness}</span></div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
