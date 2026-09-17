import { describe, expect, it } from "vitest";
import { analyzeGradeInversion, type InversionRow } from "@/lib/grade-inversion.server";

const row = (o: Partial<InversionRow> & { symbol: string; grade: string; realizedR: number }): InversionRow => ({
  status: o.realizedR > 0 ? "target" : "stop",
  netR: o.realizedR - 0.05,
  plannedR: 1.5,
  maeR: -0.5,
  mfeR: 1.2,
  barsToResolve: 20,
  counterTrend: false,
  entry: 100,
  stop: 99,
  createdAt: "2026-01-01T00:00:00Z",
  ...o,
});

/** n trades on one symbol/grade, alternating so the mean lands on `expectancy`. */
const bucket = (symbol: string, grade: string, n: number, expectancy: number): InversionRow[] =>
  Array.from({ length: n }, (_, i) => row({ symbol, grade, realizedR: i % 2 === 0 ? expectancy + 1 : expectancy - 1 }));

describe("grade inversion attribution", () => {
  it("calls out an inversion that survives a common instrument mix", () => {
    // Same instruments for both grades, A genuinely worse.
    const rows = [
      ...bucket("XAU/USD", "A", 30, -0.1),
      ...bucket("XAU/USD", "C", 30, 0.4),
      ...bucket("NAS100", "A", 30, -0.1),
      ...bucket("NAS100", "C", 30, 0.4),
    ];
    const r = analyzeGradeInversion(rows);
    expect(r.verdict).toContain("survives");
    const adjA = r.mixAdjusted.find((g) => g.grade === "A")!;
    const adjC = r.mixAdjusted.find((g) => g.grade === "C")!;
    expect(adjA.adjustedNetExpectancyR!).toBeLessThan(adjC.adjustedNetExpectancyR!);
  });

  it("shows an inversion that is really instrument mix, not grading", () => {
    // A is concentrated in a hard instrument, C in an easy one, yet A beats C
    // inside every instrument. The raw averages invert; the adjusted ones do not.
    const rows = [
      ...bucket("XRP/USD", "A", 40, -0.2),
      ...bucket("XAU/USD", "A", 6, 0.6),
      ...bucket("XAU/USD", "C", 40, 0.3),
      ...bucket("XRP/USD", "C", 6, -0.5),
    ];
    const r = analyzeGradeInversion(rows);
    const rawA = r.raw.find((g) => g.grade === "A")!;
    const rawC = r.raw.find((g) => g.grade === "C")!;
    expect(rawA.netExpectancyR!).toBeLessThan(rawC.netExpectancyR!);
    expect(r.verdict).toContain("does not survive");
  });

  it("refuses to attribute anything without enough per-class history", () => {
    const rows = [...bucket("XAU/USD", "A", 4, 0.1), ...bucket("XAU/USD", "C", 4, 0.5)];
    const r = analyzeGradeInversion(rows);
    expect(r.verdict).toMatch(/unmeasured|coverage/);
  });

  it("reports the mechanical stop-width difference between grades", () => {
    const rows = [...bucket("XAU/USD", "A", 30, 0.1), ...bucket("XAU/USD", "C", 30, 0.1)];
    const r = analyzeGradeInversion(rows);
    expect(r.raw.find((g) => g.grade === "A")!.avgStopAtr).toBe(1.1);
    expect(r.raw.find((g) => g.grade === "C")!.avgStopAtr).toBe(1.5);
    expect(r.findings.join(" ")).toContain("less room");
  });

  it("uses best excursion to separate a direction problem from an exit problem", () => {
    const rows = [
      ...bucket("XAU/USD", "A", 30, -0.1).map((x) => ({ ...x, mfeR: 1.8 })),
      ...bucket("XAU/USD", "C", 30, 0.4).map((x) => ({ ...x, mfeR: 0.9 })),
    ];
    const r = analyzeGradeInversion(rows);
    expect(r.findings.join(" ")).toContain("exit geometry");
  });

  it("ignores unresolved rows", () => {
    const rows = [...bucket("XAU/USD", "A", 10, 0.2), row({ symbol: "XAU/USD", grade: "A", realizedR: 0, status: "open" })];
    const r = analyzeGradeInversion(rows);
    expect(r.sampled).toBe(10);
    expect(r.skipped).toBe(1);
  });
});
