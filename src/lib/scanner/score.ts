/**
 * Scanner Program v1, stages 1 to 5: vetoes, six family scores, expected net R,
 * band assignment. Pure functions only — no I/O, so every result is reproducible
 * from its inputs and can be tested directly.
 *
 * The whole change from the old vote count is in scoreFamilies(): each family
 * yields exactly one number, and the observations that used to earn separate
 * ticks are recorded in `detail` instead.
 */

import {
  BAND_DEFINITIONS,
  FAMILY_THRESHOLD,
  FLOW_TRUST_FACTOR,
  MIN_SAMPLE_FOR_BAND,
  MIN_SAMPLE_FOR_TIER,
  PROVISIONAL_WEIGHTS,
  classifyInstrument,
  inLiquidWindow,
  tierOf,
  type ClassSpec,
  type EvidenceFamily,
  type Grade9,
  type Veto,
} from "@/lib/scanner/program";

const clamp01 = (n: number) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);
const r2 = (n: number) => Math.round(n * 100) / 100;

// ---------------------------------------------------------------------------
// inputs
// ---------------------------------------------------------------------------

export type ProgramInput = {
  symbol: string;
  timeframe: string;
  at: Date;
  /** Long = true. Neutral never reaches this program; it is NO ENTRY upstream. */
  wantBull: boolean;

  // regime
  ladder: Array<{ label: string; bias?: string | undefined; trend?: string | undefined; structure?: string | undefined }>;
  h4Direction?: string | undefined;
  h4Trend?: string | undefined;
  cisdState?: string | undefined;
  closed4hCandles?: number | undefined;

  // location
  entryZoneQuality?: number | null | undefined;
  hasOrderBlock?: boolean | undefined;
  hasFvg?: boolean | undefined;
  hasHtfZone?: boolean | undefined;
  protectedBreak?: boolean | null | undefined;

  // trigger
  h1StructureBreak?: string | undefined;
  m15Confirmation?: string | undefined;
  sweptLiquidity?: boolean | undefined;
  displacement?: boolean | undefined;

  // participation
  cvd?: number | null | undefined;
  delta?: number | null | undefined;
  priceVsPoc?: string | null | undefined;
  volumeRatio?: number | null | undefined;

  // execution
  /** Round-trip cost as a share of predicted gross expectancy, 0 to 1. */
  costShare?: number | null | undefined;
  thinVolume?: boolean | undefined;
  /** Percentile of the current spread for this instrument, 0 to 100. */
  spreadPercentile?: number | null | undefined;

  // risk
  newsInHoldWindow?: boolean | undefined;
  news48h?: boolean | undefined;
  staleHtf?: boolean | undefined;
  correlatedOpenSameDirection?: number | undefined;

  // payoff and data integrity
  plannedRR?: number | null | undefined;
  targetRoomOk?: boolean | undefined;
  barGap?: boolean | undefined;
  barStale?: boolean | undefined;
  quotesCrossed?: boolean | undefined;
};

export type FamilyScore = {
  family: EvidenceFamily;
  score: number;
  /** The one observation that produced the score. */
  basis: string;
  /** Everything else in this family. Recorded, deliberately not scored again. */
  detail: string[];
  aboveThreshold: boolean;
};

export type FamilyScores = Record<EvidenceFamily, FamilyScore>;

// ---------------------------------------------------------------------------
// stage 0 and 1: vetoes
// ---------------------------------------------------------------------------

