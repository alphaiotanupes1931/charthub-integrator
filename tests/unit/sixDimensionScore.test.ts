import { describe, expect, it } from "vitest";
import {
  classifyStructuralState,
  levelQuality,
  scoreSixDimensions,
  positionSize,
  drawdownAfterLosses,
  STRONG,
  TRACK_RECORD_FLOOR,
  type SixDimensionInput,
} from "@/lib/six-dimension-score";

const strongSetup: SixDimensionInput = {
  bias: "bullish",
  weekly: "bullish",
  daily: "bullish",
  fourHourTrend: "up",
  oneHour: "bullish",
  fifteenMinute: "bullish",
  structuralState: "markup",
  atrRatio: 1.2,
  directionalCloseShare: 0.8,
  orderFlowAgrees: true,
  orderFlowWeight: 1,
  orderFlowConfidence: "high",
  entry: 100,
  stop: 99,
  firstTarget: 103,
  sizeDerivedFromInvalidation: true,
  levels: [
    { price: 99.5, reactionCount: 3, formedInLiquidSession: true, timeframe: "D" },
    { price: 98, reactionCount: 2, formedInLiquidSession: true, timeframe: "4H" },
  ],
  independentReasons: ["daily demand", "dollar weakness"],
  sessionQuality: 1,
  sessionReason: "Inside the London/NY overlap",
  trackRecord: { sample: 60, expectancyR: 0.4 },
};

describe("structural state", () => {
  it("names markup and markdown from trend alone", () => {
    expect(classifyStructuralState({ trend: "up" }).state).toBe("markup");
    expect(classifyStructuralState({ trend: "down" }).state).toBe("markdown");
  });

  it("refuses to guess between accumulation and distribution without volume", () => {
    const read = classifyStructuralState({ trend: "range" });
    expect(read.state).toBe("transitioning");
    expect(read.confident).toBe(false);
  });

  it("separates them once volume location is known", () => {
    expect(classifyStructuralState({ trend: "range", volumeAtLows: 0.6, volumeAtHighs: 0.2 }).state).toBe("accumulation");
    expect(classifyStructuralState({ trend: "range", volumeAtLows: 0.2, volumeAtHighs: 0.6 }).state).toBe("distribution");
    expect(classifyStructuralState({ trend: "range", volumeAtLows: 0.4, volumeAtHighs: 0.4 }).state).toBe("transitioning");
  });
});

describe("level quality", () => {
  it("scores a single touch as nothing", () => {
    expect(levelQuality({ price: 1, reactionCount: 1, formedInLiquidSession: true, timeframe: "W" }).score).toBe(0);
  });

  it("ranks a weekly level above a 15-minute one", () => {
    const weekly = levelQuality({ price: 1, reactionCount: 3, formedInLiquidSession: true, timeframe: "W" }).score;
    const small = levelQuality({ price: 1, reactionCount: 3, formedInLiquidSession: true, timeframe: "15M" }).score;
    expect(weekly).toBeGreaterThan(small);
  });

  it("discounts a level formed in dead hours", () => {
    const liquid = levelQuality({ price: 1, reactionCount: 2, formedInLiquidSession: true, timeframe: "D" }).score;
    const dead = levelQuality({ price: 1, reactionCount: 2, formedInLiquidSession: false, timeframe: "D" }).score;
    expect(dead).toBeLessThan(liquid);
  });
});

describe("six dimension scoring", () => {
  it("passes the gate on a fully aligned setup and grades it top of the range", () => {
    const r = scoreSixDimensions(strongSetup);
    expect(r.gatePassed).toBe(true);
    expect(["A", "A+"]).toContain(r.shadowGrade);
    expect(r.total).toBeLessThanOrEqual(30);
  });

  it("caps structure when the trade opposes weekly structure", () => {
    const against = scoreSixDimensions({ ...strongSetup, weekly: "bearish" });
    expect(against.dimensions.find((d) => d.id === "structure")!.score).toBeLessThanOrEqual(1);
    expect(against.gatePassed).toBe(false);
  });

  it("caps structure for buying into distribution", () => {
    const r = scoreSixDimensions({ ...strongSetup, fourHourTrend: "range", structuralState: "distribution" });
    expect(r.dimensions.find((d) => d.id === "structure")!.score).toBeLessThanOrEqual(1);
  });

  it("scores risk at zero with no invalidation, and never passes the gate", () => {
    const r = scoreSixDimensions({ ...strongSetup, stop: null, firstTarget: null });
    expect(r.dimensions.find((d) => d.id === "risk")!.score).toBe(0);
    expect(r.gatePassed).toBe(false);
  });

  it("rewards size derived from the invalidation distance", () => {
    const derived = scoreSixDimensions(strongSetup).dimensions.find((d) => d.id === "risk")!.score;
    const not = scoreSixDimensions({ ...strongSetup, sizeDerivedFromInvalidation: false }).dimensions.find((d) => d.id === "risk")!.score;
    expect(derived).toBeGreaterThan(not);
    expect(not).toBeLessThan(STRONG);
  });

  it("scores session zero outside liquid hours and says structure cannot rescue it", () => {
    const r = scoreSixDimensions({ ...strongSetup, sessionQuality: 0, sessionReason: "Outside liquid hours" });
    expect(r.dimensions.find((d) => d.id === "session")!.score).toBe(0);
    expect(r.notes.join(" ")).toMatch(/liquid hours/);
  });

  it("scores track record zero below the sample floor rather than inventing one", () => {
    const r = scoreSixDimensions({ ...strongSetup, trackRecord: { sample: TRACK_RECORD_FLOOR - 1, expectancyR: 1.5 } });
    const dim = r.dimensions.find((d) => d.id === "track-record")!;
    expect(dim.score).toBe(0);
    expect(dim.unmeasured).toBe(true);
  });

  it("does not let a single drifting dimension pass as a trade", () => {
    const drifting = scoreSixDimensions({
      ...strongSetup,
      directionalCloseShare: 0.2,
      atrRatio: 0.6,
      orderFlowAgrees: false,
      sessionQuality: 0.2,
      trackRecord: null,
      levels: [{ price: 1, reactionCount: 1, formedInLiquidSession: false, timeframe: "15M" }],
      independentReasons: [],
    });
    expect(drifting.gatePassed).toBe(false);
    expect(["C", "D", "F"]).toContain(drifting.shadowGrade);
  });
});

describe("sizing", () => {
  it("keeps the money risk constant as the stop widens", () => {
    const tight = positionSize({ accountBalance: 10000, riskPercent: 1, entry: 100, invalidation: 99 })!;
    const wide = positionSize({ accountBalance: 10000, riskPercent: 1, entry: 100, invalidation: 98 })!;
    expect(tight.riskDollars).toBeCloseTo(wide.riskDollars);
    expect(wide.units).toBeLessThan(tight.units);
  });

  it("states what six losses in a row actually costs", () => {
    expect(drawdownAfterLosses(1, 6)).toBeLessThan(6);
    expect(drawdownAfterLosses(5, 6)).toBeGreaterThan(20);
  });
});
