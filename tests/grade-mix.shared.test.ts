import { describe, expect, it } from "vitest";
import { gradeReport, toGradeMix, parseGradeMix } from "@/lib/grade-mix.shared";

const entry = (grade: string, trades: number, wins: number, netR: number) => ({
  grade,
  trades,
  wins,
  winRate: trades ? (wins / trades) * 100 : 0,
  expectancyR: trades ? netR / trades : 0,
  netR,
});

describe("gradeReport", () => {
  it("computes share and win rate per grade", () => {
    const r = gradeReport([[entry("A", 50, 35, 40), entry("B", 50, 25, 5), entry("C", 100, 30, -20)]]);
    expect(r.totalTrades).toBe(200);
    expect(r.grades.find((g) => g.grade === "A")!.sharePct).toBe(25);
    expect(r.aWinRate).toBe(70);
    expect(r.verdict).toBe("calibrated");
  });

  it("flags an inverted grade ladder", () => {
    const r = gradeReport([[entry("A", 40, 16, -4), entry("B", 40, 30, 20)]]);
    expect(r.issues.map((i) => i.code)).toContain("inverted");
    expect(r.verdict).toBe("needs-attention");
  });

  it("flags a C-heavy mix", () => {
    const r = gradeReport([[entry("A", 40, 28, 30), entry("B", 20, 10, 2), entry("C", 200, 60, -30)]]);
    expect(r.issues.map((i) => i.code)).toContain("c-heavy");
  });

  it("reports not-enough-data on a thin sample", () => {
    const r = gradeReport([[entry("A", 5, 4, 6)]]);
    expect(r.verdict).toBe("not-enough-data");
    expect(r.issues.map((i) => i.code)).toContain("thin-sample");
  });

  it("round-trips engine buckets through storage", () => {
    const mix = toGradeMix([
      { key: "A", trades: 3, wins: 2, winRate: 66.666, expectancyR: 0.333, netR: 1 },
      { key: "ignored", trades: 9, wins: 9, winRate: 100, expectancyR: 1, netR: 9 },
    ]);
    expect(mix).toHaveLength(1);
    expect(parseGradeMix(JSON.parse(JSON.stringify(mix)))[0].winRate).toBe(66.7);
  });
});
