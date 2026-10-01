import { describe, it, expect } from "vitest";
import { breakdown, variantR, type LossRow } from "@/lib/instrument-loss-breakdown";

const row = (p: Partial<LossRow>): LossRow => ({
  symbol: "XAU/USD", status: "stop", side: "long", netR: -1.05, costR: 0.05, mfeR: 0.2, createdAt: "2026-09-01", ...p,
});

describe("instrument loss breakdown", () => {
  it("scratches a stopped trade that reached 1R under break-even", () => {
    expect(variantR(row({ mfeR: 1.2 }), "be_at_1r")).toBeCloseTo(-0.05);
    expect(variantR(row({ mfeR: 0.4 }), "be_at_1r")).toBeCloseTo(-1.05);
  });
  it("pays 1R minus cost at a fixed 1R target", () => {
    expect(variantR(row({ mfeR: 1 }), "tp_1r")).toBeCloseTo(0.95);
  });
  it("excludes non-decided rows and flags small cells", () => {
    const b = breakdown([row({}), row({ status: "void" }), row({ status: "unfilled" })], "XAU/USD");
    expect(b.byVariant.base.pooled.n).toBe(1);
    expect(b.byVariant.base.pooled.enough).toBe(false);
    expect(b.comparisonsRun).toBe(9);
  });
});
