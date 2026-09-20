/**
 * The taught framework in code: six dimensions, the gate, and the two things the
 * product never computed - structural state and level quality.
 *
 * WHY THIS IS SEPARATE FROM THE LIVE GRADE
 * ----------------------------------------
 * The foundation sequence promises the software judges a setup on the same six
 * dimensions a trader is taught to score by hand. The live grade is derived from
 * a different, coherent framework - regime, order blocks, structure breaks. Both
 * can be right; they are not the same thing, and a trader taught one and shown
 * the other is entitled to be confused.
 *
 * So this computes the taught framework honestly and in full, and it runs in
 * shadow. It records what it would have said next to what was published, and it
 * only becomes the number on the screen if it separates resolved outcomes better
 * on data it was not built from. Fifteen resolved A grades are not permission to
 * change a grading system.
 *
 * Everything here is pure and closed-bar. Two dimensions are allowed to score
 * zero rather than be estimated: session outside liquid hours, and track record
 * below its sample floor. A framework that invents its weakest inputs is worse
 * than one that admits to them.
 */

import { drawdownAfterLosses, positionSize } from "@/lib/analysis-models/foundation-framework";

export type Bias = "bullish" | "bearish" | "neutral";

// ---------------------------------------------------------------------------
// structural state
// ---------------------------------------------------------------------------

export type StructuralState = "accumulation" | "markup" | "distribution" | "markdown" | "transitioning";

/**
 * Accumulation and distribution are the same picture on price alone. They divide
 * on where the volume printed: at the lows, or at the highs. With no volume read
 * the honest answer is "transitioning", not a coin flip - and transitions are
 * where the old pattern has stopped working before the new one is obvious.
 */
export function classifyStructuralState(input: {
  trend: "up" | "down" | "range";
  /** Share of the range's volume done in its lower third, 0-1. */
  volumeAtLows?: number | null;
  /** Share of the range's volume done in its upper third, 0-1. */
  volumeAtHighs?: number | null;
}): { state: StructuralState; confident: boolean; reason: string } {
  if (input.trend === "up") return { state: "markup", confident: true, reason: "Higher highs and higher lows." };
  if (input.trend === "down") return { state: "markdown", confident: true, reason: "Lower highs and lower lows." };

  const lows = input.volumeAtLows;
  const highs = input.volumeAtHighs;
  if (lows == null || highs == null) {
    return {
      state: "transitioning",
      confident: false,
      reason: "Range with no volume distribution. Accumulation and distribution cannot be told apart on price alone.",
    };
  }
  const edge = lows - highs;
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  if (edge > 0.15) return { state: "accumulation", confident: true, reason: `Range volume sits at the lows (${pct(lows)} against ${pct(highs)}).` };
  if (edge < -0.15) return { state: "distribution", confident: true, reason: `Range volume sits at the highs (${pct(highs)} against ${pct(lows)}).` };
  return { state: "transitioning", confident: false, reason: "Range volume evenly spread, so there is no decisive read." };
}

// ---------------------------------------------------------------------------
// level quality
// ---------------------------------------------------------------------------

export type LevelTimeframe = "W" | "D" | "4H" | "1H" | "15M";

export interface LevelInput {
  price: number;
  /** One touch is a coincidence. Two is a level. */
  reactionCount: number;
  /** A level formed in dead hours exists on the chart and nowhere else. */
  formedInLiquidSession: boolean;
  timeframe: LevelTimeframe;
}

const TIMEFRAME_WEIGHT: Record<LevelTimeframe, number> = { W: 1, D: 0.85, "4H": 0.6, "1H": 0.4, "15M": 0.2 };

/** 0-1. Reaction count is the gate; liquidity and timeframe are the weights. */
export function levelQuality(level: LevelInput): { score: number; reason: string } {
  if (level.reactionCount < 2) {
    return { score: 0, reason: `Only ${level.reactionCount} reaction here. One touch is a coincidence, not a level.` };
  }
  const reaction = Math.min(1, (level.reactionCount - 1) / 2);
  const liquidity = level.formedInLiquidSession ? 1 : 0.35;
  const time = TIMEFRAME_WEIGHT[level.timeframe];
  return {
    score: reaction * 0.4 + liquidity * 0.25 + time * 0.35,
    reason: `${level.reactionCount} reactions, ${level.formedInLiquidSession ? "formed in liquid hours" : "formed in dead hours"}, on the ${level.timeframe} chart.`,
  };
}

// ---------------------------------------------------------------------------
// the six dimensions
// ---------------------------------------------------------------------------

export interface TaughtDimension {
  id: "structure" | "momentum" | "risk" | "confluence" | "session" | "track-record";
  name: string;
  /** 0-5, the scale the trader is taught. */
  score: number;
  reason: string;
  /** True where the dimension rests on no measured input. */
  unmeasured: boolean;
}