export function evaluateVetoes(input: ProgramInput, spec: ClassSpec = classifyInstrument(input.symbol)): Veto[] {
  const out: Veto[] = [];
  const push = (code: Veto["code"], mandatory: boolean, reason: string) => out.push({ code, mandatory, reason });

  // Stage 0: data integrity. Bad data manufactures setups that never existed.
  if (input.barStale) push("DATA_STALE", true, "The latest candle is older than two of these timeframes, so this read is not current.");
  if (input.barGap) push("DATA_GAP", true, "Candles are missing inside the window used to build structure.");
  if (input.quotesCrossed) push("DATA_CROSSED", true, "The feed returned crossed or out-of-order quotes.");
  if ((input.closed4hCandles ?? 99) < 20) push("NO_HTF_DATA", true, "Fewer than 20 closed 4H candles, so the top-down cascade has nothing to read.");

  // Stage 1: cost and execution. The strongest evidence of any filter family.
  if (input.costShare != null && input.costShare > 0.25) {
    push("COST_SHARE_TOO_HIGH", true, `Spread and slippage would take ${Math.round(input.costShare * 100)}% of what this trade is expected to make, which is more than a quarter of the edge.`);
  }
  if (input.spreadPercentile != null && input.spreadPercentile > 90) {
    push("SPREAD_TOO_WIDE", true, "The spread is wider than it normally is at this time of the week.");
  }
  const window = inLiquidWindow(spec, input.at);
  if (!window.inside) {
    push("OUTSIDE_LIQUID_WINDOW", false, `Outside every window where ${input.symbol} actually moves (${spec.liquidWindowsUtc.map((w) => w.label).join(", ")}).`);
  }

  // Event state.
  if (input.newsInHoldWindow) push("EVENT_BLACKOUT", true, "A high-impact release lands inside the expected hold time for this trade.");

  // Payoff geometry.
  if (input.targetRoomOk === false) push("NO_TARGET_ROOM", true, "The nearest opposing level is closer than the smallest target that would still pay after costs.");

  // Portfolio.
  if ((input.correlatedOpenSameDirection ?? 0) >= 3) {
    push("CLUSTER_EXPOSURE", false, "This would be the third open position in the same direction on closely related instruments.");
  }
  return out;
}

// ---------------------------------------------------------------------------
// stage 3: six family scores
// ---------------------------------------------------------------------------

