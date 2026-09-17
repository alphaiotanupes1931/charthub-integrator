// Neutral scans must never be scored. A "Neutral" bias used to fall through the
// long check and be resolved as a short, so no-opinion reads were quietly
// counted as directional bets inside the hit rate.
import { describe, it, expect } from "vitest";
import { signalDirection } from "@/lib/signal-scores.server";
import { buildScoreboard, scorableRows, type SignalScoreRow } from "@/lib/signal-scores.shared";

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

describe("signalDirection", () => {
  it("reads long and short", () => {
    expect(signalDirection("Long")).toBe("long");
    expect(signalDirection("short")).toBe("short");
    expect(signalDirection("Bullish")).toBe("long");
    expect(signalDirection("Sell")).toBe("short");
  });

  it("returns null for Neutral instead of defaulting to short", () => {
    expect(signalDirection("Neutral")).toBeNull();
    expect(signalDirection("")).toBeNull();
    expect(signalDirection("none")).toBeNull();
  });
});

describe("scoreboard excludes void rows", () => {
  const rows = [
    row({ status: "target", realizedR: 2 }),
    row({ status: "stop", realizedR: -1 }),
    row({ bias: "Neutral", status: "void", realizedR: null }),
    row({ bias: "Neutral", status: "void", realizedR: null }),
  ];

  it("drops void rows from the scorable set", () => {
    expect(scorableRows(rows)).toHaveLength(2);
  });

  it("keeps void rows out of hit rate, expectancy and totals", () => {
    const board = buildScoreboard(rows);
    expect(board.voided).toBe(2);
    expect(board.total).toBe(2);
    expect(board.decided).toBe(2);
    expect(board.hitRate).toBe(50);
    expect(board.expectancyR).toBe(0.5);
    expect(board.notes.some((n) => n.includes("no-direction"))).toBe(true);
  });
});
