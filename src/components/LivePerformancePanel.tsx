// Compact live-performance summary for the dashboard. Reads local journal trades
// and paper account state.
import { useEffect, useState, useMemo } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { TrendingUp, TrendingDown, Target, BarChart3 } from "lucide-react";
import { getPaperState } from "@/lib/paper-engine.functions";

const STORAGE_KEY = "trademind.journal.trades.v1";

type LocalTrade = {
  id: string;
  date: string;
  symbol: string;
  side: "Long" | "Short";
  entry: number;
  exit: number;
  stop: number;
  size: number;
  pointValue?: number;
  reportedPnl?: number;
  fees?: number;
  createdAt: number;
};

function loadTrades(): LocalTrade[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

function pnl(t: LocalTrade) {
  if (t.reportedPnl != null && isFinite(t.reportedPnl)) return t.reportedPnl;
  const dir = t.side === "Long" ? 1 : -1;
  const size = t.size || 0;
  const pv = t.pointValue && isFinite(t.pointValue) && t.pointValue > 0 ? t.pointValue : 1;
  const fees = t.fees && isFinite(t.fees) ? t.fees : 0;
  return (t.exit - t.entry) * dir * size * pv - fees;
}

export function LivePerformancePanel() {
  const [trades, setTrades] = useState<LocalTrade[]>([]);
  const [paper, setPaper] = useState<{ balance: number; starting: number; pnl: number; winRate: number } | null>(null);

  useEffect(() => {
    setTrades(loadTrades());
    const onUpdate = () => setTrades(loadTrades());
    window.addEventListener("trademind:trades-updated", onUpdate);
    return () => window.removeEventListener("trademind:trades-updated", onUpdate);
  }, []);

  const getState = useServerFn(getPaperState);
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const s = await getState();
        if (cancelled) return;
        const balance = Number(s.account?.balance ?? 0);
        const starting = Number(s.account?.starting_balance ?? 10000);
        const tradesArr = s.trades ?? [];
        const wins = tradesArr.filter((t: any) => Number(t.pnl) > 0).length;
        setPaper({
          balance,
          starting,
          pnl: balance - starting,
          winRate: tradesArr.length ? (wins / tradesArr.length) * 100 : 0,
        });
      } catch { /* ignore */ }
    }
    load();
    const id = setInterval(load, 30_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [getState]);

  const journalStats = useMemo(() => {
    if (trades.length === 0) return null;
    const pnls = trades.map(pnl);
    const wins = pnls.filter((p) => p > 0).length;
    const net = pnls.reduce((a, b) => a + b, 0);
    return {
      total: trades.length,
      winRate: (wins / trades.length) * 100,
      net,
    };
  }, [trades]);

  if (!journalStats && !paper) return null;

  return (
    <div className="rounded-xl border border-border/60 bg-card px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="text-xs font-semibold tracking-tight text-muted-foreground">Live performance</div>
        {journalStats && (
          <>
            <div className="flex items-center gap-1.5 text-xs">
              <BarChart3 className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-muted-foreground">Journal</span>
              <span className="font-medium">{journalStats.total} trades</span>
              <span className="text-muted-foreground">·</span>
              <span className="font-medium">{journalStats.winRate.toFixed(0)}% WR</span>
              <span className="text-muted-foreground">·</span>
              <span className={`font-semibold ${journalStats.net >= 0 ? "text-bull" : "text-destructive"}`}>
                {journalStats.net >= 0 ? "+" : ""}{journalStats.net.toFixed(2)}
              </span>
            </div>
          </>
        )}
        {paper && (
          <div className="flex items-center gap-1.5 text-xs">
            <Target className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-muted-foreground">Paper</span>
            <span className="font-medium">${paper.balance.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
            <span className="text-muted-foreground">·</span>
            <span className={`font-semibold ${paper.pnl >= 0 ? "text-bull" : "text-destructive"}`}>
              {paper.pnl >= 0 ? <TrendingUp className="h-3 w-3 inline" /> : <TrendingDown className="h-3 w-3 inline" />}
              {paper.pnl >= 0 ? "+" : ""}{paper.pnl.toFixed(2)}
            </span>
            <span className="text-muted-foreground">·</span>
            <span className="font-medium">{paper.winRate.toFixed(0)}% WR</span>
          </div>
        )}
        <Link to="/analytics" className="ml-auto text-xs text-primary hover:underline">
          Full analytics
        </Link>
      </div>
    </div>
  );
}