export function scoreFamilies(input: ProgramInput, spec: ClassSpec = classifyInstrument(input.symbol)): FamilyScores {
  const want = input.wantBull ? "bullish" : "bearish";
  const agree = (v?: string | null) => v === want;
  const opposed = (v?: string | null) => v != null && v !== "none" && v !== "neutral" && v !== want;

  // --- regime -------------------------------------------------------------
  // Monthly, Weekly, Daily and 4H are ONE trend at four resolutions on shared
  // bars, so they collapse into a single weighted score rather than four votes.
  const rungWeights: Record<string, number> = { Monthly: 0.15, Weekly: 0.2, Daily: 0.3, "4H": 0.35 };
  let rungTotal = 0;
  let rungScore = 0;
  const regimeDetail: string[] = [];
  for (const [label, w] of Object.entries(rungWeights)) {
    const rung = input.ladder.find((r) => r.label === label);
    const bias = label === "4H" ? (rung?.bias ?? input.h4Direction) : rung?.bias;
    if (!bias) continue;
    rungTotal += w;
    rungScore += w * (agree(bias) ? 1 : opposed(bias) ? 0 : 0.5);
    regimeDetail.push(`${label} ${bias}`);
  }
  const trendPersists = input.h4Trend === (input.wantBull ? "up" : "down");
  const regimeRaw = rungTotal > 0 ? rungScore / rungTotal : 0.35;
  const regime = clamp01(regimeRaw * 0.85 + (trendPersists ? 0.15 : 0));
  if (input.cisdState) regimeDetail.push(`CISD ${input.cisdState}`);

  // --- location -----------------------------------------------------------
  // Best single anchor only. An order block, a fair value gap and the
  // displacement candle behind them are one observation described three ways.
  const q = input.entryZoneQuality ?? null;
  const anchors: Array<{ score: number; basis: string }> = [];
  if (q != null) anchors.push({ score: clamp01(q / 100), basis: `1H order block scoring ${Math.round(q)}/100` });
  if (input.hasOrderBlock) anchors.push({ score: 0.6, basis: "aligned 1H order block" });
  if (input.hasHtfZone) anchors.push({ score: 0.5, basis: "4H supply/demand zone" });
  if (input.hasFvg) anchors.push({ score: 0.4, basis: "1H fair value gap" });
  const best = anchors.sort((a, b) => b.score - a.score)[0];
  const protectedBonus = input.protectedBreak === true ? 0.15 : input.protectedBreak === false ? -0.25 : 0;
  const location = clamp01((best?.score ?? 0.1) + protectedBonus);
  const locationDetail = anchors.slice(1).map((a) => a.basis);
  if (input.protectedBreak === true) locationDetail.push("break of structure left a protected low/high behind");
  if (input.protectedBreak === false) locationDetail.push("break of structure did not sweep liquidity first, so the level is unprotected");

  // --- trigger ------------------------------------------------------------
  // A sweep and the break that follows it are one event. One primary trigger,
  // plus at most one genuine microstructure addition.
  const primary = agree(input.m15Confirmation)
    ? { score: 0.65, basis: "15m confirmation in the trade's direction" }
    : agree(input.h1StructureBreak)
      ? { score: 0.55, basis: "1H structure break in the trade's direction" }
      : opposed(input.m15Confirmation)
        ? { score: 0.1, basis: "15m has confirmed the other way" }
        : { score: 0.3, basis: "price has arrived but nothing has triggered yet" };
  const addition = input.sweptLiquidity ? 0.2 : input.displacement ? 0.15 : 0;
  const trigger = clamp01(primary.score + addition);
  const triggerDetail: string[] = [];
  if (input.sweptLiquidity) triggerDetail.push("liquidity swept before the expansion");
  if (input.displacement) triggerDetail.push("displacement candle present");
  if (agree(input.h1StructureBreak) && agree(input.m15Confirmation)) triggerDetail.push("1H break agrees, counted once with the 15m confirmation");

  // --- participation ------------------------------------------------------
  // Cumulative delta is the running sum of delta, so only the best single flow
  // read counts, and it is scaled by how trustworthy this instrument's volume is.
  const trust = FLOW_TRUST_FACTOR[spec.flowTrust];
  const flowReads: Array<{ score: number; basis: string }> = [];
  if (input.cvd != null) flowReads.push({ score: input.wantBull ? (input.cvd > 0 ? 1 : 0) : input.cvd < 0 ? 1 : 0, basis: "cumulative delta" });
  else if (input.delta != null) flowReads.push({ score: input.wantBull ? (input.delta > 0 ? 1 : 0) : input.delta < 0 ? 1 : 0, basis: "bar delta" });
  if (input.priceVsPoc) {
    flowReads.push({ score: (input.wantBull ? input.priceVsPoc !== "below" : input.priceVsPoc !== "above") ? 1 : 0, basis: `price ${input.priceVsPoc} the point of control` });
  }
  const bestFlow = flowReads[0];
  // With no flow data, or no reason to trust it, the family sits at neutral
  // rather than counting as agreement.
  const participation = bestFlow ? clamp01(0.5 + (bestFlow.score - 0.5) * 2 * trust) : 0.5;
  const participationDetail = flowReads.slice(1).map((f) => `${f.basis} recorded as detail, not scored again`);
  participationDetail.push(`${spec.flowTrust} flow trust for ${spec.klass}: ${spec.flowNote}`);

  // --- execution ----------------------------------------------------------
  // Session, spread and volume all measure liquidity: one score, and it is
  // normally a penalty rather than a source of conviction.
  const window = inLiquidWindow(spec, input.at);
  let execution = 1;
  const executionDetail: string[] = [];
  if (!window.inside) { execution -= 0.45; executionDetail.push("outside the instrument's liquid windows"); }
  else executionDetail.push(`inside the ${window.label} window`);
  if (input.costShare != null) {
    execution -= Math.min(0.5, input.costShare * 2);
    executionDetail.push(`costs take ${Math.round(input.costShare * 100)}% of expected gross`);
  }
  if (input.thinVolume) { execution -= 0.2; executionDetail.push("thin session volume"); }
  if (input.spreadPercentile != null && input.spreadPercentile > 75) { execution -= 0.15; executionDetail.push("spread wider than usual"); }

  // --- risk ---------------------------------------------------------------
  // Always a penalty. The absence of event risk is the normal state.
  let risk = 1;
  const riskDetail: string[] = [];
  if (input.newsInHoldWindow) { risk -= 0.6; riskDetail.push("high-impact release inside the hold window"); }
  else if (input.news48h) { risk -= 0.25; riskDetail.push("high-impact release within 48 hours"); }
  if (input.staleHtf) { risk -= 0.3; riskDetail.push("higher-timeframe read is behind the last close"); }
  const correlated = input.correlatedOpenSameDirection ?? 0;
  if (correlated > 0) { risk -= Math.min(0.4, correlated * 0.15); riskDetail.push(`${correlated} correlated position(s) already open the same way`); }
  if (riskDetail.length === 0) riskDetail.push("no measured event or portfolio risk, which is the normal state");

  const make = (family: EvidenceFamily, score: number, basis: string, detail: string[]): FamilyScore => ({
    family,
    score: r2(clamp01(score)),
    basis,
    detail,
    aboveThreshold: clamp01(score) >= FAMILY_THRESHOLD[family],
  });

  return {
    regime: make("regime", regime, rungTotal > 0 ? `trend at ${regimeDetail.length} resolutions, weighted` : "no higher-timeframe trend data", regimeDetail),
    location: make("location", location, best?.basis ?? "no independent level at price", locationDetail),
    trigger: make("trigger", trigger, primary.basis, triggerDetail),
    participation: make("participation", participation, bestFlow ? bestFlow.basis : "no trustworthy flow read", participationDetail),
    execution: make("execution", execution, window.inside ? "tradeable session" : "outside liquid hours", executionDetail),
    risk: make("risk", risk, riskDetail[0]!, riskDetail),
  };
}