export interface SixDimensionInput {
  /** The direction being scored. */
  bias: Bias;
  weekly: Bias;
  daily: Bias;
  fourHourTrend: "up" | "down" | "range";
  oneHour: Bias;
  fifteenMinute: Bias;
  structuralState: StructuralState;

  /** ATR against its own median. 1 is typical; below 0.7 is drift. */
  atrRatio: number;
  /** Share of recent closes in the bias direction, 0-1. */
  directionalCloseShare: number;
  orderFlowAgrees: boolean;
  /** How much this instrument's volume figure is worth, 0-1. */
  orderFlowWeight: number;
  orderFlowConfidence: "low" | "medium" | "high";

  entry?: number | null;
  stop?: number | null;
  firstTarget?: number | null;
  /** True once a size has actually been derived from the invalidation distance. */
  sizeDerivedFromInvalidation: boolean;

  levels: LevelInput[];
  /** Independent reasons, named. Correlated reasons must not be listed twice. */
  independentReasons: string[];

  /** From instrument-sessions: 0 outside liquid hours, 1 in the best hours. */
  sessionQuality: number;
  sessionReason: string;

  /** Resolved outcomes for this instrument and band, or null when unmeasured. */
  trackRecord?: { sample: number; expectancyR: number } | null;
}

export interface SixDimensionResult {
  dimensions: TaughtDimension[];
  /** 0-30. */
  total: number;
  gatePassed: boolean;
  gateReason: string;
  /** Shadow only. Never published without held-out validation. */
  shadowGrade: "A+" | "A" | "B" | "C" | "D" | "F";
  notes: string[];
}

/** Strong, on the 0-5 scale the trader is taught. */
export const STRONG = 4;
/** Below this many resolved trades, track record is not evidence. */
export const TRACK_RECORD_FLOOR = 20;

const round2 = (n: number) => Math.round(n * 100) / 100;
const clamp5 = (n: number) => Math.max(0, Math.min(5, n));

