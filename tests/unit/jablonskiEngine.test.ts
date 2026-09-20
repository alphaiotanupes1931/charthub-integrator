import { describe, expect, it } from "vitest";
import { jablonskiAnalysis, jablonskiPointSize, JABLONSKI_TARGET_POINTS } from "@/lib/analysis-models/jablonski-engine";
import { getAnalysisModel, normalizeAnalysisModel } from "@/lib/analysis-models";

type C = { time: number; open: number; high: number; low: number; close: number };

// 2026-09-15 is a Tuesday. 13:00 UTC = 09:00 New York (EDT), so the 03:00 New
// York open for FX/metals is 07:00 UTC.
const LONDON_OPEN_UTC = Date.UTC(2026, 8, 15, 7, 0, 0) / 1000;

function bars(closes: number[], start = LONDON_OPEN_UTC): C[] {
  return closes.map((close, i) => ({
    time: start + i * 900,
    open: close,
    high: close + 0.5,
    low: close - 0.5,
    close,
  }));
}

describe("Eric Jablonski engine", () => {
  it("is registered as a scan model", () => {
    expect(normalizeAnalysisModel("jablonski")).toBe("jablonski");
    expect(getAnalysisModel("jablonski").name).toBe("Eric Jablonski");
    expect(getAnalysisModel("jablonski").ready).toBe(true);
  });

  it("knows which instruments have a defined point", () => {
    expect(jablonskiPointSize("XAU/USD")).toBe(1);
    expect(jablonskiPointSize("EUR/USD")).toBe(0.0001);
    expect(jablonskiPointSize("USD/JPY")).toBe(0.01);
    expect(jablonskiPointSize("BTC/USD")).toBeNull();
  });

  it("stands down on instruments without a point", () => {
    const read = jablonskiAnalysis(bars([2000, 2001, 2002, 2010]), "BTC/USD");
    expect(read.grade).toBe("NO ENTRY");
    expect(read.phase).toBe("unsupported");
  });

  it("waits while the opening range holds", () => {
    const read = jablonskiAnalysis(bars([2000, 2001, 2000.5, 2000.8]), "XAU/USD");
    expect(read.phase).toBe("awaiting-break");
    expect(read.grade).toBe("NO ENTRY");
    expect(read.rangeHigh).toBe(2001.5);
    expect(read.rangeLow).toBe(1999.5);
  });

  it("buys the close above the range with the stop at the range low", () => {
    const read = jablonskiAnalysis(bars([2000, 2001, 2002]), "XAU/USD");
    expect(read.bias).toBe("Long");
    expect(read.entry).toBe(2002);
    expect(read.stop).toBe(1999.5);
    expect(read.tp1).toBe(2002 + JABLONSKI_TARGET_POINTS);
    expect(read.grade).toBe("A");
  });

  it("sells the close below the range with the stop at the range high", () => {
    const read = jablonskiAnalysis(bars([2000, 2001, 1998]), "XAU/USD");
    expect(read.bias).toBe("Short");
    expect(read.entry).toBe(1998);
    expect(read.stop).toBe(2001.5);
    expect(read.tp1).toBe(1988);
  });

  it("stands down once price closes back inside the range", () => {
    const read = jablonskiAnalysis(bars([2000, 2001, 2002, 2000.5]), "XAU/USD");
    expect(read.phase).toBe("closed-back-inside");
    expect(read.grade).toBe("NO ENTRY");
  });

  it("caps a stale break at C", () => {
    const read = jablonskiAnalysis(bars([2000, 2001, 2002, 2003, 2004, 2005, 2006, 2007, 2008, 2008.5, 2009, 2009.5]), "XAU/USD");
    expect(read.grade).toBe("C");
    expect(read.cap).toContain("chasing");
  });

  it("refuses a break that already ran the full target", () => {
    const read = jablonskiAnalysis(bars([2000, 2001, 2002, 2013]), "XAU/USD");
    expect(read.grade).toBe("NO ENTRY");
    expect(read.cap).toContain("already reached");
  });

  it("needs the session's first two candles", () => {
    const read = jablonskiAnalysis(bars([2000, 2001, 2002], LONDON_OPEN_UTC + 3600), "XAU/USD");
    expect(read.phase).toBe("no-range");
  });
});
