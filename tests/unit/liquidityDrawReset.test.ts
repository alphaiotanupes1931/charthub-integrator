import { describe, expect, it } from "vitest";
import { advanceDraw, emptyDraw, latestDrawZone, type DrawState } from "@/lib/detector/liquidity-draw";
import type { LiquidityPool } from "@/lib/detector/liquidity-pools";
import type { Candle } from "@/lib/agents/types";

const pool = (side: "buyside" | "sellside", price: number): LiquidityPool => ({ id: `${side}:${price}`, side, price, time: 0, confirmedAt: 0, frame: "1H", kind: "swing", status: "unswept" });
const candle = (time: number, low: number, close: number): Candle => ({ time, open: 105, high: 110, low, close });
const target = pool("buyside", 140);
const buy: DrawState = { ...emptyDraw("OANDA:api-fxtrade.oanda.com:mid"), side: "buyside", status: "active", target,
  sweep: { side: "sellside", pool: pool("sellside", 102), extreme: 100, time: 900, confirmedAt: 1800, breakLevel: 108 }, processedTime: 1800 };

describe("confirmed invalidation trend reset", () => {
  it("a wick below the sweep does not authorize a short", () => {
    const state = advanceDraw(buy, candle(2700, 99, 103), [pool("sellside", 80)], []);
    expect(state.status).toBe("invalidated"); expect(state.side).toBeNull();
  });
  it("a closed breakdown resets toward the nearest unswept sellside pool without another sweep", () => {
    const state = advanceDraw(buy, candle(2700, 95, 96), [pool("sellside", 80), pool("sellside", 90)], []);
    expect(state.side).toBe("sellside"); expect(state.target?.price).toBe(90);
    expect(state.reset?.confirmedAt).toBe(3600); expect(state.feed).toBe(buy.feed);
  });
  it("retains a wick invalidation until a later close confirms the break", () => {
    const pools = [pool("sellside", 90)];
    const invalid = advanceDraw(buy, candle(2700, 99, 103), pools, []);
    const reset = advanceDraw(invalid, candle(3600, 95, 96), pools, []);
    expect(reset.side).toBe("sellside"); expect(reset.reset?.confirmedAt).toBe(4500);
  });
  it("does not reset toward a pool already taken by the confirmation candle", () => {
    const state = advanceDraw(buy, candle(2700, 95, 96), [pool("sellside", 98)], [], [{ ...pool("sellside", 98), status: "swept" }]);
    expect(state.side).toBeNull();
  });
  it("requires a new entry zone instead of chasing the breakdown", () => {
    const state = advanceDraw(buy, candle(2700, 95, 96), [pool("sellside", 90)], []);
    expect(latestDrawZone({ "15m": [candle(0, 103, 105), candle(900, 104, 106), candle(1800, 95, 96)] }, state, 96)).toBeNull();
  });
  it("duplicate scans cannot reverse the reset", () => {
    const bar = candle(2700, 95, 96);
    const state = advanceDraw(buy, bar, [pool("sellside", 90)], []);
    expect(advanceDraw(state, bar, [target], [])).toBe(state);
  });
});