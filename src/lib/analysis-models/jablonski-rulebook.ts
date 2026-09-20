// Model 4 ("Eric Jablonski") rulebook: the ONLY knowledge this model is fed.
//
// Distilled verbatim from the short day-trading method supplied by the owner:
// mark the first two 15-minute candles of the session, wait for a 15-minute
// close outside that range, take the break, stop at the opposite end of the
// range, fixed 10-point target, let it play out. Nothing from TradeMind
// Classic, The Trading Channel or Photon Trading is in scope: no order blocks,
// no fair value gaps, no pressure candles, no market-structure mapping.
//
// The claimed 81% win rate is the author's own back-test claim. It is recorded
// here as a claim, not as a platform statistic, and the model's own scoreboard
// is the only number the platform will ever publish about it.

export const JABLONSKI_RULEBOOK_VERSION = "jablonski-1.0";

export type JablonskiRule = {
  id: number;
  title: string;
  rule: string;
  invalidates?: string;
};

export const JABLONSKI_RULEBOOK: readonly JablonskiRule[] = [
  {
    id: 1,
    title: "Trade the 15-minute chart only",
    rule:
      "Every decision in this model is made on closed 15-minute candles. No higher timeframe confirms it and no lower timeframe refines it.",
  },
  {
    id: 2,
    title: "Mark the opening range",
    rule:
      "Take the first two 15-minute candles of the session and mark the high and the low of that two-candle range. That range is the only level the model uses all day.",
    invalidates: "If the session's first two 15-minute candles are not present in the data, there is no range and no trade.",
  },
  {
    id: 3,
    title: "Wait for a 15-minute close outside the range",
    rule:
      "Do nothing until a 15-minute candle CLOSES above the range high or below the range low. A wick outside the range is not a signal.",
  },
  {
    id: 4,
    title: "Take the break in its direction",
    rule:
      "A close above the range high is a buy; a close below the range low is a sell. The entry is that candle's close.",
    invalidates: "Once price closes back inside the range after the break, that break is finished and the model stands down for the day.",
  },
  {
    id: 5,
    title: "Stop at the opposite end of the range",
    rule:
      "The stop loss goes at the other end of the opening range: the range low for a buy, the range high for a sell. Risk is the height of the range, whatever that happens to be.",
  },
  {
    id: 6,
    title: "Fixed 10-point target, then let it play out",
    rule:
      "The take profit is a fixed 10 points from entry in the instrument's own points. There is no trailing, no partials and no discretionary exit: the trade resolves at the target or at the stop. Wins are deliberately small and the method depends on a high hit rate rather than a large reward-to-risk ratio.",
  },
  {
    id: 7,
    title: "Only instruments with a defined point",
    rule:
      "A fixed 10-point target only means something where a point is defined. This model trades index CFDs, gold, silver, oil and FX pairs; on instruments without a conventional point size it returns NO ENTRY rather than inventing one.",
  },
];

export function jablonskiRuleCount(): number {
  return JABLONSKI_RULEBOOK.length;
}

export function jablonskiRulebookForPrompt(): string {
  return [
    `## Eric Jablonski rulebook (${JABLONSKI_RULEBOOK_VERSION})`,
    "This is the complete method this model is fed. Do not add a rule that is not below.",
    "",
    ...JABLONSKI_RULEBOOK.map((r) =>
      [`Rule ${r.id} — ${r.title}`, r.rule, r.invalidates ? `Invalidated when: ${r.invalidates}` : ""].filter(Boolean).join("\n"),
    ),
    "",
    "The author's claimed 81% win rate is his own back-test claim, not a TradeMind measurement. Never repeat it as a platform statistic; point the trader at this model's own scoreboard instead.",
  ].join("\n");
}
