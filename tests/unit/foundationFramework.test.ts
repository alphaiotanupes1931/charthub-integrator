import { describe, expect, it } from "vitest";
import {
  FOUNDATION_LESSONS,
  SIX_DIMENSIONS,
  drawdownAfterLosses,
  foundationFrameworkForPrompt,
  meetsSixDimensionGate,
  positionSize,
} from "@/lib/analysis-models/foundation-framework";
import {
  CLASSIC_RESEARCH_RULEBOOK,
  classicResearchRulebookForPrompt,
} from "@/lib/analysis-models/classic-research-rulebook";

describe("six-dimension gate", () => {
  it("passes with structure, risk and two others strong", () => {
    const r = meetsSixDimensionGate({ structure: 5, risk: 4, momentum: 4, session: 4, confluence: 2 });
    expect(r.pass).toBe(true);
  });

  it("fails without structure however good the rest is", () => {
    expect(
      meetsSixDimensionGate({ structure: 3, risk: 5, momentum: 5, session: 5, confluence: 5 }).pass,
    ).toBe(false);
  });

  it("fails without risk", () => {
    expect(meetsSixDimensionGate({ structure: 5, risk: 2, momentum: 5, session: 5 }).pass).toBe(false);
  });

  it("fails on only one other strong dimension", () => {
    const r = meetsSixDimensionGate({ structure: 5, risk: 5, momentum: 5 });
    expect(r.pass).toBe(false);
    expect(r.reason).toContain("only 1");
  });

  it("keeps all six dimensions in teaching order", () => {
    expect(SIX_DIMENSIONS.map((d) => d.id)).toEqual([
      "structure",
      "momentum",
      "risk",
      "confluence",
      "session",
      "track-record",
    ]);
  });
});

describe("sizing from the invalidation distance", () => {
  it("halves size when the stop is twice as far", () => {
    const near = positionSize({ accountBalance: 10_000, riskPercent: 1, entry: 2000, invalidation: 1980 });
    const far = positionSize({ accountBalance: 10_000, riskPercent: 1, entry: 2000, invalidation: 1960 });
    expect(near!.riskDollars).toBe(100);
    expect(far!.riskDollars).toBe(100);
    expect(far!.units).toBeCloseTo(near!.units / 2, 6);
  });

  it("refuses a zero-distance stop", () => {
    expect(positionSize({ accountBalance: 10_000, riskPercent: 1, entry: 2000, invalidation: 2000 })).toBeNull();
  });

  it("prices six losses in a row", () => {
    expect(drawdownAfterLosses(1, 6)).toBeCloseTo(5.9, 1);
    expect(drawdownAfterLosses(5, 6)).toBeCloseTo(26.5, 1);
  });
});

describe("what the coach is told", () => {
  it("teaches all seven days", () => {
    expect(FOUNDATION_LESSONS).toHaveLength(7);
    const prompt = foundationFrameworkForPrompt();
    for (const l of FOUNDATION_LESSONS) expect(prompt).toContain(l.title);
  });

  it("forbids an undated win rate in both the coach material and the Classic research rules", () => {
    expect(foundationFrameworkForPrompt()).toContain("Never quote a win rate");
    expect(CLASSIC_RESEARCH_RULEBOOK.some((r) => r.id === "no-undated-win-rates")).toBe(true);
    expect(classicResearchRulebookForPrompt()).toContain("sample size");
  });

  it("keeps the new Classic material research-only", () => {
    const prompt = classicResearchRulebookForPrompt();
    expect(prompt).toContain("must not change live Classic outputs");
    expect(prompt).toContain("Six-dimension setup score");
  });
});
