import { describe, expect, it } from "vitest";
import { buildTraderMemory } from "@/lib/trader-memory.shared";

describe("trader memory", () => {
  const scans = [
    { symbol: "EUR/USD", grade: "A", taken: true, status: "target", realizedR: 2 },
    { symbol: "EUR/USD", grade: "B", taken: true, status: "stop", realizedR: -1 },
    { symbol: "XAU/USD", grade: "A", taken: false, status: "target", realizedR: 2 },
  ];

  it("counts taken vs skipped and win rate on taken scans", () => {
    const m = buildTraderMemory(scans, [], []);
    expect(m.scans).toBe(3);
    expect(m.taken).toBe(2);
    expect(m.takenWinRate).toBe(0.5);
    expect(m.skippedWinners).toBe(1);
  });

  it("counts stop moves that still lost", () => {
    const m = buildTraderMemory([], [
      { symbol: "EUR/USD", result: "stop", stopMoved: true },
      { symbol: "EUR/USD", result: "tp", stopMoved: false },
    ], []);
    expect(m.stopMoves).toBe(1);
    expect(m.stopMoveLosses).toBe(1);
  });
});
