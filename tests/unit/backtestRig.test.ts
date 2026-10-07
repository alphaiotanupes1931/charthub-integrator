import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { feed, completedHtf } from "../../research/rig/feeder";
import { simulate, type QuoteBar } from "../../research/rig/fills";
import { pbo, dayBootstrap, walkForward, deflatedSharpe, minDetectable } from "../../research/rig/stats";
import { computeEntryCandidates } from "@/lib/detector/entry-detector";
import golden from "../golden/entry-windows.json";

const q = (t: number, lo: number, hi: number, spread = 0): QuoteBar => ({ t, bl: lo, bh: hi, al: lo + spread, ah: hi + spread, bo: lo, bc: hi, ao: lo + spread, ac: hi + spread });
const cfg = { buffer: 0, stopSlip: 0, costMult: 1 };

describe("feeder: no future", () => {
  it("the view never contains a bar after the current index", () => {
    const bars = Array.from({ length: 50 }, (_, i) => ({ time: i, open: 1, high: 1, low: 1, close: 1 }));
    for (const { i, view } of feed(bars, { warmup: 10, window: 20 })) expect(view[view.length - 1]!.time).toBe(i);
  });
  it("planting a trap bar at index+1 never changes detector output", () => {
    const w = golden.windows[0]!;
    const args = { bias: w.bias as "Long" | "Short", atr: w.atr, lastPrice: w.lastPrice };
    const base = computeEntryCandidates({ ...args, candles1h: w.bars });
    const view = [...feed([...w.bars, { time: 9e12, open: 1e9, high: 1e9, low: -1e9, close: -1e9 }], { warmup: w.bars.length - 1, window: 151 })][0]!.view;
    expect(computeEntryCandidates({ ...args, candles1h: view })).toEqual(base);
  });
  it("higher timeframe exposes only completed bars", () => {
    const h4 = [0, 14400, 28800].map((t) => ({ time: t, open: 1, high: 1, low: 1, close: 1 }));
    expect(completedHtf(h4, 14400, 28799).length).toBe(1);
    expect(completedHtf(h4, 14400, 28800).length).toBe(2);
  });
});

describe("detector is shared", () => {
  it("the live planner and the rig import the same detector file", () => {
    expect(readFileSync("src/lib/entry-candidates.ts", "utf8")).toContain('export * from "@/lib/detector/entry-detector"');
    expect(readFileSync("src/lib/agents/planner.server.ts", "utf8")).toMatch(/computeEntryCandidates\(/);
    expect(readFileSync("research/rig/ledger.ts", "utf8")).toContain('from "@/lib/detector/entry-detector"');
  });
  it("no rig file reimplements the detector", () => {
    for (const f of readdirSync("research/rig")) {
      const s = readFileSync(`research/rig/${f}`, "utf8");
      expect(s).not.toMatch(/function (computeEntryCandidates|findSweepAndBreak)/);
    }
  });
});

describe("fill simulator", () => {
  it("a wick tag is not a fill; trading through by the buffer is", () => {
    expect(simulate({ long: true, entry: 100, risk: 5, target: 110, bars: [q(1, 100, 102)], cfg: { ...cfg, buffer: 0.5 } }).filled).toBe(false);
    expect(simulate({ long: true, entry: 100, risk: 5, target: 110, bars: [q(1, 99.4, 102)], cfg: { ...cfg, buffer: 0.5 } }).filled).toBe(true);
  });
  it("unfilled scores 0R", () => {
    const r = simulate({ long: true, entry: 90, risk: 5, target: 110, bars: [q(1, 95, 105)], cfg });
    expect(r).toMatchObject({ filled: false, r: 0, exit: "unfilled" });
  });
  it("same bar stop and target: M1 decides, else pessimistic stop", () => {
    const bars = [q(1, 99, 101), q(2, 90, 115)];
    expect(simulate({ long: true, entry: 100, risk: 5, target: 110, bars, cfg })).toMatchObject({ exit: "stop", ambiguous: "pessimistic", ambiguousBar: 2 });
    const m1 = () => [q(2, 99, 112), q(3, 90, 100)];
    expect(simulate({ long: true, entry: 100, risk: 5, target: 110, bars, cfg, m1 })).toMatchObject({ exit: "target", ambiguous: "m1-resolved" });
  });
  it("longs buy the ask, so spread costs a market entry", () => {
    const r = simulate({ long: true, entry: "market", risk: 10, target: 200, bars: [q(1, 100, 100, 1)], cfg });
    expect(r.r).toBeLessThan(0);
  });
});

describe("stats", () => {
  it("PBO is high when variants are pure noise and low when one dominates", () => {
    let s = 1; const r = () => ((s = (s * 16807) % 2147483647) / 2147483647) - 0.5;
    const noise = Array.from({ length: 80 }, () => Array.from({ length: 6 }, r));
    const dom = noise.map((row) => row.map((v, j) => (j === 0 ? v + 2 : v)));
    expect(pbo(noise).pbo).toBeGreaterThan(0.2);
    expect(pbo(dom).pbo).toBeLessThanOrEqual(0.05);
  });
  it("bootstrap keeps days together and brackets the mean", () => {
    const b = dayBootstrap([{ day: "a", v: 1 }, { day: "a", v: 1 }, { day: "b", v: 0 }], 500);
    expect(b.days).toBe(2);
    expect(b.lo).toBeLessThanOrEqual(b.mean);
  });
  it("walk-forward embargo removes neighbours from training", () => {
    const rows = Array.from({ length: 100 }, (_, i) => ({ time: i }));
    const f = walkForward(rows, 4, 5)[1]!;
    expect(f.train.some((r) => r.time >= 20 && r.time < 55)).toBe(false);
  });
  it("deflated Sharpe falls as trials rise", () => {
    const x = Array.from({ length: 200 }, (_, i) => (i % 3 === 0 ? 1 : -0.3));
    expect(deflatedSharpe(x, 100, 0.01).dsr).toBeLessThan(deflatedSharpe(x, 1, 0.01).dsr);
    expect(minDetectable([1, -1, 1, -1])).toBeGreaterThan(1);
  });
});
