/**
 * Scanner Program v1 — the grading program, as specification and as pure code.
 *
 * WHY THIS REPLACES THE VOTE COUNT
 * --------------------------------
 * countEvidence() tallied ticks and divided by checks. Three problems with that,
 * none of them about what the engine measures:
 *
 *   1. Every tick was worth the same, which is an assumption presented as a
 *      measurement.
 *   2. It double counted inside a family. Cumulative delta is the running sum of
 *      delta, so `cvd > 0` and `delta > 0` are one number scored twice. Monthly,
 *      Weekly and Daily bias are one trend at three resolutions on overlapping
 *      bars.
 *   3. The top grade was awarded for clearing a fixed threshold, so it got more
 *      common as the features got more generous.
 *
 * The one rule that fixes all three: score at most ONE contribution per evidence
 * family. Six families, six scores. The redundant observations are still shown to
 * the trader, as detail, never as extra points.
 *
 * WHAT DOES NOT CHANGE
 * --------------------
 * Direction still comes from the deterministic cascade in resolveDirection().
 * Caps still only ever lower a grade. R:R is still a gate, not evidence. The AI
 * still narrates and never decides.
 *
 * THE WEIGHTS ARE NOT MEASURED
 * ----------------------------
 * PROVISIONAL_WEIGHTS is a prior, not a fit. It must never be presented to a user
 * as a probability or a win rate. They get replaced by weights fitted to resolved
 * outcomes once there is clean resolved data (neutral rows voided, costs
 * subtracted, stop widths comparable) — months, not weeks.
 */

export type Grade9 = "A+" | "A" | "A-" | "B+" | "B" | "B-" | "C+" | "C" | "C-";
export type Tier = "A" | "B" | "C";
export type EvidenceFamily = "regime" | "location" | "trigger" | "participation" | "execution" | "risk";
export type InstrumentClass = "fx_major" | "fx_yen" | "metal" | "index" | "crypto" | "energy" | "unclassified";

export const GRADE_BANDS: Grade9[] = ["A+", "A", "A-", "B+", "B", "B-", "C+", "C", "C-"];

export function tierOf(band: Grade9): Tier {
  if (band.startsWith("A")) return "A";
  if (band.startsWith("B")) return "B";
  return "C";
}

// ---------------------------------------------------------------------------
// the nine bands
// ---------------------------------------------------------------------------

export interface BandDefinition {
  band: Grade9;
  /** Percentile of the engine's own scored setups this band occupies. */
  percentileFloor: number;
  /** Minimum lower confidence bound on expected net R to qualify. */
  minLowerBoundR: number;
  tradeable: boolean;
  meaning: string;
  action: string;
}

/**
 * Percentile floors matter more than the R floors: they are what keeps A+ rare by
 * construction, because the top 2% cannot inflate however generous the features
 * become. The R floors are the second, independent gate, so the best setup of a
 * bad week cannot wear the top grade.
 */
export const BAND_DEFINITIONS: BandDefinition[] = [
  { band: "A+", percentileFloor: 98, minLowerBoundR: 0.35, tradeable: true,
    meaning: "Top 2% of scored setups, and the pessimistic estimate of net R is still strongly positive.",
    action: "Full planned risk. A handful a month, not a day." },
  { band: "A", percentileFloor: 93, minLowerBoundR: 0.20, tradeable: true,
    meaning: "Top 7%. Clearly positive expected net R with the uncertainty taken off.",
    action: "Full planned risk." },
  { band: "A-", percentileFloor: 85, minLowerBoundR: 0.10, tradeable: true,
    meaning: "Strong setup with one soft edge, usually execution quality or a thinner sample.",
    action: "Full planned risk, or three quarters if the soft edge is execution." },
  { band: "B+", percentileFloor: 72, minLowerBoundR: 0.05, tradeable: true,
    meaning: "Sound structure, positive but modest expected net R once costs are removed.",
    action: "Half risk. A real trade, not a headline one." },
  { band: "B", percentileFloor: 55, minLowerBoundR: 0, tradeable: true,
    meaning: "The structure is there and the expectation is around break-even after costs.",
    action: "Half risk at most, and only if it is not the third correlated signal of the session." },
  { band: "B-", percentileFloor: 40, minLowerBoundR: -0.05, tradeable: false,
    meaning: "Something is genuinely there but the expectation does not currently pay for the spread.",
    action: "Watchlist. A named trigger must fire before this is reconsidered." },
  { band: "C+", percentileFloor: 25, minLowerBoundR: -0.15, tradeable: false,
    meaning: "Partial evidence, pointed the right way, not enough of it.",
    action: "No trade. Shown so the trader can see what is forming." },
  { band: "C", percentileFloor: 10, minLowerBoundR: -0.30, tradeable: false,
    meaning: "Weak or conflicting evidence.",
    action: "No trade." },
  { band: "C-", percentileFloor: 0, minLowerBoundR: -99, tradeable: false,
    meaning: "Evidence points against the proposed direction, or there is barely any.",
    action: "No trade. If this keeps appearing on one instrument, that instrument is in the wrong regime for us." },
];

