import { describe, expect, it } from "vitest";
import { photonAnalysis, type PhotonCandle } from "@/lib/analysis-models/photon-engine";
import { PHOTON_RULEBOOK, photonRulebookForPrompt } from "@/lib/analysis-models/photon-rulebook";

let t = 0;
const bar = (open: number, high: number, low: number, close: number): PhotonCandle => ({
  time: (t += 3600),
  open,
  high,
  low,
  close,
});

/** Flat chop with no swing break: the model must stay out. */
const chop = (): PhotonCandle[] => {
  const out: PhotonCandle[] = [];
  let p = 100;
  for (let i = 0; i < 60; i++) {
    p += i % 2 === 0 ? 0.4 : -0.4;
    out.push(bar(p, p + 0.5, p - 0.5, p));
  }
  return out;
};

/**
 * A textbook bearish Photon sequence: swing low at 98, swing high at 102, a
 * CLOSE below 98 (swing break of structure), a pullback that retraces toward
 * the broken level without closing through it, then an internal change of
 * character back down (realign) and continuation.
 */
const bearishContinuation = (): PhotonCandle[] => {
  const out: PhotonCandle[] = [];
  const push = (o: number, h: number, l: number, c: number) => out.push(bar(o, h, l, c));
  // Flat base.
  for (let i = 0; i < 44; i++) push(100, 100.4, 99.6, 100);
  push(100, 100.2, 98.0, 98.6);   // 20: swing low 98.0 (pivot)
  push(98.6, 99.8, 98.4, 99.6);   // 21
  push(99.6, 101.0, 99.4, 100.8); // 22
  push(100.8, 102.0, 100.6, 101.8); // 23: swing high 102.0 (pivot)
  push(101.8, 101.9, 101.0, 101.2); // 24
  push(101.2, 101.4, 100.6, 100.8); // 25
  push(100.8, 100.9, 99.6, 99.8);   // 26
  push(99.8, 99.9, 98.6, 98.8);     // 27
  push(98.8, 98.9, 97.8, 97.9);     // 28: CLOSE below 98.0 - bearish swing BOS
  push(97.9, 97.8, 95.2, 95.5);     // 29: down leg
  push(95.5, 95.7, 94.6, 94.8);     // 30: leg low 94.6 (weak low - the target)
  push(94.8, 96.0, 94.7, 95.9);     // 31: breaks prior bar's high - pullback starts
  push(95.9, 98.2, 95.8, 97.95);    // 32: pullback high 98.2 (protecting swing), close below 98
  push(97.95, 98.1, 97.5, 97.6);    // 33
  push(97.6, 97.7, 96.9, 97.0);     // 34: breaks prior bar's low - realign
  push(97.0, 97.3, 96.7, 96.9);     // 35: last closed bar (entry)
  return out;
};

/** The same break, cut before the pullback begins. */
const freshBreakOnly = (): PhotonCandle[] => bearishContinuation().slice(0, 31);

/** Bullish mirror: close above the swing high, pullback, realign up. */
const bullishContinuation = (): PhotonCandle[] => {
  const out: PhotonCandle[] = [];
  const push = (o: number, h: number, l: number, c: number) => out.push(bar(o, h, l, c));
  for (let i = 0; i < 44; i++) push(100, 100.4, 99.6, 100);
  push(100, 102.0, 99.8, 101.4);   // 20: swing high 102.0 (pivot)
  push(101.4, 101.6, 100.2, 100.4); // 21
  push(100.4, 100.6, 99.0, 99.2);   // 22
  push(99.2, 99.4, 98.0, 98.2);     // 23: swing low 98.0 (pivot)
  push(98.2, 98.9, 98.1, 98.8);     // 24
  push(98.8, 99.0, 98.2, 98.9);     // 25
  push(98.9, 99.6, 98.8, 99.5);     // 26
  push(99.5, 100.9, 99.4, 100.8);   // 27
  push(100.8, 102.2, 100.7, 102.1); // 28: CLOSE above 102.0 - bullish swing BOS
  push(102.1, 104.8, 102.0, 104.6); // 29: up leg
  push(104.6, 105.4, 104.5, 105.3); // 30: leg high 105.4 (weak high - the target)
  push(105.3, 105.2, 104.0, 104.1); // 31: breaks prior bar's low - pullback starts
  push(104.1, 104.2, 102.05, 102.2); // 32: pullback low 102.05 (protecting swing)
  push(102.2, 103.0, 102.1, 102.9); // 33
  push(102.9, 103.6, 102.8, 103.5); // 34: breaks prior bar's high - realign
  push(103.5, 103.8, 103.2, 103.7); // 35: last closed bar (entry)
  return out;
};

