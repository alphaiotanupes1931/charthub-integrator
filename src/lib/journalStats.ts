// Shared journal trade stats. Reads the same localStorage key as the journal
// route so the dashboard / AI scanner can fold the trader's actual record
// into its grading context.

const STORAGE_KEY = "trademind.journal.trades.v1";

export type JournalTrade = {
  id: string;
  symbol: string;
  side: "Long" | "Short";
  entry: number;
  exit: number;
  stop: number;
  size: number;
  fees?: number;
  pointValue?: number;
  ruleBroken?: boolean;
  followedPlan?: boolean;
  createdAt: number;
};

function readTrades(): JournalTrade[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? (arr as JournalTrade[]) : [];
  } catch {
    return [];
  }
}

function tradePnl(t: JournalTrade): number {
  const dir = t.side === "Long" ? 1 : -1;
  const size = t.size || 0;
  const pv = t.pointValue && isFinite(t.pointValue) && t.pointValue > 0 ? t.pointValue : 1;
  const fees = t.fees && isFinite(t.fees) ? t.fees : 0;
  return (t.exit - t.entry) * dir * size * pv - fees;
}

export type JournalSymbolStats = {
  symbol: string;
  trades: number;
  wins: number;
  losses: number;
  breakeven: number;
  winRate: number;
  netPnl: number;
  followedPlanRate: number;
  ruleBrokenRate: number;
};

export function getSymbolJournalStats(symbol: string): JournalSymbolStats | null {
  const trades = readTrades().filter((t) => t.symbol === symbol);
  if (trades.length === 0) return null;
  const pnls = trades.map(tradePnl);
  const wins = pnls.filter((p) => p > 0).length;
  const losses = pnls.filter((p) => p < 0).length;
  const breakeven = pnls.filter((p) => p === 0).length;
  const netPnl = pnls.reduce((a, b) => a + b, 0);
  const followed = trades.filter((t) => t.followedPlan === true).length;
  const broken = trades.filter((t) => t.ruleBroken === true).length;
  return {
    symbol,
    trades: trades.length,
    wins,
    losses,
    breakeven,
    winRate: Math.round((wins / trades.length) * 100),
    netPnl,
    followedPlanRate: Math.round((followed / trades.length) * 100),
    ruleBrokenRate: Math.round((broken / trades.length) * 100),
  };
}

export function formatJournalPerf(symbol: string): string | null {
  const s = getSymbolJournalStats(symbol);
  if (!s) return null;
  const sign = s.netPnl >= 0 ? "+" : "";
  const notes = [];
  if (s.followedPlanRate > 0) notes.push(`${s.followedPlanRate}% followed plan`);
  if (s.ruleBrokenRate > 0) notes.push(`${s.ruleBrokenRate}% broke rules`);
  const noteStr = notes.length ? ` (${notes.join(", ")})` : "";
  return `Journal record on ${s.symbol}: ${s.trades} trades, ${s.winRate}% win rate, ${sign}$${s.netPnl.toFixed(2)} P&L${noteStr}.`;
}