/** A fine band may only be displayed once its cell has this many resolved trades. */
export const MIN_SAMPLE_FOR_BAND = 400;
/** Below this, the tier itself is provisional and must be labelled as such. */
export const MIN_SAMPLE_FOR_TIER = 50;

// ---------------------------------------------------------------------------
// stage 0 and 1: the vetoes
// ---------------------------------------------------------------------------

export type VetoCode =
  | "DATA_STALE" | "DATA_GAP" | "DATA_CROSSED" | "NO_HTF_DATA"
  | "SPREAD_TOO_WIDE" | "COST_SHARE_TOO_HIGH" | "OUTSIDE_LIQUID_WINDOW"
  | "EVENT_BLACKOUT" | "MAINTENANCE_OR_ROLL"
  | "NO_TARGET_ROOM" | "REGIME_MISMATCH" | "VOLATILITY_EXTREME"
  | "CLUSTER_EXPOSURE" | "DUPLICATE_SIGNAL" | "REPEATED_FAILED_BREAK"
  | "DAILY_LOSS_LIMIT";

export interface Veto {
  code: VetoCode;
  /** Shown to the trader. Plain language, names the thing that must change. */
  reason: string;
  /** Mandatory vetoes cannot be outweighed by any amount of setup quality. */
  mandatory: boolean;
}

/**
 * The discernment half of the job. These run BEFORE any scoring, because a
 * beautiful setup in an untradeable state is not a setup. Ordered by strength of
 * evidence: cost, data integrity and event state first; the chart-shape filters
 * last and deliberately non-mandatory, because a badly set chop filter removes
 * winners.
 */
