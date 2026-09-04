import { describe, it, expect } from "vitest";
import { classifyRegime, pickStrategyForConditions, type MarketConditions } from "@/lib/strategyAuto";

const base: MarketConditions = {
  interval: "60",
  trend: "range",
  alignment: "none",
  cisd: "none",
  atrPct: 0.3,
  rangePct: 1.2,
  atRangeEdge: false,
  volRatio: 1,
  depth: "normal",
  market: "Forex",
  sessionOpen: true,
};

describe("auto strategy selection", () => {
  it("picks a breakout playbook when price breaks the range on volume", () => {
    const pick = pickStrategyForConditions({ ...base, trend: "up", atRangeEdge: true, volRatio: 1.4 });
    expect(pick.regime).toBe("breakout-expansion");
    expect(pick.slug).toBe("breakout-retest");
  });

  it("picks a continuation playbook when timeframes are aligned", () => {
    const pick = pickStrategyForConditions({ ...base, trend: "up", alignment: "aligned-long" });
    expect(pick.regime).toBe("trend-continuation");
    expect(pick.slug).toBe("ict-concepts");
  });

  it("uses the CISD flip intraday when delivery just flipped", () => {
    const pick = pickStrategyForConditions({ ...base, trend: "down", alignment: "aligned-short", cisd: "bearish" });
    expect(pick.slug).toBe("cisd-flip");
  });

  it("fades extremes in a live range", () => {
    const pick = pickStrategyForConditions({ ...base, trend: "range", atrPct: 0.5 });
    expect(pick.regime).toBe("range-mean-reversion");
    expect(pick.slug).toBe("mean-reversion-bollinger");
  });

  it("stands down to zones when the market is quiet and thin", () => {
    expect(classifyRegime({ ...base, atrPct: 0.05, volRatio: 0.2, depth: "thin" })).toBe("quiet-chop");
  });

  it("trades the pullback when the trend holds but the entry timeframe rotates", () => {
    const pick = pickStrategyForConditions({ ...base, trend: "up", alignment: "mixed", atrPct: 0.6 });
    expect(pick.regime).toBe("trend-pullback");
    expect(pick.slug).toBe("fibonacci-retracement");
  });

  it("always gives a reason the trader can read", () => {
    const pick = pickStrategyForConditions(base);
    expect(pick.reason.length).toBeGreaterThan(20);
  });
});
