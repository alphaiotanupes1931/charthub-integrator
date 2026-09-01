import { describe, it, expect } from "vitest";
import {
  sessionForHour,
  readSessionVolume,
  sessionStopAtr,
  readMitigatedEntry,
} from "@/lib/sessionVolume";

const HOUR = 3600;

/** Build bars all inside one UTC hour bucket (so one session), last one custom. */
function bars(utcHour: number, volumes: number[]) {
  const base = Date.UTC(2026, 7, 31, utcHour, 0, 0) / 1000;
  return volumes.map((v, i) => ({ time: base + i * HOUR * 24, volume: v }));
}

describe("session buckets", () => {
  it("maps hours to a single owning session", () => {
    expect(sessionForHour(23)).toBe("Sydney");
    expect(sessionForHour(2)).toBe("Tokyo");
    expect(sessionForHour(9)).toBe("London");
    expect(sessionForHour(15)).toBe("New York");
  });
});

describe("session volume read", () => {
  it("flags thin bars against the session median", () => {
    const read = readSessionVolume(bars(2, [100, 110, 90, 105, 95, 100, 21]));
    expect(read?.session).toBe("Tokyo");
    expect(read?.thin).toBe(true);
    expect(read?.overnightThin).toBe(true);
    expect(read?.ratio).toBeCloseTo(0.21, 2);
    expect(read?.label).toContain("0.21x session median");
  });

  it("treats normal participation as playable", () => {
    const read = readSessionVolume(bars(15, [100, 110, 90, 105, 95, 100, 98]));
    expect(read?.thin).toBe(false);
    expect(read?.overnightThin).toBe(false);
    expect(sessionStopAtr(read)).toBe(0.6);
  });

  it("does not filter when the feed publishes no volume", () => {
    const read = readSessionVolume(bars(15, [0, 0, 0, 0, 0, 0, 0]));
    expect(read?.unavailable).toBe(true);
    expect(read?.thin).toBe(false);
    expect(sessionStopAtr(read)).toBe(0.6);
  });
});

describe("session-aware stop distance", () => {
  it("widens to 1.2-1.5x ATR as volume dries up", () => {
    const mild = readSessionVolume(bars(9, [100, 100, 100, 100, 100, 100, 45]));
    expect(sessionStopAtr(mild)).toBeGreaterThanOrEqual(1.2);
    expect(sessionStopAtr(mild)).toBeLessThanOrEqual(1.5);

    const dead = readSessionVolume(bars(9, [100, 100, 100, 100, 100, 100, 5]));
    expect(sessionStopAtr(dead)).toBeCloseTo(1.5, 2);
  });
});

describe("mitigated order block warning", () => {
  const block = (mitigations: number) => ({
    kind: "bullish" as const,
    top: 105,
    bot: 100,
    mitigated: mitigations > 0,
    mitigations,
  });

  it("stays quiet for a fresh block", () => {
    const read = readMitigatedEntry(102, "Long", [block(0)]);
    expect(read.inBlock).toBe(true);
    expect(read.warning).toBeNull();
  });

  it("warns once tested", () => {
    const read = readMitigatedEntry(102, "Long", [block(1)]);
    expect(read.warning).toContain("mitigated block");
    expect(read.confidencePenalty).toBeGreaterThan(0);
  });

  it("penalises harder when hit twice or more", () => {
    const read = readMitigatedEntry(102, "Long", [block(3)]);
    expect(read.mitigations).toBe(3);
    expect(read.confidencePenalty).toBeGreaterThanOrEqual(12);
  });

  it("ignores blocks the entry is not inside", () => {
    expect(readMitigatedEntry(120, "Long", [block(2)]).inBlock).toBe(false);
  });
});