export const VETO_SPEC: Array<{ code: VetoCode; family: string; rule: string; mandatory: boolean; evidence: "strong" | "conditional" }> = [
  { code: "DATA_STALE", family: "data", mandatory: true, evidence: "strong",
    rule: "Latest bar older than 2x the scan timeframe, or the 4H read predates the last 4H close." },
  { code: "DATA_GAP", family: "data", mandatory: true, evidence: "strong",
    rule: "Missing bars inside the lookback window used to build structure." },
  { code: "DATA_CROSSED", family: "data", mandatory: true, evidence: "strong",
    rule: "Bid above ask, non-monotonic timestamps, or a quote from an unapproved venue." },
  { code: "NO_HTF_DATA", family: "data", mandatory: true, evidence: "strong",
    rule: "Fewer than 20 closed 4H candles. Without them the cascade has nothing to read." },
  { code: "COST_SHARE_TOO_HIGH", family: "execution", mandatory: true, evidence: "strong",
    rule: "Estimated round-trip cost exceeds 25% of predicted gross expectancy." },
  { code: "SPREAD_TOO_WIDE", family: "execution", mandatory: true, evidence: "strong",
    rule: "Current spread above the 90th percentile for this instrument at this time of week." },
  { code: "OUTSIDE_LIQUID_WINDOW", family: "execution", mandatory: false, evidence: "strong",
    rule: "Timestamp outside every liquid window for this instrument." },
  { code: "EVENT_BLACKOUT", family: "event", mandatory: true, evidence: "strong",
    rule: "Inside the pre-event window for a high-impact release affecting this instrument." },
  { code: "MAINTENANCE_OR_ROLL", family: "event", mandatory: true, evidence: "strong",
    rule: "Exchange maintenance, contract roll or expiry window for the reference future." },
  { code: "NO_TARGET_ROOM", family: "payoff", mandatory: true, evidence: "strong",
    rule: "Nearest opposing structure is closer than the cost-adjusted minimum target distance." },
  { code: "CLUSTER_EXPOSURE", family: "portfolio", mandatory: false, evidence: "strong",
    rule: "Nth open position in one correlation cluster and one direction. Publish the best, mark the rest correlated." },
  { code: "DUPLICATE_SIGNAL", family: "portfolio", mandatory: false, evidence: "strong",
    rule: "Same instrument, same direction, inside the dedupe window." },
  { code: "DAILY_LOSS_LIMIT", family: "portfolio", mandatory: false, evidence: "strong",
    rule: "Trader is at their configured daily loss limit. A claim about the trader today, not about this setup." },
  { code: "REGIME_MISMATCH", family: "regime", mandatory: false, evidence: "conditional",
    rule: "Continuation playbook while the trend is indistinguishable from a random walk, or mean reversion into an accepted information-driven break." },
  { code: "VOLATILITY_EXTREME", family: "regime", mandatory: false, evidence: "conditional",
    rule: "Short-window realised volatility above the extreme percentile with no event-expansion model active." },
  { code: "REPEATED_FAILED_BREAK", family: "regime", mandatory: false, evidence: "conditional",
    rule: "Three or more boundary crossings that closed back inside the lookback. Continuation entries suspended until the range resets." },
];

// ---------------------------------------------------------------------------
// stage 3: the six evidence families
// ---------------------------------------------------------------------------

export const FAMILY_SPEC: Array<{ family: EvidenceFamily; question: string; inputsToday: string[]; doNotDoubleCount: string }> = [
  {
    family: "regime",
    question: "Is the instrument in a state where this playbook has an edge, and does the trade go with it?",
    inputsToday: ["mtf ladder", "h4.direction", "h4.trend", "cisd state", "instrument behaviour persistence"],
    doNotDoubleCount:
      "Monthly, Weekly, Daily and 4H are not four independent votes. They are one trend at four resolutions on shared bars, collapsed into a single weighted trend score.",
  },
  {
    family: "location",
    question: "Is price at a level that formed independently of the move that just happened?",
    inputsToday: ["1H order blocks", "FVG", "4H supply/demand", "protected structure", "key levels"],
    doNotDoubleCount:
      "An order block, a fair value gap and a displacement candle from one impulse are one observation. Score the best single anchor, record the rest as detail.",
  },
  {
    family: "trigger",
    question: "Has price actually done something here, rather than merely arrived?",
    inputsToday: ["m15 confirmation", "1H structure break", "sweep detection", "5m displacement"],
    doNotDoubleCount:
      "A sweep and the break of structure that follows it are one event seen twice. One primary trigger plus at most one genuine microstructure addition.",
  },
  {
    family: "participation",
    question: "Did anyone actually trade it, and does the flow agree?",
    inputsToday: ["orderFlow.cvd", "orderFlow.delta", "priceVsPoc", "session volume"],
    doNotDoubleCount:
      "Cumulative delta is the running sum of delta. One flow read, weighted by how trustworthy this instrument's volume actually is.",
  },
  {
    family: "execution",
    question: "Can this be entered and exited at a price that leaves the edge intact?",
    inputsToday: ["cost share of expectancy", "session", "liquid windows", "session volume"],
    doNotDoubleCount:
      "Session, spread and volume all measure liquidity. One execution score, normally a penalty rather than a source of conviction.",
  },
  {
    family: "risk",
    question: "What could make this irrelevant regardless of how good it looks?",
    inputsToday: ["news calendar", "correlated open signals", "stale higher timeframe"],
    doNotDoubleCount:
      "Always a penalty. The absence of event risk is the normal state and must never be scored as a positive.",
  },
];

