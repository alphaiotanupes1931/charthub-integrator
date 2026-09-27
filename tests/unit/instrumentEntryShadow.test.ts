import { describe, it, expect } from "vitest";
import { instrumentEntryShadow } from "@/lib/instrument-entry-shadow";

const base = { high: 110, low: 100, atr: 2 };

describe("per-instrument entry trial", () => {
  it("places a deeper-pulling market's entry and stop deeper", () => {
    const gold = instrumentEntryShadow({ ...base, bias: "Long", profile: { medianPullback: 0.4, deepPullback: 0.6, stopBufferAtr: 0.5, barsSampled: 500 } })!;
    const silver = instrumentEntryShadow({ ...base, bias: "Long", profile: { medianPullback: 0.6, deepPullback: 0.85, stopBufferAtr: 0.8, barsSampled: 500 } })!;
    expect(silver.entry).toBeLessThan(gold.entry);
    expect(silver.stop).toBeLessThan(gold.stop);
    expect(gold.entry).toBeCloseTo(106);
  });

  it("mirrors for shorts and reports shift vs live", () => {
    const s = instrumentEntryShadow({ ...base, bias: "Short", liveEntry: 103, profile: { medianPullback: 0.5, deepPullback: 0.7, stopBufferAtr: 0.5, barsSampled: 500 } })!;
    expect(s.entry).toBeCloseTo(105);
    expect(s.stop).toBeGreaterThan(s.entry);
    expect(s.entryShiftAtr).toBe(1);
  });

  it("does nothing on thin samples or neutral bias", () => {
    const p = { medianPullback: 0.5, deepPullback: 0.7, stopBufferAtr: 0.5, barsSampled: 50 };
    expect(instrumentEntryShadow({ ...base, bias: "Long", profile: p })).toBeNull();
    expect(instrumentEntryShadow({ ...base, bias: "Neutral", profile: { ...p, barsSampled: 500 } })).toBeNull();
  });
});
