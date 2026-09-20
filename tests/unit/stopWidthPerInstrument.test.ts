// Stop distance is instrument-specific: pooling gold with USD/JPY hides which
// market is being stopped by its own noise. These tests pin the sweep's arithmetic
// (ATR recovery, constant planned R:R, per-symbol grouping) and the sample floor
// that stops a handful of trades becoming a production stop constant.
import { describe, it, expect, vi, beforeEach } from "vitest";

const resolveSignal = vi.fn();
vi.mock("@/lib/signal-scores.server", () => ({
  resolveSignal: (...args: unknown[]) => resolveSignal(...args),
  signalDirection: (bias: string) =>
    bias === "Long" ? "long" : bias === "Short" ? "short" : null,
}));
vi.mock("@/lib/trading-costs", () => ({
  costInR: () => 0.05,
}));

const { runPerInstrumentStopWidthSweep, PER_INSTRUMENT_SAMPLE_FLOOR } = await import(
  "@/lib/stop-width-per-instrument.server"
);

type Row = Parameters<typeof runPerInstrumentStopWidthSweep>[0][number];

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
    created_at: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

beforeEach(() => {
  resolveSignal.mockReset();
  resolveSignal.mockResolvedValue({ status: "target", realizedR: 1.5 });
});

describe("per-instrument stop-width sweep", () => {
  it("recovers ATR from the filed risk and holds planned R:R constant", async () => {
    await runPerInstrumentStopWidthSweep([row()], [2]);
    const sig = resolveSignal.mock.calls[0]![0] as { stop: number; tp1: number };
    // ATR 2, swept at 2x => 4 of room below entry.
    expect(sig.stop).toBeCloseTo(96, 6);
    // TP1 scaled by the same 4/2.5 factor, so planned R:R is unchanged.
    expect((sig.tp1 - 100) / (100 - sig.stop)).toBeCloseTo((103.75 - 100) / 2.5, 6);
  });

  it("groups by symbol and never pools two markets", async () => {
    const report = await runPerInstrumentStopWidthSweep(
      [row(), row({ id: "s2", symbol: "USD_JPY" })],
      [1.5],
    );
    expect(report.rows.map((r) => r.symbol).sort()).toEqual(["USD_JPY", "XAU_USD"]);
    expect(report.rows.every((r) => r.trades === 1)).toBe(true);
  });

  it("picks the multiple with the best net expectancy after costs", async () => {
    resolveSignal.mockImplementation(async (sig: { stop: number }) =>
      sig.stop < 97 ? { status: "target", realizedR: 1.5 } : { status: "stop", realizedR: -1 },
    );
    const report = await runPerInstrumentStopWidthSweep([row()], [1, 2]);
    const r = report.rows[0]!;
    expect(r.bestMult).toBe(2);
    expect(r.bestNetExpectancyR).toBeCloseTo(1.45, 6);
  });

  it("marks thin samples so they cannot become a setting", async () => {
    const report = await runPerInstrumentStopWidthSweep([row()], [1.5]);
    expect(report.rows[0]!.enoughData).toBe(false);
    expect(report.rows[0]!.note).toContain("floor");

    const many = Array.from({ length: PER_INSTRUMENT_SAMPLE_FLOOR }, (_, i) => row({ id: `s${i}` }));
    const big = await runPerInstrumentStopWidthSweep(many, [1.5]);
    expect(big.rows[0]!.enoughData).toBe(true);
  });

  it("skips rows it cannot measure instead of guessing", async () => {
    const report = await runPerInstrumentStopWidthSweep(
      [row({ bias: "Neutral" }), row({ id: "s3", stop: 100 }), row({ id: "s4", grade: "??" })],
      [1.5],
    );
    expect(report.skipped).toBe(3);
    expect(report.rows).toHaveLength(0);
  });
});
