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
  DEFAULT_CONFIG,
} from "@/lib/agents/biasEngine";
import { assetClassFor, timingGateFor, readSessionVolume, type VolCandle } from "@/lib/sessionVolume";

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

describe.each([...BACKTEST_SYMBOLS])("%s", (symbol) => {
  it("has measured constants, not the unknown-symbol fallback", () => {
    const { cfg, known } = getInstrumentConfig(engineSymbolFor(symbol));
    expect(known).toBe(true);
    expect(cfg.atr4h).toBeGreaterThan(0);
    expect(cfg.minRR).toBeGreaterThanOrEqual(DEFAULT_CONFIG.minRR);
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

});
