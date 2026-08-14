import { useState } from "react";
import { ArrowUpRight, ArrowDownRight, Minus, Target, Shield, Flag, Clock, ChevronDown, ChevronUp, X, Zap, BookOpen, FlaskConical } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { takeTrade } from "@/lib/signalHistory";
import type { ChartGrade } from "@/lib/chartAnnotations";
import { AutoBacktestVerify } from "@/components/AutoBacktestVerify";
import { useTradeLogged } from "@/hooks/useTradeLogged";

type Props = {
  grade: ChartGrade | null;
  lastPrice?: number;
  symbol?: string;
  /** Chart interval in TradingView form (1, 5, 15, 60, 240, D, W, M). */
  interval?: string;
  onClear?: () => void;
  scanning?: boolean;
};

// Chart intervals the historical engine supports; anything finer or coarser is
// snapped to the closest supported bar size.
function toBacktestTf(interval?: string): "15" | "60" | "240" | "D" {
  switch (interval) {
    case "1":
    case "5":
    case "15":
      return "15";
    case "240":
      return "240";
    case "D":
    case "W":
    case "M":
      return "D";
    default:
      return "60";
  }
}


function fmt(n?: number) {
  if (typeof n !== "number" || !isFinite(n)) return "-";
  const abs = Math.abs(n);
  const d = abs >= 1000 ? 2 : abs >= 10 ? 3 : abs >= 1 ? 4 : 5;
  return n.toFixed(d);
}

function pct(from?: number, to?: number) {
  if (typeof from !== "number" || typeof to !== "number" || !isFinite(from) || !isFinite(to) || from === 0) return "";
  return `${(((to - from) / from) * 100).toFixed(2)}%`;
}

