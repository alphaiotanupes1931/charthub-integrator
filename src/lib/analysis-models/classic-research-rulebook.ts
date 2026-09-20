// Candidate Classic concepts supplied by the owner. They are explanatory and
// measurable research inputs only; none may alter a live direction, grade,
// confidence, entry, stop, or target until its held-out and forward tests pass.

export const CLASSIC_RESEARCH_RULEBOOK_VERSION = "classic-research-0.3-shadow";

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
  {
    id: "six-dimension-score",
    title: "Six-dimension setup score",
    rule: "Score every candidate 1-5 on structure, momentum, risk, confluence, session and track record, and require 4 or better on structure and risk plus at least two of the other four. Measure this alongside the current grade on filed signals before it is allowed to influence a published grade: if the six-dimension gate separates outcomes better than the current grade on held-out data, it earns its place, and not before.",
  },
  {
    id: "level-weighting",
    title: "Reaction, volume, time - in that order",
    rule: "A level qualifies on repeated reaction first (two or more turns, not one), then on volume actually traded there, then on the timeframe it formed on, with higher timeframes outranking lower ones absolutely. Test whether scoring zones this way, rather than treating every marked level alike, changes hit rate and average R. A 15-minute signal must never outrank weekly structure in any candidate rule.",
  },
  {
    id: "invalidation-first-sizing",
    title: "Invalidation before size",
    rule: "The stop is the price where the reason for the trade stops being true, taken from structure, and position size is derived from that distance at a fixed account risk percentage. Size is never held constant with the stop moved to fit. This is a planning and coaching rule; it changes suggested size, never direction or grade.",
  },
  {
    id: "no-undated-win-rates",
    title: "No performance claim without its working",
    rule: "A win rate, expectancy or R figure may only be shown with its sample size, date range and instruments, and only from the scoreboard. Anything else is decoration and must not be stated to a trader, including in marketing copy.",
  },
] as const;

export function classicResearchRulebookForPrompt(): string {
  return [
    `CLASSIC SHADOW RESEARCH ${CLASSIC_RESEARCH_RULEBOOK_VERSION}:`,
    ...CLASSIC_RESEARCH_RULEBOOK.map((item) => `${item.title}: ${item.rule}`),
    "These concepts may be explained and measured, but must not change live Classic outputs until separate held-out and forward validation is approved.",
  ].join("\n");
}