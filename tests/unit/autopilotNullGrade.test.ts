// Blocking safety check from the sweep-gate addendum: a HOLD / null grade must
// never clear Autopilot's minimum-grade rail. Asserted, not assumed.
import { describe, expect, it } from "vitest";
import { DEFAULT_AUTOPILOT_SETTINGS, evaluateRails, gradeMeets } from "@/lib/autopilot.shared";
import { gradeMeets as botGradeMeets } from "@/lib/paper-bot.server";

const live = {
  ...DEFAULT_AUTOPILOT_SETTINGS,
  mode: "auto" as const,
  liveAcknowledged: true,
  allowedSymbols: [],
};

const NOT_GRADES = [null, undefined, "", "null", "undefined", "HOLD", "NO ENTRY", "none", " ", "Z"];

describe("minimum-grade rail fails closed", () => {
  for (const min of ["A+", "A", "B"] as const) {
    for (const g of NOT_GRADES) {
      it(`grade ${JSON.stringify(g)} vs min ${min} is refused`, () => {
        expect(gradeMeets(g as string | null, min)).toBe(false);
        const v = evaluateRails({ ...live, minGrade: min }, { symbol: "EUR/USD", grade: g as string | null, openPositions: 0 });
        expect(v.allowed).toBe(false);
      });
    }
  }

  it("an unknown or missing minimum refuses instead of defaulting", () => {
    expect(gradeMeets("A+", "")).toBe(false);
    expect(gradeMeets("A+", null)).toBe(false);
    expect(gradeMeets("A+", "garbage")).toBe(false);
  });

  it("real grades still work", () => {
    expect(gradeMeets("A+", "A")).toBe(true);
    expect(gradeMeets("A", "A")).toBe(true);
    expect(gradeMeets("B", "A")).toBe(false);
    expect(evaluateRails({ ...live, minGrade: "A" }, { symbol: "EUR/USD", grade: "A", openPositions: 0 }).allowed).toBe(true);
  });

  it("paper bots refuse null grades and unknown minimums", () => {
    for (const g of NOT_GRADES) expect(botGradeMeets(g as string | null, "A")).toBe(false);
    expect(botGradeMeets("A+", "")).toBe(false);
    expect(botGradeMeets("A+", "NO ENTRY")).toBe(false);
    expect(botGradeMeets("A+", "A")).toBe(true);
  });
});
