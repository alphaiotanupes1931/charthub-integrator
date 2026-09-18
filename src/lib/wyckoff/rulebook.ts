// The Wyckoff rulebook — the ONLY thing the stripped-down engine knows.
//
// Written down, versioned, and shown in the app so a trader can see exactly what
// the read was checked against. Nothing else feeds this mode: no strategy
// presets, no pattern library, no model opinion. The engine checks these five
// rules deterministically and the AI is only allowed to narrate the result.
//
// Every rule id here is the same id the engine reports back, so a failing rule
// on screen maps to one line of this file.

export const WYCKOFF_RULEBOOK_VERSION = "wyckoff-1.0";

export type WyckoffRule = {
  id: number;
  title: string;
  /** What must be true, in trader language. */
  rule: string;
  /** Why it is in the book — the failure it exists to prevent. */
  why: string;
};

export const WYCKOFF_RULEBOOK: WyckoffRule[] = [
  {
    id: 1,
    title: "Phase first",
    rule:
      "The market must be in a readable Wyckoff phase — accumulation, markup, distribution or markdown. A range with no character is not a trade.",
    why: "Direction comes from the phase, not from a pattern or an indicator. No phase, no bias.",
  },
  {
    id: 2,
    title: "Liquidity must already be taken",
    rule:
      "Longs need a spring below the range or a protected low behind the break. Shorts need an upthrust above the range or a protected high. Untaken liquidity below a long is a disqualifier.",
    why: "This is the single reason entries get run through to the stop. If the stops underneath have not been collected yet, price goes and collects them first.",
  },
  {
    id: 3,
    title: "Enter at a Wyckoff location",
    rule:
      "Entry sits at the spring retest or the last point of support/supply. Never mid-range, never chasing an extended candle.",
    why: "Mid-range entries pay the full width of the range in risk for none of the edge.",
  },
  {
    id: 4,
    title: "The stop covers the protected level",
    rule:
      "The stop sits beyond the spring low or protected high, and total risk is no wider than 1.5 ATR.",
    why: "A stop inside the level being defended is not a stop, it is a donation. A stop wider than 1.5 ATR makes the R meaningless.",
  },
  {
    id: 5,
    title: "Two to one, into real structure",
    rule:
      "The first target must be at least 2R away and must sit at actual structure — the range top or bottom, or the measured move from the range width.",
    why: "A 50% win rate is profitable at 2R and a losing business at 1R. The target has to be somewhere price is actually going.",
  },
];

/** Compact form for a model prompt — same rules, no prose. */
export function rulebookForPrompt(): string {
  return [
    `WYCKOFF RULEBOOK (${WYCKOFF_RULEBOOK_VERSION}) - the only rules that apply.`,
    "You do not decide direction, entry, stop, target or grade. The engine does.",
    "You explain the read against these rules and nothing else.",
    ...WYCKOFF_RULEBOOK.map((r) => `${r.id}. ${r.title}: ${r.rule}`),
    "If a rule failed, say which one and what would have to change for it to pass.",
  ].join("\n");
}
