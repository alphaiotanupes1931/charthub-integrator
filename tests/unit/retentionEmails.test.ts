import { describe, it, expect } from "vitest";
import { retentionKindAt, pickMorningSetups, scannerWinsForDay, shouldSendWins, isQuietDay } from "@/lib/retention-emails.shared";

// Oct 9 2026 is EDT (UTC-4).
describe("retention email timing", () => {
  it("morning picks go out at 8 AM New York", () => {
    expect(retentionKindAt(new Date("2026-10-09T12:10:00Z"))).toBe("morning_brief");
  });
  it("scanner wins go out at 6 PM New York", () => {
    expect(retentionKindAt(new Date("2026-10-09T22:10:00Z"))).toBe("scanner_wins");
  });
  it("other hours send nothing", () => {
    expect(retentionKindAt(new Date("2026-10-09T15:00:00Z"))).toBeNull();
  });
  it("Saturday is skipped", () => {
    expect(isQuietDay(new Date("2026-10-10T12:10:00Z"))).toBe(true);
  });
});

const now = new Date("2026-10-09T12:10:00Z");
const row = (symbol: string, grade: string, confidence: number, hoursAgo = 1) => ({
  symbol, grade, bias: "bullish", entry: 1, stop: 0.9, tp1: 1.2, confidence,
  created_at: new Date(now.getTime() - hoursAgo * 3600_000).toISOString(),
});

describe("morning picks", () => {
  it("only A+, A and B make the email", () => {
    const out = pickMorningSetups([row("EUR/USD", "C", 90), row("GBP/USD", "B", 50)], now);
    expect(out.map((r) => r.symbol)).toEqual(["GBP/USD"]);
  });
  it("at most 3 picks, one per instrument, best grade first", () => {
    const out = pickMorningSetups([row("A1", "B", 90), row("A2", "A", 10), row("A2", "A", 80), row("A3", "B", 50), row("A4", "B", 40)], now);
    expect(out.map((r) => r.symbol)).toEqual(["A2", "A1", "A3"]);
    expect(out[0].confidence).toBe(80);
  });
  it("ignores setups older than 12 hours", () => {
    expect(pickMorningSetups([row("EUR/USD", "A", 90, 13)], now)).toEqual([]);
  });
});

describe("scanner wins", () => {
  const r = (symbol: string, status: string, at: string, rr = 2) => ({ symbol, bias: "bullish", grade: "A", status, realized_r: rr, resolved_at: at });
  it("counts only targets hit on that New York day, one per instrument and direction", () => {
    const wins = scannerWinsForDay([
      r("EUR/USD", "target", "2026-10-09T15:00:00Z", 1.5),
      r("EUR/USD", "target", "2026-10-09T16:00:00Z", 2.2),
      r("GBP/USD", "stop", "2026-10-09T15:00:00Z"),
      r("USD/JPY", "target", "2026-10-09T03:00:00Z"), // Oct 8 in New York
    ], "2026-10-09");
    expect(wins).toEqual([{ symbol: "EUR/USD", bias: "bullish", grade: "A", r: 2.2 }]);
  });
  it("no wins means no email", () => {
    expect(shouldSendWins([])).toBe(false);
  });
});
