import { describe, expect, it } from "vitest";
import {
  assignBand,
  compositeScore,
  evaluateVetoes,
  expectedNetR,
  legacyGrade,
  percentileOf,
  scoreFamilies,
  type ProgramInput,
} from "@/lib/scanner/score";
import { classifyInstrument, MIN_SAMPLE_FOR_BAND } from "@/lib/scanner/program";

// A New York-hours long on NAS100 with everything agreeing.
const base: ProgramInput = {
  symbol: "NAS100",
  timeframe: "1h",
  at: new Date("2026-01-14T15:00:00Z"),
  wantBull: true,
  ladder: [
    { label: "Monthly", bias: "bullish" },
    { label: "Weekly", bias: "bullish" },
    { label: "Daily", bias: "bullish" },
    { label: "4H", bias: "bullish" },
  ],
  h4Direction: "bullish",
  h4Trend: "up",
  closed4hCandles: 200,
  entryZoneQuality: 82,
  hasOrderBlock: true,
  hasFvg: true,
  hasHtfZone: true,
  protectedBreak: true,
  h1StructureBreak: "bullish",
  m15Confirmation: "bullish",
  sweptLiquidity: true,
  displacement: true,
  cvd: 1200,
  delta: 400,
  priceVsPoc: "above",
  volumeRatio: 1.4,
  costShare: 0.05,
  spreadPercentile: 40,
  plannedRR: 2,
  targetRoomOk: true,
};

describe("family scoring", () => {
  it("scores exactly one contribution per family", () => {
    const f = scoreFamilies(base);
    expect(Object.keys(f).sort()).toEqual(["execution", "location", "participation", "regime", "risk", "trigger"]);
    for (const s of Object.values(f)) {
      expect(s.score).toBeGreaterThanOrEqual(0);
      expect(s.score).toBeLessThanOrEqual(1);
      expect(s.basis).toBeTruthy();
    }
  });

  it("records the redundant order-block / fair-value-gap reads as detail, not extra score", () => {
    const withAll = scoreFamilies(base).location;
    const onlyBlock = scoreFamilies({ ...base, hasFvg: false, hasHtfZone: false }).location;
    expect(withAll.score).toBe(onlyBlock.score);
    expect(withAll.detail.length).toBeGreaterThan(onlyBlock.detail.length);
  });

  it("does not let cumulative delta and bar delta both score", () => {
    const both = scoreFamilies(base).participation;
    const cvdOnly = scoreFamilies({ ...base, delta: null }).participation;
    expect(both.score).toBe(cvdOnly.score);
  });

  it("collapses the higher-timeframe ladder into one regime score", () => {
    const aligned = scoreFamilies(base).regime.score;
    const split = scoreFamilies({
      ...base,
      ladder: [
        { label: "Monthly", bias: "bearish" },
        { label: "Weekly", bias: "bullish" },
        { label: "Daily", bias: "bullish" },
        { label: "4H", bias: "bullish" },
      ],
    }).regime.score;
    expect(aligned).toBeGreaterThan(split);
  });

  it("trusts index flow more than spot FX flow", () => {
    const idx = scoreFamilies({ ...base, symbol: "NAS100" }).participation.score;
    const fx = scoreFamilies({ ...base, symbol: "EUR/USD" }).participation.score;
    expect(idx).toBeGreaterThan(fx);
  });

  it("penalises an unprotected break of structure", () => {
    const good = scoreFamilies(base).location.score;
    const bad = scoreFamilies({ ...base, protectedBreak: false }).location.score;
    expect(bad).toBeLessThan(good);
  });
});

describe("vetoes", () => {
  it("passes a clean setup inside the liquid window", () => {
    expect(evaluateVetoes(base).filter((v) => v.mandatory)).toHaveLength(0);
  });

  it("vetoes when costs eat more than a quarter of the edge", () => {
    const v = evaluateVetoes({ ...base, costShare: 0.4 });
    expect(v.some((x) => x.code === "COST_SHARE_TOO_HIGH" && x.mandatory)).toBe(true);
  });

  it("vetoes stale or gapped data and missing higher-timeframe history", () => {
    const v = evaluateVetoes({ ...base, barStale: true, barGap: true, closed4hCandles: 4 });
    const codes = v.map((x) => x.code);
    expect(codes).toContain("DATA_STALE");
    expect(codes).toContain("DATA_GAP");
    expect(codes).toContain("NO_HTF_DATA");
  });

  it("vetoes a release landing inside the hold window and a missing target", () => {
    const v = evaluateVetoes({ ...base, newsInHoldWindow: true, targetRoomOk: false });
    expect(v.some((x) => x.code === "EVENT_BLACKOUT")).toBe(true);
    expect(v.some((x) => x.code === "NO_TARGET_ROOM")).toBe(true);
  });
});

