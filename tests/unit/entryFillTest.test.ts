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

describe("order type replay", () => {
  it("fills a limit when price trades back to the level, then runs to target", () => {
    const bars = [bar(1, 99.5, 100.2), bar(2, 100.1, 102.5)];
    const t = trialEntry(long, bars, "limit")!;
    expect(t.filled).toBe(true);
    expect(t.barsToFill).toBe(1);
    expect(t.status).toBe("target");
    expect(t.grossR).toBe(2);
    // Net is gross minus the static cost estimate, so strictly below gross.
    expect(t.netR!).toBeLessThan(2);
  });

  it("leaves a limit unfilled when price never comes back", () => {
    const bars = [bar(1, 100.5, 101), bar(2, 101, 102.5)];
    const t = trialEntry(long, bars, "limit")!;
    expect(t.filled).toBe(false);
    expect(t.status).toBe("open");
  });

  it("fills a stop entry as price leaves the level", () => {
    const bars = [bar(1, 100.5, 101), bar(2, 101, 102.5)];
    const t = trialEntry(long, bars, "stop")!;
    expect(t.filled).toBe(true);
    expect(t.status).toBe("target");
  });

  it("counts a bar holding both levels as a stop in either mode", () => {
    const bars = [bar(1, 98.5, 102.5)];
    expect(trialEntry(long, bars, "limit")!.status).toBe("stop");
    expect(trialEntry(long, bars, "stop")!.status).toBe("stop");
  });

  it("allows a stop entry to be stopped on the bar it fills", () => {
    const bars = [bar(1, 98.9, 100.4)];
    const t = trialEntry(long, bars, "stop")!;
    expect(t.filled).toBe(true);
    expect(t.status).toBe("stop");
    expect(t.barsToResolve).toBe(1);
  });

  it("refuses a signal with no direction or no risk", () => {
    expect(trialEntry({ ...long, bias: "Neutral" }, [bar(1, 99, 101)], "limit")).toBeNull();
    expect(trialEntry({ ...long, stop: 100 }, [bar(1, 99, 101)], "limit")).toBeNull();
  });
});

describe("entry fill report", () => {
  const bars = [bar(1, 99.5, 100.2), bar(2, 100.1, 102.5)];
  const barsFor = () => bars;

  it("reports both modes over the same signals", () => {
    const report = runEntryFillTest([long, { ...long, id: "2" }], barsFor, 1);
    expect(report.scorable).toBe(2);
    expect(report.overall.limit.decided).toBe(2);
    expect(report.overall.stop.decided).toBe(2);
    expect(report.byInstrument[0]!.symbol).toBe("EURUSD");
    expect(report.verdicts.length).toBeGreaterThan(0);
  });

  it("counts rows with no price history as unrecoverable rather than dropping them", () => {
    const report = runEntryFillTest([long], () => null, 1);
    expect(report.unrecoverable).toBe(1);
    expect(report.scorable).toBe(0);
  });

  it("recommends a hold window only once the sample supports one", () => {
    const thin = runEntryFillTest([long], barsFor, 50);
    expect(thin.expiryClock[0]!.recommendedHoldBars).toBeNull();
    const thick = runEntryFillTest(
      Array.from({ length: 5 }, (_, i) => ({ ...long, id: String(i) })),
      barsFor,
      5,
    );
    expect(thick.expiryClock[0]!.recommendedHoldBars).toBeGreaterThan(0);
  });

  it("flags signals whose first bar already closed past the entry", () => {
    const gone: FillTestSignal = { ...long, id: "3" };
    const goneBars = [bar(1, 100.4, 101, 100.9), bar(2, 101, 102.5)];
    const report = runEntryFillTest([gone], () => goneBars, 1);
    expect(report.firstBar.entryAlreadyGone).toBe(1);
    expect(report.firstBar.medianGoneByR).toBeCloseTo(0.9, 5);
    expect(report.firstBar.refusedAtTolerance.find((t) => t.toleranceR === 0.5)!.refused).toBe(1);
  });

  it("records a first-bar win with no heat as a free win", () => {
    const freeBars = [bar(1, 100, 102.5, 102.4)];
    const report = runEntryFillTest([long], () => freeBars, 1);
    expect(report.firstBar.resolvedOnFirstBar).toBe(1);
    expect(report.firstBar.freeWins).toBe(1);
  });
});
