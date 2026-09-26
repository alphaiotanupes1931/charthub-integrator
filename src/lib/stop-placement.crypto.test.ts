import { describe, it, expect } from "vitest";
import { stopMultipleFor, hasMeasuredStop } from "./stop-placement";
describe("crypto stop widths", () => {
  it("uses measured BTC and ETH widths", () => {
    expect(stopMultipleFor("BTC/USD")).toBe(2);
    expect(stopMultipleFor("BTC_USD", "A")).toBe(2);
    expect(stopMultipleFor("ETH/USD")).toBe(1.75);
    expect(stopMultipleFor("ETHUSDT")).toBe(1.75);
    expect(hasMeasuredStop("BTC/USD")).toBe(true);
    expect(hasMeasuredStop("ETH/USD")).toBe(true);
  });
});