describe("composite and expectancy", () => {
  it("stays inside 0 and 1 and rewards better evidence", () => {
    const spec = classifyInstrument("NAS100");
    const strong = compositeScore(scoreFamilies(base), spec);
    const weak = compositeScore(
      scoreFamilies({ ...base, entryZoneQuality: 10, hasOrderBlock: false, hasFvg: false, hasHtfZone: false, protectedBreak: false, m15Confirmation: "bearish", h1StructureBreak: "bearish", sweptLiquidity: false, displacement: false, cvd: -900, priceVsPoc: "below" }),
      spec,
    );
    expect(strong).toBeGreaterThan(weak);
    expect(strong).toBeLessThanOrEqual(1);
    expect(weak).toBeGreaterThanOrEqual(0);
  });

  it("widens the uncertainty band as the sample shrinks", () => {
    const small = expectedNetR({ composite: 0.8, plannedRR: 2, costR: 0.05, sample: 12 });
    const big = expectedNetR({ composite: 0.8, plannedRR: 2, costR: 0.05, sample: 800 });
    expect(small.netR).toBe(big.netR);
    expect(small.lowerBoundR).toBeLessThan(big.lowerBoundR);
  });

  it("subtracts costs from gross", () => {
    const e = expectedNetR({ composite: 0.7, plannedRR: 2, costR: 0.1, sample: 500 });
    expect(e.netR).toBeCloseTo(e.grossR - 0.1, 5);
  });
});

describe("band assignment", () => {
  const perfect = {
    percentile: 99,
    lowerBoundR: 0.6,
    families: scoreFamilies(base),
    costShare: 0.05,
    targetReachable: true,
    playbookEligible: true,
  };

  it("cannot issue A+ below the sample gate, and names the reason", () => {
    const r = assignBand({ ...perfect, sample: 55 });
    expect(r.band).not.toBe("A+");
    expect(r.aPlusFailed.join(" ")).toContain("resolved trades");
    expect(r.reasons.length).toBeGreaterThan(0);
  });

  it("issues A+ only when all six conditions hold, sample included", () => {
    const r = assignBand({ ...perfect, sample: MIN_SAMPLE_FOR_BAND });
    expect(r.band).toBe("A+");
    expect(r.aPlusFailed).toHaveLength(0);
  });

  it("refuses A+ on percentile alone when the R floor fails", () => {
    const r = assignBand({ ...perfect, sample: MIN_SAMPLE_FOR_BAND, lowerBoundR: 0.1 });
    expect(r.band).not.toBe("A+");
  });

  it("coarsens a fine band to its parent tier when the cell is thin", () => {
    const r = assignBand({ ...perfect, percentile: 80, lowerBoundR: 0.2, sample: 40 });
    expect(["A", "B", "C"]).toContain(r.band);
    expect(r.coarsened).toBe(true);
    expect(r.provisional).toBe(true);
  });

  it("marks a thin cell as not tradeable", () => {
    const r = assignBand({ ...perfect, sample: 5 });
    expect(r.tradeable).toBe(false);
  });
});

describe("percentiles and legacy mapping", () => {
  it("falls back to the composite when there is no distribution to rank against", () => {
    expect(percentileOf(0.7, [])).toBe(70);
  });

  it("ranks against a real distribution", () => {
    const dist = Array.from({ length: 100 }, (_, i) => i / 100);
    expect(percentileOf(0.9, dist)).toBeCloseTo(90, 0);
  });

  it("maps nine display bands onto the three validated tiers", () => {
    expect(legacyGrade("A+")).toBe("A+");
    expect(legacyGrade("A-")).toBe("A");
    expect(legacyGrade("B+")).toBe("B");
    expect(legacyGrade("C-")).toBe("C");
  });
});
