import { describe, it, expect } from "vitest";
import { runnerAfterTp2, zoneStatus } from "@/lib/detector/liquidity-draw";
import type { Candle } from "@/lib/agents/types";

const t0 = Date.parse("2026-11-04T00:00:00Z") / 1000;
const bar = (i: number, o: number, hi: number, lo: number, c: number, step = 3600): Candle => ({ time: t0 + i * step, open: o, high: hi, low: lo, close: c });

describe("F10 zone status (NAS100 daily demand ~27,080-27,800)", () => {
  const z = { top: 27800, bottom: 27080 };
  const d = 86400;
  const first = [bar(0, 28400, 28500, 28000, 28100, d), bar(1, 28100, 28150, 27500, 27900, d), bar(2, 27900, 28300, 27880, 28250, d)];
  it("held first touch = touched, still usable", () => {
    expect(zoneStatus(z, true, first, t0)).toEqual({ status: "touched", touches: 1 });
  });
  it("fresh before any visit", () => {
    expect(zoneStatus(z, true, first.slice(0, 1), t0).status).toBe("fresh");
  });
  it("close below the far edge on the second touch = broken", () => {
    const second = [...first, bar(3, 28250, 28260, 27600, 27700, d), bar(4, 27700, 27720, 26900, 26950, d)];
    expect(zoneStatus(z, true, second, t0).status).toBe("broken");
  });
  it("supply breaks on a close above the top", () => {
    expect(zoneStatus({ top: 100, bottom: 90 }, false, [bar(0, 85, 95, 84, 94), bar(1, 94, 102, 93, 101)], t0).status).toBe("broken");
  });
});

describe("F9 runner past TP2 (NAS100 sell from 28,828, TP2 28,404.60)", () => {
  const base = { long: false, stop: 28828, tp2: 28404.6, finalPool: 26860, tp2Time: t0 };
  // Falling 1H after TP2 with a swing high at bar 3 (28,420).
  const h1 = [
    bar(0, 28400, 28410, 28300, 28320), bar(1, 28320, 28380, 28250, 28300), bar(2, 28300, 28390, 28200, 28350),
    bar(3, 28350, 28420, 28280, 28290), bar(4, 28290, 28300, 28100, 28120), bar(5, 28120, 28150, 27950, 27980),
  ];
  it("does not exit at TP2; trails behind the 1H swing high", () => {
    const r = runnerAfterTp2({ ...base, h1, price: 27980 });
    expect(r.action).toBe("trail");
    expect(r.stop).toBe(28420);
  });
  it("holds when TP2 not reached", () => {
    expect(runnerAfterTp2({ ...base, tp2Time: null, h1, price: 28500 }).action).toBe("hold");
  });
  it("closes at the final pool", () => {
    expect(runnerAfterTp2({ ...base, h1, price: 26860 }).action).toBe("close");
  });
  it("closes on a 1H CHoCH against the draw", () => {
    const rev = [...h1, bar(6, 27980, 28000, 27900, 27950), bar(7, 27950, 28500, 27940, 28480)];
    const r = runnerAfterTp2({ ...base, h1: rev, price: 28480 });
    expect(r.action).toBe("close");
    expect(r.reason).toMatch(/CHoCH/);
  });
});
