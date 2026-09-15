import { describe, it, expect } from "vitest";
import {
  behaviourFor,
  behaviourBrief,
  applyBehaviourGrade,
  ceilingFromExpectancy,
  expectedHold,
  sessionAt,
  sessionGate,
  MEASURED_EXPECTANCY_R,
} from "@/lib/instrumentBehaviour";
import { INSTRUMENTS } from "@/lib/agents/biasEngine";

const at = (hourUtc: number) => Date.UTC(2026, 8, 15, hourUtc, 0, 0);

describe("per-instrument behaviour", () => {
  it("classifies each instrument family, not one universal profile", () => {
    expect(behaviourFor("XAU/USD").klass).toBe("metal");
    expect(behaviourFor("NAS100").klass).toBe("index");
    expect(behaviourFor("BTC/USD").klass).toBe("crypto");
    expect(behaviourFor("WTI Oil").klass).toBe("energy");
    expect(behaviourFor("EUR/USD").klass).toBe("fx_major");
    expect(behaviourFor("USD/JPY").klass).toBe("fx_yen");
    expect(behaviourFor("AUD/USD").klass).toBe("fx_commodity");
    expect(behaviourFor("USB10Y_USD").klass).toBe("rates");
    expect(behaviourFor("CORN_USD").klass).toBe("other");
  });

  it("gives each family its own sessions, hold and target style", () => {
    const jp = behaviourFor("JPN225");
    expect(jp.activeSessions).toContain("asia");
    expect(jp.activeSessions).not.toContain("newyork");

    const eur = behaviourFor("EUR/USD");
    expect(eur.activeSessions).not.toContain("asia");

    const btc = behaviourFor("BTC/USD");
    expect(btc.continuous).toBe(true);
    expect(btc.style).toBe("swing");
    expect(expectedHold(btc).hours).toBeGreaterThan(expectedHold(behaviourFor("NAS100")).hours);

    expect(behaviourFor("XAU/USD").targetStrategy).toBe("measured_move");
    expect(behaviourFor("WTI Oil").targetStrategy).toBe("range_extreme");
  });

  it("maps clock hours to sessions", () => {
    expect(sessionAt(at(3))).toBe("asia");
    expect(sessionAt(at(9))).toBe("london");
    expect(sessionAt(at(15))).toBe("newyork");
    expect(sessionAt(at(23))).toBe("asia");
  });

  it("drops the grade when a market is scanned outside its own window", () => {
    const eur = behaviourFor("EUR/USD");
    const asia = sessionGate(eur, at(3));
    expect(asia.active).toBe(false);
    expect(asia.gradeDelta).toBe(-2);
    expect(asia.note).toMatch(/Wait for London/);

    const london = sessionGate(eur, at(9));
    expect(london.best).toBe(true);
    expect(london.gradeDelta).toBe(0);
  });

  it("never session-gates a 24/7 market", () => {
    const btc = behaviourFor("BTC/USD");
    expect(sessionGate(btc, at(3)).active).toBe(true);
  });

  it("caps grades on markets with no measured edge and lifts the proven ones", () => {
    expect(ceilingFromExpectancy(0.11)).toBe("A+");
    expect(ceilingFromExpectancy(0.01)).toBe("A");
    expect(ceilingFromExpectancy(-0.03)).toBe("B");
    expect(ceilingFromExpectancy(null)).toBe("B");

    expect(behaviourFor("XAU/USD").gradeCeiling).toBe("A+");
    expect(behaviourFor("USD/JPY").gradeCeiling).toBe("B");
    expect(behaviourFor("CORN_USD").gradeCeiling).toBe("B");
  });

  it("applies session and edge ceiling together without touching direction", () => {
    const gold = behaviourFor("XAU/USD");
    const prime = applyBehaviourGrade("A+", gold, at(15));
    expect(prime.grade).toBe("A+");

    const offSession = applyBehaviourGrade("A+", gold, at(3));
    expect(offSession.grade).toBe("B");
    expect(offSession.notes.join(" ")).toMatch(/Wait for New York/);

    const jpy = applyBehaviourGrade("A+", behaviourFor("USD/JPY"), at(15));
    expect(jpy.grade).toBe("B");
    expect(jpy.notes.join(" ")).toMatch(/expectancy/);
  });

  it("prefers a measured best session over the shipped default", () => {
    const b = behaviourFor("EUR/USD", { bestSession: "newyork", barsSampled: 900 });
    expect(b.bestSession).toBe("newyork");
    const thin = behaviourFor("EUR/USD", { bestSession: "newyork", barsSampled: 20 });
    expect(thin.bestSession).toBe("london");
  });

  it("writes a brief the coach can quote", () => {
    const brief = behaviourBrief(behaviourFor("NAS100"), at(15));
    expect(brief).toMatch(/NAS100/);
    expect(brief).toMatch(/Sessions/);
    expect(brief).toMatch(/Max grade allowed/);
  });

  it("every shipped instrument has a behaviour and every expectancy row a config", () => {
    for (const symbol of Object.keys(INSTRUMENTS)) {
      const b = behaviourFor(symbol);
      expect(b.activeSessions.length).toBeGreaterThan(0);
      expect(b.holdBars4h).toBeGreaterThan(0);
      expect(b.activeSessions).toContain(b.bestSession);
    }
    for (const symbol of Object.keys(MEASURED_EXPECTANCY_R)) {
      expect(INSTRUMENTS[symbol]).toBeTruthy();
    }
  });
});
