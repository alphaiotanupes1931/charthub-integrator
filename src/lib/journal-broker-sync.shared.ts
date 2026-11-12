// Matches closed broker positions to the journal rows TradeMind wrote when it
// placed them, so the journal carries the broker's real exit price and profit
// on the day the trade closed, instead of a guessed P&L on the entry day.

export type BrokerClose = {
  symbol: string;
  side: "long" | "short";
  units: number;
  price: number | null;
  realizedPL: number | null;
  closedAt: string | null;
};

export type JournalRowLite = { id: string; data: Record<string, unknown> };

const key = (s: unknown) => String(s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

/** New York calendar date (YYYY-MM-DD) for an ISO timestamp. */
export function nyDate(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
}

/**
 * Pair each close with at most one unsynced journal row: same symbol, same side,
 * size within 1%, opened before the close. Rows already carrying a broker close
 * are never touched again. Returns the updated row data to write.
 */
export function matchBrokerCloses(rows: JournalRowLite[], closes: BrokerClose[]): { id: string; data: Record<string, unknown>; tradeDate: string }[] {
  const used = new Set<string>();
  const out: { id: string; data: Record<string, unknown>; tradeDate: string }[] = [];
  for (const c of closes) {
    if (!c.closedAt || c.realizedPL == null || !Number.isFinite(c.realizedPL)) continue;
    const closedMs = new Date(c.closedAt).getTime();
    const side = c.side === "short" ? "Short" : "Long";
    const row = rows.find((r) => {
      if (used.has(r.id) || r.data["brokerClosedAt"]) return false;
      if (r.data["resultSource"] === "manual") return false;
      if (key(r.data["symbol"]) !== key(c.symbol) || r.data["side"] !== side) return false;
      const size = Number(r.data["size"]);
      if (!Number.isFinite(size) || size <= 0 || Math.abs(size - c.units) / size > 0.01) return false;
      const opened = Number(r.data["executedAt"] ?? r.data["createdAt"] ?? 0);
      return !opened || opened <= closedMs;
    });
    if (!row) continue;
    used.add(row.id);
    const date = nyDate(c.closedAt);
    out.push({
      id: row.id,
      tradeDate: date,
      data: {
        ...row.data,
        openedDate: row.data["openedDate"] ?? row.data["date"],
        date,
        exit: c.price ?? row.data["exit"],
        reportedPnl: Math.round(c.realizedPL * 100) / 100,
        brokerClosedAt: c.closedAt,
        result: row.data["result"] && row.data["result"] !== "open" ? row.data["result"] : c.realizedPL > 0 ? "tp" : c.realizedPL < 0 ? "stop" : "breakeven",
        resultSource: row.data["resultSource"] ?? "auto",
      },
    });
  }
  return out;
}
