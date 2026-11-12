// Live-account facts shared by the auto-trading rails: equity, open positions
// and how much has actually been lost today at the broker. Nothing here touches
// paper balances - auto trading is live only.
import { buildBrokerSnapshots } from "@/lib/broker-readonly.server";

export type LiveAccountFacts = {
  connected: boolean;
  reason: string | null;
  equity: number;
  openPositions: number;
  /** Open positions per normalised symbol (e.g. GBPUSD). */
  openBySymbol: Record<string, number>;
  dailyLossPct: number;
  currency: string | null;
};

export async function liveAccountFacts(userId: string): Promise<LiveAccountFacts> {
  const snap = await buildBrokerSnapshots(userId);
  if (!snap.connected || snap.snapshots.length === 0) {
    return {
      connected: false,
      reason: snap.connected ? "No broker account returned any data." : snap.reason,
      equity: 0,
      openPositions: 0,
      openBySymbol: {},
      dailyLossPct: 0,
      currency: null,
    };
  }
  const first = snap.snapshots[0];
  const equity = Number(first.equity ?? first.balance ?? 0);
  const openPositions = snap.snapshots.reduce((n, s) => n + s.positions.length, 0);
  const openBySymbol: Record<string, number> = {};
  for (const s of snap.snapshots) for (const p of s.positions) {
    const k = symbolKey(p.symbol);
    openBySymbol[k] = (openBySymbol[k] ?? 0) + 1;
  }

  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  const realizedToday = snap.snapshots
    .flatMap((s) => s.recentCloses)
    .filter((c) => c.closedAt && new Date(c.closedAt).getTime() >= dayStart.getTime())
    .reduce((sum, c) => sum + Number(c.realizedPL ?? 0), 0);

  const base = equity > 0 ? equity : 0;
  const dailyLossPct = realizedToday < 0 && base > 0 ? Math.round((Math.abs(realizedToday) / base) * 10000) / 100 : 0;

  return {
    connected: true,
    reason: null,
    equity,
    openPositions,
    openBySymbol,
    dailyLossPct,
    currency: first.currency ?? null,
  };
}

/**
 * Position size from account equity: risk a fixed percentage of equity over the
 * distance between entry and stop. Units are whole units of the instrument.
 */
export function sizeFromRisk(equity: number, riskPct: number, entry: number, stop: number): number | null {
  const distance = Math.abs(entry - stop);
  if (!Number.isFinite(distance) || distance <= 0) return null;
  if (!Number.isFinite(equity) || equity <= 0) return null;
  const riskAmount = (equity * riskPct) / 100;
  const units = Math.floor(riskAmount / distance);
  return units >= 1 ? units : null;
}

/** Compare symbols across brokers: "GBP/USD", "GBP_USD" and "GBPUSD" match. */
export function symbolKey(symbol: string): string {
  return String(symbol ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}
