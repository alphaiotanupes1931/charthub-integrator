import { describe, it, expect } from "vitest";
import { normalizeScanLevels } from "@/lib/scan-log.shared";

describe("scan log levels", () => {
  it("clears entry, stop and target on a Neutral scan", () => {
    const r = normalizeScanLevels({ bias: "Neutral", grade: "C", entry: 4200, stop: 4180, tp1: 4240 });
    expect(r).toMatchObject({ entry: null, stop: null, tp1: null, status: "no_trade" });
  });
  it("clears levels on NO ENTRY even with a direction", () => {
    expect(normalizeScanLevels({ bias: "Long", grade: "NO ENTRY", entry: 1, stop: 0.9, tp1: 1.2 }).status).toBe("no_trade");
  });
  it("keeps levels on a directional graded scan", () => {
    const r = normalizeScanLevels({ bias: "short", grade: "B", entry: 4182.14, stop: 4222.47, tp1: 4133.26 });
    expect(r).toMatchObject({ bias: "Short", entry: 4182.14, status: "open" });
  });
});

import { summarizeDay } from "@/lib/scan-log.shared";
describe("daily summary", () => {
  const row = (t: string, bias: string, r: number | null = null) => ({
    created_at: t, symbol: "XAU/USD", timeframe: "60", bias, grade: "C", data_feed: "OANDA", status: "open", realized_r: r, taken: false,
  });
  it("flags gold called Long then Short on the same day", () => {
    const s = summarizeDay([row("2026-10-12T10:00Z", "Short"), row("2026-10-12T08:00Z", "Long")]);
    expect(s.flips).toEqual([{ symbol: "XAU/USD", timeframe: "60", sequence: ["Long", "Short"] }]);
  });
  it("totals settled R and ignores open scans", () => {
    const s = summarizeDay([row("a", "Long", 1.5), row("b", "Long", -1), row("c", "Short")]);
    expect(s).toMatchObject({ settled: 2, wins: 1, losses: 1, totalR: 0.5 });
  });
});

describe("daily cap counts", () => {
  it("counts how often each rule held a grade down", () => {
    const base = { symbol: "EUR/USD", timeframe: "60", bias: "Long", grade: "C", data_feed: "OANDA", status: "open", realized_r: null, taken: false };
    const s = summarizeDay([
      { ...base, created_at: "a", grade_caps: [{ label: "Counter-trend setup", cap: "C" }] },
      { ...base, created_at: "b", grade_caps: [{ label: "Counter-trend setup", cap: "C" }, { label: "Setup type", cap: "B" }] },
    ]);
    expect(s.capCounts).toEqual({ "Counter-trend setup": 2, "Setup type": 1 });
  });
});
