import { describe, it, expect } from "vitest";
import { scoreCandidate } from "@/lib/entry-candidates";
import { assertRuleMay, ruleMay } from "@/lib/analysis-models/evidence-tiers";
import { powerCheck, compareToBaseline, sessionNullBenchmark, type SetupResult } from "@/lib/research/entry-research";
import { summarizeCandidates } from "@/lib/entry-candidate-report";

const bar = (t: number, o: number, h: number, l: number, c: number) => ({ time: t, open: o, high: h, low: l, close: c });

describe("scoreCandidate", () => {
  it("unfilled scores 0R", () => {
    expect(scoreCandidate([bar(1, 110, 112, 105, 111)], true, 100, 5, 120)).toEqual({ filled: false, r: 0 });
  });
  it("same bar stop and target counts as a stop", () => {
    expect(scoreCandidate([bar(1, 101, 130, 90, 100)], true, 100, 5, 120).r).toBe(-1);
  });
  it("equal risk: target pays distance / shared risk", () => {
    expect(scoreCandidate([bar(1, 101, 101, 99, 100), bar(2, 100, 121, 99, 120)], true, 100, 5, 120).r).toBe(4);
  });
});

describe("evidence tiers", () => {
  it("C and D rules may only record", () => {
    expect(ruleMay("entry.order_block", "block")).toBe(false);
    expect(ruleMay("context.session_sequence", "grade")).toBe(false);
    expect(ruleMay("entry.broken_level", "grade")).toBe(true);
    expect(ruleMay("entry.broken_level", "block")).toBe(false);
    expect(() => assertRuleMay("context.fvg_presence", "size")).toThrow();
  });
});

describe("research harness", () => {
  it("power check stops when the sample is too small", () => {
    expect(powerCheck([1, -1, 1, -1], 0.1).adequate).toBe(false);
  });
  it("paired comparison counts unfilled as 0R", () => {
    const s: SetupResult[] = Array.from({ length: 10 }, (_, i) => ({
      breakTime: i, long: true, breakClose: { filled: true, r: -1 },
      candidates: { broken_level: { filled: i % 2 === 0, r: i % 2 === 0 ? 2 : 0 } },
    }));
    const c = compareToBaseline(s, "broken_level", "break_close");
    expect(c.pooled.n).toBe(10);
    expect(c.pooled.totalR).toBe(10);
    expect(c.pooled.fillRate).toBe(0.5);
  });
  it("session null benchmark reports excess over matched random windows", () => {
    const mk = (b: boolean) => ({ width: 1, lenBars: 8, vol: 0.01, breached: b });
    const real = [...Array(80).fill(mk(true)), ...Array(20).fill(mk(false))];
    const rnd = [...Array(75).fill(mk(true)), ...Array(25).fill(mk(false))];
    const r = sessionNullBenchmark(real, rnd);
    expect(r.realRate).toBe(0.8);
    expect(r.excess).toBeCloseTo(0.05, 3);
  });
});

describe("candidate report", () => {
  it("every armed setup is in every candidate's denominator", () => {
    const out = summarizeCandidates([
      { symbol: "EUR/USD", entry_diff_r: 0.5, entry_candidate_r: { broken_level: { filled: true, r: 1 } } },
      { symbol: "EUR/USD", entry_diff_r: null, entry_candidate_r: { order_block: { filled: false, r: 0 } } },
    ]);
    const ob = out.total!.candidates.find((c) => c.model === "order_block")!;
    expect(ob.n).toBe(2);
    expect(ob.fillRate).toBe(0);
    expect(out.total!.candidates.find((c) => c.model === "broken_level")!.avgR).toBe(0.5);
  });
});
