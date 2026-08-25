import { describe, it, expect } from "vitest";
import { timeFrameComboGate, gradeFromEvidence } from "@/lib/agents/planner.server";

const snap = (o: {
  h4: "bullish" | "bearish" | "neutral";
  h4Trend?: "up" | "down" | "range";
  h4Structure?: "bullish" | "bearish" | "none";
  h1Break?: "bullish" | "bearish" | "none";
  sellside?: number[];
  buyside?: number[];
  m15?: "bullish" | "bearish" | "none";
}) =>
  ({
    lastPrice: 100,
    cisd: { state: "none", htfBias: o.h4 },
    mtf: {
      alignment: o.h4 === "bullish" ? "aligned-long" : "aligned-short",
      h4: {
        direction: o.h4,
        trend: o.h4Trend ?? (o.h4 === "bullish" ? "up" : "down"),
        keyLevels: { support: [], resistance: [] },
        supplyDemand: { supply: [], demand: [] },
      },
      h1: {
        structureBreak: o.h1Break ?? "none",
        reversal: "none",
        orderBlocks: { bull: [], bear: [] },
        fvg: { bull: [], bear: [] },
        liquidity: { buyside: o.buyside ?? [], sellside: o.sellside ?? [] },
      },
      m15: { confirmation: o.m15 ?? "none", reason: "test" },
      ladder: [
        { label: "Daily", bias: o.h4, trend: "up", structure: "bullish" },
        { label: "4H", bias: o.h4, trend: o.h4Trend ?? "up", structure: o.h4Structure ?? "none" },
      ],
    },
  }) as never;

describe("hard-coded Time Frame Combo", () => {
  it("rejects a short while the 4H direction is bullish", () => {
    const g = timeFrameComboGate("Short", snap({ h4: "bullish" }));
    expect(g.cap).toBe("NO ENTRY");
    expect(gradeFromEvidence("Short", 95, snap({ h4: "bullish" }))).toBe("NO ENTRY");
  });

  it("allows the counter-direction only after the 4H breaks structure", () => {
    const s = snap({ h4: "bullish", h4Structure: "bearish", h1Break: "bearish", m15: "bearish" });
    expect(timeFrameComboGate("Short", s).cap).not.toBe("NO ENTRY");
  });

  it("caps at B without 1H liquidity or a 1H break", () => {
    const g = timeFrameComboGate("Long", snap({ h4: "bullish", m15: "bullish" }));
    expect(g.cap).toBe("B");
    expect(g.checks.h1).toBe(false);
  });

  it("caps at B while the 15m has not confirmed", () => {
    const g = timeFrameComboGate("Long", snap({ h4: "bullish", sellside: [99] }));
    expect(g.cap).toBe("B");
  });

  it("caps at C when the 15m break is against the trade", () => {
    const g = timeFrameComboGate("Long", snap({ h4: "bullish", sellside: [99], m15: "bearish" }));
    expect(g.cap).toBe("C");
  });

  it("passes clean when 4H, 1H and 15m all line up", () => {
    const g = timeFrameComboGate("Long", snap({ h4: "bullish", sellside: [99], m15: "bullish" }));
    expect(g.cap).toBe(null);
    expect(g.checks).toEqual({ h4: true, h1: true, m15: true });
  });
});
