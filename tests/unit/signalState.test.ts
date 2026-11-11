import { describe, it, expect } from "vitest";
import { signalState, toAction } from "@/lib/agents/signal-engine.functions";
import type { TradePlan } from "@/lib/agents/types";

const plan = (over: Partial<TradePlan>): TradePlan =>
  ({
    methodologyVersion: "test",
    grade: "A",
    bias: "Long",
    confidence: 70,
    notes: "",
    entry: "100",
    stop: "98",
    tp1: "104",
    tp2: "108",
    rr: "2",
    details: "",
    memo: { ticker: "XAU/USD", interval: "60", generatedAt: "", notes: [], consensus: "bullish", consensusConfidence: 70 },
    ...over,
  }) as TradePlan;

describe("signal state machine", () => {
  it("confirms only when the plan has triggered", () => {
    expect(signalState(plan({ triggered: true }), "BUY").state).toBe("confirmed");
  });

  it("keeps an untriggered setup forming, with the waiting rule as the reason", () => {
    const r = signalState(plan({ triggered: false, triggerRule: "Not at the entry yet" }), "BUY");
    expect(r.state).toBe("forming");
    expect(r.stateReason).toMatch(/Not at the entry yet/);
  });

  it("treats a HOLD with a valid thesis as forming, not an entry", () => {
    expect(signalState(plan({ confidence: 30 }), "HOLD").state).toBe("forming");
  });

  it("invalidates NO ENTRY and neutral plans", () => {
    expect(signalState(plan({ grade: "NO ENTRY" }), "HOLD").state).toBe("invalidated");
    expect(signalState(plan({ bias: "Neutral" }), "HOLD").state).toBe("invalidated");
  });
});

describe("signal action", () => {
  it("shows a Grade C long with confidence 40 as BUY, not HOLD", () => {
    expect(toAction(plan({ grade: "C", bias: "Long", confidence: 40 }))).toBe("BUY");
  });

  it("shows a Grade C short with confidence 40 as SELL", () => {
    expect(toAction(plan({ grade: "C", bias: "Short", confidence: 40 }))).toBe("SELL");
  });

  it("keeps NO ENTRY and neutral plans as HOLD", () => {
    expect(toAction(plan({ grade: "NO ENTRY" }))).toBe("HOLD");
    expect(toAction(plan({ bias: "Neutral", grade: "C" }))).toBe("HOLD");
  });
});
