import { useEffect, useMemo, useState } from "react";
import { Lightbulb, TrendingUp, AlertTriangle } from "lucide-react";
import { readJournal } from "@/lib/chat-client";

type Trade = {
  symbol?: string;
  side?: "long" | "short" | string;
  outcome?: "win" | "loss" | string;
  pnl?: number;
  session?: string;
  date?: string;
};

export function TodaysRecommendation() {
  const [trades, setTrades] = useState<Trade[]>([]);

  useEffect(() => {
    setTrades(readJournal() as Trade[]);
    const onStorage = () => setTrades(readJournal() as Trade[]);
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const rec = useMemo(() => buildRecommendation(trades), [trades]);

  return (
    <div className="rounded-xl border border-primary/30 bg-gradient-to-br from-primary/[0.06] to-transparent p-5 mb-5">
      <div className="flex items-start gap-3">
        <div className="h-9 w-9 rounded-lg bg-primary/15 ring-1 ring-primary/30 flex items-center justify-center shrink-0">
          <Lightbulb className="h-4 w-4 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[11px] font-medium uppercase tracking-[0.2em] text-muted-foreground mb-1">
            Today's recommendation
          </div>
          <div className="font-display text-lg font-semibold mb-1">{rec.headline}</div>
          <p className="text-sm text-muted-foreground leading-relaxed">{rec.body}</p>
          {rec.stats && (
            <div className="flex flex-wrap gap-4 mt-3 text-xs">
              {rec.stats.map((s) => (
                <div key={s.label} className="flex items-center gap-1.5 text-muted-foreground">
                  {s.tone === "good" ? (
                    <TrendingUp className="h-3.5 w-3.5 text-bull" />
                  ) : (
                    <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />
                  )}
                  <span className="text-foreground font-medium">{s.value}</span>
                  <span>{s.label}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function buildRecommendation(trades: Trade[]): {
  headline: string;
  body: string;
  stats?: { label: string; value: string; tone: "good" | "warn" }[];
} {
  if (!trades.length) {
    return {
      headline: "Log a few trades to unlock your edge",
      body: "TradeMind grades patterns once you've logged at least 5 trades. Start by journaling today's session - wins, losses, and a one-line note.",
    };
  }

  const bySymbol: Record<string, { wins: number; losses: number; pnl: number }> = {};
  let wins = 0;
  let losses = 0;
  let pnl = 0;
  for (const t of trades) {
    const sym = (t.symbol ?? "Unknown").toUpperCase();
    bySymbol[sym] ??= { wins: 0, losses: 0, pnl: 0 };
    const isWin = t.outcome === "win" || (typeof t.pnl === "number" && t.pnl > 0);
    const isLoss = t.outcome === "loss" || (typeof t.pnl === "number" && t.pnl < 0);
    if (isWin) { bySymbol[sym].wins++; wins++; }
    if (isLoss) { bySymbol[sym].losses++; losses++; }
    if (typeof t.pnl === "number") { bySymbol[sym].pnl += t.pnl; pnl += t.pnl; }
  }
  const total = wins + losses;
  const winRate = total > 0 ? Math.round((wins / total) * 100) : 0;

  // best & worst symbols by win rate (min 3 trades)
  const ranked = Object.entries(bySymbol)
    .map(([s, v]) => ({ symbol: s, ...v, total: v.wins + v.losses }))
    .filter((x) => x.total >= 3);
  ranked.sort((a, b) => b.wins / Math.max(1, b.total) - a.wins / Math.max(1, a.total));
  const best = ranked[0];
  const worst = ranked[ranked.length - 1];

  let headline = `${winRate}% win rate across ${total} trades`;
  let body = `You've logged ${trades.length} sessions. Keep journaling to sharpen the AI's read on your edge.`;

  if (best && winRate >= 50) {
    headline = `Lean into ${best.symbol} - it's your edge`;
    body = `You're ${Math.round((best.wins / best.total) * 100)}% on ${best.symbol} across ${best.total} trades. Size up your A+ setups there and skip mediocre confluence elsewhere today.`;
  } else if (worst && worst.wins / Math.max(1, worst.total) < 0.4) {
    headline = `Stop scalping ${worst.symbol} until structure resets`;
    body = `${worst.symbol} is dragging you down: ${Math.round((worst.wins / worst.total) * 100)}% across ${worst.total} trades. Sit out or quarter-size until you see a clean Sweep → BOS → Retest.`;
  }

  const stats: { label: string; value: string; tone: "good" | "warn" }[] = [
    { label: "win rate", value: `${winRate}%`, tone: winRate >= 50 ? "good" : "warn" },
    { label: "trades", value: String(total), tone: "good" },
  ];
  if (Number.isFinite(pnl) && pnl !== 0) {
    stats.push({ label: "net P&L", value: `${pnl >= 0 ? "+" : ""}${pnl.toFixed(2)}`, tone: pnl >= 0 ? "good" : "warn" });
  }

  return { headline, body, stats };
}
