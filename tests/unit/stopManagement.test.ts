import { describe, it, expect } from "vitest";
import { desiredRunnerStop } from "@/lib/stop-management.shared";

// US30 example: entry 52429.7, risk ~136.5 (TP1 at +1.5R = 52634.5)
const base = { long: true, entry: 52429.7, stop: 52293.2, risk: 136.5, breakEven: true, trail: true };

describe("runner stop after TP1", () => {
  it("moves to break-even, not TP1, right after TP1", () => {
    expect(desiredRunnerStop({ ...base, price: 52640 })).toBe(52429.7);
  });
  it("does not trail at 2R", () => {
    expect(desiredRunnerStop({ ...base, stop: 52429.7, price: 52429.7 + 136.5 * 2 })).toBeNull();
  });
  it("trails 1.5R behind once 3R ahead", () => {
    const price = 52429.7 + 136.5 * 3;
    expect(desiredRunnerStop({ ...base, stop: 52429.7, price })).toBeCloseTo(price - 136.5 * 1.5);
  });
});
