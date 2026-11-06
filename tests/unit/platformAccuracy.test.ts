import { describe, expect, it } from "vitest";
import { measuredRate } from "@/lib/platform-accuracy.shared";

describe("real outcome accuracy rate", () => {
  it("computes 17 targets out of 50 decided scans as 34 percent", () => expect(measuredRate(17, 33)).toBe(34));
  it("does not invent a zero percent win rate without settled trades", () => expect(measuredRate(0, 0)).toBeNull());
  it("computes winning executed trades separately", () => expect(measuredRate(3, 1)).toBe(75));
});