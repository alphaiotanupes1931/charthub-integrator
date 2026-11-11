import { describe, it, expect } from "vitest";
import { autopilotRiskPct, evaluateRails, DEFAULT_AUTOPILOT_SETTINGS } from "@/lib/autopilot.shared";
import { RUNNER_BREAKEVEN_AT_TP1 } from "@/lib/stop-management.shared";
import { isUnderReview } from "@/lib/instrument-review";

const settings = { ...DEFAULT_AUTOPILOT_SETTINGS, minGrade: "ALL" as const, liveAcknowledged: true, allowedSymbols: [], maxOpenPositions: 8 };
const rail = (symbol: string, grade = "B") => evaluateRails(settings, { symbol, grade, openPositions: 0 });

describe("Nov 10 brief", () => {
  it("caps C trades at 0.25% risk", () => {
    expect(autopilotRiskPct(0.5, "C")).toBe(0.25);
    expect(autopilotRiskPct(0.5, "B")).toBe(0.5);
  });
  it("allows C trades through the rails when the minimum is ALL", () => {
    expect(rail("NAS100", "C").allowed).toBe(true);
  });
  it("keeps forex alert-only", () => {
    expect(rail("EUR/USD").allowed).toBe(false);
    expect(rail("XAU/USD").allowed).toBe(true);
  });
  it("keeps BTC and ETH off auto trading", () => {
    expect(rail("BTC/USD").allowed).toBe(false);
    expect(rail("ETH/USD").allowed).toBe(false);
  });
  it("holds GBP/USD under review", () => {
    expect(isUnderReview("GBP/USD")).toBe(true);
  });
  it("leaves breakeven at TP1 off", () => {
    expect(RUNNER_BREAKEVEN_AT_TP1).toBe(false);
  });
});
