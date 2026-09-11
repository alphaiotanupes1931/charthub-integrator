// Audit harness for the moves Marcus said the scanner missed: NAS100/US30 index
// setups before the cash open, gold reading "no entry" for two days, and the
// BTC/ETH breakout. Each case is a failing-then-fixed assertion about the
// deterministic layer, not about model wording.
import { describe, it, expect } from "vitest";
import {
  readSessionVolume,
  timingGateFor,
  assetClassFor,
  sessionStopAtr,
  type VolCandle,
} from "@/lib/sessionVolume";
import { classifyTrend, type Candle } from "@/lib/agents/biasEngine";

/** Bars in one UTC hour band, so every bar lands in the same session bucket. */
function barsAtHour(utcHour: number, volumes: number[], dayStart = Date.UTC(2026, 8, 3)): VolCandle[] {
  return volumes.map((volume, i) => ({
    time: Math.floor((dayStart + i * 24 * 3600_000 + utcHour * 3600_000) / 1000),
    volume,
  }));
}

/** Thin Tokyo tape: 20 normal peer bars then a 0.1x current bar. */
function thinOvernight(): VolCandle[] {
  const peers = barsAtHour(3, Array.from({ length: 20 }, () => 1000));
  const last = { time: peers[peers.length - 1]!.time + 24 * 3600_000 / 1000, volume: 100 };
  return [...peers, last];
}

describe("asset class routing", () => {
  it("treats index symbols as index, crypto as crypto, gold as fx-metal", () => {
    expect(assetClassFor("NAS100")).toBe("index");
    expect(assetClassFor("US30")).toBe("index");
    expect(assetClassFor("BTC/USD")).toBe("crypto");
    expect(assetClassFor("ETH/USD")).toBe("crypto");
    expect(assetClassFor("SOL/USD")).toBe("crypto");
    expect(assetClassFor("XAU/USD")).toBe("fx-metal");
    expect(assetClassFor("GBP/USD")).toBe("fx-metal");
  });
});

describe("timing gate instead of a killed signal", () => {
  const read = readSessionVolume(thinOvernight());

  it("measures the thin overnight tape", () => {
    expect(read).not.toBeNull();
    expect(read!.overnightThin).toBe(true);
  });

  it("gates index setups on the New York cash open, not London", () => {
    const gate = timingGateFor("NAS100", read);
    expect(gate).not.toBeNull();
    expect(gate!.waitFor).toBe("the New York cash session");
    // The setup survives: the message is about execution timing, not validity.
    expect(gate!.message).toMatch(/levels stand/i);
  });

  it("gates gold on the London open", () => {
    expect(timingGateFor("XAU/USD", read)!.waitFor).toBe("the London open");
  });

  it("never gates crypto: a quiet Tokyo hour is normal on a 24/7 market", () => {
    expect(timingGateFor("BTC/USD", read)).toBeNull();
    expect(timingGateFor("ETH/USD", read)).toBeNull();
    expect(timingGateFor("SOL/USD", read)).toBeNull();
  });

  it("does not gate a normal session", () => {
    const normal = readSessionVolume(barsAtHour(14, Array.from({ length: 21 }, () => 1000)));
    expect(timingGateFor("NAS100", normal)).toBeNull();
    expect(sessionStopAtr(normal)).toBe(0.6);
  });
});

/** Zigzag advance: impulse legs with pullbacks, so real swing pivots exist. */
function zigzagUp(legs = 5, start = 20000, step = 60): Candle[] {
  const out: Candle[] = [];
  let price = start;
  let t = 1_756_000_000;
  const push = (open: number, close: number, wick = step * 0.2) => {
    out.push({
      time: (t += 3600),
      open,
      high: Math.max(open, close) + wick,
      low: Math.min(open, close) - wick,
      close,
      complete: true,
    });
  };
  for (let leg = 0; leg < legs; leg++) {
    for (let i = 0; i < 5; i++) { const open = price; price += step; push(open, price); }
    for (let i = 0; i < 2; i++) { const open = price; price -= step * 0.4; push(open, price, 0); }
  }
  return out;
}

describe("current structure beats the prior session", () => {
  it("reads a fresh higher-high/higher-low advance as up", () => {
    expect(classifyTrend(zigzagUp(), 60)).toBe("up");
  });

  it("does not flip up on a single green candle after a downtrend", () => {
    const down: Candle[] = Array.from({ length: 24 }, (_, i) => {
      const open = 20000 - i * 60;
      const close = open - 48;
      return { time: 1_756_000_000 + i * 3600, open, high: open + 12, low: close - 12, close, complete: true };
    });
    const lastClose = down[down.length - 1]!.close;
    const oneGreen = [...down, {
      time: 1_756_000_000 + 24 * 3600,
      open: lastClose,
      high: lastClose + 40,
      low: lastClose - 5,
      close: lastClose + 35,
      complete: true,
    }];
    expect(classifyTrend(oneGreen, 60)).not.toBe("up");
    // Structure only turns once higher highs and higher lows are actually printed.
    expect(classifyTrend(zigzagUp(5, lastClose), 60)).toBe("up");
  });

  it("ignores the forming candle so nothing flips mid-bar", () => {
    const bars = zigzagUp();
    const spike = { ...bars[bars.length - 1]!, close: 100000, high: 100500, complete: false };
    expect(classifyTrend([...bars, spike], 60)).toBe(classifyTrend(bars, 60));
  });
});
