import { describe, expect, it } from "vitest";
import { oandaRejectMessage } from "@/lib/autopilot-live.server";

describe("OANDA reject messages", () => {
  it("explains instrument not tradeable without raw codes", () => {
    const msg = oandaRejectMessage("INSTRUMENT_NOT_TRADEABLE", "XAU/USD");
    expect(msg).toContain("XAU/USD");
    expect(msg).not.toContain("INSTRUMENT_NOT_TRADEABLE");
  });
  it("falls back to readable text for unknown codes", () => {
    expect(oandaRejectMessage("SOME_NEW_CODE", "EUR/USD")).toContain("some new code");
  });
});