export function scoreSixDimensions(input: SixDimensionInput): SixDimensionResult {
  const notes: string[] = [];

  // --- 1. structure: the cascade, weighted by the hierarchy we teach. ------
  const agrees = (b: Bias) => (b === "neutral" ? 0 : b === input.bias ? 1 : -1);
  const fourHourBias: Bias = input.fourHourTrend === "up" ? "bullish" : input.fourHourTrend === "down" ? "bearish" : "neutral";
  const cascade =
    agrees(input.weekly) * 0.35 +
    agrees(input.daily) * 0.3 +
    agrees(fourHourBias) * 0.2 +
    agrees(input.oneHour) * 0.1 +
    agrees(input.fifteenMinute) * 0.05;

  let structure = clamp5((cascade + 1) * 2.5);
  let structureReason = `Cascade at ${cascade.toFixed(2)} (weekly ${input.weekly}, daily ${input.daily}, 4H ${input.fourHourTrend}, 1H ${input.oneHour}, 15m ${input.fifteenMinute}).`;
  if (agrees(input.weekly) < 0) {
    structure = Math.min(structure, 1);
    structureReason += " The trade opposes weekly structure, so it is capped: the 15-minute does not get a vote.";
  }
  if (input.structuralState === "transitioning") {
    structure = Math.min(structure, 2.5);
    structureReason += " State is transitioning, where the old pattern has stopped working and the new one is not obvious yet.";
  }
  if (
    (input.bias === "bullish" && input.structuralState === "distribution") ||
    (input.bias === "bearish" && input.structuralState === "accumulation")
  ) {
    structure = Math.min(structure, 1);
    structureReason += ` Taking this side into ${input.structuralState} is the most common "that level should have held" failure there is.`;
  }

  // --- 2. momentum: force behind the move, or drift. ----------------------
  let momentum = Math.min(2, input.directionalCloseShare * 2.5);
  momentum += Math.min(1.5, Math.max(0, (input.atrRatio - 0.7) * 2));
  if (input.orderFlowAgrees) {
    const confidence = input.orderFlowConfidence === "high" ? 1 : input.orderFlowConfidence === "medium" ? 0.6 : 0.3;
    momentum += 1.5 * Math.max(0, Math.min(1, input.orderFlowWeight)) * confidence;
  }
  momentum = clamp5(momentum);
  const momentumReason =
    `${Math.round(input.directionalCloseShare * 100)}% of recent closes in this direction, range at ${input.atrRatio.toFixed(2)}x its median, ` +
    `volume ${input.orderFlowAgrees ? "agrees" : "does not agree"} and counts for ${input.orderFlowWeight.toFixed(2)} on this instrument.`;

  // --- 3. risk: where you are wrong, and what that makes the size. --------
  let risk = 0;
  let riskReason: string;
  if (input.entry == null || input.stop == null || input.firstTarget == null) {
    riskReason = "No invalidation defined, so there is no risk model and no size.";
  } else {
    const distance = Math.abs(input.entry - input.stop);
    const rr = distance > 0 ? Math.abs(input.firstTarget - input.entry) / distance : 0;
    risk = Math.min(3.5, rr * 1.25);
    if (input.sizeDerivedFromInvalidation) risk += 1.5;
    risk = clamp5(risk);
    riskReason =
      `${rr.toFixed(2)} to 1 on the first target, invalidation ${distance.toFixed(5)} away. ` +
      (input.sizeDerivedFromInvalidation
        ? "Size comes from that distance, which is what makes the stop the fixed quantity."
        : "Size does not come from that distance yet, so the stop is not the fixed quantity.");
  }

  // --- 4. confluence: independent reasons, counted once each. -------------
  const scoredLevels = input.levels.map((l) => levelQuality(l));
  const qualifying = scoredLevels.filter((l) => l.score > 0);
  const confluence = clamp5(qualifying.reduce((a, l) => a + l.score, 0) * 1.2 + input.independentReasons.length * 0.6);
  const confluenceReason =
    `${qualifying.length} of ${input.levels.length} marked levels qualify on reaction count, ` +
    `plus ${input.independentReasons.length} independent reasons${input.independentReasons.length ? `: ${input.independentReasons.join(", ")}` : ""}.`;

  // --- 5. session: computed in the venue's clock, not judged. -------------
  const session = clamp5(Math.max(0, Math.min(1, input.sessionQuality)) * 5);

  // --- 6. track record: measured, or zero and said so. -------------------
  let trackRecord = 0;
  let trackReason: string;
  const record = input.trackRecord;
  if (!record || record.sample < TRACK_RECORD_FLOOR) {
    trackReason = `${record?.sample ?? 0} resolved trades here. Below ${TRACK_RECORD_FLOOR} this scores zero rather than inventing a figure.`;
  } else {
    trackRecord = clamp5(2.5 + record.expectancyR * 2.5);
    trackReason = `${record.expectancyR.toFixed(2)}R average over ${record.sample} resolved trades on this instrument.`;
  }

  const dimensions: TaughtDimension[] = [
    { id: "structure", name: "Structure", score: round2(structure), reason: structureReason, unmeasured: false },
    { id: "momentum", name: "Momentum", score: round2(momentum), reason: momentumReason, unmeasured: false },
    { id: "risk", name: "Risk", score: round2(risk), reason: riskReason, unmeasured: input.entry == null || input.stop == null },
    { id: "confluence", name: "Confluence", score: round2(confluence), reason: confluenceReason, unmeasured: false },
    { id: "session", name: "Session", score: round2(session), reason: input.sessionReason, unmeasured: false },
    { id: "track-record", name: "Track record", score: round2(trackRecord), reason: trackReason, unmeasured: !record || record.sample < TRACK_RECORD_FLOOR },
  ];

  const byId = Object.fromEntries(dimensions.map((d) => [d.id, d])) as Record<TaughtDimension["id"], TaughtDimension>;
  const structureStrong = byId.structure.score >= STRONG;
  const riskStrong = byId.risk.score >= STRONG;
  const others = [byId.momentum, byId.confluence, byId.session, byId["track-record"]];
  const othersStrong = others.filter((d) => d.score >= STRONG);
  const gatePassed = structureStrong && riskStrong && othersStrong.length >= 2;
  const gateReason = gatePassed
    ? `Strong on structure and risk, plus ${othersStrong.length} others (${othersStrong.map((d) => d.name).join(", ")}).`
    : `${!structureStrong ? "Structure is not strong. " : ""}${!riskStrong ? "Risk is not strong. " : ""}${othersStrong.length} of the other four are strong, and two are needed.`;

  const total = round2(dimensions.reduce((a, d) => a + d.score, 0));
  let shadowGrade: SixDimensionResult["shadowGrade"];
  if (!gatePassed) shadowGrade = total >= 18 ? "C" : total >= 12 ? "D" : "F";
  else if (total >= 27) shadowGrade = "A+";
  else if (total >= 23) shadowGrade = "A";
  else if (total >= 19) shadowGrade = "B";
  else shadowGrade = "C";

  if (byId.session.score === 0) notes.push("Outside this instrument's liquid hours, where structure quality does not rescue a setup.");
  if (byId["track-record"].score === 0) notes.push(`Track record is unmeasured, so the highest reachable total is 25 of 30 until there are ${TRACK_RECORD_FLOOR} resolved trades here.`);

  return { dimensions, total, gatePassed, gateReason, shadowGrade, notes };
}

export { drawdownAfterLosses, positionSize };
