import { describe, expect, it } from "vitest";
import { buildChartQuestions, readChartFacts, type PreScanBar } from "@/lib/prescan-context";

function series(closes: number[]): PreScanBar[] {
  return closes.map((c, i) => ({
    time: 1_700_000_000 + i * 3600,
    open: c - 0.5,
    high: c + 1,
    low: c - 1,
    close: c,
  }));
}

describe("readChartFacts", () => {
  it("returns null without enough closed candles", () => {
    expect(readChartFacts(series([1, 2, 3]))).toBeNull();
    expect(readChartFacts(undefined)).toBeNull();
  });

  it("drops the forming bar and reads the last closed close", () => {
    const bars = series(Array.from({ length: 30 }, (_, i) => 100 + i));
    const facts = readChartFacts(bars)!;
    expect(facts).not.toBeNull();
    // Last bar (129) is forming, so the last closed close is 128.
    expect(facts.lastClose).toBe(128);
  });

  it("detects an uptrend and a downtrend", () => {
    const up = readChartFacts(series(Array.from({ length: 40 }, (_, i) => 100 + i * 2)))!;
    expect(up.trend).toBe("up");
    const down = readChartFacts(series(Array.from({ length: 40 }, (_, i) => 200 - i * 2)))!;
    expect(down.trend).toBe("down");
  });

  it("calls a flat market sideways", () => {
    const flat = readChartFacts(series(Array.from({ length: 40 }, (_, i) => 100 + (i % 2) * 0.1)))!;
    expect(flat.trend).toBe("sideways");
  });

  it("produces swing levels around the last close and a positive ATR", () => {
    const facts = readChartFacts(series(Array.from({ length: 40 }, (_, i) => 100 + Math.sin(i) * 5)))!;
    expect(facts.swingHigh).toBeGreaterThan(facts.swingLow);
    expect(facts.atr).toBeGreaterThan(0);
    expect(facts.toHigh).toBeGreaterThanOrEqual(0);
    expect(facts.toLow).toBeGreaterThanOrEqual(0);
  });
});

describe("buildChartQuestions", () => {
  const facts = readChartFacts(series(Array.from({ length: 40 }, (_, i) => 2000 + i * 3)))!;

  it("returns two questions naming the instrument, timeframe and real levels", () => {
    const qs = buildChartQuestions({ facts, instrument: "Gold", timeframe: "1H", seed: 0 });
    expect(qs).toHaveLength(2);
    const text = qs.map((q) => `${q.question} ${q.options.join(" ")} ${q.why}`).join(" ");
    expect(text).toContain("Gold");
    expect(text).toContain(facts.lastClose.toFixed(facts.decimals));
  });

  it("keeps every correct index inside the options and ids unique", () => {
    for (const seed of [0, 1000, 2000, 3000, 4000]) {
      const qs = buildChartQuestions({ facts, instrument: "Gold", timeframe: "1H", seed });
      expect(new Set(qs.map((q) => q.id)).size).toBe(qs.length);
      for (const q of qs) {
        expect(q.options.length).toBeGreaterThanOrEqual(4);
        expect(q.correct).toBeGreaterThanOrEqual(0);
        expect(q.correct).toBeLessThan(q.options.length);
        expect(q.why.length).toBeGreaterThan(10);
      }
    }
  });

  it("is deterministic for the same seed and rotates with the seed", () => {
    const a = buildChartQuestions({ facts, instrument: "Gold", timeframe: "1H", seed: 1000 });
    const b = buildChartQuestions({ facts, instrument: "Gold", timeframe: "1H", seed: 1000 });
    expect(a.map((q) => q.id)).toEqual(b.map((q) => q.id));
    const c = buildChartQuestions({ facts, instrument: "Gold", timeframe: "1H", seed: 2000 });
    expect(c.map((q) => q.id)).not.toEqual(a.map((q) => q.id));
  });

  it("answers a ranging market with wait rather than a direction", () => {
    const flat = readChartFacts(series(Array.from({ length: 40 }, (_, i) => 100 + (i % 2) * 0.1)))!;
    const qs = buildChartQuestions({ facts: flat, instrument: "EUR/USD", timeframe: "15m", seed: 0 });
    const direction = qs.find((q) => q.id === "ctx-direction")!;
    expect(direction.options[direction.correct].toLowerCase()).toContain("wait");
  });
});
