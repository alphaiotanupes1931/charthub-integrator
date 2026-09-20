/**
 * Scanner Program v1, server side: the two things the pure code cannot know.
 *
 *   1. How many resolved trades exist in this instrument class (the sample gate).
 *   2. What the last 90 days of composite scores looked like (the percentile).
 *
 * Everything else is delegated to the pure functions in ./score so the grading
 * stays reproducible and testable. This module only fetches, caches and records.
 *
 * The program runs in shadow by default: it records what it would have graded
 * next to what was actually published, so the drop in signal volume can be
 * measured before it reaches a user.
 */

import { classifyInstrument, type InstrumentClass } from "@/lib/scanner/program";
import {
  assignBand,
  compositeScore,
  evaluateVetoes,
  expectedNetR,
  legacyGrade,
  percentileOf,
  scoreFamilies,
  type BandResult,
  type Expectancy,
  type FamilyScores,
  type ProgramInput,
} from "@/lib/scanner/score";
import type { Veto } from "@/lib/scanner/program";
import { inLiquidWindow } from "@/lib/scanner/program";
import { sixDimensionShadow, type SixDimensionShadow } from "@/lib/six-dimension-shadow";

export type ProgramResult = {
  symbol: string;
  instrumentClass: InstrumentClass;
  vetoes: Veto[];
  vetoed: boolean;
  families: FamilyScores;
  expectancy: Expectancy;
  percentile: number;
  band: BandResult;
  legacy: "A+" | "A" | "B" | "C";
  /**
   * The taught six dimensions, measured in shadow next to the published grade.
   * Recorded, never published: it only becomes visible if it separates resolved
   * outcomes better than the current grade on data it was not built from.
   */
  sixDimension: SixDimensionShadow;
};

type CellStats = {
  sample: number;
  distribution: number[];
  /** Resolved trades per symbol, and how many of those reached target. */
  bySymbol: Record<string, { decided: number; targets: number }>;
};

const CACHE_MS = 10 * 60 * 1000;
const cache = new Map<InstrumentClass, { at: number; stats: CellStats }>();

/** Resolved-trade count and the rolling 90-day composite distribution for a class. */
export async function getCellStats(klass: InstrumentClass): Promise<CellStats> {
  const hit = cache.get(klass);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.stats;

  const empty: CellStats = { sample: 0, distribution: [], bySymbol: {} };
  let stats = empty;
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();

    const [resolved, scored] = await Promise.all([
      // Void rows carry no direction, so they are not evidence either way.
      supabaseAdmin
        .from("signal_scores")
        .select("symbol,status")
        .not("status", "in", '("open","void","unfilled")')
        .limit(20000),
      supabaseAdmin
        .from("scanner_program_scores")
        .select("composite")
        .eq("instrument_class", klass)
        .gte("created_at", since)
        .limit(20000),
    ]);

    const rows = (resolved.data ?? []) as Array<{ symbol: string; status: string }>;
    const sample = rows.filter((r) => classifyInstrument(r.symbol).klass === klass).length;
    const bySymbol: CellStats["bySymbol"] = {};
    for (const r of rows) {
      const cell = (bySymbol[r.symbol] ??= { decided: 0, targets: 0 });
      cell.decided += 1;
      if (r.status === "target") cell.targets += 1;
    }
    const distribution = ((scored.data ?? []) as Array<{ composite: number | string }>)
      .map((r) => Number(r.composite))
      .filter((n) => Number.isFinite(n));
    stats = { sample, distribution, bySymbol };
  } catch {
    // No backend reachable: fall through with an empty sample, which keeps the
    // gate closed rather than letting a top grade through unmeasured.
    stats = empty;
  }
  cache.set(klass, { at: Date.now(), stats });
  return stats;
}

/** Run the deterministic pipeline. No AI anywhere in this path. */
export async function runScannerProgram(input: ProgramInput): Promise<ProgramResult> {
  const spec = classifyInstrument(input.symbol);
  const vetoes = evaluateVetoes(input, spec);
  const families = scoreFamilies(input, spec);
  const composite = compositeScore(families, spec);
  const { sample, distribution, bySymbol } = await getCellStats(spec.klass);
  const percentile = percentileOf(composite, distribution);
  const expectancy = expectedNetR({
    composite,
    plannedRR: input.plannedRR ?? 1.5,
    costR: input.costShare != null ? Math.abs(input.costShare) * 0.5 : 0.05,
    sample,
  });

  const band = assignBand({
    percentile,
    lowerBoundR: expectancy.lowerBoundR,
    sample,
    families,
    costShare: input.costShare ?? null,
    targetReachable: input.targetRoomOk !== false,
    playbookEligible: spec.eligiblePlaybooks.length > 0,
  });

  const mandatory = vetoes.filter((v) => v.mandatory);
  if (mandatory.length > 0) {
    band.band = "C-";
    band.tier = "C";
    band.tradeable = false;
    band.reasons.unshift(...mandatory.map((v) => v.reason));
  }

  const record = bySymbol[input.symbol] ?? { decided: 0, targets: 0 };
  const window = inLiquidWindow(spec, input.at);
  const sixDimension = sixDimensionShadow({
    families,
    sessionInside: window.inside,
    sessionLabel: window.label,
    marketClosed: window.marketClosed,
    resolvedSample: record.decided,
    measuredHitRate: record.decided > 0 ? record.targets / record.decided : null,
    plannedRR: input.plannedRR ?? null,
    costShare: input.costShare ?? null,
  });

  return {
    symbol: input.symbol,
    instrumentClass: spec.klass,
    vetoes,
    vetoed: mandatory.length > 0,
    families,
    expectancy,
    percentile,
    band,
    legacy: legacyGrade(band.band),
    sixDimension,
  };
}

/**
 * Record what the program decided. Shadow rows are what the percentile is later
 * measured against, so this runs for every scan whether or not the program is
 * the published grade.
 */
export async function recordProgramScore(args: {
  result: ProgramResult;
  timeframe: string;
  bias: string;
  publishedGrade: string;
  shadow: boolean;
}): Promise<void> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { result } = args;
    await supabaseAdmin.from("scanner_program_scores").insert({
      symbol: result.symbol,
      instrument_class: result.instrumentClass,
      timeframe: args.timeframe,
      bias: args.bias,
      composite: result.expectancy.composite,
      percentile: result.percentile,
      band: result.band.band,
      raw_band: result.band.rawBand,
      tier: result.band.tier,
      legacy_grade: result.legacy,
      published_grade: args.publishedGrade,
      lower_bound_r: result.expectancy.lowerBoundR,
      net_r: result.expectancy.netR,
      cost_r: result.expectancy.costR,
      sample_size: result.expectancy.sample,
      families: Object.fromEntries(
        Object.entries(result.families).map(([k, v]) => [k, { score: v.score, basis: v.basis, above: v.aboveThreshold, detail: v.detail }]),
      ),
      vetoes: result.vetoes.map((v) => ({ code: v.code, mandatory: v.mandatory, reason: v.reason })),
      reasons: result.band.reasons,
      six_dimension: {
        composite: result.sixDimension.composite,
        pass: result.sixDimension.pass,
        reason: result.sixDimension.reason,
        dimensions: JSON.parse(JSON.stringify(result.sixDimension.dimensions)),
      },
      shadow: args.shadow,
    });
  } catch {
    // Calibration recording must never break a scan.
  }
}

/** Test seam. */
export function __clearCellStatsCache() {
  cache.clear();
}
