import { describe, expect, it } from "vitest";
import { instrumentReview, isUnderReview } from "@/lib/instrument-review";
import { decideAlert } from "@/lib/signal-alerts.shared";
import { evaluateRails, DEFAULT_AUTOPILOT_SETTINGS } from "@/lib/autopilot.shared";

const plan = { grade: "A", bias: "long", entry: 1.3, stop: 1.29, tp1: 1.32, confidence: 70 };

describe("instruments under review", () => {
  it("flags the pound and states what was measured", () => {
    const review = instrumentReview("gbp/usd");
    expect(review?.symbol).toBe("GBP/USD");
    expect(review?.evidence).toMatch(/held-out/);
    expect(isUnderReview("EUR/USD")).toBe(false);
  });

  it("blocks alerts for an instrument under review even on an A grade", () => {
    expect(decideAlert({ plan, symbol: "GBP/USD", minGrade: "A", stale: false, quiet: false }))
      .toEqual({ alert: false, reason: "GBP/USD is under review" });
  });

  it("still alerts on instruments that are not under review", () => {
    expect(decideAlert({ plan, symbol: "EUR/USD", minGrade: "A", stale: false, quiet: false }))
      .toEqual({ alert: true });
  });

  it("blocks automatic orders for an instrument under review", () => {
    const settings = {
      ...DEFAULT_AUTOPILOT_SETTINGS,
      allowedSymbols: ["GBP/USD"],
      liveAcknowledged: true,
      pausedReason: null,
    };
    const rails = evaluateRails(settings, { symbol: "GBP/USD", grade: "A", openPositions: 0 });
    expect(rails.allowed).toBe(false);
    expect(rails.reason).toMatch(/under review/);
  });
});
