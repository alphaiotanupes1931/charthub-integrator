// Paper trading engine. Server-only helpers used by functions and cron.
import { getSnapshot } from "@/lib/agents/market-data.server";

export type PaperPosition = {
  id: string;
  user_id: string;
  symbol: string;
  side: "long" | "short";
  size: number;
  entry: number;
  stop: number;
  take_profit: number | null;
  grade: string | null;
  opened_at: string;
};

export const KILL_SWITCH_DRAWDOWN = 0.10;

export function parseFirstNumber(text: string | null | undefined): number | null {
  if (!text) return null;
  const m = String(text).match(/-?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
}

// Fetch a live-ish last price for the symbol using the same layer the chart uses.
export async function getLastPrice(symbol: string): Promise<number | null> {
  try {
    const snap = await getSnapshot(symbol, "5");
    if (snap.source === "unavailable" || !snap.lastPrice) return null;
    return snap.lastPrice;
  } catch {
    return null;
  }
}

// Given a position and the latest price, decide if TP / SL was touched.
// Simplified — uses last close (5m). Adequate for a paper account.
export function evaluateExit(pos: PaperPosition, price: number): { exit: number; reason: "tp" | "sl" } | null {
  if (pos.side === "long") {
    if (price <= pos.stop) return { exit: pos.stop, reason: "sl" };
    if (pos.take_profit != null && price >= pos.take_profit) return { exit: pos.take_profit, reason: "tp" };
  } else {
    if (price >= pos.stop) return { exit: pos.stop, reason: "sl" };
    if (pos.take_profit != null && price <= pos.take_profit) return { exit: pos.take_profit, reason: "tp" };
  }
  return null;
}

export function pnlFor(pos: Pick<PaperPosition, "side" | "entry" | "size">, exitPrice: number): number {
  const raw = (exitPrice - pos.entry) * pos.size;
  return pos.side === "long" ? raw : -raw;
}

export function computeEquity(balance: number, openPositions: PaperPosition[], priceBySymbol: Record<string, number>): number {
  let unrealized = 0;
  for (const p of openPositions) {
    const px = priceBySymbol[p.symbol];
    if (px == null) continue;
    unrealized += pnlFor(p, px);
  }
  return balance + unrealized;
}
