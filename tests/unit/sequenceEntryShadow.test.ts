import { describe, expect, it } from "vitest";
import { findSweepAndBreak, readSessionPhase, sequenceEntryShadow, structuralPhase } from "@/lib/sequence-entry-shadow";
import type { ObCandle } from "@/lib/orderBlocks";

const T0 = Date.UTC(2026, 6, 13, 0, 0) / 1000; // Monday 00:00 UTC, NY summer
function series(closes: number[], wick: (i: number) => [number, number] = () => [0.3, 0.3]): ObCandle[] {
  return closes.map((close, i) => {
    const open = i ? closes[i - 1]! : close;
    const [up, dn] = wick(i);
    return { time: T0 + i * 3600, open, close, high: Math.max(open, close) + up, low: Math.min(open, close) - dn };
  });
}

// Range, then a wick under the range low that closes back inside, then a rally through the range high.
function accumulation(): ObCandle[] {
  const r = [100, 101, 102, 101, 100, 101, 102, 101, 100, 101, 102, 101, 100.5];
  const closes = [...r, 100.4, 100.2, 101, 101.5, 103.5, 104, 104.2, 103.4, 102.8, 103, 103.8];
  return series(closes, (i) => (i === 14 ? [0.2, 2.5] : [0.3, 0.3]));
}

describe("full-sequence trial entry", () => {
  it("finds a sweep of the low followed by a break to the upside", () => {
    const c = accumulation();
    const conf = findSweepAndBreak(c);
    expect(conf?.long).toBe(true);
    expect(structuralPhase(c, conf)).toBe("accumulation");
  });

  it("never uses the break level as the entry", () => {
    const c = accumulation();
    const r = sequenceEntryShadow({ bias: "Long", lastPrice: 103.8, atr: 0.9, candles1h: c });
    if (r.entry != null) expect(r.entry).not.toBe(r.breakLevel);
  });

  it("waits for the sweep in a plain range", () => {
    const c = series(Array.from({ length: 40 }, (_, i) => 100 + (i % 2 ? 0.5 : -0.5)));
    const r = sequenceEntryShadow({ bias: "Long", lastPrice: 100, atr: 1, candles1h: c });
    expect(r.entry).toBeNull();
    expect(r.status).toBe("waiting-for-sweep");
  });

  it("refuses a sequence that points against the bias", () => {
    const r = sequenceEntryShadow({ bias: "Short", lastPrice: 103.8, atr: 0.9, candles1h: accumulation() });
    expect(r.entry).toBeNull();
  });

  it("reports consolidation when a session stays inside the prior one", () => {
    // Asia (from 23:00 UTC = 19:00 NY) wide, London tight inside it.
    const start = Date.UTC(2026, 6, 13, 23) / 1000;
    const bars: ObCandle[] = [];
    for (let h = 0; h < 18; h++) {
      const asia = h < 8;
      bars.push({ time: start + h * 3600, open: 100, close: 100, high: asia ? 102 : 101, low: asia ? 98 : 99 });
    }
    const r = readSessionPhase(bars, start + 18 * 3600);
    expect(r?.session).toBe("London");
    expect(r?.phase).toBe("consolidation");
  });

  it("ignores a still-forming bar", () => {
    const c = accumulation();
    const last = c[c.length - 1]!;
    expect(readSessionPhase(c, last.time + 60)).toEqual(readSessionPhase(c.slice(0, -1), last.time + 60));
  });
});
