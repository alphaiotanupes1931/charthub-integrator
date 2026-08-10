import { describe, it, expect } from "vitest";
import { countEvidence, gradeFromEvidence } from "@/lib/agents/planner.server";
import type { MarketSnapshot, ResearchMemo } from "@/lib/agents/types";

const snap = (bull: boolean): MarketSnapshot => ({
  ticker: "XAU/USD", interval: "60", lastPrice: 3400, candles: [], source: "yahoo",
  stats: { atr14: 10 } as never,
  cisd: { state: bull ? "bullish" : "bearish", htfBias: bull ? "bullish" : "bearish" } as never,
  mtf: {
    alignment: bull ? "aligned-long" : "aligned-short",
    h4: { direction: bull ? "bullish" : "bearish", trend: "up" },
    h1: { structureBreak: bull ? "bullish BOS" : "bearish BOS" },
    m15: { confirmation: bull ? "bullish retest" : "bearish retest" },
    ladder: [
      { label: "Monthly", bias: bull ? "bullish" : "bearish" },
      { label: "Weekly", bias: bull ? "bullish" : "bearish" },
      { label: "Daily", bias: bull ? "bullish" : "bearish" },
    ],
  } as never,
  orderFlow: { cvd: bull ? 500 : -500, delta: bull ? 20 : -20, priceVsPoc: bull ? "above" : "below" } as never,
} as unknown as MarketSnapshot);

const memo = (bull: boolean): ResearchMemo => ({ consensus: bull ? "bullish" : "bearish" } as ResearchMemo);

describe("countEvidence", () => {
  it("is 0 for no-entry and neutral", () => {
    expect(countEvidence(snap(true), memo(true), "NO ENTRY", "Long", 3)).toBe(0);
    expect(countEvidence(snap(true), memo(true), "A", "Neutral", 3)).toBe(0);
  });

  it("caps below 100 even when everything aligns", () => {
    const v = countEvidence(snap(true), memo(true), "A+", "Long", 3);
    expect(v).toBe(90);
  });

  it("scores a counter-trend trade low", () => {
    const v = countEvidence(snap(true), memo(true), "C", "Short", 1.2);
    expect(v).toBe(25);
  });

  it("does not floor by grade", () => {
    const aPlusAgainst = countEvidence(snap(false), memo(false), "A+", "Long", 1);
    expect(aPlusAgainst).toBeLessThan(40);
  });
});

describe("gradeFromEvidence", () => {
  it("varies the grade with measured evidence", () => {
    expect(gradeFromEvidence("Long", 90, snap(true))).toBe("A+");
    expect(gradeFromEvidence("Long", 72, snap(true))).toBe("A");
    expect(gradeFromEvidence("Long", 60, snap(true))).toBe("B");
    expect(gradeFromEvidence("Long", 40, snap(true))).toBe("C");
  });

  it("does not let a missing MTF read claim a high grade", () => {
    const withoutMtf = { ...snap(true), mtf: undefined };
    expect(gradeFromEvidence("Long", 90, withoutMtf)).toBe("C");
  });

  it("returns no entry only when direction is neutral", () => {
    expect(gradeFromEvidence("Neutral", 90, snap(true))).toBe("NO ENTRY");
  });
});
