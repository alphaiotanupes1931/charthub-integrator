// Golden set: 30 frozen 1H windows. If any entry price moves, this fails. That is
// the point: an entry-logic change must be deliberate, diffed in shadow, and the
// expected values regenerated on purpose, never as a side effect.
import { describe, it, expect } from "vitest";
import golden from "../golden/entry-windows.json";
import { computeEntryCandidates, ENTRY_MODEL_V2_LIVE, liveEntryModelFor } from "@/lib/entry-candidates";
import { sequenceEntryShadow } from "@/lib/sequence-entry-shadow";

type W = (typeof golden.windows)[number];

describe("entry golden set", () => {
  it("has 30 windows across instruments", () => {
    expect(golden.windows.length).toBe(30);
    expect(new Set(golden.windows.map((w: W) => w.symbol)).size).toBeGreaterThanOrEqual(10);
  });

  for (const w of golden.windows as W[]) {
    it(`${w.id} entries unchanged`, () => {
      const args = { bias: w.bias as "Long" | "Short", atr: w.atr, lastPrice: w.lastPrice, candles1h: w.bars };
      expect(computeEntryCandidates(args)).toEqual(w.expected.candidates);
      const s = sequenceEntryShadow({ ...args, candles15m: null, nowSec: w.bars[w.bars.length - 1]!.time + 3600 });
      expect({ status: s.status, entry: s.entry, stop: s.stop, target: s.target }).toEqual(w.expected.sequence);
    });
  }

  it("no instrument has been switched to a v2 entry without approval", () => {
    expect(ENTRY_MODEL_V2_LIVE).toEqual({});
    expect(liveEntryModelFor("XAU/USD", true)).toBe("legacy");
    expect(liveEntryModelFor("XAU/USD", false)).toBe("legacy");
  });
});
