// Distilled methodology + psychology knowledge base for the AI coach.
//
// These are ORIGINAL summaries of publicly discussed frameworks (Wyckoff as
// systematised by Villahermosa, Weis-style spring/test reading, Dalton auction
// theory / Market Profile, and the trading psychology work of Douglas,
// Steenbarger and Hougaard). No book text is reproduced; each entry is a
// compressed operating checklist the coach can apply to live charts.
//
// Retrieval: `selectMethodologyChunks` keyword-matches the trader's message and
// the active coach so only the relevant 1-3 entries are injected per request.

export type MethodChunk = {
  id: string;
  title: string;
  framework: "wyckoff" | "auction" | "psychology";
  keywords: string[];
  body: string;
};

export const METHODOLOGY_CORE = `# METHODOLOGY BASE (apply silently, cite by name when it helps the trader learn)
- Wyckoff structure: price moves through accumulation, markup, distribution, markdown. Read effort (volume) against result (spread/close). Effort without result warns of absorption; result without effort warns of a thin move that reverses.
- Wyckoff events in order: PS, SC, AR, ST, spring/shakeout, test, SOS, LPS (mirror for distribution: PSY, BC, AR, ST, UTAD, SOW, LPSY). Name the event you believe price is at, and what would invalidate it.
- Weis-style spring/test read: the highest-probability long is a spring that sweeps below support on wide spread, then a LOW-volume test that holds above the sweep low. Failure of the test to hold is the invalidation, not a fixed stop distance.
- Auction theory (Market Profile): markets rotate to find balance and trend to seek liquidity. Value area, point of control, single prints and poor highs/lows are the levels that matter. Fade attempts back into accepted value; follow acceptance outside value.
- Combine: Wyckoff phase tells you the intent, auction acceptance tells you if the market agrees, order flow tells you who is currently winning.
- Psychology: risk is accepted BEFORE entry, never renegotiated mid-trade. Judge execution by process adherence, not by the P&L of one trade.`;

