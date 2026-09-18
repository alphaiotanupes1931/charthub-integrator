import { describe, it, expect } from "vitest";
import { evaluateEntryStaleness, STALE_TOLERANCE_R } from "@/lib/signal-staleness";
import { expiryPolicy, expiryHoursFor } from "@/lib/signal-expiry";

describe("entry staleness guard", () => {
  const long = { bias: "Long", entry: 100, stop: 99 }; // 1.0 of risk per point
  const short = { bias: "Short", entry: 100, stop: 101 };

  it("accepts a long whose entry has not been reached yet", () => {
    const read = evaluateEntryStaleness({ ...long, lastPrice: 100.4 });
    expect(read.stale).toBe(false);
    expect(read.distanceR).toBe(0.4);
  });

  it("treats price still approaching the entry as not stale at all", () => {
    const read = evaluateEntryStaleness({ ...long, lastPrice: 98 });
    expect(read.stale).toBe(false);
    expect(read.distanceR).toBe(0);
  });

  it("refuses a long whose entry price has already run away", () => {
    const read = evaluateEntryStaleness({ ...long, lastPrice: 100.8 });
    expect(read.stale).toBe(true);
    expect(read.distanceR).toBe(0.8);
    expect(read.reason).toContain("already gone");
  });

  it("refuses a short that has already dropped past its entry", () => {
    expect(evaluateEntryStaleness({ ...short, lastPrice: 99.2 }).stale).toBe(true);
    expect(evaluateEntryStaleness({ ...short, lastPrice: 99.6 }).stale).toBe(false);
  });

  it("holds exactly at the tolerance and refuses just past it", () => {
    expect(evaluateEntryStaleness({ ...long, lastPrice: 100 + STALE_TOLERANCE_R }).stale).toBe(false);
    expect(evaluateEntryStaleness({ ...long, lastPrice: 100 + STALE_TOLERANCE_R + 0.001 }).stale).toBe(true);
  });

  it("refuses when there is no price to judge against", () => {
    const read = evaluateEntryStaleness({ ...long, lastPrice: null });
    expect(read.stale).toBe(true);
    expect(read.distanceR).toBeNull();
  });

  it("refuses a non-directional signal and a zero-risk signal", () => {
    expect(evaluateEntryStaleness({ bias: "Neutral", entry: 100, stop: 99, lastPrice: 100 }).stale).toBe(true);
    expect(evaluateEntryStaleness({ bias: "Long", entry: 100, stop: 100, lastPrice: 100 }).stale).toBe(true);
  });

  it("honours a caller-supplied tolerance", () => {
    expect(evaluateEntryStaleness({ ...long, lastPrice: 100.2, toleranceR: 0.1 }).stale).toBe(true);
  });
});

describe("per-market expiry clock", () => {
  it("uses the measured hold time on the 1H where the sample supports it", () => {
    const nas = expiryPolicy("NAS100", "60");
    expect(nas.basis).toBe("measured");
    expect(nas.hours).toBe(104); // 83 bars + 25% headroom
    expect(expiryHoursFor("US30", "60")).toBe(35);
  });

  it("keeps the conservative default for thin samples and other timeframes", () => {
    expect(expiryPolicy("EUR/USD", "60")).toEqual({ hours: 72, basis: "default" });
    expect(expiryPolicy("NAS100", "240")).toEqual({ hours: 240, basis: "default" });
    expect(expiryPolicy("NAS100", "15")).toEqual({ hours: 24, basis: "default" });
  });

  it("gives fast markets a shorter clock than slow ones", () => {
    expect(expiryHoursFor("US30", "60")).toBeLessThan(expiryHoursFor("WTI Oil", "60"));
  });
});