/**
 * Starting weights. A PRIOR, NOT A FIT — see the file header. The only research
 * claim encoded here is that regime and trend persistence has the broadest
 * cross-asset evidence, and that execution and risk are penalties rather than
 * sources of conviction.
 */
export const PROVISIONAL_WEIGHTS: Record<EvidenceFamily, number> = {
  regime: 0.30,
  location: 0.20,
  trigger: 0.20,
  participation: 0.15,
  execution: 0.10,
  risk: 0.05,
};

/** A family counts as "above threshold" for the A+ test at or above this score. */
export const FAMILY_THRESHOLD: Record<EvidenceFamily, number> = {
  regime: 0.55,
  location: 0.55,
  trigger: 0.55,
  participation: 0.55,
  execution: 0.60,
  risk: 0.60,
};

// ---------------------------------------------------------------------------
// per-instrument-class specification
// ---------------------------------------------------------------------------

export interface ClassSpec {
  klass: InstrumentClass;
  members: string[];
  /** UTC windows where the instrument actually moves. */
  liquidWindowsUtc: Array<{ startMin: number; endMin: number; label: string }>;
  /** How much to trust this instrument's volume and delta. */
  flowTrust: "high" | "medium" | "low";
  flowNote: string;
  stopAtrRange: [number, number];
  eligiblePlaybooks: Array<"continuation" | "breakout" | "mean-reversion">;
  typicalHold: string;
  eventRisk: string;
  characteristicTrap: string;
}

const win = (start: string, end: string, label: string) => {
  const min = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
  return { startMin: min(start), endMin: min(end), label };
};

/**
 * The rules are identical across classes. Only the constants and the eligibility
 * change: six separate scoring systems would be six separate things to overfit.
 *
 * flowTrust is the constant that changes behaviour most. Spot FX is OTC and
 * fragmented, so our volume is one dealer's slice rather than the market, while
 * on the indices and oil the futures tape is the real thing.
 */
