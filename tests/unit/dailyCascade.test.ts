import { describe, expect, it } from "vitest";
import { dailyBiasGate, gradeFromEvidence } from "@/lib/agents/planner.server";

/** Minimal snapshot: bearish Daily, bullish 4H — the US30 case. */
const snap = (o: {
  daily: "bullish" | "bearish" | "neutral";
  h4: "bullish" | "bearish" | "neutral";
  dailyStructure?: "bullish" | "bearish" | "none";
  h4Structure?: "bullish" | "bearish" | "none";
}) =>
  ({
    lastPrice: 100,
    stats: { high20: 110, low20: 90 },
    cisd: { state: "none", htfBias: o.daily },
    mtf: {
      alignment: "none",
      h4: {
        direction: o.h4,
        trend: o.h4 === "bullish" ? "up" : "down",
        keyLevels: { support: [], resistance: [] },
        supplyDemand: { supply: [], demand: [] },
      },
      h1: {
        structureBreak: o.h4,
        reversal: "none",
        orderBlocks: { bull: [], bear: [] },
        fvg: { bull: [], bear: [] },
        liquidity: { buyside: [], sellside: [] },
      },
      m15: { confirmation: o.h4, reason: "test" },
      ladder: [
        { label: "Daily", bias: o.daily, trend: "down", structure: o.dailyStructure ?? "none" },
        { label: "4H", bias: o.h4, trend: "up", structure: o.h4Structure ?? "none" },
      ],
    },
  }) as never;

describe("Daily outranks the 4H", () => {
  it("holds a long at C when the Daily is bearish and nothing has broken up", () => {
    const s = snap({ daily: "bearish", h4: "bullish" });
    expect(dailyBiasGate("Long", s).cap).toBe("C");
    expect(gradeFromEvidence("Long", 90, s)).toBe("C");
  });

  it("allows B once the Daily or 4H has broken structure the trade's way", () => {
    const s = snap({ daily: "bearish", h4: "bullish", h4Structure: "bullish" });
    expect(dailyBiasGate("Long", s).cap).toBe("B");
  });

  it("does not fire when the trade agrees with the Daily", () => {
    expect(dailyBiasGate("Short", snap({ daily: "bearish", h4: "bearish" })).cap).toBeNull();
    expect(dailyBiasGate("Long", snap({ daily: "bullish", h4: "bullish" })).cap).toBeNull();
  });

  it("never fires on a neutral read", () => {
    expect(dailyBiasGate("Neutral", snap({ daily: "bearish", h4: "bullish" })).cap).toBeNull();
  });
});