// ---------------------------------------------------------------------------
// stage 4: composite and expected net R
// ---------------------------------------------------------------------------

export type Expectancy = {
  composite: number;
  /** Estimated probability of reaching the first target. NOT a measured win rate. */
  pTarget: number;
  grossR: number;
  netR: number;
  lowerBoundR: number;
  costR: number;
  sample: number;
};

/**
 * Composite is the weighted family score with the participation weight scaled by
 * flow trust, and the freed weight redistributed proportionally so a low-trust
 * instrument is not simply scored out of a smaller total.
 */
export function compositeScore(families: FamilyScores, spec: ClassSpec): number {
  const trust = FLOW_TRUST_FACTOR[spec.flowTrust];
  const weights: Record<EvidenceFamily, number> = { ...PROVISIONAL_WEIGHTS };
  weights.participation = PROVISIONAL_WEIGHTS.participation * trust;
  const freed = PROVISIONAL_WEIGHTS.participation - weights.participation;
  const others: EvidenceFamily[] = ["regime", "location", "trigger", "execution", "risk"];
  const othersTotal = others.reduce((s, f) => s + PROVISIONAL_WEIGHTS[f], 0);
  for (const f of others) weights[f] += freed * (PROVISIONAL_WEIGHTS[f] / othersTotal);
  const total = Object.values(weights).reduce((s, w) => s + w, 0);
  const sum = (Object.keys(weights) as EvidenceFamily[]).reduce((s, f) => s + weights[f] * families[f].score, 0);
  return r2(sum / total);
}

/**
 * Expected net R with an uncertainty band.
 *
 * pTarget is a mapping from the composite, not a measured frequency, which is
 * exactly why the lower bound widens as the cell's resolved sample shrinks. The
 * band is a normal approximation on the outcome distribution — good enough to
 * rank setups and to refuse to publish a number we cannot support, and not good
 * enough to show anyone as a probability.
 */
export function expectedNetR(args: {
  composite: number;
  plannedRR: number;
  costR: number;
  sample: number;
}): Expectancy {
  const rr = Number.isFinite(args.plannedRR) && args.plannedRR > 0 ? args.plannedRR : 1.5;
  const p = clamp01(0.3 + 0.35 * args.composite);
  const grossR = p * rr - (1 - p);
  const netR = grossR - args.costR;
  const n = Math.max(args.sample, 10);
  const se = Math.sqrt((p * (1 - p)) / n) * (rr + 1);
  return {
    composite: args.composite,
    pTarget: r2(p),
    grossR: r2(grossR),
    netR: r2(netR),
    lowerBoundR: r2(netR - 1.96 * se),
    costR: r2(args.costR),
    sample: args.sample,
  };
}

// ---------------------------------------------------------------------------
// stage 5: band assignment
// ---------------------------------------------------------------------------

export type BandResult = {
  /** What the trader is shown. Coarsened when the sample cannot support detail. */
  band: Grade9;
  /** The band the numbers alone would give, before the sample gate. */
  rawBand: Grade9;
  tier: "A" | "B" | "C";
  tradeable: boolean;
  /** True while the cell has too little history for a fine band. */
  coarsened: boolean;
  /** True when there is not even enough history to stand behind the tier. */
  provisional: boolean;
  reasons: string[];
  aPlusFailed: string[];
};

/**
 * Percentile first, then the absolute R floor, then the sample gate. All three
 * must pass. The sample gate is the part holding the whole thing honest: it is the
 * reason the engine currently cannot issue an A+ on any instrument, and it must
 * not be removed to raise signal volume.
 */