export const INSTRUMENT_CLASS_SPEC: ClassSpec[] = [
  {
    klass: "fx_major",
    members: ["EUR/USD", "GBP/USD", "AUD/USD", "USD/CAD", "USD/CHF", "NZD/USD"],
    liquidWindowsUtc: [win("07:00", "11:00", "London morning"), win("12:00", "16:00", "London/NY overlap")],
    flowTrust: "low",
    flowNote: "Spot FX is OTC and fragmented. Broker tick volume is one dealer's slice, not the market.",
    stopAtrRange: [0.8, 1.6],
    eligiblePlaybooks: ["continuation", "breakout"],
    typicalHold: "30 minutes to 8 hours intraday",
    eventRisk: "Central banks, CPI, employment, GDP. About an hour of elevated volatility after a release.",
    characteristicTrap: "Trading the local afternoon or rollover, where the structure is real but nobody is there to move it.",
  },
  {
    klass: "fx_yen",
    members: ["USD/JPY", "EUR/JPY", "GBP/JPY", "AUD/JPY"],
    liquidWindowsUtc: [win("00:00", "06:00", "Tokyo"), win("12:00", "16:00", "London/NY overlap")],
    flowTrust: "low",
    flowNote: "Same OTC limitation as the majors. CME JPY futures are a cleaner proxy.",
    stopAtrRange: [0.9, 1.8],
    eligiblePlaybooks: ["continuation", "breakout"],
    typicalHold: "1 to 6 hours in Tokyo; 30 minutes to 8 hours on London/NY continuation",
    eventRisk: "BoJ, Japanese CPI and wages, MoF intervention, US yields. Intervention is unscheduled.",
    characteristicTrap: "A London/NY session filter that misses the Tokyo regime, where a lot of the genuine movement is.",
  },
  {
    klass: "metal",
    members: ["XAU/USD", "XAG/USD"],
    liquidWindowsUtc: [win("08:00", "12:00", "London"), win("13:20", "17:00", "COMEX/NY")],
    flowTrust: "medium",
    flowNote: "COMEX futures flow is high quality. Spot and CFD volume is provider-specific.",
    stopAtrRange: [1.0, 2.2],
    eligiblePlaybooks: ["continuation", "breakout", "mean-reversion"],
    typicalHold: "15 minutes to 8 hours intraday; 1 to 10 days on a macro trend",
    eventRisk: "Very sensitive to US employment, CPI, GDP, rates and the dollar.",
    characteristicTrap: "Silver is not small gold. Thinner depth and larger tails make the same ATR multiple a tighter stop in practice.",
  },
  {
    klass: "index",
    members: ["SPX500", "NAS100", "US30"],
    liquidWindowsUtc: [win("13:30", "15:00", "NY cash open"), win("19:00", "20:00", "NY close")],
    flowTrust: "high",
    flowNote: "ES/NQ/YM futures volume and delta are the real tape.",
    stopAtrRange: [0.8, 1.8],
    eligiblePlaybooks: ["continuation", "breakout"],
    typicalHold: "15 minutes to 3 hours on an open drive; 1 to 10 days on a swing break",
    eventRisk: "CPI, payrolls, FOMC, megacap earnings, Treasury yields.",
    characteristicTrap: "Overnight structure is thin and routinely erased at the cash open.",
  },
  {
    klass: "crypto",
    members: ["BTC/USD", "ETH/USD", "XRP/USD", "SOL/USD"],
    liquidWindowsUtc: [win("12:00", "21:00", "Europe/US overlap")],
    flowTrust: "medium",
    flowNote: "Venue-specific data. Combine perpetual delta with spot flow, open interest and funding.",
    stopAtrRange: [1.2, 2.2],
    eligiblePlaybooks: ["continuation", "breakout"],
    typicalHold: "30 minutes to 12 hours intraday; hours to 2 days on a liquidation or macro move",
    eventRisk: "CPI, FOMC, ETF flows, regulation, exchange failures, liquidation cascades.",
    characteristicTrap: "Treating 24/7 as 24/7 liquid. Weekend structure is real but low participation.",
  },
  {
    klass: "energy",
    members: ["WTI Oil", "WTICO_USD", "BCO/USD"],
    liquidWindowsUtc: [win("13:00", "18:30", "NYMEX pit hours")],
    flowTrust: "high",
    flowNote: "CL futures flow is high quality during liquid hours; include calendar spread and open interest.",
    stopAtrRange: [1.2, 2.2],
    eligiblePlaybooks: ["continuation", "breakout"],
    typicalHold: "5 to 60 minutes on an inventory reaction; 2 to 20 days on a supply swing",
    eventRisk: "EIA inventories on Wednesday, API, OPEC, outages, geopolitics, expiry.",
    characteristicTrap: "Holding a technical read into the Wednesday inventory print.",
  },
];

const UNCLASSIFIED: ClassSpec = {
  klass: "unclassified",
  members: [],
  liquidWindowsUtc: [win("07:00", "16:00", "London and NY")],
  flowTrust: "low",
  flowNote: "No measured profile for this instrument, so flow is trusted least and the constants stay conservative.",
  stopAtrRange: [1.0, 2.0],
  eligiblePlaybooks: ["continuation"],
  typicalHold: "Unmeasured. Treat as intraday.",
  eventRisk: "Unmeasured.",
  characteristicTrap: "There is no measured profile here, so nothing about it has been validated.",
};

