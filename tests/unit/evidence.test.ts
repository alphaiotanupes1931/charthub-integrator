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
    h1: { structureBreak: bull ? "bullish" : "bearish" },
    m15: { confirmation: bull ? "bullish" : "bearish", reason: "test confirmation" },
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
    // 4H+1H agreement and the 15m confirmation now count as confirmation
    // quality; the missing piece here is an aligned 1H/4H zone.
    expect(v).toBe(85);
  });

  it("scores a counter-trend trade low", () => {
    const v = countEvidence(snap(true), memo(true), "C", "Short", 1.2);
    expect(v).toBe(25);
  });

  it("does not floor by grade", () => {
    const aPlusAgainst = countEvidence(snap(false), memo(false), "A+", "Long", 1);
    expect(aPlusAgainst).toBeLessThan(40);
  });

  it("credits top-down agreement but still scores a thin tape below an A", () => {
    const cascadeOnly = {
      ...snap(true),
      cisd: { ...snap(true).cisd, state: "none" },
      orderFlow: undefined,
      mtf: {
        ...snap(true).mtf,
        ladder: [
          { label: "Monthly", bias: "neutral" },
          { label: "Weekly", bias: "neutral" },
          { label: "Daily", bias: "neutral" },
        ],
      },
    } as MarketSnapshot;
    const neutralMemo = { ...memo(true), consensus: "neutral" } as ResearchMemo;
    const v = countEvidence(cascadeOnly, neutralMemo, "A", "Long", 3);
    expect(v).toBeGreaterThan(25);
    expect(v).toBeLessThan(74);
  });
});

describe("gradeFromEvidence", () => {
  it("varies the grade with measured evidence", () => {
    expect(gradeFromEvidence("Long", 90, snap(true))).toBe("A+");
    expect(gradeFromEvidence("Long", 76, snap(true))).toBe("A");
    expect(gradeFromEvidence("Long", 72, snap(true))).toBe("B");
    expect(gradeFromEvidence("Long", 60, snap(true))).toBe("B");
    expect(gradeFromEvidence("Long", 40, snap(true))).toBe("C");
  });

  it("caps a setup whose 1H has broken against it", () => {
    const mixed = {
      ...snap(true),
      mtf: { ...snap(true).mtf, alignment: "mixed", h1: { structureBreak: "bearish" } },
    } as MarketSnapshot;
    expect(gradeFromEvidence("Long", 82, mixed)).toBe("C");
  });

  it("caps a mixed 1H trend at B", () => {
    const mixed = {
      ...snap(true),
      mtf: {
        ...snap(true).mtf,
        alignment: "mixed",
        ladder: [...(snap(true).mtf?.ladder ?? []), { label: "1H", bias: "bearish", trend: "down" }],
      },
    } as unknown as MarketSnapshot;
    expect(gradeFromEvidence("Long", 90, mixed)).toBe("B");
  });

  it("caps a setup whose order flow opposes it", () => {
    const against = {
      ...snap(true),
      orderFlow: { bias: "bearish", delta: -900, deltaAvg: -100, cvdSlope: -5, estimated: false },
    } as unknown as MarketSnapshot;
    expect(gradeFromEvidence("Long", 90, against)).toBe("C");
  });


  it("does not let a missing MTF read claim a high grade", () => {
    const withoutMtf = { ...snap(true), mtf: undefined };
    expect(gradeFromEvidence("Long", 90, withoutMtf)).toBe("C");
  });

  it("returns no entry only when direction is neutral", () => {
    expect(gradeFromEvidence("Neutral", 90, snap(true))).toBe("NO ENTRY");
  });
});
