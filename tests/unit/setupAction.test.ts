import { describe, it, expect } from "vitest";
import { setupAction } from "@/lib/setup-action.shared";

const long = { grade: "A", side: "long" as const, entry: 100, stop: 90, tp1: 120 };

describe("setupAction", () => {
  it("says enter now when price is at the entry", () => {
    expect(setupAction({ ...long, price: 101 }).kind).toBe("enter");
  });
  it("says wait when price has not pulled back to the entry", () => {
    expect(setupAction({ ...long, price: 110 }).kind).toBe("wait");
  });
  it("says skip once price is through the stop", () => {
    expect(setupAction({ ...long, price: 89 }).kind).toBe("invalid");
  });
  it("says missed once price reached TP1", () => {
    expect(setupAction({ ...long, price: 121 }).kind).toBe("missed");
  });
  it("flags C grades as optional", () => {
    expect(setupAction({ ...long, grade: "C", price: 100 }).kind).toBe("low_grade");
  });
  it("says stay out on NO ENTRY", () => {
    expect(setupAction({ ...long, grade: "NO ENTRY", price: 100 }).kind).toBe("stay_out");
  });
});
