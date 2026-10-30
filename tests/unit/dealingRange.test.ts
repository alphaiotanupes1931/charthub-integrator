import { describe, it, expect } from "vitest";
import { dealingRange, readPremiumDiscount, applyPremiumDiscount } from "@/lib/detector/dealing-range";
import { ruleMay } from "@/lib/analysis-models/evidence-tiers";

const bars = Array.from({ length: 40 }, (_, i) => ({ high: 110 - (i % 2), low: 90 + (i % 2) }));

describe("premium / discount", () => {
  it("equilibrium is the 50% line of the range", () => {
    expect(dealingRange(bars)).toEqual({ high: 110, low: 90, equilibrium: 100 });
  });
  it("a buy below 50% is discount, above is premium (wrong side)", () => {
    const r = dealingRange(bars)!;
    expect(readPremiumDiscount("Long", 95, r).correctSide).toBe(true);
    expect(readPremiumDiscount("Long", 105, r).correctSide).toBe(false);
    expect(readPremiumDiscount("Short", 105, r).correctSide).toBe(true);
  });
  it("wrong side caps the grade at C", () => {
    const r = dealingRange(bars)!;
    expect(applyPremiumDiscount("A", readPremiumDiscount("Long", 105, r), false).grade).toBe("C");
  });
  it("rule is record-only until results justify more", () => {
    expect(ruleMay("context.premium_discount", "grade")).toBe(false);
  });
});
