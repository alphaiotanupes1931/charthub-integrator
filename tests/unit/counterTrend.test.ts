import { describe, it, expect } from "vitest";
import { counterTrendRead, gradeFromEvidence } from "@/lib/agents/planner.server";
import { journalOutcome, journalAsSignalRecords } from "@/lib/journalLearning";
import { buildLearningReport } from "@/lib/signalLearning";

const snap = (o: { dailyBias: string; h4: string; h4Structure?: string }) =>
  ({
    lastPrice: 100,
    cisd: { htfBias: o.dailyBias },
    mtf: {
      h4: { direction: o.h4, trend: o.h4 === "bullish" ? "up" : "down", keyLevels: { support: [], resistance: [] }, supplyDemand: { supply: [], demand: [] } },
      h1: { structureBreak: "bearish", reversal: "none", orderBlocks: { bull: [], bear: [] }, fvg: { bull: [], bear: [] }, liquidity: { buyside: [], sellside: [] } },
      m15: { confirmation: "bearish", reason: "CISD flip" },
      alignment: "mixed",
      ladder: [
        { label: "Daily", interval: "D", bias: o.dailyBias, trend: "up", structure: "bullish", last: 100, high: 101, low: 99, changePct: 0.2, bars: 200 },
        { label: "4H", interval: "240", bias: o.h4, trend: "up", structure: o.h4Structure ?? "bullish", last: 100, high: 101, low: 99, changePct: 0.1, bars: 200 },
      ],
    },
  }) as never;

describe("counter-trend guard", () => {
  it("caps a short into a bullish Daily and 4H at C", () => {
    const s = snap({ dailyBias: "bullish", h4: "bullish" });
    const read = counterTrendRead("Short", s);
    expect(read.counterTrend).toBe(true);
    expect(read.cap).toBe("C");
    // Time Frame Combo is now a hard gate: fighting the 4H direction is no trade.
    expect(gradeFromEvidence("Short", 90, s)).toBe("NO ENTRY");
  });

  it("allows up to A when higher-timeframe structure has broken bearish", () => {
    const s = snap({ dailyBias: "bullish", h4: "bullish", h4Structure: "bearish" });
    expect(counterTrendRead("Short", s).cap).toBe("A");
    expect(gradeFromEvidence("Short", 95, s)).not.toBe("A+");
  });

  it("leaves with-trend setups alone", () => {
    const s = snap({ dailyBias: "bullish", h4: "bullish" });
    expect(counterTrendRead("Long", s).counterTrend).toBe(false);
  });
});

describe("journal outcomes feed learning", () => {
  it("treats exit equal to entry with no badge as still open", () => {
    expect(journalOutcome({ id: "1", symbol: "XAG/USD", side: "Short", entry: 69, exit: 69 })).toBe(null);
  });

  it("resolves a stopped-out short as a loss and scores it", () => {
    const trades = Array.from({ length: 3 }, (_, i) => ({
      id: `t${i}`, symbol: "XAG/USD", side: "Short" as const, timeframe: "1H",
      entry: 69, exit: 69.2, stop: 69.2, takeProfit: 68.5, result: "stop" as const, createdAt: Date.now(),
    }));
    const recs = journalAsSignalRecords(trades);
    expect(recs).toHaveLength(3);
    const r = buildLearningReport(recs);
    expect(r.graded).toBe(3);
    expect(r.losses).toBe(3);
    expect(r.expectancyR).toBe(-1);
    expect(r.bySymbol[0].key).toBe("XAG/USD");
  });
});
