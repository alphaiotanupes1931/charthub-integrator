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
import { classifyTrend, findSwingHighs, type Candle } from "@/lib/agents/biasEngine";

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
    expect(gate!.waitFor).toBe("the New York cash open");
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

/** Rally leg: the shape of the NAS100 bounce that should read as an uptrend. */
function rally(bars: number, start = 20000, step = 60): Candle[] {
  return Array.from({ length: bars }, (_, i) => {
    const open = start + i * step;
    const close = open + step * 0.8;
    return { time: 1_756_000_000 + i * 3600, open, high: close + step * 0.2, low: open - step * 0.2, close };
  });
}

describe("current structure beats the prior session", () => {
  it("reads a fresh rally as up even when the series starts lower", () => {
    const bars = rally(40);
    const atr = 60;
    expect(classifyTrend(bars, atr)).toBe("up");
  });

  it("flips to up after a swing high is broken, not on a single green candle", () => {
    // Three down bars then one green bar that does not exceed the prior swing.
    const down: Candle[] = Array.from({ length: 24 }, (_, i) => {
      const open = 20000 - i * 60;
      const close = open - 48;
      return { time: 1_756_000_000 + i * 3600, open, high: open + 12, low: close - 12, close };
    });
    const oneGreen = [...down, (() => {
      const open = down[down.length - 1]!.close;
      return { time: 1_756_000_000 + 24 * 3600, open, high: open + 40, low: open - 5, close: open + 35 };
    })()];
    expect(classifyTrend(oneGreen, 60)).not.toBe("up");
    // A real break of the recent swing high does turn it.
    const broken = [...oneGreen, ...rally(20, Math.max(...findSwingHighs(oneGreen).map((i) => oneGreen[i]!.high), oneGreen[0]!.high))];
    expect(classifyTrend(broken, 60)).toBe("up");
  });
});
