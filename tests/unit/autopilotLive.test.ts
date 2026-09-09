import { describe, it, expect } from "vitest";
import { oandaInstrument } from "@/lib/autopilot-live.server";

describe("oandaInstrument", () => {
  it("maps forex pairs", () => {
    expect(oandaInstrument("EUR/USD")).toBe("EUR_USD");
    expect(oandaInstrument("gbpusd")).toBe("GBP_USD");
    expect(oandaInstrument("USD_JPY")).toBe("USD_JPY");
  });

  it("maps metals and indices", () => {
    expect(oandaInstrument("XAU/USD")).toBe("XAU_USD");
    expect(oandaInstrument("NAS100")).toBe("NAS100_USD");
    expect(oandaInstrument("US30")).toBe("US30_USD");
    expect(oandaInstrument("SPX500")).toBe("SPX500_USD");
  });
});
