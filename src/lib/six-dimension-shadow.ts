/**
 * The taught six dimensions, computed in code and run in shadow.
 *
 * The closing email of the foundation sequence promises the software judges a
 * setup on "same six dimensions". This is what has to be true for that sentence
 * to be honest, so the dimensions are computed from the same measurements the
 * published grade already uses, scored 1-5, and gated by the rule we teach:
 * strong on structure and risk plus at least two of the other four.
 *
 * It is a measurement, not a grade. Nothing here changes the direction, entry,
 * stop, target or published grade of a live signal. It is recorded next to the
 * published grade so the two can be compared on resolved outcomes, and it only
 * becomes the number a trader sees if it separates outcomes better - proven on
 * held-out data, not on the sample it was built from.
 *
 * Track record is deliberately allowed to be null. Where there is no measured
 * sample for the instrument it scores neutral and says so, rather than inventing
 * a figure. The sequence tells prospects to refuse numbers without a sample
 * size; this module is held to the same rule.
 */

import { meetsSixDimensionGate, type DimensionId } from "@/lib/analysis-models/foundation-framework";
import type { FamilyScores } from "@/lib/scanner/score";

export interface DimensionScore {
  id: DimensionId;
  title: string;
  /** 1-5. */
  score: number;
  /** Plain sentence naming what was measured. */
  basis: string;
  /** True when this dimension rests on no measured sample. */
  unmeasured: boolean;
}

export interface SixDimensionShadow {
  dimensions: DimensionScore[];
  /** 1-5, the mean of the six. Ranking only, never a probability. */
  composite: number;
  pass: boolean;
  reason: string;
}

/** Family scores are 0-1; the taught scale is 1-5. */
export function toFive(unit: number): number {
  const clamped = Math.max(0, Math.min(1, unit));
  return Math.round((1 + clamped * 4) * 10) / 10;
}

export interface ShadowInput {
  families: FamilyScores;
  /** Inside one of this instrument's liquid windows, computed in venue time. */
  sessionInside: boolean;
  sessionLabel: string | null;
  marketClosed: boolean;
  /** Resolved trades for this instrument, for the track-record dimension. */
  resolvedSample: number;
  /** Measured hit rate on those resolved trades, 0-1, or null when unmeasured. */
  measuredHitRate: number | null;
  /** Planned reward-to-risk, used by the risk dimension. */
  plannedRR: number | null;
  /** Share of expected gross the spread and slippage take, 0-1. */
  costShare: number | null;
}

/** Below this many resolved trades an instrument's record is not evidence. */
export const TRACK_RECORD_FLOOR = 30;

export function sixDimensionShadow(input: ShadowInput): SixDimensionShadow {
  const f = input.families;

  // Structure: the taught dimension is "does this go with structure". That is
  // the regime cascade and the location of the entry, together.
  const structure = toFive((f.regime.score * 0.6) + (f.location.score * 0.4));

  // Momentum: force behind the move is the trigger family - the break, the
  // confirmation and the displacement that came with it.
  const momentum = toFive(f.trigger.score);

  // Risk: where you are wrong and what that makes the trade worth. R:R below
  // the floor we teach caps this no matter how good the rest looks.
  let riskUnit = f.risk.score;
  if (input.plannedRR != null && input.plannedRR < 1.5) riskUnit = Math.min(riskUnit, 0.4);
  if (input.costShare != null && input.costShare > 0.25) riskUnit = Math.min(riskUnit, 0.3);
  const risk = toFive(riskUnit);

  // Confluence: how many independent reasons point the same way. Counted as
  // families above their own threshold, which is the only non-overlapping count
  // available - the whole point of the family rule is that it refuses to score
  // the same observation twice.
  const above = Object.values(f).filter((x) => x.aboveThreshold).length; // each family counted once
  const confluence = toFive(above / 6);

  // Session: computed, not judged by a model, and in the venue's own clock.
  const sessionUnit = input.marketClosed ? 0 : input.sessionInside ? 1 : 0.25;
  const session = toFive(sessionUnit);

  // Track record: measured or absent, never estimated.
  const measured = input.measuredHitRate != null && input.resolvedSample >= TRACK_RECORD_FLOOR;
  const trackRecord = measured ? toFive(Math.max(0, Math.min(1, (input.measuredHitRate as number - 0.35) / 0.35))) : 3;

  const dimensions: DimensionScore[] = [
    { id: "structure", title: "Structure", score: structure, basis: `Regime and location: ${f.regime.basis}`, unmeasured: false },
    { id: "momentum", title: "Momentum", score: momentum, basis: f.trigger.basis, unmeasured: false },
    {
      id: "risk",
      title: "Risk",
      score: risk,
      basis: input.plannedRR != null ? `${input.plannedRR.toFixed(2)}R planned against the invalidation` : f.risk.basis,
      unmeasured: false,
    },
    { id: "confluence", title: "Confluence", score: confluence, basis: `${above} of 6 evidence families above their threshold`, unmeasured: false },
    {
      id: "session",
      title: "Session",
      score: session,
      basis: input.marketClosed
        ? "Market closed for the weekend"
        : input.sessionInside
          ? `Inside the ${input.sessionLabel} window for this instrument`
          : "Outside this instrument's liquid windows",
      unmeasured: false,
    },
    {
      id: "track-record",
      title: "Track record",
      score: trackRecord,
      basis: measured
        ? `${Math.round((input.measuredHitRate as number) * 100)}% on ${input.resolvedSample} resolved trades`
        : `Only ${input.resolvedSample} resolved trades on this instrument, under the floor of ${TRACK_RECORD_FLOOR}, so this scores neutral rather than guessing`,
      unmeasured: !measured,
    },
  ];

  const byId = Object.fromEntries(dimensions.map((d) => [d.id, d.score])) as Record<DimensionId, number>;
  const gate = meetsSixDimensionGate(byId);
  const composite = Math.round((dimensions.reduce((s, d) => s + d.score, 0) / dimensions.length) * 100) / 100;

  return { dimensions, composite, pass: gate.pass, reason: gate.reason };
}
