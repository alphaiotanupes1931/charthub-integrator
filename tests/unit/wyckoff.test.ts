import { describe, it, expect } from "vitest";
import { readWyckoff, type WyCandle } from "@/lib/wyckoff/engine";
import { WYCKOFF_RULEBOOK, rulebookForPrompt } from "@/lib/wyckoff/rulebook";

/** Deterministic bar builder: a range, then whatever the test needs after it. */
function rangeBars(count: number, low: number, high: number, start = 0): WyCandle[] {
  const out: WyCandle[] = [];
  const mid = (low + high) / 2;
  for (let i = 0; i < count; i++) {
    const up = i % 2 === 0;
    out.push({
      time: (start + i) * 3600,
      open: up ? mid - 1 : mid + 1,
      high: up ? high : high - 1,
      low: up ? low + 1 : low,
      close: up ? mid + 1 : mid - 1,
    });
  }
  return out;
}

function bar(time: number, o: number, h: number, l: number, c: number): WyCandle {
  return { time: time * 3600, open: o, high: h, low: l, close: c };
}

describe("wyckoff rulebook", () => {
  it("has five versioned rules and a prompt form that never lets the model decide", () => {
    expect(WYCKOFF_RULEBOOK).toHaveLength(5);
    expect(WYCKOFF_RULEBOOK.map((r) => r.id)).toEqual([1, 2, 3, 4, 5]);
    const prompt = rulebookForPrompt();
    expect(prompt).toContain("You do not decide direction, entry, stop, target or grade");
  });
});

describe("readWyckoff", () => {
  it("refuses to read a series that is too short", () => {
    const plan = readWyckoff(rangeBars(20, 100, 110));
    expect(plan.grade).toBe("NO ENTRY");
    expect(plan.bias).toBe("Neutral");
    expect(plan.phase).toBe("unreadable");
  });

  it("stands down on a quiet range where nothing has been taken", () => {
    const bars = rangeBars(80, 100, 110);
    const plan = readWyckoff(bars);
    expect(plan.bias).toBe("Neutral");
    expect(plan.grade).toBe("NO ENTRY");
    expect(["consolidation", "unreadable"]).toContain(plan.phase);
    expect(plan.rules.every((r) => r.pass === false)).toBe(true);
  });

  it("reads accumulation from a spring under the range low", () => {
    const bars = rangeBars(60, 100, 110);
    // Spring: pierce below 100, close back inside.
    bars.push(bar(60, 102, 103, 96, 102));
    for (let i = 61; i < 80; i++) bars.push(bar(i, 102, 104, 101, 103));
    const plan = readWyckoff(bars);
    expect(plan.phase).toBe("accumulation");
    expect(plan.bias).toBe("Long");
    expect(plan.events.some((e) => e.kind === "spring")).toBe(true);
    // Stop must sit under the spring low, not inside it.
    expect(plan.stop! < 96).toBe(true);
    expect(plan.rules[1].pass).toBe(true);
  });

  it("reads distribution from an upthrust above the range high", () => {
    const bars = rangeBars(60, 100, 110);
    bars.push(bar(60, 108, 115, 107, 108));
    for (let i = 61; i < 80; i++) bars.push(bar(i, 107, 109, 106, 107));
    const plan = readWyckoff(bars);
    expect(plan.phase).toBe("distribution");
    expect(plan.bias).toBe("Short");
    expect(plan.stop! > 115).toBe(true);
  });

  it("reads markup after an accepted break and targets the measured move", () => {
    const bars = rangeBars(60, 100, 110);
    for (let i = 60; i < 80; i++) bars.push(bar(i, 112, 116, 111, 115));
    const plan = readWyckoff(bars);
    expect(plan.phase).toBe("markup");
    expect(plan.bias).toBe("Long");
    expect(plan.tp1! > plan.range.high).toBe(true);
    expect(plan.tp2! > plan.tp1!).toBe(true);
  });

  it("asks for a pending stop, not a limit, once price has left the location", () => {
    const bars = rangeBars(60, 100, 110);
    // Break and run well beyond the broken high: a limit at 110 would never fill.
    for (let i = 60; i < 80; i++) bars.push(bar(i, 118 + i - 60, 121 + i - 60, 117 + i - 60, 120 + i - 60));
    const plan = readWyckoff(bars);
    expect(plan.entryOrder).toBe("stop");
    expect(plan.entry! > plan.range.high).toBe(true);
  });

  it("caps the grade at C when the liquidity has not been taken", () => {
    const bars = rangeBars(60, 100, 110);
    // Clean break up with no spring and no sweep behind it.
    for (let i = 60; i < 80; i++) bars.push(bar(i, 111, 112, 110.5, 111.5));
    const plan = readWyckoff(bars);
    if (!plan.rules[1].pass) {
      expect(plan.grade).toBe("C");
      expect(plan.cap).toContain("rule 2");
    }
  });

  it("is deterministic: same bars, same plan", () => {
    const bars = rangeBars(60, 100, 110);
    bars.push(bar(60, 102, 103, 96, 102));
    for (let i = 61; i < 80; i++) bars.push(bar(i, 102, 104, 101, 103));
    expect(JSON.stringify(readWyckoff(bars))).toBe(JSON.stringify(readWyckoff(bars)));
  });

  it("never reports more than five rules and never invents a passing count", () => {
    const bars = rangeBars(60, 100, 110);
    bars.push(bar(60, 102, 103, 96, 102));
    for (let i = 61; i < 80; i++) bars.push(bar(i, 102, 104, 101, 103));
    const plan = readWyckoff(bars);
    expect(plan.rules).toHaveLength(5);
    expect(plan.rulesPassed).toBe(plan.rules.filter((r) => r.pass).length);
  });
});
