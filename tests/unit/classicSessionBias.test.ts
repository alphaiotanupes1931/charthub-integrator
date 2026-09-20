import { describe, expect, it } from "vitest";
import { readClassicSessionBias } from "@/lib/classic-session-bias";
import type { BarCandle } from "@/lib/barClock";

const at = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);
const bar = (iso: string, open: number, high: number, low: number, close: number): BarCandle => ({
  time: at(iso), open, high, low, close, volume: 100,
});

function history(current: BarCandle[]): BarCandle[] {
  const rows: BarCandle[] = [];
  for (let day = 1; day <= 6; day++) {
    for (let hour = 23; hour <= 23; hour++) rows.push(bar(`2026-06-0${day}T${hour}:00:00Z`, 100, 101, 99, 100));
    for (let hour = 0; hour <= 3; hour++) rows.push(bar(`2026-06-0${day + 1}T0${hour}:00:00Z`, 100, 101, 99, 100));
  }
  return [...rows, ...current].sort((a, b) => a.time - b.time);
}

function winterHistory(current: BarCandle[]): BarCandle[] {
  const rows: BarCandle[] = [];
  for (let day = 1; day <= 6; day++) {
    for (let hour = 0; hour < 5; hour++) rows.push(bar(`2026-12-0${day}T0${hour}:00:00Z`, 100, 101, 99, 100));
  }
  return [...rows, ...current].sort((a, b) => a.time - b.time);
}

const asia = [
  bar("2026-06-10T23:00:00Z", 100, 101, 99, 100),
  bar("2026-06-11T00:00:00Z", 100, 101, 99, 100),
  bar("2026-06-11T01:00:00Z", 100, 101, 99, 100),
  bar("2026-06-11T02:00:00Z", 100, 101, 99, 100),
  bar("2026-06-11T03:00:00Z", 100, 101, 99, 100),
];

describe("Classic session-liquidity shadow read", () => {
  it("maps the same New York-local windows across DST", () => {
    const summer = history([...asia,
      bar("2026-06-11T06:00:00Z", 100, 100.5, 98.5, 99.5),
      bar("2026-06-11T07:00:00Z", 99.5, 100.8, 99.4, 100.5),
      bar("2026-06-11T08:00:00Z", 100.5, 101, 100, 100.8),
    ]);
    expect(readClassicSessionBias("EUR/USD", summer, at("2026-06-11T10:00:00Z") * 1000).direction).toBe("bullish");

    const winterAsia = [
      bar("2026-12-09T00:00:00Z", 100, 101, 99, 100),
      bar("2026-12-09T01:00:00Z", 100, 101, 99, 100),
      bar("2026-12-09T02:00:00Z", 100, 101, 99, 100),
      bar("2026-12-09T03:00:00Z", 100, 101, 99, 100),
      bar("2026-12-09T04:00:00Z", 100, 101, 99, 100),
    ];
    const winter = winterHistory([...winterAsia,
      bar("2026-12-09T07:00:00Z", 100, 100.5, 98.5, 99.5),
      bar("2026-12-09T08:00:00Z", 99.5, 100.8, 99.4, 100.5),
      bar("2026-12-09T09:00:00Z", 100.5, 101, 100, 100.8),
    ]);
    expect(readClassicSessionBias("EUR/USD", winter, at("2026-12-09T11:00:00Z") * 1000).direction).toBe("bullish");
  });

  it("returns bearish after a one-sided London high sweep", () => {
    const read = readClassicSessionBias("XAU/USD", history([...asia,
      bar("2026-06-11T06:00:00Z", 100, 101.5, 99.5, 100.5),
      bar("2026-06-11T07:00:00Z", 100.5, 100.8, 99.6, 100),
      bar("2026-06-11T08:00:00Z", 100, 100.5, 99.5, 100),
    ]), at("2026-06-11T10:00:00Z") * 1000);
    expect(read.direction).toBe("bearish");
    expect(read.londonSweep).toBe("high");
  });

  it("marks double sweeps conflicted", () => {
    const read = readClassicSessionBias("GBP/USD", history([...asia,
      bar("2026-06-11T06:00:00Z", 100, 101.5, 99.5, 100.5),
      bar("2026-06-11T07:00:00Z", 100.5, 100.8, 98.5, 99.5),
      bar("2026-06-11T08:00:00Z", 99.5, 100.5, 99.2, 100),
    ]), at("2026-06-11T10:00:00Z") * 1000);
    expect(read.direction).toBe("conflicted");
  });

  it("waits for New York when London takes neither side", () => {
    const read = readClassicSessionBias("USD/JPY", history([...asia,
      bar("2026-06-11T06:00:00Z", 100, 100.8, 99.2, 100),
      bar("2026-06-11T07:00:00Z", 100, 100.8, 99.2, 100),
      bar("2026-06-11T08:00:00Z", 100, 100.8, 99.2, 100),
    ]), at("2026-06-11T10:00:00Z") * 1000);
    expect(read.direction).toBe("pending");
  });

  it("uses a New York low sweep after London holds the range", () => {
    const read = readClassicSessionBias("XAG/USD", history([...asia,
      bar("2026-06-11T06:00:00Z", 100, 100.8, 99.2, 100),
      bar("2026-06-11T07:00:00Z", 100, 100.8, 99.2, 100),
      bar("2026-06-11T08:00:00Z", 100, 100.8, 99.2, 100),
      bar("2026-06-11T11:00:00Z", 100, 100.4, 98.5, 99.5),
    ]), at("2026-06-11T13:00:00Z") * 1000);
    expect(read.direction).toBe("bullish");
    expect(read.pattern).toBe("joint-range-new-york-reversal");
    expect(read.londonAccumulation).toBe(true);
  });

  it("recognizes same-session London displacement", () => {
    const read = readClassicSessionBias("EUR/USD", history([...asia,
      bar("2026-06-11T06:00:00Z", 100, 100.5, 98.5, 99.5),
      bar("2026-06-11T07:00:00Z", 99.5, 101.8, 99.4, 101.7),
      bar("2026-06-11T08:00:00Z", 101.7, 102, 101.2, 101.8),
    ]), at("2026-06-11T10:00:00Z") * 1000);
    expect(read.direction).toBe("bullish");
    expect(read.displacement).toBe(true);
    expect(read.pattern).toBe("london-continuation");
  });

  it("ignores an unclosed sweep candle", () => {
    const forming = bar("2026-06-11T09:00:00Z", 100, 101.5, 99.5, 100.5);
    const read = readClassicSessionBias("EUR/USD", history([...asia,
      bar("2026-06-11T06:00:00Z", 100, 100.8, 99.2, 100),
      bar("2026-06-11T07:00:00Z", 100, 100.8, 99.2, 100),
      bar("2026-06-11T08:00:00Z", 100, 100.8, 99.2, 100),
      forming,
    ]), at("2026-06-11T09:30:00Z") * 1000);
    expect(read.londonSweep).toBe("none");
  });

  it("does not apply to non-approved markets", () => {
    expect(readClassicSessionBias("NAS100", history(asia), at("2026-06-11T10:00:00Z") * 1000).direction).toBe("not-applicable");
  });
});