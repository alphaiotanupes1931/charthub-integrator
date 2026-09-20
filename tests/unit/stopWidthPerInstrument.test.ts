// Stop distance is instrument-specific: pooling gold with USD/JPY hides which
// market is being stopped by its own noise. These tests pin the sweep's arithmetic
// (ATR recovery, constant planned R:R, per-symbol grouping) and the sample floor
// that stops a handful of trades becoming a production stop constant.
import { describe, it, expect } from "vitest";
import {
  runPerInstrumentStopWidthSweep,
  PER_INSTRUMENT_SAMPLE_FLOOR,
  type BarLoader,
} from "@/lib/stop-width-per-instrument.server";
import type { ReplayBar } from "@/lib/signal-replay";

type Row = Parameters<typeof runPerInstrumentStopWidthSweep>[0][number];

const filed = "2026-01-01T00:00:00.000Z";
const t0 = Math.floor(new Date(filed).getTime() / 1000);
const H = 3600;
const bar = (n: number, high: number, low: number): ReplayBar => ({
  time: t0 + n * H,
  high,
  low,
  close: (high + low) / 2,
});

function row(over: Partial<Row> = {}): Row {
  return {
    id: "s1",
    symbol: "XAU_USD",
    timeframe: "60",
    grade: "B", // planner stop 1.25x ATR
    bias: "Long",
    entry: 100,
    stop: 97.5, // risk 2.5 => ATR 2
    tp1: 103.75,
    status: "stop",
    realizedR: -1,
    created_at: filed,
    ...over,
  };
}

/** Dips to 96.5 (stops a 1x ATR trade), then runs to 110. */
const bars: ReplayBar[] = [bar(1, 100.2, 96.5), bar(2, 110, 99)];
const loader: BarLoader = async () => bars;

describe("per-instrument stop-width sweep", () => {
  it("holds planned R:R constant so only stop room varies", async () => {
    // At 1x ATR the 96.5 dip takes the trade out; at 2x ATR (stop 96) it survives
    // and reaches the proportionally widened target.
    const report = await runPerInstrumentStopWidthSweep([row()], [1, 2], { loadBars: loader });
    const sweep = report.rows[0]!.sweep;
    expect(sweep.find((s) => s.mult === 1)!.stops).toBe(1);
    expect(sweep.find((s) => s.mult === 2)!.targets).toBe(1);
    // Constant R:R means the same realised R on a win at any width.
    expect(sweep.find((s) => s.mult === 2)!.expectancyR).toBe(1.5);
  });

  it("groups by symbol and never pools two markets", async () => {
    const report = await runPerInstrumentStopWidthSweep(
      [row(), row({ id: "s2", symbol: "USD_JPY" })],
      [1.5],
      { loadBars: loader },
    );
    expect(report.rows.map((r) => r.symbol).sort()).toEqual(["USD_JPY", "XAU_USD"]);
    expect(report.rows.every((r) => r.trades === 1)).toBe(true);
  });

  it("picks the multiple with the best net expectancy after costs", async () => {
    const report = await runPerInstrumentStopWidthSweep([row()], [1, 2], { loadBars: loader });
    expect(report.rows[0]!.bestMult).toBe(2);
    expect(report.rows[0]!.bestNetExpectancyR!).toBeGreaterThan(0);
  });

  it("marks thin samples so they cannot become a setting", async () => {
    const thin = await runPerInstrumentStopWidthSweep([row()], [1.5], { loadBars: loader });
    expect(thin.rows[0]!.enoughData).toBe(false);
    expect(thin.rows[0]!.note).toContain("floor");

    const many = Array.from({ length: PER_INSTRUMENT_SAMPLE_FLOOR }, (_, i) => row({ id: `s${i}` }));
    const big = await runPerInstrumentStopWidthSweep(many, [1.5], { loadBars: loader });
    expect(big.rows[0]!.enoughData).toBe(true);
  });

  it("skips rows it cannot measure instead of guessing", async () => {
    const report = await runPerInstrumentStopWidthSweep(
      [row({ bias: "Neutral" }), row({ id: "s3", stop: 100 }), row({ id: "s4", grade: "??" })],
      [1.5],
      { loadBars: loader },
    );
    expect(report.skipped).toBe(3);
    expect(report.rows).toHaveLength(0);
  });

  it("skips a market whose candles could not be loaded", async () => {
    const report = await runPerInstrumentStopWidthSweep([row()], [1.5], { loadBars: async () => [] });
    expect(report.skipped).toBe(1);
    expect(report.rows).toHaveLength(0);
  });
});
