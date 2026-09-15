import { describe, expect, it } from "vitest";
import { readProtectedStructure, type PsCandle } from "@/lib/protectedStructure";
import { protectedStructureRead, protectedStopBeyond } from "@/lib/agents/planner.server";
import type { MarketSnapshot } from "@/lib/agents/types";

function c(time: number, low: number, high: number, open: number, close: number): PsCandle {
  return { time, low, high, open, close };
}

/**
 * Upside break where the low that led to the broken high FIRST swept the prior
 * swing low (98 taken out at 96) — a protected low.
 */
function sweptSeries(): PsCandle[] {
  return [
    c(1, 100, 104, 101, 103),
    c(2, 98, 102, 102, 99), // prior swing low @ 98
    c(3, 100, 106, 100, 105),
    c(4, 103, 110, 105, 109), // swing high @ 110 (broken later)
    c(5, 102, 108, 108, 104),
    c(6, 96, 103, 103, 98), // sweeps 98 -> protected low @ 96
    c(7, 99, 107, 98, 106),
    c(8, 104, 112, 106, 111), // closes above 110
    c(9, 108, 114, 111, 113),
    c(10, 110, 116, 113, 115),
    c(11, 112, 118, 115, 117),
  ];
}

/** Same shape, but the origin low never takes out the prior low. */
function unsweptSeries(): PsCandle[] {
  const s = sweptSeries().map((x) => ({ ...x }));
  s[5] = c(6, 101, 103, 103, 102); // low 101 > prior low 98
  return s;
}

function snap(bos: ReturnType<typeof readProtectedStructure>): MarketSnapshot {
  return {
    ticker: "XAU/USD",
    interval: "15",
    source: "oanda",
    lastPrice: 115,
    candles: [],
    stats: { high20: 118, low20: 96, high50: 120, low50: 90, atr14: 3, changePct24h: 1, range20Pct: 1 },
    cisd: { state: "bullish", level: 110, trigger: 111, proj1: 120, proj2: 125, htfBias: "bullish" },
    sessionsActive: [],
    fetchedAt: new Date().toISOString(),
    mtf: {
      h4: { direction: "bullish", trend: "up", keyLevels: { support: [], resistance: [] }, supplyDemand: { supply: [], demand: [] } },
      h1: {
        structureBreak: "bullish",
        reversal: "none",
        orderBlocks: { bull: [], bear: [] },
        fvg: { bull: [], bear: [] },
        liquidity: { buyside: [], sellside: [] },
        bos,
      },
      m15: { confirmation: "bullish", reason: "BOS" },
      alignment: "aligned-long",
    },
  } as MarketSnapshot;
}

describe("protected low / high", () => {
  it("calls an upside break protected when the origin low swept prior liquidity", () => {
    const read = readProtectedStructure(sweptSeries(), { wing: 1 });
    expect(read).not.toBeNull();
    expect(read?.kind).toBe("bullish");
    expect(read?.swept).toBe(true);
    expect(read?.quality).toBe("protected");
    expect(read?.protectedLevel).toBe(96);
    expect(read?.reason).toContain("Good break of structure");
  });

  it("calls the same break bad when nothing was swept", () => {
    const read = readProtectedStructure(unsweptSeries(), { wing: 1 });
    expect(read?.quality).toBe("unprotected");
    expect(read?.protectedLevel).toBeNull();
    expect(read?.reason).toContain("Bad break of structure");
  });

  it("returns null without enough candles to read swings", () => {
    expect(readProtectedStructure(sweptSeries().slice(0, 3), { wing: 2 })).toBeNull();
  });

  it("caps an unprotected break at C and leaves a protected one uncapped", () => {
    const bad = readProtectedStructure(unsweptSeries(), { wing: 1 });
    expect(protectedStructureRead("Long", snap(bad)).cap).toBe("C");

    const good = readProtectedStructure(sweptSeries(), { wing: 1 });
    expect(protectedStructureRead("Long", snap(good)).cap).toBeNull();
  });

  it("anchors the long stop under the protected low", () => {
    const good = readProtectedStructure(sweptSeries(), { wing: 1 });
    const stop = protectedStopBeyond("Long", 112, 3, snap(good));
    expect(stop).not.toBeNull();
    expect(stop!).toBeLessThan(96);
    expect(protectedStopBeyond("Long", 112, 3, snap(readProtectedStructure(unsweptSeries(), { wing: 1 })))).toBeNull();
  });
});
