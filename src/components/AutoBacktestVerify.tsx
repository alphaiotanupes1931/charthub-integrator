import { useEffect, useRef, useState } from "react";
import { ShieldCheck, ShieldAlert, Loader2 } from "lucide-react";
import { runHistoricalBacktest } from "@/lib/backtest/backtest.functions";

type Props = {
  symbol?: string;
  /** Chart interval, e.g. "15", "60", "240", "D" */
  interval?: string;
  side?: "long" | "short" | "both";
  grade?: string;
  compact?: boolean;
  className?: string;
};

type Verdict = {
  trades: number;
  winRate: number;
  expectancyR: number;
};

function toTf(interval?: string): "15" | "60" | "240" | "D" {
  if (interval === "1" || interval === "5" || interval === "15" || interval === "30") return "15";
  if (interval === "240") return "240";
  if (interval === "D" || interval === "1D" || interval === "W") return "D";
  return "60";
}

const cache = new Map<string, Verdict>();

/**
 * Runs the historical backtest automatically for the signal on screen and
 * states plainly whether the same rules made or lost money on past price
 * history. No page to visit and no button to press.
 */
export function AutoBacktestVerify({ symbol, interval, side = "both", grade, compact, className }: Props) {
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const reqId = useRef(0);

  const tf = toTf(interval);
  const minGrade = grade === "A+" || grade === "A" ? "A" : "B";
  const key = `${symbol ?? ""}|${tf}|${side}|${minGrade}`;

  useEffect(() => {
    if (!symbol) return;
    const cached = cache.get(key);
    if (cached) {
      setVerdict(cached);
      setState("done");
      return;
    }
    const id = ++reqId.current;
    setState("loading");
    setVerdict(null);
    runHistoricalBacktest({
      data: { symbol, timeframe: tf, lookback: "2y", minGrade, direction: side, riskPct: 1, rrTarget: 2, atrStopMult: 1.2, maxHoldBars: 40, sessions: [] },
    })
      .then((res) => {
        if (id !== reqId.current) return;
        if (!res.ok) { setState("error"); return; }
        const v: Verdict = {
          trades: res.result.stats.trades,
          winRate: res.result.stats.winRate,
          expectancyR: res.result.stats.expectancyR,
        };
        cache.set(key, v);
        setVerdict(v);
        setState("done");
      })
      .catch(() => { if (id === reqId.current) setState("error"); });
  }, [key, symbol, tf, side, minGrade]);

  if (!symbol || state === "error") return null;

  if (state !== "done" || !verdict) {
    return (
      <div className={`inline-flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground ${className ?? ""}`}>
        <Loader2 className="h-3 w-3 animate-spin" /> Verifying on history
      </div>
    );
  }

  if (verdict.trades < 5) {
    return (
      <div className={`inline-flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground ${className ?? ""}`}>
        <ShieldAlert className="h-3 w-3" /> Not enough history to verify
      </div>
    );
  }

  const good = verdict.expectancyR > 0;
  const tone = good ? "text-emerald-500" : "text-destructive";
  const Icon = good ? ShieldCheck : ShieldAlert;

  if (compact) {
    return (
      <div className={`inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider ${tone} ${className ?? ""}`}>
        <Icon className="h-3 w-3" />
        {verdict.winRate}% WR · {verdict.expectancyR > 0 ? "+" : ""}{verdict.expectancyR}R
      </div>
    );
  }

  return (
    <div className={`rounded-md border border-border/60 bg-muted/20 px-2.5 py-2 ${className ?? ""}`}>
      <div className={`flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] ${tone}`}>
        <Icon className="h-3 w-3" />
        {good ? "Verified on history" : "Weak on history"}
      </div>
      <div className="mt-1 text-[11px] text-muted-foreground leading-snug">
        {verdict.trades} past setups on {symbol} {tf === "D" ? "daily" : `${tf}m`} · {verdict.winRate}% win rate ·{" "}
        {verdict.expectancyR > 0 ? "+" : ""}
        {verdict.expectancyR}R average per trade
      </div>
    </div>
  );
}

export default AutoBacktestVerify;