export const METHOD_CHUNKS: MethodChunk[] = [
  {
    id: "wyckoff-phases",
    title: "Wyckoff schematic and phase identification",
    framework: "wyckoff",
    keywords: ["wyckoff", "accumulation", "distribution", "phase", "schematic", "range", "consolidation", "markup", "markdown", "spring", "utad"],
    body: `Phase A stops the prior trend (SC/BC, AR, ST). Phase B is cause building: the range where the composite operator absorbs supply or unloads, usually the longest phase and the noisiest. Phase C is the test of the extreme: a spring below support (accumulation) or a UTAD above resistance (distribution) that traps breakout traders. Phase D is the move toward the opposite edge with SOS/SOW and higher lows (LPS) or lower highs (LPSY). Phase E is the trend outside the range.
How to trade it: only take continuation entries in Phase D after a confirmed SOS plus a pullback that holds (LPS). In Phase B, expect chop and cut size. Invalidation is always structural: the spring low or the UTAD high.`,
  },
  {
    id: "wyckoff-effort-result",
    title: "Effort vs result and absorption",
    framework: "wyckoff",
    keywords: ["volume", "effort", "result", "absorption", "climax", "no demand", "no supply", "spread", "close"],
    body: `Compare each bar's volume (effort) to its spread and close position (result). High volume with a narrow spread into support means supply is being absorbed: bullish. High volume with a wide down spread and a weak close means real supply: bearish. A rally on shrinking volume with narrow spreads is a no-demand bar and often precedes markdown; a decline on shrinking volume is no-supply and precedes markup.
Say which specific bar or session showed the effort/result mismatch and at what price.`,
  },
  {
    id: "wyckoff-spring-test",
    title: "Spring and test execution (Weis style)",
    framework: "wyckoff",
    keywords: ["spring", "shakeout", "test", "sweep", "liquidity sweep", "stop run", "false break", "wick"],
    body: `Sequence: support holds, then a sweep below it on expanding volume (the spring), then price reclaims the level quickly. The trade is the TEST: a second push toward the sweep low on visibly lower volume that holds. Enter on the test holding, stop below the spring low, first target the range mid or point of control, second target the range high.
Red flags: the test breaks the spring low on rising volume, or the reclaim takes many bars and stalls under the level. Those are terminal for the idea.`,
  },
  {
    id: "auction-value",
    title: "Value area, POC and acceptance",
    framework: "auction",
    keywords: ["value area", "poc", "point of control", "market profile", "auction", "balance", "imbalance", "acceptance", "rotation", "vwap", "single print"],
    body: `Each session builds a distribution: value area (roughly the bulk of traded volume) with a point of control at the highest-volume price. Inside balance, expect rotation between value area high and low, so mean-revert toward POC and fade the edges. When price leaves value and is ACCEPTED (time spent, volume building outside), the market is trending and you follow it, using the old value area edge as the invalidation.
Poor/unfinished highs and lows and single prints are magnets: name them as targets. VWAP works as the intraday fair value proxy when profile data is not on screen.`,
  },
  {
    id: "auction-orderflow",
    title: "Auction read of order flow",
    framework: "auction",
    keywords: ["order flow", "delta", "footprint", "bid", "ask", "aggressive", "passive", "imbalance", "liquidity pool", "absorption"],
    body: `Aggressive buyers lifting the offer into a level that does not move it means passive sellers are absorbing: expect rejection. Delta expanding while price stalls is trapped flow, and the reversal is usually fast. Delta and price expanding together confirms initiative and supports continuation entries.
Tie the flow to a level: initiative flow away from value is trend, responsive flow at value edges is rotation.`,
  },
  {
    id: "psy-probabilistic",
    title: "Probabilistic mindset and pre-accepted risk (Douglas frame)",
    framework: "psychology",
    keywords: ["psychology", "mindset", "fear", "greed", "confidence", "uncertainty", "probability", "edge", "discipline", "revenge", "fomo", "hesitation", "tilt"],
    body: `An edge is a probability, not a prediction, so any single trade can lose while the process is still correct. Accept the full risk in currency terms before entry; if the risk feels unacceptable, the size is wrong, not the setup. Once in, the only decisions allowed are the ones written in the plan: nothing about the plan changes because of unrealised P&L.
Coach the trader by asking what they pre-accepted, then whether they honoured it. Hesitation, moving stops and adding to losers are all symptoms of risk that was never truly accepted.`,
  },
  {
    id: "psy-daily-practice",
    title: "Daily self-coaching routine (Steenbarger frame)",
    framework: "psychology",
    keywords: ["routine", "journal", "review", "habit", "process", "goal", "improve", "coach me", "consistency", "drawdown", "slump"],
    body: `Work in short cycles: one specific behavioural goal per day, scored at the close, reviewed weekly. Keep the goal observable (for example "no entries outside the killzone", "size fixed at 0.5R until three green sessions"), not aspirational.
When performance slips, separate the problem into technique (setup selection, execution) versus emotional pattern (frustration, boredom, overconfidence after wins). Treat solution focus as the default: find the sessions where the trader already did it right and reproduce those conditions.`,
  },
  {
    id: "psy-losing-well",
    title: "Losing well and asymmetric holding (Hougaard frame)",
    framework: "psychology",
    keywords: ["losing", "loss", "cut winners", "let winners run", "pain", "stop loss", "risk of ruin", "position size", "average down", "hope"],
    body: `Most retail damage comes from taking small wins quickly and holding losers for hope, which inverts the payoff. The fix is deliberate: cut fast when the structural thesis breaks, and make holding a winner past 1R the practised skill.
Losses are a business cost, so the correct measure of a session is whether every loss was pre-sized and pre-accepted. Never increase size to recover a loss; reduce size until execution is clean again.`,
  },
];

/** Pick the most relevant methodology chunks for a message + coach persona. */
export function selectMethodologyChunks(
  userText: string,
  coachId?: string | null,
  limit = 3,
): MethodChunk[] {
  const text = (userText || "").toLowerCase();
  const psychCoach = /(psych|mind|zone|discipl|coach)/i.test(coachId || "");

  const scored = METHOD_CHUNKS.map((chunk) => {
    let score = 0;
    for (const kw of chunk.keywords) {
      if (text.includes(kw)) score += kw.includes(" ") ? 3 : 2;
    }
    if (psychCoach && chunk.framework === "psychology") score += 2;
    return { chunk, score };
  })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);

  return scored.slice(0, limit).map((s) => s.chunk);
}

/** Render selected chunks as a system-prompt block, or undefined when none match. */
export function methodologyContextBlock(
  userText: string,
  coachId?: string | null,
): string | undefined {
  const chunks = selectMethodologyChunks(userText, coachId);
  if (!chunks.length) return undefined;
  return [
    "# METHODOLOGY REFERENCE (retrieved for this question - use it, do not quote it as a source)",
    ...chunks.map((c) => `## ${c.title}\n${c.body}`),
  ].join("\n\n");
}
