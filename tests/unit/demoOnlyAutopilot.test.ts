import { describe, it, expect } from "vitest";
import { demoOnlyRefusal } from "@/lib/autopilot-live.server";
import { gradeMeets } from "@/lib/autopilot.shared";

describe("demo-only auto-trading test", () => {
  it("blocks an order headed to a live account", () => {
    expect(demoOnlyRefusal("live", true)).not.toBeNull();
  });
  it("allows OANDA practice and TradeLocker demo", () => {
    expect(demoOnlyRefusal("practice", true)).toBeNull();
    expect(demoOnlyRefusal("demo", true)).toBeNull();
  });
  it("treats an unknown account as live", () => {
    expect(demoOnlyRefusal(null, true)).not.toBeNull();
  });
});

describe("A and B setups only (minimum grade B)", () => {
  it("takes A+, A and B", () => {
    expect(gradeMeets("A+", "B")).toBe(true);
    expect(gradeMeets("A", "B")).toBe(true);
    expect(gradeMeets("B", "B")).toBe(true);
  });
  it("skips C and D", () => {
    expect(gradeMeets("C", "B")).toBe(false);
    expect(gradeMeets("D", "B")).toBe(false);
  });
});
