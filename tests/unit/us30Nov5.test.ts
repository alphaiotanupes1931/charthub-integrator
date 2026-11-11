import { describe, it, expect } from "vitest";
import { advanceDraw, clearStopFromZones, drawLateCaps, h1ChochAgainst, type DrawState } from "@/lib/detector/liquidity-draw";
import type { LiquidityPool } from "@/lib/detector/liquidity-pools";
import { cardGradeCorrection, statedGrades } from "@/lib/coach-grade-guard";
import type { Candle } from "@/lib/agents/types";

// Event-level fixture built from the US30 Nov 5 brief (OANDA mid). Not historical OHLC.
const feed = "OANDA:api-fxtrade.oanda.com:mid";
const t0 = Date.parse("2026-11-05T00:00:00Z") / 1000;
const pool = (side: "buyside" | "sellside", price: number): LiquidityPool =>
  ({ id: `${side}:${price}`, side, price, time: t0 - 86400, confirmedAt: t0 - 3600, frame: "1H", kind: "swing", status: "unswept" });
const h = (i: number, o: number, hi: number, lo: number, c: number): Candle => ({ time: t0 + i * 3600, open: o, high: hi, low: lo, close: c });

// Rally from the 53,412.50 sweep, 1H swing low 53,618 at 09:00, then the 13:00 1H closes 53,593.60.
const h1 = [
  h(0, 53450, 53480, 53412.5, 53470), h(1, 53470, 53520, 53460, 53510), h(2, 53510, 53560, 53500, 53550),
  h(3, 53550, 53600, 53540, 53590), h(4, 53590, 53650, 53580, 53640), h(5, 53640, 53700, 53630, 53690),
  h(6, 53690, 53740, 53680, 53730), h(7, 53730, 53760, 53660, 53700), h(8, 53700, 53720, 53640, 53660),
  h(9, 53660, 53680, 53618, 53650), h(10, 53650, 53720, 53640, 53710), h(11, 53710, 53782, 53700, 53760),
  h(12, 53760, 53770, 53680, 53700), h(13, 53700, 53710, 53580, 53593.6),
];
const buyDraw: DrawState = {
  version: "liquidity-draw-2026.11-v1", feed, processedTime: t0 + 13 * 3600 - 900, side: "buyside",
  sweep: { side: "sellside", pool: pool("sellside", 53420), extreme: 53412.5, time: t0, confirmedAt: t0 + 900, breakLevel: 53480 },
  pending: null, target: pool("buyside", 53806.5), status: "active", crossed: null,
};
const pools = [pool("buyside", 53806.5), pool("buyside", 53820.6), pool("buyside", 54238.6), pool("sellside", 53618), pool("sellside", 53506)];

describe("US30 Nov 5 regression (brief section 6)", () => {
  it("F1: a closed 1H CHoCH against the buyside draw cancels it", () => {
    expect(h1ChochAgainst(h1, "buyside", t0, 0, t0 + 14 * 3600)?.level).toBe(53618);
    const bar: Candle = { time: t0 + 13 * 3600 + 2700, open: 53600, high: 53610, low: 53585, close: 53593.6 };
    const s = advanceDraw(buyDraw, bar, pools, [], pools, h1);
    expect(s.side).toBeNull();
    expect(s.status).toBe("cancelled");
    expect(s.cancelled).toMatchObject({ reason: "1H CHoCH", time: t0 + 13 * 3600, previousSide: "buyside" });
  });
  it("F1: no cancel while the 1H holds its swing", () => {
    expect(h1ChochAgainst(h1.slice(0, 13), "buyside", t0, 0, t0 + 14 * 3600)).toBeNull();
  });
  it("F4: a continuation 72% of the way to the draw is no longer capped (limit 80%)", () => {
    expect(drawLateCaps({ long: true, entry: 53695, stop: 53646.5, tp1: 53806.5, sweepPrice: 53412.5, drawPrice: 53806.5, continuation: true, pools: [] })).toEqual([]);
  });
  it("F4: a continuation 82% of the way to the draw caps at C", () => {
    const caps = drawLateCaps({ long: true, entry: 53735, stop: 53690, tp1: 53806.5, sweepPrice: 53412.5, drawPrice: 53806.5, continuation: true, pools: [] });
    expect(caps.map(c => c.label)).toEqual(["Late-leg continuation"]);
    expect(caps[0]!.reason).toContain("82%");
    expect(caps[0]!.reason).toContain("limit 80%");
  });
  it("F4: not a continuation, no late-leg cap", () => {
    expect(drawLateCaps({ long: true, entry: 53695, stop: 53646.5, tp1: 53806.5, sweepPrice: 53412.5, drawPrice: 53806.5, continuation: false, pools: [] })).toEqual([]);
  });
  it("F5: sellside 53,618 (77 pts) beyond a 48.5 pt stop is not capped", () => {
    expect(drawLateCaps({ long: true, entry: 53695, stop: 53646.5, tp1: 53806.5, sweepPrice: 53412.5, drawPrice: 53806.5, continuation: false, pools })).toEqual([]);
  });
  it("F5: sellside 53,618 inside a 100 pt stop caps at C and names pool and distances", () => {
    const caps = drawLateCaps({ long: true, entry: 53695, stop: 53595, tp1: 53806.5, sweepPrice: 53412.5, drawPrice: 53806.5, continuation: false, pools, fmt: n => n.toFixed(2) });
    expect(caps).toHaveLength(1);
    expect(caps[0]!.reason).toBe("Unswept sellside pool 53618.00 is 77.00 from entry, inside the 100.00 stop.");
  });
  it("F6: a long stop inside the 1H bull OB moves below 53,656.50", () => {
    const stop = clearStopFromZones(true, 53658.64, [{ top: 53686, bottom: 53656.5 }], 100);
    expect(stop).toBeLessThan(53656.5);
    expect(stop).toBe(53646.5);
  });
  it("F2: the coach stating C for an A card gets a correction", () => {
    expect(statedGrades("Confidence 75% maps to a C.")).toEqual(["C"]);
    expect(cardGradeCorrection("This setup was graded a C.", "A")).toContain("card's grade is A");
    expect(cardGradeCorrection("This was an A setup because the draw was aligned.", "A")).toBeNull();
  });
});
