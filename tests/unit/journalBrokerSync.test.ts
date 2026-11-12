import { describe, it, expect } from "vitest";
import { matchBrokerCloses } from "@/lib/journal-broker-sync.shared";

const row = (id: string, size: number) => ({ id, data: { id, symbol: "GBP/USD", side: "Short", size, date: "2026-11-10", executed: true, executedAt: Date.parse("2026-11-10T15:00:00Z"), result: "tp" } });

describe("broker close sync", () => {
  it("writes the broker profit onto the close day in New York", () => {
    const out = matchBrokerCloses([row("a", 43225)], [{ symbol: "GBP/USD", side: "short", units: 43225, price: 1.32994, realizedPL: 192.5686, closedAt: "2026-11-11T22:06:51Z" }]);
    expect(out).toHaveLength(1);
    expect(out[0].data.reportedPnl).toBe(192.57);
    expect(out[0].tradeDate).toBe("2026-11-11");
    expect(out[0].data.openedDate).toBe("2026-11-10");
  });
  it("matches each close to one row only and skips other sizes", () => {
    const c = { symbol: "GBP_USD", side: "short" as const, units: 46614, price: 1.33, realizedPL: 214.89, closedAt: "2026-11-11T22:06:51Z" };
    const out = matchBrokerCloses([row("a", 43225), row("b", 46614), row("c", 46614)], [c]);
    expect(out.map((u) => u.id)).toEqual(["b"]);
  });
  it("never re-syncs a row that already has a broker close", () => {
    const r = row("a", 43225); (r.data as Record<string, unknown>).brokerClosedAt = "x";
    expect(matchBrokerCloses([r], [{ symbol: "GBP/USD", side: "short", units: 43225, price: 1, realizedPL: 5, closedAt: "2026-11-11T22:06:51Z" }])).toHaveLength(0);
  });
});

import { isTradeLockerRateLimit } from "@/lib/broker-tradelocker.server";
describe("TradeLocker rate limit detection", () => {
  it("treats error code 1015 and HTTP 429 as rate limits", () => {
    expect(isTradeLockerRateLimit(403, "error code: 1015")).toBe(true);
    expect(isTradeLockerRateLimit(429, "")).toBe(true);
    expect(isTradeLockerRateLimit(400, "Insufficient margin")).toBe(false);
  });
});
