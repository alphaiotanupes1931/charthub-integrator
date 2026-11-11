import { describe, it, expect } from "vitest";
import { pipSize, pipsBetween } from "@/lib/pips.shared";
import { sizingEquity } from "@/lib/autopilot.shared";

describe("pips", () => {
  it("EUR/USD 1.1000 -> 1.1025 long is +25 pips", () => expect(pipsBetween("EUR/USD", 1.1, 1.1025, "Long")).toBe(25));
  it("USD/JPY uses 0.01", () => expect(pipSize("USD/JPY")).toBe(0.01));
  it("gold uses 0.10", () => expect(pipsBetween("XAU/USD", 4000, 4005, "Long")).toBe(50));
  it("US30 short falling 100 points is +100", () => expect(pipsBetween("US30", 47000, 46900, "Short")).toBe(100));
});

describe("sizing balance", () => {
  it("uses the $10,000 override instead of a $500,000 broker balance", () => expect(sizingEquity(500000, 10000)).toBe(10000));
  it("falls back to broker balance when unset", () => expect(sizingEquity(500000, null)).toBe(500000));
});
