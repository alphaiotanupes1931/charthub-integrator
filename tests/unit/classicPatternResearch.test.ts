import { describe, expect, it } from "vitest";
import { classifyFairValueGaps, readPocContinuation } from "@/lib/classic-pattern-research";
import type { BarCandle } from "@/lib/barClock";

const bar = (time: number, open: number, high: number, low: number, close: number, volume = 100): BarCandle => ({
  time, open, high, low, close, volume,
});

describe("Classic pattern shadow research", () => {
  it("requires breakout, POC pullback, and continuation in HTF direction", () => {
    const accumulation = Array.from({ length: 10 }, (_, index) => bar(index * 3600, 100, 101, 99, 100, index === 4 ? 1000 : 100));
    const following = [
      bar(10 * 3600, 100, 103, 100, 102.5),
      bar(11 * 3600, 102.5, 102.6, 98.9, 100.2),
      bar(12 * 3600, 100.2, 103.2, 100.1, 102.8),
    ];
    const read = readPocContinuation({ accumulationBars: accumulation, followingBars: following, higherTimeframeBias: "bullish", asOfMs: 99_999_999 });
    expect(read.status).toBe("confirmed");
    expect(read.breakoutAt).toBe(10 * 3600);
    expect(read.pullbackAt).toBe(11 * 3600);
    expect(read.continuationAt).toBe(12 * 3600);
  });

  it("does not confirm a POC touch without continuation", () => {
    const accumulation = Array.from({ length: 8 }, (_, index) => bar(index * 3600, 100, 101, 99, 100));
    const read = readPocContinuation({
      accumulationBars: accumulation,
      followingBars: [bar(8 * 3600, 100, 103, 100, 102.5), bar(9 * 3600, 102, 102.2, 98.9, 100.1)],
      higherTimeframeBias: "bullish",
      asOfMs: 99_999_999,
    });
    expect(read.status).toBe("waiting-continuation");
  });

  it("classifies a structurally impulsive gap and its later inversion", () => {
    const base = Array.from({ length: 16 }, (_, index) => bar(index * 3600, 100, 100.4, 99.6, 100));
    const breakaway = classifyFairValueGaps([
      ...base,
      bar(16 * 3600, 100, 100.2, 99.8, 100),
      bar(17 * 3600, 100, 103.5, 99.9, 103),
      bar(18 * 3600, 103, 104, 101, 103.5),
    ], 99_999_999);
    expect(breakaway.at(-1)?.classification).toBe("breakaway");

    const inverted = classifyFairValueGaps([
      ...base,
      bar(16 * 3600, 100, 100.2, 99.8, 100),
      bar(17 * 3600, 100, 103.5, 99.9, 103),
      bar(18 * 3600, 103, 104, 101, 103.5),
      bar(19 * 3600, 103, 103.2, 99, 99.5),
    ], 99_999_999);
    expect(inverted.find((gap) => gap.formedAt === 18 * 3600)?.classification).toBe("inverted");
  });
});