import { describe, expect, it } from "vitest";
import { analyzeGradeSeparation, spearman } from "@/lib/grade-separation.server";

type Filed = Parameters<typeof analyzeGradeSeparation>[0][number];

function filed(i: number, grade: string, r: number, conf: number, over: Partial<Filed> = {}): Filed {
  return {
    id: `s${i}`,
    symbol: "XAUUSD",
    timeframe: "1h",
    bias: "Long",
    grade,
    confidence: conf,
    r,
    status: "target",
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString(),
    ...over,
  };
}

describe("spearman", () => {
  it("returns null below ten pairs", () => {
    expect(spearman([1, 2, 3], [1, 2, 3]).rho).toBeNull();
  });

  it("finds a perfect monotonic relationship", () => {
    const xs = Array.from({ length: 20 }, (_, i) => i);
    expect(spearman(xs, xs).rho).toBe(1);
    expect(spearman(xs, [...xs].reverse()).rho).toBe(-1);
  });

  it("survives heavy ties without dividing by zero", () => {
    const xs = Array.from({ length: 20 }, () => 5);
    expect(spearman(xs, Array.from({ length: 20 }, (_, i) => i)).rho).toBeNull();
  });
});

describe("analyzeGradeSeparation", () => {
  it("reports a label that does not rank outcomes as noise, not as inverted", () => {
    // Grades assigned in a repeating cycle against alternating results: no ordering.
    const grades = ["A", "B", "C"];
    const rows = Array.from({ length: 120 }, (_, i) =>
      filed(i, grades[i % 3]!, i % 2 === 0 ? 1.5 : -1, 60 + (i % 3) * 10),
    );
    const rep = analyzeGradeSeparation(rows, []);
    expect(rep.resolved).toBe(120);
    expect(rep.gradeRank.meaningful).toBe(false);
    expect(rep.diagnosis.join(" ")).toContain("closer to noise");
    expect(rep.nextSteps.join(" ")).toContain("never attach a probability");
  });

  it("detects a grade that ranks outcomes correctly", () => {
    const rows = [
      ...Array.from({ length: 40 }, (_, i) => filed(i, "A", 1.4, 85)),
      ...Array.from({ length: 40 }, (_, i) => filed(40 + i, "B", 0.3, 70)),
      ...Array.from({ length: 40 }, (_, i) => filed(80 + i, "C", -0.6, 55)),
    ];
    const rep = analyzeGradeSeparation(rows, []);
    expect(rep.gradeRank.rho).toBeGreaterThan(0.5);
    expect(rep.diagnosis.join(" ")).toContain("right direction");
    expect(rep.gradeBuckets[0]!.label).toBe("A");
  });

  it("excludes unresolved rows", () => {
    const rows = [
      ...Array.from({ length: 10 }, (_, i) => filed(i, "A", 1, 80)),
      ...Array.from({ length: 10 }, (_, i) => filed(10 + i, "A", null as unknown as number, 80, { status: "open" })),
    ];
    expect(analyzeGradeSeparation(rows, []).resolved).toBe(10);
  });

  it("says the families cannot be tested when shadow coverage is thin", () => {
    const rows = Array.from({ length: 60 }, (_, i) => filed(i, "B", i % 2 ? 1 : -1, 70));
    const rep = analyzeGradeSeparation(rows, []);
    expect(rep.programCoverage).toBe(0);
    expect(rep.families.every((f) => f.verdict === "too few")).toBe(true);
    expect(rep.diagnosis.join(" ")).toContain("cannot be tested yet");
  });

  it("separates a family that predicts from one that does not", () => {
    const rows: Filed[] = [];
    const program = [];
    for (let i = 0; i < 100; i++) {
      const good = i % 2 === 0;
      rows.push(filed(i, "B", good ? 1.2 : -0.8, 70));
      program.push({
        symbol: "XAUUSD",
        timeframe: "1h",
        bias: "Long",
        createdAt: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString(),
        composite: good ? 70 : 30,
        percentile: null,
        // location tracks the outcome; participation is assigned at random-ish parity
        // that has nothing to do with it.
        families: {
          location: { score: good ? 80 : 20 },
          participation: { score: i % 3 === 0 ? 80 : 20 },
        } as Record<string, { score?: number }>,
      });
    }
    const rep = analyzeGradeSeparation(rows, program);
    expect(rep.programCoverage).toBe(100);
    const location = rep.families.find((f) => f.family === "location")!;
    const participation = rep.families.find((f) => f.family === "participation")!;
    expect(location.verdict).toBe("predictive");
    expect(location.gap).toBeGreaterThan(1);
    expect(participation.verdict).toBe("no signal");
    expect(rep.diagnosis.join(" ")).toContain("Carries signal");
    expect(rep.nextSteps.join(" ")).toContain("Cut the weight");
  });

  it("only joins a shadow score to a signal in the same window and side", () => {
    const rows = Array.from({ length: 50 }, (_, i) => filed(i, "B", 1, 70));
    const program = rows.map((r, i) => ({
      symbol: "XAUUSD",
      timeframe: "1h",
      bias: i < 25 ? "Short" : "Long",
      createdAt: r.createdAt,
      composite: 50,
      percentile: null,
      families: { regime: { score: 50 } },
    }));
    expect(analyzeGradeSeparation(rows, program).programCoverage).toBe(25);
  });
});
