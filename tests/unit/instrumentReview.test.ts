import { describe, expect, it } from "vitest";
import { isUnderReview } from "@/lib/instrument-review";
import { decideAlert } from "@/lib/signal-alerts.shared";

const plan = { grade: "A", bias: "long", entry: 1.3, stop: 1.29, tp1: 1.32, confidence: 70 };

describe("instruments under review", () => {
  it("GBP/USD is held back again (Nov 10, 2026 brief)", () => {
    expect(isUnderReview("GBP/USD")).toBe(true);
  });
  it("GBP/USD does not alert while under review", () => {
    expect(decideAlert({ plan, symbol: "GBP/USD", minGrade: "A", stale: false, quiet: false }).alert).toBe(false);
  });
});
