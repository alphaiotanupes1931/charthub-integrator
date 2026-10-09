import { describe, expect, it } from "vitest";
import { isSendWindow, shouldSendProfitEmail, summarizeDay, tradingDay } from "@/lib/daily-profit.shared";

describe("daily profit email", () => {
  it("sends only on a net-positive day", () => {
    const day = "2026-10-08";
    const win = summarizeDay([
      { symbol: "EUR/USD", realizedPL: 120, closedAt: "2026-10-08T14:00:00Z" },
      { symbol: "GBP/USD", realizedPL: -40, closedAt: "2026-10-08T15:00:00Z" },
    ], day);
    expect(win.pnl).toBe(80);
    expect(shouldSendProfitEmail(win)).toBe(true);
    const loss = summarizeDay([{ symbol: "EUR/USD", realizedPL: -10, closedAt: "2026-10-08T14:00:00Z" }], day);
    expect(shouldSendProfitEmail(loss)).toBe(false);
    expect(shouldSendProfitEmail(summarizeDay([], day))).toBe(false);
  });

  it("counts closes by New York date, not UTC", () => {
    // 01:00 UTC Oct 9 is 21:00 Oct 8 in New York.
    expect(tradingDay(new Date("2026-10-09T01:00:00Z"))).toBe("2026-10-08");
  });

  it("sends at 5 PM New York", () => {
    expect(isSendWindow(new Date("2026-10-08T21:07:00Z"))).toBe(true);
    expect(isSendWindow(new Date("2026-10-08T20:07:00Z"))).toBe(false);
  });
});
