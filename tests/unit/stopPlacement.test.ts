// Stop room is the biggest measured leak, so these constants are pinned: the old
// grade ladder (A tightest) must not come back, widths stay inside sane bounds,
// and markets without a usable sample must not inherit another market's number.
import { describe, it, expect } from "vitest";
import {
  stopMultipleFor,
  hasMeasuredStop,
  DEFAULT_STOP_MULT,
  MIN_STOP_MULT,
  MAX_STOP_MULT,
  MEASURED_STOP_MULT,
} from "@/lib/stop-placement";

describe("per-instrument stop placement", () => {
  it("uses the market's measured width, whatever the grade", () => {
    expect(stopMultipleFor("XAU/USD", "A")).toBe(1.5);
    expect(stopMultipleFor("XAU/USD", "C")).toBe(1.5);
    expect(stopMultipleFor("USD_JPY", "A")).toBe(2.5);
    expect(stopMultipleFor("us30", "B")).toBe(1.75);
  });

  it("never gives the best grade the least room again", () => {
    for (const symbol of ["XAU/USD", "NAS100", "EUR/USD", "BTC/USD"]) {
      expect(stopMultipleFor(symbol, "A")).toBeGreaterThanOrEqual(stopMultipleFor(symbol, "C"));
      expect(stopMultipleFor(symbol, "A")).toBeGreaterThan(1.1);
    }
  });

  it("falls back to the shared default for thin-sample markets", () => {
    expect(hasMeasuredStop("XRP/USD")).toBe(false);
    expect(stopMultipleFor("XRP/USD")).toBe(DEFAULT_STOP_MULT);
    expect(stopMultipleFor("SOMETHING_NEW")).toBe(DEFAULT_STOP_MULT);
  });

  it("treats the same market written differently as one market", () => {
    expect(stopMultipleFor("XAU_USD")).toBe(stopMultipleFor("xau/usd"));
    expect(stopMultipleFor("WTI Oil")).toBe(stopMultipleFor("WTICO_USD"));
  });

  it("keeps every constant inside the allowed band", () => {
    for (const [symbol, mult] of Object.entries(MEASURED_STOP_MULT)) {
      expect(mult, symbol).toBeGreaterThanOrEqual(MIN_STOP_MULT);
      expect(mult, symbol).toBeLessThanOrEqual(MAX_STOP_MULT);
    }
  });
});
