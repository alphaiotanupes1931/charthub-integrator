import { describe, it, expect } from "vitest";
import {
  deltaAgainstPositionRead,
  setupTypeRead,
  staleHigherTimeframeRead,
  gradeFromEvidence,
} from "@/lib/agents/planner.server";
import type { OrderFlow } from "@/lib/agents/types";

// Reconstruction of the USD/JPY short that took an A grade and then stopped out:
// 4H/Daily bearish, 1H bullish, delta strongly positive and CVD rising.
const flow = (delta: number, cvdSlope: number, deltaAvg = 1200): OrderFlow =>
  ({
    estimated: false,
    delta,
    deltaAvg,
    cvdSlope,
    bias: "bearish",
    buyPct: 46,
    priceVsPoc: "below",
    depth: "thin",
    deltaConflict: false,
  }) as unknown as OrderFlow;

const snap = (opts: { h1: "bullish" | "bearish"; h4?: "bullish" | "bearish"; of?: OrderFlow; fetchedAt?: string }) =>
  ({
    ticker: "USD/JPY",
    interval: "15",
    lastPrice: 153.912,
    fetchedAt: opts.fetchedAt ?? new Date().toISOString(),
    orderFlow: opts.of,
    cisd: { htfBias: "bearish", state: "none", level: 0 },
    candles: [],
    mtf: {
      h4: {
        direction: opts.h4 ?? "bearish",
        trend: (opts.h4 ?? "bearish") === "bearish" ? "down" : "up",
        keyLevels: { support: [153.2], resistance: [154.424, 155.1] },
        supplyDemand: { supply: [], demand: [] },
      },
      h1: {
        structureBreak: opts.h1,
        reversal: "none",
        orderBlocks: { bull: [], bear: [[154.3, 154.424]] },
        fvg: { bull: [], bear: [] },
        liquidity: { buyside: [154.6], sellside: [] },
      },
      m15: { confirmation: "bearish", reason: "with trend" },
      alignment: "aligned-short",
      ladder: [
        { label: "Daily", bias: "bearish", trend: "down" },
        { label: "4H", bias: "bearish", trend: (opts.h4 ?? "bearish") === "bearish" ? "down" : "up" },
        { label: "1H", bias: opts.h1, trend: opts.h1 === "bullish" ? "up" : "down" },
      ],
    },
  }) as never;

describe("counter-trend fade classification", () => {
  it("calls a 4H-bearish / 1H-bullish short a fade and caps it at B", () => {
    const read = setupTypeRead("Short", snap({ h1: "bullish" }));
    expect(read.type).toBe("fade");
    expect(read.cap).toBe("B");
    expect(read.flipLevel).toBe(154.424);
    expect(read.reason).toMatch(/long becomes the higher-probability trade/);
  });

  it("leaves an aligned short as a trend setup", () => {
    expect(setupTypeRead("Short", snap({ h1: "bearish" })).type).toBe("trend");
  });

  it("treats a 4H that has turned as a reversal and caps at C", () => {
    const read = setupTypeRead("Short", snap({ h1: "bullish", h4: "bullish" }));
    expect(read.type).toBe("reversal");
    expect(read.cap).toBe("C");
  });

  it("never awards an A to the fade, however confident", () => {
    const grade = gradeFromEvidence("Short", 99, snap({ h1: "bullish" }));
    expect(["A", "A+"]).not.toContain(grade);
  });
});

describe("delta expanding against the position", () => {
  it("flags strongly expanding buy delta on a short", () => {
    const read = deltaAgainstPositionRead("Short", snap({ h1: "bullish", of: flow(4500, 1) }));
    expect(read.cap).toBe("C");
    expect(read.reason).toMatch(/Order flow warning/);
  });

  it("caps at B for a moderate build against the trade", () => {
    expect(deltaAgainstPositionRead("Short", snap({ h1: "bearish", of: flow(2200, 1) })).cap).toBe("B");
  });

  it("stays quiet when delta supports the trade", () => {
    expect(deltaAgainstPositionRead("Short", snap({ h1: "bearish", of: flow(-4500, -1) })).cap).toBeNull();
  });
});

describe("stale 4H data protection", () => {
  it("caps at C when a 4H candle closed after the data was pulled", () => {
    const now = Date.parse("2026-09-09T04:10:00Z");
    const read = staleHigherTimeframeRead(snap({ h1: "bearish", fetchedAt: "2026-09-09T03:50:00Z" }), now);
    expect(read.cap).toBe("C");
    expect(read.reason).toMatch(/04:00 UTC/);
  });

  it("accepts data pulled after the last 4H close", () => {
    const now = Date.parse("2026-09-09T04:10:00Z");
    expect(staleHigherTimeframeRead(snap({ h1: "bearish", fetchedAt: "2026-09-09T04:05:00Z" }), now).cap).toBeNull();
  });
});
