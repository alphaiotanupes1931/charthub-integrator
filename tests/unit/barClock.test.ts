import { describe, it, expect } from "vitest";
import { barSeconds, splitForming, closedBars, secondsToBarClose } from "@/lib/barClock";

const series = (count: number, stepSec: number, lastStartMs: number) =>
  Array.from({ length: count }, (_, i) => ({
    time: Math.floor(lastStartMs / 1000) - (count - 1 - i) * stepSec,
    open: 1,
    high: 2,
    low: 0.5,
    close: 1.5,
  }));

describe("bar clock", () => {
  it("measures the bar length from the series", () => {
    expect(barSeconds(series(30, 3600, Date.now()))).toBe(3600);
  });

  it("drops the bar that is still forming", () => {
    const now = Date.UTC(2026, 8, 15, 14, 20); // 20 minutes into the 14:00 hourly bar
    const candles = series(30, 3600, Date.UTC(2026, 8, 15, 14, 0));
    const { closed, forming } = splitForming(candles, now);
    expect(forming).not.toBeNull();
    expect(closed).toHaveLength(29);
    expect(closed.at(-1)!.time).toBe(Math.floor(Date.UTC(2026, 8, 15, 13, 0) / 1000));
  });

  it("keeps the last bar once it has closed", () => {
    const now = Date.UTC(2026, 8, 15, 15, 1);
    const candles = series(30, 3600, Date.UTC(2026, 8, 15, 14, 0));
    expect(splitForming(candles, now).forming).toBeNull();
    expect(closedBars(candles, now)).toHaveLength(30);
  });

  it("reports the time left in the forming bar", () => {
    const now = Date.UTC(2026, 8, 15, 14, 20);
    const candles = series(30, 3600, Date.UTC(2026, 8, 15, 14, 0));
    expect(secondsToBarClose(candles, now)).toBe(2400);
    expect(secondsToBarClose(series(30, 3600, Date.UTC(2026, 8, 15, 13, 0)), now)).toBe(0);
  });

  it("leaves very short series untouched", () => {
    const candles = series(3, 3600, Date.now());
    expect(splitForming(candles).forming).toBeNull();
  });
});
