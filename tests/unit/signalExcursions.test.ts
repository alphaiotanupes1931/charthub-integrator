// MFE is free data: the bars that decided the trade already say how far it ran in
// favour before it resolved. These tests pin the bar walk (one implementation for
// live and backfill) and the rule that a backfill never rewrites a stored verdict.
import { describe, it, expect } from "vitest";
import { replayForward, forwardBars, type ReplayBar } from "@/lib/signal-replay";
import { computeExcursions, type StoredSignal } from "@/lib/signal-excursions.server";

const H = 3600;
const filed = "2026-01-01T00:00:00.000Z";
const t0 = Math.floor(new Date(filed).getTime() / 1000);

function bar(n: number, high: number, low: number, close = (high + low) / 2): ReplayBar {
  return { time: t0 + n * H, high, low, close };
}

// Long 100, stop 99, target 102: risk 1, planned 2R.
const long = { bias: "Long", entry: 100, stop: 99, tp1: 102, created_at: filed };

describe("bar walk", () => {
  it("ignores bars at or before the filing time", () => {
    expect(forwardBars([bar(-1, 200, 0), bar(0, 200, 0), bar(1, 101, 100)], filed)).toHaveLength(1);
  });

  it("measures ground made in favour before the target printed", () => {
    const v = replayForward(long, [bar(1, 101.5, 99.8), bar(2, 102, 101)])!;
    expect(v.status).toBe("target");
    expect(v.realizedR).toBe(2);
    expect(v.mfeR).toBe(2); // reached 102, i.e. 2R
    expect(v.maeR).toBe(0.2); // dipped to 99.8 first
    expect(v.bars).toBe(2);
  });

  it("shows a loser that ran far in favour first, which is a stop-width problem", () => {
    const v = replayForward(long, [bar(1, 101.8, 100), bar(2, 101, 98.9)])!;
    expect(v.status).toBe("stop");
    expect(v.realizedR).toBe(-1);
    expect(v.mfeR).toBe(1.8); // was 1.8R up before being stopped
  });

  it("counts a bar holding both levels as a stop", () => {
    const v = replayForward(long, [bar(1, 102.5, 98.5)])!;
    expect(v.status).toBe("stop");
  });

  it("reports unresolved with excursions when neither level printed", () => {
    const v = replayForward(long, [bar(1, 101, 99.5)])!;
    expect(v.status).toBe("unresolved");
    expect(v.realizedR).toBeNull();
    expect(v.lastClose).toBe(100.25);
  });

  it("is not scorable without a direction or without risk", () => {
    expect(replayForward({ ...long, bias: "Neutral" }, [bar(1, 102, 99)])).toBeNull();
    expect(replayForward({ ...long, stop: 100 }, [bar(1, 102, 99)])).toBeNull();
  });
});

function stored(p: Partial<StoredSignal>): StoredSignal {
  return {
    id: Math.random().toString(36).slice(2),
    symbol: "XAU/USD",
    timeframe: "60",
    bias: "Long",
    grade: "A",
    entry: 100,
    stop: 99,
    tp1: 102,
    status: "target",
    realized_r: 2,
    mfe_r: null,
    mae_r: null,
    net_r: null,
    created_at: filed,
    resolved_at: null,
    ...p,
  };
}

describe("historical backfill", () => {
  const bars = [bar(1, 101.5, 99.8), bar(2, 102, 101)];
  const barsFor = () => bars;

  it("recomputes excursions and fills estimated costs for rows that lack them", () => {
    const { updates, report } = computeExcursions([stored({})], barsFor);
    expect(report.updated).toBe(1);
    expect(updates[0]!.mfe_r).toBe(2);
    expect(updates[0]!.mae_r).toBe(0.2);
    expect(updates[0]!.cost_r).toBeGreaterThan(0);
    expect(updates[0]!.net_r).toBeLessThan(2);
  });

  it("leaves rows that already carry excursions alone", () => {
    const { updates, report } = computeExcursions([stored({ mfe_r: 1, mae_r: 0.1 })], barsFor);
    expect(updates).toHaveLength(0);
    expect(report.alreadyHad).toBe(1);
  });

  it("reports a disagreement instead of rewriting the stored verdict", () => {
    const { updates, report } = computeExcursions([stored({ status: "stop", realized_r: -1 })], barsFor);
    expect(report.mismatches).toHaveLength(1);
    expect(report.mismatches[0]!.replayStatus).toBe("target");
    expect(report.mismatches[0]!.replayResolvedAt).toBeTruthy();
    // Excursions still written; status untouched.
    expect(Object.keys(updates[0]!)).not.toContain("status");
  });

  it("counts rows with no price history left as unrecoverable, not as flat", () => {
    const { report } = computeExcursions([stored({})], () => null);
    expect(report.unrecoverable).toBe(1);
    expect(report.updated).toBe(0);
    expect(report.notes.some((n) => n.includes("price feed window"))).toBe(true);
  });

  it("treats a stored expiry that never printed a level as agreement", () => {
    const { report } = computeExcursions([stored({ status: "expired", realized_r: 0.3 })], () => [bar(1, 101, 99.5)]);
    expect(report.mismatches).toHaveLength(0);
  });

  it("returns five worked examples for a chart spot check", () => {
    const rows = Array.from({ length: 8 }, () => stored({}));
    const { report } = computeExcursions(rows, barsFor);
    expect(report.spotCheck).toHaveLength(5);
    expect(report.spotCheck[0]!.agrees).toBe(true);
    expect(report.spotCheck[0]!.entry).toBe(100);
  });

  it("says out loud that costs are estimated, not the spread at signal time", () => {
    const { report } = computeExcursions([stored({})], barsFor);
    expect(report.notes.some((n) => n.includes("not the true spread at signal time"))).toBe(true);
  });
});
