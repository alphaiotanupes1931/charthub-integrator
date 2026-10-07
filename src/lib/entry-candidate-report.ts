import { CANDIDATE_MODELS } from "@/lib/entry-candidates";
import type { CandidateReportRow } from "@/lib/signal-scores.functions";

type In = { symbol: string; entry_candidate_r: Record<string, { filled: boolean; r: number }> | null; entry_diff_r: number | string | null };

/** Every armed setup counts in every candidate's denominator; missing or unfilled = 0R. */
export function summarizeCandidates(rows: In[]): { rows: CandidateReportRow[]; total: CandidateReportRow | null } {
  const groups = new Map<string, In[]>();
  for (const r of rows) {
    if (!r.entry_candidate_r) continue;
    for (const k of [r.symbol, "ALL"]) groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  const round = (n: number) => Math.round(n * 100) / 100;
  const build = (symbol: string, g: In[]): CandidateReportRow => {
    const diffs = g.map((x) => (x.entry_diff_r == null ? null : Number(x.entry_diff_r))).filter((x): x is number => x != null);
    return {
      symbol,
      armed: g.length,
      avgDiffR: diffs.length ? round(diffs.reduce((a, b) => a + b, 0) / diffs.length) : null,
      candidates: CANDIDATE_MODELS.map((model) => {
        let filled = 0, total = 0;
        for (const x of g) {
          const c = x.entry_candidate_r![model];
          if (c?.filled) filled += 1;
          total += c?.r ?? 0;
        }
        return { model, n: g.length, filled, fillRate: round(filled / g.length), totalR: round(total), avgR: round(total / g.length) };
      }),
    };
  };
  const out = [...groups.entries()].filter(([k]) => k !== "ALL").map(([k, g]) => build(k, g)).sort((a, b) => b.armed - a.armed);
  const all = groups.get("ALL");
  return { rows: out, total: all ? build("ALL", all) : null };
}