export function assignBand(args: {
  percentile: number;
  lowerBoundR: number;
  sample: number;
  families: FamilyScores;
  costShare: number | null;
  targetReachable: boolean;
  playbookEligible: boolean;
}): BandResult {
  const reasons: string[] = [];
  const raw = BAND_DEFINITIONS.find((d) => args.percentile >= d.percentileFloor && args.lowerBoundR >= d.minLowerBoundR)
    ?? BAND_DEFINITIONS[BAND_DEFINITIONS.length - 1]!;

  // The six A+ conditions. All required, and they are checked even when the band
  // is lower, so the report can name exactly which one failed.
  const above = (Object.values(args.families) as FamilyScore[]).filter((f) => f.aboveThreshold);
  const aPlusFailed: string[] = [];
  if (!args.playbookEligible) aPlusFailed.push("the playbook is not eligible in the measured regime");
  if (above.length < 4 || !args.families.regime.aboveThreshold || !args.families.location.aboveThreshold) {
    aPlusFailed.push(`only ${above.length} of 6 evidence families clear their threshold${args.families.regime.aboveThreshold && args.families.location.aboveThreshold ? "" : ", and regime and location must both be among them"}`);
  }
  if (args.costShare != null && args.costShare > 0.15) aPlusFailed.push(`costs take ${Math.round(args.costShare * 100)}% of expected gross, over the 15% A+ limit`);
  if (!args.targetReachable) aPlusFailed.push("the first target is not reachable inside the typical hold for this instrument");
  if (args.percentile < 98) aPlusFailed.push(`this setup sits at the ${Math.round(args.percentile)}th percentile of what the engine scores, not the top 2%`);
  if (args.lowerBoundR < 0.35) aPlusFailed.push(`the pessimistic estimate of net R is ${args.lowerBoundR.toFixed(2)}R, under the +0.35R floor`);
  if (args.sample < MIN_SAMPLE_FOR_BAND) aPlusFailed.push(`${args.sample} resolved trades in this instrument class, under the ${MIN_SAMPLE_FOR_BAND} needed to hold the opinion`);

  let band = raw;
  if (band === "A+" && aPlusFailed.length > 0) {
    band = "A";
    reasons.push(`Capped at A: ${aPlusFailed[0]}.`);
  }

  // Sample gate: a fine band claims a precision the data cannot support, so below
  // the threshold the trader sees the parent tier and the reason.
  const coarsened = args.sample < MIN_SAMPLE_FOR_BAND;
  if (coarsened && band !== "A+") {
    const parent = tierOf(band) as Grade9;
    if (parent !== band) {
      reasons.push(`Shown as ${parent} rather than ${band}: separating neighbouring bands needs ${MIN_SAMPLE_FOR_BAND} resolved trades in this cell and there are ${args.sample}.`);
      band = parent;
    }
  }
  const provisional = args.sample < MIN_SAMPLE_FOR_TIER;
  if (provisional) reasons.push(`Provisional: only ${args.sample} resolved trades on this instrument class, so treat the grade as an ordering, not a measurement.`);

  const def = BAND_DEFINITIONS.find((d) => d.band === band)!;
  return {
    band,
    rawBand: raw.band,
    tier: tierOf(band),
    tradeable: def.tradeable && !provisional ? def.tradeable : def.tradeable && !provisional,
    coarsened,
    provisional,
    reasons,
    aPlusFailed,
  };
}

/** Percentile of `value` within a sorted-or-unsorted sample of past composites. */
export function percentileOf(value: number, distribution: number[]): number {
  if (distribution.length < 20) {
    // Too few scored setups to rank against. Fall back to the composite itself as
    // a percentile so bands still order sensibly, and let the sample gate carry
    // the honesty rather than pretending we have a distribution.
    return r2(clamp01(value) * 100);
  }
  const below = distribution.filter((d) => d < value).length;
  return r2((below / distribution.length) * 100);
}

/** The nine bands are for display; the three tiers are what we validate and size on. */
export function legacyGrade(band: Grade9): "A+" | "A" | "B" | "C" {
  if (band === "A+") return "A+";
  if (band.startsWith("A")) return "A";
  if (band.startsWith("B")) return "B";
  return "C";
}
