// Model 2 ("The Trading Channel") rulebook: the ONLY knowledge this model is fed.
//
// Every rule below is distilled from The Trading Channel's technical-analysis
// material supplied by the owner (the "everything you need to know about
// technical analysis" transcript). Nothing from TradeMind Classic is in scope:
// no order blocks, no fair value gaps, no protected break-of-structure.
//
// Same shape as the Wyckoff rulebook: versioned, written down, and deterministic
// in intent. The AI is never allowed to decide direction, entry, stop, target or
// grade from it; code checks the rules and the AI narrates the result.
//
// Engine coverage note (honest scope): the deterministic engine in
// focus-engine.ts checks rules 1-11 directly. Rules 12-14 (double tops/bottoms,
// flags/wedges, RSI divergence) are written here as coach knowledge the model
// can teach and reason about, but they are NOT auto-detected in v1, so the
// engine never files a signal from them alone.

export const FOCUS_RULEBOOK_VERSION = "trading-channel-1.0";

export type FocusRule = {
  /** Stable number the coach and the engine both cite. */
  id: number;
  title: string;
  /** What must be true, in testable terms. */
  rule: string;
  /** What voids the setup. */
  invalidates?: string;
};

export const FOCUS_RULEBOOK: readonly FocusRule[] = [
  {
    id: 1,
    title: "Objective trend",
    rule:
      "An uptrend begins when an impulsive move breaks AND closes above the previous swing high, and stays in force until price closes below the low of the most recent pullback. A downtrend is the mirror: a close below the previous swing low, in force until a close above the most recent pullback high. Anything else is no-trend.",
    invalidates: "A close beyond the low (uptrend) or high (downtrend) of the most recent pullback ends the trend read.",
  },
  {
    id: 2,
    title: "Trade with the trend",
    rule:
      "Longs are only considered while rule 1 reads uptrend; shorts only while it reads downtrend. Riding an existing trend is the core edge; picking tops and bottoms is not this model's business.",
    invalidates: "A setup against the rule-1 trend is capped at C and must be labelled counter-trend.",
  },
  {
    id: 3,
    title: "Break and retest entry zone",
    rule:
      "The entry zone is the structure level the trend just broke: broken resistance becomes support for longs, broken support becomes resistance for shorts. The trade is taken when price pulls back INTO that level, not when price is extended away from it.",
    invalidates: "For a long, a close back below the broken level by more than 0.25x ATR(14) voids the retest (mirror for shorts).",
  },
  {
    id: 4,
    title: "Pressure candle required",
    rule:
      "No entry without a pressure candle at the zone. For longs that is a green (up-close) candle at the level; for shorts a red candle. The named patterns below (rules 5-7) are stronger forms of the same requirement.",
  },
  {
    id: 5,
    title: "38.2 candle",
    rule:
      "Pull a retracement across the candle's own range (low to high for the bullish read). Bullish buying pressure: the ENTIRE body of the candle sits above the 38.2% line, leaving a long lower wick. Bearish mirror: the entire body sits below the 38.2% line from the high. This is the objective replacement for subjective 'hammer' and 'shooting star' labels.",
  },
  {
    id: 6,
    title: "Engulfing candle",
    rule:
      "Bullish: the previous candle is red and the current candle is green with a LARGER body than the previous candle's body. Bearish mirror. Bodies are compared, not wicks.",
  },
  {
    id: 7,
    title: "Close beyond",
    rule:
      "Bullish: the candle closes above the HIGH of the previous candle. Bearish: the candle closes below the LOW of the previous candle. A close beyond the previous extreme shows the side in control.",
  },
  {
    id: 8,
    title: "Stops are ATR-based",
    rule:
      "The stop sits 1x ATR(14) beyond the swing that protects the trade: below the pullback low for longs, above the pullback high for shorts. Stop distance must always be expressed in ATR so it stays in line with the volatility of the instrument and timeframe.",
    invalidates: "A fixed-pip or arbitrary stop that ignores ATR is not a valid setup for this model.",
  },
  {
    id: 9,
    title: "Targets are structure",
    rule:
      "The first target is the next opposing structure level: the previous swing high for longs, the previous swing low for shorts. Never place a target beyond a major opposing level, and be flat or at breakeven before price reaches one.",
  },
  {
    id: 10,
    title: "Minimum 1.5R",
    rule:
      "If the nearest structure target cannot pay at least 1.5x the risk, there is no trade. Reward-to-risk is computed from the written entry, stop, and target, never estimated.",
  },
  {
    id: 11,
    title: "20-period MA trend filter",
    rule:
      "Continuation and breakout trades are only taken in volatile trends, read as price holding above the 20-period moving average for longs (below for shorts). The 20 MA is a filter and can trail a stop; it is never an entry reason by itself.",
    invalidates: "A continuation setup taken while price is on the wrong side of the 20 MA caps at C.",
  },
  {
    id: 12,
    title: "Double tops and bottoms",
    rule:
      "After a first extreme and a pullback, draw the termination zone from the first extreme's bodies to its wick. Valid only if price retests the zone (a touch is enough) WITHOUT any candle closing beyond it. The pattern arms only when the neckline breaks; the entry is the pullback back to the neckline with a pressure candle. Stop: 1x ATR beyond the second extreme. Target: next structure. Coach knowledge only in v1 - not auto-detected.",
    invalidates: "A close beyond the termination zone, or a retest that never touches it, voids the pattern.",
  },
  {
    id: 13,
    title: "Flags and wedges",
    rule:
      "Flags: an impulsive move, a small consolidation, then a breakout candle - traded only while rule 11's 20-MA filter confirms a volatile trend. Ascending wedge: flat resistance with rising support; descending wedge: flat support with falling resistance; prefer the pullback entry into the broken level with a pressure candle over chasing the breakout. Coach knowledge only in v1 - not auto-detected.",
  },
  {
    id: 14,
    title: "Indicators are confluence, never entries",
    rule:
      "ATR sizes stops, the 20/50/200 MAs grade trend quality and areas of value, and RSI is only meaningful at a major structure level with divergence (price making higher highs while RSI makes lower highs, or the mirror) plus a reversal candle. No indicator reading on its own is ever a reason to enter.",
    invalidates: "Any setup justified by an indicator alone is void.",
  },
];

export function focusRuleCount(): number {
  return FOCUS_RULEBOOK.length;
}

/** Serialised rulebook for the coach's system prompt. */
export function focusRulebookForPrompt(): string {
  if (FOCUS_RULEBOOK.length === 0) return "(No strategies have been written into this model yet.)";
  const lines = FOCUS_RULEBOOK.map((r) =>
    [`Rule ${r.id} - ${r.title}: ${r.rule}`, r.invalidates ? `  Voided when: ${r.invalidates}` : null]
      .filter(Boolean)
      .join("\n"),
  );
  return [
    `RULEBOOK ${FOCUS_RULEBOOK_VERSION} (${FOCUS_RULEBOOK.length} rules, persistent across sessions):`,
    ...lines,
    "You may not add, relax, or reinterpret a rule. Direction, entry, stop, target and grade are computed in code, never by you.",
  ].join("\n");
}
