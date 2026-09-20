import { describe, expect, it } from "vitest";
import { replayForward, type ReplayBar } from "@/lib/signal-replay";
import { buildScoreboard, type SignalScoreRow } from "@/lib/signal-scores.shared";
import { classifyClaim, samplesNeeded, twoProportionP, wilson95 } from "@/lib/statistics";
import { clusterOf, isCorrelatedDuplicate, normalizeSymbol } from "@/lib/correlation-clusters";

const bar = (time: number, low: number, high: number, close = (low + high) / 2): ReplayBar => ({
  time,
  low,
  high,
  close,
});

const created = "2026-01-01T00:00:00.000Z";
const t0 = Date.parse(created) / 1000;

describe("rescued stops", () => {
  it("flags a stop that later reached the target", () => {
    // Long 100, stop 99, target 102: stops on bar 1, target prints on bar 3.
    const v = replayForward(
      { bias: "Long", entry: 100, stop: 99, tp1: 102, created_at: created },
      [bar(t0 + 60, 98.5, 100.2), bar(t0 + 120, 99.5, 101), bar(t0 + 180, 100, 102.5)],
    );
    expect(v?.status).toBe("stop");
    expect(v?.rescued).toBe(true);
  });

  it("leaves a stop unrescued when the target never prints", () => {
    const v = replayForward(
      { bias: "Long", entry: 100, stop: 99, tp1: 102, created_at: created },
      [bar(t0 + 60, 98.5, 100.2), bar(t0 + 120, 97, 99.5)],
    );
    expect(v?.status).toBe("stop");
    expect(v?.rescued).toBe(false);
  });

  it("never marks a winner rescued", () => {
    const v = replayForward(
      { bias: "Short", entry: 100, stop: 101, tp1: 98, created_at: created },
      [bar(t0 + 60, 97.5, 100.1)],
    );
    expect(v?.status).toBe("target");
    expect(v?.rescued).toBe(false);
  });
});

describe("statistics gate", () => {
  it("keeps the Wilson interval inside 0 to 100 at tiny samples", () => {
    const ci = wilson95(1, 2);
    expect(ci!.low).toBeGreaterThanOrEqual(0);
    expect(ci!.high).toBeLessThanOrEqual(100);
  });

  it("finds no difference between identical rates", () => {
    expect(twoProportionP(50, 100, 50, 100)).toBeGreaterThan(0.9);
  });

  it("finds a difference between far apart rates on large samples", () => {
    expect(twoProportionP(85, 100, 45, 100)!).toBeLessThan(0.01);
  });

  it("refuses to call anything below the sample floor", () => {
    const c = classifyClaim({ hits: 8, n: 10, baselineHits: 2, baselineN: 10 });
    expect(c.strength).toBe("not enough data");
    expect(c.p).toBeNull();
  });

  it("calls a big gap established once both samples clear the floor", () => {
    const c = classifyClaim({ hits: 45, n: 50, baselineHits: 10, baselineN: 50 });
    expect(c.strength).toBe("established");
  });

  it("prices the cost of confirming a gap", () => {
    expect(samplesNeeded(50, 60)).toBeGreaterThan(300);
    expect(samplesNeeded(50, 50)).toBeNull();
  });
});

describe("correlation clusters", () => {
  it("groups the US index complex and the metals", () => {
    expect(clusterOf("NAS100")).toBe("indices-us");
    expect(clusterOf("US30")).toBe("indices-us");
    expect(clusterOf("XAU/USD")).toBe("metals");
    expect(clusterOf("USD/JPY")).toBeNull();
  });

  it("normalizes spellings", () => {
    expect(normalizeSymbol("xau/usd")).toBe(normalizeSymbol("XAUUSD"));
  });

  it("flags a same-second index short filed behind a better grade", () => {
    const dup = isCorrelatedDuplicate(
      { symbol: "US30", grade: "C", bias: "Short", createdAt: "2026-01-01T09:15:57.000Z" },
      [{ symbol: "NAS100", grade: "A", bias: "Short", createdAt: "2026-01-01T09:15:57.000Z" }],
    );
    expect(dup).toBe(true);
  });

  it("keeps the better-graded signal and opposite directions", () => {
    const peers = [{ symbol: "NAS100", grade: "C", bias: "Short", createdAt: "2026-01-01T09:15:57.000Z" }];
    expect(
      isCorrelatedDuplicate(
        { symbol: "US30", grade: "A", bias: "Short", createdAt: "2026-01-01T09:15:57.000Z" },
        peers,
      ),
    ).toBe(false);
    expect(
      isCorrelatedDuplicate(
        { symbol: "US30", grade: "C", bias: "Long", createdAt: "2026-01-01T09:15:57.000Z" },
        peers,
      ),
    ).toBe(false);
  });

  it("ignores signals outside the window", () => {
    expect(
      isCorrelatedDuplicate(
        { symbol: "US30", grade: "C", bias: "Short", createdAt: "2026-01-01T11:00:00.000Z" },
        [{ symbol: "NAS100", grade: "A", bias: "Short", createdAt: "2026-01-01T09:15:57.000Z" }],
      ),
    ).toBe(false);
  });
});

const row = (over: Partial<SignalScoreRow>): SignalScoreRow => ({
  id: Math.random().toString(36).slice(2),
  symbol: "XAUUSD",
  timeframe: "60",
  grade: "C",
  bias: "Long",
  confidence: null,
  strategyId: null,
  entry: 100,
  stop: 99,
  tp1: 102,
  plannedR: 2,
  status: "stop",
  realizedR: -1,
  resolvedAt: created,
  taken: false,
  createdAt: created,
  ...over,
});

describe("scoreboard with rescue and correlation", () => {
  it("holds correlated duplicates out of every aggregate but still counts them", () => {
    const board = buildScoreboard([
      row({ status: "target", realizedR: 2 }),
      row({ status: "stop", correlated: true }),
    ]);
    expect(board.correlated).toBe(1);
    expect(board.decided).toBe(1);
    expect(board.hitRate).toBe(100);
    expect(board.notes.some((n) => n.includes("move together"))).toBe(true);
  });

  it("reports the rescued share of stops", () => {
    const board = buildScoreboard([
      ...Array.from({ length: 6 }, () => row({ status: "stop", rescued: true })),
      ...Array.from({ length: 6 }, () => row({ status: "stop", rescued: false })),
    ]);
    expect(board.stops).toBe(12);
    expect(board.rescuedStops).toBe(6);
    expect(board.rescueRate).toBe(50);
  });

  it("refuses to claim the grade inversion at a small sample", () => {
    const board = buildScoreboard([
      row({ grade: "A", status: "stop" }),
      row({ grade: "A", status: "target", realizedR: 2 }),
      row({ grade: "B", status: "target", realizedR: 2 }),
      row({ grade: "B", status: "target", realizedR: 2 }),
    ]);
    const note = board.notes.find((n) => n.includes("A grades"));
    expect(note).toBeDefined();
    expect(note).toContain("Not enough decided A grades");
  });
});
