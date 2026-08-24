// Bridges the trade journal into the signal learning loop.
//
// The learning block used to read only device-local scan history, which meant a
// trader could log six real losses in the journal and the coach would still say
// "no measured edge yet". Anything in the journal that has a resolved outcome
// (a result badge, or an exit price that actually moved off the entry) now
// counts as a graded signal, so the coach's SIGNAL BACKTEST reflects real
// trading rather than only tagged scan cards.

import type { SignalRecord } from "./signalHistory";

const STORAGE_KEY = "trademind.journal.trades.v1";

type RawJournalTrade = {
  id: string;
  symbol?: string;
  side?: "Long" | "Short";
  timeframe?: string;
  entry?: number;
  exit?: number;
  stop?: number;
  takeProfit?: number;
  size?: number;
  fees?: number;
  pointValue?: number;
  result?: "tp" | "stop" | "breakeven" | "partial" | "open";
  resultR?: number | null;
  executed?: boolean;
  createdAt?: number;
};

const TF_TO_INTERVAL: Record<string, string> = {
  "1m": "1", "5m": "5", "15m": "15", "30m": "30", "1H": "60", "4H": "240", "1D": "D", "1W": "W",
};

function readJournalTrades(): RawJournalTrade[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? (arr as RawJournalTrade[]) : [];
  } catch {
    return [];
  }
}

function pnlOf(t: RawJournalTrade): number | null {
  if (typeof t.entry !== "number" || typeof t.exit !== "number") return null;
  if (!isFinite(t.entry) || !isFinite(t.exit)) return null;
  const dir = t.side === "Short" ? -1 : 1;
  const size = t.size && isFinite(t.size) ? t.size : 1;
  const pv = t.pointValue && isFinite(t.pointValue) && t.pointValue > 0 ? t.pointValue : 1;
  const fees = t.fees && isFinite(t.fees) ? t.fees : 0;
  return (t.exit - t.entry) * dir * size * pv - fees;
}

/**
 * Resolve one journal trade to a win/loss/breakeven, or null when it is still
 * open. An exit equal to the entry with no result badge is treated as "not
 * closed yet" rather than a breakeven, which is what made real losses vanish
 * from the learning block.
 */
export function journalOutcome(t: RawJournalTrade): "win" | "loss" | "breakeven" | null {
  if (t.result === "open") return null;
  if (t.result === "tp") return "win";
  if (t.result === "stop") return "loss";
  if (t.result === "breakeven") return "breakeven";
  const pnl = pnlOf(t);
  if (pnl === null) return null;
  if (t.result === "partial") return pnl > 0 ? "win" : pnl < 0 ? "loss" : "breakeven";
  // No badge: only trust it once the exit actually moved off the entry.
  if (typeof t.exit === "number" && typeof t.entry === "number" && t.exit === t.entry) return null;
  return pnl > 0 ? "win" : pnl < 0 ? "loss" : "breakeven";
}

/** Journal trades expressed as taken signals so the learning report can score them. */
export function journalAsSignalRecords(trades?: RawJournalTrade[]): SignalRecord[] {
  const rows = trades ?? readJournalTrades();
  const out: SignalRecord[] = [];
  for (const t of rows) {
    if (!t || !t.symbol) continue;
    if (t.executed === false) continue;
    const outcome = journalOutcome(t);
    if (!outcome) continue;
    out.push({
      id: `journal:${t.id}`,
      at: t.createdAt ?? Date.now(),
      symbol: t.symbol,
      interval: TF_TO_INTERVAL[t.timeframe ?? ""] ?? (t.timeframe || "60"),
      grade: "journal",
      bias: t.side === "Short" ? "Short" : "Long",
      entry: typeof t.entry === "number" ? t.entry : undefined,
      stop: typeof t.stop === "number" ? t.stop : undefined,
      tp1: typeof t.takeProfit === "number" ? t.takeProfit : undefined,
      source: "engine",
      taken: true,
      outcome,
    });
  }
  return out;
}

/** How many journal trades are still waiting on an exit / result badge. */
export function journalUntaggedCount(trades?: RawJournalTrade[]): number {
  const rows = trades ?? readJournalTrades();
  return rows.filter((t) => t && t.symbol && t.executed !== false && journalOutcome(t) === null).length;
}
