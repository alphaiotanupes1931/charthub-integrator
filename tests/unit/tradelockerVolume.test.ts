import { describe, expect, it } from "vitest";
import { unitsToTradeLockerLots } from "@/lib/venues/tradelocker-volume.shared";

describe("unitsToTradeLockerLots", () => {
  it("converts silver ounces into lots using the contract size", () => {
    const r = unitsToTradeLockerLots(957, { contractSize: 5000, minLots: 0.01, maxLots: 50, stepLots: 0.01 });
    expect(r).toEqual({ ok: true, lots: 0.19, capped: false });
  });
  it("caps at the broker maximum", () => {
    const r = unitsToTradeLockerLots(1_000_000, { contractSize: 100, minLots: 0.01, maxLots: 20, stepLots: 0.01 });
    expect(r).toEqual({ ok: true, lots: 20, capped: true });
  });
  it("refuses sizes below the minimum", () => {
    const r = unitsToTradeLockerLots(10, { contractSize: 5000, minLots: 0.01, maxLots: 50, stepLots: 0.01 });
    expect(r.ok).toBe(false);
  });
});
