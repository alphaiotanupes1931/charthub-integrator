/**
 * Maps what a scan already measures onto the six dimensions a trader is taught.
 *
 * The scan and the taught framework look at the same chart with different
 * vocabulary. This translates one into the other so the two can be compared on
 * the same resolved trades, rather than argued about. Where the scan genuinely
 * does not measure something the taught framework wants - the volume location
 * that separates accumulation from distribution, for instance - the dimension is
 * allowed to come back unmeasured. Filling the gap with a guess would make the
 * comparison worthless, which is the only thing this exists to do.
 *
 * Shadow only. Nothing here decides a published grade, direction, entry, stop or
 * target.
 */

import { classifyInstrument, inLiquidWindow } from "@/lib/scanner/program";
import { sessionState } from "@/lib/instrument-sessions";
import {
  classifyStructuralState,
  scoreSixDimensions,
  type Bias,
  type LevelInput,
  type SixDimensionResult,
} from "@/lib/six-dimension-score";
import type { ProgramInput } from "@/lib/scanner/score";

const FLOW_WEIGHT = { high: 1, medium: 0.6, low: 0.25 } as const;

function biasOf(value: string | undefined, wantBull: boolean): Bias {
  const v = (value ?? "").toLowerCase();
  if (v.includes("bull") || v === "up" || v === "long") return "bullish";
  if (v.includes("bear") || v === "down" || v === "short") return "bearish";
  if (v === "aligned") return wantBull ? "bullish" : "bearish";
  return "neutral";
}

function rungBias(input: ProgramInput, label: string): Bias {
  const rung = input.ladder.find((r) => r.label.toLowerCase() === label.toLowerCase());
  return biasOf(rung?.bias ?? rung?.trend ?? rung?.structure, input.wantBull);
}

export function sixDimensionFromScan(
  input: ProgramInput,
  extras?: {
    /** Resolved outcomes for this instrument, when there are enough to count. */
    trackRecord?: { sample: number; expectancyR: number } | null;
    /** Share of range volume at the lows and highs, when a volume profile exists. */
    volumeAtLows?: number | null;
    volumeAtHighs?: number | null;
    entry?: number | null;
    stop?: number | null;
    firstTarget?: number | null;
  },
): SixDimensionResult {
  const spec = classifyInstrument(input.symbol);
  const window = inLiquidWindow(spec, input.at);
  const quality = sessionState(spec.liquidWindows, input.at, { alwaysOpen: spec.alwaysOpen }).quality;
  const bias: Bias = input.wantBull ? "bullish" : "bearish";

  const trend: "up" | "down" | "range" =
    input.h4Trend === "up" ? "up" : input.h4Trend === "down" ? "down" : "range";
  const state = classifyStructuralState({
    trend,
    volumeAtLows: extras?.volumeAtLows ?? null,
    volumeAtHighs: extras?.volumeAtHighs ?? null,
  });

  // Confluence counts the same evidence the scan found, once each, with the
  // reaction-count gate the framework insists on.
  const levels: LevelInput[] = [];
  if (input.hasHtfZone) levels.push({ price: 0, reactionCount: 2, formedInLiquidSession: window.inside, timeframe: "4H" });
  if (input.hasOrderBlock) levels.push({ price: 0, reactionCount: 2, formedInLiquidSession: window.inside, timeframe: "1H" });
  const independent: string[] = [];
  if (input.sweptLiquidity) independent.push("liquidity swept before the move");
  if (input.protectedBreak) independent.push("protected break of structure");
  if (input.priceVsPoc) independent.push(`price ${input.priceVsPoc} the point of control`);

  const flow = input.cvd ?? input.delta ?? null;
  const flowAgrees = flow == null ? false : input.wantBull ? flow > 0 : flow < 0;

  const closes = [rungBias(input, "Daily"), rungBias(input, "4H"), rungBias(input, "1H")];
  const directionalCloseShare = closes.filter((b) => b === bias).length / closes.length;

  return scoreSixDimensions({
    bias,
    weekly: rungBias(input, "Weekly"),
    daily: rungBias(input, "Daily"),
    fourHourTrend: trend,
    oneHour: biasOf(input.h1StructureBreak, input.wantBull),
    fifteenMinute: biasOf(input.m15Confirmation, input.wantBull),
    structuralState: state.state,
    atrRatio: input.volumeRatio ?? 1,
    directionalCloseShare,
    orderFlowAgrees: flowAgrees,
    orderFlowWeight: FLOW_WEIGHT[spec.flowTrust],
    orderFlowConfidence: spec.flowTrust,
    entry: extras?.entry ?? null,
    stop: extras?.stop ?? null,
    firstTarget: extras?.firstTarget ?? null,
    // The engine publishes a stop and target but no size, so this is honestly
    // false until sizing is emitted with the plan.
    sizeDerivedFromInvalidation: false,
    levels,
    independentReasons: independent,
    sessionQuality: window.marketClosed ? 0 : quality,
    sessionReason: window.marketClosed
      ? "Market closed for the weekend"
      : window.inside
        ? `Inside the ${window.label} window, timed in the venue's own clock`
        : `Outside this instrument's liquid hours, next opens in about ${Math.round(window.minutesToOpen / 60)}h`,
    trackRecord: extras?.trackRecord ?? null,
  });
}
