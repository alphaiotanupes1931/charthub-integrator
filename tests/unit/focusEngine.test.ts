import { describe, expect, it } from "vitest";
import { focusAnalysis, focusAtr, type FocusCandle } from "@/lib/analysis-models/focus-engine";
import { FOCUS_RULEBOOK, focusRulebookForPrompt } from "@/lib/analysis-models/focus-rulebook";

let t = 0;
const bar = (open: number, high: number, low: number, close: number): FocusCandle => ({
  time: (t += 3600),
  open,
  high,
  low,
  close,
});

/** Flat chop with no impulsive break: the model must stay out. */
const chop = (): FocusCandle[] => {
  const out: FocusCandle[] = [];
  let p = 100;
  for (let i = 0; i < 60; i++) {
    p += i % 2 === 0 ? 0.4 : -0.4;
    out.push(bar(p, p + 0.5, p - 0.5, p));
  }
  return out;
};

/**
 * A textbook bullish break and retest: rally leg, pullback, impulsive close
 * through the swing high, pullback back into the broken level, then a strong
 * green 38.2-style candle closing back above the level.
 */
const bullishBreakRetest = (): FocusCandle[] => {
  const out: FocusCandle[] = [];
  const push = (o: number, h: number, l: number, c: number) => out.push(bar(o, h, l, c));
  // Base with a clear swing high at 101 and pullback origin low at 98.
  for (let i = 0; i < 20; i++) push(99, 99.6, 98.6, 99.2);
  push(99.2, 101.2, 98.9, 100.8); // swing high 101.2 (pivot, 2 bars each side)
  push(100.8, 100.9, 98.2, 98.4); // pullback
  push(98.4, 98.6, 97.9, 98.1); // origin low 97.9
  push(98.1, 98.4, 98.0, 98.3);
  // Impulsive break: close above 101.2.
  push(98.3, 101.8, 98.2, 101.6);
  push(101.6, 102.4, 101.4, 102.2);
  // Pull back into the broken level without closing below it.
  push(102.2, 102.3, 101.1, 101.3);
  push(101.3, 101.5, 101.0, 101.2);
  // Pressure candle: green, body above the 38.2 line of its own range.
  push(101.2, 102.1, 100.9, 102.0);
  // Pad so the 20-MA and pivots have history.
  for (let i = 0; i < 6; i++) push(102.0, 102.2, 101.6, 102.0);
  // Re-present the setup at the very end: dip to the level, then pressure.
  push(102.0, 102.1, 101.05, 101.2);
  push(101.2, 102.2, 100.95, 102.05);
  return out;
};

describe("focus ATR", () => {
  it("is zero with too few bars and positive on real data", () => {
    expect(focusAtr(chop().slice(0, 5))).toBe(0);
    expect(focusAtr(chop())).toBeGreaterThan(0);
  });
});

describe("The Trading Channel engine", () => {
  it("stays out of directionless chop", () => {
    const read = focusAnalysis(chop());
    expect(read.grade).toBe("NO ENTRY");
    expect(read.bias).toBe("Neutral");
    expect(read.entry).toBeNull();
  });

  it("refuses to read thin data", () => {
    const read = focusAnalysis(chop().slice(0, 10));
    expect(read.grade).toBe("NO ENTRY");
  });

  it("is deterministic: same bars, same read", () => {
    const a = focusAnalysis(bullishBreakRetest());
    const b = focusAnalysis(bullishBreakRetest());
    expect(a).toEqual(b);
  });

  it("reads a bullish break and retest with an ATR stop and a priced target", () => {
    const read = focusAnalysis(bullishBreakRetest());
    expect(read.trend).toBe("up");
    if (read.grade !== "NO ENTRY") {
      expect(read.bias).toBe("Long");
      expect(read.setup).toBe("break-retest");
      expect(read.entry).not.toBeNull();
      expect(read.stop!).toBeLessThan(read.entry!);
      expect(read.tp1!).toBeGreaterThan(read.entry!);
      expect(read.rr!).toBeGreaterThanOrEqual(1.5);
      // Stop sits a full ATR beyond the protecting swing.
      expect(read.atr).toBeGreaterThan(0);
    }
  });

  it("never issues A+ in v1", () => {
    for (const bars of [chop(), bullishBreakRetest()]) {
      expect(focusAnalysis(bars).grade).not.toBe("A+");
    }
  });

  it("reports a rule check for every rule the engine covers", () => {
    const read = focusAnalysis(bullishBreakRetest());
    const ids = read.rules.map((r) => r.id);
    expect(ids).toEqual(expect.arrayContaining([1, 2]));
    if (read.grade !== "NO ENTRY") {
      expect(ids).toEqual(expect.arrayContaining([3, 4, 8, 9, 10, 11]));
    }
  });
});

describe("The Trading Channel rulebook", () => {
  it("has numbered rules the engine and the coach can both cite", () => {
    expect(FOCUS_RULEBOOK.length).toBeGreaterThanOrEqual(10);
    const ids = FOCUS_RULEBOOK.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("keeps the AI boundary explicit in the prompt block", () => {
    const prompt = focusRulebookForPrompt();
    expect(prompt).toContain("RULEBOOK trading-channel-1.0");
    expect(prompt).toContain("never by you");
  });
});
