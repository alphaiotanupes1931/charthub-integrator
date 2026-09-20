// A planned entry is a resting limit order. Nothing may be scored until price
// actually traded back to it, and a move that happened without us is not a win.
import { describe, expect, it } from "vitest";
import { replayForward, type ReplayBar } from "@/lib/signal-replay";
import { buildScoreboard, type SignalScoreRow } from "@/lib/signal-scores.shared";

const created = "2026-01-01T00:00:00.000Z";
const t = (h: number) => Math.floor(new Date(created).getTime() / 1000) + h * 3600;

const bar = (h: number, low: number, high: number, close = (low + high) / 2): ReplayBar => ({
  time: t(h),
  low,
  high,
  close,
});

const long = { bias: "Long", entry: 100, stop: 99, tp1: 103, created_at: created };

describe("limit-fill semantics", () => {
  it("counts a win only when price traded back to the entry first", () => {
    const bars = [bar(1, 100, 101), bar(2, 100.5, 103.5)];
    const v = replayForward(long, bars, { requireFill: true });
    expect(v?.status).toBe("target");
    expect(v?.realizedR).toBe(3);
    // Bars are counted from the fill, not from filing.
    expect(v?.bars).toBe(2);
  });

  it("reports unfilled when price ran to the target without touching the entry", () => {
    const bars = [bar(1, 100.6, 101.5), bar(2, 101, 103.5)];
    const v = replayForward(long, bars, { requireFill: true });
    expect(v?.status).toBe("unfilled");
    expect(v?.realizedR).toBeNull();
    expect(v?.maeR).toBe(0);
  });

  it("reports unfilled when price never came back at all", () => {
    const bars = [bar(1, 100.4, 101), bar(2, 100.2, 100.9)];
    expect(replayForward(long, bars, { requireFill: true })?.status).toBe("unfilled");
  });

  it("without requireFill the old from-filing walk is unchanged", () => {
    const bars = [bar(1, 100.6, 101.5), bar(2, 101, 103.5)];
    expect(replayForward(long, bars)?.status).toBe("target");
  });

  it("a bar holding both levels after the fill still counts as a stop", () => {
    const bars = [bar(1, 98.5, 103.5)];
    const v = replayForward(long, bars, { requireFill: true });
    expect(v?.status).toBe("stop");
    expect(v?.realizedR).toBe(-1);
  });
});

const row = (over: Partial<SignalScoreRow>): SignalScoreRow => ({
  id: Math.random().toString(36).slice(2),
  symbol: "XAU/USD",
  timeframe: "60",
  grade: "A",
  bias: "Long",
  confidence: 70,
  strategyId: null,
  entry: 100,
  stop: 99,
  tp1: 103,
  plannedR: 3,
  status: "target",
  realizedR: 3,
  resolvedAt: created,
  taken: false,
  createdAt: created,
  ...over,
});

describe("scoreboard holds never-filled signals out", () => {
  it("excludes them from the decided denominator and reports them separately", () => {
    const board = buildScoreboard([
      row({ status: "target", realizedR: 3 }),
      row({ status: "stop", realizedR: -1 }),
      row({ status: "unfilled", realizedR: null }),
      row({ status: "unfilled", realizedR: null }),
    ]);
    expect(board.decided).toBe(2);
    expect(board.unfilled).toBe(2);
    expect(board.hitRate).toBe(50);
    expect(board.expectancyR).toBe(1);
    expect(board.notes.some((n) => n.includes("never filled"))).toBe(true);
  });
});
