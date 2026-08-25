import { describe, it, expect } from "vitest";
import { validateLevels, rescaleToReference, parseStatedLevels, levelCheckBlock } from "@/lib/levelValidation";

describe("level validation", () => {
  it("catches a decimal-place typo against the live price", () => {
    expect(rescaleToReference(740, 7400)).toBe(7400);
    const issues = validateLevels({ side: "Long", entry: 740, lastPrice: 7400 });
    expect(issues.some((i) => i.field === "entry" && i.severity === "error" && i.suggestedValue === 7400)).toBe(true);
  });

  it("leaves sane levels alone", () => {
    expect(validateLevels({ side: "Long", entry: 2400, stop: 2390, target: 2425, lastPrice: 2401, atr: 12 })).toEqual([]);
  });

  it("flags a stop on the wrong side and offers a mirror", () => {
    const issues = validateLevels({ side: "Long", entry: 100, stop: 105 });
    const stop = issues.find((i) => i.field === "stop");
    expect(stop?.severity).toBe("error");
    expect(stop?.suggestedValue).toBe(95);
  });

  it("flags stop equals entry", () => {
    const issues = validateLevels({ side: "Long", entry: 100, stop: 100, atr: 2 });
    expect(issues.some((i) => /no defined risk/.test(i.message))).toBe(true);
  });

  it("flags a target that would close at a loss", () => {
    const issues = validateLevels({ side: "Short", entry: 100, stop: 103, target: 110 });
    const t = issues.find((i) => i.field === "target");
    expect(t?.severity).toBe("error");
    expect(t?.suggestedValue).toBe(94);
  });

  it("warns on sub-1R plans", () => {
    const issues = validateLevels({ side: "Long", entry: 100, stop: 98, target: 100.5 });
    expect(issues.some((i) => i.field === "plan" && /Reward to risk/.test(i.message))).toBe(true);
  });

  it("warns when entry is far from price", () => {
    const issues = validateLevels({ side: "Long", entry: 120, lastPrice: 100, atr: 1 });
    expect(issues.some((i) => i.field === "entry" && i.severity === "warning")).toBe(true);
  });

  it("parses stated levels from chat text", () => {
    const got = parseStatedLevels("my entry is 2,412.50 with stop 2400 and tp 2450 short");
    expect(got.entry).toBe(2412.5);
    expect(got.stop).toBe(2400);
    expect(got.target).toBe(2450);
  });

  it("builds a prompt block only when something is wrong", () => {
    expect(levelCheckBlock({ side: "Long", entry: 100, stop: 98, target: 104 })).toBeNull();
    expect(levelCheckBlock({ side: "Long", entry: 100, stop: 101 })).toContain("LEVEL CHECK");
  });
});
