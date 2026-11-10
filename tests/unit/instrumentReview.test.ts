import { describe, expect, it } from "vitest";
import { isUnderReview } from "@/lib/instrument-review";
import { decideAlert } from "@/lib/signal-alerts.shared";
import { evaluateRails, DEFAULT_AUTOPILOT_SETTINGS } from "@/lib/autopilot.shared";

const plan = { grade: "A", bias: "long", entry: 1.3, stop: 1.29, tp1: 1.32, confidence: 70 };

describe("instruments under review", () => {
  it("GBP/USD is no longer held back (owner unblocked it Nov 9, 2026)", () => {
    expect(isUnderReview("GBP/USD")).toBe(false);
  });

  it("GBP/USD alerts again on an A grade", () => {
    expect(decideAlert({ plan, symbol: "GBP/USD", minGrade: "A", stale: false, quiet: false }))
      .toEqual({ alert: true });
  });

  it("GBP/USD can be traded automatically again", () => {
    const settings = {
      ...DEFAULT_AUTOPILOT_SETTINGS,
      allowedSymbols: ["GBP/USD"],
      liveAcknowledged: true,
      pausedReason: null,
    };
    const rails = evaluateRails(settings, { symbol: "GBP/USD", grade: "A", openPositions: 0 });
    expect(rails.reason ?? "").not.toMatch(/under review/);
  });
});
