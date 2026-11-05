import { describe, it, expect } from "vitest";
import { advanceDraw, drawGrade, drawLevels, emptyDraw, replayDraw, type DrawState } from "@/lib/detector/liquidity-draw";
import { mapLiquidityPools, orderedPools, type LiquidityPool } from "@/lib/detector/liquidity-pools";
import type { Candle } from "@/lib/agents/types";

const feed = "OANDA:api-fxtrade.oanda.com:mid";
const t = Date.parse("2026-11-03T00:00:00Z") / 1000;
const bar = (i: number, open: number, high: number, low: number, close: number): Candle => ({ time: t + i * 900, open, high, low, close });
const pool = (side: "buyside" | "sellside", price: number): LiquidityPool => ({ id: `${side}:${price}`, side, price, time: t - 86400, confirmedAt: t - 3600, frame: "1H", kind: "swing", status: "unswept" });
const targets = [28331.20, 28404.60, 28556, 28788].map(p => pool("buyside", p));
// Event-level OANDA-labelled acceptance fixture, NOT fabricated historical OHLC or a profit backtest.
const history = [bar(0,27700,27710,27680,27690),bar(1,27700,27720,27670,27710),bar(2,27700,27780,27690,27740),bar(3,27740,27730,27660,27700),bar(4,27700,27710,27650,27680),bar(5,27680,27700,27600,27640)];
function buyState(): DrawState {
  const pending = advanceDraw(emptyDraw(feed), bar(6,27600,27620,27513,27580), [pool("sellside",27550), ...targets], history);
  return advanceDraw(pending, bar(7,27580,27820,27560,27800), targets, history);
}

describe("Marcus Nov 3–4 draw acceptance", () => {
  it("locks buyside after the OANDA 27513 sellside wick + closed 15m CHoCH", () => {
    const state = buyState();
    expect(state.side).toBe("buyside"); expect(state.sweep?.extreme).toBe(27513);
    expect(state.target?.price).toBe(28331.20); expect(state.status).toBe("active");
  });
  it("9:37 PM price 28008 remains BUY and ordered targets ignore bearish Daily labels", () => {
    const state = advanceDraw(buyState(), bar(86,28000,28020,27980,28008), targets, history);
    expect(state.side).toBe("buyside");
    expect(orderedPools(targets,"buyside",28008).map(p=>p.price)).toEqual([28331.20,28404.60,28556,28788]);
    expect(drawGrade({aligned:false,nested:false,continuation:true,opposingInsideStop:false})).toEqual({cap:"B",sizeMultiplier:0.5});
  });
  it("cannot flip on an unrelated nearer buyside pool while the locked target is untouched", () => {
    const state = advanceDraw(buyState(), bar(8,27800,27860,27790,27810), [pool("buyside",27850),...targets], history);
    expect(state.side).toBe("buyside"); expect(state.pending).toBeNull(); expect(state.target?.price).toBe(28331.20);
  });
  it("mere target touch does not authorize an opposite trade", () => {
    const state = advanceDraw(buyState(), bar(8,28300,28331.20,28290,28310), targets, history);
    expect(state.side).toBe("buyside"); expect(state.status).toBe("reached"); expect(state.pending).toBeNull();
  });
  it("28837.19 buyside rejection plus closed bearish CHoCH flips to sellside targets", () => {
    const state = { ...buyState(), target: pool("buyside",28788) };
    const prior = [bar(90,28700,28730,28680,28700),bar(91,28700,28740,28670,28700),bar(92,28700,28710,28600,28650),bar(93,28650,28720,28660,28700),bar(94,28700,28750,28670,28710)];
    const swept = advanceDraw(state,bar(95,28780,28837.19,28760,28770),[state.target],prior);
    const sells = [pool("sellside",28556),pool("sellside",28404.60)];
    const flipped = advanceDraw(swept,bar(96,28770,28780,28580,28590),sells,prior);
    expect(flipped.side).toBe("sellside"); expect(flipped.sweep?.extreme).toBe(28837.19);
    expect(flipped.target?.price).toBe(28556);
    expect(orderedPools(sells,"sellside",28590).map(p=>p.price)).toEqual([28556,28404.60]);
  });
  it("a low below the original 27513 sweep invalidates the BUY lock", () => {
    const state=advanceDraw(buyState(),bar(8,27600,27610,27512,27580),targets,history);
    expect(state.side).toBeNull(); expect(state.status).toBe("invalidated");
  });
  it("duplicate or older ticks cannot resurrect or mutate saved draws", () => {
    const state=buyState(); expect(advanceDraw(state,bar(6,27600,27620,27513,27580),targets,history)).toBe(state);
  });
  it("initial proximal entry stops beyond sweep, continuation beyond fresh zone", () => {
    const zone={top:27990,bottom:27960,time:t+9000,formedAt:t+10800,frame:"15m" as const,kind:"FVG" as const,continuation:false};
    const first=drawLevels(buyState(),zone,targets,100);
    expect(first?.entry).toBe(27990); expect(first?.stop).toBe(27498); expect(first?.tp1).toBe(28331.20);
    const next=drawLevels(buyState(),{...zone,continuation:true},targets,100);
    expect(next?.stop).toBe(27945); expect(next?.tp2).toBe(28404.60);
  });
  it.each([
    [true,false,false,false,"A",1], [false,true,false,false,"A",0.5],
    [false,false,false,false,"B",0.5], [false,true,true,false,"B",0.5],
    [true,false,true,false,"A",1], [true,true,false,true,"C",0.25],
  ] as const)("uses explicit grade/size ceiling %s/%s/%s/%s", (aligned,nested,continuation,opposingInsideStop,cap,sizeMultiplier) => {
    expect(drawGrade({aligned,nested,continuation,opposingInsideStop})).toEqual({cap,sizeMultiplier});
  });
  it("pool pivots are unavailable before their right bars close", () => {
    const bars=[bar(0,100,101,99,100),bar(1,100,102,98,100),bar(2,100,105,97,100),bar(3,100,102,98,100),bar(4,100,101,99,100)];
    expect(mapLiquidityPools({"15m":bars},t+4*900).some(p=>p.price===105)).toBe(false);
    expect(mapLiquidityPools({"15m":bars},t+5*900).find(p=>p.price===105)?.status).toBe("unswept");
  });
  it("closed 15m consumption marks an HTF pool taken without waiting for its candle close", () => {
    const h1=[0,1,2,3,4].map(i=>({time:t+i*3600,open:100,close:100,high:i===2?105:102,low:98}));
    const m15=[{time:t+5*3600,open:100,high:106,low:99,close:104}];
    expect(mapLiquidityPools({"1H":h1,"15m":m15},t+5*3600+900).find(p=>p.price===105)?.status).toBe("swept");
  });
  it("separate feed cannot inherit an OANDA draw", () => {
    const read=replayDraw({},"other-feed",buyState()); expect(read.state.side).toBeNull(); expect(read.state.feed).toBe("other-feed");
  });
});