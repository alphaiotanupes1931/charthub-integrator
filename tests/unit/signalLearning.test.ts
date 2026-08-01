import { describe, it, expect } from "vitest";
import { buildLearningReport, buildLearningPromptBlock, plannedR, realisedR, sessionForHourUtc } from "@/lib/signalLearning";
import type { SignalRecord } from "@/lib/signalHistory";

const mk = (o: Partial<SignalRecord>): SignalRecord => ({
  id: Math.random().toString(36).slice(2), at: Date.parse("2026-01-05T14:00:00Z"),
  symbol: "XAU/USD", interval: "60", grade: "A", bias: "Long",
  entry: 100, stop: 98, tp1: 104, source: "engine", taken: true, outcome: "win", ...o,
});

describe("signal learning", () => {
  it("computes planned and realised R", () => {
    expect(plannedR(mk({}))).toBe(2);
    expect(realisedR(mk({ outcome: "win" }))).toBe(2);
    expect(realisedR(mk({ outcome: "loss" }))).toBe(-1);
    expect(realisedR(mk({ outcome: "breakeven" }))).toBe(0);
  });

  it("ignores signals that were not taken or not tagged", () => {
    const r = buildLearningReport([mk({ taken: false }), mk({ outcome: null })]);
    expect(r.graded).toBe(0);
    expect(buildLearningPromptBlock(r)).toContain("not tagged any taken signal");
  });

  it("measures win rate and expectancy", () => {
    const recs = [mk({ outcome: "win" }), mk({ outcome: "win" }), mk({ outcome: "loss" }), mk({ outcome: "loss" })];
    const r = buildLearningReport(recs);
    expect(r.graded).toBe(4);
    expect(r.winRate).toBe(50);
    expect(r.expectancyR).toBe(0.5); // (2+2-1-1)/4
  });

  it("flags a losing bucket", () => {
    const bad = Array.from({ length: 4 }, () => mk({ symbol: "BTC/USD", outcome: "loss" }));
    const good = Array.from({ length: 4 }, () => mk({ symbol: "XAU/USD", outcome: "win" }));
    const r = buildLearningReport([...bad, ...good]);
    const btc = r.bySymbol.find((b) => b.key === "BTC/USD")!;
    expect(btc.expectancyR).toBe(-1);
    expect(r.worst.some((b) => b.key === "BTC/USD")).toBe(true);
    expect(r.lessons.join(" ")).toContain("BTC/USD");
    const block = buildLearningPromptBlock(r);
    expect(block).toContain("BY SYMBOL");
    expect(block).toContain("LOSING BUCKETS");
  });

  it("buckets sessions by UTC hour", () => {
    expect(sessionForHourUtc(23)).toBe("Sydney");
    expect(sessionForHourUtc(3)).toBe("Tokyo");
    expect(sessionForHourUtc(9)).toBe("London");
    expect(sessionForHourUtc(14)).toBe("London/NY overlap");
    expect(sessionForHourUtc(19)).toBe("New York");
  });
});
