// The scoreboard has to use ONE definition of resolved. Hit rate used to divide
// by decided rows (target or stop) while average R divided by decided plus
// expired, so the two headline numbers on the same page were computed over
// different populations and the average was diluted by trades that merely ran
// out of time.
import { describe, it, expect } from "vitest";
import { buildScoreboard, bucket, type SignalScoreRow } from "@/lib/signal-scores.shared";

function row(p: Partial<SignalScoreRow>): SignalScoreRow {
  return {
    id: Math.random().toString(36).slice(2),
    symbol: "XAU/USD",
    timeframe: "60",
    grade: "A",
    bias: "Long",
    confidence: 70,
    strategyId: null,
    entry: 100,
    stop: 99,
    tp1: 102,
    plannedR: 2,
    status: "target",
    realizedR: 2,
    resolvedAt: new Date().toISOString(),
    taken: false,
    createdAt: new Date().toISOString(),
    ...p,
  };
}

describe("one definition of resolved", () => {
  const rows = [
    row({ status: "target", realizedR: 2, netR: 1.9, costR: 0.1 }),
    row({ status: "target", realizedR: 2, netR: 1.9, costR: 0.1 }),
    row({ status: "stop", realizedR: -1, netR: -1.1, costR: 0.1 }),
    row({ status: "stop", realizedR: -1, netR: -1.1, costR: 0.1 }),
    row({ status: "expired", realizedR: 0.3, netR: 0.2, costR: 0.1 }),
    row({ status: "expired", realizedR: -0.5, netR: -0.6, costR: 0.1 }),
    row({ status: "open", realizedR: null }),
  ];
  const board = buildScoreboard(rows);

  it("counts decided as target plus stop only", () => {
    expect(board.decided).toBe(4);
    expect(board.expired).toBe(2);
    expect(board.open).toBe(1);
    expect(board.total).toBe(7);
  });

  it("uses decided for both hit rate and average R", () => {
    expect(board.hitRate).toBe(50);
    // (2 + 2 - 1 - 1) / 4, not /6 with the expiries folded in.
    expect(board.expectancyR).toBe(0.5);
  });

  it("reports expiries on their own line instead of inside the average", () => {
    expect(board.expiredAvgR).toBe(-0.1);
    expect(board.notes.some((n) => n.includes("timed out"))).toBe(true);
  });

  it("reports net alongside gross with its own count", () => {
    expect(board.netExpectancyR).toBe(0.4);
    expect(board.netCount).toBe(4);
    expect(board.avgCostR).toBe(0.1);
  });

  it("gives the A callout the same denominator as the A table row", () => {
    const tableRow = board.byGrade.find((b) => b.key === "A")!;
    expect(board.aGrade.decided).toBe(tableRow.decided);
    expect(board.aGrade.hitRate).toBe(tableRow.hitRate);
  });

  it("excludes Neutral (void) rows from every aggregate", () => {
    const withVoid = buildScoreboard([...rows, row({ bias: "Neutral", status: "void", realizedR: null })]);
    expect(withVoid.total).toBe(7);
    expect(withVoid.voided).toBe(1);
    expect(withVoid.hitRate).toBe(board.hitRate);
    expect(withVoid.expectancyR).toBe(board.expectancyR);
  });

  it("leaves net null when no cost figures were recorded", () => {
    const b = bucket("legacy", [row({ status: "target", realizedR: 2, netR: null, costR: null })]);
    expect(b.netExpectancyR).toBeNull();
    expect(b.netCount).toBe(0);
    expect(b.expectancyR).toBe(2);
  });
});
