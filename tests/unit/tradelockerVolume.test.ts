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

import { pickVolumeRules, standardContractSize } from "@/lib/venues/tradelocker-volume.shared";

describe("TradeLocker contract sizes", () => {
  it("falls back to 5000 oz per lot for silver", () => {
    expect(standardContractSize("XAG/USD")).toBe(5000);
    const r = unitsToTradeLockerLots(957, { contractSize: standardContractSize("XAG/USD"), minLots: null, maxLots: null, stepLots: null });
    expect(r).toEqual({ ok: true, lots: 0.19, capped: false });
  });
  it("uses 100 for gold and 100000 for forex", () => {
    expect(standardContractSize("XAUUSD")).toBe(100);
    expect(standardContractSize("EUR/USD")).toBe(100000);
  });
  it("reads broker keys regardless of case", () => {
    expect(pickVolumeRules([{ LotSize: "5000", MinOrderSize: 0.01 }])).toMatchObject({ contractSize: 5000, minLots: 0.01 });
  });
});
