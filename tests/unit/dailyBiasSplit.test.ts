import { describe, it, expect } from "vitest";
import {
  analyzeDailyBiasSplit,
  bucketFor,
  directionAt,
  type TaggedBiasSignal,
} from "@/lib/daily-bias-split.server";
import { classifyTrendRelation } from "@/lib/trend-relation";

const bars = (n: number, step: number) =>
  Array.from({ length: n }, (_, i) => {
    const close = 100 + i * step;
    return { time: 1000 + i * 60, open: close, high: close + 1, low: close - 1, close, volume: 1 };
  });

describe("direction reconstruction", () => {
  it("never reads a bar after the filing time", () => {
    const up = bars(200, 1);
    const cutoff = new Date((1000 + 80 * 60) * 1000).toISOString();
    // A violent reversal after the cutoff must not change the read.
    const poisoned = [...up];
    for (let i = 120; i < 200; i++) poisoned[i] = { ...poisoned[i]!, close: 1 };
    expect(directionAt(poisoned, cutoff)).toBe(directionAt(up, cutoff));
  });

  it("returns null without enough history", () => {
    expect(directionAt(bars(30, 1), new Date((1000 + 29 * 60) * 1000).toISOString())).toBeNull();
  });

  it("calls up and down trends", () => {
    const iso = new Date((1000 + 199 * 60) * 1000).toISOString();
    expect(directionAt(bars(200, 1), iso)).toBe("bullish");
    expect(directionAt(bars(200, -0.3), iso)).toBe("bearish");
  });
});

describe("bucketing", () => {
  it("separates with-daily, retracement and counter-trend", () => {
    expect(bucketFor({ bias: "Long", dailyBias: "bullish", h4: "bullish" })).toBe("with-daily");
    expect(bucketFor({ bias: "Long", dailyBias: "bearish", h4: "bullish" })).toBe("against-daily-with-4h");
    expect(bucketFor({ bias: "Long", dailyBias: "bearish", h4: "bearish" })).toBe("counter-trend");
  });

  it("refuses to bucket a flat daily bias or a neutral signal", () => {
    expect(bucketFor({ bias: "Long", dailyBias: "neutral", h4: "bullish" })).toBe("unclassified");
    expect(bucketFor({ bias: "Neutral", dailyBias: "bearish", h4: "bullish" })).toBe("unclassified");
  });
});

const row = (i: number, bucket: TaggedBiasSignal["bucket"], status: string, r: number): TaggedBiasSignal => ({
  id: `s${i}-${bucket}`,
  symbol: "XAU/USD",
  timeframe: "60",
  grade: "A",
  bias: "Long",
  status,
  r,
  created_at: new Date().toISOString(),
  dailyBias: "bullish",
  h4Trend: "up",
  bucket,
});

describe("split report", () => {
  it("reports small cells instead of claiming them", () => {
    const rows = [row(1, "with-daily", "target", 2), row(2, "with-daily", "stop", -1)];
    const rep = analyzeDailyBiasSplit(rows);
    expect(rep.byBucket[0]!.decided).toBe(2);
    expect(rep.byBucket[0]!.enoughData).toBe(false);
    expect(rep.comparison).toBeNull();
    expect(rep.verdict).toContain("Not enough");
  });

  it("finds a clear edge for the daily bias when one exists", () => {
    const rows: TaggedBiasSignal[] = [];
    for (let i = 0; i < 40; i++) rows.push(row(i, "with-daily", i < 30 ? "target" : "stop", i < 30 ? 2 : -1));
    for (let i = 0; i < 40; i++) rows.push(row(100 + i, "against-daily-with-4h", i < 8 ? "target" : "stop", i < 8 ? 2 : -1));
    const rep = analyzeDailyBiasSplit(rows);
    expect(rep.comparison!.avgRGap).toBeGreaterThan(0.1);
    expect(rep.verdict).toContain("Supported");
  });

  it("says so when the claim fails", () => {
    const rows: TaggedBiasSignal[] = [];
    for (let i = 0; i < 40; i++) rows.push(row(i, "with-daily", i < 8 ? "target" : "stop", i < 8 ? 2 : -1));
    for (let i = 0; i < 40; i++) rows.push(row(100 + i, "against-daily-with-4h", i < 30 ? "target" : "stop", i < 30 ? 2 : -1));
    const rep = analyzeDailyBiasSplit(rows);
    expect(rep.verdict).toContain("Against the claim");
  });

  it("excludes unclassified rows from the cells", () => {
    const rep = analyzeDailyBiasSplit([row(1, "unclassified", "target", 2), row(2, "with-daily", "stop", -1)]);
    expect(rep.untagged).toBe(1);
    expect(rep.byBucket.reduce((s, c) => s + c.decided, 0)).toBe(1);
  });
});

describe("trader-facing label", () => {
  it("calls a 4H buy under a bearish daily a retracement, not a counter-trend trade", () => {
    const rel = classifyTrendRelation({ bias: "Long", dailyBias: "bearish", h4Direction: "up" });
    expect(rel.label).toBe("Against the daily bias");
    expect(rel.counterTrend).toBe(false);
    expect(rel.pullbackIntoDaily).toBe(true);
  });

  it("calls a trade against both counter-trend", () => {
    const rel = classifyTrendRelation({ bias: "Long", dailyBias: "bearish", h4Direction: "down" });
    expect(rel.label).toBe("Counter-trend");
    expect(rel.counterTrend).toBe(true);
  });

  it("labels an aligned trade plainly", () => {
    expect(classifyTrendRelation({ bias: "Short", dailyBias: "bearish", h4Direction: "down" }).label)
      .toBe("With the daily bias");
  });

  it("does not judge a trade with no daily direction", () => {
    const rel = classifyTrendRelation({ bias: "Long", dailyBias: "neutral", h4Direction: "up" });
    expect(rel.label).toBe("Daily bias unclear");
    expect(rel.againstDaily).toBe(false);
  });
});
