// Candidate Classic concepts supplied by the owner. They are explanatory and
// measurable research inputs only; none may alter a live direction, grade,
// confidence, entry, stop, or target until its held-out and forward tests pass.

export const CLASSIC_RESEARCH_RULEBOOK_VERSION = "classic-research-0.2-shadow";

export const CLASSIC_RESEARCH_RULEBOOK = [
  {
    id: "poc-continuation",
    title: "Accumulation, breakout, POC pullback, continuation",
    rule: "First identify a compressed accumulation range and its volume-profile point of control. Require a closed-bar breakout aligned with higher-timeframe bias, a later pullback that touches the range POC, and a closed-bar continuation back through the breakout boundary. A POC touch without continuation is not an entry.",
  },
  {
    id: "fvg-types",
    title: "Classify fair value gaps before using them",
    rule: "Research three explicit classes. A normal FVG is a three-candle imbalance without a qualifying structural break. A breakaway FVG is created by an impulsive candle that closes through prior swing structure. An inverted FVG is a previously formed gap later closed through in the opposite direction, changing its expected support/resistance role. The name alone is never confirmation.",
  },
  {
    id: "session-po3",
    title: "Session-range power of three",
    rule: "For the approved FX and metals only, use New York-local closed bars. Test Asia accumulation followed by a one-sided London manipulation and opposite New York distribution. Separately test Asia and London accumulating together, followed by a New York manipulation of one boundary and distribution through the other side. Double sweeps are conflicted and missing sessions force a wait.",
  },
  {
    id: "education-first",
    title: "Learning before strategy switching",
    rule: "Losses are not evidence that a trader should immediately replace a strategy or indicator. Coach the trader to review the chart, price action, repeated patterns, execution, and sample evidence before changing a rule. This is coaching guidance, not a signal input.",
  },
  {
    id: "four-hour-zone-fifteen-minute-break",
    title: "Four-hour rejection zone with 15-minute confirmation",
    rule: "Start on the four-hour chart and mark only the clearest repeated rejection area as a zone, using candle bodies and wicks rather than a single exact price. Do not enter merely because price reaches it. On the 15-minute chart, require a closed-candle break of the relevant swing structure in the direction supported by the four-hour read. The zone establishes location; the 15-minute break confirms timing. If either part is absent, wait.",
  },
] as const;

export function classicResearchRulebookForPrompt(): string {
  return [
    `CLASSIC SHADOW RESEARCH ${CLASSIC_RESEARCH_RULEBOOK_VERSION}:`,
    ...CLASSIC_RESEARCH_RULEBOOK.map((item) => `${item.title}: ${item.rule}`),
    "These concepts may be explained and measured, but must not change live Classic outputs until separate held-out and forward validation is approved.",
  ].join("\n");
}