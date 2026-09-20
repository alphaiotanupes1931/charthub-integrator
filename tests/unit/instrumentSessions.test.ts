import { describe, expect, it } from "vitest";
import { resolveWindow, sessionState, venueClosed, LONDON_MORNING, NY_CASH_OPEN, TOKYO, SYDNEY, CRYPTO_US_EUROPE } from "@/lib/instrument-sessions";
import { classifyInstrument, inLiquidWindow } from "@/lib/scanner/program";
import { sixDimensionShadow, toFive, TRACK_RECORD_FLOOR } from "@/lib/six-dimension-shadow";
import { scoreFamilies, type ProgramInput } from "@/lib/scanner/score";

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

describe("six dimension shadow score", () => {
  const families = scoreFamilies({
    symbol: "EUR/USD",
    timeframe: "1h",
    at: at("2025-07-15T10:00:00Z"),
    wantBull: true,
    ladder: [
      { label: "Monthly", bias: "bullish" },
      { label: "Weekly", bias: "bullish" },
      { label: "Daily", bias: "bullish" },
      { label: "4H", bias: "bullish" },
    ],
    h4Direction: "bullish",
    h4Trend: "up",
    closed4hCandles: 200,
    entryZoneQuality: 80,
    hasOrderBlock: true,
    hasFvg: false,
    hasHtfZone: false,
    protectedBreak: true,
    h1StructureBreak: "bullish",
    m15Confirmation: "bullish",
    sweptLiquidity: true,
    displacement: true,
    cvd: 500,
    delta: null,
    priceVsPoc: "above",
    volumeRatio: 1.3,
    costShare: 0.05,
    spreadPercentile: 40,
    plannedRR: 2,
    targetRoomOk: true,
  } as ProgramInput);

  it("scores all six dimensions on the taught 1-5 scale", () => {
    const shadow = sixDimensionShadow({
      families,
      sessionInside: true,
      sessionLabel: "London morning",
      marketClosed: false,
      resolvedSample: 0,
      measuredHitRate: null,
      plannedRR: 2.2,
      costShare: 0.05,
    });
    expect(shadow.dimensions).toHaveLength(6);
    for (const d of shadow.dimensions) {
      expect(d.score).toBeGreaterThanOrEqual(1);
      expect(d.score).toBeLessThanOrEqual(5);
    }
  });

  it("refuses to invent a track record below the sample floor", () => {
    const shadow = sixDimensionShadow({
      families,
      sessionInside: true,
      sessionLabel: "London morning",
      marketClosed: false,
      resolvedSample: TRACK_RECORD_FLOOR - 1,
      measuredHitRate: 0.9,
      plannedRR: 2,
      costShare: 0.05,
    });
    const record = shadow.dimensions.find((d) => d.id === "track-record")!;
    expect(record.unmeasured).toBe(true);
    expect(record.score).toBe(3);
  });

  it("caps risk when the planned reward is under the floor we teach", () => {
    const thin = sixDimensionShadow({
      families, sessionInside: true, sessionLabel: "London morning", marketClosed: false,
      resolvedSample: 0, measuredHitRate: null, plannedRR: 1.1, costShare: 0.05,
    });
    const fine = sixDimensionShadow({
      families, sessionInside: true, sessionLabel: "London morning", marketClosed: false,
      resolvedSample: 0, measuredHitRate: null, plannedRR: 2.5, costShare: 0.05,
    });
    expect(thin.dimensions.find((d) => d.id === "risk")!.score).toBeLessThan(fine.dimensions.find((d) => d.id === "risk")!.score);
  });

  it("scores the session dimension lowest when the market is shut", () => {
    const closed = sixDimensionShadow({
      families, sessionInside: false, sessionLabel: null, marketClosed: true,
      resolvedSample: 0, measuredHitRate: null, plannedRR: 2, costShare: 0.05,
    });
    expect(closed.dimensions.find((d) => d.id === "session")!.score).toBe(toFive(0));
  });
});
