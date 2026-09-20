// Model 3 ("Photon Trading") rulebook: the ONLY knowledge this model is fed.
//
// Every rule below is distilled from the Photon Trading market-structure
// material supplied by the owner (the "mechanical system for mapping market
// structure" transcript). Nothing from TradeMind Classic or The Trading
// Channel is in scope: no order blocks, no fair value gaps, no 38.2 candles,
// no moving-average filters.
//
// Same shape as the other rulebooks: versioned, written down, deterministic in
// intent. The AI is never allowed to decide direction, entry, stop, target or
// grade from it; code checks the rules and the AI narrates the result.
//
// Engine coverage note (honest scope): the deterministic engine in
// photon-engine.ts checks rules 1-9 directly. Rule 10 (supply/demand and
// multi-timeframe confluence) is coach knowledge the model can teach, but it
// is NOT auto-detected in v1, so the engine never files a signal from it alone.

export const PHOTON_RULEBOOK_VERSION = "photon-1.0";

export type PhotonRule = {
  /** Stable number the coach and the engine both cite. */
  id: number;
  title: string;
  /** What must be true, in testable terms. */
  rule: string;
  /** What voids the setup. */
  invalidates?: string;
};

export const PHOTON_RULEBOOK: readonly PhotonRule[] = [
  {
    id: 1,
    title: "Map the swing range first",
    rule:
      "Structure is always drawn from the WICKS of candles. In a bullish market price makes higher highs and higher lows; in a bearish market lower lows and lower highs. The swing high is the highest point of the current leg and the swing low is the LOWEST POINT THAT CAUSED the most recent swing high (mirror for shorts). Everything between the current swing high and swing low is internal structure and is not the trend.",
    invalidates: "Reading a trend off internal structure alone is a mapping error, not a signal.",
  },
  {
    id: 2,
    title: "Break of structure defines the trend",
    rule:
      "A bullish break of structure occurs when price takes out the swing high to form a higher high; bearish when it takes out the swing low to form a lower low. The trend is whatever direction produced the most recent SWING break. A trend change is confirmed by a single swing break against the prior trend (a swing lower low ends an uptrend; a swing higher high ends a downtrend) - a double break is NOT required, accepting that some single breaks are liquidity grabs.",
  },
  {
    id: 3,
    title: "Closes for swings, wicks for internal",
    rule:
      "Type 1 mapping: a SWING break of structure is only valid when a candle CLOSES beyond the swing level - a wick through it is a liquidity grab, not a break. Type 2 mapping: INTERNAL changes of character only need a wick through the minor level. Swing levels use closes; internal levels use wicks. Never mix the two.",
  },
  {
    id: 4,
    title: "Expect the pullback after every break",
    rule:
      "After a swing break of structure, always expect a pullback on that timeframe. The moment a level breaks is the moment to stop wanting to enter with the break - never chase a fresh break of structure.",
  },
  {
    id: 5,
    title: "Strong and weak structure",
    rule:
      "A swing low's job is to make a higher high; a swing high's job is to make a lower low. A low that went on to take out the high is a STRONG low and should be protected; a high that failed to take out the low is a WEAK high and should be targeted. In an uptrend the goal is to catch strong higher lows and target weak highs; in a downtrend catch strong lower highs and target weak lows.",
  },
  {
    id: 6,
    title: "Change of character times the pullback",
    rule:
      "A change of character is an INTERNAL structure shift (wick break is enough): the first minor lower low after an up-run, or the first minor higher high after a down-run. The counter-trend change of character says the pullback has likely started; the change of character back in line with the swing trend says the pullback has likely finished and the swing leg is resuming. Changes of character are not the holy grail and can give false signals - they time entries, they do not set direction.",
  },
  {
    id: 7,
    title: "Enter when internal realigns with swing",
    rule:
      "The continuation entry is taken only after the sequence completes: swing break of structure, pullback, then an internal change of character back in the direction of the swing trend. Entering while internal structure is still against the swing trend means the pullback is not done - wait.",
    invalidates: "If the pullback trades through the protecting swing level with a close, the setup is void.",
  },
  {
    id: 8,
    title: "Stops behind the protecting swing",
    rule:
      "The stop goes beyond the swing point that protects the trade: above the lower high for shorts, below the higher low for longs. That level is strong by definition - a lot of money had to step in to create it - so price should not trade through it if the read is right.",
  },
  {
    id: 9,
    title: "Target weak structure at minimum",
    rule:
      "The first target is the weak swing point: the high that failed to make a lower low, or the low that failed to make a higher high. That is the minimum objective; anything beyond it is a bonus. If the weak structure cannot pay at least 1.5x the risk, the trade does not meet this model's bar.",
  },
  {
    id: 10,
    title: "Reversals are the exception, not the trade",
    rule:
      "The safe reversal waits for the swing break against the old trend, then trades the pullback. Anticipating a reversal off an internal change of character at a clean opposing level is allowed but is lower quality by definition, and if a change of character back in the direction of the existing trend appears, the reversal idea is abandoned immediately - the strong low or high is likely being protected. Supply/demand zones and multi-timeframe alignment refine these entries but are coach knowledge in v1, not auto-detected.",
    invalidates: "An opposing change of character against the anticipated reversal voids it.",
  },
];

export function photonRuleCount(): number {
  return PHOTON_RULEBOOK.length;
}

/** Serialised rulebook for the coach's system prompt. */
export function photonRulebookForPrompt(): string {
  if (PHOTON_RULEBOOK.length === 0) return "(No strategies have been written into this model yet.)";
  const lines = PHOTON_RULEBOOK.map((r) =>
    [`Rule ${r.id} - ${r.title}: ${r.rule}`, r.invalidates ? `  Voided when: ${r.invalidates}` : null]
      .filter(Boolean)
      .join("\n"),
  );
  return [
    `RULEBOOK ${PHOTON_RULEBOOK_VERSION} (${PHOTON_RULEBOOK.length} rules, persistent across sessions):`,
    ...lines,
    "You may not add, relax, or reinterpret a rule. Direction, entry, stop, target and grade are computed in code, never by you.",
  ].join("\n");
}