describe("Photon Trading engine", () => {
  it("stays out of directionless chop", () => {
    const read = photonAnalysis(chop());
    expect(read.grade).toBe("NO ENTRY");
    expect(read.bias).toBe("Neutral");
    expect(read.entry).toBeNull();
    expect(read.phase).toBe("no-trend");
  });

  it("refuses to read thin data", () => {
    const read = photonAnalysis(chop().slice(0, 10));
    expect(read.grade).toBe("NO ENTRY");
  });

  it("is deterministic: same bars, same read", () => {
    expect(photonAnalysis(bearishContinuation())).toEqual(photonAnalysis(bearishContinuation()));
  });

  it("waits for the pullback after a fresh break instead of chasing", () => {
    const read = photonAnalysis(freshBreakOnly());
    expect(read.swingTrend).toBe("down");
    expect(read.grade).toBe("NO ENTRY");
    expect(read.bias).toBe("Neutral");
    expect(read.phase).toBe("broken-awaiting-pullback");
    expect(read.cap).toContain("pullback");
  });

  it("reads a bearish break, pullback and realign with a protecting-swing stop and weak-structure target", () => {
    const read = photonAnalysis(bearishContinuation());
    expect(read.swingTrend).toBe("down");
    expect(read.phase).toBe("realigned");
    expect(read.bias).toBe("Short");
    expect(read.grade).not.toBe("NO ENTRY");
    expect(read.entry).not.toBeNull();
    // Stop hides beyond the pullback high (the protecting swing).
    expect(read.stop!).toBeGreaterThan(read.entry!);
    expect(read.stop!).toBeGreaterThanOrEqual(98.2);
    expect(read.protectingSwing).toBe(98.2);
    // Target aims at the weak low the pullback left behind and pays at least 1.5R.
    expect(read.tp1!).toBeLessThan(read.entry!);
    expect(read.tp1).toBe(94.6);
    expect(read.rr!).toBeGreaterThanOrEqual(1.5);
    expect(read.barsSinceRealign).toBe(1);
  });

  it("reads the bullish mirror", () => {
    const read = photonAnalysis(bullishContinuation());
    expect(read.swingTrend).toBe("up");
    expect(read.phase).toBe("realigned");
    expect(read.bias).toBe("Long");
    expect(read.grade).not.toBe("NO ENTRY");
    expect(read.stop!).toBeLessThan(read.entry!);
    expect(read.stop!).toBeLessThanOrEqual(102.05);
    expect(read.tp1!).toBeGreaterThan(read.entry!);
    expect(read.rr!).toBeGreaterThanOrEqual(1.5);
  });

  it("never issues A+ in v1", () => {
    for (const bars of [chop(), bearishContinuation(), bullishContinuation()]) {
      expect(photonAnalysis(bars).grade).not.toBe("A+");
    }
  });

  it("reports a rule check for every rule the engine covers", () => {
    const read = photonAnalysis(bearishContinuation());
    const ids = read.rules.map((r) => r.id);
    expect(ids).toEqual(expect.arrayContaining([2, 3, 4, 6, 8, 9]));
  });
});

describe("Photon Trading rulebook", () => {
  it("has numbered rules the engine and the coach can both cite", () => {
    expect(PHOTON_RULEBOOK.length).toBeGreaterThanOrEqual(10);
    const ids = PHOTON_RULEBOOK.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("keeps the AI boundary explicit in the prompt block", () => {
    const prompt = photonRulebookForPrompt();
    expect(prompt).toContain("RULEBOOK photon-1.0");
    expect(prompt).toContain("never by you");
  });
});
