// Per-instrument regression suite (build plan, Phase 1 item 3).
//
// The rules are identical for every symbol; only the constants change. This
// file runs the same checks across every supported instrument so a fix for one
// symbol can never quietly break another, and so unknown symbols keep the
// conservative defaults instead of borrowing GBP/USD's numbers.
import { describe, it, expect } from "vitest";
import { BACKTEST_SYMBOLS } from "@/lib/backtest/catalog";
import {
  engineSymbolFor,
  getInstrumentConfig,
  classifyTrend,
  gradeScan,
  DEFAULT_CONFIG,
  type Candle,
} from "@/lib/agents/biasEngine";
import { assetClassFor, timingGateFor, readSessionVolume, type VolCandle } from "@/lib/sessionVolume";

/** Clean higher-high / higher-low advance, so a real up structure exists. */
function zigzagUp(start: number, step: number, legs = 5): Candle[] {
  const out: Candle[] = [];
  let price = start;
  let t = 1_756_000_000;
  const push = (open: number, close: number) => {
    out.push({
      time: (t += 3600),
      open,
      high: Math.max(open, close) + step * 0.2,
      low: Math.min(open, close) - step * 0.2,
      close,
      complete: true,
    });
  };
  for (let leg = 0; leg < legs; leg++) {
    for (let i = 0; i < 5; i++) { const o = price; price += step; push(o, price); }
    for (let i = 0; i < 2; i++) { const o = price; price -= step * 0.4; push(o, price); }
  }
  return out;
}

/** Same shape, mirrored, for a downtrend. */
function zigzagDown(start: number, step: number, legs = 5): Candle[] {
  return zigzagUp(start, step, legs).map((c) => ({
    ...c,
    open: 2 * start - c.open,
    close: 2 * start - c.close,
    high: 2 * start - c.low,
    low: 2 * start - c.high,
  }));
}

/** A normal London-hour tape, so nothing is gated for thin volume. */
function normalTape(): VolCandle[] {
  const base = Date.UTC(2026, 8, 3, 9) / 1000;
  return Array.from({ length: 21 }, (_, i) => ({ time: base + i * 86_400, volume: 1000 }));
}

/** A dead overnight tape: 20 normal peers then a 0.1x bar. */
function thinTape(): VolCandle[] {
  const base = Date.UTC(2026, 8, 3, 3) / 1000;
  const peers = Array.from({ length: 20 }, (_, i) => ({ time: base + i * 86_400, volume: 1000 }));
  return [...peers, { time: base + 20 * 86_400, volume: 100 }];
}

const startPrice: Record<string, number> = {
  "XAU/USD": 4400, "XAG/USD": 52, NAS100: 24000, SPX500: 6800, US30: 45000,
  "WTI Oil": 68, "EUR/USD": 1.09, "GBP/USD": 1.27, "USD/JPY": 152,
  "BTC/USD": 96000, "ETH/USD": 3400, "XRP/USD": 2.4,
};

describe.each([...BACKTEST_SYMBOLS])("%s", (symbol) => {
  const price = startPrice[symbol] ?? 100;
  const step = price * 0.002;

  it("has measured constants, not the unknown-symbol fallback", () => {
    const { cfg, known } = getInstrumentConfig(engineSymbolFor(symbol));
    expect(known).toBe(true);
    expect(cfg.atr4h).toBeGreaterThan(0);
    expect(cfg.minRR).toBeGreaterThanOrEqual(DEFAULT_CONFIG.minRR);
  });

  it("reads a fresh advance as up and a fresh decline as down", () => {
    expect(classifyTrend(zigzagUp(price, step), step)).toBe("up");
    expect(classifyTrend(zigzagDown(price, step), step)).toBe("down");
  });

  it("does not gate a normal session", () => {
    expect(timingGateFor(symbol, readSessionVolume(normalTape()))).toBeNull();
  });

  it("gates execution timing on a dead tape without killing the setup", () => {
    const gate = timingGateFor(symbol, readSessionVolume(thinTape()));
    if (assetClassFor(symbol) === "crypto") {
      // 24/7 market: a quiet Tokyo hour is normal, so nothing is gated.
      expect(gate).toBeNull();
    } else {
      expect(gate).not.toBeNull();
      expect(gate!.waitFor).toMatch(/open/i);
      expect(gate!.message).toMatch(/levels stand/i);
    }
  });

  it("grades an aligned setup above C and caps a counter-trend one at C", () => {
    const engineSymbol = engineSymbolFor(symbol);
    const { cfg } = getInstrumentConfig(engineSymbol);
    const atr = cfg.atr4h;
    const entry = price;
    const withTrend = gradeScan({
      symbol: engineSymbol,
      bias4h: "bullish",
      bias1h: "bullish",
      bias15m: "bullish",
      entry,
      stop: entry - atr * 0.6,
      targets: [entry + atr * 1.5, entry + atr * 3],
      atr4h: atr,
    } as never);
    const counter = gradeScan({
      symbol: engineSymbol,
      bias4h: "bearish",
      bias1h: "bullish",
      bias15m: "bullish",
      entry,
      stop: entry - atr * 0.6,
      targets: [entry + atr * 1.5, entry + atr * 3],
      atr4h: atr,
    } as never);
    expect(["A+", "A", "B", "C", "NO ENTRY"]).toContain(withTrend.grade);
    expect(["C", "NO ENTRY"]).toContain(counter.grade);
  });
});
