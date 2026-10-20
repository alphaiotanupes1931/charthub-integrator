import { describe, expect, it } from "vitest";
import { chooseVenue, isForexPair } from "@/lib/venue-routing.shared";

describe("venue routing", () => {
  it("sends US30 to TradeLocker even when OANDA is requested", () => {
    expect(chooseVenue("oanda", "US30", ["oanda", "tradelocker"])).toBe("tradelocker");
  });
  it("sends gold to TradeLocker", () => {
    expect(chooseVenue("oanda", "XAU/USD", ["oanda", "tradelocker"])).toBe("tradelocker");
  });
  it("keeps forex on OANDA when OANDA is chosen", () => {
    expect(chooseVenue("oanda", "EUR/USD", ["oanda", "tradelocker"])).toBe("oanda");
  });
  it("gold is not a forex pair", () => {
    expect(isForexPair("XAU/USD")).toBe(false);
    expect(isForexPair("GBP/JPY")).toBe(true);
  });
});
