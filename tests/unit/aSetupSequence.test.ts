import { describe, it, expect } from "vitest";
import { readASetup, applyASetup, type ASetupRead } from "@/lib/a-setup-sequence.shared";

const done: ASetupRead = { step: "retest", stepsDone: 4, complete: true, fvgTop: 1, fvgBot: 0, retestTime: 1, text: "" };
const partial: ASetupRead = { ...done, step: "fvg", stepsDone: 3, complete: false };

describe("A-setup grade rule", () => {
  it("complete sequence lifts B to A", () => expect(applyASetup("B", done, false).grade).toBe("A"));
  it("complete sequence lifts a clean A to A+", () => expect(applyASetup("A", done, false).grade).toBe("A+"));
  it("A+ stays A+", () => expect(applyASetup("A+", done, false).grade).toBe("A+"));
  it("does not lift when another cap binds", () => expect(applyASetup("B", done, true).grade).toBe("B"));
  it("A without the full sequence drops to B", () => expect(applyASetup("A", partial, false).grade).toBe("B"));
  it("never blocks: C stays C", () => expect(applyASetup("C", partial, false).grade).toBe("C"));
  it("neutral bias has no sequence", () => expect(readASetup("Neutral", []).complete).toBe(false));
  it("ready-at-entry (zone formed, not yet retested) still lifts B to A", () =>
    expect(applyASetup("B", { ...done, step: "fvg", stepsDone: 3, retestTime: null }, false).grade).toBe("A"));
});

describe("A-setup reader", () => {
  // Long: swing low at bar 5, sweep at 12 (wick below, close back), rally closes above swing high.
  const bars = (closes: number[], lows?: Record<number, number>) => closes.map((cl, i) => ({
    time: 1_700_000_000 + i * 3600, open: cl - 0.5, close: cl, high: cl + 1, low: lows?.[i] ?? cl - 1, volume: 1,
  }));
  const path = [110, 108, 106, 104, 102, 100, 102, 104, 106, 105, 103, 101, 100.5, 104, 108, 112, 116, 118, 117, 116];
  it("never qualifies on a short bias against a bullish reversal", () =>
    expect(readASetup("Short", bars(path, { 12: 97 })).complete).toBe(false));
});
