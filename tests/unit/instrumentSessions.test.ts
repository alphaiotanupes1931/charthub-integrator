import { describe, expect, it } from "vitest";
import { resolveWindow, sessionState, venueClosed, LONDON_MORNING, NY_CASH_OPEN, TOKYO, SYDNEY, CRYPTO_US_EUROPE } from "@/lib/instrument-sessions";
import { classifyInstrument, inLiquidWindow } from "@/lib/scanner/program";

const at = (iso: string) => new Date(iso);

describe("venue-local sessions", () => {
  it("moves London's window with British Summer Time instead of drifting", () => {
    const summer = resolveWindow(LONDON_MORNING, at("2025-07-15T10:00:00Z"));
    const winter = resolveWindow(LONDON_MORNING, at("2025-01-15T10:00:00Z"));
    expect(summer.startMin).toBe(7 * 60);
    expect(winter.startMin).toBe(8 * 60);
  });

  it("keeps the New York cash open at 09:30 local in both halves of the year", () => {
    expect(resolveWindow(NY_CASH_OPEN, at("2025-07-15T14:00:00Z")).startMin).toBe(13 * 60 + 30);
    expect(resolveWindow(NY_CASH_OPEN, at("2025-01-15T14:00:00Z")).startMin).toBe(14 * 60 + 30);
  });

  it("resolves Tokyo and Sydney, which are ahead of UTC", () => {
    expect(resolveWindow(TOKYO, at("2025-07-15T02:00:00Z")).startMin).toBe(0);
    expect(resolveWindow(SYDNEY, at("2025-07-15T02:00:00Z")).startMin).toBe(23 * 60);
  });

  it("treats the weekend as closed for FX but not for crypto", () => {
    const saturday = at("2025-07-19T12:00:00Z");
    expect(venueClosed(false, saturday)).toBe(true);
    expect(venueClosed(true, saturday)).toBe(false);
  });

  it("reports how long until the next window when outside one", () => {
    const state = sessionState([LONDON_MORNING], at("2025-07-15T20:00:00Z"));
    expect(state.inside).toBe(false);
    expect(state.minutesToOpen).toBeGreaterThan(0);
  });

  it("marks crypto open at all hours", () => {
    expect(sessionState([CRYPTO_US_EUROPE], at("2025-07-19T14:00:00Z"), { alwaysOpen: true }).marketClosed).toBe(false);
  });
});

describe("instrument classes", () => {
  it("gives the Antipodean pairs their own Asian-hours class", () => {
    expect(classifyInstrument("AUD/USD").klass).toBe("fx_commodity");
    expect(classifyInstrument("NZD/USD").klass).toBe("fx_commodity");
    expect(classifyInstrument("EUR/USD").klass).toBe("fx_major");
  });

  it("still routes yen, metals, indices, crypto and oil to their own classes", () => {
    expect(classifyInstrument("USD/JPY").klass).toBe("fx_yen");
    expect(classifyInstrument("XAU/USD").klass).toBe("metal");
    expect(classifyInstrument("NAS100").klass).toBe("index");
    expect(classifyInstrument("BTC/USD").klass).toBe("crypto");
    expect(classifyInstrument("WTI Oil").klass).toBe("energy");
  });

  it("says AUD/USD is in session during Sydney hours, when it actually trades", () => {
    const spec = classifyInstrument("AUD/USD");
    const sydneyMorning = at("2025-07-15T01:00:00Z");
    expect(inLiquidWindow(spec, sydneyMorning).inside).toBe(true);
  });
});