export function ChartSignalCards({ grade, lastPrice, symbol, interval, onClear, scanning }: Props) {
  const [expanded, setExpanded] = useState(false);
  const logged = useTradeLogged({ symbol, entry: grade?.entry ?? null });

  // Empty state - render nothing when idle so the chart can fill the whole area.
  // While actively scanning, show a very thin one-line status so the user gets
  // feedback without eating chart height.
  if (!grade) {
    if (!scanning) return null;
    return (
      <div className="shrink-0 flex items-center gap-2 px-3 py-1 border-b border-border/60 bg-card/40 text-[10px] font-semibold tracking-[0.18em] text-primary">
        <Clock className="h-3 w-3 animate-pulse" />
        Scanning setup…
      </div>
    );
  }

  const bias = grade.bias ?? "neutral";
  const isLong = bias === "long";
  const isShort = bias === "short";
  const biasText = isLong ? "text-bull" : isShort ? "text-red-300" : "text-muted-foreground";
  const biasBg = isLong ? "bg-bull/10 border-bull/40" : isShort ? "bg-red-500/10 border-red-500/40" : "bg-muted/20 border-border/60";
  const BiasIcon = isLong ? ArrowUpRight : isShort ? ArrowDownRight : Minus;

  // Determine order type from entry vs current price.
  // Long: entry above price = Buy Stop (breakout), entry below price = Buy Limit (pullback)
  // Short: entry below price = Sell Stop (breakdown), entry above price = Sell Limit (pullback)
  let orderType: string | null = null;
  let orderHelp = "";
  if (typeof grade.entry === "number" && typeof lastPrice === "number" && isFinite(grade.entry) && isFinite(lastPrice)) {
    const tol = Math.max(lastPrice * 0.0005, 0);
    if (isLong) {
      if (grade.entry > lastPrice + tol) { orderType = "BUY STOP"; orderHelp = "Entry is above current price - triggers on breakout"; }
      else if (grade.entry < lastPrice - tol) { orderType = "BUY LIMIT"; orderHelp = "Entry is below current price - waits for pullback"; }
      else { orderType = "BUY MARKET"; orderHelp = "Entry is at current price"; }
    } else if (isShort) {
      if (grade.entry < lastPrice - tol) { orderType = "SELL STOP"; orderHelp = "Entry is below current price - triggers on breakdown"; }
      else if (grade.entry > lastPrice + tol) { orderType = "SELL LIMIT"; orderHelp = "Entry is above current price - waits for pullback"; }
      else { orderType = "SELL MARKET"; orderHelp = "Entry is at current price"; }
    }
  }
  const actionLabel = isLong ? "BUY" : isShort ? "SELL" : "WAIT";

  const rows: Array<{ key: string; label: string; value?: number; tone: string; icon: React.ComponentType<{ className?: string }>; from?: number }> = [
    { key: "entry", label: "Entry", value: grade.entry, tone: "text-foreground", icon: Target, from: lastPrice },
    { key: "stop", label: "Stop", value: grade.stop, tone: "text-red-300", icon: Shield, from: grade.entry },
    { key: "tp1", label: "TP1", value: grade.tp1, tone: "text-bull", icon: Flag, from: grade.entry },
    { key: "tp2", label: "TP2", value: grade.tp2, tone: "text-bull", icon: Flag, from: grade.entry },
  ];

  return (
    <div className="shrink-0 border-b border-border/60 bg-card/40">
      {/* Header strip - one clean line: what the setup is, then a single action. */}
      <div className="flex flex-wrap items-center gap-2 px-4 py-2.5">
        <span className={`inline-flex h-8 items-center gap-1.5 rounded-2xl border px-2.5 ${biasBg}`}>
          <BiasIcon className={`h-3 w-3 ${biasText}`} />
          <span className={`text-[10px] font-bold tracking-wider ${biasText}`}>{actionLabel}</span>
          <span className={`text-[10px] font-bold ${biasText}`}>{grade.grade.toUpperCase()}</span>
        </span>
        {orderType && (
          <span
            className="inline-flex h-8 items-center rounded-2xl border border-border/60 bg-background/60 px-2.5 text-[10px] font-semibold tracking-wider text-muted-foreground"
            title={orderHelp}
          >
            {orderType}
          </span>
        )}

        <div className="flex-1" />

        {(isLong || isShort) && (
          <div className="flex flex-col gap-1">
            <button
              type="button"
              onClick={() =>
                takeTrade({
                  symbol: symbol ?? "",
                  bias: isLong ? "Long" : "Short",
                  interval,
                  grade: grade.grade,
                  entry: grade.entry,
                  stop: grade.stop,
                  tp1: grade.tp1,
                  tp2: grade.tp2,
                  why: grade.strength,
                  risk: grade.weakness,
                })
              }
              className="inline-flex h-8 items-center gap-1.5 rounded-2xl px-3 text-[10px] font-bold tracking-tight bg-primary text-primary-foreground hover:opacity-90"
              title="Log this setup in your trade journal"
            >
              <BookOpen className="h-3 w-3" /> Log this trade
            </button>
            <Link
              to="/broker"
              search={{
                symbol: symbol ?? "",
                side: isLong ? "long" : "short",
                entry: grade.entry ?? "",
                stop: grade.stop ?? "",
                tp: grade.tp1 ?? "",
              } as never}
              className="inline-flex h-8 items-center justify-center gap-1.5 rounded-2xl border border-border/60 px-3 text-[10px] font-bold tracking-tight text-foreground hover:bg-muted/60"
              title="Sign in to your OANDA account and place this trade"
            >
              <Zap className="h-3 w-3" /> Take this trade
            </Link>
          </div>
        )}


        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="inline-flex h-8 items-center gap-1.5 rounded-2xl px-2.5 text-[10px] tracking-tight text-muted-foreground hover:text-foreground hover:bg-muted/60"
          title={expanded ? "Hide details" : "Show details"}
        >
          {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          {expanded ? "Hide" : "Details"}
        </button>
        {onClear && (
          <button
            type="button"
            onClick={onClear}
            className="inline-flex h-8 w-8 items-center justify-center rounded-2xl text-muted-foreground hover:text-foreground hover:bg-muted/60"
            title="Clear signal"
            aria-label="Clear signal"
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>

      {expanded && (
        <div className="border-t border-border/40 px-4 py-3 grid grid-cols-2 sm:grid-cols-4 gap-2">
          {rows.map((r) => {
            const Icon = r.icon;
            const delta = pct(r.from, r.value);
            return (
              <div key={r.key} className="flex items-center justify-between gap-2 rounded-xl border border-border/50 bg-background/40 px-2 py-1.5">
                <div className="flex items-center gap-1.5 min-w-0">
                  <Icon className={`h-3 w-3 shrink-0 ${r.tone}`} />
                  <span className="text-[10px] tracking-tight text-muted-foreground truncate">{r.label}</span>
                </div>
                <div className="flex items-baseline gap-1.5 shrink-0">
                  <span className={`font-mono text-[11px] ${r.tone}`}>{fmt(r.value)}</span>
                  {delta && <span className="font-mono text-[9px] text-muted-foreground">{delta}</span>}
                </div>
              </div>
            );
          })}
          {orderType && orderHelp && (
            <div className="col-span-2 sm:col-span-4 text-[10px] text-muted-foreground">
              <span className="font-semibold text-foreground">{orderType}:</span> {orderHelp}.
            </div>
          )}
          <div className="col-span-2 sm:col-span-4 flex flex-wrap items-center gap-2 pt-1 border-t border-border/40">
            <span className="text-[10px] text-muted-foreground">
              {grade.dataSource ?? "feed unknown"} · {grade.candleCount ?? 0} bars
            </span>
            <div className="flex-1" />
            <AutoBacktestVerify
              symbol={symbol}
              interval={interval}
              side={isLong ? "long" : isShort ? "short" : "both"}
              grade={grade.grade}
              compact
            />
            {(isLong || isShort) && (
              <Link
                to="/broker"
                search={{
                  symbol: symbol ?? "",
                  side: isLong ? "long" : "short",
                  entry: grade.entry ?? "",
                  stop: grade.stop ?? "",
                  tp: grade.tp1 ?? "",
                } as never}
                className="inline-flex h-6 items-center gap-1 rounded-xl px-2 text-[10px] font-bold tracking-tight border border-border/60 text-foreground hover:bg-muted/60"
                title="Send this setup to your broker"
              >
                <Zap className="h-3 w-3" /> Broker
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

