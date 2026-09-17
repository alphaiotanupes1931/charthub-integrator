import { describe, expect, it } from "vitest";
import { costInR, hasCostModel, netOfCosts, roundTripCost } from "@/lib/trading-costs";

describe("trading costs", () => {
  it("uses the same price cost for display and raw OANDA names", () => {
    expect(roundTripCost("XAU/USD", 2400)).toBeCloseTo(roundTripCost("XAU_USD", 2400), 10);
  });

  it("falls back to a fraction of price for unmeasured instruments", () => {
    expect(hasCostModel("CORN_USD")).toBe(false);
    expect(roundTripCost("CORN_USD", 500)).toBeCloseTo(0.1, 10);
  });

  it("charges a tight stop more R than a wide one for the same spread", () => {
    const tight = costInR("XAU/USD", 2400, 1.1 * 10);
    const wide = costInR("XAU/USD", 2400, 1.5 * 10);
    expect(tight).toBeGreaterThan(wide);
  });

  it("subtracts cost from gross R", () => {
    const risk = 15;
    const expected = 1.5 - costInR("XAU/USD", 2400, risk);
    expect(netOfCosts(1.5, "XAU/USD", 2400, risk)).toBeCloseTo(expected, 3);
  });

  it("returns zero cost when there is no risk distance to divide by", () => {
    expect(costInR("EUR/USD", 1.1, 0)).toBe(0);
  });
});
