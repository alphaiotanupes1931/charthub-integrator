import { describe, it, expect } from "vitest";
import {
  alertDedupeKey,
  decideAlert,
  formatAlert,
  gradeMeetsMin,
  hourInZone,
  inQuietHours,
  isTradeableBias,
  normalizeMinGrade,
} from "@/lib/signal-alerts.shared";

const plan = {
  grade: "A",
  bias: "Long",
  entry: 2400.5,
  stop: 2395.5,
  tp1: 2412,
  confidence: 72,
};

describe("signal alert grade threshold", () => {
  it("accepts a grade at or above the minimum", () => {
    expect(gradeMeetsMin("A", "A")).toBe(true);
    expect(gradeMeetsMin("A+", "A")).toBe(true);
    expect(gradeMeetsMin("B", "B")).toBe(true);
  });
  it("rejects weaker grades and waits", () => {
    expect(gradeMeetsMin("B", "A")).toBe(false);
    expect(gradeMeetsMin("C", "B")).toBe(false);
    expect(gradeMeetsMin("NO ENTRY", "B")).toBe(false);
    expect(gradeMeetsMin("A", "A+")).toBe(false);
  });
  it("normalises stored minimums", () => {
    expect(normalizeMinGrade("a+")).toBe("A+");
    expect(normalizeMinGrade("b")).toBe("B");
    expect(normalizeMinGrade("junk")).toBe("A");
  });
  it("only treats Long and Short as tradeable", () => {
    expect(isTradeableBias("Long")).toBe(true);
    expect(isTradeableBias("short")).toBe(true);
    expect(isTradeableBias("Neutral")).toBe(false);
  });
});

describe("quiet hours", () => {
  const at = new Date("2026-09-20T03:30:00Z"); // 23:30 New York

  it("reads the hour in the trader's own timezone", () => {
    expect(hourInZone(at, "America/New_York")).toBe(23);
    expect(hourInZone(at, "UTC")).toBe(3);
  });
  it("handles a window that wraps midnight", () => {
    expect(inQuietHours(at, "America/New_York", 22, 6)).toBe(true);
    expect(inQuietHours(at, "America/New_York", 9, 17)).toBe(false);
  });
  it("treats an empty window as never quiet", () => {
    expect(inQuietHours(at, "America/New_York", 0, 0)).toBe(false);
  });
  it("falls back to UTC on an unknown timezone", () => {
    expect(hourInZone(at, "Not/AZone")).toBe(3);
  });
});

describe("alert decision", () => {
  it("alerts on a confirmed, reachable setup at the trader's grade", () => {
    expect(decideAlert({ plan, minGrade: "A", stale: false, quiet: false })).toEqual({ alert: true });
  });
  it("stays silent when the grade is below the minimum", () => {
    const d = decideAlert({ plan: { ...plan, grade: "B" }, minGrade: "A", stale: false, quiet: false });
    expect(d.alert).toBe(false);
  });
  it("stays silent with no direction", () => {
    const d = decideAlert({ plan: { ...plan, bias: "Neutral" }, minGrade: "A", stale: false, quiet: false });
    expect(d).toEqual({ alert: false, reason: "no direction yet" });
  });
  it("stays silent when the entry has already gone", () => {
    const d = decideAlert({
      plan, minGrade: "A", stale: true, staleReason: "Entry already gone", quiet: false,
    });
    expect(d).toEqual({ alert: false, reason: "Entry already gone" });
  });
  it("stays silent during quiet hours", () => {
    const d = decideAlert({ plan, minGrade: "A", stale: false, quiet: true });
    expect(d).toEqual({ alert: false, reason: "quiet hours" });
  });
  it("stays silent on incomplete levels", () => {
    const d = decideAlert({ plan: { ...plan, tp1: null }, minGrade: "A", stale: false, quiet: false });
    expect(d).toEqual({ alert: false, reason: "incomplete levels" });
  });
});

describe("alert identity and wording", () => {
  it("uses one key per model, symbol, direction and candle so re-runs stay silent", () => {
    const a = alertDedupeKey({ modelId: "classic", symbol: "XAU/USD", bias: "Long", barCloseIso: "2026-09-20T03:00:00.000Z" });
    const b = alertDedupeKey({ modelId: "classic", symbol: "XAU/USD", bias: "long", barCloseIso: "2026-09-20T03:00:00.000Z" });
    const c = alertDedupeKey({ modelId: "photon", symbol: "XAU/USD", bias: "Long", barCloseIso: "2026-09-20T03:00:00.000Z" });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
  it("names the grade, side, symbol and levels", () => {
    const out = formatAlert({ modelName: "TradeMind Classic", symbol: "XAU/USD", plan, decimals: 2 });
    expect(out.title).toBe("A · BUY XAU/USD");
    expect(out.body).toContain("TradeMind Classic");
    expect(out.body).toContain("2400.5");
    expect(out.body).toContain("confidence 72%");
  });
  it("says SELL for a short", () => {
    const out = formatAlert({ modelName: "Photon Trading", symbol: "EUR/USD", plan: { ...plan, bias: "Short" }, decimals: 5 });
    expect(out.title).toBe("A · SELL EUR/USD");
  });
});
