import { describe, expect, it } from "vitest";
import { runEntryFillTest, trialEntry, type FillTestSignal } from "@/lib/entry-fill-test.server";
import type { ReplayBar } from "@/lib/signal-replay";

const t0 = Math.floor(new Date("2026-01-01T00:00:00Z").getTime() / 1000);
const bar = (i: number, low: number, high: number, close = (low + high) / 2): ReplayBar => ({
  time: t0 + i * 3600,
  low,
  high,
  close,
});

const long: FillTestSignal = {
  id: "1",
  symbol: "EURUSD",
  timeframe: "60",
  bias: "Long",
  grade: "A",
  entry: 100,
  stop: 99,
  tp1: 102,
  status: "target",
  created_at: new Date(t0 * 1000).toISOString(),
};

describe("honest fill pricing", () => {
  it("keeps the level as the fill when price was still below entry beforehand", () => {
    // Prior close at 99.6 is short of the entry, so the trigger is a genuine break.
    const bars = [bar(0, 99.4, 99.7, 99.6), bar(1, 99.8, 102.5)];
    const t = trialEntry(long, bars, "stop-slipped")!;
    expect(t.fillPrice).toBe(100);
    expect(t.slippageR).toBe(0);
    expect(t.grossR).toBe(2);
  });

  it("moves the fill to where price actually was when the level was already gone", () => {
    // Price closed at 100.5 before the trigger bar: the 100 entry no longer existed.
    const bars = [bar(0, 100.2, 100.7, 100.5), bar(1, 100.6, 102.5)];
    const t = trialEntry(long, bars, "stop-slipped")!;
    expect(t.fillPrice).toBe(100.5);
    expect(t.slippageR).toBe(0.5);
    // Risk grew from 1.0 to 1.5 and reward shrank from 2.0 to 1.5, so R collapses.
    expect(t.grossR).toBe(1);
    expect(t.netR!).toBeLessThan(1);
  });

  it("counts the trade as never available when the target was already reached", () => {
    const bars = [bar(0, 102.1, 102.6, 102.4), bar(1, 102.2, 103)];
    const t = trialEntry(long, bars, "stop-slipped")!;
    expect(t.filled).toBe(false);
  });

  it("prices a slipped short fill below the planned entry", () => {
    const short: FillTestSignal = { ...long, bias: "Short", entry: 100, stop: 101, tp1: 98 };
    const bars = [bar(0, 99.3, 99.8, 99.5), bar(1, 97.5, 99.6)];
    const t = trialEntry(short, bars, "stop-slipped")!;
    expect(t.fillPrice).toBe(99.5);
    expect(t.slippageR).toBe(0.5);
    expect(t.status).toBe("target");
  });

  it("reports the slipped column beside the optimistic one", () => {
    const bars = [bar(0, 100.2, 100.7, 100.5), bar(1, 100.6, 102.5)];
    const report = runEntryFillTest([long], () => bars, 1);
    expect(report.overall.stopSlipped.decided).toBe(1);
    expect(report.overall.medianSlippagePaidR).toBe(0.5);
    // The optimistic level fill must read better than the honest one.
    expect(report.overall.stop.netExpectancyR!).toBeGreaterThan(report.overall.stopSlipped.netExpectancyR!);
    expect(report.verdicts.join(" ")).toContain("honest");
  });
});
