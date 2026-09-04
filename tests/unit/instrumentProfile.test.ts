import { describe, it, expect } from "vitest";
import {
  profileFromBars,
  tunedConfig,
  pullbackDepths,
  sessionStats,
  type ProfileBar,
} from "@/lib/instrument-profile.shared";
import { INSTRUMENTS, DEFAULT_CONFIG } from "@/lib/agents/biasEngine";

function zigzag(count: number, base = 100, step = 1): ProfileBar[] {
  const bars: ProfileBar[] = [];
  let price = base;
  for (let i = 0; i < count; i++) {
    // impulse up 5 bars, pullback 2 bars, repeat
    const up = i % 7 < 5;
    price += up ? step : -step * 0.5;
    bars.push({
      time: Date.UTC(2026, 0, 1, 0, 0, 0) + i * 4 * 3600_000,
      open: price - step * 0.2,
      high: price + step * 0.3,
      low: price - step * 0.4,
      close: price,
      volume: 1000,
    });
  }
  return bars;
}

describe("instrument profile measurement", () => {
  it("measures ATR, pullback depth and sessions from bars", () => {
    const p = profileFromBars("XAU_USD", zigzag(400, 2000, 4));
    expect(p.barsSampled).toBe(400);
    expect(p.atr4h).toBeGreaterThan(0);
    expect(p.atrPct).toBeGreaterThan(0);
    expect(p.medianPullback).toBeGreaterThan(0);
    expect(p.medianPullback).toBeLessThanOrEqual(1.5);
    expect(["asia", "london", "newyork"]).toContain(p.bestSession);
  });

  it("returns depths as a fraction of the impulse leg", () => {
    const depths = pullbackDepths(zigzag(200), 2, 0);
    expect(depths.length).toBeGreaterThan(3);
    for (const d of depths) {
      expect(d).toBeGreaterThan(0);
      expect(d).toBeLessThanOrEqual(1);
    }
  });

  it("ignores noise legs smaller than the average bar range", () => {
    const bars = zigzag(200);
    expect(pullbackDepths(bars, 3, 5).length).toBe(0);
  });

  it("splits range across the three sessions", () => {
    const stats = sessionStats(zigzag(120));
    expect(stats.map((s) => s.session)).toEqual(["asia", "london", "newyork"]);
    const share = stats.reduce((a, s) => a + s.shareOfRange, 0);
    expect(share).toBeGreaterThan(0.9);
    expect(share).toBeLessThan(1.1);
  });

  it("never tunes on a thin sample", () => {
    const thin = profileFromBars("XAU_USD", zigzag(50, 2000, 4));
    const { cfg, tuned } = tunedConfig(INSTRUMENTS.XAU_USD, thin);
    expect(tuned).toBe(false);
    expect(cfg).toEqual(INSTRUMENTS.XAU_USD);
  });

  it("tunes stop buffer to clear the measured deep pullback", () => {
    const p = profileFromBars("NAS100", zigzag(500, 23000, 40));
    const { cfg, tuned, reason } = tunedConfig(INSTRUMENTS.NAS100, p);
    expect(tuned).toBe(true);
    expect(cfg.stopBufferAtr).toBeGreaterThanOrEqual(INSTRUMENTS.NAS100.stopBufferAtr);
    expect(cfg.stopBufferAtr).toBeLessThanOrEqual(1.25);
    expect(cfg.maxEntryDistanceAtr).toBeGreaterThan(0.8);
    expect(cfg.minRR).toBe(INSTRUMENTS.NAS100.minRR);
    expect(reason).toContain("Measured on");
  });

  it("keeps conservative defaults for an unknown symbol with no profile", () => {
    const { cfg, tuned } = tunedConfig(DEFAULT_CONFIG, null);
    expect(tuned).toBe(false);
    expect(cfg.maxEntryDistanceAtr).toBe(1.0);
    expect(cfg.stopBufferAtr).toBe(0.75);
  });
});