export function classifyInstrument(symbol: string): ClassSpec {
  const s = symbol.trim().toUpperCase();
  const norm = s.replace("_", "/");
  for (const spec of INSTRUMENT_CLASS_SPEC) {
    if (spec.members.some((m) => m.toUpperCase() === s || m.toUpperCase() === norm)) return spec;
  }
  if (/JPY/.test(norm)) return INSTRUMENT_CLASS_SPEC[1];
  if (/^XAU|^XAG/.test(norm)) return INSTRUMENT_CLASS_SPEC[2];
  if (/BTC|ETH|SOL|XRP|USDT/.test(norm)) return INSTRUMENT_CLASS_SPEC[4];
  if (/NAS|SPX|US30|DE30|UK100|JP225/.test(norm)) return INSTRUMENT_CLASS_SPEC[3];
  if (/WTI|BCO|OIL|NATGAS/.test(norm)) return INSTRUMENT_CLASS_SPEC[5];
  if (/^(EUR|GBP|AUD|NZD|USD|CAD|CHF)\/(EUR|GBP|AUD|NZD|USD|CAD|CHF)$/.test(norm)) return INSTRUMENT_CLASS_SPEC[0];
  return UNCLASSIFIED;
}

/** How much a flow read is allowed to move the participation family. */
export const FLOW_TRUST_FACTOR: Record<ClassSpec["flowTrust"], number> = {
  high: 1,
  medium: 0.6,
  low: 0.25,
};

export function inLiquidWindow(spec: ClassSpec, at: Date): { inside: boolean; label: string | null } {
  const minutes = at.getUTCHours() * 60 + at.getUTCMinutes();
  for (const w of spec.liquidWindowsUtc) {
    const inside = w.startMin <= w.endMin
      ? minutes >= w.startMin && minutes <= w.endMin
      : minutes >= w.startMin || minutes <= w.endMin;
    if (inside) return { inside: true, label: w.label };
  }
  return { inside: false, label: null };
}

// ---------------------------------------------------------------------------
// what an A+ actually is
// ---------------------------------------------------------------------------

export const A_PLUS_DEFINITION = {
  conditions: [
    { n: 1, name: "Validated playbook in an eligible regime",
      rule: "The playbook has positive measured expectancy on this instrument class and the current regime is one it is eligible for." },
    { n: 2, name: "Non-redundant evidence across at least four of six families",
      rule: "Four or more families score above their threshold, counted once each. Regime and location must both be among them." },
    { n: 3, name: "Payoff survives costs with room to spare",
      rule: "Round-trip cost under 15% of predicted gross expectancy, and the first target is reachable within the typical hold." },
    { n: 4, name: "Top 2% by percentile",
      rule: "Composite score at or above the 98th percentile of scored setups on a rolling 90 days." },
    { n: 5, name: "Pessimistic expectancy still positive",
      rule: "Lower bound of expected net R at or above +0.35R." },
    { n: 6, name: "Enough history to hold the opinion",
      rule: `At least ${MIN_SAMPLE_FOR_BAND} resolved trades in this instrument-class cell. Below that the ceiling is A.` },
  ],
  todayConsequence:
    "On current data no instrument class has the sample to earn an A+. The engine caps at A and names the condition that failed, which is the right answer rather than a limitation.",
};

export const PIPELINE = [
  { stage: 0, name: "Data integrity", rule: "Mandatory vetoes. A stale feed manufactures order blocks, gaps and delta extremes that were never there." },
  { stage: 1, name: "Tradeability vetoes", rule: "Cost, session, event, target room, portfolio. A perfect setup in an untradeable state is not a setup." },
  { stage: 2, name: "Playbook eligibility", rule: "Pick the playbook from the measured regime. An ineligible playbook is skipped, not downgraded." },
  { stage: 3, name: "Family scoring", rule: "Six families, six scores, one contribution each. Redundant observations are detail, never points." },
  { stage: 4, name: "Expected net R", rule: "Combine into predicted net R and an uncertainty band. Costs are subtracted here, not later." },
  { stage: 5, name: "Band assignment", rule: "Percentile, then the absolute R floor, then the sample gate. All three must pass." },
  { stage: 6, name: "Size", rule: "From band and uncertainty, not from the letter alone. Correlated signals share one risk budget." },
] as const;

export const AI_BOUNDARY = "The AI narrates. The code decides. No exceptions, no overrides, no tie-breaks.";
